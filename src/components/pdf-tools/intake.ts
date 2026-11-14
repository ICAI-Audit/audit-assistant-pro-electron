// Checks one incoming file and turns it into a WorkingFile (spec section 5.1): a PDF must parse
// and have a page; a protected PDF is opened without a password when it allows that, otherwise
// the user is asked for it; an image must decode, and WebP, BMP and GIF are converted to PNG so
// that Images to PDF can place them. The browser-only steps are passed in, so this runs in tests.
import { sniffImageFormat } from '@/lib/pdf-tools/imagesToPdf';
import { inspectPdf, type PdfInfo } from '@/lib/pdf-tools/inspect';
import { tryOpenWithoutPassword } from '@/lib/pdf-tools/unlock';
import { newFileId } from '@/lib/pdf-tools/workingList';
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
}

export interface IntakeSource {
  name: string;
  bytes: Uint8Array;
  origin: FileOrigin;
  evidenceId?: string;
}

/**
 * 'opened-without-password': an encrypted PDF that opened with an empty password (protection
 * removed in the copy kept); 'first-frame': an animated image of which only the first frame is kept.
 */
export type IntakeNotice = 'opened-without-password' | 'first-frame';

export type IntakeResult =
  | { status: 'ready'; file: WorkingFile; notice?: IntakeNotice }
  | { status: 'skipped' };

type ImageFormat = 'jpeg' | 'png' | 'gif' | 'webp' | 'bmp' | 'tiff' | 'heic';

const CONVERTIBLE: Partial<Record<ImageFormat, string>> = { gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp' };

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
  if (head.startsWith('II*\0') || head.startsWith('MM\0*')) return 'tiff';
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

async function intakeImage(source: IntakeSource, format: ImageFormat, deps: IntakeDeps): Promise<IntakeResult> {
  if (format === 'tiff' || format === 'heic') {
    throw new PdfToolsError(
      'bad-image',
      `${format === 'tiff' ? 'TIFF' : 'HEIC'} images cannot be used. Save the image as JPG or PNG and add it again.`,
    );
  }
  // The size is checked from the header first, so an oversized image is never decoded.
  const header = readImageHeader(source.bytes);
  if (!header) throw new PdfToolsError('bad-image', 'This image could not be read. It may be damaged.');
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
const structureOf = (info: PdfInfo): Pick<WorkingFile, 'hasFormFields' | 'hasBookmarks' | 'hasPageLinks'> => ({
  hasFormFields: info.hasFormFields,
  hasBookmarks: info.hasBookmarks,
  hasPageLinks: info.hasPageLinks,
});

async function inspectOpened(bytes: Uint8Array): Promise<PdfInfo> {
  const info = await inspectPdf(bytes);
  if (info.encrypted || info.pageCount === null) {
    throw new PdfToolsError('unlock-failed', 'This file could not be unlocked. It may be damaged, or use a kind of protection that is not supported.');
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
    throw new PdfToolsError('not-a-pdf', 'This file is not a PDF or a supported image (JPG, PNG, WebP, BMP or GIF).');
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
