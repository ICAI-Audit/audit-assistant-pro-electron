// The Document check report (checkReport.ts, contract REV): A4 portrait, 36 pt margins, Helvetica 10, a bold
// 14 title and the shared footer; the same rows as the dialog (factRows); no title or author of its own; standard
// fonts only, a word they cannot print shown as "[word in another script]" and counted. Read back with pdf-lib
// and pdf.js.
import { PDFDict, PDFDocument, PDFName } from 'pdf-lib';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { buildCheckReport, buildCheckReportCounted, footerText, OTHER_SCRIPT, REPORT_TITLE } from './checkReport';
import { factRows, type DocumentFacts, type SignatureFact } from './documentCheck';
import { inspectPdf } from './inspect';

vi.setConfig({ testTimeout: 60_000 });

const MADE_ON = new Date(2026, 10, 17, 14, 5);

const facts = (over: Partial<DocumentFacts> = {}): DocumentFacts => ({
  pageCount: 12,
  sizeBytes: 1_258_291,
  pageSizes: [
    { label: 'A4 portrait', pages: 10 },
    { label: 'A4 landscape', pages: 2 },
  ],
  protection: 'none',
  signatures: [{ signer: 'Signer Alpha Example', signedOn: '17 November 2026, 14:05 (UTC+05:30)', reason: 'Approved for filing', location: 'Test City', coversWholeFile: true }],
  text: { pagesWithText: 9, pagesScanned: 2, pagesEmpty: 1 },
  properties: {
    title: 'Invented Trial Balance FY 2025-26',
    author: 'Invented Accounts Team',
    subject: null,
    keywords: null,
    creator: 'Invented Writer 3',
    producer: null,
    created: '1 April 2026, 09:30 (UTC+05:30)',
    modified: null,
  },
  pdfVersion: '1.7',
  hasBookmarks: true,
  hasFormFields: false,
  hasAttachments: false,
  ...over,
});

interface Item {
  str: string;
  x: number;
  width: number;
  size: number;
  font: string;
}

/** Every page's text items as pdf.js reads them. */
async function readPages(bytes: Uint8Array): Promise<Item[][]> {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdf = await getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 }).promise;
  const pages: Item[][] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const content = await page.getTextContent();
    pages.push(
      content.items.flatMap((item) => ('str' in item ? [{ str: item.str, x: item.transform[4], width: item.width, size: Math.abs(item.transform[3]), font: item.fontName }] : [])),
    );
  }
  await pdf.destroy();
  return pages;
}

const squash = (text: string) => text.replace(/\s+/g, '');
const allText = (pages: Item[][]) => pages.map((items) => items.map((i) => i.str).join(' ')).join('\n');

describe('buildCheckReport', () => {
  let bytes: Uint8Array;
  let pages: Item[][];
  beforeAll(async () => {
    bytes = await buildCheckReport('Invented Ledger.pdf', facts(), MADE_ON);
    pages = await readPages(bytes);
  });

  it('is one A4 portrait page with no title or author of its own', async () => {
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    expect(doc.getPageCount()).toBe(1);
    const { width, height } = doc.getPage(0).getSize();
    expect([Math.round(width * 100) / 100, Math.round(height * 100) / 100]).toEqual([595.28, 841.89]);
    expect(doc.getTitle()).toBeUndefined();
    expect(doc.getAuthor()).toBeUndefined();
    expect(doc.getSubject()).toBeUndefined();
    expect(doc.getKeywords()).toBeUndefined();
    expect(doc.getProducer()).toBe('ICAI VERA');
    expect(doc.getCreator()).toBe('ICAI VERA');
    const info = await inspectPdf(bytes);
    expect(info.carried).toEqual({ comments: 0, attachments: 0, properties: [] });
    expect(info.hasSignature).toBe(false);
    expect(info.pageCount).toBe(1);
  });

  it('holds the title, the file name, when it was made, every row of the dialog and the footer', () => {
    const text = squash(allText(pages));
    expect(text).toContain(squash(REPORT_TITLE));
    expect(REPORT_TITLE).toBe('Document check');
    expect(text).toContain(squash('Invented Ledger.pdf'));
    expect(text).toContain(squash('Checked on 17 November 2026, 14:05'));
    for (const row of factRows(facts())) {
      expect(text).toContain(squash(row.label));
      expect(text).toContain(squash(row.value));
      if (row.note) expect(text).toContain(squash(row.note));
    }
    expect(text).toContain(squash('Made by ICAI VERA PDF Tools on this computer · page 1 of 1'));
    expect(footerText(2, 3)).toBe('Made by ICAI VERA PDF Tools on this computer · page 2 of 3');
  });

  it('never says "valid", and never shows a stored date', () => {
    const text = allText(pages);
    expect(text).not.toMatch(/valid/i);
    expect(text).not.toMatch(/D:\d{4}/);
  });

  it('uses Helvetica 10 for the rows and a bold 14 title, standard fonts only, inside the margins', async () => {
    const items = pages[0].filter((i) => i.str.trim() !== '');
    const sizes = new Set(items.map((i) => Math.round(i.size)));
    expect(sizes.has(14)).toBe(true);
    expect(sizes.has(10)).toBe(true);
    for (const item of items) {
      expect(item.x).toBeGreaterThanOrEqual(36 - 0.01);
      expect(item.x + item.width, item.str).toBeLessThanOrEqual(595.28 - 36 + 0.5);
    }
    const doc = await PDFDocument.load(bytes);
    const fonts = doc.getPage(0).node.Resources()!.lookup(PDFName.of('Font'), PDFDict);
    const names = fonts.keys().map((key) => {
      const font = fonts.lookup(key, PDFDict);
      expect(font.has(PDFName.of('FontDescriptor'))).toBe(false); // nothing embedded
      return font.lookup(PDFName.of('BaseFont'), PDFName).decodeText();
    });
    expect(new Set(names)).toEqual(new Set(['Helvetica', 'Helvetica-Bold']));
  });
});

describe('long reports and other scripts', () => {
  it('runs onto more pages when the facts need them, numbering every page', async () => {
    const many: SignatureFact[] = Array.from({ length: 70 }, (_, i) => ({ signer: `Signer ${i + 1} Example`, signedOn: '18 November 2026', reason: 'Invented reason', location: null, coversWholeFile: false }));
    const made = await buildCheckReportCounted('Invented Ledger.pdf', facts({ signatures: many }), MADE_ON);
    expect(made.pages).toBeGreaterThan(1);
    const pages = await readPages(made.bytes);
    expect(pages).toHaveLength(made.pages);
    pages.forEach((items, i) => expect(squash(items.map((x) => x.str).join(''))).toContain(squash(footerText(i + 1, made.pages))));
    expect(squash(allText(pages))).toContain(squash('Signer 70 Example'));
  });

  it('wraps a long value inside the margins', async () => {
    const long = `Invented ${'keyword '.repeat(30)}end`; // under the 300 characters a value is cut at
    const made = await buildCheckReportCounted('Invented Ledger.pdf', facts({ properties: { ...facts().properties, keywords: long } }), MADE_ON);
    const pages = await readPages(made.bytes);
    for (const item of pages.flat()) expect(item.x + item.width, item.str).toBeLessThanOrEqual(595.28 - 36 + 0.5);
    expect(squash(allText(pages))).toContain(squash(long));
  });

  it('breaks a single word longer than a line', async () => {
    const made = await buildCheckReportCounted(`${'A'.repeat(200)}.pdf`, facts(), MADE_ON);
    const pages = await readPages(made.bytes);
    for (const item of pages.flat()) expect(item.x + item.width, item.str).toBeLessThanOrEqual(595.28 - 36 + 0.5);
    expect(squash(allText(pages))).toContain(`${'A'.repeat(200)}.pdf`);
  });

  it('shows a word the standard fonts cannot print as "[word in another script]" and counts it', async () => {
    const made = await buildCheckReportCounted(
      'बैलेंस शीट.pdf',
      facts({ signatures: [{ signer: 'Signer दिनेश Example', signedOn: null, reason: null, location: null, coversWholeFile: true }], properties: { ...facts().properties, title: '₹ Invented' } }),
      MADE_ON,
    );
    expect(OTHER_SCRIPT).toBe('[word in another script]');
    expect(made.wordsNotShown).toBe(4); // two in the file name, one in the signer's name, the ₹ sign of the title
    const text = allText(await readPages(made.bytes));
    expect(text).toContain(OTHER_SCRIPT);
    expect(text).not.toMatch(/[\u0900-\u097f₹]/);
    expect(squash(text)).toContain(squash('Signed by Signer [word in another script] Example'));
  });
});
