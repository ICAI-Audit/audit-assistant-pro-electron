// The viewer's confidentiality and focus rules, as plain functions (unit-tested; no DOM here).
import { PdfToolsError, type WorkingFile } from '@/lib/pdf-tools/types';
import { RenderTimeoutError } from '../renderQueue';

/** Why the viewer closed: the user's own action, a change of engagement, user or session, or its file leaving the list. */
export type CloseReason = 'user' | 'context' | 'file-gone';

export interface ViewerScope {
  contextKey: string | null;
  session: number;
}

/**
 * Whether the viewer, opened on `opened.fileId` in `opened`'s list, must close now. It shows only
 * files of the current working list (as the guarded hook returns it): another engagement, user or
 * session closes it, and so does its file leaving the list.
 */
export function viewerCloseReason(opened: ViewerScope & { fileId: string }, now: ViewerScope & { fileIds: readonly string[] }): CloseReason | null {
  if (opened.contextKey === null || opened.session < 0) return 'context';
  if (now.contextKey !== opened.contextKey || now.session !== opened.session) return 'context';
  return now.fileIds.includes(opened.fileId) ? null : 'file-gone';
}

export interface Focusable {
  isConnected: boolean;
  disabled?: boolean;
  focus(options?: FocusOptions): void;
}

/**
 * Where focus goes when the viewer closes: back to the control that opened it, else the next
 * candidate still on the screen. Not after a change of engagement or user, or when its file left
 * the list: then the screen behind has changed, and the header's engagement menu may still be
 * closing; its focus must not be fought (as listFocus.ts).
 */
export function focusTargetAfterClose(reason: CloseReason, candidates: readonly (Focusable | null | undefined)[]): Focusable | null {
  if (reason !== 'user') return null;
  return candidates.find((c): c is Focusable => Boolean(c && c.isConnected && !c.disabled)) ?? null;
}

/**
 * The bytes the viewer draws: the file itself, or for a result protected by PDF Tools the
 * unprotected copy held in memory (design 5.18); never the encrypted bytes.
 */
export function viewBytes(file: Pick<WorkingFile, 'bytes' | 'previewBytes' | 'protectedOutput'>): Uint8Array | null {
  if (file.protectedOutput) return file.previewBytes ?? null;
  return file.bytes;
}

const DAMAGED = 'This page could not be drawn. The file may be damaged.';

/**
 * What the viewer says when a page cannot be drawn: one plain sentence per cause. Never the file's
 * name, and never a library's or the file's own text, which can quote either.
 */
export function viewerErrorMessage(error: unknown): string {
  if (error instanceof RenderTimeoutError) return 'Drawing this page took too long. Try again.';
  if (!(error instanceof PdfToolsError)) return DAMAGED;
  switch (error.code) {
    case 'render-unavailable':
      return 'Page previews could not be started. Restart the application and try again.';
    case 'out-of-memory':
    case 'image-encode-failed':
      return 'There was not enough memory to draw this page at this zoom. Try a smaller zoom.';
    case 'renderer-restarted':
      return 'The page renderer had to restart. Try again.';
    case 'open-timeout':
      return 'The file took too long to open. Try again.';
    default:
      return DAMAGED;
  }
}

/** A failure for want of memory: its Try again lets every kept drawing and parsed page go first. */
export function isLowMemory(error: unknown): boolean {
  return error instanceof PdfToolsError && (error.code === 'out-of-memory' || error.code === 'image-encode-failed');
}

// Anti-aliasing and colour profiles leave a level or two of noise on a white page.
const BLANK_LEVEL = 248;

/**
 * Whether a drawing has nothing on it: every sampled pixel (RGBA) is white within a few levels.
 * pdf.js draws what it can of a damaged page and says nothing, so a blank drawing is the one sign
 * the viewer has (lane V review, item 8). An empty sample is not blank: nothing was looked at.
 */
export function looksBlank(rgba: ArrayLike<number>): boolean {
  if (rgba.length < 4) return false;
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    if (rgba[i] < BLANK_LEVEL || rgba[i + 1] < BLANK_LEVEL || rgba[i + 2] < BLANK_LEVEL) return false;
  }
  return true;
}

export interface DrawingNote {
  kind: 'blank' | 'reduced';
  text: string;
}

/**
 * The quiet notes under the drawing shown. A blank page is a normal page (a scan's reverse side):
 * it is named, not treated as a fault, and offers nothing to retry (re-review 1); Try again belongs
 * to a page that failed to draw.
 */
export function drawingNotes(drawn: { blank?: boolean; reduced?: boolean } | null): DrawingNote[] {
  if (!drawn) return [];
  const notes: DrawingNote[] = [];
  if (drawn.blank) notes.push({ kind: 'blank', text: 'Blank page' });
  if (drawn.reduced) notes.push({ kind: 'reduced', text: 'Shown at reduced sharpness at this zoom' });
  return notes;
}

export interface ViewAvailability {
  enabled: boolean;
  /** Why it is not offered, for its tooltip and screen readers; null when it is. */
  reason: string | null;
}

/** Whether a page panel offers the larger view: not while a tool runs (the panel is locked then). */
export function viewAvailability(running: boolean): ViewAvailability {
  return running ? { enabled: false, reason: 'Wait for the tool to finish to view pages larger.' } : { enabled: true, reason: null };
}

export interface ChooseWords {
  off: string;
  on: string;
  /** The tooltip of the choice once made: what a click does now. */
  onHint: string;
}

/**
 * The words of the viewer's page choice, as the page panel says them (UX audit C5.4): pages are
 * chosen for a tool, or marked for removal by Delete pages.
 */
export function chooseWords(tone: 'primary' | 'destructive'): ChooseWords {
  return tone === 'destructive'
    ? { off: 'Mark for removal', on: 'Marked for removal', onHint: 'Click to keep this page' }
    : { off: 'Choose this page', on: 'Chosen', onHint: 'Click to unchoose this page' };
}
