// The Bookmarks dialog's own shortcuts. The dialog keeps the application's shortcuts away with the one
// shared guard (dialogKeys.ts attachDialogKeys, on the window in the capture phase: before any other
// listener, wherever the focus is), and hands it these keys as its own (REV-B S13: one guard, not two).
// VERA listens on the window: Alt + the arrows switch the VERA Tools tab (useTabShortcuts), Ctrl + a letter
// goes to another screen (Ctrl+Y is My Tasks); pressed in the dialog they threw its unsaved edits away
// (W2-B review F1). No DOM types here.
import type { KeyFacts } from '../dialogKeys';

export type BookmarkKeyAction = 'up' | 'down' | 'indent' | 'outdent' | 'undo' | 'redo';

const ALT_ARROWS: Record<string, BookmarkKeyAction> = { ArrowUp: 'up', ArrowDown: 'down', ArrowRight: 'indent', ArrowLeft: 'outdent' };

/** Alt + an arrow moves, indents or outdents; Ctrl+Z undoes, Ctrl+Y and Ctrl+Shift+Z redo (Cmd too). */
export function bookmarkKeyAction(event: KeyFacts): BookmarkKeyAction | null {
  const command = event.ctrlKey || event.metaKey;
  if (event.altKey && !command) return ALT_ARROWS[event.key] ?? null;
  if (!command || event.altKey) return null;
  const letter = event.key.toLowerCase();
  return letter === 'y' || (letter === 'z' && event.shiftKey) ? 'redo' : letter === 'z' ? 'undo' : null;
}
