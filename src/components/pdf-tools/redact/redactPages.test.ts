// One rebuilt page (plan A9): a box that cuts through a glyph is grown on the drawing until the glyph is
// covered, before it is burned; the picture handed to the build holds exactly width x height samples; the
// text layer keeps the words that touch no box.
import * as zlib from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { makeInkPdfs, openPdfjs, PAN, renderPdfjsPage } from '@/lib/pdf-tools/testRedactPdf';
import { findInFile } from './redactFindRun';
import { drawRebuiltPage, type DrawChoices } from './redactPages';
import type { RedactArea } from './reviewState';
import { nodeEnv, type NodeEnv } from './testRedactRun';

vi.setConfig({ testTimeout: 180_000 });

let env: NodeEnv;
beforeAll(async () => {
  env = await nodeEnv();
}, 120_000);
afterAll(async () => {
  await env?.close();
});

const choices: DrawChoices = { mode: 'remove', replacement: { style: 'token', token: '[REDACTED]' }, output: 'searchable', dpi: 200 };

describe('drawRebuiltPage', () => {
  it('grows a box that cuts through the last glyph of its value until no ink of the value is left outside', async () => {
    const { visible, hidden } = await makeInkPdfs([{ id: 'cut', content: `BT /F1 12 Tf 72 600 Td (PAN of the assessee: ) Tj {V} (${PAN}) Tj {N} (    dated 01-04-2025) Tj ET` }]);
    const found = await findInFile(visible, { reader: env.renderer, signal: new AbortController().signal, live: () => true, onProgress: () => undefined, terms: [], measure: env.measure });
    const place = found.proposals.find((p) => p.key === PAN)!;
    // The box as a wrong font estimate could leave it: 5 pt short of the value's last glyph.
    const [rect] = place.rects;
    const area: RedactArea = { page: 0, rects: [{ ...rect, x1: rect.x1 - 5 }], kind: 'pan', key: PAN, hidden: false, angle: 0, ranges: place.ranges };
    const drawn = await drawRebuiltPage(visible, { page: 0, model: found.models[0], areas: [area] }, choices, { renderer: env.renderer, codecs: env.codecs(), painter: env.painter(), measure: env.measure });
    const { picture, words, boxes, reason } = drawn.rebuilt;
    expect(reason).toBe('boxes');
    expect(picture.encoding).toBe('flate-gray');
    const samples = zlib.inflateSync(picture.bytes);
    expect(samples.length).toBe(picture.widthPx * picture.heightPx);
    // The value's own ink, at the picture's resolution: where the visible and the invisible drawings differ.
    const [a, b] = [await openPdfjs(visible), await openPdfjs(hidden)];
    try {
      const [A, B] = [await renderPdfjsPage(a, 0, 200), await renderPdfjsPage(b, 0, 200)];
      expect([A.width, A.height]).toEqual([picture.widthPx, picture.heightPx]);
      const all = { left: 0, top: 0, right: A.width, bottom: A.height };
      const [VA, VB] = [A.pixels(all), B.pixels(all)];
      let ink = 0;
      let shown = 0;
      for (let p = 0; p < A.width * A.height; p++) {
        const i = p * 4;
        if (Math.max(Math.abs(VA[i] - VB[i]), Math.abs(VA[i + 1] - VB[i + 1]), Math.abs(VA[i + 2] - VB[i + 2])) <= 24) continue;
        ink++;
        if (samples[p] > 60) shown++;
      }
      expect(ink).toBeGreaterThan(200);
      expect(shown).toBe(0);
    } finally {
      await Promise.all([a.destroy(), b.destroy()]);
    }
    // The burned box reached past the short rect; the words beside it that touch no box stay in the text layer.
    expect(boxes[0].x1).toBeGreaterThan(rect.x1 - 5);
    expect(words.map((w) => w.text)).toContain('PAN');
    expect(words.map((w) => w.text).join(' ')).not.toContain(PAN);
  });

  it('wave 5, ruling S: the boxes are grown with a chance of a turn for the window between them (a slanted watermark held it 2.6 s)', async () => {
    const lines = [0, 1, 2, 3].map((i) => `BT /F1 12 Tf 72 ${700 - i * 40} Td (PAN ${i + 1}: ) Tj {V} (${PAN}) Tj {N} ET`).join(' ');
    const { visible } = await makeInkPdfs([{ id: 'four', content: lines }]);
    const found = await findInFile(visible, { reader: env.renderer, signal: new AbortController().signal, live: () => true, onProgress: () => undefined, terms: [], measure: env.measure });
    const places = found.proposals.filter((p) => p.key === PAN);
    expect(places.length).toBe(4);
    const asked = async (n: number) => {
      let count = 0;
      const areas: RedactArea[] = places.slice(0, n).map((p) => ({ page: 0, rects: p.rects, kind: 'pan', key: PAN, hidden: false, angle: 0, ranges: p.ranges }));
      await drawRebuiltPage(visible, { page: 0, model: found.models[0], areas }, choices, {
        renderer: env.renderer,
        codecs: env.codecs(),
        painter: env.painter(),
        measure: env.measure,
        pace: () => {
          count++;
          return undefined;
        },
      });
      return count;
    };
    const [one, four] = [await asked(1), await asked(4)];
    expect(four - one).toBeGreaterThanOrEqual(3);
  });

  it('wave 5, ruling S: a value at a slant takes its whole text item at once (no growth along an axis it does not run on), and none of its ink is left', async () => {
    const { visible, hidden } = await makeInkPdfs([{ id: 'slant', content: `BT /F1 12 Tf 72 700 Td (Statement of account) Tj ET BT /F1 14 Tf 0.866 0.5 -0.5 0.866 160 380 Tm {V} (${PAN}) Tj {N} ET` }]);
    const found = await findInFile(visible, { reader: env.renderer, signal: new AbortController().signal, live: () => true, onProgress: () => undefined, terms: [], measure: env.measure });
    const place = found.proposals.find((p) => p.key === PAN)!;
    expect(Math.round(place.angle)).toBe(30);
    const area: RedactArea = { page: 0, rects: place.rects, kind: 'pan', key: PAN, hidden: false, angle: place.angle, ranges: place.ranges };
    const drawn = await drawRebuiltPage(visible, { page: 0, model: found.models[0], areas: [area] }, choices, { renderer: env.renderer, codecs: env.codecs(), painter: env.painter(), measure: env.measure });
    expect(drawn.boxesWidened).toBe(1);
    const samples = zlib.inflateSync(drawn.rebuilt.picture.bytes);
    const [a, b] = [await openPdfjs(visible), await openPdfjs(hidden)];
    try {
      const [A, B] = [await renderPdfjsPage(a, 0, 200), await renderPdfjsPage(b, 0, 200)];
      const all = { left: 0, top: 0, right: A.width, bottom: A.height };
      const [VA, VB] = [A.pixels(all), B.pixels(all)];
      let ink = 0;
      let shown = 0;
      for (let p = 0; p < A.width * A.height; p++) {
        const i = p * 4;
        if (Math.max(Math.abs(VA[i] - VB[i]), Math.abs(VA[i + 1] - VB[i + 1]), Math.abs(VA[i + 2] - VB[i + 2])) <= 24) continue;
        ink++;
        if (samples[p] > 60) shown++;
      }
      expect(ink).toBeGreaterThan(200);
      expect(shown).toBe(0);
    } finally {
      await Promise.all([a.destroy(), b.destroy()]);
    }
  });

  it('a flattened page has no box and keeps its words; a page with nothing to place is refused', async () => {
    const { visible } = await makeInkPdfs([{ id: 'flat', content: 'BT /F1 12 Tf 72 600 Td {V} (Words to keep) Tj {N} ET' }]);
    const found = await findInFile(visible, { reader: env.renderer, signal: new AbortController().signal, live: () => true, onProgress: () => undefined, terms: [], measure: env.measure });
    const flat = await drawRebuiltPage(visible, { page: 0, model: found.models[0], areas: [], flatten: true }, choices, { renderer: env.renderer, codecs: env.codecs(), painter: env.painter(), measure: env.measure });
    expect(flat.rebuilt.reason).toBe('flattened');
    expect(flat.rebuilt.boxes).toEqual([]);
    expect(flat.rebuilt.words.map((w) => w.text)).toEqual(['Words', 'to', 'keep']);
    await expect(drawRebuiltPage(visible, { page: 0, model: found.models[0], areas: [] }, choices, { renderer: env.renderer, codecs: env.codecs(), painter: env.painter(), measure: env.measure })).rejects.toThrow(/could not be drawn/);
  });
});
