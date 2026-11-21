// The PDF to Excel run step (excelRun.ts) on the step contract of toolStep.ts: one PDF in, one .xlsx out
// as an office row. The words come from FND's fixtures (no PDF reader); the layout is FND's; the
// workbook is read back with exceljs. Every name and amount is invented.
import ExcelJS from 'exceljs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildActivityEntry } from '@/lib/pdf-tools/activity';
import { XLSX_MIME, type PackedWorkbook } from '@/lib/pdf-tools/excelBuild';
import { parseAmount } from '@/lib/pdf-tools/excelNumbers';
import { inspectPdf } from '@/lib/pdf-tools/inspect';
import type { PageWords, Segment } from '@/lib/pdf-tools/layout';
import { convertFixture, convertFixtureExpected, type ConvertFixtureName } from '@/lib/pdf-tools/testConvertPdf';
import { createWorkingListStore, LIST_MAX_BYTES, LIST_WARN_BYTES } from '@/lib/pdf-tools/workingList';
import { PdfToolsError, type WorkingFile } from '@/lib/pdf-tools/types';
import { runTool } from '../runTool';
import { Cancelled, Run, Stale, type RunContext, type StepDeps } from '../toolStep';
import type { WordsReader } from './pageWordsReader';
import { BUILT, createStep, step, WRITE_TIME_LIMIT_MS, writeOffThread, type ExcelRunOptions, type WriterWorker } from './excelRun';
import { RECORD_KEYS, SCANNED_MESSAGE, STEP_LABELS, TOO_MANY_PAGES_MESSAGE } from './excelForm';
import type { WriterReply } from './excelWrite.worker';

vi.setConfig({ testTimeout: 60_000 });
afterEach(() => vi.restoreAllMocks());

// The module's own step (the one runTool loads) reads with the application reader; here it reads the
// trial balance fixture's recorded words instead. Every other test passes its reader to createStep.
vi.mock('./pageWordsReader', async (original) => ({
  ...(await original<typeof import('./pageWordsReader')>()),
  openWordsReader: async (_file: Uint8Array, opts?: { signal?: AbortSignal }): Promise<WordsReader> => {
    const { convertFixture: made } = await import('@/lib/pdf-tools/testConvertPdf');
    const f = await made('trial-balance');
    return {
      pageCount: f.pages.length,
      page: async (i) => {
        if (opts?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        return { words: f.pages[i], segments: f.segments[i] };
      },
      close: () => undefined,
    };
  },
}));

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
  const labels: string[] = [];
  const progress = vi.fn((_d: number, _t: number, label?: string) => {
    if (label) labels.push(label);
  });
  const ctx: RunContext = { contextKey: 'u1:A', session: store.getState().session, store, signal: controller.signal, onProgress: progress };
  const deps: StepDeps = { inspectPdf, paint: async () => undefined, yieldToUi: async () => undefined, newId: () => `id-${++seq}`, maxBytes: LIST_MAX_BYTES, warnBytes: LIST_WARN_BYTES };
  return { store, controller, progress, labels, ctx, deps, run: new Run('pdf-to-excel', ctx, deps) };
}

/** A words reader over recorded pages (the test seam of createStep). */
function readerOf(pages: PageWords[], segments: Segment[][], onPage?: (i: number) => void) {
  const closed = vi.fn();
  const open = vi.fn(async (_file: Uint8Array, opts?: { signal?: AbortSignal }): Promise<WordsReader> => ({
    pageCount: pages.length,
    async page(i) {
      onPage?.(i);
      if (opts?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      return { words: pages[i], segments: segments[i] ?? [] };
    },
    close: closed,
  }));
  return { open, closed };
}

async function fixture(name: ConvertFixtureName) {
  const f = await convertFixture(name);
  return { ...f, ...readerOf(f.pages, f.segments), file: pdf('Statement.pdf', f.bytes, f.pages.length) };
}

async function readBack(bytes: Uint8Array) {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(Buffer.from(bytes) as unknown as ArrayBuffer);
  return book;
}

/** The sheet as rows of plain values (index 0 = column A). */
function rowsOf(ws: ExcelJS.Worksheet): (string | number | null)[][] {
  const out: (string | number | null)[][] = [];
  ws.eachRow({ includeEmpty: true }, (row, n) => {
    const values: (string | number | null)[] = [];
    for (let c = 1; c <= row.cellCount; c++) {
      const v = row.getCell(c).value;
      values.push(v === null || v === undefined ? null : (v as string | number));
    }
    out[n - 1] = values;
  });
  return Array.from(out, (r) => r ?? []);
}

const opts = (over: Partial<ExcelRunOptions> = {}): ExcelRunOptions => ({ sheets: 'one-sheet', ...over });

describe('PDF to Excel run step', () => {
  it('is built, and the default step reads with the application reader', () => {
    expect(BUILT).toBe(true);
    expect(typeof step).toBe('function');
  });

  it('makes one office row, <name>.xlsx, with every amount of the ruled statement as a number in its own column', async () => {
    const f = await fixture('statement-ruled');
    const expected = await convertFixtureExpected('statement-ruled');
    const { run } = harness();
    const made = await createStep(f.open)(run, [f.file], opts());
    expect(made.files).toHaveLength(1);
    const [row] = made.files;
    expect(row).toMatchObject({ name: 'Statement.xlsx', kind: 'office', mimeType: XLSX_MIME, pageCount: null, origin: 'result', hasSignature: false });
    expect(row.size).toBe(row.bytes.byteLength);
    expect(f.closed).toHaveBeenCalledTimes(1);

    const book = await readBack(row.bytes);
    expect(book.worksheets.map((w) => w.name)).toEqual(['All pages']);
    const rows = rowsOf(book.worksheets[0]);
    // Every data row of every page: its date, then each amount as a number in Debit, Credit or Balance.
    const dataRows = expected.rows.flat().filter((r) => /^\d\d-\d\d-2025$/.test(r[0]));
    expect(dataRows.length).toBeGreaterThan(50);
    let at = 0;
    for (const want of dataRows) {
      while (at < rows.length && !(rows[at][0] === want[0] && rows[at][5] === parseAmount(want[5])?.value)) at++;
      expect(at, `row for ${want[0]}`).toBeLessThan(rows.length);
      const got = rows[at];
      for (const c of [3, 4, 5]) expect(got[c] ?? '', `${want[0]} column ${c}`).toBe(want[c] === '' ? '' : parseAmount(want[c])!.value);
      at++;
    }
    // A cheque number with its leading zero stays text.
    const refs = rows.map((r) => r[2]).filter((v) => typeof v === 'string' && /^0\d+$/.test(v));
    expect(refs.length).toBeGreaterThan(0);

    const said = made.describe([row]);
    expect(said).toEqual({ message: 'Made Statement.xlsx', detail: expect.stringMatching(/^3 pages, 1 sheet, [\d,]+ rows\.$/), tone: 'success' });
  });

  it('puts a picture of the page on the sheet, once in the file however many pages show it', async () => {
    const f = await convertFixture('statement-ruled');
    const { encodePng } = await import('@/lib/pdf-tools/pdfPictures');
    const logo = { bytes: encodePng(new Uint8Array(16).fill(60), 4, 4, 1), type: 'png' as const, width: 4, height: 4 };
    const asked = vi.fn(() => logo);
    const open = async (): Promise<WordsReader> => ({
      pageCount: f.pages.length,
      // A logo in the top corner of every page, above the first line of text.
      page: async (i) => ({ words: f.pages[i], segments: f.segments[i] ?? [], extras: { pictures: [{ x0: 500, y0: 2, x1: 540, y1: 12 }] }, picture: asked }),
      close: () => undefined,
    });
    const { run } = harness();
    const made = await createStep(open)(run, [pdf('Statement.pdf', f.bytes, f.pages.length)], opts());
    const book = await readBack(made.files[0].bytes);
    expect(book.worksheets[0].getImages()).toHaveLength(f.pages.length);
    expect(new Set(book.worksheets[0].getImages().map((image) => image.imageId)).size).toBe(1);
    expect(asked).toHaveBeenCalledTimes(f.pages.length);
  });

  it('a scan with recognised text: the scan picture is not put on the sheet or asked for, the message says so and the record counts the page', async () => {
    const f = await convertFixture('statement-ruled');
    const { encodePng } = await import('@/lib/pdf-tools/pdfPictures');
    const scan = { bytes: encodePng(new Uint8Array(16).fill(60), 4, 4, 1), type: 'png' as const, width: 4, height: 4 };
    const asked = vi.fn(() => scan);
    const open = async (): Promise<WordsReader> => ({
      pageCount: f.pages.length,
      // Page 1 is a scan: every word is invisible text over one picture the size of the page. The other pages are as they were.
      page: async (i) => ({
        words: i === 0 ? { ...f.pages[i], words: f.pages[i].words.map((w) => ({ ...w, hidden: true as const })) } : f.pages[i],
        segments: f.segments[i] ?? [],
        extras: i === 0 ? { pictures: [{ x0: 0, y0: 0, x1: f.pages[i].width, y1: f.pages[i].height }] } : {},
        picture: asked,
      }),
      close: () => undefined,
    });
    const { run } = harness();
    const made = await createStep(open)(run, [pdf('Statement.pdf', f.bytes, f.pages.length)], opts());
    const book = await readBack(made.files[0].bytes);
    expect(book.worksheets[0].getImages()).toHaveLength(0);
    expect(asked).not.toHaveBeenCalled();
    expect(made.files[0].operation?.options).toMatchObject({ pagesFromScan: 1, pages: f.pages.length });
    const said = made.describe(made.files);
    expect(said.detail).toMatch(/ 1 page is a scan: its text was typed from recognition and the scan picture was left out\. Check numbers against the page\.$/);
    expect(said.tone).toBe('warning');
  });

  it('the same statement without ruling lines: every amount still lands in Debit, Credit or Balance', async () => {
    const f = await fixture('statement-plain');
    const expected = await convertFixtureExpected('statement-plain');
    const [row] = (await createStep(f.open)(harness().run, [f.file], opts())).files;
    const rows = rowsOf((await readBack(row.bytes)).worksheets[0]);
    const dataRows = expected.lineRows.flat().filter((r) => /^\d\d-\d\d-2025$/.test(r[0]));
    const got = rows.filter((r) => typeof r[0] === 'string' && /^\d\d-\d\d-2025$/.test(r[0]));
    expect(got).toHaveLength(dataRows.length);
    dataRows.forEach((want, i) => {
      for (const c of [3, 4, 5]) expect(got[i][c] ?? '', `${want[0]} column ${c}`).toBe(want[c] === '' ? '' : parseAmount(want[c])!.value);
    });
  });

  it('a merged heading and a two-line narration: the amounts stay in Debit and Credit', async () => {
    const f = await fixture('merged-heading');
    const [row] = (await createStep(f.open)(harness().run, [f.file], opts())).files;
    const rows = rowsOf((await readBack(row.bytes)).worksheets[0]);
    const amounts = (start: string) => {
      const r = rows.find((x) => typeof x[0] === 'string' && x[0].startsWith(start));
      return r ? [r[1] ?? null, r[2] ?? null] : undefined;
    };
    expect(amounts('Purchases during the year')).toEqual([3210500, null]);
    expect(amounts('Sales during the year')).toEqual([null, 4175250]);
    expect(amounts('Discount allowed')).toEqual([-15750, null]);
  });

  it('one sheet per page: Page_1 … Page_3', async () => {
    const f = await fixture('statement-plain');
    const [row] = (await createStep(f.open)(harness().run, [f.file], opts({ sheets: 'per-page' }))).files;
    const book = await readBack(row.bytes);
    expect(book.worksheets.map((w) => w.name)).toEqual(['Page_1', 'Page_2', 'Page_3']);
    expect(row.operation?.options).toMatchObject({ sheetMode: 'per-page', sheets: 3, pages: 3 });
  });

  it('the trial balance: bracketed negatives are negative numbers that show their brackets, with Indian grouping', async () => {
    const f = await fixture('trial-balance');
    const [row] = (await createStep(f.open)(harness().run, [f.file], opts())).files;
    const ws = (await readBack(row.bytes)).worksheets[0];
    const cells: ExcelJS.Cell[] = [];
    ws.eachRow((r) => r.eachCell((c) => void cells.push(c)));
    const depreciation = cells.find((c) => c.value === -125000);
    expect(depreciation?.numFmt).toBe('#","##","##0.00;(#","##","##0.00)');
    const capital = cells.find((c) => c.value === 2500000);
    expect(capital?.numFmt).toBe('##","##","##0.00');
    expect(cells.filter((c) => c.value === 5019818.25)).toHaveLength(2); // both totals
  });

  it('refuses a file with no text on any page, and reads no further than it must', async () => {
    const blank = (i: number): PageWords => ({ pageIndex: i, width: 595, height: 842, words: [] });
    const { open, closed } = readerOf([blank(0), blank(1)], []);
    const attempt = createStep(open)(harness().run, [pdf('Scan.pdf', new Uint8Array([1]), 2)], opts());
    await expect(attempt).rejects.toBeInstanceOf(PdfToolsError);
    await expect(createStep(open)(harness().run, [pdf('Scan.pdf', new Uint8Array([1]), 2)], opts())).rejects.toThrow(`${SCANNED_MESSAGE} Nothing was added.`);
    expect(closed).toHaveBeenCalled();
  });

  it('a mixed file runs, says how many pages have little or no text, and still writes their words', async () => {
    const f = await convertFixture('trial-balance');
    // A scanned page that carries a stamped page number: under 20 characters.
    const stamp: PageWords = { pageIndex: 1, width: 595, height: 842, words: [{ text: 'Page', x0: 280, y0: 800, x1: 300, y1: 810, size: 9, font: 'F' }, { text: '2', x0: 303, y0: 800, x1: 308, y1: 810, size: 9, font: 'F' }] };
    const { open } = readerOf([f.pages[0], stamp], [f.segments[0], []]);
    const made = await createStep(open)(harness().run, [pdf('TB.pdf', f.bytes, 2)], opts({ sheets: 'per-page' }));
    expect((await readBack(made.files[0].bytes)).getWorksheet('Page_2')!.getCell('A1').value).toBe('Page 2');
    const said = made.describe(made.files);
    expect(said.detail).toMatch(/ rows\. 1 page has little or no text; it may be scanned\. Make the file searchable to convert it\.$/);
    expect(said.tone).toBe('warning');
  });

  it('refuses more than 1,000 pages before reading anything', async () => {
    const { open } = readerOf([], []);
    await expect(createStep(open)(harness().run, [pdf('Huge.pdf', new Uint8Array([1]), 1001)], opts())).rejects.toThrow(`${TOO_MANY_PAGES_MESSAGE} Nothing was added.`);
    expect(open).not.toHaveBeenCalled();
    await expect(createStep(open)(harness().run, [pdf('a.pdf', new Uint8Array([1]), 1), pdf('b.pdf', new Uint8Array([1]), 1)], opts())).rejects.toThrow('Choose exactly one PDF.');
  });

  it('a file whose text cannot be read is refused in plain words', async () => {
    const open = vi.fn(async () => {
      throw new Error('raw library words');
    });
    const attempt = createStep(open)(harness().run, [pdf('Broken.pdf', new Uint8Array([1]), 1)], opts());
    await expect(attempt).rejects.toThrow('The text of this file could not be read, and nothing was added. Open the file in a PDF reader, save a fresh copy and add that.');
  });

  it('keeps a typed name, adds .xlsx, and falls back to the file name for an empty one', async () => {
    const f = await fixture('trial-balance');
    for (const [typed, name] of [['For the bank', 'For the bank.xlsx'], ['TB 2025.xlsx', 'TB 2025.xlsx'], ['  ', 'Statement.xlsx'], ['a/b', 'a_b.xlsx']] as const) {
      const [row] = (await createStep(f.open)(harness().run, [f.file], opts({ name: typed }))).files;
      expect(row.name, typed).toBe(name);
    }
  });

  it('records only counts and the sheets choice: no word of the file in the record or the activity entry', async () => {
    const f = await fixture('statement-ruled');
    // A file name that is not a word of the page, so only the record's own words are looked at.
    const [row] = (await createStep(f.open)(harness().run, [{ ...f.file, name: 'Q1.pdf' }], opts())).files;
    const options = row.operation!.options;
    expect(Object.keys(options).every((k) => (RECORD_KEYS as readonly string[]).includes(k))).toBe(true);
    expect(options).toMatchObject({ sheetMode: 'one-sheet', pages: 3, sheets: 1, tablesRuled: 3 });
    expect(row.operation?.summary).toBe('Converted to Excel: 3 pages, 1 sheet');
    const entry = buildActivityEntry({ file: row, destination: 'computer', sha256: 'a'.repeat(64) });
    const words = new Set(f.pages.flatMap((p) => p.words.map((w) => w.text)).filter((t) => t.length >= 4 && !/^(page|pages|sheet|Excel|with|from|Converted)$/i.test(t)));
    const recorded = [JSON.stringify(row.operation), JSON.stringify(entry.metadata), entry.details].join('\n');
    expect([...words].filter((w) => recorded.includes(w))).toEqual([]);
  });

  it('a signed source: the workbook is not marked as a signed copy; a protected one is recorded "protection removed"', async () => {
    const f = await fixture('trial-balance');
    const [signed] = (await createStep(f.open)(harness().run, [{ ...f.file, hasSignature: true }], opts())).files;
    expect(signed.signatureInvalid).toBeUndefined();
    const [unlocked] = (await createStep(f.open)(harness().run, [{ ...f.file, wasProtected: true }], opts())).files;
    expect(unlocked.operation?.flags).toEqual({ protectionRemoved: true });
    expect(unlocked.wasProtected).toBe(false);
  });

  it('shows each page as it is read, then the placing and the writing', async () => {
    const f = await fixture('statement-plain');
    const { run, labels } = harness();
    await createStep(f.open)(run, [f.file], opts());
    expect(labels).toContain(STEP_LABELS.reading(1, 3));
    expect(labels).toContain(STEP_LABELS.reading(3, 3));
    expect(labels.indexOf(STEP_LABELS.placing)).toBeGreaterThan(labels.indexOf(STEP_LABELS.reading(3, 3)));
    expect(labels.indexOf(STEP_LABELS.writing)).toBeGreaterThan(labels.indexOf(STEP_LABELS.placing));
  });

  it('a Stop while reading ends the run and makes nothing; the reader is closed', async () => {
    const f = await convertFixture('statement-ruled');
    const h = harness();
    const { open, closed } = readerOf(f.pages, f.segments, (i) => {
      if (i === 1) h.controller.abort();
    });
    await expect(createStep(open)(h.run, [pdf('S.pdf', f.bytes, 3)], opts())).rejects.toBeInstanceOf(Cancelled);
    expect(closed).toHaveBeenCalled();
  });

  it('a Stop while writing ends the run and makes nothing', async () => {
    const f = await fixture('statement-ruled');
    const h = harness();
    const write = vi.fn(async (_p: PackedWorkbook, signal: AbortSignal) => {
      h.controller.abort();
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      return new Uint8Array();
    });
    await expect(createStep(f.open, { write })(h.run, [f.file], opts())).rejects.toBeInstanceOf(Cancelled);
  });

  it('ends without a word when the engagement changes during the run', async () => {
    const f = await convertFixture('statement-ruled');
    const h = harness();
    const { open } = readerOf(f.pages, f.segments, (i) => {
      if (i === 2) h.store.setContext('u1:B');
    });
    await expect(createStep(open)(h.run, [pdf('S.pdf', f.bytes, 3)], opts())).rejects.toBeInstanceOf(Stale);
  });

  it('through runTool: adds one office row with the message; a name already in the list gets " (2)"; a stop adds nothing', async () => {
    const f = await convertFixture('trial-balance');
    const h = harness();
    const deps = { paint: async () => undefined, yieldToUi: async () => undefined };
    const source = pdf('TB.pdf', f.bytes, 1);
    const result = await runTool('pdf-to-excel', [source], opts(), h.ctx, deps);
    expect(result).toMatchObject({ status: 'added', added: 1, message: 'Made TB.xlsx', tone: 'success' });
    expect(result.status === 'added' && result.detail).toMatch(/^1 page, 1 sheet, \d+ rows\.$/);
    expect(h.store.getState().files.map((x) => [x.name, x.kind, x.mimeType, x.pageCount])).toEqual([['TB.xlsx', 'office', XLSX_MIME, null]]);
    const again = await runTool('pdf-to-excel', [source], opts(), h.ctx, deps);
    expect(again).toMatchObject({ status: 'added', message: 'Made TB (2).xlsx' });

    const stopped = harness();
    stopped.progress.mockImplementation((_d: number, _t: number, label?: string) => {
      if (label === STEP_LABELS.placing) stopped.controller.abort();
    });
    const outcome = await runTool('pdf-to-excel', [source], opts(), stopped.ctx, deps);
    expect(outcome.status).toBe('cancelled');
    expect(stopped.store.getState().files).toEqual([]);
  });
});

// ---- the write off the window's thread ------------------------------------------------------------------

class FakeWorker implements WriterWorker {
  onmessage: ((event: MessageEvent<WriterReply>) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessageerror: ((event: Event) => void) | null = null;
  posted: unknown[] = [];
  terminated = false;
  postMessage(message: PackedWorkbook): void {
    this.posted.push(message);
  }
  terminate(): void {
    this.terminated = true;
  }
  reply(data: WriterReply): void {
    this.onmessage?.({ data } as MessageEvent<WriterReply>);
  }
}

const packed: PackedWorkbook = { sheets: [{ name: 'All pages', widths: [10], rows: new Uint32Array([1]), cols: new Uint16Array([1]), formats: new Int32Array([0]), numbers: new Float64Array([5]), texts: '' }], formats: ['0'] };
const noPace = () => undefined;

describe('writeOffThread', () => {
  it('hands the packed sheets to the worker and takes its bytes; the worker is ended', async () => {
    const worker = new FakeWorker();
    const done = writeOffThread(packed, new AbortController().signal, noPace, () => worker);
    expect(worker.posted).toEqual([packed]);
    worker.reply({ alive: true });
    worker.reply({ ok: true, bytes: new Uint8Array([1, 2, 3]) });
    expect(Array.from(await done)).toEqual([1, 2, 3]);
    expect(worker.terminated).toBe(true);
  });

  it('writes here when no worker can be started, or the worker fails without a reply', async () => {
    const here = await writeOffThread(packed, new AbortController().signal, noPace, () => {
      throw new Error('no workers');
    });
    expect((await readBack(here)).worksheets[0].getCell('A1').value).toBe(5);
    const worker = new FakeWorker();
    const done = writeOffThread(packed, new AbortController().signal, noPace, () => worker);
    worker.onerror?.(new Event('error'));
    expect((await readBack(await done)).worksheets[0].getCell('A1').value).toBe(5);
    expect(worker.terminated).toBe(true);
  });

  it('a worker that says the write failed: refused in plain words', async () => {
    const worker = new FakeWorker();
    const done = writeOffThread(packed, new AbortController().signal, noPace, () => worker);
    worker.reply({ ok: false });
    await expect(done).rejects.toThrow('The workbook could not be written, and nothing was added. Try again; if it fails again, restart the application.');
  });

  it('a Stop ends the worker at once', async () => {
    const worker = new FakeWorker();
    const controller = new AbortController();
    const done = writeOffThread(packed, controller.signal, noPace, () => worker);
    controller.abort();
    await expect(done).rejects.toMatchObject({ name: 'AbortError' });
    expect(worker.terminated).toBe(true);
  });

  it('gives up on a worker silent for the time limit; a sign of life starts the limit again', async () => {
    vi.useFakeTimers();
    try {
      const worker = new FakeWorker();
      const done = writeOffThread(packed, new AbortController().signal, noPace, () => worker);
      const outcome = done.catch((e: unknown) => e);
      vi.advanceTimersByTime(WRITE_TIME_LIMIT_MS - 1);
      worker.reply({ alive: true });
      vi.advanceTimersByTime(WRITE_TIME_LIMIT_MS - 1);
      expect(worker.terminated).toBe(false);
      vi.advanceTimersByTime(2);
      expect(await outcome).toMatchObject({ code: 'excel-write-timeout' });
      expect(worker.terminated).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
