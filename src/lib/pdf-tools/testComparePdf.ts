/**
 * TEST HELPER (Compare; T-064): invented texts and PDF pairs built with pdf-lib, and a page-text reader
 * on pdf.js in Node shaped like the application's (pdfRenderer.ts pageTextContent), for compareRun's
 * test seam. Never imported by the application. Every name, word and amount here is made up.
 */
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import type { FontStyleLike, TextItemLike } from './pageText';

// ---- invented words ---------------------------------------------------------------------------------

const SYLLABLES = ['ka', 'lo', 'mi', 'ne', 'ru', 'ta', 'vo', 'si', 'pe', 'da', 'gu', 'ho', 'ji', 'be', 'zo', 'fa', 'wy', 'qe', 'xu', 'ci', 'mo', 'la', 'ri', 'te', 'sa', 'no', 'pu', 'de', 'ga', 'hi'];

/** A small deterministic generator (the same seed, the same words). */
function generator(seed: number): () => number {
  let s = (seed * 2654435761 + 97) >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 0x1_0000_0000;
  };
}

/** An invented amount, written with Indian grouping (for example 1,23,456.78). */
function amount(next: () => number): string {
  const lakhs = 1 + Math.floor(next() * 98);
  const thousands = String(Math.floor(next() * 100)).padStart(2, '0');
  const units = String(Math.floor(next() * 1000)).padStart(3, '0');
  const paise = String(Math.floor(next() * 100)).padStart(2, '0');
  return `${lakhs},${thousands},${units}.${paise}`;
}

/**
 * `n` invented words for a seed: pseudo-words of three or four syllables (some 800,000 of them, so two
 * seeds share few words), with an amount about every 25th word.
 */
export function inventedWords(seed: number, n: number): string[] {
  const next = generator(seed);
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    if (next() < 0.04) {
      out.push(amount(next));
      continue;
    }
    const parts = 3 + (next() < 0.5 ? 1 : 0);
    let word = '';
    for (let k = 0; k < parts; k++) word += SYLLABLES[Math.floor(next() * SYLLABLES.length)];
    out.push(word);
  }
  return out;
}

/** Words as lines of `perLine` words. */
export function asLines(words: readonly string[], perLine = 12): string[] {
  const lines: string[] = [];
  for (let i = 0; i < words.length; i += perLine) lines.push(words.slice(i, i + perLine).join(' '));
  return lines;
}

/** An invented page of `n` words, in lines of 12. */
export function inventedPage(seed: number, n: number): string {
  return asLines(inventedWords(seed, n)).join('\n');
}

/** The large page's size: over the 5,000 words at which Compare works in larger pieces. */
export const LARGE_PAGE_WORD_COUNT = 6_200;

/**
 * A page of 6,200 words and its later version, changed all over the page so that no common start or end
 * makes it short: 6 amounts changed, 4 words added (two places of two), 3 removed (one place of one and
 * one of two).
 */
export function largePageWords(): { earlier: string[]; later: string[] } {
  const earlier = inventedWords(4242, LARGE_PAGE_WORD_COUNT);
  // Amounts to change: six of them, spread over the page.
  const amounts = earlier.map((w, i) => (/^\d/.test(w) ? i : -1)).filter((i) => i >= 0);
  const step = Math.floor(amounts.length / 7);
  const changed = new Set([1, 2, 3, 4, 5, 6].map((k) => amounts[k * step]));
  // Edits away from the changed amounts and from each other.
  const clear = (i: number) => [...changed].every((c) => Math.abs(c - i) > 6);
  const near = (target: number) => {
    let i = target;
    while (!clear(i) || /^\d/.test(earlier[i])) i += 1;
    return i;
  };
  const addAt = [near(40), near(3_100)];
  const removeOne = near(1_500);
  const removeTwo = near(5_900);
  const later: string[] = [];
  earlier.forEach((word, i) => {
    if (addAt[0] === i) later.push('zzaddedone', 'zzaddedtwo');
    if (addAt[1] === i) later.push('zzaddedthree', 'zzaddedfour');
    if (i === removeOne || i === removeTwo || i === removeTwo + 1) return;
    later.push(changed.has(i) ? `9,${String(i % 100).padStart(2, '0')},000.00` : word);
  });
  return { earlier, later };
}

/** The large page as page texts (lines of 13 words). */
export function largePageTexts(): { earlier: string; later: string } {
  const { earlier, later } = largePageWords();
  return { earlier: asLines(earlier, 13).join('\n'), later: asLines(later, 13).join('\n') };
}

// ---- PDFs ---------------------------------------------------------------------------------------------

/** A page as drawn: lines of text, or a scanned page (a grey picture and no text). */
export type FixturePage = string | { scanned: true };

/** A PDF whose pages hold the given lines in Helvetica; a page with many lines is made taller to hold them. */
export async function textPdf(pages: readonly FixturePage[], options: { size?: number } = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const content of pages) {
    if (typeof content !== 'string') {
      const page = doc.addPage([595.28, 841.89]);
      page.drawRectangle({ x: 20, y: 20, width: 555, height: 800, color: rgb(0.82, 0.82, 0.8) });
      continue;
    }
    const lines = content.split('\n');
    const size = options.size ?? (lines.length > 80 ? 5 : 9);
    const leading = size * 1.3;
    const height = Math.max(841.89, lines.length * leading + 72);
    const width = lines.length > 80 ? 700 : 595.28;
    const page = doc.addPage([width, height]);
    lines.forEach((line, i) => page.drawText(line, { x: 36, y: height - 36 - size - i * leading, size, font }));
  }
  return doc.save();
}

/** A page of invented notes to the accounts: a heading line, then lines of words and amounts. */
export function notesPage(note: number, seed: number, words = 140): string {
  return [`Vera Example Co Notes to the accounts Note ${note}`, ...asLines(inventedWords(seed, words))].join('\n');
}

export type CompareFixtureName = 'draft-signed' | 'inserted-page' | 'removed-page' | 'different-counts' | 'identical' | 'large-page' | 'scanned';

export interface CompareFixture {
  earlier: Uint8Array;
  later: Uint8Array;
  earlierPages: number;
  laterPages: number;
  /** Pages that differ, of `pairs` rows of the comparison (the message "x of n pages differ"). */
  differ: number;
  pairs: number;
}

/** The invented 12 pages of the draft. */
function draftPages(): string[] {
  return Array.from({ length: 12 }, (_, i) => notesPage(i + 1, 100 + i));
}

/** The pages of each fixture pair, as text. */
export function fixturePages(name: CompareFixtureName): { earlier: FixturePage[]; later: FixturePage[]; differ: number; pairs: number } {
  const draft = draftPages();
  switch (name) {
    case 'draft-signed': {
      // The signed set: an amount changed on page 3, a phrase added on page 8; page 5 re-wrapped (not a difference).
      const signed = [...draft];
      const words3 = draft[2].split('\n').map((l) => l.split(' '));
      const amountLine = words3.findIndex((l, k) => k > 0 && l.some((w) => /^\d/.test(w)));
      words3[amountLine] = words3[amountLine].map((w) => (/^\d/.test(w) ? '1,24,000.00' : w));
      signed[2] = words3.map((l) => l.join(' ')).join('\n');
      const lines8 = draft[7].split('\n');
      lines8.splice(4, 0, 'subject to approval at the general meeting');
      signed[7] = lines8.join('\n');
      signed[4] = asLines(draft[4].split(/\s+/), 7).join('\n');
      return { earlier: draft, later: signed, differ: 2, pairs: 12 };
    }
    case 'inserted-page':
      return { earlier: draft, later: [...draft.slice(0, 4), notesPage(41, 900), ...draft.slice(4)], differ: 1, pairs: 13 };
    case 'removed-page':
      return { earlier: draft, later: [...draft.slice(0, 6), ...draft.slice(7)], differ: 1, pairs: 12 };
    case 'different-counts':
      // Two pages added at the end and the second page removed: 12 against 13.
      return { earlier: draft, later: [draft[0], ...draft.slice(2), notesPage(13, 913), notesPage(14, 914)], differ: 3, pairs: 14 };
    case 'identical':
      return { earlier: draft, later: [...draft], differ: 0, pairs: 12 };
    case 'large-page': {
      const { earlier, later } = largePageTexts();
      return { earlier: [draft[0], earlier, draft[1]], later: [draft[0], later, draft[1]], differ: 1, pairs: 3 };
    }
    case 'scanned':
      return { earlier: draft.slice(0, 3), later: [{ scanned: true }, { scanned: true }, { scanned: true }], differ: 0, pairs: 0 };
  }
}

export async function compareFixture(name: CompareFixtureName): Promise<CompareFixture> {
  const pages = fixturePages(name);
  return {
    earlier: await textPdf(pages.earlier),
    later: await textPdf(pages.later),
    earlierPages: pages.earlier.length,
    laterPages: pages.later.length,
    differ: pages.differ,
    pairs: pages.pairs,
  };
}

// ---- a page-text reader on pdf.js in Node -----------------------------------------------------------------

type PdfjsDoc = { getPage(n: number): Promise<{ getTextContent(): Promise<{ items: unknown[]; styles: Record<string, FontStyleLike> }> }>; destroy(): Promise<void> };

/**
 * pageTextContent as pdfRenderer.ts gives it (the items with a string, each font's style), read with
 * pdf.js in Node. Each file is opened once; `close()` lets every document go.
 */
export function pdfjsTextSource() {
  const docs = new Map<Uint8Array, Promise<PdfjsDoc>>();
  const open = (file: Uint8Array) => {
    let doc = docs.get(file);
    if (!doc) {
      doc = import('pdfjs-dist/legacy/build/pdf.mjs').then(
        ({ getDocument }) => getDocument({ data: file.slice(), useSystemFonts: true, isEvalSupported: false, verbosity: 0 }).promise as unknown as Promise<PdfjsDoc>,
      );
      docs.set(file, doc);
    }
    return doc;
  };
  return {
    async pageTextContent(file: Uint8Array, pageIndex: number, options: { signal?: AbortSignal } = {}): Promise<{ items: TextItemLike[]; styles: Record<string, FontStyleLike> }> {
      if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const page = await (await open(file)).getPage(pageIndex + 1);
      const content = await page.getTextContent();
      const items: TextItemLike[] = [];
      for (const item of content.items as Partial<TextItemLike>[]) {
        if (typeof item.str !== 'string') continue;
        items.push({ str: item.str, transform: item.transform ?? [1, 0, 0, 1, 0, 0], width: item.width ?? 0, height: item.height ?? 0, fontName: item.fontName ?? '', hasEOL: item.hasEOL === true });
      }
      return { items, styles: content.styles };
    },
    async close(): Promise<void> {
      const all = [...docs.values()];
      docs.clear();
      await Promise.all(all.map(async (doc) => (await doc).destroy()));
    },
  };
}

/**
 * A reader that gives fixed page texts, one item per line (for words no standard font can draw, such as
 * Devanagari). `texts` maps each file's bytes to its pages.
 */
export function fixedTextSource(texts: Map<Uint8Array, readonly string[]>) {
  return {
    async pageTextContent(file: Uint8Array, pageIndex: number, options: { signal?: AbortSignal } = {}): Promise<{ items: TextItemLike[]; styles: Record<string, FontStyleLike> }> {
      if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const pages = texts.get(file);
      if (!pages) throw new Error('unknown file');
      const lines = (pages[pageIndex] ?? '').split('\n');
      const items: TextItemLike[] = lines.map((line, i) => ({ str: line, transform: [10, 0, 0, 10, 36, 800 - i * 14], width: line.length * 5, height: 10, fontName: 'f1', hasEOL: true }));
      return { items, styles: { f1: { fontFamily: 'sans-serif', ascent: 0.9, descent: -0.2, vertical: false } } };
    },
  };
}
