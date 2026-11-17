// Keeps the viewer's keys and Ctrl + wheel from the rest of the application while the viewer is
// open, wherever focus is. A handler on the dialog alone is not enough: focus can fall to the page
// body (a control removed from the screen, a click on the dimmed backdrop), and Ctrl + minus or plus
// then reached Electron's View menu and zoomed the whole application (lane V review, item 1).
// Listening on the window in the capture phase sees every key first. No DOM types here: the window
// is passed in, so this is unit-tested.
import { isApplicationShortcut } from '../dialogKeys';
import { viewerKeyAction, type ViewerKeyAction } from './viewerKeys';

/** The parts of a KeyboardEvent or WheelEvent the guard reads. */
export interface GuardEvent {
  key?: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  /** An input method is composing (KeyboardEvent.isComposing). */
  isComposing?: boolean;
  deltaY?: number;
  deltaMode?: number;
  target: unknown;
  preventDefault(): void;
  stopPropagation(): void;
}

/** The window, or a stand-in for it in tests. */
export interface GuardTarget {
  addEventListener(type: 'keydown' | 'wheel', listener: (event: GuardEvent) => void, options: AddEventListenerOptions): void;
  removeEventListener(type: 'keydown' | 'wheel', listener: (event: GuardEvent) => void, options: AddEventListenerOptions): void;
}

export interface GuardContext {
  /** A PDF (an image has no pages to move between). */
  hasPages: boolean;
  /** The page fits the width of the view: Left and Right then change page. */
  fitsWidth: boolean;
  /** Whether the event's target is a text box (the page number box): typing keys are its own. */
  isTextField: (target: unknown) => boolean;
}

export type GuardAction = Exclude<ViewerKeyAction, 'hold'>;

const KEY_OPTIONS: AddEventListenerOptions = { capture: true };
// Not passive: Ctrl + wheel is kept from the application with preventDefault.
const WHEEL_OPTIONS: AddEventListenerOptions = { capture: true, passive: false };

/**
 * Listens on `target` (the window) until the returned function is called. The viewer's keys
 * (viewerKeys.ts) are stopped there and handed to `act`, whatever has focus; keys VERA Tools uses to
 * change tab are stopped with no action. Every other key the application takes as a shortcut (any
 * key with Ctrl or Cmd, and Alt + an arrow: dialogKeys.ts, the one recogniser every PDF Tools layer
 * uses) is kept from the application's listeners, which go to another screen, fold the sidebar or
 * open the shortcuts list (re-review 1); what the key does by itself (select all, copy, paste in the
 * page number box) is left alone. Escape is the viewer's own (fix round 1): stopped here, before any
 * layer of the dialog library sees it, and handed to the viewer, which closes its search box if open,
 * else itself; left to an input method that is composing. Other plain keys are not touched (Tab,
 * typing, scrolling). Ctrl + wheel is kept from the application but goes on to the page view, which
 * zooms the page under the pointer.
 */
export function attachViewerKeys(target: GuardTarget, context: () => GuardContext, act: (action: GuardAction) => void): () => void {
  const onKey = (event: GuardEvent) => {
    const now = context();
    const action = viewerKeyAction({
      key: event.key ?? '',
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      altKey: Boolean(event.altKey),
      shiftKey: Boolean(event.shiftKey),
      inTextField: now.isTextField(event.target),
      fitsWidth: now.fitsWidth,
      hasPages: now.hasPages,
      composing: Boolean(event.isComposing),
    });
    if (!action) {
      // In the capture phase on the window: no listener of the application sees it.
      const facts = { key: event.key ?? '', ctrlKey: event.ctrlKey, metaKey: event.metaKey, altKey: Boolean(event.altKey), shiftKey: Boolean(event.shiftKey) };
      if (isApplicationShortcut(facts)) event.stopPropagation();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (action !== 'hold') act(action);
  };
  const onWheel = (event: GuardEvent) => {
    if (event.ctrlKey || event.metaKey) event.preventDefault();
  };
  target.addEventListener('keydown', onKey, KEY_OPTIONS);
  target.addEventListener('wheel', onWheel, WHEEL_OPTIONS);
  return () => {
    target.removeEventListener('keydown', onKey, KEY_OPTIONS);
    target.removeEventListener('wheel', onWheel, WHEEL_OPTIONS);
  };
}
