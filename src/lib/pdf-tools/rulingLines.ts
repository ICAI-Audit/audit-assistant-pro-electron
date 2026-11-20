// The straight lines a page draws, for finding tables drawn with lines (PDF to Excel, PDF to Word;
// design 5.11 and section 13). Read from the page's own content, never from a picture of it.
//
// COORDINATES. Segments are in display coordinates, as layout.ts: points, origin at the top-left corner
// of the page as it is shown after /Rotate (within the crop box), y growing downwards.
//
// What is read (pageDrawings): besides the lines, the page's filled boxes, the boxes its pictures take, and
// where each run of text starts with its font and colour, and whether it is invisible (text rendering mode 3, `Tr`:
// neither filled nor stroked, as a recognition layer over a scan writes its words). The renderer's text content does
// not say which text is invisible (pdf.js 5.4.296 getTextContent has no case for the operator), so it is read here.
//
// Lines: stroked paths (`m`, `l`, `h`, `re` painted by S, s, B, B*, b, b*), each straight piece a
// segment; and filled rectangles no thicker than 1.5 pt (a line drawn as a thin box), as their centre
// line. The matrix (`cm`, with `q` and `Q`) is tracked; forms drawn on the page (`Do`) are read one
// level deep. Only pieces that run across or down the page as shown are kept: a table has no others.
// Curves, fat filled boxes (shading), clipping paths and anything inside a form inside a form are
// left out. A page whose content cannot be read with certainty gives no segments, so its tables are
// then found from how the text lines up.
import { PDFArray, PDFDict, PDFName, PDFNumber, PDFStream, type PDFDocument, type PDFObject } from 'pdf-lib';
import type { Segment, Stroke } from './layout';
import { fontLook, type FontLook } from './pdfFontLook';
import { decodeStreamBytes, displayedPage, tokenize, type Matrix } from './marks';

/** A filled rectangle this thick or thinner is a line. */
export const THIN_FILL_PT = 1.5;
/** A piece shorter than this is not kept. */
const MIN_PIECE_PT = 1;
/** How far a piece may lean and still count as running across or down the page. */
const STRAIGHT_PT = 0.5;
/** The most content one page's reading takes in (its own and its forms'); past it the page gives no segments. */
const MAX_CONTENT_CHARS = 3_000_000;
/** The most segments a page gives; a page with more is a drawing, and gives none. */
export const MAX_PAGE_SEGMENTS = 20_000;
/** The most forms read on one page. */
const MAX_FORMS = 64;

/**
 * Takes a point of the page's own coordinates (user space) to display coordinates. `view` is the
 * visible box [x0, y0, x1, y1] in user space, `rotate` the page's /Rotate, `unit` its /UserUnit.
 */
export function displayTransform(view: readonly number[], rotate: number, unit = 1): (x: number, y: number) => [number, number] {
  const x0 = Math.min(view[0], view[2]);
  const y0 = Math.min(view[1], view[3]);
  const x1 = Math.max(view[0], view[2]);
  const y1 = Math.max(view[1], view[3]);
  const s = Number.isFinite(unit) && unit > 0 ? unit : 1;
  switch ((((Math.round(rotate / 90) * 90) % 360) + 360) % 360) {
    case 90: return (x, y) => [(y - y0) * s, (x - x0) * s];
    case 180: return (x, y) => [(x1 - x) * s, (y - y0) * s];
    case 270: return (x, y) => [(y1 - y) * s, (x1 - x) * s];
    default: return (x, y) => [(x - x0) * s, (y1 - y) * s];
  }
}

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
/** `a` then `b`. */
const concat = (a: Matrix, b: Matrix): Matrix => [
  a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3],
  a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3],
  a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5],
];

function latin1(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 8192) out += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return out;
}

/** The decoded text of a content stream, or null when it is not a stream or cannot be trusted. */
function streamText(obj: PDFObject | undefined): string | null {
  if (!(obj instanceof PDFStream)) return null;
  const bytes = decodeStreamBytes(obj);
  return bytes === null ? null : latin1(bytes);
}

/** A path under construction: its points in display coordinates, and for each point after the first whether a straight piece leads to it. */
interface Subpath { points: [number, number][]; straight: boolean[]; closed: boolean }

/** A filled box thicker than a line: shading behind cells, a coloured band. `color` is RRGGBB. */
export interface Shade { x0: number; y0: number; x1: number; y1: number; color: string }
/** A picture the page draws, by the box it takes on the page, with the stream that holds it. */
export interface PagePicture { x0: number; y0: number; x1: number; y1: number; image: PDFStream; /** How opaque it is drawn, 0 to 1 (a faint background picture). */ alpha: number }
/** Where a run of text starts (its baseline's first point), with the font it is set in (a key of `fonts`) and its colour (RRGGBB). */
export interface TextStart { x: number; y: number; font: string; color: string; /** The run is invisible text (text rendering mode 3). */ hidden?: true }
/** Everything the conversion tools read from a page's own content besides its words. */
export interface PageDrawings {
  segments: Segment[];
  /** Straight strokes that run neither across nor down the page (a drawn tick or cross, a slanted line), from their first point to their last. */
  strokes: Stroke[];
  shades: Shade[];
  pictures: PagePicture[];
  starts: TextStart[];
  fonts: Map<string, FontLook>;
  /** The page shows text that is invisible (text rendering mode 3): 'all' when every piece of text it shows is, 'some' when only part is. Absent: none. */
  hiddenText?: 'all' | 'some';
}

/** The most slanted strokes one page gives, and the shortest that counts. */
const MAX_STROKES = 2000;
const MIN_STROKE_PT = 1.5;
/** The most shaded boxes, pictures and text starts one page gives. */
const MAX_SHADES = 4000;
const MAX_PICTURES = 64;
const MAX_STARTS = 60_000;

interface Reading {
  out: Segment[];
  strokes: Stroke[];
  shades: Shade[];
  pictures: PagePicture[];
  starts: TextStart[];
  fontKeys: Set<string>;
  fontDicts: Map<string, PDFDict>;
  /** How many pieces of text the page shows, and how many of them invisibly. */
  shows: number;
  hiddenShows: number;
  place: (x: number, y: number) => [number, number];
  unit: number;
  chars: number;
  forms: number;
  /** Too much to read, or too many segments: the page gives none. */
  gaveUp: boolean;
}

/** The graphics state as far as it is followed: the matrix, the two colours (RRGGBB) and the line width. */
interface State { ctm: Matrix; fill: string; stroke: string; lineWidth: number; alpha: number; fillInk?: Ink | null; strokeInk?: Ink | null; /** Text is shown invisibly (text rendering mode 3). */ hidden?: boolean }

/**
 * A colour space with one ink of its own (a separation): what a tint of it stands for. `ends` are the colours of
 * no ink and of full ink in a device space (1, 3 or 4 values) with the power the tint is raised to; 'grey' when
 * that cannot be worked out (full ink is then dark); 'keep' for a space whose values say nothing here (an index
 * into a palette, the ink "None"): the colour stays as it was.
 */
type Ink = { c0: number[]; c1: number[]; n: number } | 'grey' | 'keep';

const numbersOf = (value: unknown): number[] | null => {
  if (!(value instanceof PDFArray)) return null;
  const out: number[] = [];
  for (let i = 0; i < value.size(); i++) {
    const v = value.lookup(i);
    if (!(v instanceof PDFNumber)) return null;
    out.push(v.asNumber());
  }
  return out;
};

/** The ink of the colour space named in a `cs` operator, or null for a space read by its number of values (grey, red-green-blue, cyan-magenta-yellow-black). */
function inkOf(name: string, resources: PDFDict | undefined): Ink | null {
  const spaces = resources?.lookup(PDFName.of('ColorSpace'));
  const space = name !== '' && spaces instanceof PDFDict ? spaces.lookup(PDFName.of(decodeName(name))) : undefined;
  if (!(space instanceof PDFArray) || space.size() < 2) return null;
  const kind = space.lookup(0);
  const kindName = kind instanceof PDFName ? kind.decodeText() : '';
  if (kindName === 'Indexed') return 'keep';
  if (kindName !== 'Separation' && kindName !== 'DeviceN') return null;
  const inks = space.lookup(1);
  if (kindName === 'DeviceN' && !(inks instanceof PDFArray && inks.size() === 1)) return null;
  const inkName = inks instanceof PDFName ? inks.decodeText() : '';
  if (inkName === 'None') return 'keep';
  const tint = space.size() > 3 ? space.lookup(3) : undefined;
  const dict = tint instanceof PDFStream ? tint.dict : tint instanceof PDFDict ? tint : undefined;
  const type = dict?.lookup(PDFName.of('FunctionType'));
  if (!dict || !(type instanceof PDFNumber) || type.asNumber() !== 2) return 'grey';
  const power = dict.lookup(PDFName.of('N'));
  const c1 = numbersOf(dict.lookup(PDFName.of('C1')));
  const c0 = numbersOf(dict.lookup(PDFName.of('C0'))) ?? (c1 ? c1.map(() => 0) : null);
  if (!c0 || !c1 || c0.length !== c1.length || ![1, 3, 4].includes(c0.length)) return 'grey';
  return { c0, c1, n: power instanceof PDFNumber && power.asNumber() > 0 ? power.asNumber() : 1 };
}

/** The colour of a tint of an ink (see Ink), or of device values when there is no ink. */
function inkColor(ink: Ink | null | undefined, values: readonly number[], was: string): string {
  if (!ink) return colorOf(values, was);
  if (ink === 'keep' || values.length === 0) return was;
  const t = Math.max(0, Math.min(1, values[values.length - 1]));
  if (ink === 'grey') return colorOf([1 - t], was);
  const share = Math.pow(t, ink.n);
  return colorOf(ink.c0.map((c, i) => c + share * (ink.c1[i] - c)), was);
}

const hex2 = (v: number): string => Math.max(0, Math.min(255, Math.round(v * 255))).toString(16).padStart(2, '0').toUpperCase();
/** A colour from its operands: one is grey, three red-green-blue, four cyan-magenta-yellow-black; anything else keeps `was`. */
function colorOf(values: readonly number[], was: string): string {
  if (values.length === 1) return hex2(values[0]).repeat(3);
  if (values.length === 3) return hex2(values[0]) + hex2(values[1]) + hex2(values[2]);
  if (values.length === 4) return hex2((1 - values[0]) * (1 - values[3])) + hex2((1 - values[1]) * (1 - values[3])) + hex2((1 - values[2]) * (1 - values[3]));
  return was;
}

function keep(reading: Reading, a: readonly [number, number], b: readonly [number, number], color: string, width: number): void {
  const dx = Math.abs(a[0] - b[0]);
  const dy = Math.abs(a[1] - b[1]);
  if (!Number.isFinite(dx + dy) || Math.max(dx, dy) < MIN_PIECE_PT || Math.min(dx, dy) > STRAIGHT_PT) return;
  if (reading.out.length >= MAX_PAGE_SEGMENTS) {
    reading.gaveUp = true;
    return;
  }
  reading.out.push({ x0: Math.min(a[0], b[0]), y0: Math.min(a[1], b[1]), x1: Math.max(a[0], b[0]), y1: Math.max(a[1], b[1]), color, width });
}

function strokePath(reading: Reading, path: readonly Subpath[], close: boolean, state: State): void {
  const width = state.lineWidth * Math.sqrt(Math.abs(state.ctm[0] * state.ctm[3] - state.ctm[1] * state.ctm[2])) * reading.unit;
  for (const sub of path) {
    for (let i = 1; i < sub.points.length; i++) {
      if (!sub.straight[i]) continue;
      const a = sub.points[i - 1];
      const b = sub.points[i];
      keep(reading, a, b, state.stroke, width);
      // A stroke that runs neither across nor down the page: kept by its two ends.
      const dx = Math.abs(a[0] - b[0]);
      const dy = Math.abs(a[1] - b[1]);
      if (Number.isFinite(dx + dy) && Math.min(dx, dy) > STRAIGHT_PT && Math.hypot(dx, dy) >= MIN_STROKE_PT && reading.strokes.length < MAX_STROKES) reading.strokes.push({ x0: a[0], y0: a[1], x1: b[0], y1: b[1], color: state.stroke, width });
    }
    if ((sub.closed || close) && sub.points.length > 2) keep(reading, sub.points[sub.points.length - 1], sub.points[0], state.stroke, width);
  }
}

/**
 * A filled subpath that is a rectangle along the page's axes (its four corners, with or without further
 * points along its sides): its centre line when it is no thicker than THIN_FILL_PT, else a shaded box.
 */
function fillPath(reading: Reading, path: readonly Subpath[], color: string): void {
  for (const sub of path) {
    if (sub.points.length < 4 || sub.points.length > 16 || sub.straight.some((s, i) => i > 0 && !s)) continue;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of sub.points) {
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    const atX = (x: number) => Math.abs(x - x0) < 0.05 || Math.abs(x - x1) < 0.05;
    const atY = (y: number) => Math.abs(y - y0) < 0.05 || Math.abs(y - y1) < 0.05;
    if (!sub.points.every(([x, y]) => atX(x) || atY(y))) continue;
    // All four corners are among its points: a rectangle, not a diamond standing on the box's sides.
    const corners = new Set(sub.points.filter(([x, y]) => atX(x) && atY(y)).map(([x, y]) => (Math.abs(x - x0) < 0.05 ? 0 : 1) + (Math.abs(y - y0) < 0.05 ? 0 : 2)));
    const w = x1 - x0;
    const h = y1 - y0;
    // A box thinner than the tolerance has its corners together: it is a line all the same.
    if (corners.size < 4 && Math.min(w, h) >= 0.1) continue;
    if (h <= THIN_FILL_PT && w > h) keep(reading, [x0, (y0 + y1) / 2], [x1, (y0 + y1) / 2], color, h);
    else if (w <= THIN_FILL_PT && h > w) keep(reading, [(x0 + x1) / 2, y0], [(x0 + x1) / 2, y1], color, w);
    else if (w > THIN_FILL_PT && h > THIN_FILL_PT && reading.shades.length < MAX_SHADES) reading.shades.push({ x0, y0, x1, y1, color });
  }
}

const STROKES = new Set(['S', 's', 'B', 'B*', 'b', 'b*']);
const FILLS = new Set(['f', 'F', 'f*', 'B', 'B*', 'b', 'b*']);
const CLOSES = new Set(['s', 'b', 'b*']);

/** The key of a font of the resources in force (its reference, or its name when it is written in place), remembered with its dictionary. */
function fontKey(reading: Reading, name: string, resources: PDFDict | undefined): string {
  const fonts = resources?.lookup(PDFName.of('Font'));
  if (!(fonts instanceof PDFDict)) return '';
  const at = PDFName.of(decodeName(name));
  const raw = fonts.get(at);
  const dict = fonts.lookup(at);
  if (!raw || !(dict instanceof PDFDict)) return '';
  const key = raw instanceof PDFDict ? `in:${name}:${reading.forms}` : raw.toString();
  if (!reading.fontDicts.has(key)) reading.fontDicts.set(key, dict);
  return key;
}

/** Reads one content stream's text. `base` takes its coordinates to the page's; `depth` is 0 for the page, 1 for a form on it. */
function walk(reading: Reading, text: string, base: Matrix, resources: PDFDict | undefined, depth: number, from?: State): void {
  let state: State = { ctm: base, fill: from?.fill ?? '000000', stroke: from?.stroke ?? '000000', lineWidth: from?.lineWidth ?? 1, alpha: from?.alpha ?? 1, ...(from?.hidden ? { hidden: true } : {}) };
  const stack: State[] = [];
  let nums: number[] = [];
  let name = '';
  let path: Subpath[] = [];
  // Text: the matrix of the text and of its line, the leading, the font, and whether the next run starts at a place set for it.
  let tm: Matrix = IDENTITY;
  let tlm: Matrix = IDENTITY;
  let leading = 0;
  let font = '';
  let placed = false;
  const point = (x: number, y: number): [number, number] => reading.place(state.ctm[0] * x + state.ctm[2] * y + state.ctm[4], state.ctm[1] * x + state.ctm[3] * y + state.ctm[5]);
  const current = (): Subpath | undefined => path[path.length - 1];
  const move = (tx: number, ty: number) => {
    tlm = concat([1, 0, 0, 1, tx, ty], tlm);
    tm = tlm;
    placed = true;
  };
  const show = () => {
    reading.shows++;
    if (state.hidden) reading.hiddenShows++;
    if (placed && reading.starts.length < MAX_STARTS) {
      const [x, y] = point(tm[4], tm[5]);
      if (Number.isFinite(x + y)) reading.starts.push({ x, y, font, color: state.fill, ...(state.hidden ? { hidden: true as const } : {}) });
      if (font) reading.fontKeys.add(font);
    }
    placed = false;
  };
  tokenize(text, (t) => {
    if (reading.gaveUp) return;
    if (t.k === 'num') {
      nums.push(t.v);
      return;
    }
    if (t.k === 'name') {
      name = t.v;
      return;
    }
    if (t.k !== 'op') return;
    const n = nums.length;
    switch (t.v) {
      case 'q':
        if (stack.length < 256) stack.push(state);
        break;
      case 'Q':
        state = stack.pop() ?? state;
        break;
      case 'cm':
        if (n >= 6) state = { ...state, ctm: concat(nums.slice(n - 6) as Matrix, state.ctm) };
        break;
      case 'w':
        if (n >= 1) state = { ...state, lineWidth: nums[n - 1] };
        break;
      case 'gs': {
        // The opacity things are filled with (a faint picture behind the text).
        const states = resources?.lookup(PDFName.of('ExtGState'));
        const named = name !== '' && states instanceof PDFDict ? states.lookup(PDFName.of(decodeName(name))) : undefined;
        const ca = named instanceof PDFDict ? named.lookup(PDFName.of('ca')) : undefined;
        if (ca instanceof PDFNumber) state = { ...state, alpha: Math.max(0, Math.min(1, ca.asNumber())) };
        break;
      }
      case 'g':
      case 'rg':
      case 'k':
        state = { ...state, fill: colorOf(nums, state.fill), fillInk: null };
        break;
      case 'G':
      case 'RG':
      case 'K':
        state = { ...state, stroke: colorOf(nums, state.stroke), strokeInk: null };
        break;
      case 'cs': {
        // A colour space of one ink starts at its full tint.
        const ink = inkOf(name, resources);
        state = { ...state, fillInk: ink, fill: ink ? inkColor(ink, [1], state.fill) : state.fill };
        break;
      }
      case 'CS': {
        const ink = inkOf(name, resources);
        state = { ...state, strokeInk: ink, stroke: ink ? inkColor(ink, [1], state.stroke) : state.stroke };
        break;
      }
      case 'sc':
      case 'scn':
        // With a name it is a pattern: the colour stays as it was.
        if (name === '') state = { ...state, fill: inkColor(state.fillInk, nums, state.fill) };
        break;
      case 'SC':
      case 'SCN':
        if (name === '') state = { ...state, stroke: inkColor(state.strokeInk, nums, state.stroke) };
        break;
      case 'BT':
        tm = tlm = IDENTITY;
        placed = true;
        break;
      case 'Tf':
        if (name !== '') font = fontKey(reading, name, resources);
        break;
      case 'TL':
        if (n >= 1) leading = nums[n - 1];
        break;
      case 'Tr':
        // Mode 3 shows nothing of the text. (Kept with the graphics state: `q` and `Q` save and restore it.)
        if (n >= 1) state = { ...state, hidden: nums[n - 1] === 3 };
        break;
      case 'Td':
        if (n >= 2) move(nums[n - 2], nums[n - 1]);
        break;
      case 'TD':
        if (n >= 2) {
          leading = -nums[n - 1];
          move(nums[n - 2], nums[n - 1]);
        }
        break;
      case 'Tm':
        if (n >= 6) {
          tm = tlm = nums.slice(n - 6) as Matrix;
          placed = true;
        }
        break;
      case 'T*':
        move(0, -leading);
        break;
      case "'":
      case '"':
        move(0, -leading);
        show();
        break;
      case 'Tj':
      case 'TJ':
        show();
        break;
      case 'm':
        if (n >= 2) path.push({ points: [point(nums[n - 2], nums[n - 1])], straight: [false], closed: false });
        break;
      case 'l': {
        const sub = current();
        if (n >= 2 && sub && !sub.closed) {
          sub.points.push(point(nums[n - 2], nums[n - 1]));
          sub.straight.push(true);
        }
        break;
      }
      case 'c':
      case 'v':
      case 'y': {
        const sub = current();
        if (n >= 2 && sub && !sub.closed) {
          sub.points.push(point(nums[n - 2], nums[n - 1]));
          sub.straight.push(false);
        }
        break;
      }
      case 'h': {
        const sub = current();
        if (sub) sub.closed = true;
        break;
      }
      case 're':
        if (n >= 4) {
          const [x, y, w, h] = nums.slice(n - 4);
          path.push({ points: [point(x, y), point(x + w, y), point(x + w, y + h), point(x, y + h)], straight: [false, true, true, true], closed: true });
        }
        break;
      case 'n':
        path = [];
        break;
      case 'Do':
        if (name !== '') drawObject(reading, name, state, resources, depth);
        break;
      default:
        if (STROKES.has(t.v) || FILLS.has(t.v)) {
          if (STROKES.has(t.v)) strokePath(reading, path, CLOSES.has(t.v), state);
          if (FILLS.has(t.v)) fillPath(reading, path, state.fill);
          path = [];
        }
    }
    nums = [];
    name = '';
  });
}

function decodeName(n: string): string {
  return n.replace(/#([0-9a-fA-F]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
}

/** A picture is noted by the box it takes; a form's content is read (one level deep). */
function drawObject(reading: Reading, name: string, state: State, resources: PDFDict | undefined, depth: number): void {
  const ctm = state.ctm;
  const xobjects = resources?.lookup(PDFName.of('XObject'));
  if (!(xobjects instanceof PDFDict)) return;
  const form = xobjects.lookup(PDFName.of(decodeName(name)));
  if (!(form instanceof PDFStream)) return;
  const subtype = form.dict.lookup(PDFName.of('Subtype'));
  if (subtype === PDFName.of('Image')) {
    if (reading.pictures.length >= MAX_PICTURES) return;
    const corners = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([x, y]) => reading.place(ctm[0] * x + ctm[2] * y + ctm[4], ctm[1] * x + ctm[3] * y + ctm[5]));
    const xs = corners.map((p) => p[0]);
    const ys = corners.map((p) => p[1]);
    const box = { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
    if (Number.isFinite(box.x0 + box.y0 + box.x1 + box.y1) && box.x1 - box.x0 >= 2 && box.y1 - box.y0 >= 2) reading.pictures.push({ ...box, image: form, alpha: state.alpha });
    return;
  }
  if (depth >= 1 || subtype !== PDFName.of('Form')) return;
  if (reading.forms++ >= MAX_FORMS) return;
  const text = streamText(form);
  if (text === null) return;
  reading.chars += text.length;
  if (reading.chars > MAX_CONTENT_CHARS) {
    reading.gaveUp = true;
    return;
  }
  const m = form.dict.lookup(PDFName.of('Matrix'));
  let matrix = IDENTITY;
  if (m instanceof PDFArray && m.size() === 6) {
    const values = m.asArray().map((v) => {
      const value = form.dict.context.lookup(v);
      return value instanceof PDFNumber ? value.asNumber() : NaN;
    });
    if (values.every(Number.isFinite)) matrix = values as Matrix;
  }
  const own = form.dict.lookup(PDFName.of('Resources'));
  walk(reading, text, concat(matrix, ctm), own instanceof PDFDict ? own : resources, depth + 1, state);
}

/** Each document's fonts as they look, read once. */
const LOOKS = new WeakMap<PDFDocument, Map<string, FontLook>>();

const NOTHING = (): PageDrawings => ({ segments: [], strokes: [], shades: [], pictures: [], starts: [], fonts: new Map() });

/**
 * What page `pageIndex` (0-based) draws besides its words, in display coordinates: its straight lines
 * (each with x0 <= x1 and y0 <= y1, its colour and its weight), its filled boxes, its pictures' boxes, and
 * where each run of text starts with its font and colour. Empty when the page's content cannot be read with
 * certainty, or when it is a drawing of more than MAX_PAGE_SEGMENTS pieces. Never throws for a page of the
 * document; synchronous (one page's content is read in one go).
 */
export function pageDrawings(doc: PDFDocument, pageIndex: number): PageDrawings {
  try {
    if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= doc.getPageCount()) return NOTHING();
    const page = doc.getPage(pageIndex);
    const shown = displayedPage(page);
    const { x, y, width, height } = shown.box;
    const context = page.node.context;
    const raw = page.node.get(PDFName.of('Contents'));
    const contents = raw ? context.lookup(raw) : undefined;
    const parts = contents instanceof PDFArray ? contents.asArray().map((part) => context.lookup(part)) : contents ? [contents] : [];
    const texts: string[] = [];
    let chars = 0;
    for (const part of parts) {
      const text = streamText(part);
      if (text === null) return NOTHING();
      chars += text.length;
      if (chars > MAX_CONTENT_CHARS) return NOTHING();
      texts.push(text);
    }
    const unit = shown.unit ?? 1;
    const reading: Reading = {
      out: [], strokes: [], shades: [], pictures: [], starts: [], fontKeys: new Set(), fontDicts: new Map(), shows: 0, hiddenShows: 0,
      place: displayTransform([x, y, x + width, y + height], shown.rotation, unit), unit, chars, forms: 0, gaveUp: false,
    };
    walk(reading, texts.join('\n'), IDENTITY, page.node.Resources(), 0);
    if (reading.gaveUp) return NOTHING();
    let looks = LOOKS.get(doc);
    if (!looks) LOOKS.set(doc, (looks = new Map()));
    const fonts = new Map<string, FontLook>();
    for (const key of reading.fontKeys) {
      let look = looks.get(key);
      const dict = reading.fontDicts.get(key);
      if (!look && dict) looks.set(key, (look = fontLook(dict)));
      if (look) fonts.set(key, look);
    }
    const hiddenText = reading.hiddenShows === 0 ? undefined : reading.hiddenShows === reading.shows ? ('all' as const) : ('some' as const);
    return { segments: reading.out, strokes: reading.strokes, shades: reading.shades, pictures: reading.pictures, starts: reading.starts, fonts, ...(hiddenText ? { hiddenText } : {}) };
  } catch {
    // A page built in a way this reading does not expect: its tables are found from the text instead.
    return NOTHING();
  }
}

/**
 * The straight lines page `pageIndex` (0-based) draws across or down the page, in display coordinates,
 * each with x0 <= x1 and y0 <= y1. Empty when the page draws none, when its content cannot be read with
 * certainty, or when it is a drawing of more than MAX_PAGE_SEGMENTS pieces. Never throws for a page of
 * the document; synchronous (one page's content is read in one go).
 */
export function pageSegments(doc: PDFDocument, pageIndex: number): Segment[] {
  return pageDrawings(doc, pageIndex).segments;
}
