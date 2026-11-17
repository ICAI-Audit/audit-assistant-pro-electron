import { PDFDocument } from 'pdf-lib';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { inspectPdf } from '@/lib/pdf-tools/inspect';
import { displayedPage } from '@/lib/pdf-tools/marks';
import { PAPERS, PT_PER_MM, type PageBoxOptions } from '@/lib/pdf-tools/pageBox';
import { makeStrayPdf } from '@/lib/pdf-tools/testMarksPdf';
import { makeBundlePdf } from '@/lib/pdf-tools/testPageBoxPdf';
import { makePdf, pageTexts } from '@/lib/pdf-tools/testPdf';
import { createWorkingListStore, LIST_MAX_BYTES, LIST_WARN_BYTES } from '@/lib/pdf-tools/workingList';
import { PdfToolsError, type WorkingFile } from '@/lib/pdf-tools/types';
import { BUILT, step, type PageBoxRunOptions } from './pageBoxRun';
import { Cancelled, Run, type RunContext, type StepDeps } from './toolStep';

vi.setConfig({ testTimeout: 120_000 });

let bundle: Uint8Array;
let letters: Uint8Array;
beforeAll(async () => {
  bundle = await makeBundlePdf();
  letters = await makePdf('L', 6, { size: [612, 792] });
  await pageTexts(letters); // pays the cold pdf.js import once
}, 120_000);

let seq = 0;
const pdf = (name: string, bytes: Uint8Array, pageCount: number, extra: Partial<WorkingFile> = {}): WorkingFile => ({
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
});

function harness() {
  const store = createWorkingListStore();
  store.setContext('u1:A');
  const controller = new AbortController();
  const progress = vi.fn();
  const ctx: RunContext = { contextKey: 'u1:A', session: store.getState().session, store, signal: controller.signal, onProgress: progress };
  const deps: StepDeps = { inspectPdf, paint: async () => undefined, yieldToUi: async () => undefined, newId: () => `id-${++seq}`, maxBytes: LIST_MAX_BYTES, warnBytes: LIST_WARN_BYTES };
  // The tool's id is registered by the integration (Registration for the lead); the run does not depend on it.
  return { store, controller, progress, ctx, deps, run: new Run('resize-crop', ctx, deps) };
}

const A4 = { width: PAPERS.a4.width, height: PAPERS.a4.height };
const resize = (over: Partial<Extract<PageBoxOptions, { mode: 'resize' }>> = {}, pages = { from: 1, to: 8 }): PageBoxRunOptions => ({
  options: { mode: 'resize', size: A4, direction: 'keep', enlarge: false, margin: 0, pages, ...over },
});
const mm = (v: number) => v * PT_PER_MM;

describe('Resize or crop pages: the run step', () => {
  it('is built', () => {
    expect(BUILT).toBe(true);
  });

  it('resizes the chosen pages to A4, names the result _resized, says what changed and records counts and choices only', async () => {
    const { run } = harness();
    const source = pdf('Bundle.pdf', bundle, 8);
    const made = await step(run, [source], resize());
    const [file] = made.files;
    expect(file.name).toBe('Bundle_resized.pdf');
    expect(file.pageCount).toBe(8);
    const doc = await PDFDocument.load(file.bytes);
    for (const page of doc.getPages()) {
      const d = displayedPage(page);
      expect([Math.min(d.width, d.height), Math.max(d.width, d.height)]).toEqual([A4.width, A4.height]);
    }
    expect(file.hasFormFields).toBe(true);
    expect(file.hasBookmarks).toBe(true);
    expect(file.hasAttachments).toBe(true);
    expect(file.operation?.summary).toBe('Resized 7 pages to A4, 1 already A4; 1 page to check');
    expect(file.operation?.options).toEqual({ mode: 'resize', size: 'A4', direction: 'keep', enlarge: false, marginMm: 0, pages: 'all', changed: 7, unchanged: 1, pagesToCheck: 1 });
    const said = made.describe([file]);
    expect(said.message).toBe('Made Bundle_resized.pdf');
    expect(said.detail).toBe(
      '7 pages resized to A4; 1 was already A4 and is unchanged. Check page 1: a comment or measurement on it may not have resized exactly.',
    );
    expect(said.tone).toBe('warning');
    expect(source.bytes).toBe(bundle);
  });

  it('trims the chosen pages, names the result _cropped and says that trimmed parts are hidden, not removed', async () => {
    const { run } = harness();
    const made = await step(run, [pdf('Ledger.pdf', letters, 6)], { options: { mode: 'trim', sides: { left: mm(10), top: mm(5), right: mm(10), bottom: mm(5) }, mirror: false, pages: { from: 2, to: 3 } } });
    const [file] = made.files;
    expect(file.name).toBe('Ledger_cropped.pdf');
    const doc = await PDFDocument.load(file.bytes);
    expect(displayedPage(doc.getPage(0)).width).toBe(612);
    expect(displayedPage(doc.getPage(1)).width).toBeCloseTo(612 - mm(20), 2);
    expect(file.operation?.summary).toBe('Trimmed 2 pages: left 10 mm, top 5 mm, right 10 mm, bottom 5 mm');
    expect(made.describe([file])).toEqual({ message: 'Made Ledger_cropped.pdf', detail: '2 pages trimmed; the trimmed parts are hidden, not removed.', tone: 'success' });
  });

  it('adds margins, names the result _with_margins and keeps a typed name', async () => {
    const { run } = harness();
    const made = await step(run, [pdf('Ledger.pdf', letters, 6)], { options: { mode: 'margin', sides: { left: mm(15), top: mm(15), right: mm(15), bottom: mm(15) }, mirror: true, pages: { from: 1, to: 6 } } });
    expect(made.files[0].name).toBe('Ledger_with_margins.pdf');
    expect(made.describe(made.files).detail).toBe('Margins added to 6 pages.');
    expect(made.files[0].operation?.summary).toBe('Added margins to 6 pages: 15 mm on every edge, mirrored on even pages');
    const named = await step(harness().run, [pdf('Ledger.pdf', letters, 6)], { ...resize({}, { from: 1, to: 6 }), name: 'Audit bundle' });
    expect(named.files[0].name).toBe('Audit bundle.pdf');
  });

  it('makes nothing when every chosen page is already that size, and says so', async () => {
    const { run } = harness();
    const a4 = await makePdf('A', 2, { size: [595.28, 841.89] });
    const made = await step(run, [pdf('Already.pdf', a4, 2)], resize({}, { from: 1, to: 2 }));
    expect(made.files).toEqual([]);
    expect(made.describe([])).toEqual({ message: 'Nothing to change: every chosen page is already A4. Nothing was added.' });
  });

  it('a custom size is named in mm in the record and the message', async () => {
    const { run } = harness();
    const made = await step(run, [pdf('Ledger.pdf', letters, 6)], resize({ size: { width: mm(200), height: mm(300) } }, { from: 1, to: 1 }));
    expect(made.files[0].operation?.summary).toBe('Resized 1 page to 200 × 300 mm');
    expect(made.describe(made.files).detail).toBe('1 page resized to 200 × 300 mm.');
  });

  it('refuses what the library refuses, naming the page, and says that nothing was added', async () => {
    const { run } = harness();
    const receipt = await makePdf('R', 2, { size: [226.77, 340.16] });
    const attempt = step(run, [pdf('Receipt.pdf', receipt, 2)], { options: { mode: 'trim', sides: { left: mm(36), top: 0, right: mm(36), bottom: 0 }, mirror: false, pages: { from: 1, to: 2 } } });
    await expect(attempt).rejects.toBeInstanceOf(PdfToolsError);
    await expect(attempt).rejects.toThrow('Trimming that much leaves less than 10 mm of page 1. Use smaller values. Nothing was added.');
    await expect(step(run, [pdf('L.pdf', letters, 6)], resize({}, { from: 4, to: 9 }))).rejects.toThrow('Enter a page range between 1 and 6, with the first page not after the last. Nothing was added.');
    await expect(step(run, [pdf('L.pdf', letters, 6)], { options: undefined as never })).rejects.toThrow('Choose whether to resize the pages or to trim or add margins. Nothing was added.');
  });

  it('marks a result of a signed file "signature no longer valid"', async () => {
    const { run } = harness();
    const made = await step(run, [pdf('Signed.pdf', letters, 6, { hasSignature: true })], resize({}, { from: 1, to: 6 }));
    expect(made.files[0].signatureInvalid).toBe(true);
    expect(made.files[0].operation?.flags).toEqual({ signatureInvalid: true });
  });

  it('a page whose drawing is damaged is kept, named in the message and counted in the record', async () => {
    const { run } = harness();
    const made = await step(run, [pdf('Odd.pdf', await makeStrayPdf('extra-q'), 1)], resize({}, { from: 1, to: 1 }));
    const said = made.describe(made.files);
    expect(said.tone).toBe('warning');
    expect(said.detail).toContain('Check page 1: its content could not be read exactly, so it may look different.');
    expect(made.files[0].operation?.options.pagesToCheck).toBe(1);
  });

  it('stops between pages when the user stops the run, and adds nothing', async () => {
    const { run, controller, progress } = harness();
    progress.mockImplementation((done: number) => {
      if (done === 2) controller.abort();
    });
    await expect(step(run, [pdf('Long.pdf', letters, 6)], resize({}, { from: 1, to: 6 }))).rejects.toBeInstanceOf(Cancelled);
  });

  it('shows the steps: the pages one by one, then writing the file', async () => {
    const { run, progress } = harness();
    await step(run, [pdf('Long.pdf', letters, 6)], resize({}, { from: 1, to: 6 }));
    const labels = progress.mock.calls.map((c) => c[2]);
    expect(labels).toContain('Resizing page 1 of 6…');
    expect(labels).toContain('Writing the file…');
  });
});
