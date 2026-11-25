// Focus that the program gives back (a dialog closing returns focus to the button that opened it) must
// not open that button's tooltip (QA-FIX F, user QA 1.36): after a merge worked, the Merge button became
// unavailable for the one result now selected, and its "Select at least two files to merge" popped up over
// the success message. A tooltip opens for the user's own hover, keyboard move or click; the mark set here
// ends with the first of them (endQuietFocus) or when the element loses focus.

const quiet = new WeakSet<HTMLElement>();

/** Focuses `element` without letting its tooltip open on that focus. */
export function focusQuietly(element: HTMLElement | null | undefined, options?: FocusOptions): void {
  if (!element?.isConnected) return;
  quiet.add(element);
  element.focus(options);
}

/** The element has the focus the program gave back, and the user has not acted on it yet. */
export function isQuietlyFocused(element: Element | null | undefined): boolean {
  return element instanceof Object && quiet.has(element as HTMLElement);
}

/** The user acted (pointer, key, blur): tooltips behave as usual again. */
export function endQuietFocus(element: Element | null | undefined): void {
  if (element) quiet.delete(element as HTMLElement);
}
