// FIX-A2 follow-up (INT3 concern 1): every phase 2 run step passes the run's own check to the library's read
// of the source (`check`, which pdf-lib's paced load asks at each wait), so a Stop pressed while the file is
// still being read ends the run there, not when the read is over. Each library double below presses Stop and
// then asks the check as the load would; with the check passed, the real work is never entered.
import { PDFDocument } from 'pdf-lib';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { PAPERS } from '@/lib/pdf-tools/pageBox';
import { makeOutlinePdf } from '@/lib/pdf-tools/testOutlinePdf';
import { makePdf } from '@/lib/pdf-tools/testPdf';
import type { WorkingFile } from '@/lib/pdf-tools/types';
import { WATERMARK_DEFAULTS } from '@/lib/pdf-tools/watermark';
import { createWorkingListStore } from '@/lib/pdf-tools/workingList';
import { runTool, type RunContext } from './runTool';

vi.setConfig({ testTimeout: 60_000 });

const press = vi.hoisted(() => ({ stop: (): void => undefined, entered: 0 }));

/** What a library does first when its file is read: Stop is pressed, then the load asks the run's check. */
function readStarts(hooks: { check?: () => void } | undefined): void {
  press.stop();
  hooks?.check?.();
  press.entered++;
}

vi.mock('@/lib/pdf-tools/organise', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/pdf-tools/organise')>();
  return {
    ...real,
    splitParts: async (...args: Parameters<typeof real.splitParts>) => {
      readStarts(args[2]);
      return real.splitParts(...args);
    },
    splitAtBookmarks: async (...args: Parameters<typeof real.splitAtBookmarks>) => {
      readStarts(args[1]);
      return real.splitAtBookmarks(...args);
    },
  };
});
vi.mock('@/lib/pdf-tools/pageOrder', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/pdf-tools/pageOrder')>();
  return {
    ...real,
    organisePages: async (...args: Parameters<typeof real.organisePages>) => {
      readStarts(args[2]);
      return real.organisePages(...args);
    },
  };
});
vi.mock('@/lib/pdf-tools/watermark', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/pdf-tools/watermark')>();
  return {
    ...real,
    addWatermark: async (...args: Parameters<typeof real.addWatermark>) => {
      readStarts(args[2]);
      return real.addWatermark(...args);
    },
  };
});
vi.mock('@/lib/pdf-tools/pageBox', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/pdf-tools/pageBox')>();
  return {
    ...real,
    changePageBoxes: async (...args: Parameters<typeof real.changePageBoxes>) => {
      readStarts(args[2]);
      return real.changePageBoxes(...args);
    },
  };
});
vi.mock('@/lib/pdf-tools/bookmarks', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/pdf-tools/bookmarks')>();
  return {
    ...real,
    applyBookmarks: async (...args: Parameters<typeof real.applyBookmarks>) => {
      readStarts(args[2]);
      return real.applyBookmarks(...args);
    },
  };
});

let seq = 0;
const pdf = (name: string, bytes: Uint8Array, pageCount: number): WorkingFile => ({
  id: `in-${++seq}`, name, kind: 'pdf', mimeType: 'application/pdf', origin: 'computer', bytes, size: bytes.byteLength, pageCount, wasProtected: false, hasRestrictions: false, hasSignature: false, sentTo: [],
});

let five: WorkingFile;
let marked: WorkingFile;
beforeAll(async () => {
  five = pdf('Five.pdf', await makePdf('F', 5), 5);
  const outline = await makeOutlinePdf();
  marked = pdf('Marked.pdf', outline, (await PDFDocument.load(outline)).getPageCount());
});

describe('Stop while the source is read: every phase 2 run step passes its check to the read', () => {
  const ctxFor = () => {
    const store = createWorkingListStore();
    store.setContext('u1:A');
    const controller = new AbortController();
    const ctx: RunContext = { contextKey: 'u1:A', session: store.getState().session, store, signal: controller.signal, onProgress: () => undefined };
    return { store, controller, ctx };
  };
  const cases: [string, Parameters<typeof runTool>[0], () => WorkingFile[], unknown][] = [
    ['Split into ranges', 'split', () => [five], { mode: 'ranges', pages: '1-2, 3-5' }],
    ['Split at bookmarks', 'split', () => [marked], { mode: 'bookmarks' }],
    ['Organise pages', 'organise-pages', () => [five], { plan: { order: [1, 0, 2, 3, 4], turns: {} } }],
    ['Watermark', 'watermark', () => [five], { options: { watermark: { ...WATERMARK_DEFAULTS.watermark, placement: { ...WATERMARK_DEFAULTS.watermark.placement } }, pages: { from: 1, to: 5 }, tokens: { date: '16-11-2026', client: 'ABC Ltd' } } }],
    ['Resize', 'resize-crop', () => [five], { options: { mode: 'resize', size: { width: PAPERS.a4.width, height: PAPERS.a4.height }, direction: 'keep', enlarge: true, margin: 0, pages: { from: 1, to: 5 } } }],
    ['Bookmarks', 'bookmarks', () => [five], { items: [{ title: 'Start', page: 0, open: false, children: [] }] }],
  ];

  for (const [name, tool, inputs, options] of cases) {
    it(`${name}: the run ends, nothing is added, the real work is never entered`, async () => {
      const { store, controller, ctx } = ctxFor();
      press.entered = 0;
      press.stop = () => controller.abort();
      const result = await runTool(tool, inputs(), options as never, ctx, { paint: async () => undefined, yieldToUi: async () => undefined });
      expect(result.status).toBe('cancelled');
      expect(store.getState().files).toEqual([]);
      expect(press.entered).toBe(0);
    });
  }
});
