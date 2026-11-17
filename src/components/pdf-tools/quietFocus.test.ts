import { describe, expect, it, vi } from 'vitest';
import { endQuietFocus, focusQuietly, isQuietlyFocused } from './quietFocus';

const element = () => ({ isConnected: true, focus: vi.fn() }) as unknown as HTMLElement & { focus: ReturnType<typeof vi.fn> };

describe('quietFocus: focus the program gives back opens no tooltip (QA-FIX F)', () => {
  it('focuses the element and marks it, so its tooltip stays shut', () => {
    const button = element();
    focusQuietly(button, { preventScroll: true });
    expect(button.focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(isQuietlyFocused(button)).toBe(true);
  });
  it('the mark ends with the user: a hover, a key or leaving the element', () => {
    const button = element();
    focusQuietly(button);
    endQuietFocus(button);
    expect(isQuietlyFocused(button)).toBe(false);
  });
  it('other elements, and an element that has left the page, are not marked', () => {
    const gone = { isConnected: false, focus: vi.fn() } as unknown as HTMLElement;
    focusQuietly(gone);
    expect(isQuietlyFocused(gone)).toBe(false);
    expect(isQuietlyFocused(element())).toBe(false);
    expect(isQuietlyFocused(null)).toBe(false);
  });
});
