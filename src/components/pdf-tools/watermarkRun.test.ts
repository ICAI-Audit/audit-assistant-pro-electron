import { beforeAll, describe, expect, it, vi } from 'vitest';
import { inspectPdf } from '@/lib/pdf-tools/inspect';
import { makeScanPdf, makeStrayPdf, solidPng } from '@/lib/pdf-tools/testMarksPdf';
import { makePdf, pageTexts } from '@/lib/pdf-tools/testPdf';
import { createWorkingListStore, LIST_MAX_BYTES, LIST_WARN_BYTES } from '@/lib/pdf-tools/workingList';
import { PdfToolsError, type WorkingFile } from '@/lib/pdf-tools/types';
import { WATERMARK_DEFAULTS, type WatermarkOptions } from '@/lib/pdf-tools/watermark';
import { runTool } from './runTool';
import { Cancelled, Run, type RunContext, type StepDeps } from './toolStep';
import { BUILT, step, type WatermarkRunOptions } from './watermarkRun';

vi.setConfig({ testTimeout: 60_000 });

let five: Uint8Array;
beforeAll(async () => {
  five = await makePdf('W', 5);
  await pageTexts(five); // pays the cold pdf.js import once
}, 60_000);

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
  return { store, controller, progress, ctx, deps, run: new Run('watermark', ctx, deps) };
}

const tokens = { date: '14-11-2026', client: 'ABC Ltd' };
const watermark = (over: Partial<NonNullable<WatermarkOptions['watermark']>> = {}) => ({ ...WATERMARK_DEFAULTS.watermark, placement: { anchor: 'center' as const, padPt: 20 }, ...over });
const stamp = (text: string) => ({ ...WATERMARK_DEFAULTS.stamp, placement: { anchor: 'top-right' as const, padPt: 20 }, text });
const opts = (options: Partial<WatermarkOptions>, extra: Partial<WatermarkRunOptions> = {}): WatermarkRunOptions => ({
  options: { pages: { from: 1, to: 5 }, tokens, watermark: watermark(), ...options },
  ...extra,
});

describe('watermark run step', () => {
  it('is built', () => {
    expect(BUILT).toBe(true);
  });

  it('marks every chosen page, names the result _watermarked and records choices only, never the texts as typed', async () => {
    const { run } = harness();
    const source = pdf('Ledger.pdf', five, 5);
    const made = await step(run, [source], opts({ watermark: watermark({ text: 'FOR {client}' }), stamp: stamp('PAID {date}') }));
    const [file] = made.files;
    expect(file.name).toBe('Ledger_watermarked.pdf');
    expect(file.pageCount).toBe(5);
    const texts = await pageTexts(file.bytes);
    expect(texts.every((t) => t.includes('FOR ABC Ltd') && t.includes('PAID 14-11-2026'))).toBe(true);
    expect(file.operation?.tool).toBe('watermark');
    expect(file.operation?.summary).toBe('Watermark (custom text), stamp (custom text), all pages');
    expect(file.operation?.options).toMatchObject({ pages: 'all', watermark: 'custom', watermarkLength: 12, watermarkUses: '{client}', stamp: 'custom', stampLength: 11, stampUses: '{date}', watermarkLayer: 'front', watermarkOpacity: 25 });
    for (const typed of ['ABC Ltd', 'FOR', 'PAID']) expect(JSON.stringify(file.operation)).not.toContain(typed);
    expect(file.operation?.flags).toBeUndefined();
    expect(made.describe([file])).toEqual({ message: 'Made Ledger_watermarked.pdf', detail: 'Watermark and stamp added to all 5 pages.', tone: 'success' });
    expect(source.bytes).toBe(five);
  });

  it('names a stamp or logo alone _stamped, keeps a typed name, and marks the first page only', async () => {
    const { run } = harness();
    const logo = { image: solidPng(40, 20, [0, 0, 200]), format: 'png' as const, ...WATERMARK_DEFAULTS.logo, placement: { anchor: 'top-left' as const, padPt: 20 } };
    const made = await step(run, [pdf('Bill.pdf', five, 5)], opts({ watermark: undefined, stamp: stamp('VERIFIED'), logo, pages: 'first' }));
    const [file] = made.files;
    expect(file.name).toBe('Bill_stamped.pdf');
    expect((await pageTexts(file.bytes)).map((t) => t.includes('VERIFIED'))).toEqual([true, false, false, false, false]);
    expect(file.operation?.summary).toBe('Stamp VERIFIED, logo, page 1');
    expect(file.operation?.options).toMatchObject({ stamp: 'VERIFIED', logo: true, logoPixelWidth: 40, logoPixelHeight: 20 });
    expect(made.describe([file]).detail).toBe('Stamp and logo added to page 1.');
    const named = await step(harness().run, [pdf('Bill.pdf', five, 5)], opts({ pages: { from: 2, to: 3 } }, { name: 'Audit copy' }));
    expect(named.files[0].name).toBe('Audit copy.pdf');
    expect(named.describe(named.files).detail).toBe('Watermark added to pages 2 to 3.');
  });

  it('flags a mark that may be misplaced on a damaged page and says so', async () => {
    const { run } = harness();
    const made = await step(run, [pdf('Odd.pdf', await makeStrayPdf('extra-q'), 1)], opts({ pages: { from: 1, to: 1 } }));
    const [file] = made.files;
    expect(file.operation?.flags).toEqual({ markMayBeMisplaced: true });
    const said = made.describe([file]);
    expect(said.tone).toBe('warning');
    expect(said.detail).toContain("A mark may be misplaced on page 1: the page's own drawing instructions are damaged or could not be read.");
  });

  it('warns after the run when a watermark behind the page may not be visible (a scan)', async () => {
    const { run } = harness();
    const made = await step(run, [pdf('Scan.pdf', await makeScanPdf(), 1)], opts({ watermark: watermark({ layer: 'behind' }), pages: { from: 1, to: 1 } }));
    const said = made.describe(made.files);
    expect(said.tone).toBe('warning');
    expect(said.detail).toContain('A watermark behind the page may not be visible on page 1: a scan, a picture or a solid background covers it.');
  });

  it('marks a result of a signed file "signature no longer valid"', async () => {
    const { run } = harness();
    const made = await step(run, [pdf('Signed.pdf', five, 5, { hasSignature: true })], opts({}));
    expect(made.files[0].signatureInvalid).toBe(true);
    expect(made.files[0].operation?.flags).toEqual({ signatureInvalid: true });
  });

  it('refuses options the library refuses, in its words, before reading the file', async () => {
    const { run } = harness();
    const attempt = step(run, [pdf('L.pdf', five, 5)], opts({ watermark: watermark({ text: 'Rs ₹ 10' }) }));
    await expect(attempt).rejects.toBeInstanceOf(PdfToolsError);
    await expect(attempt).rejects.toThrow('“₹” cannot be printed in the watermark text; use English letters, digits and common signs (write Rs. for ₹).');
    await expect(attempt).rejects.toThrow(/\(write Rs\. for ₹\)\. Nothing was added\.$/);
    // A stamp too large for a page is refused before anything is drawn, naming the page.
    const big = step(run, [pdf('L.pdf', five, 5)], opts({ watermark: undefined, stamp: { ...stamp('X'.repeat(60)), size: 72 } }));
    await expect(big).rejects.toThrow('The stamp does not fit on page 1. Use shorter text, a smaller size or a smaller distance from the edge. Nothing was added.');
    await expect(step(run, [pdf('L.pdf', five, 5)], opts({ pages: { from: 4, to: 9 } }))).rejects.toThrow('Enter a page range between 1 and 5, with the first page not after the last.');
    await expect(step(run, [pdf('L.pdf', five, 5)], { options: { ...opts({}).options, tokens: undefined as never } })).rejects.toThrow(
      'The date and client name for the marks are missing.',
    );
  });

  it('stops between pages when the user stops the run, and adds nothing', async () => {
    const { run, controller, progress } = harness();
    progress.mockImplementation((done: number) => {
      if (done === 2) controller.abort();
    });
    await expect(step(run, [pdf('Long.pdf', five, 5)], opts({}))).rejects.toBeInstanceOf(Cancelled);
  });

  it('runs through runTool and adds one result to the list', async () => {
    const { store, ctx } = harness();
    const source = pdf('Ledger.pdf', five, 5);
    const result = await runTool('watermark', [source], opts({ pages: { from: 1, to: 2 } }), ctx, { paint: async () => undefined, yieldToUi: async () => undefined });
    expect(result).toMatchObject({ status: 'added', added: 1, message: 'Made Ledger_watermarked.pdf', tone: 'success' });
    expect(store.getState().files.map((f) => f.name)).toEqual(['Ledger_watermarked.pdf']);
  });
});
