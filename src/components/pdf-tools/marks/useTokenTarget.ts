// Remembers the text field last focused, and puts a token into it at its caret (TokenBar's buttons); or into
// the one field a bar belongs to (Watermark: each text has its own bar, REV-B S2).
import { useCallback, useRef } from 'react';
import { insertToken } from './markText';

export interface TokenTarget {
  input: HTMLInputElement;
  set: (value: string) => void;
}

export function useTokenTarget() {
  const target = useRef<TokenTarget | null>(null);
  /** Props for a text field that tokens may go into. */
  const field = useCallback(
    (set: (value: string) => void) => ({
      onFocus: (event: { currentTarget: HTMLInputElement }) => {
        target.current = { input: event.currentTarget, set };
      },
    }),
    [],
  );
  /** Puts `token` into `t` at its caret, then gives that field the focus back. */
  const insertInto = useCallback((t: TokenTarget, token: string) => {
    const next = insertToken(t.input.value, t.input.selectionStart, t.input.selectionEnd, token);
    t.set(next.value);
    // After React has written the new value: back into the field, caret after the token.
    requestAnimationFrame(() => {
      if (!t.input.isConnected) return;
      t.input.focus();
      t.input.setSelectionRange(next.caret, next.caret);
    });
  }, []);
  /**
   * Puts `token` into the field last focused (or `fallback`): for one bar that serves several fields (Page
   * numbers' six header and footer places). A bar beside one field uses `insertInto` with its own field.
   */
  const insert = useCallback(
    (token: string, fallback?: TokenTarget) => {
      const t = target.current?.input.isConnected ? target.current : (fallback ?? null);
      if (t) insertInto(t, token);
    },
    [insertInto],
  );
  return { field, insert, insertInto };
}
