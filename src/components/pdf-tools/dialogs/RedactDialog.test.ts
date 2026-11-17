// The Redact dialog keeps its own frame (it fills the window), so it wires the shared frame's pieces
// itself: the key guard with its lost-Escape fallback (useDialogKeys.ts, dialogKeys.ts isLostEscape),
// and the Stop question's focus rules (ToolDialog.tsx). There is no DOM here: what the wiring does on
// screen is proven by driving the application; these checks keep the wiring from being dropped.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./RedactDialog.tsx', import.meta.url), 'utf8');

/** The text of the first `{ ... }` block that starts at or after `from` (braces balanced). */
function blockAfter(text: string, from: number): string {
  const open = text.indexOf('{', from);
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++;
    if (text[i] === '}' && --depth === 0) return text.slice(open, i + 1);
  }
  throw new Error('unbalanced block');
}

describe('Redact dialog: the shared frame pieces it uses', () => {
  it("keeps the application's shortcuts from acting behind it, and acts on an Escape that no layer took", () => {
    expect(source).toMatch(/import \{ useDialogKeys \} from '\.\.\/useDialogKeys';/);
    expect(source).toMatch(/useDialogKeys\(contentRef, \(\) => lostEscape\.current\(\)\);/);
  });

  it('does with a lost Escape what the top layer would have done: the Stop question first, then a box being placed, then the dialog', () => {
    const at = source.indexOf('lostEscape.current = () =>');
    expect(at).toBeGreaterThan(-1);
    const body = blockAfter(source, at);
    const order = ['confirmStop', 'setConfirmStop(false)', 'pending', 'setPending(null)', 'requestClose()'].map((part) => body.indexOf(part));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('closes the Stop question first when the dialog itself is given an Escape while the question is still appearing', () => {
    // Radix counts a layer only after it has rendered again: just after Stop, the dialog is still the top layer it
    // knows, so the dialog's own handler gets the Escape meant for the question.
    const body = blockAfter(source, source.indexOf('onEscapeKeyDown={(event) =>'));
    const order = ['if (confirmStop)', 'event.preventDefault()', 'setConfirmStop(false)', 'if (pending)', 'if (busy)'].map((part) => body.indexOf(part));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('opens the Stop question only through askToStop, which remembers what had the focus', () => {
    expect(source.match(/setConfirmStop\(true\)/g)).toHaveLength(1);
    const body = blockAfter(source, source.indexOf('const askToStop = () =>'));
    expect(body).toMatch(/stopOpener\.current = document\.activeElement instanceof HTMLElement \? document\.activeElement : null;/);
    expect(body).toContain('setConfirmStop(true)');
  });

  it('after a confirmed Stop leaves the focus to the closing question, which puts it back on Stop, then Redact, then the dialog', () => {
    const effect = blockAfter(source, source.indexOf("if (run.phase === 'idle' && before !== 'idle')"));
    expect(effect).toContain('setConfirmStop(false)');
    // Nothing is focused while the question is on screen or closing (the rest of the page is aria-hidden then).
    expect(effect.indexOf('if (stopOpener.current) return;')).toBeGreaterThan(-1);
    expect(effect.indexOf('if (stopOpener.current) return;')).toBeLessThan(effect.indexOf('.focus('));
    const question = source.slice(source.indexOf('<AlertDialogContent'), source.indexOf('</AlertDialogContent>'));
    expect(question).toMatch(/onCloseAutoFocus=\{\(event\) => \{\s*[^]*?event\.preventDefault\(\);/);
    expect(question).toMatch(/for \(const target of \[back, stopButton\.current, runButton\.current, contentRef\.current\]\)/);
  });

  it('a held key never presses Redact, Stop or the question\'s buttons again', () => {
    for (const id of ['pdf-tools-redact-confirm-redact', 'pdf-tools-cancel-run', 'pdf-tools-stop-confirm-yes']) {
      const at = source.indexOf(`data-testid="${id}"`);
      expect(at).toBeGreaterThan(-1);
      // The element, from its opening tag to its closing one.
      const element = source.slice(source.lastIndexOf('<', at), source.indexOf('</', at));
      expect({ id, guarded: element.includes('onKeyDown={ignoreRepeat}') }).toEqual({ id, guarded: true });
    }
    expect(source).toMatch(/<AlertDialogCancel onKeyDown=\{ignoreRepeat\}>Keep running<\/AlertDialogCancel>/);
  });

  it('gives the focus back to the Redact button without opening its tooltip when it closes', () => {
    expect(source).toMatch(/focusQuietly\(document\.querySelector<HTMLElement>\('\[data-testid="pdf-tools-tool-redact"\]'\), \{ preventScroll: true \}\)/);
  });
});
