import { describe, expect, it } from 'vitest';
import { moveIndex } from './listNavigation';

describe('moveIndex (one Tab stop, arrow keys move)', () => {
  it('moves by one, stops at the ends, and starts at the first or last from nothing', () => {
    expect(moveIndex('ArrowDown', 0, 5)).toBe(1);
    expect(moveIndex('ArrowDown', 4, 5)).toBe(4);
    expect(moveIndex('ArrowUp', 0, 5)).toBe(0);
    expect(moveIndex('ArrowUp', 3, 5)).toBe(2);
    expect(moveIndex('ArrowDown', -1, 5)).toBe(0);
    expect(moveIndex('ArrowUp', -1, 5)).toBe(4);
  });

  it('jumps with Home, End and the page keys', () => {
    expect(moveIndex('Home', 3, 5)).toBe(0);
    expect(moveIndex('End', 0, 5)).toBe(4);
    expect(moveIndex('PageDown', 0, 30, 10)).toBe(10);
    expect(moveIndex('PageDown', 25, 30, 10)).toBe(29);
    expect(moveIndex('PageUp', 5, 30, 10)).toBe(0);
  });

  it('ignores other keys and empty lists, and clamps an index left past the end by a filter', () => {
    expect(moveIndex('a', 1, 5)).toBeNull();
    expect(moveIndex(' ', 1, 5)).toBeNull();
    expect(moveIndex('ArrowDown', 0, 0)).toBeNull();
    expect(moveIndex('ArrowUp', 9, 3)).toBe(1);
  });
});
