// Compress at a level: what the run says when nothing is made, and sizes that read differently (user Q&A,
// 15 November 2026, items 1.20, 5.8 and "Would make a user lose trust" 1 and 9).
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { CompressResult } from '@/lib/pdf-tools/compress';
import { makePdf, pageTexts } from '@/lib/pdf-tools/testPdf';
import { createWorkingListStore } from '@/lib/pdf-tools/workingList';
import type { WorkingFile } from '@/lib/pdf-tools/types';
import { compressResultName, sizesText, targetSize } from './compressFit';
import { runTool, type RunContext, type RunDeps } from './runTool';

vi.setConfig({ testTimeout: 30_000 });

let A2: Uint8Array;
let B3: Uint8Array;
beforeAll(async () => {
  A2 = await makePdf('A', 2);
  B3 = await makePdf('B', 3);
  await pageTexts(A2);
}, 60_000);

let seq = 0;
function pdf(name: string, bytes: Uint8Array, pageCount: number, extra: Partial<WorkingFile> = {}): WorkingFile {
  return {
    id: `in-${++seq}`, name, kind: 'pdf', mimeType: 'application/pdf', origin: 'computer', bytes, size: bytes.byteLength, pageCount,
    wasProtected: false, hasRestrictions: false, hasSignature: false, sentTo: [], ...extra,
  };
}

function setup() {
  const store = createWorkingListStore();
  store.setContext('u1:A');
  const controller = new AbortController();
  const ctx: RunContext = { contextKey: 'u1:A', session: store.getState().session, store, signal: controller.signal, onProgress: vi.fn() };
  const deps: Partial<RunDeps> = { paint: async () => undefined, yieldToUi: async () => undefined };
  return { ctx, deps, files: () => store.getState().files };
}

const nothing = (found: number, recodable: number): CompressResult => ({ bytes: null, originalSize: 1_048_576, newSize: 1_040_000, imagesFound: found, imagesRecodable: recodable, imagesReplaced: 0 });

describe('a level that makes nothing says why, and offers a stronger level only when one has something to work on', () => {
  it('a file with images a level can recode: a stronger level may help (not after Strong)', async () => {
    const { ctx, deps } = setup();
    const compressPdf = vi.fn(async () => nothing(4, 4));
    const light = await runTool('compress', [pdf('Scan.pdf', B3, 2)], { level: 'low' }, ctx, { ...deps, compressPdf });
    expect(light).toMatchObject({ status: 'nothing', message: 'Already compact at this level', detail: 'Light would not make this file smaller. A stronger level may still make it smaller.' });
    const strong = await runTool('compress', [pdf('Scan.pdf', B3, 2)], { level: 'extreme' }, ctx, { ...deps, compressPdf });
    expect(strong.detail).toBe('Strong would not make this file smaller.');
  });

  it('a file with no images: no level can help, and it says so', async () => {
    const { ctx, deps } = setup();
    const compressPdf = vi.fn(async () => nothing(0, 0));
    const result = await runTool('compress', [pdf('Draft.pdf', B3, 2)], { level: 'low' }, ctx, { ...deps, compressPdf });
    expect(result).toMatchObject({
      status: 'nothing',
      message: 'No images to reduce',
      detail: 'This file has no images to reduce, so no level can make it smaller; nothing was added.',
    });
  });

  it('a file whose images are all of a kind Compress leaves alone: says so, never "a stronger level"', async () => {
    const { ctx, deps } = setup();
    const compressPdf = vi.fn(async () => nothing(3, 0));
    const result = await runTool('compress', [pdf('Print.pdf', B3, 2)], { level: 'recommended' }, ctx, { ...deps, compressPdf });
    expect(result).toMatchObject({
      status: 'nothing',
      message: 'Its images cannot be reduced',
      detail: 'Its images are of a kind Compress cannot reduce, so no level can make it smaller; nothing was added.',
    });
  });

  it('several files: a stronger level is offered only when one of them has images to work on', async () => {
    const { ctx, deps } = setup();
    const none = vi.fn(async () => nothing(0, 0));
    const both = await runTool('compress', [pdf('One.pdf', B3.slice(), 2), pdf('Two.pdf', B3.slice(), 2)], { level: 'low' }, ctx, { ...deps, compressPdf: none });
    expect(both.detail).toBe('Light would not make these files smaller: none of them has images Compress can reduce.');
    let n = 0;
    const one = vi.fn(async () => (n++ === 0 ? nothing(0, 0) : nothing(2, 2)));
    const mixed = await runTool('compress', [pdf('One.pdf', B3.slice(), 2), pdf('Two.pdf', B3.slice(), 2)], { level: 'low' }, ctx, { ...deps, compressPdf: one });
    expect(mixed.detail).toBe('Light would not make these files smaller. A stronger level may still make them smaller.');
  });
});

describe('sizes read differently when they differ', () => {
  it('shows the usual sizes, and more exact ones when the usual would read the same', () => {
    expect(sizesText(4_800_000, 2_800_000)).toBe('4.6 MB → 2.7 MB');
    expect(sizesText(1_068_000, 1_056_000)).toBe('1,043 KB → 1,031 KB');
    expect(sizesText(10_280, 10_270)).toBe('10,280 bytes → 10,270 bytes');
    expect(sizesText(1_00_00_000, 99_00_000)).toBe('9.5 MB → 9.4 MB');
  });

  it('a 1% smaller result says "1,043 KB → 1,031 KB", never "1.0 MB → 1.0 MB", in the message and the record', async () => {
    const { ctx, deps, files } = setup();
    const compressPdf = vi.fn(async () => ({ bytes: A2, originalSize: 1_068_000, newSize: 1_056_000, imagesFound: 1, imagesRecodable: 1, imagesReplaced: 1 }));
    const result = await runTool('compress', [pdf('Draft.pdf', B3, 2)], { level: 'recommended' }, ctx, { ...deps, compressPdf });
    expect(result.detail).toBe('1% smaller: 1,043 KB → 1,031 KB');
    expect(files()[0].operation!.summary).toBe('Compressed, Balanced (1% smaller: 1,043 KB → 1,031 KB)');
  });
});

describe('result names say how the copy was made', () => {
  it('names the level or the size, so that copies are not mixed up', () => {
    expect(compressResultName('Scan.pdf', 'low')).toBe('Scan_compressed_light.pdf');
    expect(compressResultName('Scan.pdf', 'recommended')).toBe('Scan_compressed_balanced.pdf');
    expect(compressResultName('Scan.pdf', 'extreme')).toBe('Scan_compressed_strong.pdf');
    expect(compressResultName('Scan.pdf', 'fit', targetSize({ value: 5, unit: 'MB' }))).toBe('Scan_compressed_5MB.pdf');
    expect(compressResultName('Scan.pdf', 'fit', targetSize({ value: 1.5, unit: 'MB' }))).toBe('Scan_compressed_1.5MB.pdf');
    expect(compressResultName('Scan.pdf', 'fit', targetSize({ value: 500, unit: 'KB' }))).toBe('Scan_compressed_500KB.pdf');
    expect(compressResultName('Scan.pdf', 'fit', null)).toBe('Scan_compressed.pdf');
  });

  it('keeps the whole ending when a long name is cut to 120 characters', () => {
    const name = compressResultName(`${'A'.repeat(200)}.pdf`, 'recommended');
    expect(name.length).toBeLessThanOrEqual(120);
    expect(name.endsWith('_compressed_balanced.pdf')).toBe(true);
  });
});
