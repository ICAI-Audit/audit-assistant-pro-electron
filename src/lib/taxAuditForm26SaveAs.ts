// Saving a Form No. 26 file (Word, PDF, working-paper pack, save file, the copy kept before a load, the "What
// changed" briefing) through the window's own "Save As" (FIX-T29). The File System Access picker answers only
// after the user has saved or cancelled, so the screen can say "saved" only once the file is written, and a load
// can wait for its copy. A download through a link (the earlier way) never tells the screen either.
//
// The picker must be asked for straight from the click: about five seconds later the window refuses it ("Must
// be handling a user gesture"), and a large audit takes longer than that to make. So the order is: ask where,
// then `ready` (save what waits), then `make` the file, then write it. Windows makes the chosen file — empty —
// at the moment it is picked (an existing one is emptied then), so a save that stops after the pick takes the
// empty file away again. There is no fallback to a download: when the picker is missing the caller says so.
import { fileStem } from '@/lib/taxAuditForm26SaveFile';
import type { Form26Values } from '@/lib/taxAuditForm26Values';

export type Form26SaveKind = 'docx' | 'pdf' | 'json';

export const FORM26_SAVE_TYPES: Record<Form26SaveKind, { description: string; mime: string; extension: string }> = {
  docx: { description: 'Word document', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', extension: '.docx' },
  pdf: { description: 'PDF document', mime: 'application/pdf', extension: '.pdf' },
  json: { description: 'Form No. 26 save file', mime: 'application/json', extension: '.json' },
};

/** The picker's memory: the save window opens in the folder last used for a Form No. 26 file. */
export const FORM26_SAVE_PICKER_ID = 'vera-form26';

/** One plain sentence per outcome that is not a save. */
export const FORM26_SAVE_SENTENCES = {
  cancelled: 'Not saved.',
  busy: 'Another save window is open. Finish with it, then try again.',
  unavailable: 'Files cannot be saved from this window.',
  writeFailed: 'The file could not be saved. Check that the folder can be written to and has free space, then try again.',
} as const;

export type Form26SaveResult =
  | { outcome: 'saved'; name: string }
  /** The user closed the save window: nothing made, nothing written. */
  | { outcome: 'cancelled' }
  /** Another save window is still open (the window allows one at a time): nothing made. */
  | { outcome: 'busy' }
  /** This window offers no save window (or refused it): nothing made, nothing downloaded. */
  | { outcome: 'unavailable' }
  /** `ready` said no (changes that cannot be saved): nothing made; the empty chosen file taken away. */
  | { outcome: 'stopped' }
  /** Making the file (`make`, or `ready` throwing) or writing it failed; an empty chosen file taken away. */
  | { outcome: 'failed'; stage: 'make' | 'write'; error: unknown };

type Writable = { write(data: Blob | string): Promise<void>; close(): Promise<void>; abort(): Promise<void> };
type FileHandle = { name: string; createWritable(): Promise<Writable>; getFile(): Promise<{ size: number }>; remove?: () => Promise<void> };
type Picker = (options: { suggestedName: string; id: string; types: { description: string; accept: Record<string, string[]> }[] }) => Promise<FileHandle>;

const pickerOf = (): Picker | undefined => {
  const candidate = (globalThis as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
  return typeof candidate === 'function' ? (candidate as Picker) : undefined;
};
const errorName = (error: unknown) => (error instanceof Error || (typeof DOMException !== 'undefined' && error instanceof DOMException) ? (error as Error).name : '');

/** Takes the chosen file away when it is still empty (a file holding anything is never removed). */
async function removeIfEmpty(handle: FileHandle): Promise<void> {
  try {
    if ((await handle.getFile()).size !== 0 || typeof handle.remove !== 'function') return;
    await handle.remove();
  } catch {
    // nothing more can be done
  }
}

/**
 * Saves one file through the save window. Call it straight from the click, before awaiting anything else.
 * Never throws.
 */
export async function saveForm26As(input: {
  name: string;
  kind: Form26SaveKind;
  /** Called once the user has chosen where: the file is being made now. */
  onPicked?(): void;
  /** Runs after the pick and before `make`; false stops the save (e.g. changes that cannot be saved). */
  ready?(): Promise<boolean>;
  make(): Promise<Blob | string>;
}): Promise<Form26SaveResult> {
  const picker = pickerOf();
  if (!picker) return { outcome: 'unavailable' };
  const type = FORM26_SAVE_TYPES[input.kind];
  let handle: FileHandle;
  try {
    handle = await picker({ suggestedName: input.name, id: FORM26_SAVE_PICKER_ID, types: [{ description: type.description, accept: { [type.mime]: [type.extension] } }] });
  } catch (error) {
    const name = errorName(error);
    if (name === 'AbortError') return { outcome: 'cancelled' };
    if (name === 'NotAllowedError') return { outcome: 'busy' };
    return { outcome: 'unavailable' };
  }
  input.onPicked?.();
  let data: Blob | string;
  try {
    if (input.ready && !(await input.ready())) {
      await removeIfEmpty(handle);
      return { outcome: 'stopped' };
    }
    data = await input.make();
  } catch (error) {
    await removeIfEmpty(handle);
    return { outcome: 'failed', stage: 'make', error };
  }
  let writable: Writable | null = null;
  try {
    writable = await handle.createWritable();
    await writable.write(data);
    await writable.close();
  } catch (error) {
    // Nothing reaches the chosen file until close() succeeds; abort drops the partial copy.
    await writable?.abort().catch(() => undefined);
    await removeIfEmpty(handle);
    return { outcome: 'failed', stage: 'write', error };
  }
  return { outcome: 'saved', name: handle.name };
}

export type Form26DownloadName = 'word' | 'pdf' | 'pack' | 'json' | 'before-import';

/** The name proposed in the save window, from the answers alone (the file is made only after the pick). */
export function form26DownloadName(what: Form26DownloadName, values: Form26Values): string {
  const stem = fileStem(values);
  switch (what) {
    case 'word':
      return `${stem}.docx`;
    case 'pdf':
      return `${stem}.pdf`;
    case 'pack':
      return `${stem}_working-papers.docx`;
    case 'json':
      return `${stem}.json`;
    case 'before-import':
      return `${stem}_before-import.json`;
  }
}

/** The status line (and whether a toast repeats it) after a download: "saved" only for a written file. */
export function form26SaveLine(
  result: Form26SaveResult,
  texts: { done: string; makeFailed: string; notReady: string },
): { text: string; failed: boolean; toast: boolean } {
  switch (result.outcome) {
    case 'saved':
      return { text: texts.done, failed: false, toast: true };
    case 'cancelled':
      // The user's own choice: a quiet word in the line, no toast.
      return { text: FORM26_SAVE_SENTENCES.cancelled, failed: false, toast: false };
    case 'busy':
      return { text: FORM26_SAVE_SENTENCES.busy, failed: true, toast: true };
    case 'unavailable':
      return { text: FORM26_SAVE_SENTENCES.unavailable, failed: true, toast: true };
    case 'stopped':
      return { text: texts.notReady, failed: true, toast: true };
    case 'failed':
      return { text: result.stage === 'make' ? texts.makeFailed : FORM26_SAVE_SENTENCES.writeFailed, failed: true, toast: true };
  }
}

/** Why a load did not go ahead after its copy of the present answers was asked for; null when the copy is saved. */
export function form26BeforeImportLine(result: Form26SaveResult, notReady: string): string | null {
  switch (result.outcome) {
    case 'saved':
      return null;
    case 'stopped':
      return notReady;
    case 'failed':
      return 'Nothing was changed: the copy of the present answers could not be saved.';
    default:
      return 'Nothing was changed: the copy of the present answers was not saved.';
  }
}
