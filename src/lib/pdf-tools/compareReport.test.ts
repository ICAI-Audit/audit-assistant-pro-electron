// Compare's report (compareReport.ts; contract T-064 decisions 3, 6, 8 and 17): a summary first, then each
// page that differs with its changes in context; standard fonts only; no title or author. Every text is
// invented. The report is read back with pdf-lib (properties, page size) and pdf.js (its text).
import { PDFDocument } from 'pdf-lib';
import { afterAll, describe, expect, it } from 'vitest';
import { buildCompareReport, MAX_DETAILED_PAGES, NOT_PRINTABLE } from './compareReport';
import { compareTexts, type Comparison } from './compareText';
import { buildPageText } from './pageText';
import { fixturePages, inventedPage, inventedWords, pdfjsTextSource } from './testComparePdf';

const reader = pdfjsTextSource();
afterAll(() => reader.close());

const noPace = () => undefined;
const MADE_ON = new Date(2026, 10, 17, 21, 40);
const names = { earlier: 'Accounts draft.pdf', later: 'Accounts signed.pdf' };

/** Every page's text as the application reads it (pdf.js items joined by buildPageText). */
async function reportText(bytes: Uint8Array): Promise<string[]> {
  const doc = await PDFDocument.load(bytes);
  const texts: string[] = [];
  for (let i = 0; i < doc.getPageCount(); i++) {
    const { items, styles } = await reader.pageTextContent(bytes, i);
    texts.push(buildPageText(i, items, styles, [0, 0, 0, 0], 0).text.replace(/\s+/g, ' '));
  }
  return texts;
}

const texts = (pages: readonly (string | { scanned: true })[]) => pages.map((p) => (typeof p === 'string' ? p : ''));

async function draftSigned(): Promise<Comparison> {
  const { earlier, later } = fixturePages('draft-signed');
  return compareTexts(texts(earlier), texts(later), noPace);
}

describe('buildCompareReport', () => {
  it('groups the digits of large counts (1,350 words, not 1350)', async () => {
    // Three pages of 1,000 words; in the later version 450 words of each are others (the pages still pair up).
    const pages = [3, 5, 7].map((seed) => inventedWords(seed, 1000));
    const changed = pages.map((words) => words.map((word, i) => (i < 900 && i % 2 === 0 ? `${word}x` : word)));
    const c = await compareTexts(pages.map((w) => w.join(' ')), changed.map((w) => w.join(' ')), noPace);
    const all = (await reportText((await buildCompareReport(names, c, MADE_ON)).bytes)).join(' ');
    expect(c.wordsChanged).toBe(1350);
    expect(all).toContain('Words changed: 1,350');
    expect(all).not.toContain('Words changed: 1350');
  });

  it('starts with the summary, then lists each differing page with its changes in context, on A4 with the footer', async () => {
    const c = await draftSigned();
    const report = await buildCompareReport(names, c, MADE_ON);
    const doc = await PDFDocument.load(report.bytes);
    expect(report.pages).toBe(doc.getPageCount());
    for (const page of doc.getPages()) {
      expect(page.getWidth()).toBeCloseTo(595.28, 1);
      expect(page.getHeight()).toBeCloseTo(841.89, 1);
    }
    const pages = await reportText(report.bytes);
    const all = pages.join(' ');
    expect(pages[0]).toContain('Comparison of two versions');
    expect(pages[0]).toContain('Made on 17 November 2026');
    expect(pages[0]).toContain('Earlier version: Accounts draft.pdf, 12 pages');
    expect(pages[0]).toContain('Later version: Accounts signed.pdf, 12 pages');
    expect(pages[0]).toContain('Pages that differ: 2 of 12');
    expect(pages[0]).toContain('Pages that differ are pages in both versions whose text differs, out of the pages of the later version.');
    expect(pages[0]).not.toContain('Pages in both versions with different text');
    expect(pages[0]).toContain('Pages only in the earlier version: 0');
    expect(pages[0]).toContain('Pages only in the later version: 0');
    expect(all).toMatch(/Words added: 7\b/);
    expect(all).toContain('Earlier page 3 and later page 3');
    expect(all).toContain('Earlier page 8 and later page 8');
    expect(all).toContain('subject to approval at the general meeting');
    expect(all).toContain('1,24,000.00');
    expect(all).toMatch(/Changed: .*→ ?1,24,000\.00/);
    pages.forEach((text, i) => expect(text).toContain(`Made by ICAI VERA PDF Tools on this computer · page ${i + 1} of ${pages.length}`));
    expect(report.wordsNotShown).toBe(0);
  });

  it('sets no title or author (and no subject or keywords); the producer is ICAI VERA', async () => {
    const report = await buildCompareReport(names, await draftSigned(), MADE_ON);
    const doc = await PDFDocument.load(report.bytes, { updateMetadata: false });
    expect(doc.getTitle()).toBeUndefined();
    expect(doc.getAuthor()).toBeUndefined();
    expect(doc.getSubject()).toBeUndefined();
    expect(doc.getKeywords()).toBeUndefined();
    expect(doc.getProducer()).toBe('ICAI VERA');
    expect(doc.getCreator()).toBe('ICAI VERA');
  });

  it('prints a word the standard fonts cannot draw as [word in another script] and counts it; ₹ as Rs.', async () => {
    const c = await compareTexts(['one two three लेखा four five ₹500 six'], ['one two three ledger four five ₹750 six'], noPace);
    const report = await buildCompareReport(names, c, MADE_ON);
    const all = (await reportText(report.bytes)).join(' ');
    expect(all).toContain(NOT_PRINTABLE);
    expect(all).toContain('Rs.750');
    expect(all).not.toMatch(/[ऀ-ॿ]/);
    expect(report.wordsNotShown).toBe(1);
    expect(all).toContain('Words shown as [word in another script]: 1');
  });

  it('a page only in one file is listed with how it begins; a page without text says so', async () => {
    const extra = inventedPage(77, 60);
    const c = await compareTexts([inventedPage(1, 80)], [inventedPage(1, 80), extra, ''], noPace);
    const all = (await reportText((await buildCompareReport(names, c, MADE_ON)).bytes)).join(' ');
    expect(all).toContain('Later page 2: only in the later version');
    expect(all).toContain(`Begins: ${extra.split(/\s+/).slice(0, 12).join(' ')}`);
    expect(all).toContain('Later page 3: only in the later version');
    expect(all).toContain('This page has no text.');
  });

  it(`details at most ${MAX_DETAILED_PAGES} differing pages and counts the rest`, async () => {
    const earlier = Array.from({ length: 250 }, (_, i) => `page ${i} ${inventedWords(i, 30).join(' ')} 1,00,000.00`);
    const later = earlier.map((t) => t.replace('1,00,000.00', '2,00,000.00'));
    const c = await compareTexts(earlier, later, noPace);
    expect(c.pagesDiffer).toBe(250);
    const report = await buildCompareReport(names, c, MADE_ON);
    const all = (await reportText(report.bytes)).join(' ');
    expect(all).toContain('Earlier page 200 and later page 200');
    expect(all).not.toContain('Earlier page 201 and later page 201');
    expect(all).toContain('50 more pages differ. They are counted in the summary but not detailed in this report.');
  }, 60_000);

  it('shortens a long passage and caps the changes listed for one page, saying how many are left out', async () => {
    const base = inventedWords(5, 1200);
    const earlier = [...base.slice(0, 100), ...inventedWords(6, 300), ...base.slice(100)];
    // 250 separate one-word changes further on, each 3 words apart (the first two words after the passage kept).
    const later = [...base.slice(0, 100), ...base.slice(100).map((w, i) => (i % 4 === 2 && i < 1000 ? `${w}x` : w))];
    const c = await compareTexts([earlier.join(' ')], [later.join(' ')], noPace);
    const all = (await reportText((await buildCompareReport(names, c, MADE_ON)).bytes)).join(' ');
    expect(all).toContain('(300 words)');
    expect(all).toMatch(/and \d+ more changes on this page are not listed\./);
  }, 60_000);

  it('gives the window turns while it writes, through the pace it is given', async () => {
    const earlier = Array.from({ length: 30 }, (_, i) => `page ${i} ${inventedWords(i, 30).join(' ')} 1,00,000.00`);
    const c = await compareTexts(earlier, earlier.map((t) => t.replace('1,00,000.00', '2,00,000.00')), noPace);
    let calls = 0;
    await buildCompareReport(names, c, MADE_ON, () => {
      calls += 1;
      return undefined;
    });
    // At least one chance of a turn for each page and each change it lists.
    expect(calls).toBeGreaterThanOrEqual(60);
  });
});
