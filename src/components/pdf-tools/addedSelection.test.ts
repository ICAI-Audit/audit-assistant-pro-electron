import { describe, expect, it } from 'vitest';
import type { FileOrigin } from '@/lib/pdf-tools/types';
import { selectionAfterAdding, startBatch } from './addedSelection';
import { whyLineText } from './whyLine';

const row = (id: string, origin: FileOrigin = 'computer') => ({ id, origin });

describe('the files just added become the selection (UX audit C1.1)', () => {
  it('replaces the selection with the first file of a batch, then adds each later file of the same batch', () => {
    const list = [row('a'), row('b')];
    let batch = startBatch(list);
    // a and b were ticked before the adding began
    const first = selectionAfterAdding(batch, [...list, row('c')], ['a', 'b'])!;
    expect(first.selectedIds).toEqual(['c']);
    batch = first.batch;
    const second = selectionAfterAdding(batch, [...list, row('c'), row('d')], first.selectedIds)!;
    expect(second.selectedIds).toEqual(['c', 'd']);
  });

  it('keeps an untick the user made while the batch was still arriving', () => {
    let batch = startBatch([]);
    const one = selectionAfterAdding(batch, [row('x')], [])!;
    batch = one.batch;
    // the user unticks x, then y arrives
    const two = selectionAfterAdding(batch, [row('x'), row('y')], [])!;
    expect(two.selectedIds).toEqual(['y']);
  });

  it('says nothing when no new file arrived, and never counts a result as added', () => {
    const batch = startBatch([row('a')]);
    expect(selectionAfterAdding(batch, [row('a')], ['a'])).toBeNull();
    expect(selectionAfterAdding(batch, [row('a'), row('r', 'result')], ['r'])).toBeNull();
    // a vault file counts like a file from the computer
    expect(selectionAfterAdding(batch, [row('a'), row('v', 'vault')], ['a'])!.selectedIds).toEqual(['v']);
  });
});

describe('the line under the toolbar (UX audit C1.2)', () => {
  it('shows the reason just given, else asks to tick files when files are listed and none is ticked', () => {
    expect(whyLineText('Select at least two files to merge.', 3, 0)).toBe('Select at least two files to merge.');
    expect(whyLineText(null, 3, 0)).toBe('Tick files in the list to use a tool.');
    expect(whyLineText(null, 3, 1)).toBe('');
    expect(whyLineText(null, 0, 0)).toBe('');
  });
});
