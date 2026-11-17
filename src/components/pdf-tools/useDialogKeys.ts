// The shared dialog frames' key guard (dialogKeys.ts): while a tool dialog or a destination dialog is
// open, the application's shortcuts never act behind it, wherever the focus is (in the dialog, in a text
// box, in its Stop question, in a list or the page viewer opened from it, or nowhere).
import { useEffect, useRef, type RefObject } from 'react';
import { attachDialogKeys, type KeyPlace, type KeyTarget } from './dialogKeys';

const isTextBox = (target: Element) =>
  target instanceof HTMLTextAreaElement || (target instanceof HTMLElement && target.isContentEditable) || (target instanceof HTMLInputElement && !NOT_TEXT.has(target.type));
const NOT_TEXT = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file', 'image']);

/**
 * Where a key was pressed, for a modal dialog whose content is `root`. While it is open nothing behind it
 * can have the focus, so a key from elsewhere comes from a layer opened from it (a select's list, the
 * page viewer, a question) or from nowhere: held.
 */
export function framePlace(root: Element | null, target: unknown): KeyPlace {
  if (typeof Element === 'undefined' || !root?.isConnected) return 'outside';
  if (target instanceof Element && isTextBox(target)) return 'text';
  if (target instanceof Node && root.contains(target)) return 'dialog';
  return 'hold';
}

/**
 * Attaches the guard for as long as the calling dialog is mounted. `onLostEscape`: what the frame does with an
 * Escape that no layer took (dialogKeys.ts isLostEscape), the latest one passed being called.
 */
export function useDialogKeys(root: RefObject<HTMLElement>, onLostEscape?: () => void): void {
  const lost = useRef(onLostEscape);
  lost.current = onLostEscape;
  const wanted = onLostEscape !== undefined;
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    return attachDialogKeys(document as unknown as KeyTarget, (target) => framePlace(root.current, target), {
      phase: 'bubble',
      lostEscape: wanted ? () => lost.current?.() : undefined,
    });
  }, [root, wanted]);
}
