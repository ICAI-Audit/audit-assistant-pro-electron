// Checks one incoming file and turns it into a WorkingFile (spec section 5.1): a PDF must parse
// and have a page; a protected PDF is opened without a password when it allows that, otherwise
// the user is asked for it; an image must decode, and WebP, BMP and GIF are converted to PNG so
// that Images to PDF can place them. A TIFF is read by tiff.ts: one upright page with square pixels
// becomes a PNG (or its own JPEG) image like a converted GIF; any other TIFF becomes one PDF with a
// page for each picture. Either keeps the TIFF's name and is marked convertedFrom 'tiff'; the TIFF
// itself is never changed. The browser-only steps are passed in, so this runs in tests.
import { sniffImageFormat } from '@/lib/pdf-tools/imagesToPdf';
import { inspectPdf, type PdfInfo } from '@/lib/pdf-tools/inspect';
import { readTiff, tiffToImage, tiffToPdf } from '@/lib/pdf-tools/tiff';
import { tryOpenWithoutPassword } from '@/lib/pdf-tools/unlock';
import { LIST_MAX_BYTES, newFileId } from '@/lib/pdf-tools/workingList';
import { PdfToolsError, type FileOrigin, type WorkingFile } from '@/lib/pdf-tools/types';
import { imageSizeProblem, readImageHeader } from './imageHeader';

export interface IntakeDeps {
  /** Re-encodes a decodable image as PNG; throws PdfToolsError 'bad-image' otherwise. */
  decodeToPng(bytes: Uint8Array, mimeType: string): Promise<Uint8Array>;
  /** Throws PdfToolsError 'bad-image' when the image does not decode. */
  imageSize(bytes: Uint8Array, mimeType: string): Promise<{ width: number; height: number }>;
  /** Asks for the password and returns the unlocked bytes, or null when the user skips the file. */
  askPassword(name: string, bytes: Uint8Array): Promise<Uint8Array | null>;
  /**
   * Called before each slow step, which runs on the main thread (unlocking a large scan can take
   * half a minute), so that the screen can say what is happening and paint before it starts.
   */
  onStage?(stage: 'checking' | 'unlocking' | 'converting'): Promise<void> | void;
  /**
   * Called between slices of a TIFF conversion, with the page being converted, so that the screen
   * stays alive and can say how far it is; throws to stop the conversion (the list moved on).
   */
  pause?(progress: { page: number; pages: number }): Promise<void>;
}

export interface IntakeSource {
  name: string;
  bytes: Uint8Array;
  origin: FileOrigin;
  evidenceId?: string;
}

/**
 * 'opened-without-password': an encrypted PDF that opened with an empty password (protection
 * removed in the copy kept); 'first-frame': an animated image of which only the first frame is kept;
 * 'tiff-converted': a TIFF kept as a PDF (several pages, or one page turned or with uneven pixels).
 */
export type IntakeNotice = 'opened-without-password' | 'first-frame' | 'tiff-converted';

/** The short note a list row shows for a converted file: "Converted from a 12-page TIFF". */
export function convertedNote(file: Pick<WorkingFile, 'kind' | 'pageCount' | 'convertedFrom'>): string | null {
  if (file.convertedFrom !== 'tiff') return null;
  return file.kind === 'pdf' && file.pageCount !== null && file.pageCount > 1 ? `Converted from a ${file.pageCount}-page TIFF` : 'Converted from TIFF';
}

export type IntakeResult =
  | { status: 'ready'; file: WorkingFile; notice?: IntakeNotice }
  | { status: 'skipped' };

type ImageFormat = 'jpeg' | 'png' | 'gif' | 'webp' | 'bmp' | 'tiff' | 'heic';

const CONVERTIBLE: Partial<Record<ImageFormat, string>> = { gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp' };

const HEIC_REFUSAL =
  'iPhone photos (HEIC) cannot be used here; send the photo from the phone as a JPG, or set Camera > Formats > Most Compatible, and add it again.';

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(start, start + length));
}

export function imageFormatOf(bytes: Uint8Array): ImageFormat | null {
  const basic = sniffImageFormat(bytes);
  if (basic !== 'other') return basic;
  const head = ascii(bytes, 0, 12);
  if (head.startsWith('GIF87a') || head.startsWith('GIF89a')) return 'gif';
  if (head.startsWith('RIFF') && head.slice(8, 12) === 'WEBP') return 'webp';
  if (head.startsWith('BM') && bytes.length > 26) return 'bmp';
  // classic TIFF (42) and BigTIFF (43), which tiff.ts refuses with its own sentence
  if (head.startsWith('II*\0') || head.startsWith('MM\0*') || head.startsWith('II+\0') || head.startsWith('MM\0+')) return 'tiff';
  if (head.slice(4, 8) === 'ftyp' && /^(heic|heix|hevc|mif1|msf1)/.test(head.slice(8, 12))) return 'heic';
  return null;
}

function hasPdfHeader(bytes: Uint8Array): boolean {
  return ascii(bytes, 0, Math.min(bytes.length, 1024)).includes('%PDF-');
}

function baseFile(source: IntakeSource, bytes: Uint8Array): Omit<WorkingFile, 'kind' | 'mimeType' | 'pageCount'> {
  const file: Omit<WorkingFile, 'kind' | 'mimeType' | 'pageCount'> = {
    id: newFileId(),
    name: source.name,
    origin: source.origin,
    bytes,
    size: bytes.byteLength,
    wasProtected: false,
    hasRestrictions: false,
    hasSignature: false,
    sentTo: [],
  };
  if (source.evidenceId) file.evidenceId = source.evidenceId;
  return file;
}

/**
 * A TIFF: refused page by page with one sentence (tiff.ts) before any work, then converted in
 * slices. A JPEG page is checked by the same decoder as other JPEGs before it is used.
 */
async function intakeTiff(source: IntakeSource, deps: IntakeDeps): Promise<IntakeResult> {
  const file = readTiff(source.bytes);
  await deps.onStage?.('converting');
  const options = { pause: deps.pause, checkJpeg: async (jpeg: Uint8Array) => void (await deps.imageSize(jpeg, 'image/jpeg')), maxOutputBytes: LIST_MAX_BYTES };
  if (file.asImage) {
    const image = await tiffToImage(source.bytes, file, options);
    if (image.mimeType === 'image/jpeg') await deps.imageSize(image.bytes, 'image/jpeg');
    return { status: 'ready', file: { ...baseFile(source, image.bytes), kind: 'image', mimeType: image.mimeType, pageCount: null, convertedFrom: 'tiff' } };
  }
  const pdf = await tiffToPdf(source.bytes, file, options);
  const info = await inspectPdf(pdf);
  if (info.encrypted || info.pageCount !== file.pages.length) {
    throw new PdfToolsError('bad-image', 'This TIFF could not be converted; open it in the program that made it, save it again and add it again.');
  }
  return {
    status: 'ready',
    notice: 'tiff-converted',
    file: { ...baseFile(source, pdf), kind: 'pdf', mimeType: 'application/pdf', pageCount: info.pageCount, hasSignature: false, convertedFrom: 'tiff', ...structureOf(info) },
  };
}

async function intakeImage(source: IntakeSource, format: ImageFormat, deps: IntakeDeps): Promise<IntakeResult> {
  if (format === 'tiff') return intakeTiff(source, deps);
  if (format === 'heic') {
    // No decoder ships with the application (TIFF-report.md 9; owner, 15 November 2026): say how to get a JPG.
    throw new PdfToolsError('bad-image', HEIC_REFUSAL);
  }
  // The size is checked from the header first, so an oversized image is never decoded.
  const header = readImageHeader(source.bytes);
  if (!header) throw new PdfToolsError('bad-image', 'This image could not be read. It may be damaged. Open it and save it again as JPG or PNG, then add it.');
  const problem = imageSizeProblem(header);
  if (problem) throw new PdfToolsError('bad-image', problem);
  const notice: IntakeNotice | undefined = header.animated ? 'first-frame' : undefined;
  const ready = (file: WorkingFile): IntakeResult => (notice ? { status: 'ready', file, notice } : { status: 'ready', file });

  const convertFrom = CONVERTIBLE[format];
  if (convertFrom) {
    await deps.onStage?.('converting');
    const png = await deps.decodeToPng(source.bytes, convertFrom);
    return ready({ ...baseFile(source, png), kind: 'image', mimeType: 'image/png', pageCount: null });
  }
  const mimeType = format === 'png' ? 'image/png' : 'image/jpeg';
  await deps.imageSize(source.bytes, mimeType);
  return ready({ ...baseFile(source, source.bytes), kind: 'image', mimeType, pageCount: null });
}

/** What Split, Delete pages and Merge may not carry, so the dialogs can say so before the run. */
const structureOf = (info: PdfInfo): Pick<WorkingFile, 'hasFormFields' | 'hasBookmarks' | 'hasPageLinks' | 'hasAttachments'> => ({
  hasFormFields: info.hasFormFields,
  hasBookmarks: info.hasBookmarks,
  hasPageLinks: info.hasPageLinks,
  hasAttachments: info.hasAttachments,
});

async function inspectOpened(bytes: Uint8Array): Promise<PdfInfo> {
  const info = await inspectPdf(bytes);
  if (info.encrypted || info.pageCount === null) {
    throw new PdfToolsError('unlock-failed', 'This file could not be unlocked. It may be damaged, or use a kind of protection that is not supported. Ask the sender for an unprotected copy.');
  }
  return info;
}

/**
 * Checks one file. Returns the WorkingFile to add, or 'skipped' when the user declined to give a
 * password. Throws PdfToolsError with a plain message when the file cannot be used.
 */
export async function prepareFile(source: IntakeSource, deps: IntakeDeps): Promise<IntakeResult> {
  const { bytes } = source;
  if (bytes.length === 0) throw new PdfToolsError('empty-file', 'This file is empty.');

  const format = imageFormatOf(bytes);
  if (format) return intakeImage(source, format, deps);
  if (!hasPdfHeader(bytes)) {
    throw new PdfToolsError('not-a-pdf', 'This file is not a PDF or a supported image (JPG, PNG, TIFF, WebP, BMP or GIF).');
  }

  await deps.onStage?.('checking');
  const info = await inspectPdf(bytes);
  if (!info.encrypted) {
    return {
      status: 'ready',
      file: { ...baseFile(source, bytes), kind: 'pdf', mimeType: 'application/pdf', pageCount: info.pageCount, hasSignature: info.hasSignature, ...structureOf(info) },
    };
  }

  // A file that opens with an empty password (usually one protected only against changes) is
  // added without asking; the copy kept has no protection.
  await deps.onStage?.('unlocking');
  const opened = await tryOpenWithoutPassword(bytes);
  const unlocked = opened ?? (await deps.askPassword(source.name, bytes));
  if (!unlocked) return { status: 'skipped' };
  const openedInfo = await inspectOpened(unlocked);
  const file: WorkingFile = {
    ...baseFile(source, unlocked),
    kind: 'pdf',
    mimeType: 'application/pdf',
    pageCount: openedInfo.pageCount,
    wasProtected: true,
    hasRestrictions: opened !== null,
    hasSignature: info.hasSignature || openedInfo.hasSignature,
    ...structureOf(openedInfo),
  };
  return opened ? { status: 'ready', file, notice: 'opened-without-password' } : { status: 'ready', file };
}
