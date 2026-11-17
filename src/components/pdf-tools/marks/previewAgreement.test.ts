// The previews draw one page copied out of the file, marked by the same library call as the run. These
// tests prove the preview shows each mark where the result has it (within 1 pt, pdf.js reading both),
// on the page kinds marks go wrong on: portrait, landscape, /Rotate 90, a CropBox, an unclosed `q`, and
// a /UserUnit 2 page.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { extractPages } from '@/lib/pdf-tools/organise';
import { addPageNumbers, defaultPageNumberOptions, type PageNumberRunOptions } from '@/lib/pdf-tools/pageNumbers';
import { changedPixels, readerView, solidPng } from '@/lib/pdf-tools/testMarksPdf';
import { addWatermark, WATERMARK_DEFAULTS, type WatermarkOptions } from '@/lib/pdf-tools/watermark';
import { numberPreviewFor } from './pageNumberText';
import { makeMixedPagesPdf, MIXED_PAGES } from './testPages';
import { watermarkPreviewOptions } from './watermarkForm';

vi.setConfig({ testTimeout: 240_000 });

let source: Uint8Array;
beforeAll(async () => {
  source = await makeMixedPagesPdf();
  await import('pdfjs-dist/legacy/build/pdf.mjs');
}, 60_000);

const tokens = { date: '14-11-2026', client: 'ABC Ltd' };

async function expectSamePlace(result: Uint8Array, page: number, preview: Uint8Array, text: string) {
  const a = await readerView(result, page, text);
  const b = await readerView(preview, 1, text);
  expect(Math.abs(a.x - b.x), `${text} across, page ${page} (${MIXED_PAGES[page - 1]})`).toBeLessThanOrEqual(1);
  expect(Math.abs(a.y - b.y), `${text} down, page ${page} (${MIXED_PAGES[page - 1]})`).toBeLessThanOrEqual(1);
  expect(Math.abs(a.angle - b.angle)).toBeLessThan(0.01);
  expect(b.w).toBeCloseTo(a.w, 3);
  expect(b.h).toBeCloseTo(a.h, 3);
}

describe('Watermark preview and result agree', () => {
  it('puts the watermark (front and behind) and the stamp where the run puts them, on every page kind', async () => {
    for (const layer of ['front', 'behind'] as const) {
      const options: WatermarkOptions = {
        watermark: { ...WATERMARK_DEFAULTS.watermark, text: 'DRAFT {date}', placement: { anchor: 'center', padPt: 20 }, layer },
        stamp: { ...WATERMARK_DEFAULTS.stamp, text: 'PAID', placement: { point: { u: 0.3, v: 0.25 } } },
        pages: { from: 1, to: MIXED_PAGES.length },
        tokens,
      };
      const result = await addWatermark(source, options);
      for (let page = 1; page <= MIXED_PAGES.length; page++) {
        const preview = await addWatermark(await extractPages(source, [page - 1]), watermarkPreviewOptions(options, null));
        await expectSamePlace(result, page, preview, 'DRAFT 14-11-2026');
        await expectSamePlace(result, page, preview, 'PAID');
      }
    }
  });

  it('draws the logo in the same pixels (72 dpi) on every page kind', async () => {
    const logo = { image: solidPng(60, 30, [0, 0, 255]), format: 'png' as const, widthShare: 0.18, opacity: 1, placement: { anchor: 'top-left' as const, padPt: 20 } };
    const options: WatermarkOptions = { logo, pages: { from: 1, to: MIXED_PAGES.length }, tokens };
    const result = await addWatermark(source, options);
    for (let page = 1; page <= MIXED_PAGES.length; page++) {
      const copy = await extractPages(source, [page - 1]);
      const preview = await addWatermark(copy, watermarkPreviewOptions(options, null));
      const inResult = await changedPixels(source, result, page);
      const inPreview = await changedPixels(copy, preview, 1);
      expect(inPreview.bbox, MIXED_PAGES[page - 1]).toEqual(inResult.bbox);
    }
  });
});

describe('Page numbers preview and result agree', () => {
  it('puts the number, the header and the footer where the run puts them, on every page kind, styles and circles included', async () => {
    const tokensPn = { file: 'Mixed.pdf', client: 'ABC Ltd', fy: '2025-26', today: new Date(2026, 10, 14) };
    const cases: PageNumberRunOptions[] = [
      { ...defaultPageNumberOptions(MIXED_PAGES.length), format: 'page-n-of-total', style: 'roman-upper', texts: { 'top-left': 'WP {page}', 'top-right': '{name}', 'bottom-left': '{client} {fy}' }, tokens: tokensPn },
      { ...defaultPageNumberOptions(MIXED_PAGES.length), position: 'top-right', format: 'n', style: 'circled', startNumber: 7, fontSize: 12, bold: true, italic: true, font: 'times', texts: { 'bottom-center': '{date}' }, dateFormat: 'long', tokens: tokensPn },
      { ...defaultPageNumberOptions(MIXED_PAGES.length), position: 'bottom-right', format: 'pg-n', style: 'alpha', marginPt: 40 },
    ];
    const expected: string[][] = [
      ['WP I', 'Mixed', 'ABC Ltd 2025-26'],
      ['14 November 2026'],
      [],
    ];
    for (const [c, options] of cases.entries()) {
      const result = await addPageNumbers(source, options);
      for (let page = 1; page <= MIXED_PAGES.length; page++) {
        const plan = numberPreviewFor(options, page)!;
        const preview = await addPageNumbers(await extractPages(source, [page - 1]), plan);
        const n = options.startNumber + page - 1;
        const label = c === 0 ? `Page ${['I', 'II', 'III', 'IV', 'V', 'VI'][page - 1]} of VI` : c === 1 ? String(n) : `Pg-${'abcdef'[page - 1]}`;
        await expectSamePlace(result, page, preview, label);
        for (const text of expected[c]) {
          await expectSamePlace(result, page, preview, text === 'WP I' ? `WP ${['I', 'II', 'III', 'IV', 'V', 'VI'][page - 1]}` : text);
        }
        if (c === 1) {
          // The ring is drawn too: the same pixels change on the preview's page as on the result's.
          const inResult = await changedPixels(source, result, page);
          const inPreview = await changedPixels(await extractPages(source, [page - 1]), preview, 1);
          expect(inPreview.bbox, MIXED_PAGES[page - 1]).toEqual(inResult.bbox);
        }
      }
    }
  });
});
