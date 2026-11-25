// Before a run: which pages of the file are scans (a watermark behind them cannot be seen, design
// 5.16) and which carry form fields (painted over anything drawn in front). Read with pdf-lib, page
// by page, pausing so the dialog stays responsive; the bytes are only read.
//
// "A scan" is the marks library's `looksScanned`: no text and pictures over 90% of the page. The
// text is the page's own drawing instructions: text drawn invisibly (render mode 3 or 7, the text
// layer OCR adds to a scan) does not count, because a watermark behind such a page is just as hidden.
import { PDFArray, PDFDict, PDFName, PDFRawStream, PDFRef, PDFStream, type PDFPage } from 'pdf-lib';
import { loadPaced } from '@/lib/pdf-tools/pace';
import { decodeStreamBytes, hasWidgets, looksScanned, tokenize } from '@/lib/pdf-tools/marks';
import { abortError } from '../renderQueue';

export interface PageScan {
  pageCount: number;
  /** Pages (from 1) that look scanned. */
  scans: number[];
  /** Pages (from 1) with form fields. */
  withFields: number[];
}

const SHOW_TEXT = new Set(['Tj', 'TJ', "'", '"']);
const MAX_DEPTH = 8;

function latin1(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 8192) out += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return out;
}

function contentStreams(page: PDFPage): PDFStream[] | null {
  const contents = page.node.Contents();
  if (!contents) return [];
  if (contents instanceof PDFStream) return [contents];
  const streams: PDFStream[] = [];
  for (let i = 0; i < (contents as PDFArray).size(); i++) {
    const item = (contents as PDFArray).lookup(i);
    if (!(item instanceof PDFStream)) return null;
    streams.push(item);
  }
  return streams;
}

/** Text drawn visibly in `content` (or a form it draws): true, false, or null when something could not be read. */
function showsText(content: string, resources: PDFDict | undefined, mode: number, depth: number, seen: Set<PDFRef>): boolean | null {
  const stack: number[] = [];
  let current = mode;
  let lastNumber = 0;
  let lastName = '';
  let answer: boolean | null = false;
  let done = false;
  tokenize(content, (t) => {
    if (done) return;
    if (t.k === 'num') lastNumber = t.v;
    else if (t.k === 'name') lastName = t.v;
    if (t.k !== 'op') return;
    if (t.v === 'q') stack.push(current);
    else if (t.v === 'Q') current = stack.pop() ?? current;
    else if (t.v === 'Tr') current = lastNumber;
    else if (SHOW_TEXT.has(t.v)) {
      if (current !== 3 && current !== 7) {
        answer = true;
        done = true;
      }
    } else if (t.v === 'Do' && depth < MAX_DEPTH) {
      const xobjects = resources?.lookupMaybe(PDFName.of('XObject'), PDFDict);
      const raw = xobjects?.get(PDFName.of(lastName));
      const form = xobjects?.lookup(PDFName.of(lastName));
      if (!(form instanceof PDFRawStream) || form.dict.lookup(PDFName.of('Subtype')) !== PDFName.of('Form')) return;
      if (raw instanceof PDFRef) {
        if (seen.has(raw)) return;
        seen.add(raw);
      }
      const bytes = decodeStreamBytes(form);
      if (bytes === null) {
        answer = null;
        done = true;
        return;
      }
      const inner = showsText(latin1(bytes), form.dict.lookupMaybe(PDFName.of('Resources'), PDFDict) ?? resources, current, depth + 1, seen);
      if (inner !== false) {
        answer = inner;
        done = true;
      }
    }
  });
  return answer;
}

/** Whether the page draws text a reader can see: true, false, or null when its content cannot be read. */
export function pageShowsText(page: PDFPage): boolean | null {
  const streams = contentStreams(page);
  if (streams === null) return null;
  const parts: string[] = [];
  for (const stream of streams) {
    const bytes = decodeStreamBytes(stream);
    if (bytes === null) return null;
    parts.push(latin1(bytes));
  }
  return showsText(parts.join('\n'), page.node.Resources(), 0, 0, new Set());
}

export interface ScanOptions {
  signal?: AbortSignal;
  /** Pause after this many pages (default 10). */
  pauseEvery?: number;
  /** How to pause (default: a zero timer, so the window can paint and take input). */
  pause?: () => Promise<void>;
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Reads every page of `file`; rejects with an AbortError when the signal fires, or when the file cannot be read. */
export async function scanPages(file: Uint8Array, options: ScanOptions = {}): Promise<PageScan> {
  const { signal, pauseEvery = 10, pause = tick } = options;
  const check = () => {
    if (signal?.aborted) throw abortError();
  };
  check();
  const doc = await loadPaced(file, { updateMetadata: false }); // pdf-lib's own load, waiting by the clock
  check();
  const pages = doc.getPages();
  const scans: number[] = [];
  const withFields: number[] = [];
  for (const [i, page] of pages.entries()) {
    // Unreadable content counts as text: no warning is better than a wrong one.
    const text = pageShowsText(page) ?? true;
    if (looksScanned(page, text)) scans.push(i + 1);
    if (hasWidgets(page)) withFields.push(i + 1);
    if ((i + 1) % pauseEvery === 0) {
      await pause();
      check();
    }
  }
  return { pageCount: pages.length, scans, withFields };
}
