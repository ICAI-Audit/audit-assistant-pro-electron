// One recogniser for the application's keyboard shortcuts while a PDF Tools layer is open (a tool
// dialog, a destination dialog, the Bookmarks dialog, the page viewer), generalised from W2-B's
// bookmarks/bookmarkKeys.ts. No DOM types: the event target is passed in, so it is unit-tested.
//
// VERA listens on `window`, in the bubbling phase (read from src/, nothing there changed):
// - src/hooks/useKeyboardShortcuts.ts:81 (useGlobalKeyboardShortcuts): Ctrl/Cmd + a letter goes to another
//   screen (Ctrl+Y My Tasks, Ctrl+D Dashboard, Ctrl+O ...);
// - src/hooks/useKeyboardShortcuts.ts:129 (useTabShortcuts, src/pages/AuditTools.tsx:1173): Ctrl/Cmd + a
//   digit and Alt + an arrow switch the VERA Tools tab, which unmounts PDF Tools and its open dialog;
// - src/components/ui/sidebar.tsx:87: Ctrl/Cmd+B folds the sidebar (also from a text box);
// - src/components/KeyboardShortcutsDialog.tsx:67: Ctrl/Cmd + / or ? opens the shortcuts list (also from a text box).
// Any of them pressed in an open dialog threw the dialog and what was typed in it away.
//
// The decision: every key with Ctrl or Cmd, and Alt + an arrow, is kept from the application. What the
// key does by itself is left alone (copy, paste, select all, a text box's own undo), except Alt + an
// arrow outside a text box, which is also cancelled. A layer's own keys (the Bookmarks tree's Alt +
// arrows and Ctrl+Z / Ctrl+Y, the viewer's zoom) come first through `own`.

/**
 * Where the key was pressed: in the layer ('dialog'); in a text box of it ('text': the box keeps its own
 * meaning of the key); in a question over it, another layer opened from it or with the focus nowhere
 * ('hold': the application's shortcuts are stopped, nothing else happens); anywhere else ('outside').
 */
export type KeyPlace = 'dialog' | 'text' | 'hold' | 'outside';

export interface KeyFacts {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

export interface KeyDecision<A = never> {
  /** Keep the key from the application (stopPropagation). */
  stop: boolean;
  /** Also cancel what the key would do by default. */
  preventDefault: boolean;
  /** The layer's own action for the key (only where it was pressed in the layer itself). */
  action: A | null;
}

const NOTHING = { stop: false, preventDefault: false, action: null } as const;
const ARROWS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

/** A key the application takes as a shortcut: any key with Ctrl or Cmd, and Alt + an arrow. */
export function isApplicationShortcut(event: KeyFacts): boolean {
  if (event.ctrlKey || event.metaKey) return true;
  return event.altKey && ARROWS.has(event.key);
}

/**
 * What to do with a key in an open layer. `own` maps the layer's own keys to its actions: acted on
 * (with the key's default cancelled) in the layer itself, held in a 'hold' place, and left to a text box
 * there. Every other application shortcut is stopped; only Alt + an arrow loses its default as well
 * (outside a text box).
 */
export function dialogKeyDecision<A = never>(event: KeyFacts, place: KeyPlace, own?: (event: KeyFacts) => A | null): KeyDecision<A> {
  if (place === 'outside') return NOTHING;
  const action = own?.(event) ?? null;
  if (action !== null) {
    if (place === 'text') return { stop: true, preventDefault: false, action: null };
    return { stop: true, preventDefault: true, action: place === 'dialog' ? action : null };
  }
  if (!isApplicationShortcut(event)) return NOTHING;
  const arrow = event.altKey && !(event.ctrlKey || event.metaKey) && ARROWS.has(event.key);
  return { stop: true, preventDefault: arrow && place !== 'text', action: null };
}

/**
 * An Escape that no layer took. Radix gives Escape only to the layer it counts as topmost, and a layer that
 * has just appeared (a tooltip over the dialog) is counted in an effect: in that moment neither the dialog
 * nor the tooltip takes the key, and the press is lost (lane VS, 15 November 2026; seen here with the blocked
 * Run's tooltip). A layer that takes Escape cancels its default (Radix does when it closes; the tool frame
 * does while a run asks to stop first), so one that reaches the frame's document listener untaken was lost.
 */
export function isLostEscape(event: KeyFacts & { defaultPrevented: boolean; isComposing?: boolean }, place: KeyPlace): boolean {
  return (
    event.key === 'Escape' &&
    !event.defaultPrevented &&
    !event.isComposing &&
    !(event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) &&
    place !== 'outside'
  );
}

export type FrameEscape = 'keep-running' | 'ask-to-stop' | 'wait' | 'close';

/**
 * What an Escape that reaches the tool dialog's own layer does (ToolDialog's onEscapeKeyDown). Just after Stop,
 * Radix still counts the dialog as the top layer until the Stop question has rendered, so an Escape meant for the
 * question can arrive here: it closes the question (Keep running), as the question would, never asks again (lane
 * WRAP's fix in RedactDialog). Otherwise a run asks before it stops, a stopping run waits, an idle dialog closes.
 */
export function frameEscape(state: { stopQuestionOpen: boolean; phase: 'idle' | 'running' | 'stopping' }): FrameEscape {
  if (state.stopQuestionOpen) return 'keep-running';
  if (state.phase === 'running') return 'ask-to-stop';
  return state.phase === 'stopping' ? 'wait' : 'close';
}

/**
 * A held key repeats: the repeats must not press a button again (Run, Stop, a confirmation, a destination's
 * confirm, the Bookmarks actions). For a button's onKeyDown: Enter and Space repeats lose their default (the
 * click); the first press is left alone.
 */
export function ignoreHeldKey(event: { key: string; repeat: boolean; preventDefault(): void }): void {
  if (event.repeat && (event.key === 'Enter' || event.key === ' ')) event.preventDefault();
}

/** The parts of a KeyboardEvent the guard reads. */
export interface GuardKeyEvent extends KeyFacts {
  target: unknown;
  defaultPrevented?: boolean;
  isComposing?: boolean;
  preventDefault(): void;
  stopPropagation(): void;
}

/** The document or the window, or a stand-in for it in tests. */
export interface KeyTarget {
  addEventListener(type: 'keydown', listener: (event: GuardKeyEvent) => void, options: AddEventListenerOptions): void;
  removeEventListener(type: 'keydown', listener: (event: GuardKeyEvent) => void, options: AddEventListenerOptions): void;
}

export interface AttachOptions<A> {
  /**
   * 'bubble' on the document (the frames): after every handler inside the dialog (the Organise grid's
   * own Alt + arrows and Ctrl+Z), before the application's on the window. 'capture' on the window (the
   * Bookmarks dialog, the viewer): before everything, for a layer that acts on its keys here.
   */
  phase: 'bubble' | 'capture';
  own?: (event: KeyFacts) => A | null;
  act?: (action: A) => void;
  /**
   * The frame's own Escape, for one that no layer took (isLostEscape): the frame does what its top layer
   * would have done. Only with phase 'bubble' on the document, after every layer has had the key.
   */
  lostEscape?: () => void;
}

/** Listens on `target` until the returned function is called. */
export function attachDialogKeys<A = never>(target: KeyTarget, place: (eventTarget: unknown) => KeyPlace, options: AttachOptions<A>): () => void {
  const listenerOptions: AddEventListenerOptions = { capture: options.phase === 'capture' };
  const onKey = (event: GuardKeyEvent) => {
    const where = place(event.target);
    // Fields read one by one: a KeyboardEvent's are getters on its prototype, which a spread would not copy.
    const facts = { key: event.key, ctrlKey: event.ctrlKey, metaKey: event.metaKey, altKey: event.altKey, shiftKey: event.shiftKey, defaultPrevented: event.defaultPrevented === true, isComposing: event.isComposing === true };
    if (options.lostEscape && options.phase === 'bubble' && isLostEscape(facts, where)) {
      event.preventDefault();
      options.lostEscape();
      return;
    }
    const decision = dialogKeyDecision(event, where, options.own);
    if (!decision.stop) return;
    if (decision.preventDefault) event.preventDefault();
    event.stopPropagation();
    if (decision.action !== null) options.act?.(decision.action);
  };
  target.addEventListener('keydown', onKey, listenerOptions);
  return () => target.removeEventListener('keydown', onKey, listenerOptions);
}
