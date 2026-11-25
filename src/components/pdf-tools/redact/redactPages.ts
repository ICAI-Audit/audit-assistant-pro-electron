// Redact: one rebuilt page (design 5.9 "Boxes", "Remove or Replace", "Output"). The page is drawn by
// the renderer (rotation 0, on white, comments and fields as on screen); every text box is grown until
// no edge cuts ink (pageEncode.ts growAlong, R1's growPastInk), widened to its whole text item when
// ink runs on past the limit; all boxes are filled black and checked black; replacements are drawn in
// white, each inside its own box; the pixels are encoded; and the words of the invisible text layer are
// the page's words that are not redacted and touch no box.
//
// Confidentiality: the page's pixels, its words and the replacements (a masked value holds the last
// four characters, as the user chose) live only inside this call and the picture it returns.
import { BOX_PAD_PT, rangePieces, rangeRects, textAxis, wordRanges, wordRect, type InkGrowth, type MeasureChar, type PageTextModel, type PixelBox, type Rect } from '@/lib/pdf-tools/pageText';
import type { Pace } from '@/lib/pdf-tools/pace';
import type { LayerWord, RebuiltPage } from '@/lib/pdf-tools/redactBuild';
import { AUTO_BOX_MAX_SHARE } from '@/lib/pdf-tools/redactFind';
import { KIND_LABELS, maskValue } from '@/lib/pdf-tools/redactPatterns';
import { PdfToolsError } from '@/lib/pdf-tools/types';
import { blobBytes, canvasToBlob } from '../canvasUtils';
import { pageTransform, type Matrix } from '../viewer/pageGeometry';
import {
  deflateInBrowser,
  encodePagePicture,
  fillBlack,
  growAlong,
  isBlack,
  JPEG_QUALITY,
  pasteInto,
  differingBlocks,
  differingBlocksPaced,
  pictureFailed,
  replacementSize,
  toPixelBox,
  toUserRect,
  type PagePixels,
  type PictureCodecs,
} from './pageEncode';
import type { RedactDpi, RedactMode, RedactOutput, ReplacementStyle } from './redactRecord';
import { charsBox, withPlacement, type TextOp } from './rendererView';
import type { RedactArea } from './reviewState';

/** Ruling L (wave 4, rendererView.ts placeOperations): a page's reading with each operation's place proved by pixels. */
export type PlaceOps = (ops: TextOp[], file: Uint8Array, page: number, into: RenderedPixels) => Promise<TextOp[]>;

/** A renderer-view judge's verdict (rendererView.ts flaggedOperations, as K1 releases it). */
export interface Judged {
  flagged: Set<number>;
  unreadable: Set<number>;
  places: Map<number, [number, number][]>;
  held?: Set<number>;
  gaveUp?: Set<number>;
}

/** A page drawn by the renderer for redaction (pdfRenderer.ts renderPagePixels). */
export interface RenderedPixels extends PagePixels {
  /** Device pixels per point actually used. */
  scale: number;
  view: [number, number, number, number];
  userUnit: number;
  /** pdf.js viewport.transform: user space to these pixels. */
  transform: number[];
  /** With `read`: every operation of the drawing that paints text, as pdf.js drew it (rendererView.ts). */
  textOps?: TextOp[];
}

/** What a drawing for Redact may also do (wave 3, ruling A). */
export interface DrawOptions {
  signal?: AbortSignal;
  /** Operations of the page's operator list not to draw (pdf.js `operationsFilter`). */
  skip?: ReadonlySet<number>;
  /** Also read the operations that paint text, with where each painted (pdf.js `recordOperations`). */
  read?: boolean;
}

export interface PixelRenderer {
  renderPagePixels(file: Uint8Array, pageIndex: number, scale: number, options?: DrawOptions): Promise<RenderedPixels>;
}

/** Draws a replacement: white bold sans-serif text, centred, on black, of exactly w x h pixels. */
export interface TextPainter {
  /** The text's width at a 1 px font size. */
  advance(text: string): number;
  /** RGBA of w x h pixels: black, with the text in white along `angle` (degrees counter-clockwise, a quarter turn). */
  paint(text: string, sizePx: number, w: number, h: number, angle: number): Uint8ClampedArray;
}

export interface DrawChoices {
  mode: RedactMode;
  replacement: { style: ReplacementStyle; token: string };
  output: RedactOutput;
  dpi: RedactDpi;
}

export interface PageWork {
  /** 0-based. */
  page: number;
  /** The page's text model from the find (absent for a page without text). */
  model?: PageTextModel;
  /** What to remove on it: the user's areas and any the check added. Empty for a flattened page. */
  areas: readonly RedactArea[];
  /** Rebuilt as drawn, without boxes, on the user's confirmation (lead ruling E): it held a value that is not drawn. */
  flatten?: boolean;
  /**
   * Rebuilt because it may not be copied (wave 4, ruling M: not on the copy allow-list), under the proof like a
   * page that holds a value; it may end with no box at all (a picture of the page with its own text layer).
   */
  safety?: boolean;
}

export interface DrawnPage {
  rebuilt: RebuiltPage;
  replacementsNotFitted: number;
  /** Boxes widened to their whole text item because ink ran on past the growth limit. */
  boxesWidened: number;
  /** Boxes the proof added: a drawing of a chosen value the boxes did not cover (wave 2, ruling 1). */
  coveredMore: number;
  /** The proof covered whole a stream that could not be read (ruling 2). */
  unreadable: boolean;
  /** Ruling R (wave 5): what the proof covered of text that could not be read was only its glyphs with no letter (K1), not a whole run. */
  unreadableLetters?: boolean;
  /** K4 (wave 4): all the page's text is an invisible layer (a scan's OCR text): the picture may show a value that text misread. */
  hiddenTextOnly?: boolean;
}

/**
 * The proof's copies (redactRounds.ts proofCopies): the page is drawn from `base`, and every pixel where
 * `cut` differs (what holds a chosen value, or a stream that could not be read) must lie in a box.
 */
export interface PageProof {
  base: Uint8Array;
  cut: Uint8Array;
  /** Pages where base and cut differ: only those are drawn twice. */
  pages: ReadonlySet<number>;
  unreadable: ReadonlySet<number>;
  /** Pages with a drawing to cover that the copies could not reach (redactRounds ProofCopies.unplacedPages): never rebuilt. */
  unplaced?: ReadonlySet<number>;
}

/** Above this share of the page, what the proof finds uncovered is not boxed: the run stops (redactRounds INK_MAX_SHARE). */
const PROOF_MAX_SHARE = 0.6;
/** The proof's boxes keep this margin, in points (redactRounds INK_PAD_PT). */
const PROOF_PAD_PT = 3;

/** The proof found a drawing of a chosen value it could not box (more than most of the page): nothing is added. */
export const proofFailed = (page: number) =>
  new PdfToolsError(
    'redact-check-failed',
    `The redacted file could not be verified: page ${page + 1} draws redacted text over most of the page, where no box can be placed. Nothing was added. Untick that value, or print the file to a new PDF and redact that copy.`,
  );

/** The renderer's own reading of the page could not be taken, or its two drawings did not execute the same operations: nothing is added. */
export const proofUnread = (page: number) =>
  new PdfToolsError(
    'redact-check-failed',
    `The redacted file could not be verified: page ${page + 1} could not be read as it is drawn. Nothing was added. Untick that value, or print the file to a new PDF and redact that copy.`,
  );

/** A drawing to cover on the page could not be reached in the proof's copies: nothing is added. */
export const proofUnplaced = (page: number) =>
  new PdfToolsError(
    'redact-check-failed',
    `The redacted file could not be verified: page ${page + 1} draws something that could not be read, where no box can be placed. Nothing was added. Untick that value, or print the file to a new PDF and redact that copy.`,
  );

const near = (a: readonly number[], b: readonly number[], tolerance: number) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= tolerance);

/**
 * The drawing's user-space-to-pixels mapping: the viewer's single mapping (pageGeometry.ts) with no
 * turn, which must agree with the renderer's own viewport; if it does not, the boxes could not be placed
 * with certainty and the page is not used.
 */
export function drawingTransform(drawn: Pick<RenderedPixels, 'view' | 'scale' | 'userUnit' | 'transform'>): Matrix {
  const m = pageTransform({ view: drawn.view, rotate: 0, userUnit: drawn.userUnit }, drawn.scale, 0);
  if (!near(m, drawn.transform, 1e-6 * Math.max(1, ...m.map(Math.abs)))) throw pictureFailed();
  return m;
}

/** The text of a replacement for one area (design 5.9): the token, the kind's label or the masked value. */
export function replacementText(area: Pick<RedactArea, 'kind' | 'key'>, choice: DrawChoices['replacement']): string {
  if (choice.style === 'label') return KIND_LABELS[area.kind];
  if (choice.style === 'masked') return area.key ? maskValue(area.kind, area.key) : KIND_LABELS[area.kind];
  return choice.token.trim();
}

/** [start, end) in the model's text of each item (by index). */
function itemRanges(model: PageTextModel): Map<number, [number, number]> {
  const ranges = new Map<number, [number, number]>();
  model.map.forEach((at, k) => {
    if (!at) return;
    const r = ranges.get(at[0]);
    if (r) r[1] = k + 1;
    else ranges.set(at[0], [k, k + 1]);
  });
  return ranges;
}

const meets = (a: Rect, b: Rect) => a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1;
const pad = (r: Rect, p: number): Rect => ({ x0: r.x0 - p, y0: r.y0 - p, x1: r.x1 + p, y1: r.y1 + p });
const union = (a: Rect, b: Rect): Rect => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) });
const inside = (a: PixelBox, b: PixelBox) => a.left >= b.left && a.top >= b.top && a.right <= b.right && a.bottom <= b.bottom;

/** The whole text items an area's ranges touch, as padded boxes: what certainly holds its text. */
function wholeItemBoxes(model: PageTextModel, area: RedactArea, measure: MeasureChar): Rect[] {
  const items = new Set<number>();
  for (const [s, e] of area.ranges) for (const p of rangePieces(model, s, e, measure)) items.add(p.itemIndex);
  const ranges = itemRanges(model);
  const out: Rect[] = [];
  for (const i of items) {
    const r = ranges.get(i);
    if (r) out.push(...rangeRects(model, r[0], r[1], measure));
  }
  return out;
}

interface Placed {
  box: PixelBox;
  area: RedactArea;
}

/** Ruling S (wave 5): how far, in points, the box of text at a slant may still grow past its whole text items. */
const SLANT_GROW_PT = 12;

/**
 * The boxes of a page, in pixels: each rect of each area that shows on the page; text boxes grown past
 * ink along their text (1 em at most), and widened to their whole text items when ink runs on past that.
 * `unplaced` are the user-space rects not burned (hidden places, and parts off the drawing): the build
 * still gets them, so the text layer leaves their words out.
 */
async function placeBoxes(px: PagePixels, m: Matrix, work: PageWork, measure: MeasureChar, padPx: number, pageArea: number, pace?: Pace): Promise<{ placed: Placed[]; unplaced: Rect[]; widened: number }> {
  const placed: Placed[] = [];
  const unplaced: Rect[] = [];
  let widened = 0;
  // A hidden place with no text of its own (a comment that is not drawn) as large as the page is no box
  // for the text layer: it would take every word of the page out of it (its value's words are left out
  // by their own ranges). Kept when it is all the page has, so the page still has a box to be rebuilt for.
  const pageSized = (area: RedactArea) => area.hidden && area.ranges.length === 0 && pageArea > 0 && area.rects.some((r) => (r.x1 - r.x0) * (r.y1 - r.y0) > AUTO_BOX_MAX_SHARE * pageArea);
  const others = work.areas.some((a) => !pageSized(a));
  for (const area of work.areas) {
    if (area.hidden) {
      if (!(others && pageSized(area))) unplaced.push(...area.rects);
      continue;
    }
    const text = area.kind !== 'drawn' && area.ranges.length > 0 && work.model !== undefined;
    for (const rect of area.rects) {
      const box = toPixelBox(m, rect, px.width, px.height);
      if (!box) {
        unplaced.push(rect);
        continue;
      }
      if (!text) {
        placed.push({ box, area });
        continue;
      }
      // Ruling S (wave 5): a chance of a turn for the window before each box is grown.
      const turn = pace?.();
      if (turn) await turn;
      const vertical = textAxis(area.angle, 0) === 'vertical';
      const across = vertical ? box.right - box.left : box.bottom - box.top;
      // Ruling S: text at a slant (a watermark) is boxed by an upright rectangle around it, so growing along an axis
      // only meets the lines that cross it (H18: every such box ran on to the limit, one growth taking 0.5 s): it
      // takes its whole text items at once, grown at most 12 pt more. What it still leaves is boxed by the proof.
      const slanted = Math.round(area.angle) % 90 !== 0;
      let grown: InkGrowth = slanted ? { box, grew: { left: 0, top: 0, right: 0, bottom: 0 }, hitLimit: true } : growAlong(px, box, area.angle, Math.max(4, across), padPx);
      if (grown.hitLimit) {
        // Ink runs on past a whole em: an underline, a rule, or text set with no gap. The value cannot
        // lie outside its own text items (pdf.js gives their extent exactly), so the box takes them whole.
        const items = wholeItemBoxes(work.model!, area, measure).filter((r) => meets(r, rect));
        const whole = items.reduce(union, rect);
        const wider = toPixelBox(m, whole, px.width, px.height) ?? box;
        grown = growAlong(px, wider, area.angle, Math.max(4, slanted ? Math.min(across, (SLANT_GROW_PT * padPx) / BOX_PAD_PT) : across), padPx);
        widened += 1;
      }
      placed.push({ box: grown.box, area });
    }
  }
  return { placed, unplaced, widened };
}

/**
 * Where a skipped operation's chosen (or unreadable) characters paint: one box for each of its places (two places
 * far apart on one line are not joined into the stretch between them: K1, wave 4), else where it painted. Null
 * when that cannot be told.
 */
function regionsOf(o: TextOp, places: ReadonlyMap<number, [number, number][]>, transform: readonly number[]): PixelBox[] | null {
  const ranges = places.get(o.index);
  if (ranges && ranges.length > 0) {
    const boxes = ranges.map((r) => charsBox(o, [r], transform));
    if (boxes.every((b) => b !== null)) return boxes as PixelBox[];
  }
  return o.box ? [o.box] : null;
}

/**
 * Ruling B (wave 3) for a page that is not rebuilt: the renderer's own reading of it at a glance (72 dpi);
 * when an operation it draws holds a chosen value or cannot be read, where those operations paint at the
 * run's `scale` (the page drawn again with them skipped, the difference inside their boxes), as user-space
 * rectangles, and whether any of them holds a value (else they only cannot be read). Empty: nothing to cover.
 * Null: it cannot be told (not read, or most of the page).
 */
export async function viewInk(
  renderer: PixelRenderer,
  file: Uint8Array,
  page: number,
  scale: number,
  judge: (ops: TextOp[], pxPerPt: number, page: number) => Judged | Promise<Judged>,
  signal?: AbortSignal,
  pace?: Pace,
  place?: PlaceOps,
): Promise<{ rects: Rect[]; held: boolean } | null> {
  // A page is copied unless an operation on it holds a chosen value or the reading gave up on it (Ruling B,
  // as RX-LIB's readerGaveUp): a glyph whose font's map only cannot be trusted (a symbol-font bullet) does not
  // make a page rebuilt; on a page rebuilt anyway it is boxed (drawRebuiltPage).
  const matters = (j: Judged) => [...j.flagged].some((i) => !j.held || !j.gaveUp || j.held.has(i) || j.gaveUp.has(i));
  const glance = await renderer.renderPagePixels(file, page, 1, { signal, read: true });
  let glanceOps = glance.textOps ?? [];
  if (glanceOps.some((o) => o.index < 0)) return null;
  if (place) glanceOps = await place(glanceOps, file, page, glance);
  if (!matters(await judge(glanceOps, glance.scale * glance.userUnit, page))) return { rects: [], held: false };
  const first = await renderer.renderPagePixels(file, page, scale, { signal, read: true });
  let ops = first.textOps ?? [];
  if (ops.some((o) => o.index < 0)) return null;
  if (place) ops = withPlacement(ops, glanceOps, first);
  const pxPerPt = first.scale * first.userUnit;
  const judged = await judge(ops, pxPerPt, page);
  const { flagged, unreadable, places } = judged;
  if (!matters(judged)) return { rects: [], held: false };
  const second = await renderer.renderPagePixels(file, page, scale, { signal, skip: flagged, read: true });
  if (second.width !== first.width || second.height !== first.height || second.data.length !== first.data.length) return null;
  const after = new Map((second.textOps ?? []).map((o) => [o.index, o.text]));
  const flaggedOps = ops.filter((o) => flagged.has(o.index));
  if (flaggedOps.some((o) => after.get(o.index) !== o.text)) return null;
  const cell = Math.max(4, Math.round(6 * pxPerPt));
  const outside = new Uint8Array(first.width * first.height);
  const regions = flaggedOps.map((o) => regionsOf(o, places, first.transform));
  if (regions.every((r) => r !== null)) {
    outside.fill(1);
    for (const b of regions.flatMap((r) => r!)) {
      const left = Math.max(0, b.left - cell);
      const right = Math.min(first.width, b.right + cell);
      for (let y = Math.max(0, b.top - cell); y < Math.min(first.height, b.bottom + cell); y++) outside.fill(0, y * first.width + left, y * first.width + right);
    }
  }
  const blocks = pace ? await differingBlocksPaced(first.data, second.data, first.width, first.height, cell, outside, pace) : differingBlocks(first.data, second.data, first.width, first.height, cell, outside);
  const area = blocks.reduce((sum, b) => sum + (b.right - b.left) * (b.bottom - b.top), 0);
  if (area > PROOF_MAX_SHARE * first.width * first.height) return null;
  const m = drawingTransform(first);
  return { rects: blocks.map((b) => toUserRect(m, b)), held: judged.held ? judged.held.size > 0 : [...flagged].some((i) => !unreadable.has(i)) };
}

/** Draws, burns, checks and encodes one page, and chooses its text layer. */
export async function drawRebuiltPage(
  file: Uint8Array,
  work: PageWork,
  choices: DrawChoices,
  deps: {
    renderer: PixelRenderer;
    codecs: PictureCodecs;
    painter: TextPainter;
    measure: MeasureChar;
    signal?: AbortSignal;
    pause?: () => Promise<void>;
    /** Ruling D (wave 3b): passes over the pixels give the window a turn when one is due (pace.ts). */
    pace?: Pace;
    proof?: PageProof;
    /** The renderer-view reading's verdict (wave 3, ruling A): which operations to skip in the second drawing (rendererView.ts flaggedOperations; in turns, ruling S). */
    judge?: (ops: TextOp[], pxPerPt: number, page: number) => Judged | Promise<Judged>;
    /** Ruling L (wave 4): positions proved by pixels before the reading is judged. */
    place?: PlaceOps;
  },
): Promise<DrawnPage> {
  // Drawn from the proof's copy when there is one: the picture is made from what was checked (ruling 2).
  const proof = deps.proof;
  if (proof?.unplaced?.has(work.page)) throw proofUnplaced(work.page);
  const scale = choices.dpi / 72;
  const pictureFile = proof ? proof.base : file;
  // The renderer's own reading (wave 3, ruling A) is taken from the copy the proof compares last: the copy
  // without what the file reading found (`cut`) on a page it changed, else the page as drawn.
  const viaCut = Boolean(proof && proof.pages.has(work.page) && !work.flatten);
  const reading = Boolean(deps.judge && !work.flatten);
  const drawn = await deps.renderer.renderPagePixels(pictureFile, work.page, scale, { signal: deps.signal, ...(reading && !viaCut ? { read: true } : {}) });
  const m = drawingTransform(drawn);
  const px: PagePixels = { data: drawn.data, width: drawn.width, height: drawn.height };
  if (px.data.length !== px.width * px.height * 4) throw pictureFailed();

  if (work.flatten && work.areas.length > 0) throw pictureFailed();
  // Between the heavy steps the window gets its turn (a 200 dpi page is 4 million pixels).
  const pause = deps.pause ?? (async () => undefined);
  await pause();
  const [vx0, vy0, vx1, vy1] = drawn.view;
  const { placed, unplaced, widened } = await placeBoxes(px, m, work, deps.measure, BOX_PAD_PT * drawn.scale * drawn.userUnit, Math.abs((vx1 - vx0) * (vy1 - vy0)), deps.pace);
  if (!work.flatten && !work.safety && placed.length + unplaced.length === 0) throw pictureFailed();
  const pxPerPt = drawn.scale * drawn.userUnit;
  const cell = Math.max(4, Math.round(6 * pxPerPt));
  const pad = Math.ceil(PROOF_PAD_PT * pxPerPt);
  const blocksOf = (a: Uint8ClampedArray, b: Uint8ClampedArray, skip: Uint8Array) =>
    deps.pace ? differingBlocksPaced(a, b, px.width, px.height, cell, skip, deps.pace) : Promise.resolve(differingBlocks(a, b, px.width, px.height, cell, skip));
  const sameSize = (other: RenderedPixels) => {
    if (other.width !== px.width || other.height !== px.height || other.data.length !== px.data.length) throw pictureFailed();
  };
  const boxedMask = () => {
    const inBox = new Uint8Array(px.width * px.height);
    for (const p of placed) for (let y = p.box.top; y < p.box.bottom; y++) inBox.fill(1, y * px.width + p.box.left, y * px.width + p.box.right);
    return inBox;
  };
  // The proof (wave 2, ruling 1): where the copy without what holds a chosen value differs from this
  // drawing, every such pixel must lie in a box; one that does not gets a box where it paints (or the run
  // stops). Never inferred from the text: a covered place does not vouch for another drawing.
  let coveredMore = 0;
  let coveredUnreadable = false;
  let coveredLetters = false;
  let hiddenTextOnly = false;
  const proofAreas = new Set<RedactArea>();
  const addBlocks = (blocks: PixelBox[]) => {
    const area = blocks.reduce((sum, b) => sum + (b.right - b.left) * (b.bottom - b.top), 0);
    if (area > PROOF_MAX_SHARE * px.width * px.height) throw proofFailed(work.page);
    for (const b of blocks) {
      const box = { left: Math.max(0, b.left - pad), top: Math.max(0, b.top - pad), right: Math.min(px.width, b.right + pad), bottom: Math.min(px.height, b.bottom + pad) };
      const area: RedactArea = { page: work.page, rects: [toUserRect(m, box)], kind: 'drawn', hidden: false, angle: 0, ranges: [] };
      proofAreas.add(area);
      placed.push({ box, area });
      coveredMore += 1;
    }
  };
  let subject: RenderedPixels = drawn;
  let subjectFile = pictureFile;
  if (proof && viaCut) {
    const cut = await deps.renderer.renderPagePixels(proof.cut, work.page, scale, { signal: deps.signal, ...(reading ? { read: true } : {}) });
    sameSize(cut);
    addBlocks(await blocksOf(px.data, cut.data, boxedMask()));
    subject = cut;
    subjectFile = proof.cut;
  }
  // The renderer's own reading (wave 3, ruling A): every operation pdf.js draws that still shows a chosen
  // value (read alone, joined, in position order, down a column) or cannot be read is skipped in a second
  // drawing by the same engine; where the two differ, inside where those operations painted, gets a box.
  if (reading && deps.judge) {
    await pause();
    let ops = subject.textOps ?? [];
    if (ops.some((o) => o.index < 0)) throw proofUnread(work.page);
    if (deps.place) ops = await deps.place(ops, subjectFile, work.page, subject);
    // K4: the page's only text is an invisible layer (as an OCR'd scan has): said in the result.
    hiddenTextOnly = ops.some((o) => o.text.trim() !== '') && ops.every((o) => !o.visible || o.text.trim() === '');
    const { flagged, unreadable, places } = await deps.judge(ops, pxPerPt, work.page);
    const skipMask = boxedMask();
    // True when the box lies (98% of its pixels) inside the boxes already placed.
    const boxedAlready = (b: PixelBox | null) => {
      if (!b) return false;
      const [x0, x1, y0, y1] = [Math.max(0, b.left), Math.min(px.width, b.right), Math.max(0, b.top), Math.min(px.height, b.bottom)];
      if (x1 <= x0 || y1 <= y0) return false;
      let n = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) n += skipMask[y * px.width + x];
      return n >= 0.98 * (x1 - x0) * (y1 - y0);
    };
    // Ruling F: an operation whose every chosen piece the renderer places where a box already is (the middle of
    // each piece, baseline to 0.6 of the size, lies in the boxes: the find and the renderer agree on the place) is
    // covered there, since every box was grown past the ink it meets (placeBoxes). Skipping it again would only
    // compare the words beside the value, and text after it that shifts, and box them. The others are skipped.
    const agrees = (o: TextOp) => {
      const ranges = places.get(o.index);
      return ranges !== undefined && ranges.every((r) => boxedAlready(charsBox(o, [r], subject.transform, { along: -0.15, below: 0, above: 0.6 })));
    };
    const flaggedOps = ops.filter((o) => flagged.has(o.index) && !agrees(o));
    const skip = new Set(flaggedOps.map((o) => o.index));
    if (skip.size > 0) {
      const second = await deps.renderer.renderPagePixels(subjectFile, work.page, scale, { signal: deps.signal, skip, read: true });
      sameSize(second);
      // The second drawing must have executed the same operations: each skipped one reads the same in both.
      const before = new Map(ops.map((o) => [o.index, o.text]));
      const after = new Map((second.textOps ?? []).map((o) => [o.index, o.text]));
      for (const i of skip) if (before.get(i) !== after.get(i)) throw proofUnread(work.page);
      const outside = new Uint8Array(px.width * px.height);
      // Where each skipped operation's chosen characters paint (half the size beyond each end, a cell around),
      // else where it painted; only there (the rest of a skipped operation, and text after it that shifts, are
      // not the value's).
      const regions = flaggedOps.map((o) => regionsOf(o, places, subject.transform));
      if (regions.every((r) => r !== null)) {
        outside.fill(1);
        for (const b of regions.flatMap((r) => r!)) {
          const left = Math.max(0, b.left - cell);
          const right = Math.min(px.width, b.right + cell);
          for (let y = Math.max(0, b.top - cell); y < Math.min(px.height, b.bottom + cell); y++) outside.fill(0, y * px.width + left, y * px.width + right);
        }
      }
      for (let i = 0; i < skipMask.length; i++) skipMask[i] |= outside[i];
      const before2 = coveredMore;
      addBlocks(await blocksOf(subject.data, second.data, skipMask));
      // Ruling R (wave 5): an unreadable operation covered only where its glyphs with no letter paint (K1's places) is
      // letters covered, not a whole run.
      const odd = flaggedOps.filter((o) => unreadable.has(o.index));
      if (coveredMore > before2 && odd.some((o) => !places.has(o.index))) coveredUnreadable = true;
      else if (coveredMore > before2 && odd.length > 0) coveredLetters = true;
    }
  }
  for (const p of placed) fillBlack(px, p.box);
  // Every box must now be black, every pixel of it: anything else is a failure, never a warning.
  for (const p of placed) if (!isBlack(px, p.box)) throw pictureFailed();

  await pause();
  let notFitted = 0;
  if (choices.mode === 'replace') {
    const pxPerPt = drawn.scale * drawn.userUnit;
    // One replacement per area, in its longest box; none in a box that lies inside another's (a PAN
    // inside a ticked GSTIN), so two labels are never drawn over each other.
    const longest = new Map<RedactArea, PixelBox>();
    for (const p of placed) {
      if (proofAreas.has(p.area)) continue; // the proof's own boxes stay plain black
      const vertical = textAxis(p.area.angle, 0) === 'vertical';
      const length = (b: PixelBox) => (vertical ? b.bottom - b.top : b.right - b.left);
      const known = longest.get(p.area);
      if (!known || length(p.box) > length(known)) longest.set(p.area, p.box);
    }
    const boxes = [...longest.entries()];
    // Skipped: a box inside another's (for two equal boxes, the later one).
    const covered = (i: number) => boxes.some(([, b], j) => j !== i && inside(boxes[i][1], b) && (!inside(b, boxes[i][1]) || j < i));
    for (const [i, [area, box]] of boxes.entries()) {
      if (covered(i)) continue;
      const a = ((Math.round(area.angle) % 360) + 360) % 360;
      if (a % 90 !== 0) {
        notFitted += 1;
        continue;
      }
      const w = box.right - box.left;
      const h = box.bottom - box.top;
      const along = a === 90 || a === 270;
      const text = replacementText(area, choices.replacement);
      const size = replacementSize(deps.painter.advance(text), along ? h : w, along ? w : h, pxPerPt);
      if (size === null) {
        notFitted += 1;
        continue;
      }
      pasteInto(px, box, deps.painter.paint(text, size, w, h, a));
    }
  }

  await pause();
  const picture = await encodePagePicture(px, deps.codecs, deps.pace);
  await pause();
  const boxes = [...placed.map((p) => toUserRect(m, p.box)), ...unplaced];
  const words = choices.output === 'searchable' && work.model ? layerWords(work.model, work.areas, boxes, deps.measure) : [];
  // A page rebuilt only for ruling M has its own reason: it takes the boxes the proof placed there, or none.
  const rebuilt: RebuiltPage = work.flatten
    ? { pageIndex: work.page, picture, words, reason: 'flattened', boxes: [] }
    : { pageIndex: work.page, picture, words, reason: work.safety && boxes.length === 0 ? 'safety' : 'boxes', boxes };
  const unreadableWhole = coveredUnreadable || (coveredMore > 0 && proof?.unreadable.has(work.page) === true);
  return { rebuilt, replacementsNotFitted: notFitted, boxesWidened: widened, coveredMore, unreadable: unreadableWhole, ...(!unreadableWhole && coveredLetters ? { unreadableLetters: true } : {}), ...(hiddenTextOnly ? { hiddenTextOnly } : {}) };
}

/**
 * The words the invisible text layer keeps (design 5.9 "Searchable"): every word of the page that is
 * not part of a redacted place and whose box, padded by 1.5 pt, touches no box burned into the picture;
 * each written where pdf.js placed it, one piece per text item.
 */
export function layerWords(model: PageTextModel, areas: readonly RedactArea[], boxes: readonly Rect[], measure: MeasureChar): LayerWord[] {
  const redacted = areas.flatMap((a) => a.ranges);
  const words: LayerWord[] = [];
  for (const range of wordRanges(model)) {
    if (redacted.some(([s, e]) => range[0] < e && s < range[1])) continue;
    if (boxes.some((b) => meets(pad(wordRect(model, range, measure), BOX_PAD_PT), b))) continue;
    for (const piece of rangePieces(model, range[0], range[1], measure)) {
      const text = model.items[piece.itemIndex].str.slice(piece.from, piece.to).replace(/\s+/g, '');
      if (text === '' || !(piece.size > 0) || !(piece.length >= 0)) continue;
      const [dx, dy] = piece.direction;
      const [ux, uy] = piece.up;
      words.push({ text, transform: [dx * piece.size, dy * piece.size, ux * piece.size, uy * piece.size, piece.origin[0], piece.origin[1]], width: piece.length });
    }
  }
  return words;
}

// ---- the application's painter and codecs ----------------------------------------------------------------

type Context2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

function context2d(w: number, h: number): { canvas: OffscreenCanvas | HTMLCanvasElement; ctx: Context2D } {
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(Math.max(1, w), Math.max(1, h)) : Object.assign(document.createElement('canvas'), { width: Math.max(1, w), height: Math.max(1, h) });
  const ctx = canvas.getContext('2d') as Context2D | null;
  if (!ctx) throw pictureFailed();
  return { canvas, ctx };
}

const REPLACEMENT_FONT = '"Arial", "Helvetica", sans-serif';

/** The application's codecs: zlib through CompressionStream, JPEG 0.85 through a canvas. */
export function browserCodecs(): PictureCodecs {
  return {
    deflate: (samples) => deflateInBrowser(samples),
    async jpeg(px) {
      const { canvas, ctx } = context2d(px.width, px.height);
      try {
        const image = ctx.createImageData(px.width, px.height);
        image.data.set(px.data);
        ctx.putImageData(image, 0, 0);
        return await blobBytes(await canvasToBlob(canvas, 'image/jpeg', JPEG_QUALITY));
      } finally {
        canvas.width = 0;
        canvas.height = 0;
      }
    },
  };
}

/** White bold Arial on black, measured and drawn with a canvas (the application's TextPainter). */
export function canvasPainter(): TextPainter {
  const measuring = context2d(8, 8).ctx;
  measuring.font = `bold 100px ${REPLACEMENT_FONT}`;
  return {
    advance: (text) => measuring.measureText(text).width / 100,
    paint(text, sizePx, w, h, angle) {
      const { canvas, ctx } = context2d(w, h);
      try {
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = '#ffffff';
        ctx.font = `bold ${sizePx}px ${REPLACEMENT_FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.translate(w / 2, h / 2);
        ctx.rotate((-angle * Math.PI) / 180);
        ctx.fillText(text, 0, 0);
        return ctx.getImageData(0, 0, w, h).data;
      } finally {
        canvas.width = 0;
        canvas.height = 0;
      }
    },
  };
}
