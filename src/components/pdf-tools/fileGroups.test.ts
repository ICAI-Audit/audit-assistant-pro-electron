import { describe, expect, it, vi } from 'vitest';
import { pageImageName, partName } from '@/lib/pdf-tools/fileNames';
import type { WorkingFile } from '@/lib/pdf-tools/types';
import { focusAfterRemove, groupTitle, listUnits, movesToOrder, numberedResultName, orderAfterMove, visibleRows } from './fileGroups';

// Every UTF-16 code unit is tried in one test; give it room on a loaded machine.
vi.setConfig({ testTimeout: 20_000 });

const file = (id: string, groupId?: string, name = `${id}.pdf`): WorkingFile =>
  ({ id, name, groupId, kind: 'pdf', mimeType: 'application/pdf', origin: 'result', bytes: new Uint8Array(), size: 10, pageCount: 1, wasProtected: false, hasRestrictions: false, hasSignature: false, sentTo: [] }) as WorkingFile;

const keys = (units: ReturnType<typeof listUnits>) => units.map((u) => u.key);

describe('listUnits', () => {
  it('gathers the files of one group at the place of its first file', () => {
    const units = listUnits([file('a'), file('p1', 'g'), file('p2', 'g'), file('b'), file('p3', 'g')]);
    expect(keys(units)).toEqual(['a', 'group:g', 'b']);
    const group = units[1];
    expect(group.kind === 'group' && group.files.map((f) => f.id)).toEqual(['p1', 'p2', 'p3']);
  });

  it('shows a group left with one file as an ordinary row', () => {
    expect(keys(listUnits([file('a'), file('p2', 'g')]))).toEqual(['a', 'p2']);
  });
});

describe('visibleRows and focus after removal', () => {
  const units = listUnits([file('a'), file('p1', 'g'), file('p2', 'g'), file('b')]);

  it('lists a collapsed group as one row and an expanded one with its files', () => {
    expect(visibleRows(units, new Set()).map((r) => r.key)).toEqual(['a', 'group:g', 'b']);
    expect(visibleRows(units, new Set(['g'])).map((r) => r.key)).toEqual(['a', 'group:g', 'p1', 'p2', 'b']);
  });

  it('moves to the next row, else the previous one, else nothing', () => {
    const collapsed = visibleRows(units, new Set());
    expect(focusAfterRemove(collapsed, ['a'])?.key).toBe('group:g');
    expect(focusAfterRemove(collapsed, ['p1', 'p2'])?.key).toBe('b');
    expect(focusAfterRemove(collapsed, ['b'])?.key).toBe('group:g');
    expect(focusAfterRemove(collapsed, ['a', 'p1', 'p2', 'b'])).toBeNull();
  });

  it('keeps focus within an open group when one of its files goes', () => {
    const expanded = visibleRows(units, new Set(['g']));
    expect(focusAfterRemove(expanded, ['p1'])?.key).toBe('p2');
  });

  it('carries the ids, so a group that falls to one file can still be found', () => {
    const target = focusAfterRemove(visibleRows(units, new Set()), ['a']);
    expect(target?.ids).toEqual(['p1', 'p2']);
  });
});

describe('moving rows and groups', () => {
  const files = [file('a'), file('p1', 'g'), file('p2', 'g'), file('b')];

  it('moves a row past a whole group', () => {
    expect(orderAfterMove(files, 'a', 'down')).toEqual(['p1', 'p2', 'a', 'b']);
    expect(orderAfterMove(files, 'b', 'up')).toEqual(['a', 'b', 'p1', 'p2']);
  });

  it('moves a group as one', () => {
    expect(orderAfterMove(files, 'group:g', 'up')).toEqual(['p1', 'p2', 'a', 'b']);
    expect(orderAfterMove(files, 'group:g', 'down')).toEqual(['a', 'b', 'p1', 'p2']);
  });

  it('does nothing at the ends', () => {
    expect(orderAfterMove(files, 'a', 'up')).toBeNull();
    expect(orderAfterMove(files, 'b', 'down')).toBeNull();
  });

  it('turns a new order into single-step moves the store understands', () => {
    const current = ['a', 'p1', 'p2', 'b'];
    const target = ['p1', 'p2', 'a', 'b'];
    const moves = movesToOrder(current, target);
    const order = current.slice();
    for (const move of moves) {
      const at = order.indexOf(move.id);
      const to = move.direction === 'up' ? at - 1 : at + 1;
      [order[at], order[to]] = [order[to], order[at]];
    }
    expect(order).toEqual(target);
    expect(moves).toHaveLength(2);
  });
});

describe('groupTitle', () => {
  it('names page images and parts by their stem', () => {
    const pages = [file('1', 'g', 'Bank_page_001.png'), file('2', 'g', 'Bank_page_002.png'), file('3', 'g', 'Bank_page_012.png')];
    expect(groupTitle(pages)).toEqual({ title: 'Bank — 3 page images', range: 'Bank_page_001.png to Bank_page_012.png' });
    const parts = [file('1', 'g', 'Ledger_part_01.pdf'), file('2', 'g', 'Ledger_part_02.pdf')];
    expect(groupTitle(parts)).toEqual({ title: 'Ledger — 2 parts', range: 'Ledger_part_01.pdf to Ledger_part_02.pdf' });
  });

  it('names a second split or a second set of page images by its stem too', () => {
    const parts = [file('1', 'g', 'C_part_01 (2).pdf'), file('2', 'g', 'C_part_02 (2).pdf')];
    expect(groupTitle(parts)).toEqual({ title: 'C — 2 parts', range: 'C_part_01 (2).pdf to C_part_02 (2).pdf' });
    const pages = [file('1', 'g', 'Bank_page_001 (3).png'), file('2', 'g', 'Bank_page_002 (3).png')];
    expect(groupTitle(pages).title).toBe('Bank — 2 page images');
  });

  it('recognises names the lib capped at 120 characters, and the stem "document"', () => {
    const long = 'L'.repeat(200);
    const parts = [partName(long, 1, 2), partName(long, 2, 2)];
    expect(parts[0].length).toBe(120);
    expect(groupTitle(parts.map((name, i) => file(String(i), 'g', name))).title).toBe(`${'L'.repeat(108)} — 2 parts`);
    const pages = [pageImageName(long, 1, 3, 'jpg'), pageImageName(long, 3, 3, 'jpg')];
    expect(groupTitle(pages.map((name, i) => file(String(i), 'g', name))).title).toMatch(/^L+ — 2 page images$/);
    const empty = [partName('', 1, 2), partName('', 2, 2)];
    expect(groupTitle(empty.map((name, i) => file(String(i), 'g', name))).title).toBe('document — 2 parts');
  });

  it('falls back to the first name for anything else', () => {
    expect(groupTitle([file('1', 'g', 'x.pdf'), file('2', 'g', 'y.pdf')])).toEqual({ title: 'x.pdf and 1 more', range: 'x.pdf to y.pdf' });
  });
});

describe('numberedResultName', () => {
  it('numbers before the extension, keeping a part or page ending whole', () => {
    expect(numberedResultName('A_merged.pdf', 2)).toBe('A_merged (2).pdf');
    expect(numberedResultName('C_part_01.pdf', 2)).toBe('C_part_01 (2).pdf');
    expect(numberedResultName('Bank_page_007.jpg', 3)).toBe('Bank_page_007 (3).jpg');
  });

  it('shortens the stem, not the ending, when the name is already at 120 characters', () => {
    const part = partName('L'.repeat(200), 1, 2);
    const numbered = numberedResultName(part, 2);
    expect(numbered.length).toBeLessThanOrEqual(120);
    expect(numbered.endsWith('_part_01 (2).pdf')).toBe(true);
    const page = numberedResultName(pageImageName('L'.repeat(200), 12, 200, 'png'), 10);
    expect(page.length).toBeLessThanOrEqual(120);
    expect(page.endsWith('_page_012 (10).png')).toBe(true);
    const plain = numberedResultName(`${'P'.repeat(116)}.pdf`, 2);
    expect(plain.length).toBeLessThanOrEqual(120);
    expect(plain.endsWith(' (2).pdf')).toBe(true);
  });

  it('numbers a name holding a line or paragraph separator', () => {
    expect(numberedResultName('a\u2028b.pdf', 2)).toBe('a\u2028b (2).pdf');
    expect(numberedResultName('a\u2029b_part_01.pdf', 3)).toBe('a\u2029b_part_01 (3).pdf');
  });

  it('numbers any name without failing, within 120 characters', () => {
    const bad: string[] = [];
    for (let code = 0; code <= 0xffff; code++) {
      const c = String.fromCharCode(code);
      for (const name of [`${c}.pdf`, `a${c}b_page_001.png`, c]) {
        try {
          if (numberedResultName(name, 2).length > 120) bad.push(`${code}: too long`);
        } catch (error) {
          bad.push(`${code}: ${String(error)}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('keeps numbered capped parts in one group title', () => {
    const long = 'L'.repeat(200);
    const names = [numberedResultName(partName(long, 1, 2), 2), numberedResultName(partName(long, 2, 2), 2)];
    expect(groupTitle(names.map((name, i) => file(String(i), 'g', name))).title).toMatch(/^L+ — 2 parts$/);
  });
});
