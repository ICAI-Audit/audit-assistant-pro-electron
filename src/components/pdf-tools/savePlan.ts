// What happens on screen after a save to the computer: which rows are marked "Saved to computer"
// and what the toast says. Plain functions, so the wording rules are tested without a browser.
import type { SaveOutcome } from './saveToComputer';

export interface SaveReport {
  mode: 'one' | 'folder' | 'zip';
  /** 'partial': a folder save stopped part-way; 'failed': nothing was saved. */
  outcome: SaveOutcome | 'partial' | 'failed';
  /** In list order, with the cleaned name each was meant to be saved under. */
  files: { id: string; intendedName: string; wasProtected: boolean }[];
  /** Names actually written by a folder save, in the same order. */
  written: string[];
  /** False when the user left the engagement (or signed out) before the save finished. */
  sameSession: boolean;
  errorMessage?: string;
}

export interface SaveToast {
  tone: 'success' | 'info' | 'error';
  title: string;
  description?: string;
}

/** Names that differ from the name intended for them, other than by case (Windows ignores case). */
export function renamedNames(intended: string[], written: string[]): string[] {
  return written.filter((name, i) => intended[i] === undefined || name.toLowerCase() !== intended[i].toLowerCase());
}

const UNPROTECTED_NOTE = ' Files that were password-protected are saved without a password.';
const plural = (n: number) => `${n} ${n === 1 ? 'file' : 'files'}`;

/**
 * The folder window ended without a folder. That is a cancel, or the user chose a system folder the
 * application refuses (Windows, Program Files, the profile root, AppData; the main process accepts
 * Desktop, Documents and Downloads); the screen cannot tell which. A quiet note, never an error.
 */
export const FOLDER_NOT_CHOSEN: SaveToast = {
  tone: 'info',
  title: 'Nothing was saved',
  description: 'No folder was chosen. Windows and program folders cannot be used for saving; choose another folder, such as Desktop or Documents.',
};

/** A save or folder window was still open (the browser refuses a second one); nothing was saved. */
export const SAVE_WINDOW_OPEN: SaveToast = {
  tone: 'info',
  title: 'A save window is already open',
  description: 'Finish or close it, then try again. If no save window is open, restart the application.',
};

export function planSaveResult(report: SaveReport): { markIds: string[]; toast: SaveToast | null } {
  const { mode, outcome, files, written, sameSession, errorMessage } = report;
  // Nothing was saved. A folder window that ended without a folder gets its note from watchSave.
  if (outcome === 'cancelled') return { markIds: [], toast: null };
  if (outcome === 'busy') return { markIds: [], toast: SAVE_WINDOW_OPEN };
  const note = files.some((f) => f.wasProtected) ? UNPROTECTED_NOTE : '';

  // The rows now belong to another engagement or user: mark nothing, name nothing.
  if (!sameSession) {
    const toast: Record<Exclude<SaveReport['outcome'], 'cancelled' | 'busy'>, SaveToast> = {
      saved: { tone: 'success', title: 'Saved' },
      downloaded: { tone: 'info', title: 'Download started' },
      partial: { tone: 'error', title: 'Some files were not saved' },
      failed: { tone: 'error', title: 'Not saved' },
    };
    return { markIds: [], toast: toast[outcome] };
  }

  switch (outcome) {
    case 'saved': {
      const markIds = files.map((f) => f.id);
      if (mode === 'one') return { markIds, toast: { tone: 'success', title: 'Saved to your computer', description: `${files[0].intendedName}${note}` } };
      if (mode === 'zip') return { markIds, toast: { tone: 'success', title: 'Saved as one zip', description: `${plural(files.length)} in one zip file.${note}` } };
      const renamed = renamedNames(
        files.map((f) => f.intendedName),
        written,
      );
      const description =
        renamed.length > 0
          ? `Names already in the folder were kept; new copies were numbered, for example "${renamed[0]}".`
          : 'Each file was saved into the folder you chose.';
      return { markIds, toast: { tone: 'success', title: `Saved ${plural(files.length)}`, description: description + note } };
    }
    // The fallback when no save dialog is available: Electron may show its own Save As, which the
    // user can cancel or point elsewhere, and its completion cannot be seen. The rows are marked
    // "Sent to download" and the record says the completion is not confirmed.
    case 'downloaded': {
      const what = mode === 'one' ? files[0].intendedName : mode === 'zip' ? `${plural(files.length)} in one zip file` : plural(files.length);
      return {
        markIds: files.map((f) => f.id),
        toast: {
          tone: 'info',
          title: 'Download started',
          description: `${what}. If a window opens, choose where to keep it; PDF Tools cannot confirm that the download finished.${note}`,
        },
      };
    }
    case 'partial': {
      const saved = files.slice(0, written.length);
      const notSaved = files.slice(written.length);
      const parts = [
        saved.length > 0 ? `Saved: ${written.join(', ')}.` : 'Nothing was saved.',
        `Not saved: ${notSaved.map((f) => f.intendedName).join(', ')}.`,
        errorMessage ?? '',
      ];
      return { markIds: saved.map((f) => f.id), toast: { tone: 'error', title: 'Some files were not saved', description: parts.join(' ').trim() } };
    }
    case 'failed':
      return { markIds: [], toast: { tone: 'error', title: 'Not saved', description: errorMessage ?? 'The files could not be saved. Try again.' } };
  }
}

/** How long a save or folder window may stay unanswered before Save to computer can be pressed again. */
export const PICKER_STALL_MS = 10_000;
/** After the application window gets the focus back, how long to wait for the window's answer before saying it ended without a folder. */
export const FOCUS_GRACE_MS = 1_500;

export interface SaveWatch {
  /** A location was chosen: the files are being written. */
  picked(): void;
  /** The save ended, however it ended. */
  settled(outcome: SaveReport['outcome']): void;
}

/**
 * Watches one click's save while its save or folder window is open.
 * - "Saving…" holds the Save button from the click until the save ends, and again while writing.
 * - If no window has answered after `stallMs`, the button is freed (Electron can leave a refused
 *   folder choice unanswered); nothing is said yet, as the window may still be open.
 * - For a folder save, the quiet note (FOLDER_NOT_CHOSEN) is shown at most once: when the folder
 *   window ends without a folder, or, after the button was freed, once the application window has
 *   the focus (already, or again later) and still nothing has answered `graceMs` later. Nothing
 *   listens for the focus after the note was shown or the save went on or ended.
 * - A folder answer that arrives after that note withdraws it.
 */
export function watchSave(options: {
  folder: boolean;
  stallMs: number;
  graceMs: number;
  hold: (saving: boolean) => void;
  notChosen: () => void;
  /** Takes the note away again (a folder was chosen after all). */
  withdrawNote?: () => void;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (id: unknown) => void;
  /** Whether the application window has the focus now. */
  hasFocus?: () => boolean;
  /** Calls the listener when the application window gets the focus; returns how to stop. */
  onWindowFocus?: (listener: () => void) => () => void;
}): SaveWatch {
  const setTimer = options.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = options.clearTimer ?? ((id: unknown) => clearTimeout(id as ReturnType<typeof setTimeout>));
  let state: 'waiting' | 'freed' | 'writing' | 'ended' = 'waiting';
  let noted = false;
  let withdrawn = false;
  let grace: unknown = null;
  let stopListening: (() => void) | null = null;
  const stop = () => {
    if (stall !== null) clearTimer(stall);
    if (grace !== null) clearTimer(grace);
    stall = null;
    grace = null;
    stopListening?.();
    stopListening = null;
  };
  const note = () => {
    if (noted) return;
    noted = true;
    stop();
    options.notChosen();
  };
  const withdraw = () => {
    if (!noted || withdrawn) return;
    withdrawn = true;
    options.withdrawNote?.();
  };
  const onFocus = () => {
    if (state !== 'freed' || grace !== null || noted) return;
    grace = setTimer(() => {
      grace = null;
      if (state === 'freed') note();
    }, options.graceMs);
  };
  let stall: unknown = setTimer(() => {
    stall = null;
    if (state !== 'waiting') return;
    state = 'freed';
    options.hold(false);
    if (!options.folder) return;
    // The folder window may have closed unanswered before now, with the focus already back.
    if (options.onWindowFocus) stopListening = options.onWindowFocus(onFocus);
    if (options.hasFocus?.()) onFocus();
  }, options.stallMs);
  options.hold(true);
  return {
    picked() {
      if (state === 'ended') return;
      stop();
      withdraw();
      state = 'writing';
      options.hold(true);
    },
    settled(outcome) {
      if (state === 'ended') return;
      stop();
      state = 'ended';
      options.hold(false);
      if (outcome === 'saved' || outcome === 'partial') withdraw();
      if (options.folder && outcome === 'cancelled') note();
    },
  };
}
