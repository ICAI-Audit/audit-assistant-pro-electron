// The page viewer's keyboard and Ctrl + wheel map (design section 4). No DOM here.

export type ViewerKeyAction = 'zoom-in' | 'zoom-out' | 'fit-page' | 'next' | 'prev' | 'first' | 'last' | 'find' | 'escape' | 'hold';

export interface KeyInput {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  /** Focus is in the page number box. */
  inTextField: boolean;
  /** The page fits the width of the view (no sideways scrolling): Left and Right then change page. */
  fitsWidth: boolean;
  /** A PDF (an image has no pages to move between). */
  hasPages: boolean;
  /** An input method is composing (KeyboardEvent.isComposing): Escape cancels the composition, not the viewer. */
  composing?: boolean;
}

/**
 * What a key does in the viewer, or null to leave it to the browser (scrolling, Tab, Escape, typing).
 * 'hold' is a key the viewer does not use but must keep from VERA Tools underneath, which changes
 * tab on Alt + arrows and Ctrl + a number: it is stopped and nothing else happens. Ctrl + F opens the
 * viewer's own search, from anywhere in the viewer (the page number box and the search box included).
 * Escape is the viewer's own too (fix round 1): it closes the search box if open, else the viewer,
 * wherever the focus is, without going through the dialog library's stack of layers (where a tooltip
 * or another layer above the viewer would take it).
 */
export function viewerKeyAction(k: KeyInput): ViewerKeyAction | null {
  if (k.key === 'Escape') return k.composing || k.ctrlKey || k.metaKey || k.altKey ? null : 'escape';
  const command = k.ctrlKey || k.metaKey;
  if (command && !k.altKey) {
    if (k.key === '+' || k.key === '=' || k.key === 'Add') return 'zoom-in';
    if (k.key === '-' || k.key === '_' || k.key === 'Subtract') return 'zoom-out';
    if (k.key === '0') return 'fit-page';
    if (k.key === 'f' || k.key === 'F') return 'find';
    if (/^[1-9]$/.test(k.key)) return 'hold';
    return null;
  }
  if (k.altKey) return /^(Arrow(Up|Down|Left|Right)|Page(Up|Down)|Home|End)$/.test(k.key) ? 'hold' : null;
  if (command || !k.hasPages) return null;
  switch (k.key) {
    case 'PageDown':
      return 'next';
    case 'PageUp':
      return 'prev';
    case 'Home':
      return k.inTextField ? null : 'first';
    case 'End':
      return k.inTextField ? null : 'last';
    case 'ArrowRight':
      return !k.inTextField && k.fitsWidth ? 'next' : null;
    case 'ArrowLeft':
      return !k.inTextField && k.fitsWidth ? 'prev' : null;
    default:
      return null;
  }
}

export interface WheelInput {
  ctrlKey: boolean;
  metaKey: boolean;
  deltaY: number;
  /** 0 pixels, 1 lines, 2 pages (WheelEvent.deltaMode). */
  deltaMode: number;
}

/** Wheel movement (in pixels, towards zooming in) that makes one zoom step: about one mouse-wheel notch. */
export const WHEEL_STEP = 50;
const LINE_PX = 100 / 3;
const PAGE_PX = 800;

/**
 * Ctrl + wheel: a zoom step once enough movement has added up (a trackpad pinch sends many small
 * movements). `rest` is what has been counted so far, positive towards zooming in.
 */
export function wheelZoom(rest: number, e: WheelInput): { direction: 1 | -1 | null; rest: number } {
  if (!e.ctrlKey && !e.metaKey) return { direction: null, rest: 0 };
  const px = -e.deltaY * (e.deltaMode === 1 ? LINE_PX : e.deltaMode === 2 ? PAGE_PX : 1);
  const sum = Math.sign(px) !== 0 && Math.sign(px) !== Math.sign(rest) ? px : rest + px;
  if (sum >= WHEEL_STEP) return { direction: 1, rest: 0 };
  if (sum <= -WHEEL_STEP) return { direction: -1, rest: 0 };
  return { direction: null, rest: sum };
}
