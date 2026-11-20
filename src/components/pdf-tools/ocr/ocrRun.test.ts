// The Make searchable run step (ocrRun.ts) on the step contract of toolStep.ts, with a stand-in engine and
// stand-in page pictures: one PDF in, one searchable copy out, `<name>_searchable.pdf`. The files are part A's
// invented fixtures (testOcrPdf.ts); the result is read back with pdf.js, as the application's viewer reads it.
import { PDFDocument, PDFName, PDFRawStream, PDFArray } from 'pdf-lib';
import { describe, expect, it, vi } from 'vitest';
import { inspectPdf } from '@/lib/pdf-tools/inspect';
import { OCR_PAGE_TIME_LIMIT_MS, OcrPageTimedOut, OcrStopped, type OcrEngine, type RecognisedPage, type RecogniseOptions } from '@/lib/pdf-tools/ocrTypes';
import { A4, addScanPicture, ocrFixture, wordsPage } from '@/lib/pdf-tools/testOcrPdf';
import { createWorkingListStore, LIST_MAX_BYTES, LIST_WARN_BYTES } from '@/lib/pdf-tools/workingList';
import { PdfToolsError, PROTECTED_OUTPUT_REASON, type WorkingFile } from '@/lib/pdf-tools/types';
import { Cancelled, Run, type RunContext, type StepDeps } from '../toolStep';
import { OcrEngineFailed, type OpenEngine } from './ocrEngine';
import { ALL_PAGES_FAILED_MESSAGE, ENGINE_FAILED_MESSAGE, NOTHING_READ_MESSAGE, RECORD_KEYS } from './ocrForm';
import type { PageSource } from './ocrRender';
import { BUILT, createStep, lookAtPages, LookStopped, step, usableKinds } from './ocrRun';

vi.setConfig({ testTimeout: 90_000 });

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
  const bar: [number, number][] = [];
  const progress = vi.fn((done: number, total: number, label?: string) => {
    bar.push([done, total]);
    if (label && labels[labels.length - 1] !== label) labels.push(label);
  });
  const ctx: RunContext = { contextKey: 'u1:A', session: store.getState().session, store, signal: controller.signal, onProgress: progress };
  const deps: StepDeps = { inspectPdf, paint: async () => undefined, yieldToUi: async () => undefined, newId: () => `id-${++seq}`, maxBytes: LIST_MAX_BYTES, warnBytes: LIST_WARN_BYTES };
  return { store, controller, labels, bar, ctx, deps, run: new Run('ocr', ctx, deps) };
}

/** Page pictures: one byte saying which page it is; text counts as given (40 = a page of text, 0 = none). */
function fakePages(chars: readonly number[], fail: { picture?: number } = {}): PageSource & { pictures: number[]; counted: number[] } {
  const pictures: number[] = [];
  const counted: number[] = [];
  return {
    pictures,
    counted,
    async pageChars(_file, pageIndex) {
      counted.push(pageIndex);
      return chars[pageIndex];
    },
    async picture(_file, pageIndex, options) {
      if (options?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      if (fail.picture === pageIndex) throw new PdfToolsError('out-of-memory', 'There was not enough memory to draw this page.');
      pictures.push(pageIndex);
      return { image: new Uint8Array([pageIndex]), widthPx: 2480, heightPx: 3508, dpi: pageIndex === 9 ? 164 : 300 };
    },
  };
}

type PageAnswer = RecognisedPage | 'timeout' | 'fail' | 'wait-for-stop';

/** An engine that answers each page (told apart by its picture's one byte) as the test says. */
function fakeEngine(answers: Record<number, PageAnswer>, start: 'ok' | 'fail' | 'wait-for-stop' = 'ok') {
  const seen: { pageIndex: number; options: RecogniseOptions & { dpi?: number } }[] = [];
  let opened = 0;
  let closed = 0;
  const engine: OcrEngine = {
    async recognise(image, options) {
      const pageIndex = (image as Uint8Array)[0];
      seen.push({ pageIndex, options });
      const answer = answers[pageIndex];
      if (answer === 'timeout') throw new OcrPageTimedOut(options.timeoutMs);
      if (answer === 'fail') throw new OcrEngineFailed('a page was rejected');
      if (answer === 'wait-for-stop') {
        return new Promise<RecognisedPage>((_, reject) => options.signal?.addEventListener('abort', () => reject(new OcrStopped())));
      }
      (options as { onProgress?: (share: number) => void }).onProgress?.(0.5);
      return answer;
    },
    async close() {
      closed += 1;
    },
  };
  const open: OpenEngine = async ({ signal }) => {
    opened += 1;
    if (start === 'fail') throw new OcrEngineFailed('start-up failed');
    if (start === 'wait-for-stop') await new Promise<never>((_, reject) => signal?.addEventListener('abort', () => reject(new OcrStopped())));
    return engine;
  };
  return { open, seen, opened: () => opened, closed: () => closed };
}

async function textOf(bytes: Uint8Array): Promise<string[]> {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 }).promise;
  const pages: string[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const content = await (await doc.getPage(n)).getTextContent();
    pages.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' ').replace(/\s+/g, ' ').trim());
  }
  await doc.destroy();
  return pages;
}

/** The bytes of a page's content streams, in order, as stored. */
function contentOf(doc: PDFDocument, pageIndex: number): string[] {
  const contents = doc.getPage(pageIndex).node.lookup(PDFName.of('Contents'));
  const streams = contents instanceof PDFArray ? contents.asArray().map((ref) => doc.context.lookup(ref)) : [contents];
  return streams.map((s) => (s instanceof PDFRawStream ? Buffer.from(s.contents).toString('latin1') : String(s)));
}

/** A file of `kinds` pages: 's' a scan, 't' a page marked as text (the fake text count says so). */
async function scans(count: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < count; i++) addScanPicture(doc.addPage(A4));
  return doc.save();
}

const words = (...texts: string[]) => wordsPage(texts.map((text) => ({ text, confidence: 95 })));

describe('make searchable run step', () => {
  it('is built, and the application step is made of the real engine and renderer', () => {
    expect(BUILT).toBe(true);
    expect(typeof step).toBe('function');
  });

  it('reads the plan, starts the engine, recognises only the scanned page and adds one searchable copy', async () => {
    const fixture = await ocrFixture('mixed'); // a page of text, a scan, an empty page
    const pages = fakePages([40, 0, 0]);
    const engine = fakeEngine({ 1: fixture.pages[1].recognised! });
    const { run, labels } = harness();
    const source = pdf('Invented Statement.pdf', fixture.bytes, 3);
    const made = await createStep(engine.open, pages)(run, [source], {});

    expect(pages.counted).toEqual([0, 1, 2]);
    expect(pages.pictures).toEqual([1]);
    expect(engine.seen.map((s) => s.pageIndex)).toEqual([1]);
    expect(engine.seen[0].options.timeoutMs).toBe(OCR_PAGE_TIME_LIMIT_MS);
    expect(engine.seen[0].options.signal).toBe(run.ctx.signal);
    expect(engine.seen[0].options.dpi).toBe(300);
    expect(engine.opened()).toBe(1);
    expect(engine.closed()).toBe(1);
    expect(labels).toEqual([
      'Looking for pages without text: page 1 of 3…',
      'Looking for pages without text: page 2 of 3…',
      'Looking for pages without text: page 3 of 3…',
      'Getting the text reader ready…',
      'Reading the text of page 2 (1 of 1)…',
      'Adding the text to the file…',
    ]);

    expect(made.files).toHaveLength(1);
    const [file] = made.files;
    expect(file.name).toBe('Invented Statement_searchable.pdf');
    expect(file.kind).toBe('pdf');
    expect(file.pageCount).toBe(3);
    expect(file.origin).toBe('result');
    expect(file.operation?.summary).toBe('Made searchable: 1 of 3 pages recognised');
    expect(Object.keys(file.operation?.options ?? {}).sort()).toEqual([...RECORD_KEYS].sort());
    expect(file.operation?.options).toMatchObject({ pages: 3, pagesRecognised: 1, pagesSkipped: 2, pagesTimedOut: 0, words: 8 });
    expect(made.describe(made.files)).toEqual({
      message: 'Made searchable: Invented Statement_searchable.pdf',
      // Eight words on an A4 page: part A's rule calls so few words faint (it only asks the user to look).
      detail: '1 of 3 pages recognised; 1 already had text; 1 had nothing to recognise. Recognised text can be wrong: check numbers against the page. Page 2 looks faint.',
      tone: 'warning',
    });

    const text = await textOf(file.bytes);
    expect(text[0]).toContain('Statement of account');
    expect(text[1]).toBe('Nirvexa Traders Private Limited Invoice NX/2291 dated 14-08-2025');
    expect(text[2]).toBe('');
    // The source is not changed.
    expect((await textOf(source.bytes))[1]).toBe('');
    const back = await PDFDocument.load(file.bytes, { updateMetadata: false });
    expect(back.getProducer()).toBe('ICAI VERA');
  });

  it('takes the page kinds the dialog read instead of reading them again, when they fit the file', async () => {
    const fixture = await ocrFixture('mixed');
    const pages = fakePages([40, 0, 0]);
    const engine = fakeEngine({ 1: fixture.pages[1].recognised! });
    const made = await createStep(engine.open, pages)(harness().run, [pdf('a.pdf', fixture.bytes, 3)], { kinds: ['text', 'scanned', 'empty'] });
    expect(pages.counted).toEqual([]);
    expect(made.files).toHaveLength(1);

    // Kinds of another length, or not kinds at all: the step looks itself.
    for (const kinds of [['text', 'scanned'], ['text', 'scanned', 'every-page'], 'scanned'] as unknown as ('text' | 'scanned' | 'empty')[][]) {
      const again = fakePages([40, 0, 0]);
      await createStep(fakeEngine({ 1: fixture.pages[1].recognised! }).open, again)(harness().run, [pdf('a.pdf', fixture.bytes, 3)], { kinds });
      expect(again.counted).toEqual([0, 1, 2]);
    }
  });

  it('adds nothing and says so when no page looks scanned, without starting the engine', async () => {
    const fixture = await ocrFixture('mixed');
    const engine = fakeEngine({});
    const everyText = await createStep(engine.open, fakePages([40, 40, 40]))(harness().run, [pdf('a.pdf', fixture.bytes, 3)], {});
    expect(everyText.files).toEqual([]);
    expect(everyText.describe([])).toEqual({ message: 'Every page already has text; nothing to recognise.' });
    // The scan counted as text here, and a page with nothing on it: none is to be recognised.
    const noScan = await createStep(engine.open, fakePages([40, 40, 0]))(harness().run, [pdf('a.pdf', fixture.bytes, 3)], {});
    expect(noScan.describe([])).toEqual({ message: 'Every page already has text or is blank; nothing to recognise.' });
    expect(engine.opened()).toBe(0);
  });

  it('leaves a page that ran out of time exactly as it was, names it, and still adds the rest', async () => {
    const bytes = await scans(3);
    const pages = fakePages([0, 0, 0]);
    const engine = fakeEngine({ 0: words('Freight', 'inward'), 1: 'timeout', 2: words('Closing', 'balance') });
    const made = await createStep(engine.open, pages, { pageTimeLimitMs: 25 })(harness().run, [pdf('Scan.pdf', bytes, 3)], {});
    expect(engine.seen.map((s) => s.options.timeoutMs)).toEqual([25, 25, 25]);
    const [file] = made.files;
    expect(file.operation?.summary).toBe('Made searchable: 2 of 3 pages recognised');
    expect(file.operation?.options).toMatchObject({ pagesRecognised: 2, pagesTimedOut: 1, words: 4 });
    const said = made.describe(made.files);
    expect(said.detail).toContain('Page 2 took too long and was left as it was.');
    expect(said.tone).toBe('warning');
    expect(await textOf(file.bytes)).toEqual(['Freight inward', '', 'Closing balance']);
    const before = await PDFDocument.load(bytes, { updateMetadata: false });
    const after = await PDFDocument.load(file.bytes, { updateMetadata: false });
    expect(contentOf(after, 1)).toEqual(contentOf(before, 1));
    expect(contentOf(after, 0)).not.toEqual(contentOf(before, 0));
  });

  it('adds nothing when no word was read on any page, and says why', async () => {
    const bytes = await scans(2);
    const engine = fakeEngine({ 0: words(), 1: 'timeout' });
    const { run, store } = harness();
    const made = await createStep(engine.open, fakePages([0, 0]))(run, [pdf('Blank.pdf', bytes, 2)], {});
    expect(made.files).toEqual([]);
    expect(made.describe([])).toEqual({ message: NOTHING_READ_MESSAGE });
    expect(store.getState().files).toEqual([]);
    expect(engine.closed()).toBe(1);
  });

  it('Stop inside a page ends the run as stopped, adds nothing and closes the engine', async () => {
    const bytes = await scans(2);
    const engine = fakeEngine({ 0: words('Freight'), 1: 'wait-for-stop' });
    const { run, controller, store } = harness();
    const running = createStep(engine.open, fakePages([0, 0]))(run, [pdf('Scan.pdf', bytes, 2)], {});
    await vi.waitFor(() => expect(engine.seen).toHaveLength(2));
    controller.abort();
    await expect(running).rejects.toBeInstanceOf(Cancelled);
    expect(store.getState().files).toEqual([]);
    expect(engine.closed()).toBe(1);
  });

  it('Stop while the engine starts, or while the pages are looked at, is a stop and not a failure', async () => {
    const bytes = await scans(1);
    const engine = fakeEngine({}, 'wait-for-stop');
    const first = harness();
    const starting = createStep(engine.open, fakePages([0]))(first.run, [pdf('Scan.pdf', bytes, 1)], {});
    await vi.waitFor(() => expect(engine.opened()).toBe(1));
    first.controller.abort();
    await expect(starting).rejects.toBeInstanceOf(Cancelled);

    const second = harness();
    second.controller.abort();
    await expect(createStep(fakeEngine({}).open, fakePages([0]))(second.run, [pdf('Scan.pdf', bytes, 1)], {})).rejects.toBeInstanceOf(Cancelled);
  });

  it('says in plain words that the text reader could not start, and adds nothing', async () => {
    const bytes = await scans(1);
    const engine = fakeEngine({}, 'fail');
    const error = await createStep(engine.open, fakePages([0]))(harness().run, [pdf('Scan.pdf', bytes, 1)], {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PdfToolsError);
    expect((error as PdfToolsError).message).toBe(ENGINE_FAILED_MESSAGE);
  });

  it('leaves a page the engine fails on as it was, names it, counts it, and goes on with the rest (ruling of 18 November 2026)', async () => {
    const bytes = await scans(3);
    const engine = fakeEngine({ 0: words('Freight', 'inward'), 1: 'fail', 2: words('Closing', 'balance') });
    const made = await createStep(engine.open, fakePages([0, 0, 0]))(harness().run, [pdf('Scan.pdf', bytes, 3)], {});
    expect(engine.seen.map((s) => s.pageIndex)).toEqual([0, 1, 2]);
    const [file] = made.files;
    expect(file.operation?.summary).toBe('Made searchable: 2 of 3 pages recognised');
    // two words on a whole page read as faint; the eleven keys, the failed page among the pages left as they were
    expect(file.operation?.options).toEqual({ pages: 3, pagesRecognised: 2, pagesSkipped: 1, pagesTimedOut: 0, words: 4, lowConfidenceWords: 0, numbersToCheck: 0, pagesFaint: 2, charactersDropped: 0, wordsLeftOut: 0, pagesPartlyRead: 0 });
    const said = made.describe(made.files);
    expect(said.detail).toBe('2 of 3 pages recognised. Page 2 could not be read and was left as it was. Recognised text can be wrong: check numbers against the page. Pages 1 and 3 look faint.');
    expect(said.detail).not.toMatch(/rejected/);
    expect(said.tone).toBe('warning');
    expect(await textOf(file.bytes)).toEqual(['Freight inward', '', 'Closing balance']);
    const before = await PDFDocument.load(bytes, { updateMetadata: false });
    const after = await PDFDocument.load(file.bytes, { updateMetadata: false });
    expect(contentOf(after, 1)).toEqual(contentOf(before, 1));
    expect(engine.closed()).toBe(1);
  });

  it('leaves a page that cannot be drawn as it was, with the same sentence, and goes on', async () => {
    const bytes = await scans(3);
    const engine = fakeEngine({ 0: words('Freight'), 2: words('Closing') });
    const pages = fakePages([0, 0, 0], { picture: 1 });
    const made = await createStep(engine.open, pages)(harness().run, [pdf('Scan.pdf', bytes, 3)], {});
    expect(pages.pictures).toEqual([0, 2]);
    expect(engine.seen.map((s) => s.pageIndex)).toEqual([0, 2]);
    expect(made.files[0].operation?.options).toMatchObject({ pagesRecognised: 2, pagesSkipped: 1, pagesTimedOut: 0 });
    expect(made.describe(made.files).detail).toContain('Page 2 could not be read and was left as it was.');
    expect(await textOf(made.files[0].bytes)).toEqual(['Freight', '', 'Closing']);
    expect(engine.closed()).toBe(1);
  });

  it('ends the run with nothing added only when every page fails, in plain words', async () => {
    const bytes = await scans(2);
    const engine = fakeEngine({ 0: 'fail', 1: 'fail' });
    const { run, store } = harness();
    const failed = await createStep(engine.open, fakePages([0, 0]))(run, [pdf('Scan.pdf', bytes, 2)], {}).catch((e: unknown) => e);
    expect(failed).toBeInstanceOf(PdfToolsError);
    expect((failed as PdfToolsError).message).toBe(ALL_PAGES_FAILED_MESSAGE);
    expect(ALL_PAGES_FAILED_MESSAGE).toBe('No page could be read, and nothing was added. Try again; if it fails again, restart the application.');
    expect((failed as PdfToolsError).message).not.toMatch(/rejected/);
    expect(store.getState().files).toEqual([]);
    expect(engine.closed()).toBe(1);

    // a file of one page that cannot be drawn
    const undrawn = await createStep(fakeEngine({}).open, fakePages([0], { picture: 0 }))(harness().run, [pdf('Scan.pdf', await scans(1), 1)], {}).catch((e: unknown) => e);
    expect((undrawn as PdfToolsError).message).toBe(ALL_PAGES_FAILED_MESSAGE);
  });

  it('stops trying after the engine has failed on three pages in a row: the rest are left as they were and named', async () => {
    const bytes = await scans(6);
    const engine = fakeEngine({ 0: words('Freight'), 1: 'fail', 2: 'fail', 3: 'fail', 4: words('Never'), 5: words('Asked') });
    const made = await createStep(engine.open, fakePages([0, 0, 0, 0, 0, 0]))(harness().run, [pdf('Scan.pdf', bytes, 6)], {});
    expect(engine.seen.map((s) => s.pageIndex)).toEqual([0, 1, 2, 3]);
    expect(made.files[0].operation?.options).toMatchObject({ pages: 6, pagesRecognised: 1, pagesSkipped: 5, pagesTimedOut: 0, words: 1 });
    expect(made.describe(made.files).detail).toContain('Pages 2, 3, 4, 5 and 6 could not be read and were left as they were.');
    expect(await textOf(made.files[0].bytes)).toEqual(['Freight', '', '', '', '', '']);

    // a page read in between starts the count again
    const mixed = fakeEngine({ 0: 'fail', 1: 'fail', 2: words('Freight'), 3: 'fail', 4: 'fail', 5: words('Closing') });
    const all = await createStep(mixed.open, fakePages([0, 0, 0, 0, 0, 0]))(harness().run, [pdf('Scan.pdf', bytes, 6)], {});
    expect(mixed.seen.map((s) => s.pageIndex)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(all.files[0].operation?.options).toMatchObject({ pagesRecognised: 2, pagesSkipped: 4 });
  });

  it('moves the bar inside a page, and passes on a lower resolution of a very large page', async () => {
    const bytes = await scans(10);
    const answers: Record<number, PageAnswer> = {};
    for (let i = 0; i < 10; i++) answers[i] = words('Freight');
    const engine = fakeEngine(answers);
    const { run, bar, labels } = harness();
    await createStep(engine.open, fakePages(new Array(10).fill(0)))(run, [pdf('Scan.pdf', bytes, 10)], {});
    // From the second page on, the label says about how long is left, from the pages measured so far.
    expect(labels).toContain('Reading the text of page 1 (1 of 10)…');
    expect(labels).toContain('Reading the text of page 2 (2 of 10), a few seconds left…');
    expect(labels).toContain('Reading the text of page 10 (10 of 10), a few seconds left…');
    expect(bar).toContainEqual([0.5, 10]);
    expect(bar).toContainEqual([9.5, 10]);
    expect(engine.seen[9].options.dpi).toBe(164);
  });

  it('names the result as typed, and after the source when nothing usable is typed', async () => {
    const bytes = await scans(1);
    const one = (name?: string) => createStep(fakeEngine({ 0: words('Freight') }).open, fakePages([0]))(harness().run, [pdf('Ledger scan.PDF', bytes, 1)], { name });
    expect((await one('March ledger')).files[0].name).toBe('March ledger.pdf');
    expect((await one('  ')).files[0].name).toBe('Ledger scan_searchable.pdf');
    expect((await one()).files[0].name).toBe('Ledger scan_searchable.pdf');
  });

  it('marks a copy of a signed file, records a removed password, and refuses a protected result', async () => {
    const bytes = await scans(1);
    const make = (extra: Partial<WorkingFile>) => createStep(fakeEngine({ 0: words('Freight') }).open, fakePages([0]))(harness().run, [pdf('Scan.pdf', bytes, 1, extra)], {});
    const signed = (await make({ hasSignature: true })).files[0];
    expect(signed.signatureInvalid).toBe(true);
    expect(signed.operation?.summary).toBe('Made searchable: 1 of 1 page recognised; signature no longer valid');
    const opened = (await make({ wasProtected: true })).files[0];
    expect(opened.operation?.flags?.protectionRemoved).toBe(true);
    const refused = await make({ protectedOutput: true }).catch((e: unknown) => e);
    expect((refused as PdfToolsError).message).toBe(PROTECTED_OUTPUT_REASON);
  });

  it('says a file that cannot be read as a PDF could not be read', async () => {
    const engine = fakeEngine({});
    const error = await createStep(engine.open, fakePages([0]))(harness().run, [pdf('Broken.pdf', new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52, 10, 1, 2, 3]), 1)], {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PdfToolsError);
    expect((error as PdfToolsError).message).toBe('This file could not be read as a PDF, and nothing was added. It may be damaged.');
    expect(engine.opened()).toBe(0);
  });

  it('looks at the pages for the dialog as a dialog job, and stops when the dialog closes', async () => {
    const fixture = await ocrFixture('mixed');
    const asked: (string | undefined)[] = [];
    const pages = {
      pageChars: async (_file: Uint8Array, pageIndex: number, options?: { priority?: string }) => {
        asked.push(options?.priority);
        return [40, 0, 0][pageIndex];
      },
    };
    const seen: number[] = [];
    const plan = await lookAtPages(fixture.bytes, pages, { onPage: (done) => void seen.push(done) });
    expect(plan.pages.map((p) => p.kind)).toEqual(['text', 'scanned', 'empty']);
    expect(plan.toRecognise).toEqual([1]);
    expect(asked).toEqual(['dialog', 'dialog', 'dialog']);
    expect(seen).toEqual([1, 2, 3]);
    expect(usableKinds(plan.pages.map((p) => p.kind), 3)).toEqual(['text', 'scanned', 'empty']);

    const controller = new AbortController();
    controller.abort();
    await expect(lookAtPages(fixture.bytes, pages, { signal: controller.signal })).rejects.toBeInstanceOf(LookStopped);
    await expect(lookAtPages(new Uint8Array([1, 2, 3]), pages)).rejects.toBeInstanceOf(Error);
  });

  it('leaves out the words the engine could not read, says so, and counts them', async () => {
    const read = ['Halvick', 'Castings', 'ledger', 'for', 'April', '2025', 'opening', 'balance', 'carried', 'forward'].map((text) => ({ text, confidence: 94 }));
    const nonsense = ['zqk', 'vuh', 'Plo', 'xv', 'kJ', 'oen'].map((text) => ({ text, confidence: 22 }));
    const engine = fakeEngine({ 0: wordsPage([...read.slice(0, 5), ...nonsense, ...read.slice(5)]) });
    const made = await createStep(engine.open, fakePages([0]))(harness().run, [pdf('Two scripts.pdf', await scans(1), 1)], {});
    const [file] = made.files;
    expect((await textOf(file.bytes))[0]).toBe('Halvick Castings ledger for April 2025 opening balance carried forward');
    expect(file.operation?.options).toMatchObject({ words: 10, wordsLeftOut: 6, pagesPartlyRead: 1, lowConfidenceWords: 0, numbersToCheck: 0, pagesFaint: 0 });
    expect(made.describe(made.files)).toEqual({
      message: 'Made searchable: Two scripts_searchable.pdf',
      // Ten words kept on a whole page, with a third of what was seen left out: little was read (T-064, the last verification).
      detail: 'Little could be read on page 1: it may be faint, handwritten or not in English. Recognised text can be wrong: check numbers against the page.',
      tone: 'warning',
    });
    for (const w of nonsense) expect(JSON.stringify(file.operation)).not.toContain(w.text);

    // A full page that lost a part: recognised, with parts left out.
    const full = [...Array.from({ length: 12 }, () => read).flat(), ...Array.from({ length: 4 }, () => nonsense).flat()];
    const partly = await createStep(fakeEngine({ 0: wordsPage(full) }).open, fakePages([0]))(harness().run, [pdf('Stamped.pdf', await scans(1), 1)], {});
    expect(partly.files[0].operation?.options).toMatchObject({ words: 120, wordsLeftOut: 24, pagesPartlyRead: 1 });
    expect(partly.describe(partly.files).detail).toBe(
      'The page was recognised. Parts of page 1 could not be read and were left out: it may be faint, handwritten or not in English. Recognised text can be wrong: check numbers against the page.',
    );
  });

  it('adds nothing when the engine could read no word of what is on the pages', async () => {
    const engine = fakeEngine({ 0: wordsPage(['zqk', 'vuh', 'Plo', 'xv'].map((text) => ({ text, confidence: 30 }))) });
    const made = await createStep(engine.open, fakePages([0]))(harness().run, [pdf('Other script.pdf', await scans(1), 1)], {});
    expect(made.files).toEqual([]);
    expect(made.describe([])).toEqual({ message: NOTHING_READ_MESSAGE });
  });

  it('puts no recognised word into the record', async () => {
    const fixture = await ocrFixture('scan');
    const made = await createStep(fakeEngine({ 0: fixture.pages[0].recognised! }).open, fakePages([0]))(harness().run, [pdf('Scan.pdf', fixture.bytes, 1)], {});
    const record = JSON.stringify(made.files[0].operation);
    for (const w of fixture.pages[0].recognised!.words) if (w.text.length > 3) expect(record).not.toContain(w.text);
    expect(made.files[0].operation?.options).toMatchObject({ numbersToCheck: 2, charactersDropped: 7 });
  });
});
