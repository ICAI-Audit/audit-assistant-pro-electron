import { deflateSync } from 'node:zlib';
import { PDFDocument, PDFName } from 'pdf-lib';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { buildActivityEntry } from '@/lib/pdf-tools/activity';
import type { CompressResult } from '@/lib/pdf-tools/compress';
import { defaultPageNumberOptions } from '@/lib/pdf-tools/pageNumbers';
import { makeSharedResourcesPdf } from '@/lib/pdf-tools/testLeakPdf';
import { makeFormPdf, makePdf, pageTexts } from '@/lib/pdf-tools/testPdf';
import { createWorkingListStore } from '@/lib/pdf-tools/workingList';
import { PdfToolsError, type WorkingFile } from '@/lib/pdf-tools/types';
import { groupTitle } from './fileGroups';
import { RenderTimeoutError } from './renderQueue';
import { runTool, withUniqueNames, type RunContext, type RunDeps } from './runTool';
import { estimateImageBytes } from './toolOptions';

vi.setConfig({ testTimeout: 20_000 });

// ---- fixtures ------------------------------------------------------------------------------

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (bytes: Uint8Array) => {
  let c = 0xffffffff;
  for (const b of bytes) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}
/** A grey RGB PNG of the given size. */
function makePng(width: number, height: number): Uint8Array {
  const row = new Uint8Array(1 + width * 3).fill(0x80);
  row[0] = 0;
  const raw = new Uint8Array(row.length * height);
  for (let y = 0; y < height; y++) raw.set(row, y * row.length);
  const ihdr = new Uint8Array(13);
  new DataView(ihdr.buffer).setUint32(0, width);
  new DataView(ihdr.buffer).setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const parts = [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', new Uint8Array(deflateSync(raw))), chunk('IEND', new Uint8Array())];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

let seq = 0;
function pdf(name: string, bytes: Uint8Array, pageCount: number, extra: Partial<WorkingFile> = {}): WorkingFile {
  return {
    id: `in-${++seq}`,
    name,
    kind: 'pdf',
    mimeType: 'application/pdf',
    origin: 'computer',
    bytes,
    size: bytes.byteLength,
    pageCount,
    wasProtected: false,
    hasRestrictions: false,
    hasSignature: false,
    sentTo: [],
    ...extra,
  };
}
function image(name: string, bytes: Uint8Array, extra: Partial<WorkingFile> = {}): WorkingFile {
  return { ...pdf(name, bytes, 0), kind: 'image', mimeType: 'image/png', pageCount: null, ...extra };
}

let A2: Uint8Array;
let B3: Uint8Array;
let C5: Uint8Array;
let png: Uint8Array;

beforeAll(async () => {
  A2 = await makePdf('A', 2);
  B3 = await makePdf('B', 3);
  C5 = await makePdf('C', 5);
  png = makePng(40, 20);
  await pageTexts(A2); // pays the cold pdfjs import once
}, 60_000);

function setup(options: { maxBytes?: number; warnBytes?: number } = {}) {
  const store = createWorkingListStore();
  store.setContext('u1:A');
  const controller = new AbortController();
  const progress = vi.fn();
  const ctx: RunContext = { contextKey: 'u1:A', session: store.getState().session, store, signal: controller.signal, onProgress: progress };
  const deps: Partial<RunDeps> = {
    paint: async () => undefined,
    yieldToUi: async () => undefined,
    ...(options.maxBytes !== undefined ? { maxBytes: options.maxBytes } : {}),
    ...(options.warnBytes !== undefined ? { warnBytes: options.warnBytes } : {}),
  };
  return { store, controller, ctx, deps, progress, files: () => store.getState().files };
}

const primitivesOnly = (record: Record<string, unknown>) =>
  Object.values(record).every((v) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean');

// ---- tools ---------------------------------------------------------------------------------

describe('merge', () => {
  it('merges in list order, turns images into pages and records the sources', async () => {
    const { store, ctx, deps, files } = setup();
    const inputs = [
      pdf('A.pdf', A2, 2),
      image('photo.png', png),
      pdf('B.pdf', B3, 3, { origin: 'vault', evidenceId: 'ev-1', wasProtected: true }),
    ];
    const beforeA = A2.slice();
    const result = await runTool('merge', inputs, {}, ctx, deps);

    expect(result.status).toBe('added');
    expect(result.added).toBe(1);
    expect(result.message).toBe('Merged 3 files into A_merged.pdf');
    const [made] = files();
    expect(result.ids).toEqual([made.id]);
    expect(made).toMatchObject({ name: 'A_merged.pdf', origin: 'result', kind: 'pdf', mimeType: 'application/pdf', pageCount: 6, wasProtected: true, hasRestrictions: false, sentTo: [] });
    expect(made.groupId).toBeUndefined();
    expect(made.operation).toMatchObject({ tool: 'merge', summary: 'Merged 3 files' });
    expect(made.operation!.sources).toMatchObject([
      { name: 'A.pdf', origin: 'computer' },
      { name: 'photo.png', origin: 'computer' },
      { name: 'B.pdf', origin: 'vault', evidenceId: 'ev-1' },
    ]);
    expect(primitivesOnly(made.operation!.options)).toBe(true);
    expect(await pageTexts(made.bytes)).toEqual(['A p1', 'A p2', '', 'B p1', 'B p2', 'B p3']);
    const imagePage = (await PDFDocument.load(made.bytes)).getPage(2).getSize();
    expect(imagePage.width).toBeCloseTo(841.89, 1); // a wide image gets a landscape A4 page
    expect(A2).toEqual(beforeA); // the source is never changed
    expect(store.getState().files).toHaveLength(1);
  });

  it('uses a typed name, cleaned, and the default when nothing usable was typed', async () => {
    const one = setup();
    await runTool('merge', [pdf('A.pdf', A2, 2), pdf('B.pdf', B3, 3)], { name: 'Final: set?' }, one.ctx, one.deps);
    expect(one.files()[0].name).toBe('Final_ set_.pdf');
    const two = setup();
    await runTool('merge', [pdf('A.pdf', A2, 2), pdf('B.pdf', B3, 3)], { name: '???' }, two.ctx, two.deps);
    expect(two.files()[0].name).toBe('A_merged.pdf');
  });

  it('marks a result unprotected when no input was protected', async () => {
    const { ctx, deps, files } = setup();
    await runTool('merge', [pdf('A.pdf', A2, 2), pdf('B.pdf', B3, 3)], {}, ctx, deps);
    expect(files()[0].wasProtected).toBe(false);
  });
});

describe('split', () => {
  it('takes a page range into one file', async () => {
    const { ctx, deps, files } = setup();
    await runTool('split', [pdf('B.pdf', B3, 3)], { mode: 'range', from: 2, to: 3 }, ctx, deps);
    const [made] = files();
    expect(made).toMatchObject({ name: 'B_pages_2-3.pdf', pageCount: 2, origin: 'result' });
    expect(made.operation).toMatchObject({ tool: 'split', summary: 'Split pages 2-3', options: { mode: 'range', from: 2, to: 3 } });
    expect(await pageTexts(made.bytes)).toEqual(['B p2', 'B p3']);
  });

  it('takes selected pages in the order written', async () => {
    const { ctx, deps, files } = setup();
    await runTool('split', [pdf('B.pdf', B3, 3)], { mode: 'selected', pages: '3, 1' }, ctx, deps);
    const [made] = files();
    expect(made.name).toBe('B_selected_pages.pdf');
    expect(made.operation!.summary).toBe('Extracted pages 3, 1');
    expect(await pageTexts(made.bytes)).toEqual(['B p3', 'B p1']);
  });

  it('splits every N pages into parts that share one group', async () => {
    const { ctx, deps, files } = setup();
    const result = await runTool('split', [pdf('C.pdf', C5, 5, { wasProtected: true })], { mode: 'every', every: 2 }, ctx, deps);
    expect(result.added).toBe(3);
    const parts = files();
    expect(parts.map((f) => f.name)).toEqual(['C_part_01.pdf', 'C_part_02.pdf', 'C_part_03.pdf']);
    expect(parts.map((f) => f.pageCount)).toEqual([2, 2, 1]);
    expect(parts.map((f) => f.operation!.summary)).toEqual([
      'Split every 2 pages (part 1 of 3)',
      'Split every 2 pages (part 2 of 3)',
      'Split every 2 pages (part 3 of 3)',
    ]);
    expect(new Set(parts.map((f) => f.groupId)).size).toBe(1);
    expect(parts[0].groupId).toBeTruthy();
    expect(parts.every((f) => f.wasProtected)).toBe(true);
    expect(await pageTexts(parts[2].bytes)).toEqual(['C p5']);
  });

  it('names parts from a typed stem', async () => {
    const { ctx, deps, files } = setup();
    await runTool('split', [pdf('C.pdf', C5, 5)], { mode: 'every', every: 4, stem: 'Bank 2026' }, ctx, deps);
    expect(files().map((f) => f.name)).toEqual(['Bank 2026_part_01.pdf', 'Bank 2026_part_02.pdf']);
  });

  it("refuses a bad page list with the parser's message and adds nothing", async () => {
    const { ctx, deps, files } = setup();
    await expect(runTool('split', [pdf('B.pdf', B3, 3)], { mode: 'selected', pages: '4' }, ctx, deps)).rejects.toThrow("Page 4 is outside this file's 3 pages");
    expect(files()).toEqual([]);
  });
});

describe('delete pages', () => {
  it('removes the pages and keeps the rest in order', async () => {
    const { ctx, deps, files } = setup();
    const result = await runTool('delete-pages', [pdf('B.pdf', B3, 3)], { pages: '2' }, ctx, deps);
    const [made] = files();
    expect(made).toMatchObject({ name: 'B_pages_removed.pdf', pageCount: 2 });
    expect(made.operation!.summary).toBe('Deleted page 2');
    expect(result.detail).toBe('2 pages remain.');
    expect(await pageTexts(made.bytes)).toEqual(['B p1', 'B p3']);
  });

  it('refuses to delete every page', async () => {
    const { ctx, deps, files } = setup();
    await expect(runTool('delete-pages', [pdf('B.pdf', B3, 3)], { pages: '1-3' }, ctx, deps)).rejects.toThrow('You cannot delete every page of a PDF.');
    expect(files()).toEqual([]);
  });
});

describe('compress', () => {
  const compressed = (bytes: Uint8Array, originalSize: number): CompressResult => ({ bytes, originalSize, newSize: bytes.byteLength, imagesFound: 1, imagesReplaced: 1 });

  it('gives each file its own result and says how much smaller', async () => {
    const { ctx, deps, files } = setup();
    const compressPdf = vi.fn(async (bytes: Uint8Array) => compressed(A2, Math.round(A2.byteLength / 0.58)));
    const result = await runTool('compress', [pdf('Scan.pdf', B3, 2, { wasProtected: true })], { level: 'recommended' }, ctx, { ...deps, compressPdf });
    const [made] = files();
    expect(made).toMatchObject({ name: 'Scan_compressed.pdf', pageCount: 2, wasProtected: true });
    expect(made.operation!.summary).toMatch(/^Compressed, Recommended \(42% smaller: .+ → .+\)$/);
    expect(made.operation!.options).toEqual({ level: 'recommended' });
    expect(made.operation!.sources).toMatchObject([{ name: 'Scan.pdf', origin: 'computer' }]);
    expect(result.message).toBe('Compressed Scan_compressed.pdf');
    expect(result.detail).toMatch(/^42% smaller: .+ → .+$/);
  });

  it('adds no row and says so when the file is already compact', async () => {
    const { ctx, deps, files } = setup();
    const compressPdf = vi.fn(async (bytes: Uint8Array) => ({ ...compressed(bytes, bytes.byteLength), bytes: null }));
    const result = await runTool('compress', [pdf('B.pdf', B3, 3)], { level: 'low' }, ctx, { ...deps, compressPdf });
    expect(result).toMatchObject({ status: 'nothing', added: 0, message: 'Already compact at this level' });
    expect(files()).toEqual([]);
  });

  it('adds the files that got smaller and names the ones that did not', async () => {
    const { ctx, deps, files } = setup();
    const compressPdf = vi.fn(async (bytes: Uint8Array) => (bytes === A2 ? compressed(A2, A2.byteLength * 2) : { ...compressed(bytes, bytes.byteLength), bytes: null }));
    const result = await runTool('compress', [pdf('A.pdf', A2, 2), pdf('B.pdf', B3, 3)], { level: 'recommended', names: ['First', ''] }, ctx, { ...deps, compressPdf });
    expect(files().map((f) => f.name)).toEqual(['First.pdf']);
    expect(result.detail).toContain('Already compact at this level: B.pdf');
  });

  it('reports a cancel during compression as cancelled, never as a failure', async () => {
    const { controller, ctx, deps, files } = setup();
    const compressPdf = vi.fn(async (_b: Uint8Array, _l: string, _r: unknown, onProgress?: (d: number, t: number) => void) => {
      onProgress?.(0, 2);
      controller.abort();
      onProgress?.(1, 2); // throws: this is how a cancel stops compressPdf
      return compressed(A2, A2.byteLength * 2);
    });
    const result = await runTool('compress', [pdf('A.pdf', A2, 2)], { level: 'recommended' }, ctx, { ...deps, compressPdf });
    expect(result.status).toBe('cancelled');
    expect(files()).toEqual([]);
  });

  it("treats 'recode-failed' after a cancel as cancelled", async () => {
    const { controller, ctx, deps, files } = setup();
    const compressPdf = vi.fn(async () => {
      controller.abort();
      throw new PdfToolsError('recode-failed', 'The images in this file could not be processed, so it was not compressed.');
    });
    const result = await runTool('compress', [pdf('A.pdf', A2, 2)], { level: 'extreme' }, ctx, { ...deps, compressPdf });
    expect(result.status).toBe('cancelled');
    expect(files()).toEqual([]);
  });

  it('shows the recode failure when nothing was cancelled', async () => {
    const { ctx, deps } = setup();
    const compressPdf = vi.fn(async () => {
      throw new PdfToolsError('recode-failed', 'The images in this file could not be processed, so it was not compressed.');
    });
    await expect(runTool('compress', [pdf('A.pdf', A2, 2)], { level: 'extreme' }, ctx, { ...deps, compressPdf })).rejects.toMatchObject({ code: 'recode-failed' });
  });

  it('adds nothing when cancelled between files', async () => {
    const { controller, ctx, deps, files } = setup();
    const compressPdf = vi.fn(async (bytes: Uint8Array) => {
      controller.abort(); // the first file finishes, then the run is cancelled
      return compressed(A2, bytes.byteLength * 2);
    });
    const result = await runTool('compress', [pdf('A.pdf', A2, 2), pdf('B.pdf', B3, 3)], { level: 'recommended' }, ctx, { ...deps, compressPdf });
    expect(result.status).toBe('cancelled');
    expect(compressPdf).toHaveBeenCalledTimes(1);
    expect(files()).toEqual([]);
  });
});

describe('page numbers', () => {
  it('numbers the pages and records the options as plain values', async () => {
    const { ctx, deps, files } = setup();
    const numbers = { position: 'bottom-right', format: 'custom', prefix: 'WP-A1 / ', suffix: '', startNumber: 1, fromPage: 2, toPage: 3, fontSize: 10, marginPt: 28, color: { r: 0, g: 0, b: 0 } } as const;
    await runTool('page-numbers', [pdf('B.pdf', B3, 3)], { numbers }, ctx, deps);
    const [made] = files();
    expect(made).toMatchObject({ name: 'B_numbered.pdf', pageCount: 3 });
    expect(made.operation!.summary).toBe('Added page numbers');
    expect(made.operation!.options).toMatchObject({ position: 'bottom-right', format: 'custom', prefix: 'WP-A1 / ', fromPage: 2, toPage: 3, color: '#000000' });
    expect(primitivesOnly(made.operation!.options)).toBe(true);
    const texts = await pageTexts(made.bytes);
    expect(texts[0]).toBe('B p1');
    expect(texts[1]).toContain('WP-A1 / 1');
    expect(texts[2]).toContain('WP-A1 / 2');
  });
});

describe('images to PDF', () => {
  it('places the images in list order, one per page', async () => {
    const { ctx, deps, files } = setup();
    const tall = makePng(20, 40);
    await runTool('images-to-pdf', [image('scan1.png', png), image('scan2.png', tall)], { pageSize: 'a4-auto', marginPt: 28 }, ctx, deps);
    const [made] = files();
    expect(made).toMatchObject({ name: 'scan1.pdf', pageCount: 2, kind: 'pdf' });
    expect(made.operation!.summary).toBe('Converted 2 images to PDF');
    expect(made.operation!.sources.map((s) => s.name)).toEqual(['scan1.png', 'scan2.png']);
    const doc = await PDFDocument.load(made.bytes);
    expect(doc.getPage(0).getSize().width).toBeCloseTo(841.89, 1);
    expect(doc.getPage(1).getSize().width).toBeCloseTo(595.28, 1);
  });

  it('fails the run on one bad image with a message naming it', async () => {
    const { ctx, deps, files } = setup();
    const bad = image('broken.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]));
    await expect(runTool('images-to-pdf', [image('a.png', png), bad], { pageSize: 'fit', marginPt: 0 }, ctx, deps)).rejects.toThrow(/"broken.png"/);
    expect(files()).toEqual([]);
  });
});

describe('PDF to images', () => {
  const rendered = (bytes: Uint8Array, extra = {}) => ({ bytes, width: 40, height: 20, mimeType: 'image/png' as const, dpi: 150, reduced: false, ...extra });

  it('makes one image per chosen page, grouped, named by page', async () => {
    const { ctx, deps, files } = setup();
    const renderPage = vi.fn(async (_b: Uint8Array, index: number) => rendered(png, index === 2 ? { reduced: true, dpi: 112 } : {}));
    const result = await runTool('pdf-to-images', [pdf('B.pdf', B3, 3, { wasProtected: true })], { pages: '3, 1', format: 'png', dpi: 150 }, ctx, { ...deps, renderPage });
    expect(renderPage.mock.calls.map((c) => c[1])).toEqual([0, 2]); // page order, each once
    const images = files();
    expect(images.map((f) => f.name)).toEqual(['B_page_001.png', 'B_page_003.png']);
    expect(images.every((f) => f.kind === 'image' && f.mimeType === 'image/png' && f.pageCount === null && f.wasProtected)).toBe(true);
    expect(new Set(images.map((f) => f.groupId)).size).toBe(1);
    expect(images[0].groupId).toBeTruthy();
    expect(images.map((f) => f.operation!.summary)).toEqual(['Converted page 1 to PNG at 150 dpi', 'Converted page 3 to PNG at 112 dpi']);
    expect(result.message).toBe('Made 2 page images');
    expect(result.detail).toContain('Page 3 is very large, so it was saved at 112 dpi');
  });

  it('adds nothing when cancelled between pages', async () => {
    const { controller, ctx, deps, files } = setup();
    const renderPage = vi.fn(async (_b: Uint8Array, index: number) => {
      if (index === 1) controller.abort();
      return rendered(png);
    });
    const result = await runTool('pdf-to-images', [pdf('B.pdf', B3, 3)], { pages: 'all', format: 'png', dpi: 150 }, ctx, { ...deps, renderPage });
    expect(result.status).toBe('cancelled');
    expect(renderPage).toHaveBeenCalledTimes(2);
    expect(files()).toEqual([]);
  });

  it('does not refuse on the estimate alone: the real images decide', async () => {
    const { ctx, deps, files } = setup({ maxBytes: estimateImageBytes(3, 300, 'png') - 1 });
    const renderPage = vi.fn(async () => rendered(png));
    const result = await runTool('pdf-to-images', [pdf('B.pdf', B3, 3)], { pages: 'all', format: 'png', dpi: 300 }, ctx, { ...deps, renderPage });
    expect(result.status).toBe('added');
    expect(renderPage).toHaveBeenCalledTimes(3);
    expect(files()).toHaveLength(3);
  });

  it('stops when the real images outgrow the list, says how many fit, and adds nothing', async () => {
    const big = new Uint8Array(600_000);
    big.set(png.subarray(0, 8));
    const { ctx, deps, files } = setup({ maxBytes: 1_000_000 });
    const renderPage = vi.fn(async () => rendered(big, { width: 10, height: 10 }));
    const run = runTool('pdf-to-images', [pdf('B.pdf', B3, 3)], { pages: '1-2', format: 'png', dpi: 100 }, ctx, { ...deps, renderPage });
    await expect(run).rejects.toMatchObject({ code: 'too-large' });
    await expect(run).rejects.toThrow(/^Only 1 of 2 page images fit in the list \(977 KB at most\)\. Nothing was added\. Choose fewer pages or JPG\.$/);
    expect(renderPage).toHaveBeenCalledTimes(2);
    expect(files()).toEqual([]);
  });

  it('suggests only the choices that can still make the images smaller when they do not fit', async () => {
    const advice = async (format: 'png' | 'jpg', dpi: 100 | 150 | 300) => {
      // 600 KB each, signed as the format asked for: the second page does not fit.
      const big = new Uint8Array(600_000);
      big.set(format === 'png' ? png.subarray(0, 8) : [0xff, 0xd8, 0xff]);
      const { ctx, deps } = setup({ maxBytes: 1_000_000 });
      const renderPage = vi.fn(async () => rendered(big, { width: 10, height: 10, mimeType: format === 'png' ? 'image/png' : 'image/jpeg' }));
      const failure = await runTool('pdf-to-images', [pdf('B.pdf', B3, 3)], { pages: '1-2', format, dpi }, ctx, { ...deps, renderPage }).catch((e: Error) => e);
      return / Nothing was added\. (.*)$/.exec((failure as Error).message)?.[1];
    };
    expect(await advice('png', 150)).toBe('Choose fewer pages, a lower resolution or JPG.');
    expect(await advice('jpg', 300)).toBe('Choose fewer pages or a lower resolution.');
    expect(await advice('jpg', 100)).toBe('Choose fewer pages.');
  });

  it('makes each page once even when it is typed twice', async () => {
    const { ctx, deps, files } = setup();
    const renderPage = vi.fn(async (_b: Uint8Array, _index: number) => rendered(png));
    await runTool('pdf-to-images', [pdf('B.pdf', B3, 3)], { pages: '2, 1, 2', format: 'png', dpi: 150 }, ctx, { ...deps, renderPage });
    expect(renderPage.mock.calls.map((c) => c[1])).toEqual([0, 1]);
    expect(files().map((f) => f.name)).toEqual(['B_page_001.png', 'B_page_002.png']);
  });

  it('words renderer failures for images, not for previews', async () => {
    const fail = (error: unknown) => vi.fn(async (_b: Uint8Array, index: number) => (index === 1 ? Promise.reject(error) : rendered(png)));
    const go = (renderPage: ReturnType<typeof fail>) => {
      const s = setup();
      return runTool('pdf-to-images', [pdf('B.pdf', B3, 3)], { pages: '1-2', format: 'png', dpi: 150 }, s.ctx, { ...s.deps, renderPage });
    };
    // Each run uses its own store; nothing is added in any of them.
    const cases: [unknown, string, string][] = [
      [
        new PdfToolsError('render-unavailable', 'Page previews could not be started. Restart the application and try again.'),
        'render-unavailable',
        'The pages could not be turned into images: the page renderer did not start. Nothing was added. Restart the application and try again.',
      ],
      [new RenderTimeoutError(), 'render-timeout', 'Page 2 took too long to turn into an image. Nothing was added. Try a lower resolution or JPG.'],
      [
        new PdfToolsError('open-timeout', 'The file took too long to open for preview.'),
        'open-timeout',
        'Page 2 could not be turned into an image: the file took too long to open. Nothing was added. Try again; if it happens again, restart the application.',
      ],
      [
        new PdfToolsError('renderer-restarted', 'This file could not be opened for preview.'),
        'renderer-restarted',
        'Page 2 could not be turned into an image: the page renderer had to restart, usually because memory ran short. Nothing was added. Try a lower resolution or JPG.',
      ],
      [
        new PdfToolsError('out-of-memory', 'There was not enough memory to draw this page.'),
        'out-of-memory',
        'Page 2 could not be turned into an image: there was not enough memory. Nothing was added. Try a lower resolution or JPG.',
      ],
      [
        new PdfToolsError('image-encode-failed', 'The page image could not be encoded.'),
        'out-of-memory',
        'Page 2 could not be turned into an image: there was not enough memory. Nothing was added. Try a lower resolution or JPG.',
      ],
      [
        new PdfToolsError('render-failed', 'This file could not be opened for preview.'),
        'render-failed',
        'Page 2 could not be turned into an image. The file may be damaged. Nothing was added.',
      ],
      [
        new TypeError('Cannot read properties of null'),
        'render-failed',
        'Page 2 could not be turned into an image. Nothing was added. Try a lower resolution or JPG.',
      ],
    ];
    for (const [error, code, message] of cases) {
      const run = go(fail(error));
      await expect(run).rejects.toMatchObject({ code, message });
      await expect(run).rejects.not.toThrow(/preview/i);
    }
  });

  it('suggests a lower resolution or JPG only when the run can still use them', async () => {
    const advice = async (error: unknown, format: 'png' | 'jpg', dpi: 100 | 150 | 300) => {
      const s = setup();
      const renderPage = vi.fn(async () => Promise.reject(error));
      const failure = await runTool('pdf-to-images', [pdf('B.pdf', B3, 3)], { pages: '1', format, dpi }, s.ctx, { ...s.deps, renderPage }).catch((e: Error) => e);
      return / Nothing was added\. (.*)$/.exec((failure as Error).message)?.[1];
    };
    const memory = new PdfToolsError('out-of-memory', 'There was not enough memory to draw this page.');
    expect(await advice(memory, 'png', 150)).toBe('Try a lower resolution or JPG.');
    expect(await advice(memory, 'png', 100)).toBe('Try JPG.');
    expect(await advice(memory, 'jpg', 300)).toBe('Try a lower resolution.');
    // At the lowest resolution with JPG there is nothing lighter to suggest.
    for (const error of [memory, new RenderTimeoutError(), new PdfToolsError('renderer-restarted', 'x'), new TypeError('x')]) {
      expect(await advice(error, 'jpg', 100)).toBe('Try again; if it happens again, restart the application.');
    }
    // Opening does not depend on resolution, format or the number of pages.
    for (const [format, dpi] of [['png', 300], ['jpg', 100]] as const) {
      expect(await advice(new PdfToolsError('open-timeout', 'x'), format, dpi)).toBe('Try again; if it happens again, restart the application.');
    }
  });

  it("asks the renderer for the run's own priority, ahead of page tiles", async () => {
    const { ctx, deps } = setup();
    const renderPage = vi.fn(async (_b: Uint8Array, _i: number, _d: number, _f: string, _o: { priority?: string }) => rendered(png));
    await runTool('pdf-to-images', [pdf('B.pdf', B3, 3)], { pages: '1', format: 'png', dpi: 150 }, ctx, { ...deps, renderPage });
    expect(renderPage.mock.calls[0][4]).toMatchObject({ priority: 'run' });
  });
});

// ---- the list moving on, verification and limits -------------------------------------------

describe('engagement and session changes', () => {
  it('adds nothing, silently, when the engagement changes during a run', async () => {
    const { store, ctx, deps } = setup();
    const mergePdfs = vi.fn(async (parts: Uint8Array[]) => {
      store.setContext('u1:B');
      return (await import('@/lib/pdf-tools/organise')).mergePdfs(parts);
    });
    const result = await runTool('merge', [pdf('A.pdf', A2, 2), pdf('B.pdf', B3, 3)], {}, ctx, { ...deps, mergePdfs });
    expect(result).toMatchObject({ status: 'stale', added: 0 });
    expect(result.message).toBeUndefined();
    expect(store.getState().files).toEqual([]);
    store.setContext('u1:A');
    expect(store.getState().files).toEqual([]);
  });

  it('adds nothing when the same engagement comes back as a new session', async () => {
    const { store, ctx, deps } = setup();
    const renderPage = vi.fn(async (_b: Uint8Array, index: number) => {
      if (index === 0) {
        store.setContext(null);
        store.setContext('u1:A');
      }
      return { bytes: png, width: 40, height: 20, mimeType: 'image/png' as const, dpi: 150, reduced: false };
    });
    const result = await runTool('pdf-to-images', [pdf('B.pdf', B3, 3)], { pages: 'all', format: 'png', dpi: 150 }, ctx, { ...deps, renderPage });
    expect(result.status).toBe('stale');
    expect(renderPage).toHaveBeenCalledTimes(1);
    expect(store.getState().files).toEqual([]);
  });

  it('stays silent even when a failure follows the change', async () => {
    const { store, ctx, deps } = setup();
    const deletePages = vi.fn(async () => {
      store.setContext('u1:B');
      throw new PdfToolsError('not-a-pdf', 'This file could not be read as a PDF. It may be damaged.');
    });
    const result = await runTool('delete-pages', [pdf('B.pdf', B3, 3)], { pages: '1' }, ctx, { ...deps, deletePages });
    expect(result.status).toBe('stale');
  });

  it('does not start when the session captured at Run is already old', async () => {
    const { store, ctx, deps } = setup();
    store.setContext('u1:B');
    const mergePdfs = vi.fn();
    const result = await runTool('merge', [pdf('A.pdf', A2, 2), pdf('B.pdf', B3, 3)], {}, ctx, { ...deps, mergePdfs });
    expect(result.status).toBe('stale');
    expect(mergePdfs).not.toHaveBeenCalled();
  });
});

describe('cancel', () => {
  it('does not start when already cancelled', async () => {
    const { controller, ctx, deps, files } = setup();
    controller.abort();
    expect((await runTool('merge', [pdf('A.pdf', A2, 2), pdf('B.pdf', B3, 3)], {}, ctx, deps)).status).toBe('cancelled');
    expect(files()).toEqual([]);
  });

  it('adds nothing when cancelled while the last step finishes', async () => {
    const { controller, ctx, deps, files } = setup();
    const extractPages = vi.fn(async (bytes: Uint8Array, indices: number[]) => {
      const out = await (await import('@/lib/pdf-tools/organise')).extractPages(bytes, indices);
      controller.abort();
      return out;
    });
    const result = await runTool('split', [pdf('B.pdf', B3, 3)], { mode: 'range', from: 1, to: 2 }, ctx, { ...deps, extractPages });
    expect(result.status).toBe('cancelled');
    expect(files()).toEqual([]);
  });
});

describe('verification', () => {
  it('does not add a result that does not open', async () => {
    const { ctx, deps, files } = setup();
    const mergePdfs = vi.fn(async () => new TextEncoder().encode('%PDF-1.7 not really'));
    await expect(runTool('merge', [pdf('A.pdf', A2, 2), pdf('B.pdf', B3, 3)], {}, ctx, { ...deps, mergePdfs })).rejects.toThrow(
      'The result could not be verified and was not added.',
    );
    expect(files()).toEqual([]);
  });

  it('does not add a result with the wrong number of pages', async () => {
    const { ctx, deps, files } = setup();
    const extractPages = vi.fn(async () => makePdf('X', 1));
    await expect(runTool('split', [pdf('B.pdf', B3, 3)], { mode: 'range', from: 1, to: 2 }, ctx, { ...deps, extractPages })).rejects.toMatchObject({
      code: 'unverified',
    });
    expect(files()).toEqual([]);
  });

  it('does not add an image that is not the format asked for', async () => {
    const { ctx, deps, files } = setup();
    const renderPage = vi.fn(async () => ({ bytes: new Uint8Array([1, 2, 3]), width: 1, height: 1, mimeType: 'image/png' as const, dpi: 150, reduced: false }));
    await expect(runTool('pdf-to-images', [pdf('B.pdf', B3, 3)], { pages: '1', format: 'png', dpi: 150 }, ctx, { ...deps, renderPage })).rejects.toMatchObject({
      code: 'unverified',
    });
    expect(files()).toEqual([]);
  });
});

describe('limits and plain messages', () => {
  it('refuses results that would take the list over its limit', async () => {
    const { ctx, deps, files } = setup({ maxBytes: A2.byteLength });
    await expect(runTool('merge', [pdf('A.pdf', A2, 2), pdf('B.pdf', B3, 3)], {}, ctx, deps)).rejects.toMatchObject({ code: 'list-full' });
    expect(files()).toEqual([]);
  });

  it('never shows a raw library error', async () => {
    const { ctx, deps } = setup();
    const mergePdfs = vi.fn(async () => {
      throw new TypeError("Cannot read properties of undefined (reading 'lookup')");
    });
    const run = runTool('merge', [pdf('A.pdf', A2, 2), pdf('B.pdf', B3, 3)], {}, ctx, { ...deps, mergePdfs });
    await expect(run).rejects.toBeInstanceOf(PdfToolsError);
    await expect(run).rejects.not.toThrow(/lookup/);
  });

  it('refuses the wrong kind of input', async () => {
    const { ctx, deps } = setup();
    await expect(runTool('split', [image('a.png', png)], { mode: 'selected', pages: '1' }, ctx, deps)).rejects.toMatchObject({ code: 'wrong-input' });
    await expect(runTool('images-to-pdf', [pdf('A.pdf', A2, 2)], { pageSize: 'fit', marginPt: 0 }, ctx, deps)).rejects.toMatchObject({ code: 'wrong-input' });
  });

  it('reports progress', async () => {
    const { ctx, deps, progress } = setup();
    const renderPage = vi.fn(async () => ({ bytes: png, width: 40, height: 20, mimeType: 'image/png' as const, dpi: 150, reduced: false }));
    await runTool('pdf-to-images', [pdf('B.pdf', B3, 3)], { pages: 'all', format: 'png', dpi: 150 }, ctx, { ...deps, renderPage });
    expect(progress).toHaveBeenCalledWith(3, 3, expect.any(String));
  });
});

// ---- size limits and result names ------------------------------------------------------------

describe('size limits before the slow work', () => {
  it('refuses at once when the list is already full', async () => {
    const { store, ctx, deps } = setup({ maxBytes: A2.byteLength });
    store.addFiles('u1:A', [pdf('A.pdf', A2, 2)], ctx.session);
    const mergePdfs = vi.fn();
    const run = runTool('merge', [pdf('A.pdf', A2, 2), pdf('B.pdf', B3, 3)], {}, ctx, { ...deps, mergePdfs });
    await expect(run).rejects.toMatchObject({ code: 'list-full' });
    await expect(run).rejects.toThrow(/^The list is full/);
    expect(mergePdfs).not.toHaveBeenCalled();
  });

  it('refuses a merge before merging when its inputs alone would take the list over the limit', async () => {
    const { ctx, deps, files } = setup({ maxBytes: A2.byteLength });
    const mergePdfs = vi.fn();
    await expect(runTool('merge', [pdf('A.pdf', A2, 2), pdf('B.pdf', B3, 3)], {}, ctx, { ...deps, mergePdfs })).rejects.toMatchObject({ code: 'list-full' });
    expect(mergePdfs).not.toHaveBeenCalled();
    expect(files()).toEqual([]);
  });

  it('still checks the real size after the work', async () => {
    const inputs = A2.byteLength + B3.byteLength;
    const { ctx, deps, files } = setup({ maxBytes: inputs + 100 });
    const mergePdfs = vi.fn(async (parts: Uint8Array[]) => {
      const merged = await (await import('@/lib/pdf-tools/organise')).mergePdfs(parts);
      const padded = new Uint8Array(merged.length + inputs);
      padded.set(merged);
      return padded;
    });
    await expect(runTool('merge', [pdf('A.pdf', A2, 2), pdf('B.pdf', B3, 3)], {}, ctx, { ...deps, mergePdfs })).rejects.toMatchObject({ code: 'list-full' });
    expect(mergePdfs).toHaveBeenCalledTimes(1);
    expect(files()).toEqual([]);
  });

  it('says when the results take the list past the warning size, once', async () => {
    const first = setup({ warnBytes: 1 });
    expect((await runTool('merge', [pdf('A.pdf', A2, 2), pdf('B.pdf', B3, 3)], {}, first.ctx, first.deps)).listLarge).toBe(true);
    expect((await runTool('merge', [pdf('A.pdf', A2, 2), pdf('B.pdf', B3, 3)], {}, first.ctx, first.deps)).listLarge).toBe(false);
    const roomy = setup();
    expect((await runTool('merge', [pdf('A.pdf', A2, 2), pdf('B.pdf', B3, 3)], {}, roomy.ctx, roomy.deps)).listLarge).toBe(false);
  });
});

describe('result names are never repeated in the list', () => {
  it('numbers a result whose name the list already holds, and says so', async () => {
    const { ctx, deps, files } = setup();
    await runTool('merge', [pdf('A.pdf', A2, 2), pdf('B.pdf', B3, 3)], {}, ctx, deps);
    const second = await runTool('merge', [pdf('A.pdf', A2, 2), pdf('B.pdf', B3, 3)], {}, ctx, deps);
    expect(files().map((f) => f.name)).toEqual(['A_merged.pdf', 'A_merged (2).pdf']);
    expect(second.message).toBe('Merged 2 files into A_merged (2).pdf');
  });

  it('numbers every part of a second split', async () => {
    const { ctx, deps, files } = setup();
    await runTool('split', [pdf('C.pdf', C5, 5)], { mode: 'every', every: 3 }, ctx, deps);
    const second = await runTool('split', [pdf('C.pdf', C5, 5)], { mode: 'every', every: 3 }, ctx, deps);
    expect(files().map((f) => f.name)).toEqual(['C_part_01.pdf', 'C_part_02.pdf', 'C_part_01 (2).pdf', 'C_part_02 (2).pdf']);
    expect(second.detail).toBe('C_part_01 (2).pdf to C_part_02 (2).pdf.');
  });

  it('gives every part of a group the same number, even when the group is larger than the first', async () => {
    const { ctx, deps, files } = setup();
    await runTool('split', [pdf('C.pdf', C5, 5)], { mode: 'every', every: 3 }, ctx, deps);
    await runTool('split', [pdf('C.pdf', C5, 5)], { mode: 'every', every: 2 }, ctx, deps);
    const second = files().slice(2);
    expect(second.map((f) => f.name)).toEqual(['C_part_01 (2).pdf', 'C_part_02 (2).pdf', 'C_part_03 (2).pdf']);
    expect(groupTitle(second).title).toBe('C — 3 parts');
  });

  it('numbers each repeat of a run as one group: (2), then (3)', async () => {
    const { ctx, deps, files } = setup();
    for (let i = 0; i < 3; i++) await runTool('split', [pdf('C.pdf', C5, 5)], { mode: 'every', every: 2 }, ctx, deps);
    expect(files().map((f) => f.name)).toEqual([
      'C_part_01.pdf',
      'C_part_02.pdf',
      'C_part_03.pdf',
      'C_part_01 (2).pdf',
      'C_part_02 (2).pdf',
      'C_part_03 (2).pdf',
      'C_part_01 (3).pdf',
      'C_part_02 (3).pdf',
      'C_part_03 (3).pdf',
    ]);
    for (const group of [files().slice(0, 3), files().slice(3, 6), files().slice(6)]) expect(groupTitle(group).title).toBe('C — 3 parts');
  });

  it('numbers a whole group of capped names alike, within 120 characters', async () => {
    const { ctx, deps, files } = setup();
    const long = `${'L'.repeat(200)}.pdf`;
    await runTool('split', [pdf(long, C5, 5)], { mode: 'every', every: 3 }, ctx, deps);
    await runTool('split', [pdf(long, C5, 5)], { mode: 'every', every: 2 }, ctx, deps);
    const second = files().slice(2);
    expect(second.every((f) => f.name.length <= 120)).toBe(true);
    expect(second.map((f) => f.name.slice(-16))).toEqual(['_part_01 (2).pdf', '_part_02 (2).pdf', '_part_03 (2).pdf']);
    expect(groupTitle(second).title).toMatch(/^L+ — 3 parts$/);
  });

  it('compares without case, also within one run', async () => {
    const { ctx, deps, files } = setup();
    const compressPdf = vi.fn(async (bytes: Uint8Array) => ({ bytes: A2, originalSize: bytes.byteLength * 2, newSize: A2.byteLength, imagesFound: 1, imagesReplaced: 1 }));
    await runTool('compress', [pdf('scan.pdf', A2.slice(), 2), pdf('Scan.PDF', A2.slice(), 2)], { level: 'recommended' }, ctx, { ...deps, compressPdf });
    expect(files().map((f) => f.name)).toEqual(['scan_compressed.pdf', 'Scan_compressed (2).pdf']);
  });

  it('keeps the part number of a 120-character name when it numbers it', async () => {
    const { ctx, deps, files } = setup();
    const long = `${'L'.repeat(200)}.pdf`;
    await runTool('split', [pdf(long, C5, 5)], { mode: 'every', every: 3 }, ctx, deps);
    await runTool('split', [pdf(long, C5, 5)], { mode: 'every', every: 3 }, ctx, deps);
    const second = files().slice(2).map((f) => f.name);
    expect(second.every((name) => name.length <= 120)).toBe(true);
    expect(second.map((name) => name.slice(-16))).toEqual(['_part_01 (2).pdf', '_part_02 (2).pdf']);
  });
});

describe('compressing several files', () => {
  const smaller = (bytes: Uint8Array) => ({ bytes: A2, originalSize: bytes.byteLength * 2, newSize: A2.byteLength, imagesFound: 1, imagesReplaced: 1 });
  const recodeFailed = () => new PdfToolsError('recode-failed', 'The images in this file could not be processed, so it was not compressed.');

  it('keeps the files that compressed when another fails, and names the failure and its reason', async () => {
    const { ctx, deps, files } = setup();
    const two = A2.slice();
    const compressPdf = vi.fn(async (bytes: Uint8Array) => {
      if (bytes === two) throw recodeFailed();
      return smaller(bytes);
    });
    const inputs = [pdf('One.pdf', A2.slice(), 2), pdf('Two.pdf', two, 2), pdf('Three.pdf', A2.slice(), 2)];
    const result = await runTool('compress', inputs, { level: 'recommended' }, ctx, { ...deps, compressPdf });
    expect(compressPdf).toHaveBeenCalledTimes(3);
    expect(files().map((f) => f.name)).toEqual(['One_compressed.pdf', 'Three_compressed.pdf']);
    expect(result.tone).toBe('warning');
    expect(result.message).toBe('Compressed 2 of 3 files');
    expect(result.detail).toContain('Not compressed: Two.pdf (The images in this file could not be processed, so it was not compressed.)');
  });

  it('names every file and reason when none could be compressed', async () => {
    const { ctx, deps, files } = setup();
    const compact = A2.slice();
    const compressPdf = vi.fn(async (bytes: Uint8Array) => {
      if (bytes === compact) return { ...smaller(bytes), bytes: null };
      throw recodeFailed();
    });
    const run = runTool('compress', [pdf('One.pdf', compact, 2), pdf('Two.pdf', A2.slice(), 2)], { level: 'low' }, ctx, { ...deps, compressPdf });
    await expect(run).rejects.toThrow(
      'No file was compressed. Not compressed: Two.pdf (The images in this file could not be processed, so it was not compressed.) Already compact at this level: One.pdf.',
    );
    expect(files()).toEqual([]);
  });

  it('a file that fails verification is named too', async () => {
    const { ctx, deps, files } = setup();
    const broken = A2.slice();
    const compressPdf = vi.fn(async (bytes: Uint8Array) => (bytes === broken ? { ...smaller(bytes), bytes: new TextEncoder().encode('%PDF-1.7 no') } : smaller(bytes)));
    const result = await runTool('compress', [pdf('Good.pdf', A2.slice(), 2), pdf('Bad.pdf', broken, 2)], { level: 'recommended' }, ctx, { ...deps, compressPdf });
    expect(files().map((f) => f.name)).toEqual(['Good_compressed.pdf']);
    expect(result.detail).toContain('Not compressed: Bad.pdf (The result could not be verified and was not added.)');
  });
});

describe('delete pages with a page typed twice', () => {
  it('removes it once', async () => {
    const { ctx, deps, files } = setup();
    await runTool('delete-pages', [pdf('B.pdf', B3, 3)], { pages: '1, 1' }, ctx, deps);
    const [made] = files();
    expect(made.pageCount).toBe(2);
    expect(made.operation!.summary).toBe('Deleted page 1');
    expect(await pageTexts(made.bytes)).toEqual(['B p2', 'B p3']);
  });
});

// ---- a result made from results carries its history ------------------------------------------

describe('results made from results', () => {
  const SHA = 'cd'.repeat(32);
  /** Runs a tool and returns the rows it added. */
  async function made(h: ReturnType<typeof setup>, ...args: Parameters<typeof runTool>): Promise<WorkingFile[]> {
    const result = await runTool(args[0], args[1], args[2], h.ctx, { ...h.deps, ...args[4] });
    expect(result.status).toBe('added');
    return h.files().filter((f) => result.ids.includes(f.id));
  }
  const compressTo = (bytes: Uint8Array) => vi.fn(async (input: Uint8Array) => ({ bytes, originalSize: input.byteLength * 4, newSize: bytes.byteLength, imagesFound: 1, imagesReplaced: 1 }));
  const numbers = (pageCount: number) => ({ numbers: { ...defaultPageNumberOptions(pageCount) } });

  it('a vault file compressed, numbered and split names every step and the vault record in the entry', async () => {
    const h = setup();
    const vault = pdf('x.pdf', B3, 3, { origin: 'vault', evidenceId: 'ev-9' });
    const [compressed] = await made(h, 'compress', [vault], { level: 'recommended' }, h.ctx, { compressPdf: compressTo(B3.slice()) });
    const [numbered] = await made(h, 'page-numbers', [compressed], numbers(3), h.ctx);
    const [part] = await made(h, 'split', [numbered], { mode: 'range', from: 1, to: 2 }, h.ctx);
    expect(part.name).toBe('x_compressed_numbered_pages_1-2.pdf');
    const entry = buildActivityEntry({ file: part, destination: 'vault', sha256: SHA, vaultRecordId: 'ev-10' });
    expect(entry.details).toMatch(
      /^Split pages 1-2 → x_compressed_numbered_pages_1-2\.pdf \(2 pages, SHA-256 cdcdcdcdcdcd…\)\. Sources: x_compressed_numbered\.pdf \[result\]\. Earlier steps: Compressed, Recommended \(75% smaller: .+ → .+\) → x_compressed\.pdf; Added page numbers → x_compressed_numbered\.pdf\. Original sources: x\.pdf \[vault\]\. Destination: Evidence Vault\.$/,
    );
    expect(entry.metadata).toMatchObject({
      earlierSteps: [
        { tool: 'compress', resultName: 'x_compressed.pdf', options: { level: 'recommended' } },
        { tool: 'page-numbers', summary: 'Added page numbers', resultName: 'x_compressed_numbered.pdf' },
      ],
      originalSources: [{ name: 'x.pdf', origin: 'vault', evidenceId: 'ev-9' }],
    });
    // a one-step result's entry is as before
    const first = buildActivityEntry({ file: compressed, destination: 'vault', sha256: SHA, vaultRecordId: 'ev-11' });
    expect(first.details).toMatch(/^Compressed, Recommended \(75% smaller: .+\) → x_compressed\.pdf \(3 pages, SHA-256 cdcdcdcdcdcd…\)\. Sources: x\.pdf \[vault\]\. Destination: Evidence Vault\.$/);
    expect(first.metadata).not.toHaveProperty('earlierSteps');
  });

  it('a merge of two results with their own history keeps both histories and every original source', async () => {
    const h = setup();
    const [aSmall] = await made(h, 'compress', [pdf('A.pdf', A2, 2)], { level: 'extreme' }, h.ctx, { compressPdf: compressTo(A2.slice()) });
    const [aNumbered] = await made(h, 'page-numbers', [aSmall], numbers(2), h.ctx);
    const [bPart] = await made(h, 'split', [pdf('B.pdf', B3, 3, { origin: 'vault', evidenceId: 'ev-b' })], { mode: 'range', from: 1, to: 2 }, h.ctx);
    const [bNumbered] = await made(h, 'page-numbers', [bPart], numbers(2), h.ctx);
    const [merged] = await made(h, 'merge', [aNumbered, bNumbered], {}, h.ctx);
    expect(merged.operation!.sources).toMatchObject([
      { name: 'A_compressed_numbered.pdf', origin: 'result' },
      { name: 'B_pages_1-2_numbered.pdf', origin: 'result' },
    ]);
    expect(merged.operation!.earlier!.map((s) => s.resultName)).toEqual(['A_compressed.pdf', 'A_compressed_numbered.pdf', 'B_pages_1-2.pdf', 'B_pages_1-2_numbered.pdf']);
    expect(merged.operation!.originalSources).toMatchObject([
      { name: 'A.pdf', origin: 'computer' },
      { name: 'B.pdf', origin: 'vault', evidenceId: 'ev-b' },
    ]);
    const entry = buildActivityEntry({ file: merged, destination: 'computer', sha256: SHA });
    expect(entry.details).toContain('Original sources: A.pdf [computer]; B.pdf [vault].');
  });

  it('a chain longer than the entry lists names the last ten steps and counts the rest', async () => {
    const h = setup();
    let current = pdf('A.pdf', A2, 2);
    for (let i = 0; i < 12; i++) [current] = await made(h, 'page-numbers', [current], { ...numbers(2), name: `step ${i + 1}` }, h.ctx);
    const entry = buildActivityEntry({ file: current, destination: 'computer', sha256: SHA });
    expect(entry.details).toContain('Earlier steps: Added page numbers → step 2.pdf;');
    expect(entry.details).toContain('Added page numbers → step 11.pdf (and 1 earlier step). Original sources: A.pdf [computer].');
    expect(entry.metadata.earlierSteps).toHaveLength(10);
    expect(entry.metadata.earlierStepsNotListed).toBe(1);
  });
});

// ---- signatures, forms and bookmarks in results ------------------------------------------------

describe('what a result says about the signature, the form and the bookmarks of its sources', () => {
  let signed: Uint8Array;
  let realSigned: Uint8Array;
  let form: Uint8Array;
  let marked: Uint8Array;
  beforeAll(async () => {
    // a form flagged as signed, with no signature data in it
    const doc = await PDFDocument.load(await makePdf('S', 2));
    doc.catalog.set(PDFName.of('AcroForm'), doc.context.register(doc.context.obj({ Fields: [], SigFlags: 3 })));
    signed = await doc.save();
    realSigned = await makeFormPdf({ signature: true });
    form = await makeFormPdf();
    marked = await makeFormPdf({ bookmarks: true });
  }, 30_000);

  it('a compressed or numbered copy of a signed file is not "Signed": its signature is no longer valid, and the record says so', async () => {
    const h = setup();
    const source = pdf('S.pdf', signed, 2, { hasSignature: true });
    const compressPdf = vi.fn(async (input: Uint8Array) => ({ bytes: signed.slice(), originalSize: input.byteLength * 3, newSize: input.byteLength, imagesFound: 1, imagesReplaced: 1 }));
    await runTool('compress', [source], { level: 'recommended' }, h.ctx, { ...h.deps, compressPdf });
    await runTool('page-numbers', [source], { numbers: defaultPageNumberOptions(2) }, h.ctx, h.deps);
    for (const result of h.files()) {
      expect(result).toMatchObject({ hasSignature: false, signatureInvalid: true });
      expect(result.operation!.flags).toEqual({ signatureInvalid: true });
      expect(result.operation!.summary).toMatch(/; signature no longer valid$/);
    }
    // and a result of that result says the same
    await runTool('page-numbers', [h.files()[1]], { numbers: defaultPageNumberOptions(2) }, h.ctx, h.deps);
    expect(h.files()[2]).toMatchObject({ hasSignature: false, signatureInvalid: true });
  });

  it('a part, a page-deleted copy or a merge of a signed file says its signature is no longer valid, and so does a later step', async () => {
    const h = setup();
    await runTool('split', [pdf('S.pdf', signed, 2, { hasSignature: true })], { mode: 'range', from: 1, to: 1 }, h.ctx, h.deps);
    await runTool('split', [pdf('Real.pdf', realSigned, 3, { hasSignature: true })], { mode: 'range', from: 1, to: 1 }, h.ctx, h.deps);
    await runTool('delete-pages', [pdf('Real.pdf', realSigned, 3, { hasSignature: true })], { pages: '3' }, h.ctx, h.deps);
    await runTool('merge', [pdf('Real.pdf', realSigned, 3, { hasSignature: true }), pdf('A.pdf', A2, 2)], {}, h.ctx, h.deps);
    for (const result of h.files()) {
      expect(result).toMatchObject({ hasSignature: false, signatureInvalid: true });
      expect(result.operation!.summary).toMatch(/; signature no longer valid$/);
      expect(result.operation!.flags).toMatchObject({ signatureInvalid: true });
    }
    await runTool('page-numbers', [h.files()[1]], { numbers: defaultPageNumberOptions(1) }, h.ctx, h.deps);
    expect(h.files()[4]).toMatchObject({ hasSignature: false, signatureInvalid: true });
    // a result of unsigned files carries no such mark
    await runTool('split', [pdf('A.pdf', A2, 2)], { mode: 'range', from: 1, to: 1 }, h.ctx, h.deps);
    expect(h.files()[5].signatureInvalid).toBeUndefined();
    expect(h.files()[5].operation!.summary).toBe('Split pages 1-1');
  });

  it('a merge of a form says the form fields were not carried; a split keeps them and says nothing', async () => {
    const h = setup();
    const formFile = pdf('Form.pdf', form, 3, { hasFormFields: true });
    const [merged] = (await runTool('merge', [formFile, pdf('A.pdf', A2, 2)], {}, h.ctx, h.deps)).ids.map((id) => h.files().find((f) => f.id === id)!);
    expect(merged.operation!.summary).toBe('Merged 2 files; form fields not carried');
    expect(merged.operation!.flags).toEqual({ formFieldsDropped: true });
    expect(buildActivityEntry({ file: merged, destination: 'computer', sha256: 'ab'.repeat(32) }).metadata).toMatchObject({ formFieldsDropped: true });
    await runTool('split', [formFile], { mode: 'range', from: 1, to: 2 }, h.ctx, h.deps);
    const part = h.files()[1];
    expect(part.operation!.summary).toBe('Split pages 1-2');
    expect(part.operation!.flags).toBeUndefined();
    expect(part.hasFormFields).toBe(true);
  });

  it('Split, Delete pages and Merge of a bookmarked file say the bookmarks were not carried', async () => {
    const h = setup();
    const source = pdf('Marked.pdf', marked, 3, { hasBookmarks: true, hasFormFields: true });
    await runTool('split', [source], { mode: 'selected', pages: '1' }, h.ctx, h.deps);
    await runTool('delete-pages', [source], { pages: '2' }, h.ctx, h.deps);
    await runTool('merge', [source, pdf('A.pdf', A2, 2)], {}, h.ctx, h.deps);
    expect(h.files().map((f) => f.operation!.summary)).toEqual([
      'Extracted page 1; bookmarks not carried',
      'Deleted page 2; bookmarks not carried',
      'Merged 2 files; form fields not carried; bookmarks not carried',
    ]);
    expect(h.files().map((f) => f.hasBookmarks)).toEqual([false, false, false]);
    // Compress and Page numbers keep the bookmarks and the form
    await runTool('page-numbers', [source], { numbers: defaultPageNumberOptions(3) }, h.ctx, h.deps);
    expect(h.files()[3]).toMatchObject({ hasBookmarks: true, hasFormFields: true });
    expect(h.files()[3].operation!.flags).toBeUndefined();
  });
});

// ---- pages whose resources could not be trimmed, and splitting into many parts -----------------

describe('resources kept whole, and Split every N part by part', () => {
  it('says when a page could not be read with certainty, so its resources were kept whole', async () => {
    const h = setup();
    const odd = await makeSharedResourcesPdf({ predictorOnPage1: true });
    const source = pdf('Odd.pdf', odd, 4);
    const deleted = await runTool('delete-pages', [source], { pages: '2, 4' }, h.ctx, h.deps);
    const [result] = h.files();
    expect(result).toMatchObject({ sharedResourcesKept: true });
    expect(result.operation!.flags).toEqual({ sharedResourcesKept: true });
    expect(result.operation!.summary).toBe('Deleted pages 2, 4; may still contain images or fonts of left-out pages');
    expect(deleted.tone).toBe('warning');
    expect(deleted.detail).toContain('The file may still contain images or fonts from pages that were left out.');
    // Split every page: only the part with that page says so
    await runTool('split', [source], { mode: 'every', every: 1 }, h.ctx, h.deps);
    expect(h.files().slice(1).map((f) => Boolean(f.sharedResourcesKept))).toEqual([true, false, false, false]);
    // a file that could be read says nothing
    await runTool('delete-pages', [pdf('Shared.pdf', await makeSharedResourcesPdf(), 4)], { pages: '2' }, h.ctx, h.deps);
    expect(h.files()[5].sharedResourcesKept).toBeUndefined();
  });

  it('Split every N shows each part and can be stopped between parts', async () => {
    const { controller, ctx, deps, files, progress } = setup();
    progress.mockImplementation((_done: number, _total: number, label?: string) => {
      if (label === 'Splitting… part 3 of 5') controller.abort();
    });
    const result = await runTool('split', [pdf('C.pdf', C5, 5)], { mode: 'every', every: 1 }, ctx, deps);
    expect(result.status).toBe('cancelled');
    expect(files()).toEqual([]);
    const labels = progress.mock.calls.map((c) => c[2]);
    expect(labels).toContain('Splitting… part 1 of 5');
    expect(labels).toContain('Splitting… part 3 of 5');
    expect(labels).not.toContain('Splitting… part 4 of 5');
  });

  it('Delete pages and Split (one result) show the pages as they are copied and can be stopped between pages', async () => {
    const runs = [
      ['delete-pages', { pages: '1' }, 'Copying the remaining pages (2 of 4)…', 'Copying the remaining pages (3 of 4)…'],
      ['split', { mode: 'range', from: 1, to: 4 }, 'Taking out the pages (2 of 4)…', 'Taking out the pages (3 of 4)…'],
    ] as const;
    for (const [tool, options, stopAt, notReached] of runs) {
      const { controller, ctx, deps, files, progress } = setup();
      progress.mockImplementation((_done: number, _total: number, label?: string) => {
        if (label === stopAt) controller.abort();
      });
      const result = await runTool(tool, [pdf('C.pdf', C5, 5)], options, ctx, deps);
      expect(result.status, tool).toBe('cancelled');
      expect(files(), tool).toEqual([]);
      const labels = progress.mock.calls.map((c) => c[2]);
      expect(labels, tool).toContain(stopAt);
      expect(labels, tool).not.toContain(notReached);
    }
  });
});

// ---- names that cannot be numbered the usual way ---------------------------------------------

describe('a name collision never ends the run as a damaged file', () => {
  it('numbers a result whose source name holds a line or paragraph separator', async () => {
    for (const separator of ['\u2028', '\u2029']) {
      const { ctx, deps, files } = setup();
      const inputs = [pdf(`a${separator}b.pdf`, A2, 2), pdf('B.pdf', B3, 3)];
      await runTool('merge', inputs, {}, ctx, deps);
      const second = await runTool('merge', inputs, {}, ctx, deps);
      expect(second.status).toBe('added');
      expect(files().map((f) => f.name)).toEqual(['a_b_merged.pdf', 'a_b_merged (2).pdf']);
    }
  });

  it('falls back to a plain unique name when numbering a name fails', () => {
    const taken = [pdf('x.pdf', A2, 2), pdf('result (2).pdf', A2, 2)];
    const throwing = () => {
      throw new TypeError('match is not iterable');
    };
    const named = withUniqueNames([pdf('x.pdf', A2, 2), { ...image('x.png', png), name: 'x.pdf', groupId: 'g' }, { ...image('x.png', png), name: 'y.png', groupId: 'g' }], taken, throwing);
    expect(named.map((f) => f.name)).toEqual(['result (3).pdf', 'result (2).png', 'y.png']);
  });
});
