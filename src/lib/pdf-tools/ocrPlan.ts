// Make searchable (T-064, OCR part A; contract section 6): which pages of a file are recognised.
//
// The rule (ruling of 18 November 2026): a page with fewer than 20 characters of text is recognised whenever
// anything is drawn on it: a picture of any size, a line, a filled shape (letters drawn as shapes are read this
// way too). PDF to Excel and PDF to Word tell the user to make the file searchable for every page with fewer than
// 20 characters, so this tool must take every such page that can hold anything to read. Document check counts its
// "pages that look scanned" with `pageKind` and `pageHasDrawing` below, so the two tools never disagree. A page with
// 20 characters or more already has text and is copied as it is. A page with little text and nothing drawn is left
// as it is and counted as empty. A page whose text cannot be read is left as it is too (recognising it could put
// its text in twice). Every page recognised is drawn whole first, so a page that turns out blank simply gives no
// words. The kind is still named 'scanned': little text, something drawn.
//
// "Recognise every page" is not offered on screen in this first version (keep the screen simple); `planPages`
// takes it as one argument so that adding it later changes nothing else.
import { PDFArray, PDFName, PDFStream, type PDFDocument, type PDFPage } from 'pdf-lib';
import { SCANNED_MAX_CHARS } from './layout';
import { decodeStreamBytes, tokenize } from './marks';
import type { Pace } from './pace';

/** What a page is: little text and something drawn ('scanned': it is recognised), it has text, it has neither, or its text could not be read. */
export type PageKind = 'scanned' | 'text' | 'empty' | 'unread';

/** Which pages are recognised: those with little text and something drawn (the default and, for now, the only choice on screen), or every page. */
export type RecogniseChoice = 'scanned-pages' | 'every-page';

export interface PlannedPage {
  pageIndex: number;
  kind: PageKind;
  recognise: boolean;
}

export interface OcrPlan {
  total: number;
  pages: PlannedPage[];
  /** Indexes (from 0) of the pages to recognise, in page order. */
  toRecognise: number[];
  scanned: number;
  withText: number;
  empty: number;
  unread: number;
}

/** A page's kind from its count of non-space characters (null when its text could not be read) and whether anything is drawn on it. */
export function pageKind(chars: number | null, drawn: boolean): PageKind {
  if (chars === null) return 'unread';
  if (chars >= SCANNED_MAX_CHARS) return 'text';
  return drawn ? 'scanned' : 'empty';
}

/** The operators that put something other than text on a page: a picture or a form (Do), an inline picture (EI), a shading, a stroked or filled path. */
const DRAWING_OPERATORS = new Set(['Do', 'EI', 'sh', 'S', 's', 'f', 'F', 'f*', 'B', 'B*', 'b', 'b*']);

/**
 * Whether anything but text is drawn on the page: any picture, form, shading or path in its own content. Text
 * does not count (a page holding only "Page 7" has nothing to recognise). A form is not looked into: drawing one
 * counts. A page whose content cannot be read counts as drawn: it is then drawn whole and its picture decides.
 */
export function pageHasDrawing(page: PDFPage): boolean {
  try {
    const context = page.node.context;
    const contents = page.node.lookup(PDFName.of('Contents'));
    if (!contents) return false;
    const parts = contents instanceof PDFArray ? contents.asArray().map((part) => context.lookup(part)) : [contents];
    let drawn = false;
    for (const part of parts) {
      if (!(part instanceof PDFStream)) continue;
      const bytes = decodeStreamBytes(part);
      if (bytes === null) return true;
      let text = '';
      for (let i = 0; i < bytes.length; i += 32768) text += String.fromCharCode(...bytes.subarray(i, i + 32768));
      tokenize(text, (token) => {
        if (token.k === 'op' && DRAWING_OPERATORS.has(token.v)) drawn = true;
      });
      if (drawn) return true;
    }
    return false;
  } catch {
    return true;
  }
}

/** The plan from each page's kind. */
export function planPages(kinds: readonly PageKind[], choice: RecogniseChoice = 'scanned-pages'): OcrPlan {
  const pages = kinds.map((kind, pageIndex) => ({ pageIndex, kind, recognise: choice === 'every-page' || kind === 'scanned' }));
  const count = (kind: PageKind) => kinds.filter((k) => k === kind).length;
  return {
    total: kinds.length,
    pages,
    toRecognise: pages.filter((p) => p.recognise).map((p) => p.pageIndex),
    scanned: count('scanned'),
    withText: count('text'),
    empty: count('empty'),
    unread: count('unread'),
  };
}

/** No page is to be recognised: the tool adds nothing and says so in one sentence (ocrForm.ts nothingToRecogniseMessage). */
export function nothingToRecognise(plan: OcrPlan): boolean {
  return plan.toRecognise.length === 0;
}

export interface PlanDeps {
  /** Non-space characters of page `i` (from 0), as the application's reader counts them (pdf.js; documentCheck.ts charsIn). */
  pageChars(pageIndex: number): Promise<number>;
}

export interface PlanOptions {
  choice?: RecogniseChoice;
  /** Gives the window a turn between pages (pace.ts pacer). */
  pace?: Pace;
  /** The run's Stop check; it stops by throwing, and that error is passed on as it is. */
  check?: () => void;
  /** After each page, with the pages read so far. */
  onPage?(done: number, total: number): void;
}

/**
 * Reads each page's text count, and whether anything is drawn on it, and makes the plan. The drawing is looked at
 * only for pages with little text. A page whose count cannot be read is 'unread'; a Stop (`check` throwing) ends it.
 */
export async function readPlan(doc: PDFDocument, deps: PlanDeps, opts: PlanOptions = {}): Promise<OcrPlan> {
  const pages = doc.getPages();
  const kinds: PageKind[] = [];
  for (let i = 0; i < pages.length; i++) {
    opts.check?.();
    let chars: number | null;
    try {
      chars = await deps.pageChars(i);
    } catch {
      opts.check?.();
      chars = null;
    }
    opts.check?.();
    kinds.push(chars !== null && chars < SCANNED_MAX_CHARS ? pageKind(chars, pageHasDrawing(pages[i])) : pageKind(chars, false));
    opts.onPage?.(i + 1, pages.length);
    const turn = opts.pace?.();
    if (turn) await turn;
  }
  return planPages(kinds, opts.choice);
}
