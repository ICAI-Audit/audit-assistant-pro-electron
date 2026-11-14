import { PDFDocument } from 'pdf-lib';
import { copyPagesOf, SourceScans, type OrganiseReport } from './pageCopy';
import { PdfToolsError } from './types';

export type { OrganiseReport } from './pageCopy';

const APP_NAME = 'ICAI VERA';

/** For Split (one result) and Delete pages. */
export interface OrganiseOptions {
  /** Filled in with what could not be trimmed from the result. */
  report?: OrganiseReport;
  /** Called before each page is copied, with the pages copied so far; it stops the run by throwing (a cancel). */
  onPage?: (done: number, total: number) => void | Promise<void>;
}

/** For Split every N pages. */
export interface SplitOptions {
  /** One report per part, in order. */
  reports?: OrganiseReport[];
  /** Called before each part is made; it stops the split by throwing (a cancel). */
  onPart?: (done: number, total: number) => void | Promise<void>;
}

async function load(bytes: Uint8Array, position?: number): Promise<PDFDocument> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  } catch {
    throw new PdfToolsError('not-a-pdf', 'This file could not be read as a PDF. It may be damaged.');
  }
  if (doc.isEncrypted) {
    const which = position === undefined ? 'This file is' : `File ${position} in the list is`;
    throw new PdfToolsError('encrypted', `${which} password-protected. Unlock it first.`);
  }
  return doc;
}

/** New output document; carries descriptive metadata over only when a source is given and has it. */
async function createOutput(source?: PDFDocument): Promise<PDFDocument> {
  const out = await PDFDocument.create({ updateMetadata: false });
  const now = new Date();
  out.setProducer(APP_NAME);
  out.setCreator(APP_NAME);
  out.setModificationDate(now);
  if (!source) {
    out.setCreationDate(now);
    return out;
  }
  const title = source.getTitle();
  const author = source.getAuthor();
  const subject = source.getSubject();
  const keywords = source.getKeywords();
  const created = source.getCreationDate();
  if (title !== undefined) out.setTitle(title, { showInWindowTitleBar: false });
  if (author !== undefined) out.setAuthor(author);
  if (subject !== undefined) out.setSubject(subject);
  if (keywords !== undefined) out.setKeywords([keywords]);
  if (created !== undefined) out.setCreationDate(created);
  return out;
}

async function save(doc: PDFDocument): Promise<Uint8Array> {
  return doc.save({ useObjectStreams: true });
}

/** Merge: pdf-lib's own page copy. Form fields, bookmarks and links are not carried (the dialog says so). */
async function copyInto(target: PDFDocument, source: PDFDocument, indices: number[]): Promise<void> {
  const pages = await target.copyPages(source, indices);
  pages.forEach((page) => target.addPage(page));
}

function checkIndices(indices: number[], pageCount: number): void {
  if (indices.length === 0) throw new PdfToolsError('invalid-page-list', 'Choose at least one page.');
  for (const index of indices) {
    if (!Number.isInteger(index) || index < 0) {
      throw new PdfToolsError('invalid-page-list', `Page numbers must be whole numbers from 1 to ${pageCount}.`);
    }
    if (index >= pageCount) {
      throw new PdfToolsError('invalid-page-list', `Page ${index + 1} is outside this file's ${pageCount} pages.`);
    }
  }
}

export async function mergePdfs(files: Uint8Array[]): Promise<Uint8Array> {
  if (files.length < 2) throw new PdfToolsError('merge-needs-two', 'Choose at least two files to merge.');
  const out = await createOutput();
  // Each entry is loaded separately, so the same bytes supplied twice are copied twice.
  for (const [i, file] of files.entries()) {
    const source = await load(file, i + 1);
    await copyInto(out, source, source.getPageIndices());
  }
  return save(out);
}

/** The pages at `indices`, in that order (pageCopy.ts says what comes with them). */
export async function extractPages(file: Uint8Array, indices: number[], options: OrganiseOptions = {}): Promise<Uint8Array> {
  const source = await load(file);
  checkIndices(indices, source.getPageCount());
  const out = await createOutput(source);
  await copyPagesOf(out, source, indices, options.report ?? {}, { onPage: options.onPage });
  return save(out);
}

export async function splitEvery(file: Uint8Array, n: number, options: SplitOptions = {}): Promise<Uint8Array[]> {
  const source = await load(file);
  const pageCount = source.getPageCount();
  if (pageCount < 2) {
    throw new PdfToolsError('invalid-split-size', 'This file has only one page, so it cannot be split. Choose a file with at least two pages.');
  }
  if (!Number.isInteger(n) || n < 1 || n >= pageCount) {
    throw new PdfToolsError('invalid-split-size', `Enter a number from 1 to ${pageCount - 1}.`);
  }
  const total = Math.ceil(pageCount / n);
  const parts: Uint8Array[] = [];
  const scans = new SourceScans(); // the source is read once for all the parts
  for (let start = 0; start < pageCount; start += n) {
    await options.onPart?.(parts.length, total);
    const out = await createOutput(source);
    const end = Math.min(start + n, pageCount);
    const report: OrganiseReport = {};
    await copyPagesOf(out, source, Array.from({ length: end - start }, (_, i) => start + i), report, { scans });
    options.reports?.push(report);
    parts.push(await save(out));
  }
  return parts;
}

export async function deletePages(file: Uint8Array, indices: number[], options: OrganiseOptions = {}): Promise<Uint8Array> {
  const source = await load(file);
  const pageCount = source.getPageCount();
  checkIndices(indices, pageCount);
  const doomed = new Set(indices);
  const keep = source.getPageIndices().filter((i) => !doomed.has(i));
  if (keep.length === 0) throw new PdfToolsError('cannot-delete-all', 'You cannot delete every page of a PDF.');
  const out = await createOutput(source);
  await copyPagesOf(out, source, keep, options.report ?? {}, { onPage: options.onPage });
  return save(out);
}
