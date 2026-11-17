import * as zlib from 'node:zlib';
import { PDFDocument, PDFName, PDFString, StandardFonts } from 'pdf-lib';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { BOX_PAD_PT, buildPageText, enlargedViewCopy, growPastInk, isUniform, pageHasText, pageReadings, rangeRects, textAxis, type MeasureChar, type PageTextModel, type TextItemLike } from './pageText';
import {
  AUTO_BOX_MAX_SHARE,
  dropPageSizedBoxes,
  everyOccurrence,
  findOnPage,
  groupByValue,
  heldSummary,
  heldValues,
  holdPlaces,
  materializeHeld,
  MAX_PLACES,
  PAGE_SIZED_NOTE,
  proposalsForPage,
  sameTextProposals,
  tokenUnderBox,
  tooManyPlaces,
  typedAcrossTurn,
  type AnnotationText,
  type FindOptions,
  type HeldHit,
  type Proposal,
} from './redactFind';
import { neverTickedByDefault, type RedactGroup, type RedactKind } from './redactPatterns';
import { statementLines, writtenForms } from './testRedactCorpus';
import {
  AADHAAR,
  AADHAAR_SPACED,
  GSTIN,
  HIDDEN_PAN,
  inkOutside,
  makeHidingPdf,
  makeInkPdfs,
  makePositionsPdf,
  makeRawPagesPdf,
  OUTSIDE_PAN,
  openPdfjs,
  PAN,
  PAN2,
  pdfjsAnnotationTexts,
  pdfjsPageText,
  renderPdfjsPage,
  standardMeasure,
  tag,
  WHITE_PAN,
  type InkCase,
} from './testRedactPdf';
import { PdfToolsError } from './types';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
let measure: MeasureChar;
let options: FindOptions;
const ALL: ReadonlySet<RedactGroup> = new Set<RedactGroup>(['identity', 'contact', 'bank-tax', 'network', 'names']);
beforeAll(async () => {
  await import('pdfjs-dist/legacy/build/pdf.mjs');
  measure = await standardMeasure();
  options = { groups: ALL, terms: [], measure };
}, 60_000);

interface Pages {
  models: PageTextModel[];
  annotations: AnnotationText[][];
}

/** What the find reads: text from the enlarged-view copy (or the file itself), view and annotations from the file. */
async function read(bytes: Uint8Array, enlarged = true): Promise<Pages> {
  const source = await openPdfjs(bytes);
  const reader = enlarged ? await openPdfjs(await enlargedViewCopy(bytes)) : source;
  const models: PageTextModel[] = [];
  const annotations: AnnotationText[][] = [];
  for (let i = 0; i < source.numPages; i++) {
    const { view } = await pdfjsPageText(source, i);
    const t = await pdfjsPageText(reader, i);
    models.push(buildPageText(i, t.items, t.styles, view, t.rotate));
    annotations.push(await pdfjsAnnotationTexts(source, i));
  }
  if (reader !== source) await reader.destroy();
  await source.destroy();
  return { models, annotations };
}

const keysOf = (proposals: readonly Proposal[]) => proposals.map((p) => p.key);

describe('proposalsForPage on the positions file', () => {
  let file: Awaited<ReturnType<typeof makePositionsPdf>>;
  let pages: Pages;
  let plain: Pages;
  beforeAll(async () => {
    file = await makePositionsPdf();
    pages = await read(file.bytes);
    plain = await read(file.bytes, false);
  });

  it('finds the values of every case, split, spaced, grouped, broken or in a form XObject', () => {
    const found = proposalsForPage(pages.models[0], [], options);
    const pans = found.filter((p) => p.kind === 'pan' && p.key === PAN);
    // C1 Helvetica, C2 Times, C3 Courier, C4 split Tj, C5 kerning array, C6 Tc/Tw/Tz.
    expect(pans).toHaveLength(6);
    expect(pans.every((p) => p.confidence === 'sure' && p.source === 'text' && p.rects.length === 1)).toBe(true);
    const aadhaar = found.filter((p) => p.kind === 'aadhaar' && p.key === AADHAAR);
    expect(aadhaar.map((p) => p.rects.length).sort()).toEqual([1, 2]);
    expect(found.find((p) => p.kind === 'gstin')).toMatchObject({ key: GSTIN, confidence: 'sure' });
    expect(found.find((p) => p.key === PAN2)).toMatchObject({ kind: 'pan', angle: 90 });
    expect(new Set(found.map((p) => p.kind))).toEqual(new Set(['pan', 'aadhaar', 'gstin', 'email', 'mobile', 'bank-account', 'ifsc']));
    for (const p of found) {
      expect(p.page).toBe(0);
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.id).not.toContain(p.key);
      expect(pages.models[0].text.slice(p.ranges[0][0], p.ranges[0][1])).toBe(p.value);
    }
    expect(new Set(found.map((p) => p.id)).size).toBe(found.length);
  });

  it('finds the same values with the same boxes on pages turned 90, 180 and 270 degrees', () => {
    const first = proposalsForPage(pages.models[0], [], options).map((p) => [p.kind, p.key, p.rects]);
    for (const page of [1, 2, 3]) expect(proposalsForPage(pages.models[page], [], options).map((p) => [p.kind, p.key, p.rects])).toEqual(first);
  });

  it('finds text outside the crop box only through the enlarged-view copy, and says when none of it can be seen', () => {
    const plainKeys = keysOf(proposalsForPage(plain.models[4], [], options));
    expect(plainKeys).not.toContain(OUTSIDE_PAN);
    // The GSTIN line crosses the crop box's right edge (x = 400): pdf.js cut it short without the copy.
    expect(plainKeys).not.toContain(GSTIN);
    const found = proposalsForPage(pages.models[4], [], options);
    expect(found.find((p) => p.key === OUTSIDE_PAN)).toMatchObject({ kind: 'pan', outsideView: true });
    expect(found.find((p) => p.key === GSTIN)).toMatchObject({ outsideView: false });
    // Lines C1 and C2 (baselines 760 and 730) lie wholly above the crop box (top 700); C3 to C6 can be seen.
    const pans = found.filter((p) => p.key === PAN);
    expect(pans.map((p) => p.outsideView)).toEqual([true, true, false, false, false, false]);
    expect(pans.map((p) => p.rects[0].y0 + BOX_PAD_PT > 700)).toEqual([true, true, false, false, false, false]);
  });

  it('finds hidden text (invisible and white) and boxes it like any drawn text (fix round 1, F9)', async () => {
    const found = proposalsForPage(pages.models[0], [], options);
    const doc = await openPdfjs(file.bytes);
    const drawing = await renderPdfjsPage(doc, 0, 150);
    const shows = (p: Proposal) => !isUniform(drawing.pixels(drawing.pixelRect(p.rects[0])));
    for (const key of [HIDDEN_PAN, WHITE_PAN]) {
      const p = found.find((x) => x.key === key)!;
      // Their area shows nothing, but that does not prove the text is not painted (faint grey passes
      // the same test): they get a box.
      expect(p).toMatchObject({ kind: 'pan', confidence: 'sure', hidden: false });
      expect(shows(p)).toBe(false);
    }
    expect(shows(found.find((x) => x.key === PAN)!)).toBe(true);
    // Text wholly outside the visible page is not painted: no box.
    expect(proposalsForPage(pages.models[4], [], options).find((x) => x.key === OUTSIDE_PAN)).toMatchObject({ outsideView: true, hidden: true });
    await doc.destroy();
  });

  it('adds every other place of a value found once, on every page', () => {
    const onPage1 = proposalsForPage(pages.models[0], [], options).filter((p) => p.key === WHITE_PAN);
    expect(onPage1).toHaveLength(1);
    const all = everyOccurrence(pages.models, onPage1, measure);
    const groups = groupByValue(all);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ key: WHITE_PAN, kind: 'pan' });
    expect(groups[0].places.map((p) => p.page)).toEqual([0, 1, 2, 3, 4]);
    expect(groups[0].places.every((p) => p.confidence === 'sure' && p.rects.length === 1)).toBe(true);
    expect(new Set(all.map((p) => p.id)).size).toBe(all.length);
  });

  it('counts a PAN inside a GSTIN as another place of the PAN', () => {
    const page = pages.models[0];
    const upward = proposalsForPage(page, [], options).filter((p) => p.key === PAN2);
    expect(upward.map((p) => p.angle)).toEqual([90]);
    const all = everyOccurrence([page], upward, measure).filter((p) => p.key === PAN2);
    expect(all).toHaveLength(2);
    const inside = all.find((p) => p.angle === 0)!;
    expect(inside).toMatchObject({ kind: 'pan', confidence: 'sure', value: PAN2 });
    expect(inside.ranges).toEqual([[page.text.indexOf(GSTIN) + 2, page.text.indexOf(GSTIN) + 12]]);
  });

  it('finds the other places of a value written with a kerning gap or across a line break', () => {
    const page = pages.models[0];
    const pan = proposalsForPage(page, [], options).filter((p) => p.key === PAN).slice(0, 1);
    const all = everyOccurrence([page], pan, measure).filter((p) => p.key === PAN);
    expect(all).toHaveLength(6);
    expect(all.some((p) => p.value === 'BN ZPM2501F')).toBe(true);
    const aadhaar = proposalsForPage(page, [], options).filter((p) => p.key === AADHAAR).slice(0, 1);
    expect(everyOccurrence([page], aadhaar, measure).filter((p) => p.key === AADHAAR)).toHaveLength(2);
  });

  it('finds typed terms, ticked, with their reason as the label', () => {
    const found = proposalsForPage(pages.models[0], [], { ...options, groups: new Set(), terms: [{ text: 'assessee', reason: 'Client word' }, { text: 'KYC', reason: '' }] });
    expect(found.filter((p) => p.key === 'assessee')).toHaveLength(3);
    expect(found.every((p) => p.kind === 'typed' && p.confidence === 'sure')).toBe(true);
    expect(found.find((p) => p.key === 'assessee')!.label).toBe('Client word');
    expect(found.find((p) => p.key === 'kyc')!.label).toBe('Typed');
  });

  it('offers the text under a drawn box only when it is one value-like word (fix round 1, F5)', () => {
    const page = pages.models[0];
    const box = (text: string, from = 0) => {
      const at = page.text.indexOf(text, from);
      return rangeRects(page, at, at + text.length, measure, 0)[0];
    };
    // a sentence: several words, nothing offered
    expect(tokenUnderBox(page, box('PAN of the assessee:'), measure)).toBeNull();
    // one word too short, or with no digit and under 6 characters
    expect(tokenUnderBox(page, box('the'), measure)).toBeNull();
    expect(tokenUnderBox(page, box('dated'), measure)).toBeNull();
    // one value-like word, edge punctuation trimmed; the left half of it is enough
    expect(tokenUnderBox(page, box('BNZPM2501F,'), measure)).toBe('BNZPM2501F');
    const word = box('assessee:');
    expect(tokenUnderBox(page, { ...word, x1: (word.x0 + word.x1) / 2 }, measure)).toBe('assessee');
    expect(tokenUnderBox(page, box('KYC'), measure)).toBeNull();
  });

  it('proposes the other places of that word only for its box, ticked, marked with the box', () => {
    const same = sameTextProposals(pages.models, 'assessee', 'box-1', measure);
    expect(same.length).toBe(15);
    expect(same.every((p) => p.kind === 'same-text' && p.key === 'assessee' && p.label === 'Same text' && p.confidence === 'sure' && p.fromBox === 'box-1')).toBe(true);
    expect(new Set(same.map((p) => p.id)).size).toBe(15);
  });
});

describe('ink: every pixel of a found value lies inside its boxes (fix round 1, F2)', () => {
  const A_RING = String.fromCharCode(0xc5);
  const cells = Array.from(PAN)
    .map((c, i) => `${i === 0 ? 0 : 14} 0 Td (${c}) Tj`)
    .join(' ');
  const cases: (InkCase & { value: string; terms?: { text: string; reason: string }[] })[] = [
    { id: 'Helvetica', value: PAN, content: `BT /F1 10 Tf 72 600 Td (PAN of the assessee: ) Tj {V} (${PAN}) Tj {N} (, dated 01-04-2025) Tj ET` },
    // italic glyphs reach past their advance: the horizontal padding is needed
    { id: 'Times-Italic', value: PAN, content: `BT /F4 11 Tf 72 600 Td (PAN of the assessee: ) Tj {V} (${PAN}) Tj {N} (, dated 01-04-2025) Tj ET` },
    // synthetic bold (fill and stroke, 1.2 pt line, round joins) puts ink half the line beyond every
    // outline: below the descenders' -0.25 em and before the first glyph. Measured: without the vertical
    // padding 50 pixels stay outside, without the horizontal one 29, with both none.
    { id: 'synthetic bold (typed term)', value: 'Jaypee Agency', terms: [{ text: 'Jaypee Agency', reason: '' }], content: 'BT /F1 10 Tf 1 j 1.2 w 2 Tr 72 600 Td (Vendor ) Tj {V} (Jaypee Agency) Tj {N} ( listed) Tj ET' },
    // a capital with a ring above it, as a typed term
    { id: 'an accented capital (typed term)', value: `${A_RING}SA`, terms: [{ text: `${A_RING}SA`, reason: '' }], content: `BT /F1 20 Tf 72 600 Td (Vendor ) Tj {V} (${A_RING}SA) Tj {N} ( Traders) Tj ET` },
    { id: 'letter-spaced 1.2 pt, value mid-line', value: PAN, content: `BT /F1 10 Tf 1.2 Tc 72 600 Td (PAN of the assessee: ) Tj {V} (${PAN}) Tj {N} (, dated 01-04-2025) Tj ET` },
    { id: 'letter-spaced 1.5 pt, value at the end', value: PAN, content: `BT /F1 10 Tf 1.5 Tc 30 600 Td (Permanent Account Number of the assessee as recorded: ) Tj {V} (${PAN}) Tj {N} ( ok) Tj ET` },
    { id: 'letter-spaced 1.2 pt, every word gap before the value', value: PAN, content: `BT /F1 10 Tf 1.2 Tc 30 600 Td (PAN of the assessee is ) Tj {V} (${PAN}) Tj {N} (,dated01-04-2025onwards) Tj ET` },
    { id: 'letter-spaced 2 pt', value: PAN, content: `BT /F1 10 Tf 2 Tc 72 600 Td (PAN of the assessee: ) Tj {V} (${PAN}) Tj {N} (, dated) Tj ET` },
    { id: 'monospaced font reported as sans-serif, narrow value after wide text', value: 'IIJPL1111J', content: `BT /F5 14 Tf 20 600 Td (MWMWMW WMWMWM MWMWMW WMWMWM MWMWMW holder ) Tj {V} (IIJPL1111J) Tj {N} ( MWMW) Tj ET` },
    { id: 'monospaced font reported as sans-serif, ordinary words', value: 'IIJPL1111J', content: `BT /F5 12 Tf 20 600 Td (Account holder of the bank ) Tj {V} (IIJPL1111J) Tj {N} ( listed in the ledger) Tj ET` },
    { id: 'boxed cells', value: PAN, content: `BT /F1 10 Tf 72 600 Td (PAN) Tj ET BT /F1 10 Tf 120 600 Td {V} ${cells} {N} ET` },
    { id: 'superscript value', value: PAN, content: `BT /F1 10 Tf 72 600 Td (PAN) Tj {V} /F1 6 Tf 4 Ts (${PAN}) Tj {N} 0 Ts /F1 10 Tf ( dated) Tj ET` },
    // fix round 2, MF2: one line in that face, so the page cannot tell it is monospaced, with wide letters
    // on one side of the value and narrow ones on the other, so the item's width matches its fallback's
    // (the reviewer's line, and the value at its start and end)
    { id: 'monospaced, one line, value in the middle', value: 'IIJPL1111J', content: 'BT /F5 10 Tf 40 600 Td (WWWWWWWWWW ) Tj {V} (IIJPL1111J) Tj {N} ( iiiii) Tj ET' },
    { id: 'monospaced, one line, value at the start', value: 'IIJPL1111J', content: 'BT /F5 10 Tf 40 600 Td {V} (IIJPL1111J) Tj {N} ( WWWWWWWWWW iiiii) Tj ET' },
    { id: 'monospaced, one line, value at the end', value: 'IIJPL1111J', content: 'BT /F5 10 Tf 40 600 Td (WWWWWWWWWW iiiii ) Tj {V} (IIJPL1111J) Tj {N} ET' },
    { id: 'monospaced, one line, a mobile in a statement line', value: '9845012345', content: 'BT /F5 10 Tf 40 600 Td (UPI/CR/412345678901/RAVI KUMAR/MOB ) Tj {V} (9845012345) Tj {N} ( 1,250.00) Tj ET' },
  ];
  let pdfs: { visible: Uint8Array; hidden: Uint8Array };
  let pages: Pages;
  beforeAll(async () => {
    pdfs = await makeInkPdfs(cases);
    pages = await read(pdfs.visible);
  }, 60_000);

  it('finds every case and leaves no pixel of it outside the boxes', async () => {
    const visible = await openPdfjs(pdfs.visible);
    const hidden = await openPdfjs(pdfs.hidden);
    const results: string[] = [];
    for (let i = 0; i < cases.length; i++) {
      const c = cases[i];
      const model = pages.models[i];
      const compact = new RegExp(Array.from(c.value).join('[^A-Za-z0-9]{0,4}'), 'i').exec(model.text);
      const found = compact ? proposalsForPage(model, [], { ...options, terms: c.terms ?? [] }).filter((p) => p.ranges.some(([s, e]) => s < compact.index + compact[0].length && compact.index < e)) : [];
      const ink = await inkOutside(visible, hidden, i, found.flatMap((p) => p.rects));
      if (found.length === 0 || ink.ink === 0 || ink.outside > 0) results.push(`${c.id}: found ${found.length}, ink ${ink.ink}, outside ${ink.outside} (${ink.worstPt} pt)`);
    }
    await visible.destroy();
    await hidden.destroy();
    expect(results).toEqual([]);
    // 32 drawings at 300 dpi, every pixel compared: 25 s alone, over 60 s beside the other files
  }, 240_000);
});

describe('ink of justified lines: word spacing (Tw) in one Tj (fix wave, redact-e2e-review B7)', () => {
  // One Tj per line with Tw set for the line, as many PDF writers justify text: pdf.js gives one item, so
  // the value's place inside it is estimated. The invisible twin draws the same line in three Tj (word
  // spacing applies alike), the value in render mode 3. Every pixel of the value's ink must lie inside
  // the find's own boxes, before the run grows them (growPastInk).
  const QW = 'QWXPT4821K';
  const AAD = '2345 6789 0124';
  const justified = (id: string, font: 'F1' | 'F2', tw: number, pre: string, value: string, post: string): InkCase & { value: string } => {
    const head = 'BT /F1 10 Tf 50 60 Td (An ordinary heading line) Tj ET';
    const show = (s: string) => (s === '' ? '' : `(${s}) Tj`);
    return {
      id,
      value,
      size: [800, 80],
      content: `${head} BT /${font} 10 Tf ${tw} Tw 50 30 Td (${pre}${value}${post}) Tj ET`,
      hidden: `${head} BT /${font} 10 Tf ${tw} Tw 50 30 Td ${show(pre)} 3 Tr (${value}) Tj 0 Tr ${show(post)} ET`,
    };
  };
  // The review's recipe (P1): many more word spaces before the value than after it.
  const recipe = [2, 5, 10].map((tw) => justified(`P1 recipe, ${tw} Tw`, 'F1', tw, 'a b c d e f g h i j k l ', QW, ' mmmmmmmmmmmmmmmmmmmmmmmmmmmm'));
  // The review's 48 ordinary sentences (W) and 18 lines with the value at the end or the start (J).
  const sentences: [string, string][] = [
    ['This is to certify that the assessee holding PAN ', ' has filed the return of income for the year'],
    ['We refer to the notice issued to the assessee \\(PAN ', '\\) and submit as under for your kind perusal'],
    ['in the case of M/s Kestrel Orchard Traders, PAN ', ', the turnover as per books was verified by us'],
    ['It is seen from the records of the bank that an amount was paid to ', ' on the said date by cheque'],
  ];
  const ordinary = [0.8, 1.5, 2, 3, 4, 6].flatMap((tw) => (['F1', 'F2'] as const).flatMap((font) => sentences.map(([pre, post], k) => justified(`W s${k + 1} ${font} ${tw} Tw`, font, tw, pre, QW, post))));
  const lines: [string, string, string][] = [
    ['A/c of Mr. S. K. Rao at M. G. Road, Pune - 411 001 - PAN ', QW, ''],
    ['As per Form No. 16 in r/o A. Y. 2025-26 of Shri R. K. Jain, PAN ', QW, ''],
    ['', QW, ' is the PAN of M/s A. B. C. & Co. as per I. T. D. e-filing a/c on 1 4 25'],
    ['', QW, ' - Sh. R. K. Jain - A. Y. 25-26 - F. Y. 24-25 - Sec. 143 \\(1\\) \\(a\\) \\(ii\\) - Rs. 1 2 0'],
    ['Sh. R. K. Jain, S/o Sh. P. K. Jain, R/o 12, M. G. Road, Aadhaar No. ', AAD, ''],
    ['Aadhaar No. ', AAD, ' of Sh. R. K. Jain, S/o Sh. P. K. Jain, R/o 12, M. G. Road, Pune 1'],
  ];
  const ends = [2, 3, 4].flatMap((tw) => lines.map(([pre, value, post], k) => justified(`J line ${k + 1} ${tw} Tw`, 'F1', tw, pre, value, post)));
  const cases = [...recipe, ...ordinary, ...ends];
  let pdfs: { visible: Uint8Array; hidden: Uint8Array };
  let pages: Pages;
  beforeAll(async () => {
    pdfs = await makeInkPdfs(cases);
    pages = await read(pdfs.visible);
  }, 60_000);

  it('places the value inside its box on every justified line: the surplus width may go to the word spaces only', async () => {
    const visible = await openPdfjs(pdfs.visible);
    const hidden = await openPdfjs(pdfs.hidden);
    const results: string[] = [];
    for (let i = 0; i < cases.length; i++) {
      const c = cases[i];
      const model = pages.models[i];
      const at = new RegExp(Array.from(c.value).map((ch) => (ch === ' ' ? ' ?' : ch)).join('')).exec(model.text);
      const found = at ? proposalsForPage(model, [], options).filter((p) => p.ranges.some(([s, e]) => s < at.index + at[0].length && at.index < e)) : [];
      const ink = await inkOutside(visible, hidden, i, found.flatMap((p) => p.rects), 200);
      if (found.length === 0 || ink.ink === 0 || ink.outside > 0) results.push(`${c.id}: found ${found.length}, ink ${ink.ink}, outside ${ink.outside} (${ink.worstPt} pt)`);
    }
    await visible.destroy();
    await hidden.destroy();
    expect(results).toEqual([]);
  }, 240_000);
});

describe('characters drawn out of reading order (fix wave, redact-e2e-review non-blocking 2)', () => {
  // Each character its own text object, written last to first: the page shows the value, pdf.js gives
  // the characters in the order they are drawn.
  const QW = 'QWXPT4821K';
  const WIDTHS: Readonly<Record<string, number>> = { Q: 7.78, W: 9.44, X: 6.67, P: 6.67, T: 6.11, '4': 5.56, '8': 5.56, '2': 5.56, '1': 5.56, K: 6.67 };
  const backwards = (mode: (i: number) => string) => {
    let x = 60;
    const parts = Array.from(QW).map((ch, i) => {
      const part = `BT /F1 10 Tf ${mode(i)} ${x.toFixed(2)} 600 Td (${ch}) Tj ET`;
      x += WIDTHS[ch];
      return part;
    });
    return parts.reverse().join('\n');
  };
  const cases: InkCase[] = [
    { id: 'plain', content: `BT /F1 11 Tf 60 780 Td (PAN of the assessee: ${QW}) Tj ET` },
    { id: 'backwards', content: `BT /F1 11 Tf 60 780 Td (Second page: ordinary words only) Tj ET\n${backwards(() => '0 Tr')}`, hidden: `BT /F1 11 Tf 60 780 Td (Second page: ordinary words only) Tj ET\n${backwards(() => '3 Tr')}` },
  ];
  let pdfs: { visible: Uint8Array; hidden: Uint8Array };
  let pages: Pages;
  beforeAll(async () => {
    pdfs = await makeInkPdfs(cases);
    pages = await read(pdfs.visible);
  }, 60_000);

  it('finds the value in the order the characters stand on the line, and boxes all of its ink', async () => {
    const own = proposalsForPage(pages.models[1], [], options).filter((p) => p.key === QW);
    expect(own.map((p) => [p.kind, p.value, p.rects.length])).toEqual([['pan', QW, 1]]);
    // as another place of the value written plainly on page 1, too
    const all = everyOccurrence(pages.models, proposalsForPage(pages.models[0], [], options), measure).filter((p) => p.page === 1 && p.key === QW);
    expect(all).toHaveLength(1);
    const visible = await openPdfjs(pdfs.visible);
    const hidden = await openPdfjs(pdfs.hidden);
    const ink = await inkOutside(visible, hidden, 1, own.flatMap((p) => p.rects), 200);
    await visible.destroy();
    await hidden.destroy();
    expect(ink.ink).toBeGreaterThan(0);
    expect(ink.outside).toBe(0);
  });
});

describe('growPastInk on drawn pages: along the text only (fix round 2, MF1)', () => {
  // As the run will use it (Task A9): on the page drawn at 300 dpi before any box is filled, each text
  // box grown along its text's direction, the padding's rows left out, by at most 1 em.
  const DPI = 300;
  const line = (pre: string, post: string, before = '') => `${before} BT /F1 10 Tf 72 600 Td (${pre}) Tj {V} (${PAN}) Tj {N} (${post}) Tj ET`;
  // The mobile in a ledger line of the misreported monospaced face: 35 characters of 6 pt before it.
  const MOBILE_AT = { x0: 40 + 35 * 6, x1: 40 + 45 * 6 };
  const cases: (InkCase & { value: string; box?: { x0: number; y0: number; x1: number; y1: number }; maxPt?: number; limit?: boolean })[] = [
    { id: 'the value underlined, the rule running on past it', value: PAN, content: line('PAN ', ' noted', '0.5 w 107 597.5 m 168 597.5 l S') },
    { id: 'the whole line underlined', value: PAN, content: line('PAN of the assessee ', ' and the rest of a long line', '0.5 w 72 597.5 m 400 597.5 l S') },
    { id: 'table rules 1 pt from the text', value: PAN, content: line('PAN ', '        Rs. 1,234.00', '0.5 w 60 611.5 m 500 611.5 l S 60 596 m 500 596 l S 100 596 m 100 611.5 l S 180 596 m 180 611.5 l S') },
    {
      id: 'tight leading, 10 on 10',
      value: PAN,
      content: `BT /F1 10 Tf 10 TL 72 610 Td (The assessee filed the return in time and) Tj T* (PAN ) Tj {V} (${PAN}) Tj {N} ( is quoted on every page of it) Tj T* (Mumbai office ledger and day book) Tj ET`,
    },
    { id: 'struck through', value: PAN, content: line('PAN of the assessee ', ' and the rest', '0.8 w 72 603 m 400 603 l S') },
    // the value alone in a cell whose borders stand where the box's padding ends, between two others
    { id: 'a cell border on both sides', value: PAN, content: `0.5 w 60 596.5 38.5 14.5 re S 98.5 596.5 66.35 14.5 re S 164.85 596.5 80 14.5 re S BT /F1 10 Tf 62 600 Td (PAN) Tj 38 0 Td {V} (${PAN}) Tj {N} 68 0 Td (Rs. 1,234.00) Tj ET` },
    { id: 'turned 90 degrees, underlined', value: PAN, content: `0.5 w 302.5 190 m 302.5 420 l S BT /F1 10 Tf 0 1 -1 0 300 200 Tm (PAN of the assessee ) Tj {V} (${PAN}) Tj {N} ( and more) Tj ET` },
    // the reviewer's 3.9 pt case: a box that ends 3.9 pt short of the mobile's last digit (padding included)
    {
      id: 'a mobile boxed 3.9 pt short',
      value: '9845012345',
      box: { x0: MOBILE_AT.x0 - BOX_PAD_PT - 3.9, y0: 600 - 2.5 - BOX_PAD_PT, x1: MOBILE_AT.x1 + BOX_PAD_PT - 3.9, y1: 600 + 9 + BOX_PAD_PT },
      content: 'BT /F5 10 Tf 40 600 Td (UPI/CR/412345678901/RAVI KUMAR/MOB ) Tj {V} (9845012345) Tj {N} ( 1,250.00) Tj ET',
    },
    { id: 'the same box allowed to grow 1 pt only', value: '9845012345', maxPt: 1, limit: true, content: 'BT /F5 10 Tf 40 600 Td (UPI/CR/412345678901/RAVI KUMAR/MOB ) Tj {V} (9845012345) Tj {N} ( 1,250.00) Tj ET' },
  ];
  cases[cases.length - 1].box = cases[cases.length - 2].box;
  let pdfs: { visible: Uint8Array; hidden: Uint8Array };
  let pages: Pages;
  beforeAll(async () => {
    pdfs = await makeInkPdfs(cases);
    pages = await read(pdfs.visible);
  }, 60_000);

  it('covers every value without growing across the text, and reaches its limit only when told to', async () => {
    const visible = await openPdfjs(pdfs.visible);
    const hidden = await openPdfjs(pdfs.hidden);
    const results: string[] = [];
    for (let i = 0; i < cases.length; i++) {
      const c = cases[i];
      const model = pages.models[i];
      const compact = new RegExp(Array.from(c.value).join('[^A-Za-z0-9]{0,4}')).exec(model.text);
      const found = compact ? proposalsForPage(model, [], options).filter((p) => p.ranges.some(([s, e]) => s < compact.index + compact[0].length && compact.index < e)) : [];
      const boxes = c.box ? [{ rect: c.box, angle: 0 }] : found.flatMap((p) => p.rects.map((rect) => ({ rect, angle: p.angle ?? 0 })));
      const drawing = await renderPdfjsPage(visible, i, DPI);
      const rgba = drawing.context.getImageData(0, 0, drawing.width, drawing.height).data;
      const grown = boxes.map(({ rect, angle }) => {
        const along = textAxis(angle);
        const g = growPastInk(rgba, drawing.width, drawing.height, drawing.pixelRect(rect), {
          maxGrowPx: Math.round(((c.maxPt ?? 10) * DPI) / 72),
          padPx: Math.floor((BOX_PAD_PT * DPI) / 72),
          along,
        });
        const [x0, y0] = drawing.viewport.convertToPdfPoint(g.box.left, g.box.bottom) as [number, number];
        const [x1, y1] = drawing.viewport.convertToPdfPoint(g.box.right, g.box.top) as [number, number];
        const across = along === 'horizontal' ? g.grew.top + g.grew.bottom : g.grew.left + g.grew.right;
        return { rect: { x0: Math.min(x0, x1), y0: Math.min(y0, y1), x1: Math.max(x0, x1), y1: Math.max(y0, y1) }, hitLimit: g.hitLimit, across };
      });
      const ink = await inkOutside(visible, hidden, i, grown.map((g) => g.rect), DPI);
      const hitLimit = grown.some((g) => g.hitLimit);
      const across = grown.reduce((s, g) => s + g.across, 0);
      const wrong = boxes.length === 0 || ink.ink === 0 || hitLimit !== (c.limit ?? false) || across > 0 || (!c.limit && ink.outside > 0);
      if (wrong) results.push(`${c.id}: boxes ${boxes.length}, ink ${ink.ink}, outside ${ink.outside} (${ink.worstPt} pt), hitLimit ${hitLimit}, grew across ${across} px`);
    }
    await visible.destroy();
    await hidden.destroy();
    expect(results).toEqual([]);
  }, 240_000);
});

describe('proposalsForPage on the hiding-places file', () => {
  let pages: Pages;
  beforeAll(async () => {
    pages = await read(await makeHidingPdf());
  });

  it('proposes comment, FreeText, field and link texts: a box only where the text is drawn on the page (fix round 1, F6)', () => {
    const found = proposalsForPage(pages.models[0], pages.annotations[0], options);
    const from = (source: Proposal['source']) => found.filter((p) => p.source === source);
    const annotRect = (subtype: string) => {
      const r = pages.annotations[0].find((a) => a.subtype === subtype)!.rect;
      return { x0: Math.min(r[0], r[2]), y0: Math.min(r[1], r[3]), x1: Math.max(r[0], r[2]), y1: Math.max(r[1], r[3]) };
    };
    // A note shows its icon on the page: one place, boxed over the note's rectangle (fix wave B3: every
    // shown annotation other than a link or a popup is boxed; covering a note icon is harmless).
    const note = from('comment').filter((p) => p.rects[0].x0 === annotRect('Text').x0);
    expect(note.map((p) => [p.hidden, p.rects])).toEqual([[false, [annotRect('Text')]]]);
    // A FreeText draws its text: one place for the value (not one per text), boxed over its rectangle.
    const freeText = from('comment').filter((p) => p.rects[0].x0 === annotRect('FreeText').x0);
    expect(freeText.map((p) => [p.hidden, p.rects])).toEqual([[false, [annotRect('FreeText')]]]);
    expect(from('field').map((p) => [p.hidden, p.rects])).toEqual([[false, [annotRect('Widget')]]]);
    // A link's address is not drawn: no box over the link's area.
    expect(from('link').map((p) => [p.hidden, p.rects])).toEqual([[true, [annotRect('Link')]]]);
    for (const p of [...from('comment'), ...from('field'), ...from('link')]) expect(p).toMatchObject({ kind: 'pan', key: PAN, ranges: [] });
  });

  it('skips popups and gives hidden annotations no box (fix round 1, F6)', () => {
    const model = pages.models[0];
    const rect = [60, 450, 360, 560];
    const annotations: AnnotationText[] = [
      { subtype: 'Popup', rect, texts: [PAN] },
      { subtype: 'FreeText', rect, texts: [PAN, PAN], flags: 2 },
      { subtype: 'Widget', rect: [72, 300, 300, 320], texts: [PAN], flags: 32 },
      { subtype: 'FreeText', rect: [72, 200, 300, 220], texts: [`${PAN} text`, PAN], flags: 4 },
    ];
    const found = proposalsForPage(model, annotations, options).filter((p) => p.source !== 'text');
    expect(found.map((p) => [p.source, p.hidden, p.rects[0].y0])).toEqual([
      ['comment', true, 450],
      ['field', true, 300],
      ['comment', false, 200],
    ]);
  });

  it('proposes the area of a /Redact mark when pdf.js reports it, ticked as marked', () => {
    const marks = pages.annotations[0].filter((a) => a.subtype === 'Redact');
    const found = proposalsForPage(pages.models[0], pages.annotations[0], options).filter((p) => p.source === 'marked');
    expect(found).toHaveLength(marks.length);
    for (const p of found) expect(p).toMatchObject({ kind: 'marked', label: 'Marked for redaction in the file', confidence: 'sure' });
  });

  it('finds text in a hidden layer, white text and text outside the crop box; not /ActualText, which pdf.js does not read', () => {
    const text = pages.models[0].text;
    for (const place of ['P1_TEXT', 'P1_OCG_HIDDEN', 'P1_OUTSIDE_CROP', 'P1_WHITE']) expect(text).toContain(tag(place));
    expect(text).not.toContain(tag('P1_ACTUALTEXT'));
    const found = proposalsForPage(pages.models[0], [], options).filter((p) => p.source === 'text' && p.key === PAN);
    expect(found).toHaveLength(4);
    expect(found.filter((p) => p.outsideView)).toHaveLength(1);
  });

  it('adds the places of a value in the comments, fields and links of other pages', () => {
    const page1Text = proposalsForPage(pages.models[0], [], options).filter((p) => p.key === PAN).slice(0, 1);
    const all = everyOccurrence(pages.models, page1Text, measure, pages.annotations);
    expect(all.filter((p) => p.page === 1 && p.source === 'comment')).toHaveLength(2);
    expect(all.filter((p) => p.page === 1 && p.source === 'field')).toHaveLength(1);
  });
});

describe('annotations whose appearance draws the value (fix wave, redact-e2e-review B3)', () => {
  const QW = 'QWXPT4821K';
  /** One page per annotation; `hide` draws the value in render mode 3 in the appearance (the invisible twin). */
  async function annotated(hide: boolean): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const ctx = doc.context;
    const appearance = (content: string, bbox: number[]) => ({ N: ctx.register(ctx.flateStream(content, { Type: 'XObject', Subtype: 'Form', BBox: bbox, Resources: { Font: { F1: font.ref } } } as never)) });
    const shown = (s: string) => (hide ? `3 Tr ${s} 0 Tr` : s);
    const page = (annotation: Record<string, unknown>) => {
      const p = doc.addPage([595, 842]);
      p.node.set(PDFName.of('Resources'), ctx.obj({ Font: { F1: font.ref } }));
      p.node.set(PDFName.of('Contents'), ctx.register(ctx.flateStream('BT /F1 11 Tf 60 780 Td (Ordinary words only on this page) Tj ET')));
      p.node.set(PDFName.of('Annots'), ctx.obj([ctx.register(ctx.obj({ Type: 'Annot', P: p.ref, F: 4, ...annotation } as never))]));
    };
    // A square comment drawn as a text box by another tool: its appearance writes its contents.
    page({ Subtype: 'Square', Rect: [100, 600, 300, 626], Contents: PDFString.of(`PAN ${QW}`), AP: appearance(`1 0 0 RG 1 1 198 24 re S BT /F1 9 Tf 6 9 Td ${shown(`(PAN ${QW}) Tj`)} ET`, [0, 0, 200, 26]) });
    // A line with its caption shown: the find reads /Contents, the appearance draws it.
    page({ Subtype: 'Line', Rect: [100, 600, 300, 626], L: [100, 610, 300, 610], Cap: true, Contents: PDFString.of(QW), AP: appearance(`0 0 1 RG 0 10 m 200 10 l S BT /F1 9 Tf 60 14 Td ${shown(`(${QW}) Tj`)} ET`, [0, 0, 200, 26]) });
    return doc.save({ useObjectStreams: false });
  }
  const normal = (r: readonly number[]) => ({ x0: Math.min(r[0], r[2]), y0: Math.min(r[1], r[3]), x1: Math.max(r[0], r[2]), y1: Math.max(r[1], r[3]) });

  it('boxes the rectangle of a shown /Square or /Line comment, so what its appearance draws is covered', async () => {
    const bytes = await annotated(false);
    const pages = await read(bytes);
    const visible = await openPdfjs(bytes);
    const hidden = await openPdfjs(await annotated(true));
    const results: string[] = [];
    for (const i of [0, 1]) {
      const found = proposalsForPage(pages.models[i], pages.annotations[i], options).filter((p) => p.key === QW);
      const own = pages.annotations[i].find((a) => a.subtype !== 'Popup')!;
      expect(found.map((p) => [p.source, p.hidden, p.rects])).toEqual([['comment', false, [normal(own.rect)]]]);
      // What the run burns: the boxes of the places that are not hidden.
      const ink = await inkOutside(visible, hidden, i, found.filter((p) => !p.hidden).flatMap((p) => p.rects), 200);
      if (ink.ink === 0 || ink.outside > 0) results.push(`${own.subtype}: ink ${ink.ink}, outside ${ink.outside} (${ink.worstPt} pt)`);
    }
    await visible.destroy();
    await hidden.destroy();
    expect(results).toEqual([]);
  });

  it('gives no box to a link (its address is not drawn), a popup, or a hidden or no-view annotation', () => {
    const model = buildPageText(0, [], {}, [0, 0, 612, 792], 0);
    const rect = [72, 500, 300, 520];
    const subtypes = ['Square', 'Line', 'Circle', 'Polygon', 'Ink', 'Highlight', 'Underline', 'Text', 'Caret', 'Stamp', 'FreeText', 'Widget', 'Squiggly', 'StrikeOut', 'PolyLine', 'Unknown'];
    const shown = proposalsForPage(model, subtypes.map((subtype) => ({ subtype, rect, texts: [`PAN ${QW}`], flags: 4 })), options);
    expect(shown.map((p) => p.hidden)).toEqual(subtypes.map(() => false));
    const notShown: AnnotationText[] = [
      { subtype: 'Link', rect, texts: [`https://example.in/?pan=${QW}`] },
      { subtype: 'Popup', rect, texts: [`PAN ${QW}`] },
      { subtype: 'Square', rect, texts: [`PAN ${QW}`], flags: 2 },
      { subtype: 'Line', rect, texts: [`PAN ${QW}`], flags: 32 | 4 },
    ];
    expect(proposalsForPage(model, notShown, options).map((p) => [p.source, p.hidden])).toEqual([
      ['link', true],
      ['comment', true],
      ['comment', true],
    ]);
  });
});

describe('fix wave 2, R7: the find lists a typed name written with any punctuation, or none, on every page (ruling 4)', () => {
  const style = { s: { fontFamily: 'sans-serif', ascent: 0.9, descent: -0.2, vertical: false } };
  const pageOf = (index: number, lines: string[]): PageTextModel =>
    buildPageText(index, lines.map((str, i): TextItemLike => ({ str, transform: [10, 0, 0, 10, 50, 780 - i * 12], width: str.length * 5.5, height: 10, fontName: 's', hasEOL: true })), style, [0, 0, 612, 792], 0);
  const dash = String.fromCharCode(0x2013);
  const typed = { ...{ groups: new Set<RedactGroup>(), measure: undefined as unknown as MeasureChar }, terms: [{ text: 'Ramesh Kumar Gupta', reason: '' }] };

  it('as first occurrences on a page and as other places of a value found elsewhere, each with a box', () => {
    const models = [pageOf(0, ['Signed by Ramesh Kumar Gupta, Partner']), pageOf(1, [`Contact: Ramesh${dash}Kumar${dash}Gupta end`, 'Ramesh/Kumar/Gupta; RameshKumarGupta and ShriRameshKumarGupta'])];
    const wanted = [`Ramesh${dash}Kumar${dash}Gupta`, 'Ramesh/Kumar/Gupta', 'RameshKumarGupta'];
    const first = proposalsForPage(models[1], [], { ...typed, measure });
    expect(first.map((p) => p.value)).toEqual(wanted);
    expect(first.every((p) => p.kind === 'typed' && p.rects.length > 0)).toBe(true);
    const others = everyOccurrence(models, proposalsForPage(models[0], [], { ...typed, measure }), measure).filter((p) => p.page === 1);
    expect(others.map((p) => p.value)).toEqual(wanted);
  });

  it('in the texts of comments too, and never inside a longer word', () => {
    const models = [pageOf(0, ['Signed by Ramesh Kumar Gupta, Partner']), pageOf(1, ['Mr Dasgupta and Rameshwar Kumar Guptaji signed'])];
    const seed = proposalsForPage(models[0], [], { ...typed, measure });
    const annotations = [[], [{ subtype: 'Text', rect: [10, 10, 30, 30], texts: ['Note for Ramesh: Kumar & Gupta'] }]];
    const others = everyOccurrence(models, seed, measure, annotations).filter((p) => p.page === 1);
    expect(others.map((p) => [p.source, p.value])).toEqual([['comment', 'Ramesh: Kumar & Gupta']]);
  });
});

describe('fix wave 3, Ruling C: a value broken over two lines is found on its page (redact-retest-2 finding 1)', () => {
  const NAME = 'Ramesh Kumar Gupta';
  const RT_PAN = 'QWXPT4821K';
  const typed = () => ({ groups: ALL, terms: [{ text: NAME, reason: '' }], measure });
  const at = (x: number, y: number, s: string) => `BT /F1 10 Tf ${x} ${y} Td (${s}) Tj ET`;
  const named = (found: readonly Proposal[]) => found.filter((p) => p.kind === 'typed');
  const P1 = `BT /F1 11 Tf 60 780 Td (PAN of the assessee: ) Tj (${RT_PAN}) Tj 0 -20 Td (Signed by ) Tj (${NAME}) Tj (, Partner) Tj ET`;

  it("rejoins a name hyphenated at a line end (the re-tester's N20c), boxing each line's piece", async () => {
    const bytes = await makeRawPagesPdf([`${P1} BT /F1 11 Tf 60 700 Td (Confirmation was received from ) Tj (Ramesh Ku-) Tj 0 -15 Td (mar Gupta) Tj ( regarding the unsecured loan.) Tj ET`]);
    const { models } = await read(bytes);
    const found = named(proposalsForPage(models[0], [], typed()));
    expect(found.map((p) => p.value)).toEqual([NAME, NAME]);
    const broken = found[1];
    expect(broken.rects).toHaveLength(2);
    const [first, second] = [...broken.rects].sort((a, b) => b.y0 - a.y0);
    expect(first.y0).toBeLessThan(700);
    expect(first.y1).toBeGreaterThan(700);
    expect(second.y0).toBeLessThan(685);
    expect(second.y1).toBeGreaterThan(685);
    // The second line's piece is "mar Gupta" only, not the rest of the sentence.
    expect(second.x1).toBeLessThan(60 + 11 * 0.6 * 9 + 2);
  });

  it("finds a name wrapped inside a table cell of a file that writes across the row (the re-tester's N20), one box per piece, nothing of the next cell", async () => {
    const bytes = await makeRawPagesPdf([
      [
        '0.5 w 50 772 m 545 772 l S 50 752 m 545 752 l S 50 700 m 545 700 l S',
        at(56, 758, 'Name of employee'), at(190, 758, 'PAN'), at(330, 758, 'Gross salary'),
        at(56, 738, 'Ramesh Kumar'), at(190, 738, RT_PAN), at(330, 738, '12,40,000.00'),
        at(56, 724, 'Gupta'),
        at(56, 706, 'Devi Rao'), at(190, 706, 'BNZPM2501F'), at(330, 706, '9,10,000.00'),
      ].join('\n'),
    ]);
    const { models } = await read(bytes);
    const found = proposalsForPage(models[0], [], typed());
    const name = named(found);
    expect(name).toHaveLength(1);
    expect(name[0].ranges).toHaveLength(2);
    expect(name[0].rects).toHaveLength(2);
    expect(name[0].rects.every((r) => r.x0 > 50 && r.x1 < 190)).toBe(true);
    expect(name[0].value).toBe(`Ramesh Kumar${String.fromCharCode(10)}Gupta`);
    // The PAN beside it is one place, not one per reading.
    expect(found.filter((p) => p.kind === 'pan' && p.key === RT_PAN)).toHaveLength(1);
  });

  // Three columns written line by line ACROSS the page (my variation: the content stream jumps from column to column).
  const columns = (col2: readonly string[], col3: readonly string[] = ['The audit was', 'done in time', 'by the firm', 'as planned']) => {
    const col1 = ['Notes on the', 'accounts of', 'the company', 'for the year'];
    const ops: string[] = [];
    for (let k = 0; k < 4; k++) for (const [x, text] of [[50, col1[k]], [220, col2[k]], [390, col3[k]]] as const) ops.push(at(x, 760 - 13 * k, text ?? ''));
    return ops.join('\n');
  };

  it('my variation: finds a name broken between two lines of the middle column of a three-column page written across the columns', async () => {
    const bytes = await makeRawPagesPdf([columns(['The loan was', 'received from Ramesh', 'Kumar Gupta on time', 'as agreed'])]);
    const { models } = await read(bytes);
    const name = named(proposalsForPage(models[0], [], typed()));
    expect(name).toHaveLength(1);
    expect(name[0].rects).toHaveLength(2);
    expect(name[0].rects.every((r) => r.x0 > 215 && r.x1 < 390)).toBe(true);
  });

  it('my variation: finds a PAN seen elsewhere broken inside one column, and a name wrapped in a cell beside right-aligned amounts', async () => {
    const bytes = await makeRawPagesPdf([P1, columns(['The loan was', 'paid for', 'the year', 'as agreed'], ['The PAN', `holder ${RT_PAN.slice(0, 5)}`, `${RT_PAN.slice(5)} paid`, 'in time'])]);
    const { models } = await read(bytes);
    const seed = proposalsForPage(models[0], [], { ...options, terms: [] }).filter((p) => p.kind === 'pan' && p.key === RT_PAN);
    expect(seed).toHaveLength(1);
    const other = everyOccurrence(models, seed, measure).filter((p) => p.page === 1);
    expect(other).toHaveLength(1);
    expect(other[0].rects).toHaveLength(2);
    expect(other[0].rects.every((r) => r.x0 > 385)).toBe(true);
    // A table whose amounts are right-aligned (their ends line up, not their starts).
    const amount = (y: number, s: string) => at(520 - s.length * 5.56, y, s);
    const table = await makeRawPagesPdf([[at(56, 758, 'Payee'), amount(758, 'Amount'), at(56, 738, 'Ramesh'), at(200, 738, 'Pune'), amount(738, '12,40,000.00'), at(56, 724, 'Kumar Gupta'), at(56, 706, 'Devi Rao'), at(200, 706, 'Agra'), amount(706, '9,10,000.00')].join('\n')]);
    const cell = named(proposalsForPage((await read(table)).models[0], [], typed()));
    expect(cell).toHaveLength(1);
    expect(cell[0].rects.every((r) => r.x1 < 200)).toBe(true);
  });

  it('joins no column to another and keeps the order of lines: reversed lines, a name split across columns, rows far apart', async () => {
    const reversed = await makeRawPagesPdf([[at(56, 738, 'Kumar Gupta'), at(190, 738, RT_PAN), at(56, 724, 'Ramesh')].join('\n')]);
    expect(named(proposalsForPage((await read(reversed)).models[0], [], typed()))).toEqual([]);
    const across = await makeRawPagesPdf([columns(['The loan was', 'received from', 'the bank on', 'time'], ['Ramesh', 'Kumar Gupta', 'was paid', 'later'])]);
    // Column 3 reads "Ramesh" then "Kumar Gupta": found there, and only there.
    const inThird = named(proposalsForPage((await read(across)).models[0], [], typed()));
    expect(inThird).toHaveLength(1);
    expect(inThird[0].rects.every((r) => r.x0 > 385)).toBe(true);
    const split = await makeRawPagesPdf([columns(['The loan was', 'received from Ramesh', 'the bank on', 'time'], ['The audit', 'was done', 'Kumar Gupta', 'later'])]);
    expect(named(proposalsForPage((await read(split)).models[0], [], typed()))).toEqual([]);
    const rows = await makeRawPagesPdf([[at(56, 758, 'Ramesh Kumar'), at(190, 758, RT_PAN), at(56, 726, 'Gupta Traders'), at(190, 726, 'BNZPM2501F')].join('\n')]);
    expect(named(proposalsForPage((await read(rows)).models[0], [], typed()))).toEqual([]);
    // A table's column of numbers read top to bottom is not one number (the re-tester's GST invoice C2:
    // HSN codes 9982 in three rows made a "possible Aadhaar").
    const hsn = await makeRawPagesPdf([[0, 1, 2].flatMap((r) => [at(56, 758 - 14 * r, `Service ${r + 1}`), at(190, 758 - 14 * r, '9982'), at(330, 758 - 14 * r, `${r + 1},000.00`)]).join('\n')]);
    expect(proposalsForPage((await read(hsn)).models[0], [], typed()).filter((p) => p.kind !== 'typed')).toEqual([]);
  });

  it("finds a name hyphenated at the foot of a page that continues on the next (H4's last column), one place per page; across a page number at the top too (wave 4, ruling G)", async () => {
    const bytes = await makeRawPagesPdf([
      `${P1} BT /F1 11 Tf 60 120 Td (Confirmation was received from Ramesh Ku-) Tj ET`,
      'BT /F1 11 Tf 60 780 Td (mar Gupta regarding the unsecured loan.) Tj ET',
      'BT /F1 11 Tf 60 120 Td (The loan was paid to Ramesh) Tj ET',
      'BT /F1 11 Tf 60 800 Td (Page 4 of 4) Tj 0 -20 Td (Kumar Gupta later.) Tj ET',
    ]);
    const { models } = await read(bytes);
    const seed = named(proposalsForPage(models[0], [], typed())).slice(0, 1);
    const seams = everyOccurrence(models, seed, measure).filter((p) => p !== seed[0]);
    // Fix wave 4, ruling G overturns the wave 3 guard "not across a running head": a page number is page
    // furniture, so pages 3 and 4 read body to body ("Ramesh" / "Kumar Gupta") as well.
    expect(seams.map((p) => [p.page, p.value])).toEqual([
      [0, NAME],
      [1, NAME],
      [2, `Ramesh${String.fromCharCode(10)}Kumar Gupta`],
      [3, `Ramesh${String.fromCharCode(10)}Kumar Gupta`],
    ]);
    expect(seams[0].rects.every((r) => r.y1 < 140)).toBe(true);
    expect(seams[1].rects.every((r) => r.y0 > 760)).toBe(true);
    expect(seams[3].rects.every((r) => r.y0 < 790)).toBe(true);
  });

  it('reads a justified page written in order once only: no line is cut at its wide spaces', async () => {
    const words = ['The', 'undertaking', 'of', 'the', 'company', 'was', 'considered', 'by', 'the', 'board', 'in', 'its', 'meeting'];
    const ops: string[] = [];
    for (let line = 0; line < 8; line++) {
      let x = 60;
      for (let w = 0; w < 4; w++) {
        const word = words[(line * 4 + w) % words.length];
        ops.push(at(x, 760 - 13 * line, word));
        x += word.length * 5.5 + 8 + ((line * 7 + w * 3) % 5) * 6;
      }
    }
    const { models } = await read(await makeRawPagesPdf([ops.join('\n')]));
    expect(pageReadings(models[0])).toHaveLength(1);
    // The same paragraph again further down (H4 repeats one): its wide spaces line up with the first's, not
    // with their neighbours', so no line is cut either.
    const again = ops.map((op) => op.replace(/ (\d+) Td/, (_, y: string) => ` ${Number(y) - 13 * 9} Td`));
    const repeated = await read(await makeRawPagesPdf([[...ops, ...again].join('\n')]));
    expect(pageReadings(repeated.models[0])).toHaveLength(1);
  });
});

describe('fix wave 4, ruling G: a name over a page turn is found when the pages carry furniture (redact-retest-3 T3-B, B1)', () => {
  const NAME = 'Ramesh Kumar Gupta';
  const typed = () => ({ groups: ALL, terms: [{ text: NAME, reason: '' }], measure });
  const line = (x: number, y: number, s: string, size = 11) => `BT /F1 ${size} Tf ${x} ${y} Td (${s}) Tj ET`;
  const BODY1 = [
    line(51, 780, 'In our opinion the loans were confirmed in writing by Ramesh Kumar Gupta and his relatives.'),
    line(51, 105, 'In our opinion and according to the explanations given to us, the unsecured'),
    line(51, 87, 'loans outstanding at the year end, on which interest at twelve per cent was'),
    line(51, 70, 'paid during the year, were taken from the proprietor, Shri Ramesh Kumar'),
  ];
  const BODY2 = [line(51, 768, 'Gupta, and from his relatives, and were confirmed by them in writing.'), line(51, 750, 'The loans are repayable on demand and are considered good.')];
  /** The places of the name each page gives across the turn (the seed is the whole name on page 1). */
  const acrossTheTurn = async (pages: string[]) => {
    const { models } = await read(await makeRawPagesPdf(pages));
    const seed = proposalsForPage(models[0], [], typed()).filter((p) => p.kind === 'typed').slice(0, 1);
    expect(seed).toHaveLength(1);
    return everyOccurrence(models, seed, measure)
      .filter((p) => p !== seed[0] && p.kind === 'typed')
      .map((p) => ({ page: p.page, top: Math.round(Math.max(...p.rects.map((r) => r.y1))) }));
  };

  it("with page numbers at the foot (the re-tester's H45): one place on each page, the foot of page 1 and the top of page 2", async () => {
    const found = await acrossTheTurn([[line(283, 28, 'Page 1', 9), ...BODY1].join('\n'), [line(283, 28, 'Page 2', 9), ...BODY2].join('\n')]);
    expect(found.map((f) => f.page)).toEqual([0, 1]);
    expect(found[0].top).toBeLessThan(100);
    expect(found[1].top).toBeGreaterThan(760);
  });

  it("with a running footer written after the body, and a letterhead line at the top of each page (H47, H48)", async () => {
    const footer = line(51, 40, 'Zeta and Orchid LLP, Chartered Accountants', 9);
    expect((await acrossTheTurn([[...BODY1, footer].join('\n'), [footer, ...BODY2].join('\n')])).map((f) => f.page)).toEqual([0, 1]);
    const letterhead = line(51, 805, 'Zeta and Orchid LLP, Chartered Accountants FRN 123456W', 9);
    expect((await acrossTheTurn([[letterhead, ...BODY1].join('\n'), [letterhead, ...BODY2].join('\n')])).map((f) => f.page)).toEqual([0, 1]);
  });

  it("a table cell that continues under the repeated heading row (H31): the cell's two pieces, nothing of the next column", async () => {
    const heading = [line(63, 771, 'Sl Name of the lender', 10), line(178, 771, 'Remarks', 10), line(493, 771, 'Amount', 10)];
    const page1 = [
      ...heading,
      line(62, 300, '6', 10), line(84, 300, 'Loan from Kestrel Orchard,', 10), line(84, 285, 'guaranteed by Shri', 10), line(84, 270, 'Ramesh Kumar Gupta', 10),
      line(62, 104, '7', 10), line(84, 104, 'Loan guaranteed by', 10), line(84, 88, 'Ramesh Kumar', 10),
      line(178, 104, 'The firm examined the books of account', 10), line(178, 88, 'and the supporting vouchers.', 10), line(493, 104, '2,46,000', 10),
    ];
    const page2 = [...heading, line(84, 721, 'Gupta personally', 10), line(84, 706, 'and secured on stock', 10), line(178, 721, 'Obtained the explanations needed.', 10), line(493, 721, '2,05,000', 10)];
    const { models } = await read(await makeRawPagesPdf([page1.join('\n'), page2.join('\n')]));
    const seed = proposalsForPage(models[0], [], typed()).filter((p) => p.kind === 'typed').slice(0, 1);
    const found = everyOccurrence(models, seed, measure).filter((p) => p !== seed[0] && p.kind === 'typed');
    expect(found.map((p) => p.page)).toEqual([0, 1]);
    expect(found.every((p) => p.rects.every((r) => r.x0 > 70 && r.x1 < 178))).toBe(true);
  });

  it('my variations: a header and "Page 2 of 2" written first on page 2; page numbers in roman numerals between dashes', async () => {
    const header = line(391, 805, 'Orchard Traders: audit working papers', 9);
    expect((await acrossTheTurn([[header, line(275, 30, 'Page 1 of 2', 9), ...BODY1].join('\n'), [header, line(275, 30, 'Page 2 of 2', 9), ...BODY2].join('\n')])).map((f) => f.page)).toEqual([0, 1]);
    expect((await acrossTheTurn([[...BODY1, line(290, 28, '- i -', 9)].join('\n'), [line(290, 28, '- ii -', 9), ...BODY2].join('\n')])).map((f) => f.page)).toEqual([0, 1]);
  });

  it('my variation: a line taken for furniture is also tried kept in: an account number whose last digits stand alone at the top of page 2, under a running header', async () => {
    const ACCOUNT = '50100123456789';
    const header = line(391, 805, 'Orchard Traders: audit working papers', 9);
    const page1 = [header, line(51, 780, `The rent was paid into account ${ACCOUNT} every month.`), line(51, 105, 'In our opinion the rent received during the year was credited to account'), line(51, 87, 'number 50100123')];
    // "456789" alone in the top fifth looks like a page number: furniture, unless kept in.
    const page2 = [header, line(51, 768, '456789'), line(51, 750, 'held with the bank at its Fort branch, as the lease requires.')];
    const { models } = await read(await makeRawPagesPdf([page1.join('\n'), page2.join('\n')]));
    const seed = proposalsForPage(models[0], [], { groups: new Set<RedactGroup>(), terms: [{ text: ACCOUNT, reason: '' }], measure }).filter((p) => p.kind === 'typed').slice(0, 1);
    expect(seed).toHaveLength(1);
    const found = everyOccurrence(models, seed, measure).filter((p) => p !== seed[0] && p.kind === 'typed');
    expect(found.map((p) => p.page)).toEqual([0, 1]);
    expect(found[1].rects.every((r) => r.y0 > 760 && r.y1 < 790)).toBe(true);
  });

  it('fix wave 5, ruling Q overturns the wave 4 guard "never across a line page 2 does not repeat": a line at the foot of page 1 only (a total, a footnote) no longer keeps the two pieces apart', async () => {
    const found = await acrossTheTurn([[...BODY1, line(51, 52, 'Total of the loans 12,00,000', 11), line(283, 28, 'Page 1', 9)].join('\n'), [line(283, 28, 'Page 2', 9), ...BODY2].join('\n')]);
    expect(found.map((f) => f.page)).toEqual([0, 1]);
  });
});

describe('fix wave 5, ruling Q: a name over a page turn is found whatever stands in the margins between its halves (redact-retest-4 T4-B, blocking 1)', () => {
  const NAME = 'Ramesh Kumar Gupta';
  const typed = () => ({ groups: ALL, terms: [{ text: NAME, reason: '' }], measure });
  const line = (x: number, y: number, s: string, size = 11) => `BT /F1 ${size} Tf ${x} ${y} Td (${s}) Tj ET`;
  const WHOLE = line(51, 780, 'In our opinion the loans were confirmed in writing by Ramesh Kumar Gupta and his relatives.');
  const FOOT = [
    line(51, 105, 'In our opinion and according to the explanations given to us, the unsecured'),
    line(51, 87, 'loans outstanding at the year end, on which interest at twelve per cent was'),
    line(51, 70, 'paid during the year, were taken from the proprietor, Shri Ramesh Kumar'),
  ];
  const TOP = [line(51, 768, 'Gupta, and from his relatives, and were confirmed by them in writing.'), line(51, 750, 'The loans are repayable on demand and are considered good.')];
  /** The pieces of the name each page gives across the turn (the seed is the whole name on page 1): the page, and where the piece stands. */
  const halves = async (pages: string[]) => {
    const { models } = await read(await makeRawPagesPdf(pages));
    const seed = proposalsForPage(models[0], [], typed()).filter((p) => p.kind === 'typed').slice(0, 1);
    expect(seed).toHaveLength(1);
    return everyOccurrence(models, seed, measure)
      .filter((p) => p !== seed[0] && p.kind === 'typed')
      .map((p) => ({ page: p.page, top: Math.round(Math.max(...p.rects.map((r) => r.y1))), left: Math.round(Math.min(...p.rects.map((r) => r.x0))), right: Math.round(Math.max(...p.rects.map((r) => r.x1))) }));
  };
  const footOfOneTopOfTwo = (found: Awaited<ReturnType<typeof halves>>) => {
    expect(found.map((f) => f.page)).toEqual([0, 1]);
    expect(found[0].top).toBeLessThan(100);
    expect(found[1].top).toBeGreaterThan(760);
    expect(found[1].top).toBeLessThan(795);
  };

  it("headers that differ on odd and even pages, written first on each page (the re-tester's N01)", async () => {
    footOfOneTopOfTwo(await halves([[line(51, 807, 'Zeta and Orchid LLP, Chartered Accountants', 10.5), WHOLE, ...FOOT].join('\n'), [line(51, 807, 'Orchard Traders, year ended 31 March 2026', 10.5), ...TOP].join('\n')]));
  });

  it('a "continued" heading on page 2 only, above a footer both pages repeat (N02)', async () => {
    const footer = line(51, 28, '\\(continued on next page\\)', 10.5);
    footOfOneTopOfTwo(await halves([[footer, WHOLE, ...FOOT].join('\n'), [line(51, 807, "Independent Auditor's Report \\(continued\\)"), footer, ...TOP].join('\n')]));
  });

  it('odd and even headers and page numbers written after the body (P41); a section name in the header that changes from page to page (P43)', async () => {
    footOfOneTopOfTwo(
      await halves([
        [WHOLE, ...FOOT, line(51, 818, 'Zeta and Orchid LLP, Chartered Accountants', 10), line(274, 30, 'Page 1 of 2', 9)].join('\n'),
        [...TOP, line(51, 818, 'Orchard Traders: report for the year ended 31 March 2026', 10), line(274, 30, 'Page 2 of 2', 9)].join('\n'),
      ]),
    );
    footOfOneTopOfTwo(
      await halves([
        [line(51, 812, 'Note 14: Borrowings', 10.5), line(289, 30, '- 1 -', 9), WHOLE, ...FOOT].join('\n'),
        [line(51, 812, 'Note 15: Related party transactions', 10.5), line(289, 30, '- 2 -', 9), ...TOP].join('\n'),
      ]),
    );
  });

  it('two footnotes at the foot of page 1 only, written after the body (P42)', async () => {
    const notes = [line(51, 52, '1 The loans are unsecured and repayable on demand; see note 14 to the accounts.', 10), line(51, 40, '2 Interest was paid after deduction of tax at source under section 194A.', 10)];
    footOfOneTopOfTwo(await halves([[line(535, 30, '1', 9), WHOLE, ...FOOT, ...notes].join('\n'), [line(535, 30, '2', 9), ...TOP].join('\n')]));
  });

  it("a statement's narration cell split by the page end, the heading row lower on page 1 than on page 2, amounts beside the cell (N09): the cell's two pieces, nothing of the amounts", async () => {
    const heading = (y: number) => [line(39, y, 'Date', 8.5), line(106.5, y, 'Narration', 8.5), line(430, y, 'Amount', 8.5), line(500, y, 'Balance', 8.5)];
    const row = (y: number, n: number) => [line(39, y, `0${n}/10/2026`, 8.5), line(106.5, y, `NEFT-ZETAN2628800${n}-KESTREL ORCHARD PVT LTD-SALARY`, 8.5), line(430, y, `1,2${n}0.00`, 8.5), line(500, y, `4,1${n},345.50`, 8.5)];
    const page1 = [
      line(520, 25, 'Page 1 of 2', 8), line(34, 762, 'ZETA ORCHARD BANK LTD', 13), line(34, 738, 'Statement for Ramesh Kumar Gupta', 8.5), ...heading(717),
      ...row(134, 1), ...row(117, 2), ...row(100, 3), ...row(83, 4),
      line(39, 66, '29/10/2026', 8.5), line(106.5, 66, 'IMPS-628812345001-TRANSFER FROM RAMESH KUMAR', 8.5), line(430, 66, '5,000.00', 8.5), line(500, 66, '4,50,000.50', 8.5),
    ];
    const page2 = [line(520, 25, 'Page 2 of 2', 8), ...heading(774), line(106.5, 758, 'GUPTA-OWN ACCOUNT', 8.5), ...row(740, 5), ...row(723, 6), ...row(706, 7)];
    const found = await halves([page1.join('\n'), page2.join('\n')]);
    expect(found.map((f) => f.page)).toEqual([0, 1]);
    expect(found[0].top).toBeLessThan(80);
    expect(found[1].top).toBeGreaterThan(750);
    expect(found[1].top).toBeLessThan(772);
    expect(found.every((f) => f.left > 100 && f.right < 425)).toBe(true);
  });

  it('typed words that stand nowhere whole, only across a page turn (P44, an fpdf statement): typedAcrossTurn gives the two pieces as sure typed places', async () => {
    const top = (n: number) => [line(31, 802, 'ZETA ORCHARD BANK LTD', 10), line(300, 802, 'Statement of account', 10), line(31, 787, 'Date', 8), line(93.5, 787, 'Narration', 8), line(430, 787, 'Amount', 8), line(277, 24.5, `Page ${n}/2`, 8)];
    const page1 = [...top(1).slice(0, 5), line(31, 78, '22/10/2026', 8.5), line(93.5, 78, 'NEFT-ZETAN26288049-KESTREL ORCHARD PVT LTD-SALARY', 8.5), line(430, 78, '1,249.00', 8.5), line(31, 64, '29/10/2026', 8.5), line(93.5, 64, 'IMPS-628812345001-P2A-TRANSFER RECEIVED FROM RAMESH KUMAR', 8.5), top(1)[5]];
    const page2 = [...top(2).slice(0, 5), line(93.5, 773, 'GUPTA OWN ACCOUNT 50100123456789', 8.5), line(31, 758, '30/10/2026', 8.5), line(93.5, 758, 'TRF TO 50100123456789 SWEEP', 8.5), line(430, 758, '500.00', 8.5), top(2)[5]];
    const { models } = await read(await makeRawPagesPdf([page1.join('\n'), page2.join('\n')]));
    expect(models.flatMap((m) => proposalsForPage(m, [], typed())).filter((p) => p.kind === 'typed')).toEqual([]);
    const found = typedAcrossTurn(models[0], models[1], typed().terms, measure);
    expect(found.map((p) => [p.page, p.kind, p.confidence, p.source])).toEqual([[0, 'typed', 'sure', 'text'], [1, 'typed', 'sure', 'text']]);
    expect(new Set(found.map((p) => p.key)).size).toBe(1);
    expect(found[0].rects.every((r) => r.y1 < 80 && r.x0 > 90)).toBe(true);
    expect(found[1].rects.every((r) => r.y0 > 760 && r.y1 < 790 && r.x0 > 85)).toBe(true);
    // Every occurrence keeps them as they are (no second copy), and a term with a whole place gets nothing here it does not get there.
    expect(everyOccurrence(models, found, measure).filter((p) => p.kind === 'typed')).toHaveLength(2);
    expect(typedAcrossTurn(models[0], models[1], [{ text: 'Kestrel Orchard', reason: '' }], measure)).toEqual([]);
  });

  it('my variations: four lines at the foot of page 1 only, written between the lines of a six-line letterhead both pages repeat (the letterhead is not counted among the four); a name of three lines in a narrow cell', async () => {
    const letterhead = [0, 1, 2, 3, 4, 5].map((k) => line(300, 820 - 9 * k, ['Zeta and Orchid LLP', 'Chartered Accountants', '14 Harbour Lane', 'Fort, Mumbai 400001', 'Firm registration 123456W', 'office at zetaorchid.example'][k], 7));
    const notes = [0, 1, 2, 3].map((k) => line(51, 58 - 12 * k, ['Note 14: Borrowings', 'See also note 9 on the security given.', 'Figures are in rupees.', 'Subject to the report of even date.'][k], 10));
    const foot = [notes[0], letterhead[0], letterhead[1], notes[1], letterhead[2], letterhead[3], notes[2], letterhead[4], letterhead[5], notes[3]];
    footOfOneTopOfTwo(await halves([[WHOLE, ...FOOT, ...foot].join('\n'), [line(51, 800, 'Note 15: Related party transactions', 10.5), ...letterhead, ...TOP].join('\n')]));
    const cells = await halves([
      [WHOLE, line(84, 104, 'Loan guaranteed by', 10), line(84, 88, 'Shri Ramesh', 10), line(84, 72, 'Kumar', 10), line(84, 40, 'See the notes overleaf.', 10)].join('\n'),
      [line(84, 810, 'Schedule of loans, continued', 10), line(84, 770, 'Gupta personally', 10), line(84, 754, 'and secured on stock', 10)].join('\n'),
    ]);
    expect(cells.map((f) => f.page)).toEqual([0, 1]);
  });

  it('my variation: a piece of the turn that a place on its own page already covers is not given again', async () => {
    // "Ramesh Kumar" / "Gupta" is whole on page 1 over a line break; with its last line left out, page 1 would read on into page 2 as well.
    const { models } = await read(
      await makeRawPagesPdf([
        [line(51, 87, 'The unsecured loans were taken from the proprietor, Shri Ramesh Kumar'), line(51, 70, 'Gupta as agreed.')].join('\n'),
        TOP.join('\n'),
      ]),
    );
    expect(proposalsForPage(models[0], [], typed()).filter((p) => p.kind === 'typed')).toHaveLength(1);
    expect(typedAcrossTurn(models[0], models[1], typed().terms, measure).map((p) => p.page)).toEqual([1]);
  });

  it('my variation: not across more lines than are tried: five lines of other text between the halves keep them apart; nor backwards (the later half first)', async () => {
    const between = [0, 1, 2, 3, 4].map((k) => line(51, 58 - 12 * k, `Schedule ${'ABCDE'[k]} lists the parties and the terms agreed with each of them.`));
    expect(await halves([[WHOLE, ...FOOT, ...between].join('\n'), TOP.join('\n')])).toEqual([]);
    expect(await halves([[WHOLE, line(51, 70, 'Gupta, and from his relatives, and were confirmed by them in writing.')].join('\n'), [line(51, 768, 'paid during the year, were taken from the proprietor, Shri Ramesh Kumar')].join('\n')])).toEqual([]);
  });
});

describe('fix wave 5, ruling R: a typed value is found where the page text holds glyphs it cannot read (redact-retest-4 T4-B, blocking 2)', () => {
  const NUL = String.fromCharCode(0);
  const LATIN = 'Ramesh Kumar Gupta';
  const HINDI = 'रमेश कुमार गुप्ता';
  /** The name as a browser writes it: the joined consonant of the last word is one glyph the file gives no character for. */
  const AS_WRITTEN = `रमेश कुमार गु${NUL}ा`;
  const styles = { f1: { fontFamily: 'sans-serif', ascent: 0.9, descent: -0.2, vertical: false } };
  const item = (str: string, x: number, y: number, size = 11.5): TextItemLike => ({ str, transform: [size, 0, 0, size, x, y], width: Array.from(str).length * size * 0.55, height: size, fontName: 'f1', hasEOL: true });
  const page = (index: number, lines: readonly string[]) => buildPageText(index, lines.map((s, k) => item(s, 62, 724 - 21 * k)), styles, [0, 0, 595, 842], 0);
  const typedPlaces = (model: PageTextModel, terms: readonly string[]) => proposalsForPage(model, [], { groups: ALL, terms: terms.map((text) => ({ text, reason: '' })), measure }).filter((p) => p.kind === 'typed');
  const written = (model: PageTextModel, p: Proposal) => p.ranges.map(([s, e]) => model.text.slice(s, e)).join('|');

  it("every place of the Hindi name on a bilingual letter (the re-tester's H14), each the whole name with its last vowel sign; the father's name is no place", () => {
    const model = page(0, [
      `नाम / Name  ${AS_WRITTEN} / ${LATIN}`,
      `िपता का नाम / Father's name  सुरेश कुमार गु${NUL}ा / Suresh Kumar Gupta`,
      `मािणत िकया जाता है िक ${NUL}ी ${AS_WRITTEN} (${LATIN}) का पैन QWXPT4821K है।`,
      AS_WRITTEN,
      `${NUL}ी ${AS_WRITTEN} का आधार 2345 6789 0124 है`,
      AS_WRITTEN,
    ]);
    const found = typedPlaces(model, [LATIN, HINDI]);
    const hindi = found.filter((p) => written(model, p).includes(NUL));
    expect(hindi.map((p) => written(model, p))).toEqual([AS_WRITTEN, AS_WRITTEN, AS_WRITTEN, AS_WRITTEN, AS_WRITTEN]);
    expect(found.filter((p) => !hindi.includes(p)).map((p) => written(model, p))).toEqual([LATIN, LATIN]);
    // A place like any other: sure, boxed, and shown and checked as the typed words (no unreadable character in its value).
    expect(hindi.every((p) => p.confidence === 'sure' && p.rects.length === 1 && p.value === HINDI)).toBe(true);
    expect(new Set(hindi.map((p) => p.key)).size).toBe(1);
  });

  it('the Hindi name typed alone on a Hindi letter (N32): both places', () => {
    const model = page(0, [
      `िप्र य ${NUL}ी ${AS_WRITTEN},`,
      `आपके खाते का िववरण संलग्न है। कृपया जांच ल${NUL} और िकसी भी ${NUL}ुिट की सूचना द${NUL}।`,
      `ित: ${AS_WRITTEN}, ${NUL}ैट 12, बानेर रोड, पुणे`,
    ]);
    expect(typedPlaces(model, [HINDI]).map((p) => written(model, p))).toEqual([AS_WRITTEN, AS_WRITTEN]);
  });

  it('my variations: an unreadable glyph that stands for a letter written before the one it follows, and one that stands for signs only', () => {
    // "Orchard Bank" in Devanagari: the r of each joined consonant is drawn above the next letter and comes after it; the vowel and nasal signs of the last word are one glyph.
    const typedWords = 'ऑर्चर्ड बैंक';
    const asWritten = `ऑच${NUL}ड${NUL} ब${NUL}क`;
    const model = page(0, [`बंधक, ज़ेटा ${asWritten}`]);
    expect(typedPlaces(model, [typedWords]).map((p) => written(model, p))).toEqual([asWritten]);
  });

  it('my variations: no place for words of another script, for a run nothing of which can be read, or when most of the value would be guessed', () => {
    const model = page(0, [AS_WRITTEN, `${NUL}${NUL}${NUL}${NUL} ${NUL}${NUL}${NUL}${NUL} ${NUL}${NUL}`, `${NUL}ी राम`, `र${NUL}${NUL}${NUL} ${NUL}${NUL}${NUL} ${NUL}${NUL}`]);
    // Latin words never match Devanagari text, whatever cannot be read in it.
    expect(typedPlaces(model, [LATIN])).toEqual([]);
    // Another Hindi name: its letters that can be read are not the page's.
    expect(typedPlaces(model, ['सुरेश शर्मा'])).toEqual([]);
    // Only the name written with one unreadable glyph; not the runs with nothing readable, nor the one where one letter of nine can be read.
    expect(typedPlaces(model, [HINDI]).map((p) => written(model, p))).toEqual([AS_WRITTEN]);
    // No letter joined at either end, as for any typed words.
    expect(typedPlaces(page(0, [`अ${AS_WRITTEN}`, `${AS_WRITTEN}न का`]), [HINDI])).toEqual([]);
    // An unreadable glyph that stands alone between words is not in a run of the value's script: it stands for no word.
    expect(typedPlaces(page(0, [`Ram ${NUL} Gupta`]), ['Ram Jay Gupta'])).toEqual([]);
    expect(typedPlaces(page(0, [`Ram J${NUL}y Gupta`]), ['Ram Jay Gupta']).map((p) => p.value)).toEqual(['Ram Jay Gupta']);
    // The cheap test before the search reads accents as the loose rule does: a name written with one is still found.
    expect(typedPlaces(page(0, ['Signed by Rámesh Kumar Gupta, partner', 'No such words on this line ₹ 5,000']), [LATIN])).toHaveLength(1);
  });

  it('every occurrence finds the other places too, shown as the typed words; a long page of unreadable glyphs does not hold the find', () => {
    const first = page(0, [AS_WRITTEN]);
    const second = page(1, ['का आधार', `${NUL}ी ${AS_WRITTEN} का पैन`]);
    const seed = typedPlaces(first, [HINDI]);
    expect(seed).toHaveLength(1);
    const more = everyOccurrence([first, second], seed, measure).filter((p) => p !== seed[0]);
    expect(more.map((p) => [p.page, written(second, p), p.value])).toEqual([[1, AS_WRITTEN, HINDI]]);
    const long = page(0, Array.from({ length: 400 }, (_, k) => Array.from({ length: 12 }, (_, j) => `गु${NUL}ा रम${NUL}श क${NUL}लार${(k + j) % 7 === 0 ? '' : NUL}`).join(' ')));
    const started = performance.now();
    expect(typedPlaces(long, [HINDI])).toEqual([]);
    expect(performance.now() - started).toBeLessThan(5_000);
  });
});

describe('fix wave 4, K5: the cells under a column heading that names a kind are possible places of it (T3-B, should fix 4)', () => {
  const EVERY = new Set<RedactGroup>(['identity', 'contact', 'bank-tax', 'network', 'names', 'employment']);
  const cell = (x: number, y: number, s: string) => `BT /F1 6 Tf ${x} ${y} Td (${s}) Tj ET`;
  const COLUMNS = [30, 60, 100, 175, 230, 290, 360, 425, 480] as const;
  const HEADINGS = ['Sl', 'Emp. code', 'Employee name', 'PAN', 'Mobile', 'Bank account no.', 'UAN', 'Date of birth', 'Net pay'];
  const ROWS = [
    ['1', 'KO-00417', 'Aarav Zetawala', 'QZXPZ1000A', '9876500001', '50100200300401', '100900000001', '01/01/1970', '41,250'],
    ['2', 'KO-00418', 'Bhavna Orchardi', 'QZXPZ1000B', '9876500002', '50100200300402', '100900000002', '02/02/1971', '38,900'],
    ['3', 'KO-00419', 'Chirag Kestrelkar', 'QZXPZ1000C', '9876500003', '50100200300403', '100900000003', '03/03/1972', '52,100'],
  ];
  const register = (rows: readonly (readonly string[])[], headings = HEADINGS) =>
    [headings.map((h, k) => cell(COLUMNS[k], 700, h)), ...rows.map((row, r) => row.map((v, k) => cell(COLUMNS[k], 684 - 14 * r, v)))].flat().join('\n');

  it("offers the names, mobiles, bank accounts, UANs and birth dates of a salary register as possible places (the re-tester's H33)", async () => {
    const { models } = await read(await makeRawPagesPdf([register(ROWS)]));
    const found = proposalsForPage(models[0], [], { groups: EVERY, terms: [], measure });
    const under = (kind: RedactKind) => found.filter((p) => p.kind === kind).map((p) => [p.value, p.confidence]);
    expect(under('name')).toEqual(ROWS.map((r) => [r[2], 'possible']));
    expect(under('mobile').map((m) => m[0])).toEqual(ROWS.map((r) => r[4]));
    expect(under('bank-account').map((m) => m[0])).toEqual(ROWS.map((r) => r[5]));
    expect(under('uan').map((m) => m[0])).toEqual(ROWS.map((r) => r[6]));
    expect(under('dob').map((m) => m[0])).toEqual(ROWS.map((r) => r[7]));
    expect(found.filter((p) => p.reason === 'under a column heading that names it').every((p) => p.confidence === 'possible')).toBe(true);
  });

  it('my variations: a heading word in a sentence is no heading; cells without the shape of the kind are not offered', async () => {
    const prose = await read(await makeRawPagesPdf([[cell(30, 700, 'Mobile'), cell(30, 684, '9876500001 was given for the visit')].join('\n')]));
    expect(proposalsForPage(prose.models[0], [], { groups: EVERY, terms: [], measure }).filter((p) => p.reason === 'under a column heading that names it')).toEqual([]);
    const lender = ['Sl', 'Name of the lender', 'Amount'];
    const rows = [['1', 'Loan from Kestrel Orchard Private Limited repayable on demand', '2,05,000'], ['2', 'Ramesh Kumar Gupta', '2,46,000']];
    const page = [lender.map((h, k) => cell([30, 60, 300][k], 700, h)), ...rows.map((row, r) => row.map((v, k) => cell([30, 60, 300][k], 684 - 14 * r, v)))].flat().join('\n');
    const found = proposalsForPage((await read(await makeRawPagesPdf([page]))).models[0], [], { groups: EVERY, terms: [], measure });
    expect(found.filter((p) => p.reason === 'under a column heading that names it').map((p) => p.value)).toEqual(['Ramesh Kumar Gupta']);
  });

  it('my variation: a cell value found sure elsewhere in the file is sure in the column too (every occurrence)', async () => {
    // Page 2 names the first employee's mobile with its label: sure there, so sure in the register as well.
    const { models } = await read(await makeRawPagesPdf([register(ROWS), cell(30, 700, `Mobile number: ${ROWS[0][4]}`)]));
    const first = models.flatMap((m) => proposalsForPage(m, [], { groups: EVERY, terms: [], measure }));
    const all = everyOccurrence(models, first, measure);
    const mobiles = all.filter((p) => p.kind === 'mobile' && p.page === 0).map((p) => [p.value, p.confidence]);
    expect(mobiles).toEqual([[ROWS[0][4], 'sure'], [ROWS[1][4], 'possible'], [ROWS[2][4], 'possible']]);
  });
});

describe('fix wave 4, ruling I: a grouped number in a right-to-left line is read in its logical order (T3-B, B3)', () => {
  const ar = (...codes: number[]) => String.fromCharCode(...codes);
  // An Urdu label ("Aadhaar number") and a word after the number, as letters a reader reads right to left.
  const LABEL = ar(0x622, 0x62f, 0x6be, 0x627, 0x631, 0x20, 0x646, 0x645, 0x628, 0x631);
  const AFTER = ar(0x6c1, 0x6d2);
  const style = { s: { fontFamily: 'sans-serif', ascent: 0.9, descent: -0.2, vertical: false } };
  const item = (str: string, x: number, y: number, eol = false): TextItemLike => ({ str, transform: [13, 0, 0, 13, x, y], width: str.length * 6.5, height: 13, fontName: 's', hasEOL: eol });
  const reversed = (text: string) => Array.from(text).reverse().join('');
  /** A page as Chromium draws an Urdu sentence whose number wraps (the re-tester's H16): each line left to right. */
  const urduPage = (index: number) =>
    buildPageText(index, [
      // line 1: the number's first two groups at its left end (drawn "6789 2345"), the label to their right
      item('6789 2345', 57, 677), item(' ', 118, 677), item(reversed(LABEL), 400, 677, true),
      // line 2: a word at the left, the third group at the right end
      item(reversed(AFTER), 57, 659), item(' ', 500, 659), item('0124', 509, 659, true),
    ], style, [0, 0, 612, 792], 0);
  const latinPage = buildPageText(0, [item(`Aadhaar ${AADHAAR_SPACED}`, 57, 700, true)], style, [0, 0, 612, 792], 0);

  it("finds the number a Latin line gives in the Urdu sentence (the re-tester's H16): the groups in reading order", () => {
    const seed = proposalsForPage(latinPage, [], options).filter((p) => p.kind === 'aadhaar');
    expect(seed).toHaveLength(1);
    const urdu = urduPage(1);
    const found = everyOccurrence([latinPage, urdu], seed, measure).filter((p) => p.page === 1);
    expect(found).toHaveLength(1);
    // One range per group: they stand apart in the file's order, each boxed where it is drawn.
    expect(found[0].ranges.map(([s, e]) => urdu.text.slice(s, e)).sort()).toEqual(['0124', '2345', '6789']);
  });

  it('my variations: three groups on one line; a Hebrew line; a Latin line with spaced groups is not reordered', () => {
    const hebrew = ar(0x5d8, 0x5dc, 0x5e4, 0x5d5, 0x5df);
    const oneLine = buildPageText(1, [item('0124 6789 2345', 57, 677), item(' ', 160, 677), item(reversed(hebrew), 400, 677, true)], style, [0, 0, 612, 792], 0);
    const seed = proposalsForPage(latinPage, [], options).filter((p) => p.kind === 'aadhaar');
    expect(everyOccurrence([latinPage, oneLine], seed, measure).filter((p) => p.page === 1)).toHaveLength(1);
    // In a Latin line the groups are already in reading order: "0124 6789 2345" is another number, not this one.
    const latinOther = buildPageText(1, [item('Ref 0124 6789 2345', 57, 677, true)], style, [0, 0, 612, 792], 0);
    expect(everyOccurrence([latinPage, latinOther], seed, measure).filter((p) => p.page === 1)).toEqual([]);
  });
});

describe('pages without text', () => {
  it('finds nothing on a scanned page, and says the page has no text', async () => {
    // A "scan": one grey image over the whole page, with the words only in its pixels.
    const doc = await PDFDocument.create();
    const page = doc.addPage([300, 400]);
    const pixels = Buffer.alloc(60 * 80, 128);
    const image = doc.context.register(
      doc.context.stream(zlib.deflateSync(pixels), { Type: 'XObject', Subtype: 'Image', Width: 60, Height: 80, ColorSpace: 'DeviceGray', BitsPerComponent: 8, Filter: 'FlateDecode' } as never),
    );
    page.node.set(PDFName.of('Resources'), doc.context.obj({ XObject: { Im0: image } }));
    page.node.set(PDFName.of('Contents'), doc.context.register(doc.context.flateStream('q 300 0 0 400 0 0 cm /Im0 Do Q')));
    const pages = await read(await doc.save());
    expect(pageHasText(pages.models[0])).toBe(false);
    expect(proposalsForPage(pages.models[0], pages.annotations[0], { ...options, terms: [{ text: 'BNZPM2501F', reason: 'Typed' }] })).toEqual([]);
  });
});

describe('page-sized boxes', () => {
  it('drops an automatic box covering more than 95% of the page, and counts it', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const width = font.widthOfTextAtSize('Confidential', 10);
    const page = doc.addPage([width + 3, 14.5]);
    page.drawText('Confidential', { x: 1.5, y: 4, size: 10, font });
    const big = doc.addPage([400, 400]);
    big.drawText('Confidential', { x: 50, y: 300, size: 10, font });
    const pages = await read(await doc.save());
    const found = pages.models.flatMap((m) => proposalsForPage(m, [], { ...options, terms: [{ text: 'confidential', reason: 'Typed' }] }));
    expect(found).toHaveLength(2);
    const area = (p: number) => {
      const [x0, y0, x1, y1] = pages.models[p].view;
      return (x1 - x0) * (y1 - y0);
    };
    const { kept, dropped } = dropPageSizedBoxes(found, area);
    expect(AUTO_BOX_MAX_SHARE).toBe(0.95);
    expect(dropped).toBe(1);
    expect(kept.map((p) => p.page)).toEqual([1]);
  });

  it('keeps the place of a comment drawn over the whole page, without a box, and counts the box left out (fix wave B3)', () => {
    // A reviewer's rectangle around the page with the value in its note: the place stays in the review
    // (its page is rebuilt and the comment leaves with it), but no automatic box blacks out the page.
    const model = buildPageText(0, [], {}, [0, 0, 400, 400], 0);
    const found = proposalsForPage(
      model,
      [
        { subtype: 'Square', rect: [0, 0, 400, 400], texts: [`Check PAN ${PAN}`], flags: 4 },
        { subtype: 'Square', rect: [10, 10, 100, 40], texts: [`PAN ${PAN2}`], flags: 4 },
        { subtype: 'Square', rect: [0, 0, 400, 400], texts: [`PAN ${HIDDEN_PAN}`], flags: 2 },
      ],
      options,
    );
    const { kept, dropped } = dropPageSizedBoxes(found, () => 400 * 400);
    expect(dropped).toBe(1);
    // The page shows it, so it is not "removed without a box" (fix wave round 2, RX-RUN): `pageSized` says why
    // it has no automatic box. A hidden annotation is simply hidden.
    expect(kept.map((p) => [p.key, p.hidden, p.pageSized])).toEqual([
      [PAN, true, true],
      [PAN2, false, undefined],
      [HIDDEN_PAN, true, undefined],
    ]);
    expect(PAGE_SIZED_NOTE).toBe('drawn over the whole page: placed during the run, or the run stops');
  });
});

describe('limits and grouping', () => {
  const style = { s: { fontFamily: 'sans-serif', ascent: 0.9, descent: -0.2, vertical: false } };
  const pageOf = (index: number, lines: string[]): PageTextModel =>
    buildPageText(
      index,
      lines.map((str, i): TextItemLike => ({ str, transform: [10, 0, 0, 10, 50, 780 - i * 12], width: str.length * 5.5, height: 10, fontName: 's', hasEOL: true })),
      style,
      [0, 0, 612, 792],
      0,
    );

  it('finds a value split over two items on one line as one place with one box', () => {
    const items: TextItemLike[] = [
      { str: 'PAN BNZPM', transform: [10, 0, 0, 10, 50, 700], width: 50, height: 10, fontName: 's', hasEOL: false },
      { str: '2501F holder', transform: [10, 0, 0, 10, 100, 700], width: 60, height: 10, fontName: 's', hasEOL: false },
    ];
    const found = proposalsForPage(buildPageText(0, items, style, [0, 0, 612, 792], 0), [], options);
    expect(found.map((p) => [p.kind, p.key, p.rects.length])).toEqual([['pan', PAN, 1]]);
  });

  it('does not take a PAN wrapped over two lines as a PAN, but finds it as another place of one seen elsewhere', () => {
    const models = [pageOf(0, [`PAN ${PAN} of the assessee`]), pageOf(1, ['The assessee holds BNZPM', '2501F as PAN'])];
    expect(proposalsForPage(models[1], [], options)).toEqual([]);
    const all = everyOccurrence(models, proposalsForPage(models[0], [], options), measure);
    const wrapped = all.filter((p) => p.page === 1);
    expect(wrapped.map((p) => [p.kind, p.key, p.value, p.rects.length])).toEqual([['pan', PAN, 'BNZPM\n2501F', 2]]);
  });

  it('finds every place there is: the limit counts ticked places, in the review (fix round 1, F4)', () => {
    const lines = Array.from({ length: 60 }, () => Array.from({ length: 9 }, () => PAN).join(' '));
    const models = Array.from({ length: 10 }, (_, i) => pageOf(i, lines));
    const first = proposalsForPage(models[0], [], options).slice(0, 1);
    expect(MAX_PLACES).toBe(5000);
    expect(everyOccurrence(models, first, measure)).toHaveLength(5400);
    const error = tooManyPlaces(5955);
    expect(error).toBeInstanceOf(PdfToolsError);
    expect(error).toMatchObject({
      code: 'redact-too-many',
      message: '5,955 places are ticked. Redact can remove at most 5,000 in one run: untick a kind of data, or the places on some pages, and redact the rest in a second run.',
    });
  });

  it('holds the unticked possibles of a 200-page bank statement compactly, and expands a value on demand', () => {
    const lines = statementLines(200 * 45);
    const models = Array.from({ length: 200 }, (_, p) => pageOf(p, lines.slice(p * 45, p * 45 + 45)));
    const found = models.map((m) => findOnPage(m, [], options));
    const held = holdPlaces(found.map((f) => f.held));
    const proposals = everyOccurrence(models, found.flatMap((f) => f.proposals), measure);
    expect(held.places).toBeGreaterThan(5000);
    expect(proposals.filter((p) => p.confidence === 'possible' && neverTickedByDefault(p.kind, p.confidence, p.reason))).toEqual([]);
    const summary = heldSummary(held);
    expect(summary.map((s) => s.kind).sort()).toEqual(['aadhaar', 'bank-account', 'ifsc', 'tan']);
    expect(summary.reduce((n, s) => n + s.places, 0)).toBe(held.places);
    // A page of rows at a time, then one value's places built into proposals when the user asks.
    const rows = heldValues(held, 'ifsc', 0, 20);
    expect(rows).toHaveLength(20);
    const places = materializeHeld(held, rows[0].index, models, measure);
    expect(places).toHaveLength(rows[0].places);
    expect(places.every((p) => p.kind === 'ifsc' && p.key === rows[0].key && p.confidence === 'possible' && p.rects.length > 0)).toBe(true);
    // The same proposals the full find gives for that place.
    const page = places[0].page;
    expect(proposalsForPage(models[page], [], options).find((p) => p.id === places[0].id)).toEqual(places[0]);
  });

  it('holds 50,000 possibles without building them', () => {
    const byPage = Array.from({ length: 200 }, () =>
      Array.from({ length: 250 }, (_, k): HeldHit => ({ kind: k % 2 ? 'ifsc' : 'tan', key: `K${k}`, start: k * 12, end: k * 12 + 11, reason: k % 2 ? 'a bank branch code with no account number or label' : 'TAN-shaped code with no TAN label' })),
    );
    const t0 = performance.now();
    const held = holdPlaces(byPage);
    const ms = performance.now() - t0;
    expect(held.places).toBe(50_000);
    expect(heldSummary(held)).toEqual([
      { kind: 'tan', label: 'TAN', values: 125, places: 25_000 },
      { kind: 'ifsc', label: 'IFSC', values: 125, places: 25_000 },
    ]);
    expect(heldValues(held, 'tan', 0, 3).map((r) => [r.places, r.pages.length])).toEqual([
      [200, 200],
      [200, 200],
      [200, 200],
    ]);
    expect(heldValues(held, 'tan', 120, 10)).toHaveLength(5);
    expect(ms).toBeLessThan(1000);
  });

  it('boxes, as another place, every written form the check would find (fix round 1, F3)', () => {
    const gstin = GSTIN;
    const seed = pageOf(0, [`PAN ${PAN} of the assessee`, `Aadhaar ${AADHAAR}`, 'Mobile +91 98450 12345', 'A/c No. 50100123456789', 'mail r.kumar@example.in', `GSTIN ${gstin}`]);
    const found = proposalsForPage(seed, [], options);
    const values: [RedactKind, string][] = [
      ['pan', PAN],
      ['aadhaar', AADHAAR],
      ['mobile', '9845012345'],
      ['bank-account', '50100123456789'],
      ['email', 'r.kumar@example.in'],
      ['gstin', gstin],
    ];
    const cases = values.flatMap(([kind, key]) => writtenForms(kind, key).map((form) => ({ kind, key, form })));
    const pages = [seed, ...cases.map((c, i) => pageOf(i + 1, `holds ${c.form.text} here`.split('\n')))];
    const all = everyOccurrence(pages, found, measure);
    const missed = cases.filter((c, i) => {
      const page = pages[i + 1];
      const start = page.text.indexOf('holds ') + 6;
      const end = page.text.lastIndexOf(' here');
      const places = all.filter((p) => p.page === i + 1 && p.kind === c.kind && p.key === c.key);
      return !places.some((p) => p.ranges[0][0] <= start && p.ranges[0][1] >= end && p.rects.length > 0);
    });
    expect(missed.map((c) => `${c.kind}: ${c.form.name}`)).toEqual([]);
  });

  it('keeps an IP address whole and matches an email in any case, as other places (mutations M28, M29)', () => {
    const models = [pageOf(0, ['IP address 10.0.0.1', 'mail r.kumar@example.in']), pageOf(1, ['server 110.0.0.12 and 10.0.0.1.', 'R.KUMAR@EXAMPLE.IN wrote'])];
    const all = everyOccurrence(models, proposalsForPage(models[0], [], options), measure).filter((p) => p.page === 1);
    expect(all.map((p) => [p.kind, p.value])).toEqual([
      ['ip', '10.0.0.1'],
      ['email', 'R.KUMAR@EXAMPLE.IN'],
    ]);
  });

  it('groups places by value in page order, one group per kind and key', () => {
    const models = [pageOf(0, [`PAN ${PAN} and ${AADHAAR}`]), pageOf(1, [`Aadhaar ${AADHAAR}`, `again ${PAN}`])];
    const found = models.flatMap((m) => proposalsForPage(m, [], options));
    const groups = groupByValue(everyOccurrence(models, found, measure));
    expect(groups.map((g) => [g.kind, g.key, g.places.map((p) => p.page)])).toEqual([
      ['pan', PAN, [0, 1]],
      ['aadhaar', AADHAAR, [0, 1]],
    ]);
  });
});
