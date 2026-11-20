// The PDF to Word run step (wordRun.ts) on the step contract of toolStep.ts: one PDF in, one Word document out
// as an office row. Pages are read through a stand-in for the words reader (createStep's seam) built from the
// invented fixtures of testConvertPdf.ts, so no PDF reader runs; the .docx is unzipped and its body read.
import JSZip from 'jszip';
import { describe, expect, it, vi } from 'vitest';
import { inspectPdf } from '@/lib/pdf-tools/inspect';
import type { PageWords, Segment } from '@/lib/pdf-tools/layout';
import { convertFixture, convertFixtureExpected } from '@/lib/pdf-tools/testConvertPdf';
import { DOCX_MIME } from '@/lib/pdf-tools/wordBuild';
import { createWorkingListStore, LIST_MAX_BYTES, LIST_WARN_BYTES } from '@/lib/pdf-tools/workingList';
import { PdfToolsError, PROTECTED_OUTPUT_REASON, type WorkingFile } from '@/lib/pdf-tools/types';
import { runTool } from '../runTool';
import { Cancelled, Run, Stale, type RunContext, type StepDeps } from '../toolStep';
import type { WordsReader } from './pageWordsReader';
import { NO_TEXT_MESSAGE, READING_LABEL, RECORD_KEYS, SIGNED_WARNING, TOO_MANY_PAGES_MESSAGE, WRITING_LABEL } from './wordForm';
import { BUILT, createStep, step, type WordRunOptions } from './wordRun';

vi.setConfig({ testTimeout: 60_000 });

// The application's reader, for the default `step` run through runTool: it reads what the test gives it.
const appReader = vi.hoisted(() => ({ open: null as null | ((file: Uint8Array, opts?: { signal?: AbortSignal }) => Promise<unknown>) }));
vi.mock('./pageWordsReader', () => ({ openWordsReader: (file: Uint8Array, opts?: { signal?: AbortSignal }) => appReader.open!(file, opts) }));

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
  const progress = vi.fn((_done: number, _total: number, label?: string) => {
    if (label) labels.push(label);
  });
  const ctx: RunContext = { contextKey: 'u1:A', session: store.getState().session, store, signal: controller.signal, onProgress: progress };
  const deps: StepDeps = { inspectPdf, paint: async () => undefined, yieldToUi: async () => undefined, newId: () => `id-${++seq}`, maxBytes: LIST_MAX_BYTES, warnBytes: LIST_WARN_BYTES };
  return { store, controller, labels, ctx, run: new Run('pdf-to-word', ctx, deps) };
}

interface Reading {
  opened: number;
  closed: number;
  read: number[];
}

/** A words reader over pages already known; `onPage` runs before page `i` is given. */
function standIn(pages: PageWords[], segments: Segment[][], onPage?: (i: number) => void): { open: Parameters<typeof createStep>[0]; reading: Reading } {
  const reading: Reading = { opened: 0, closed: 0, read: [] };
  const open = async (_file: Uint8Array, opts?: { signal?: AbortSignal }): Promise<WordsReader> => {
    reading.opened++;
    return {
      pageCount: pages.length,
      async page(i: number) {
        onPage?.(i);
        if (opts?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        reading.read.push(i);
        return { words: pages[i], segments: segments[i] };
      },
      close: () => void reading.closed++,
    };
  };
  return { open, reading };
}

async function body(bytes: Uint8Array): Promise<string> {
  return (await JSZip.loadAsync(bytes)).file('word/document.xml')!.async('string');
}

/** The text of the body's paragraphs and table cells, in order, one string each. */
function bodyTexts(xml: string): string[] {
  return [...xml.matchAll(/<w:p>([\s\S]*?)<\/w:p>/g)]
    .map((m) => [...m[1].matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>|<w:tab\/>/g)].map((t) => (t[0] === '<w:tab/>' ? '\t' : t[1])).join(''))
    .filter((t) => t !== '')
    .map((t) => t.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'));
}

const opts = (over: Partial<WordRunOptions> = {}): WordRunOptions => ({ ...over });

describe('PDF to Word run step', () => {
  it('is built, and its default step reads with the application’s words reader', () => {
    expect(BUILT).toBe(true);
    expect(typeof step).toBe('function');
  });

  it('through runTool, the default step adds one office row; a Stop adds nothing and says nothing more', async () => {
    const fixture = await convertFixture('statement-plain');
    const source = pdf('Statement.pdf', fixture.bytes, 3);
    const done = harness();
    appReader.open = standIn(fixture.pages, fixture.segments).open;
    const result = await runTool('pdf-to-word', [source], {}, done.ctx);
    expect(result).toMatchObject({ status: 'added', added: 1, message: 'Made Statement.docx', tone: 'success' });
    expect(done.store.getState().files.map((f) => [f.name, f.kind, f.mimeType, f.pageCount])).toEqual([['Statement.docx', 'office', DOCX_MIME, null]]);

    const stopped = harness();
    appReader.open = standIn(fixture.pages, fixture.segments, (i) => {
      if (i === 1) stopped.controller.abort();
    }).open;
    expect(await runTool('pdf-to-word', [source], {}, stopped.ctx)).toEqual({ status: 'cancelled', added: 0, ids: [] });
    expect(stopped.store.getState().files).toEqual([]);
  });

  it('makes one Word document as an office row, named <name>.docx, from a two-column letter in reading order', async () => {
    const fixture = await convertFixture('two-column-letter');
    const expected = await convertFixtureExpected('two-column-letter');
    const { open, reading } = standIn(fixture.pages, fixture.segments);
    const { run } = harness();
    const source = pdf('Circular.pdf', fixture.bytes, 1);
    const made = await createStep(open)(run, [source], opts());
    expect(made.files).toHaveLength(1);
    const [file] = made.files;
    expect(file).toMatchObject({ name: 'Circular.docx', kind: 'office', mimeType: DOCX_MIME, pageCount: null, origin: 'result', hasSignature: false });
    expect(file.size).toBe(file.bytes.byteLength);
    // Every word of the page, in reading order: the left column before the right one.
    const found = bodyTexts(await body(file.bytes));
    expect(found.join(' ')).toBe(expected.text[0].join(' '));
    // The title, the subject line, each column as one paragraph, and the closing line.
    expect(found).toHaveLength(5);
    expect(file.operation!.options).toMatchObject({ headings: 1, paragraphs: 4, tables: 0 });
    expect(reading).toMatchObject({ opened: 1, closed: 1, read: [0] });
    expect(source.bytes).toBe(fixture.bytes);
  });

  it('with a measure of the fonts keeps the lines of the page (a line break inside the paragraph) and fits their letters; without one the paragraphs flow', async () => {
    const fixture = await convertFixture('two-column-letter');
    const source = pdf('Circular.pdf', fixture.bytes, 1);
    // Letters a tenth narrower than the fixture's own.
    const narrow = (text: string) => Array.from(text).reduce((n, ch) => n + (ch === ' ' ? 0.25 : 0.45), 0);
    const fitted = await createStep(standIn(fixture.pages, fixture.segments).open, () => narrow)(harness().run, [source], opts());
    const xml = await body(fitted.files[0].bytes);
    expect((xml.match(/<w:br\/>/g) ?? []).length).toBeGreaterThan(4);
    expect(xml).toMatch(/<w:w w:val="\d+"\/>/);
    const plain = await createStep(standIn(fixture.pages, fixture.segments).open)(harness().run, [source], opts());
    expect(await body(plain.files[0].bytes)).not.toContain('<w:br/>');
  });

  it('keeps a ruled statement’s tables as tables, with one page break between pages, and says what it made', async () => {
    const fixture = await convertFixture('statement-ruled');
    const { open } = standIn(fixture.pages, fixture.segments);
    const { run } = harness();
    const made = await createStep(open)(run, [pdf('Statement.pdf', fixture.bytes, 3)], opts({ name: 'Bank statement' }));
    const [file] = made.files;
    expect(file.name).toBe('Bank statement.docx');
    const xml = await body(file.bytes);
    expect((xml.match(/<w:tbl>/g) ?? []).length).toBe(3);
    // Each page of the source is a section of its own (its size and margins): two ends inside the body, the last at its end.
    expect((xml.match(/<w:sectPr>/g) ?? []).length).toBe(3);
    expect(xml).not.toContain('<w:br w:type="page"/>');
    expect(xml).toContain('<w:pStyle w:val="Heading1"/>'); // the 14 pt bank name over 9 pt text
    const described = made.describe([file]);
    expect(described.message).toBe('Made Bank statement.docx');
    expect(described.detail).toMatch(/^3 pages: \d+ paragraphs?, 3 headings, 3 tables\.$/);
    expect(described.tone).toBe('success');
  });

  it('keeps a trial balance without lines as one table, every row in it', async () => {
    const fixture = await convertFixture('trial-balance');
    const expected = await convertFixtureExpected('trial-balance');
    const { open } = standIn(fixture.pages, fixture.segments);
    const [file] = (await createStep(open)(harness().run, [pdf('TB.pdf', fixture.bytes, 1)], opts())).files;
    const xml = await body(file.bytes);
    const table = /<w:tbl>([\s\S]*?)<\/w:tbl>/.exec(xml)?.[1] ?? '';
    const rows = [...table.matchAll(/<w:tr>([\s\S]*?)<\/w:tr>/g)].map((r) => [...r[1].matchAll(/<w:tc>([\s\S]*?)<\/w:tc>/g)].map((c) => bodyTexts(c[1].replace(/^[\s\S]*?(?=<w:p>)/, '')).join('')));
    expect(rows).toEqual(expected.rows[0]);
    expect(file.operation!.options).toMatchObject({ tables: 1 });
  });

  it('records counts only, under RECORD_KEYS, and no word of the document', async () => {
    const fixture = await convertFixture('statement-ruled');
    const { open } = standIn(fixture.pages, fixture.segments);
    const { run, labels } = harness();
    const made = await createStep(open)(run, [pdf('Input.pdf', fixture.bytes, 3)], opts());
    const [file] = made.files;
    expect(file.operation).toMatchObject({ tool: 'pdf-to-word', summary: 'Converted to Word: 3 pages' });
    // (No page of the fixture is a scan: the count of scanned pages is in the record only when there is one.)
    expect(Object.keys(file.operation!.options)).toEqual(RECORD_KEYS.filter((key) => key !== 'pagesFromScan'));
    for (const value of Object.values(file.operation!.options)) expect(typeof value).toBe('number');
    const said = [JSON.stringify(file.operation), JSON.stringify(made.describe([file])), labels.join('\n')].join('\n');
    const fixtureWords = new Set(fixture.pages.flatMap((p) => p.words.map((w) => w.text)).filter((w) => /^[A-Za-z]{4,}$/.test(w) && !['page', 'Page', 'pages'].includes(w)));
    expect([...fixtureWords].filter((w) => said.includes(w))).toEqual([]);
  });

  it('a scan with recognised text: the scan picture is not put in the document or asked for, the message says so and the record counts the page', async () => {
    const fixture = await convertFixture('statement-plain');
    const asked = vi.fn(() => null);
    const open = async (): Promise<WordsReader> => ({
      pageCount: fixture.pages.length,
      // Every page is a scan: its words are invisible text over one picture the size of the page.
      page: async (i) => ({
        words: { ...fixture.pages[i], words: fixture.pages[i].words.map((w) => ({ ...w, hidden: true as const })) },
        segments: fixture.segments[i],
        extras: { pictures: [{ x0: 0, y0: 0, x1: fixture.pages[i].width, y1: fixture.pages[i].height }] },
        picture: asked,
      }),
      close: () => undefined,
    });
    const { run } = harness();
    const made = await createStep(open)(run, [pdf('Scan.pdf', fixture.bytes, 3)], opts());
    const [file] = made.files;
    const zip = await JSZip.loadAsync(file.bytes);
    expect(Object.keys(zip.files).filter((name) => name.startsWith('word/media/'))).toEqual([]);
    expect(await body(file.bytes)).not.toContain('<pic:pic');
    expect(asked).not.toHaveBeenCalled();
    expect(Object.keys(file.operation!.options)).toEqual([...RECORD_KEYS]);
    expect(file.operation!.options.pagesFromScan).toBe(3);
    const said = made.describe([file]);
    expect(said.detail).toMatch(/ 3 pages are scans: their text was typed from recognition and the scan pictures were left out\. Check numbers against the page\.$/);
    expect(said.tone).toBe('warning');
  });

  it('shows the pages as they are read, then the writing', async () => {
    const fixture = await convertFixture('statement-plain');
    const { open } = standIn(fixture.pages, fixture.segments);
    const { run, labels } = harness();
    await createStep(open)(run, [pdf('Input.pdf', fixture.bytes, 3)], opts());
    expect(labels).toContain(READING_LABEL(1, 3));
    expect(labels).toContain(READING_LABEL(3, 3));
    expect(labels.indexOf(WRITING_LABEL)).toBeGreaterThan(labels.lastIndexOf(READING_LABEL(3, 3)));
  });

  it('runs a mixed file, leaves a page without words empty and says so', async () => {
    const fixture = await convertFixture('statement-plain');
    const pages = fixture.pages.map((p, i) => (i === 1 ? { ...p, words: [] } : p));
    const { open } = standIn(pages, fixture.segments);
    const { run } = harness();
    const made = await createStep(open)(run, [pdf('Input.pdf', fixture.bytes, 3)], opts());
    const [file] = made.files;
    const described = made.describe([file]);
    expect(described.detail).toMatch(/ 1 page has little or no text; it may be scanned\. Make the file searchable to convert it\.$/);
    expect(described.tone).toBe('warning');
    expect(file.operation!.options.pagesNoText).toBe(1);
    // Page 2 is an empty page: two section ends with nothing between them.
    expect(await body(file.bytes)).toMatch(/<\/w:sectPr><\/w:pPr><\/w:p><w:p><w:pPr>(?:(?!<w:p>).)*?<w:sectPr>/);
  });

  it('keeps the words of a page with little text (a scan’s stamped page number) and counts the page', async () => {
    const fixture = await convertFixture('statement-plain');
    const stamp = fixture.pages[1].words.find((w) => w.text === 'Page')!;
    const pages = fixture.pages.map((p, i) => (i === 1 ? { ...p, words: [stamp, { ...stamp, text: '2', x0: stamp.x1 + 3, x1: stamp.x1 + 8 }] } : p));
    const { open } = standIn(pages, fixture.segments);
    const made = await createStep(open)(harness().run, [pdf('Input.pdf', fixture.bytes, 3)], opts());
    const [file] = made.files;
    expect(file.operation!.options.pagesNoText).toBe(1);
    expect(made.describe([file]).detail).toMatch(/ 1 page has little or no text;/);
    // Between the two section ends sits page 2's one paragraph.
    expect(await body(file.bytes)).toMatch(/<\/w:sectPr><\/w:pPr><\/w:p><w:p><w:r><w:t xml:space="preserve">Page 2<\/w:t><\/w:r><\/w:p><w:p><w:pPr>(?:(?!<w:p>).)*?<w:sectPr>/);
  });

  it('refuses a file with no text on any page, and adds nothing', async () => {
    const fixture = await convertFixture('statement-plain');
    const pages = fixture.pages.map((p) => ({ ...p, words: p.words.slice(0, 2) })); // a few stray characters
    const { open, reading } = standIn(pages, fixture.segments);
    const error = await createStep(open)(harness().run, [pdf('Scan.pdf', fixture.bytes, 3)], opts()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PdfToolsError);
    expect((error as PdfToolsError).message).toBe(`${NO_TEXT_MESSAGE} Nothing was added.`);
    expect(reading.closed).toBe(1);
  });

  it('refuses more than 1,000 pages before reading anything', async () => {
    const fixture = await convertFixture('statement-plain');
    const { open, reading } = standIn(fixture.pages, fixture.segments);
    const error = await createStep(open)(harness().run, [pdf('Big.pdf', fixture.bytes, 1001)], opts()).catch((e: unknown) => e);
    expect((error as PdfToolsError).message).toBe(`${TOO_MANY_PAGES_MESSAGE} Nothing was added.`);
    expect(reading.opened).toBe(0);
  });

  it('refuses anything but one PDF, and a result of Protect', async () => {
    const fixture = await convertFixture('statement-plain');
    const { open, reading } = standIn(fixture.pages, fixture.segments);
    const s = createStep(open);
    const one = pdf('A.pdf', fixture.bytes, 3);
    await expect(s(harness().run, [one, pdf('B.pdf', fixture.bytes, 3)], opts())).rejects.toThrow('Choose exactly one PDF.');
    await expect(s(harness().run, [{ ...one, kind: 'office', mimeType: DOCX_MIME, pageCount: null }], opts())).rejects.toThrow('Choose exactly one PDF.');
    await expect(s(harness().run, [{ ...one, protectedOutput: true }], opts())).rejects.toThrow(PROTECTED_OUTPUT_REASON);
    expect(reading.opened).toBe(0);
  });

  it('stops when the user stops: nothing is made, and the reader is let go', async () => {
    const fixture = await convertFixture('statement-plain');
    const h = harness();
    const { open, reading } = standIn(fixture.pages, fixture.segments, (i) => {
      if (i === 1) h.controller.abort();
    });
    await expect(createStep(open)(h.run, [pdf('Input.pdf', fixture.bytes, 3)], opts())).rejects.toBeInstanceOf(Cancelled);
    expect(reading).toMatchObject({ closed: 1, read: [0] });
    expect(h.store.getState().files).toEqual([]);
  });

  it('ends without a word when the list moves on (another engagement)', async () => {
    const fixture = await convertFixture('statement-plain');
    const h = harness();
    const { open, reading } = standIn(fixture.pages, fixture.segments, (i) => {
      if (i === 2) h.store.setContext('u1:B');
    });
    await expect(createStep(open)(h.run, [pdf('Input.pdf', fixture.bytes, 3)], opts())).rejects.toBeInstanceOf(Stale);
    expect(reading.closed).toBe(1);
  });

  it('passes a reading failure on as it is, and lets the reader go', async () => {
    const fixture = await convertFixture('statement-plain');
    const failure = new PdfToolsError('not-a-pdf', 'This file could not be read as a PDF. It may be damaged.');
    const { open, reading } = standIn(fixture.pages, fixture.segments, (i) => {
      if (i === 1) throw failure;
    });
    await expect(createStep(open)(harness().run, [pdf('Input.pdf', fixture.bytes, 3)], opts())).rejects.toBe(failure);
    expect(reading.closed).toBe(1);
  });

  it('marks a result of a protected file "protection removed", and never a signed file’s result as signed', async () => {
    const fixture = await convertFixture('trial-balance');
    const { open } = standIn(fixture.pages, fixture.segments);
    const [file] = (await createStep(open)(harness().run, [pdf('TB.pdf', fixture.bytes, 1, { wasProtected: true, hasSignature: true })], opts())).files;
    expect(file.operation!.flags).toEqual({ protectionRemoved: true });
    expect(file).toMatchObject({ wasProtected: false, hasSignature: false });
    expect(file.signatureInvalid).toBeUndefined();
    expect(SIGNED_WARNING).toContain('signed original is unchanged');
  });
});
