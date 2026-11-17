import { describe, expect, it } from 'vitest';
import { historyOf, MAX_KEPT_STEPS, sourceRef } from './provenance';
import type { OperationRecord, WorkingFile } from './types';

let seq = 0;
function file(name: string, over: Partial<WorkingFile> = {}): WorkingFile {
  return {
    id: `f${++seq}`,
    name,
    kind: 'pdf',
    mimeType: 'application/pdf',
    origin: 'computer',
    bytes: new Uint8Array(1),
    size: 1,
    pageCount: 1,
    wasProtected: false,
    hasRestrictions: false,
    hasSignature: false,
    sentTo: [],
    ...over,
  };
}

/** A result made by `tool` from `sources`, with the history it would carry. */
function made(name: string, tool: OperationRecord['tool'], summary: string, sources: WorkingFile[]): WorkingFile {
  return file(name, { origin: 'result', operation: { tool, summary, sources: sources.map(sourceRef), options: { n: 1 }, ...historyOf(sources) } });
}

describe('historyOf', () => {
  it('adds nothing when no source is a result', () => {
    expect(historyOf([file('a.pdf'), file('b.pdf', { origin: 'vault', evidenceId: 'ev1' })])).toEqual({});
  });

  it('keeps the earlier steps in order and the original sources, with the vault record', () => {
    const vault = file('x.pdf', { origin: 'vault', evidenceId: 'ev-9' });
    const compressed = made('x_compressed.pdf', 'compress', 'Compressed, Recommended (74% smaller: 4.7 MB → 1.2 MB)', [vault]);
    const numbered = made('x_compressed_numbered.pdf', 'page-numbers', 'Added page numbers', [compressed]);
    expect(compressed.operation).not.toHaveProperty('earlier');
    expect(numbered.operation).toMatchObject({
      earlier: [{ tool: 'compress', summary: 'Compressed, Recommended (74% smaller: 4.7 MB → 1.2 MB)', resultName: 'x_compressed.pdf', options: { n: 1 } }],
      originalSources: [{ name: 'x.pdf', origin: 'vault', evidenceId: 'ev-9' }],
    });
    const split = made('x_part_01.pdf', 'split', 'Split every 1 page (part 1 of 2)', [numbered]);
    expect(split.operation!.earlier!.map((s) => s.resultName)).toEqual(['x_compressed.pdf', 'x_compressed_numbered.pdf']);
    expect(split.operation!.originalSources).toMatchObject([{ name: 'x.pdf', origin: 'vault', evidenceId: 'ev-9' }]);
  });

  it('merges the histories of two results in source order, each shared step and source once', () => {
    const a = file('a.pdf');
    const b = file('b.pdf', { origin: 'vault', evidenceId: 'ev-b' });
    const aSmall = made('a_compressed.pdf', 'compress', 'Compressed, Extreme (60% smaller)', [a]);
    const aNumbered = made('a_compressed_numbered.pdf', 'page-numbers', 'Added page numbers', [aSmall]);
    const bPart = made('b_pages_1-2.pdf', 'split', 'Split pages 1-2', [b]);
    const plain = file('c.pdf');
    const merged = historyOf([aNumbered, bPart, plain, aSmall]);
    expect(merged.earlier!.map((s) => `${s.tool}:${s.resultName}`)).toEqual([
      'compress:a_compressed.pdf',
      'page-numbers:a_compressed_numbered.pdf',
      'split:b_pages_1-2.pdf',
    ]);
    expect(merged.originalSources).toMatchObject([
      { name: 'a.pdf', origin: 'computer' },
      { name: 'b.pdf', origin: 'vault', evidenceId: 'ev-b' },
      { name: 'c.pdf', origin: 'computer' },
    ]);
    expect(merged).not.toHaveProperty('earlierNotListed');
  });

  it('keeps two different files that share a name as two original sources', () => {
    const one = file('statement.pdf');
    const two = file('statement.pdf');
    const merged = historyOf([made('a.pdf', 'compress', 'Compressed', [one]), made('b.pdf', 'compress', 'Compressed', [two])]);
    expect(merged.originalSources).toMatchObject([
      { name: 'statement.pdf', origin: 'computer' },
      { name: 'statement.pdf', origin: 'computer' },
    ]);
    // the same file reached through two results is still one source
    const part = made('p.pdf', 'split', 'Split', [one]);
    expect(historyOf([made('x.pdf', 'page-numbers', 'Added', [part]), made('y.pdf', 'page-numbers', 'Added', [part])]).originalSources).toHaveLength(1);
  });

  it('keeps at most the last steps and counts the older ones', () => {
    let current = file('start.pdf');
    for (let i = 1; i <= MAX_KEPT_STEPS + 3; i++) current = made(`step${i}.pdf`, 'page-numbers', `Step ${i}`, [current]);
    const record = current.operation!;
    expect(record.earlier).toHaveLength(MAX_KEPT_STEPS);
    expect(record.earlier![MAX_KEPT_STEPS - 1].resultName).toBe(`step${MAX_KEPT_STEPS + 2}.pdf`);
    expect(record.earlierNotListed).toBe(2);
    expect(record.originalSources).toMatchObject([{ name: 'start.pdf', origin: 'computer' }]);
  });
});
