// Saving PDF Tools results to the user's computer.
//
// The browser's save-file and folder pickers are used when present: they report cancellation and
// completion, and a folder save never overwrites a file. When a picker is missing, or fails for
// any reason other than the user cancelling or another save window being open ('busy'), the file
// is handed to an ordinary download instead (Electron then shows its own save dialog). A
// download's completion cannot be observed, so it reports 'downloaded', not 'saved'.
//
// The pickers need the click that started the save: call these functions directly from the
// click handler, before awaiting anything else. They are looked up on the global object at call
// time so that tests can replace them.
import { cleanFileName } from '@/lib/pdf-tools/fileNames';
import { PdfToolsError } from '@/lib/pdf-tools/types';

/** 'busy': a save or folder window was already open (the browser refuses a second); nothing was saved. */
export type SaveOutcome = 'saved' | 'cancelled' | 'downloaded' | 'busy';

export interface SaveFile {
  name: string;
  bytes: Uint8Array;
  mimeType?: string;
}

/** A folder save that stopped part-way. `written` holds the names saved before the failure, in input order. */
export class SaveFailedError extends PdfToolsError {
  constructor(message: string, public written: string[]) {
    super('save-failed', message);
    this.name = 'SaveFailedError';
  }
}

interface FilePickerAcceptType {
  description?: string;
  accept: Record<string, string[]>;
}

export interface DirectoryLike {
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileSystemFileHandle>;
}

interface PickerHost {
  showSaveFilePicker?: (options?: {
    suggestedName?: string;
    types?: FilePickerAcceptType[];
    excludeAcceptAllOption?: boolean;
    id?: string;
    startIn?: string;
  }) => Promise<FileSystemFileHandle>;
  showDirectoryPicker?: (options?: { id?: string; mode?: 'read' | 'readwrite'; startIn?: string }) => Promise<DirectoryLike>;
}

const PICKER_ID = 'vera-pdf-tools';
const DOWNLOAD_GAP_MS = 250;
const REVOKE_AFTER_MS = 60_000;
const MAX_NAME_LENGTH = 120;

const FILE_TYPES: Record<string, { mime: string; description: string }> = {
  pdf: { mime: 'application/pdf', description: 'PDF document' },
  png: { mime: 'image/png', description: 'PNG image' },
  jpg: { mime: 'image/jpeg', description: 'JPEG image' },
  zip: { mime: 'application/zip', description: 'Zip archive' },
  xlsx: { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', description: 'Excel workbook' },
  docx: { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', description: 'Word document' },
};
const EXTENSION_ALIASES: Record<string, string> = { jpeg: 'jpg' };

const pickers = (): PickerHost => globalThis as unknown as PickerHost;

const isAbort = (error: unknown): boolean => error instanceof Error && error.name === 'AbortError';
// "File picker already active.": a window of an earlier save is still open, or never answered.
const isBusy = (error: unknown): boolean => error instanceof Error && error.name === 'NotAllowedError';

function ownExtension(name: string): string | null {
  const match = /\.([A-Za-z0-9]{1,5})$/.exec(name.trim());
  return match ? match[1].toLowerCase() : null;
}

function sniffExtension(bytes: Uint8Array): string | null {
  const starts = (sig: number[]) => sig.every((b, i) => bytes[i] === b);
  if (starts([0x25, 0x50, 0x44, 0x46])) return 'pdf';
  if (starts([0x89, 0x50, 0x4e, 0x47])) return 'png';
  if (starts([0xff, 0xd8, 0xff])) return 'jpg';
  return null;
}

/** The extension a file is saved with: from its type, else its own name, else its content. */
export function extensionFor(file: SaveFile): string {
  const own = ownExtension(file.name);
  const fromMime = Object.entries(FILE_TYPES).find(([, t]) => t.mime === file.mimeType)?.[0];
  if (fromMime) return own && (EXTENSION_ALIASES[own] ?? own) === fromMime ? own : fromMime;
  if (own) return own;
  return sniffExtension(file.bytes) ?? 'bin';
}

// Extensions that name a file type. One of these that disagrees with the file's real type is
// replaced ("scan.gif" saved as PNG becomes "scan.png", not "scan.gif.png"); other dots are kept.
const KNOWN_EXTENSIONS = new Set(['pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tif', 'tiff', 'heic', 'zip', 'xlsx', 'docx']);

const sameType = (a: string, b: string) => (EXTENSION_ALIASES[a] ?? a) === (EXTENSION_ALIASES[b] ?? b);

/** The cleaned name a file is saved under. */
export function cleanedName(file: SaveFile): string {
  const extension = extensionFor(file);
  const own = ownExtension(file.name);
  const base = own && KNOWN_EXTENSIONS.has(own) && !sameType(own, extension) ? file.name.trim().slice(0, -(own.length + 1)) : file.name;
  return cleanFileName(base, extension);
}

type RemovableHandle = FileSystemFileHandle & { remove?: () => Promise<void> };

/** Takes away a file this code created itself (a folder save's new file) after a failed write. */
async function removeQuietly(handle: FileSystemFileHandle): Promise<void> {
  try {
    await (handle as RemovableHandle).remove?.();
  } catch {
    // nothing more can be done
  }
}

/**
 * After a failed write to a file the user chose: Chromium may have created it empty, and then it
 * is taken away. A file that holds anything (for example the one the user chose to replace) is
 * never removed. Returns whether a file was removed.
 */
async function removeIfEmpty(handle: FileSystemFileHandle): Promise<boolean> {
  try {
    if ((await handle.getFile()).size !== 0) return false;
    const remove = (handle as RemovableHandle).remove;
    if (typeof remove !== 'function') return false;
    await remove.call(handle);
    return true;
  } catch {
    return false;
  }
}

function typeFor(extension: string): { mime: string; description: string } {
  return FILE_TYPES[EXTENSION_ALIASES[extension] ?? extension] ?? { mime: 'application/octet-stream', description: 'File' };
}

/** `name.pdf` → `name (n).pdf`, kept within the file-name length limit. */
export function numberedName(name: string, n: number): string {
  if (n <= 1) return name;
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot) : '';
  const suffix = ` (${n})`;
  const room = Math.max(1, MAX_NAME_LENGTH - extension.length - suffix.length);
  const cut = stem.slice(0, room).replace(/[\uD800-\uDBFF]$/, '').replace(/[. ]+$/, '');
  return `${cut || 'document'}${suffix}${extension}`;
}

async function exists(dir: DirectoryLike, name: string): Promise<boolean> {
  try {
    await dir.getFileHandle(name);
    return true;
  } catch (error) {
    const kind = error instanceof Error ? error.name : '';
    if (kind === 'NotFoundError') return false;
    if (kind === 'TypeMismatchError') return true; // a folder of that name
    throw error;
  }
}

/** The first of `name`, `name (2)`, `name (3)`… that does not exist in the folder. */
export async function freeNameIn(dir: DirectoryLike, name: string): Promise<string> {
  for (let n = 1; n <= 9999; n++) {
    const candidate = numberedName(name, n);
    if (!(await exists(dir, candidate))) return candidate;
  }
  throw new PdfToolsError('save-failed', `The folder already holds too many files named like "${name}".`);
}

/** Gives repeated names within one batch a number, ignoring case as Windows does. */
function distinctNames(names: string[]): string[] {
  const used = new Set<string>();
  return names.map((name) => {
    let n = 1;
    let candidate = name;
    while (used.has(candidate.toLowerCase())) candidate = numberedName(name, ++n);
    used.add(candidate.toLowerCase());
    return candidate;
  });
}

async function writeTo(handle: FileSystemFileHandle, bytes: Uint8Array): Promise<void> {
  const writable = await handle.createWritable();
  try {
    await writable.write(bytes as unknown as BufferSource);
    await writable.close();
  } catch (error) {
    // Nothing reaches the chosen file until close() succeeds; abort drops the partial copy.
    await writable.abort().catch(() => undefined);
    throw error;
  }
}

function writeFailed(name: string): string {
  return `"${name}" could not be saved. Check that the location can be written to and has free space, then try again.`;
}

function download(name: string, bytes: Uint8Array, mime: string): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.rel = 'noopener';
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
}

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Asks where to save one file: a handle, 'cancelled', 'busy', or null when the picker is unavailable. */
async function pickFile(name: string, extension: string): Promise<FileSystemFileHandle | 'cancelled' | 'busy' | null> {
  const picker = pickers().showSaveFilePicker;
  if (typeof picker !== 'function') return null;
  const type = typeFor(extension);
  try {
    return await picker({
      suggestedName: name,
      id: PICKER_ID,
      types: [{ description: type.description, accept: { [type.mime]: [`.${extension}`] } }],
    });
  } catch (error) {
    if (isAbort(error)) return 'cancelled';
    // Never a download: that window may still be open, and the user did not ask for a download.
    if (isBusy(error)) return 'busy';
    return null;
  }
}

export interface SaveOptions {
  /** Called once the location is known (or a download is about to start): the writing begins. */
  onPicked?: () => void;
}

async function saveProduced(name: string, extension: string, produce: () => Promise<Uint8Array>, options: SaveOptions): Promise<SaveOutcome> {
  const target = await pickFile(name, extension);
  if (target === 'cancelled' || target === 'busy') return target;
  options.onPicked?.();
  const bytes = await produce();
  if (target === null) {
    download(name, bytes, typeFor(extension).mime);
    return 'downloaded';
  }
  try {
    await writeTo(target, bytes);
  } catch {
    const advice = 'Check that the location can be written to and has free space, then try again.';
    throw new PdfToolsError(
      'save-failed',
      (await removeIfEmpty(target))
        ? `The file could not be written. An empty file was removed. ${advice}`
        : `The file could not be written and may be incomplete: ${name}. ${advice}`,
    );
  }
  return 'saved';
}

/**
 * Saves one file through a save dialog. The name is cleaned and keeps the file's own type: a PDF
 * is saved as .pdf, an image as its image type. Throws PdfToolsError 'save-failed' when writing to
 * the chosen file fails.
 */
export function saveOne(file: { name: string; bytes: Uint8Array; mimeType: string }, options: SaveOptions = {}): Promise<SaveOutcome> {
  return saveProduced(cleanedName(file), extensionFor(file), async () => file.bytes, options);
}

/**
 * Saves each file into one folder the user picks, never overwriting: an existing name gets a
 * number, as in "name (2).pdf". `written` lists the names used, in input order. Throws
 * SaveFailedError (with the names already written) if a write fails part-way.
 */
export async function saveManyToFolder(files: SaveFile[], options: SaveOptions = {}): Promise<{ outcome: SaveOutcome; written: string[] }> {
  const names = files.map(cleanedName);
  const picker = pickers().showDirectoryPicker;
  let dir: DirectoryLike | null = null;
  if (typeof picker === 'function') {
    try {
      dir = await picker({ id: PICKER_ID, mode: 'readwrite' });
    } catch (error) {
      // A cancel, or a system folder the main process refuses (see electron/main.cjs).
      if (isAbort(error)) return { outcome: 'cancelled', written: [] };
      if (isBusy(error)) return { outcome: 'busy', written: [] };
    }
  }
  options.onPicked?.();

  if (!dir) {
    const distinct = distinctNames(names);
    for (const [i, file] of files.entries()) {
      if (i > 0) await pause(DOWNLOAD_GAP_MS);
      download(distinct[i], file.bytes, typeFor(extensionFor(file)).mime);
    }
    return { outcome: 'downloaded', written: distinct };
  }

  const written: string[] = [];
  for (const [i, file] of files.entries()) {
    let name = names[i];
    let handle: FileSystemFileHandle | null = null;
    try {
      name = await freeNameIn(dir, names[i]);
      handle = await dir.getFileHandle(name, { create: true });
      await writeTo(handle, file.bytes);
    } catch {
      if (handle) await removeQuietly(handle);
      const done = written.length === 0 ? 'Nothing was saved.' : `${written.length} of ${files.length} files were saved.`;
      throw new SaveFailedError(`${writeFailed(name)} ${done}`, written);
    }
    written.push(name);
  }
  return { outcome: 'saved', written };
}

/**
 * Saves the files as one zip, for emailing. Names inside the zip are cleaned and made distinct.
 * The location is asked for first, while the click still counts, and the zip is built after.
 */
export function saveAsZip(zipName: string, files: SaveFile[], options: SaveOptions = {}): Promise<SaveOutcome> {
  return saveProduced(
    cleanFileName(zipName, 'zip'),
    'zip',
    async () => {
      const { default: JSZip } = await import('jszip');
      const zip = new JSZip();
      const names = distinctNames(files.map(cleanedName));
      files.forEach((file, i) => zip.file(names[i], file.bytes));
      return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } });
    },
    options,
  );
}
