// Resize or crop pages (owner decision, 15 November 2026): every chosen page becomes one paper size with
// its content scaled to fit and centred, or loses some of its edges, or gains a white margin.
//
// How a page is changed (the rules of marks.ts, which draws on pages the same careful way):
// - Resize: the page's own content is never re-encoded. `/Contents` becomes
//   [ours: q, a scale-and-move `cm`, a clip to the old visible box, a `q` per stray `Q`; ...the original
//   streams...; ours: what the content leaves open (ET, n, EMC), then the `Q`s]. The new box is in real
//   points (a /UserUnit is folded into the scale and dropped), and the page keeps its own /Rotate, so the
//   transform is always an upright, uniform scale plus a move: every coordinate that points into the page
//   (annotations, links, bookmarks, named destinations, the opening view, article beads) is moved by the
//   same numbers. Patterns are drawn in the page's own space, not in the space of the drawing, so the
//   page's patterns get copies whose /Matrix carries the same transform.
// - Trim: only the page's boxes change (MediaBox = CropBox = the smaller box). Trimmed parts are hidden,
//   not removed: their text and pictures stay in the file.
// - Add a margin: the boxes grow, and the content is clipped to the old visible box (wrapped as above,
//   without a scale), so that nothing the page hid before shows in the new margin.
// - Every changed page loses its print-production boxes (Bleed, Trim, Art: they describe the old page)
//   and its stored thumbnail (a picture of the old page). Everything else in the file is kept.
// - Never keep too little: what cannot be moved exactly is kept and flagged in the report.
import { PDFArray, PDFDict, PDFHexString, PDFName, PDFNumber, PDFRef, PDFStream, PDFString, type PDFContext, type PDFDocument, type PDFObject, type PDFPage } from 'pdf-lib';
import { decodeStreamBytes, displayedPage, pageListedTwice, PRODUCER, readerMatrix, tokenize, type Box, type DisplayedPage, type Matrix } from './marks';
import { isStop, loadPaced, pacer, savePaced, type Pace } from './pace';
import { PdfToolsError } from './types';

// ---- options -------------------------------------------------------------------------------------

/** Points in a millimetre. */
export const PT_PER_MM = 72 / 25.4;

export type PaperName = 'a4' | 'a3' | 'a5' | 'letter' | 'legal';
/** The paper sizes offered, portrait, in points (the values pdf-lib and the other tools use). */
export const PAPERS: Readonly<Record<PaperName, { label: string; widthMm: number; heightMm: number; width: number; height: number }>> = {
  a4: { label: 'A4', widthMm: 210, heightMm: 297, width: 595.28, height: 841.89 },
  a3: { label: 'A3', widthMm: 297, heightMm: 420, width: 841.89, height: 1190.55 },
  a5: { label: 'A5', widthMm: 148, heightMm: 210, width: 419.53, height: 595.28 },
  letter: { label: 'Letter', widthMm: 215.9, heightMm: 279.4, width: 612, height: 792 },
  legal: { label: 'Legal', widthMm: 215.9, heightMm: 355.6, width: 612, height: 1008 },
};

export interface PageRange { from: number; to: number }
/** Distances in points from each edge of the page as the reader sees it. */
export interface Sides { left: number; top: number; right: number; bottom: number }
export type Direction = 'keep' | 'portrait' | 'landscape';

export type PageBoxOptions =
  | {
      mode: 'resize';
      /** The paper, in points; its own direction does not matter (`direction` decides). */
      size: { width: number; height: number };
      /** 'keep': a landscape page becomes the paper landscape; otherwise every page is turned the one way. */
      direction: Direction;
      /** False: a page smaller than the paper keeps its size (centred) instead of being enlarged. */
      enlarge: boolean;
      /** Space kept clear around the content, in points. With a margin, pages already that size are fitted too. */
      margin: number;
      pages: PageRange;
    }
  | { mode: 'trim'; sides: Sides; /** On even pages left and right swap (pages printed on both sides). */ mirror: boolean; pages: PageRange }
  | { mode: 'margin'; sides: Sides; mirror: boolean; pages: PageRange };

/** A page within this much of the paper (each way) is already that size and is left as it is. */
export const SAME_SIZE_PT = PT_PER_MM;
/** The least a page or its content may keep each way: 10 mm. */
export const MIN_SIDE_PT = 10 * PT_PER_MM;
/** The largest page a PDF may have (14,400 units, 200 inches: 5,080 mm). */
export const MAX_SIDE_PT = 14_400;
/** The widest margin that can be added to one edge. */
export const MAX_ADD_PT = 500 * PT_PER_MM;

const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const sidesOf = (s: Sides | undefined): number[] => (s ? [s.left, s.top, s.right, s.bottom] : []);

/** The first thing wrong with the options, in the words the dialog shows, or null. Page-specific limits are checked per page. */
export function pageBoxError(options: PageBoxOptions, pageCount: number): string | null {
  const mode = (options as { mode?: unknown })?.mode;
  if (mode !== 'resize' && mode !== 'trim' && mode !== 'margin') return 'Choose whether to resize the pages or to trim or add margins.';
  const { pages } = options;
  if (!pages || !Number.isInteger(pages.from) || !Number.isInteger(pages.to) || pages.from < 1 || pages.to > pageCount || pages.from > pages.to) {
    return `Enter a page range between 1 and ${pageCount}, with the first page not after the last.`;
  }
  if (options.mode === 'resize') {
    const { width, height } = options.size ?? { width: Number.NaN, height: Number.NaN };
    if (![width, height].every((v) => finite(v) && v >= MIN_SIDE_PT - 1e-6 && v <= MAX_SIDE_PT + 1e-6)) return 'Enter a page width and height from 10 to 5,080 mm.';
    if (!['keep', 'portrait', 'landscape'].includes(options.direction)) return 'Choose whether pages keep their direction or all become portrait or landscape.';
    if (typeof options.enlarge !== 'boolean') return 'Choose whether small pages are enlarged.';
    if (!finite(options.margin) || options.margin < 0) return 'Enter a margin of 0 mm or more.';
    if (Math.min(width, height) - 2 * options.margin < MIN_SIDE_PT - 1e-6) return 'The margin leaves less than 10 mm for the page content. Use a smaller margin.';
    return null;
  }
  const values = sidesOf(options.sides);
  if (values.length !== 4 || !values.every((v) => finite(v) && v >= 0)) return 'Enter edges of 0 mm or more.';
  if (typeof options.mirror !== 'boolean') return 'Choose whether left and right are mirrored on even pages.';
  if (options.mode === 'trim') return values.some((v) => v > 0) ? null : 'Enter how much to trim from at least one edge.';
  if (!values.some((v) => v > 0)) return 'Enter the width of the margin for at least one edge.';
  return values.every((v) => v <= MAX_ADD_PT + 1e-6) ? null : 'Enter a margin of at most 500 mm on each edge.';
}

function invalid(message: string): PdfToolsError {
  return new PdfToolsError('invalid-page-box-options', message);
}

// ---- geometry of one page --------------------------------------------------------------------------

export type PagePlan =
  | { kind: 'keep' }
  | {
      kind: 'change';
      /** The new MediaBox and CropBox, in the page's (new) own coordinates. */
      box: Box;
      /** Old own coordinates to new ones (resize only): always [k, 0, 0, k, e, f]. */
      matrix: Matrix | null;
      /** The old visible box, in the old own coordinates: the content is clipped to it (resize, margin). */
      clip: Box | null;
      /** The new box is in real points: /UserUnit goes (resize). */
      dropUserUnit: boolean;
    };

/** a then b (row vectors, as PDF writes matrices). */
export const concat = (a: Matrix, b: Matrix): Matrix => [
  a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3],
  a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3],
  a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5],
];
function invert(m: Matrix): Matrix {
  const det = m[0] * m[3] - m[1] * m[2];
  return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det];
}
/** Snaps the tiny leftovers of turning by 90 degrees to 0, so the matrix is exactly upright. */
const tidy = (m: Matrix): Matrix => m.map((v) => (Math.abs(v) < 1e-9 ? 0 : v)) as unknown as Matrix;
const apply = (m: Matrix, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/** The box in the page's own coordinates of a rectangle given in the reader frame (u right, v up, real points). */
function ownBox(d: DisplayedPage, u0: number, v0: number, u1: number, v1: number): Box {
  const m = readerMatrix(d);
  const [ax, ay] = apply(m, u0, v0);
  const [bx, by] = apply(m, u1, v1);
  const r = (v: number) => Math.round(v * 10000) / 10000;
  return { x: r(Math.min(ax, bx)), y: r(Math.min(ay, by)), width: r(Math.abs(bx - ax)), height: r(Math.abs(by - ay)) };
}

/** The edges for page `n`: on even pages left and right swap when mirrored. */
function sidesFor(options: { sides: Sides; mirror: boolean }, n: number): Sides {
  const s = options.sides;
  return options.mirror && n % 2 === 0 ? { left: s.right, top: s.top, right: s.left, bottom: s.bottom } : s;
}

/**
 * What happens to page `n`, shown as `d`: kept as it is, or its new box and how its content moves.
 * Throws (naming the page) when a trim leaves less than 10 mm or a margin makes a page larger than a PDF allows.
 */
export function planPage(d: DisplayedPage, options: PageBoxOptions, n: number): PagePlan {
  if (!(d.width > 0 && d.height > 0)) throw invalid(`Page ${n} has no size, so it cannot be changed. The file may be damaged.`);
  if (options.mode === 'resize') {
    const long = Math.max(options.size.width, options.size.height);
    const short = Math.min(options.size.width, options.size.height);
    const landscape = options.direction === 'landscape' || (options.direction === 'keep' && d.width > d.height);
    const tw = landscape ? long : short;
    const th = landscape ? short : long;
    const m = options.margin;
    if (m === 0 && Math.abs(d.width - tw) <= SAME_SIZE_PT && Math.abs(d.height - th) <= SAME_SIZE_PT) return { kind: 'keep' };
    let s = Math.min((tw - 2 * m) / d.width, (th - 2 * m) / d.height);
    if (!options.enlarge) s = Math.min(1, s);
    const sideways = d.rotation === 90 || d.rotation === 270;
    const box: Box = { x: 0, y: 0, width: sideways ? th : tw, height: sideways ? tw : th };
    const after: DisplayedPage = { box, rotation: d.rotation, unit: 1, width: tw, height: th };
    // Own coordinates -> reader frame (real points) -> scaled and centred -> the new page's own coordinates.
    const place: Matrix = [s, 0, 0, s, (tw - s * d.width) / 2, (th - s * d.height) / 2];
    const matrix = tidy(concat(concat(invert(readerMatrix(d)), place), readerMatrix(after)));
    return { kind: 'change', box, matrix, clip: d.box, dropUserUnit: true };
  }
  const e = sidesFor(options, n);
  if (options.mode === 'trim') {
    if (d.width - e.left - e.right < MIN_SIDE_PT - 1e-6 || d.height - e.top - e.bottom < MIN_SIDE_PT - 1e-6) {
      throw invalid(`Trimming that much leaves less than 10 mm of page ${n}. Use smaller values.`);
    }
    return { kind: 'change', box: ownBox(d, e.left, e.bottom, d.width - e.right, d.height - e.top), matrix: null, clip: null, dropUserUnit: false };
  }
  if (d.width + e.left + e.right > MAX_SIDE_PT + 1e-6 || d.height + e.top + e.bottom > MAX_SIDE_PT + 1e-6) {
    throw invalid(`Page ${n} would be larger than 5,080 mm, the largest page a PDF can have. Use a smaller margin.`);
  }
  return { kind: 'change', box: ownBox(d, -e.left, -e.bottom, d.width + e.right, d.height + e.top), matrix: null, clip: d.box, dropUserUnit: false };
}

// ---- what a run tells its caller -------------------------------------------------------------------

/** What a run did and noticed (1-based page numbers). The dialog decides what to say. */
export interface PageBoxReport {
  /** Pages whose size or edges changed. */
  changed: number[];
  /** Resize: chosen pages already the paper size, left exactly as they were. */
  unchanged: number[];
  /** The page's drawing closes more than it opens: wrapped so nothing escapes, but readers differ on such pages; it may look different. */
  damaged: number[];
  /** The page's drawing could not be read to check it: assumed to be in order. */
  unverified: number[];
  /** Trim: a comment, link or form field lies wholly in a trimmed part: hidden, still in the file. */
  hiddenAnnotations: number[];
  /** Resize: something kept could not be scaled exactly (an annotation of an unknown kind, a measuring scale, a pattern a form inherits). */
  approximate: number[];
}
export interface PageBoxHooks {
  /** Called before each chosen page, and once at the end with done = total; it stops the run by throwing (a Stop). */
  onPage?: (done: number, total: number) => void | Promise<void>;
  /** Called once before the file is written (the longest single step of a large file). */
  onSaving?: () => void | Promise<void>;
  report?: PageBoxReport;
  /** The run's Stop check, asked after each wait while the file is read (pace.ts loadPaced); it stops by throwing, and that error is passed on as it is. */
  check?: () => void;
}
export function emptyPageBoxReport(): PageBoxReport {
  return { changed: [], unchanged: [], damaged: [], unverified: [], hiddenAnnotations: [], approximate: [] };
}

// ---- reading and wrapping the page's own content ----------------------------------------------------

/** What the content leaves open at its end, and how many `Q` it has with nothing to close. */
export interface ContentBalance {
  /** `Q` met at the lowest point with no `q` of the content's own to close (they would pop ours). */
  stray: number;
  /** The depth at the end: `q` minus `Q` (below 0 when strays were met). */
  end: number;
  marked: number;
  inText: boolean;
  pendingPath: boolean;
}

const PAINT = new Set(['f', 'F', 'f*', 'B', 'B*', 'b', 'b*', 'S', 's', 'n']);
const BUILD = new Set(['m', 'l', 'c', 'v', 'y', 're']);

export function contentBalance(text: string): ContentBalance {
  let depth = 0;
  let low = 0;
  let marked = 0;
  let inText = false;
  let pendingPath = false;
  tokenize(text, (t) => {
    if (t.k !== 'op') return;
    const op = t.v;
    if (op === 'q') depth++;
    else if (op === 'Q') low = Math.min(low, --depth);
    else if (op === 'BMC' || op === 'BDC') marked++;
    else if (op === 'EMC') marked = Math.max(0, marked - 1);
    else if (op === 'BT') inText = true;
    else if (op === 'ET') inText = false;
    else if (BUILD.has(op)) pendingPath = true;
    else if (PAINT.has(op)) pendingPath = false;
  });
  return { stray: low < 0 ? -low : 0, end: depth, marked, inText, pendingPath };
}

function latin1(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 8192) out += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return out;
}

function contentParts(page: PDFPage): PDFRef[] {
  const ctx = page.node.context;
  const raw = page.node.get(PDFName.of('Contents'));
  if (!raw) return [];
  const value = ctx.lookup(raw);
  const parts = value instanceof PDFArray ? value.asArray() : [raw];
  return parts.map((p) => (p instanceof PDFRef ? p : ctx.register(p as PDFStream)));
}

/** The decoded content, or null when a stream cannot be trusted (marks.ts decodeStreamBytes). */
function contentText(ctx: PDFContext, parts: PDFRef[]): string | null {
  const texts: string[] = [];
  for (const p of parts) {
    const s = ctx.lookup(p);
    if (!(s instanceof PDFStream)) return null;
    const bytes = decodeStreamBytes(s);
    if (bytes === null) return null;
    texts.push(latin1(bytes));
  }
  return texts.join('\n');
}

/** Numbers as PDF writes them: plain decimals, at most `places` after the point. */
const fmt = (x: number, places = 4): string => {
  const f = 10 ** places;
  const v = Math.round(x * f) / f;
  return String(Object.is(v, -0) ? 0 : v);
};
const box4 = (b: Box) => `${fmt(b.x)} ${fmt(b.y)} ${fmt(b.width)} ${fmt(b.height)}`;

interface RunState {
  doc: PDFDocument;
  ctx: PDFContext;
  /** Our shared streams, by what they say. */
  streams: Map<string, PDFRef>;
  /** Copies of patterns, by pattern and transform; copies of resource dictionaries, by dictionary and transform. */
  patterns: Map<string, PDFRef>;
  resources: Map<string, PDFRef>;
  resourceIds: WeakMap<object, number>;
  nextResourceId: number;
  /** Destination arrays and actions already moved (an object reached twice is moved once). */
  seen: Set<object>;
}

function shared(state: RunState, ops: string): PDFRef {
  let ref = state.streams.get(ops);
  if (!ref) {
    ref = state.ctx.register(state.ctx.flateStream(ops));
    state.streams.set(ops, ref);
  }
  return ref;
}

/**
 * Wraps the page's own content: our `q`, the transform and the clip first, a `q` for each stray `Q` (so a
 * stray pops one of those, never the transform), the original streams untouched, then what closes it all.
 */
function wrapContent(state: RunState, page: PDFPage, matrix: Matrix | null, clip: Box, report: PageBoxReport | undefined, n: number): void {
  const parts = contentParts(page);
  if (parts.length === 0) return;
  const text = contentText(state.ctx, parts);
  const b = text === null ? null : contentBalance(text);
  if (b === null) report?.unverified.push(n);
  else if (b.stray > 0) report?.damaged.push(n);
  const stray = b?.stray ?? 0;
  const open = [
    'q',
    ...(matrix ? [`${fmt(matrix[0], 6)} 0 0 ${fmt(matrix[3], 6)} ${fmt(matrix[4])} ${fmt(matrix[5])} cm`] : []),
    `${box4(clip)} re W n`,
    ...Array.from({ length: stray }, () => 'q'),
  ].join('\n');
  const close = [
    ...(b?.inText ? ['ET'] : []),
    ...(b?.pendingPath ? ['n'] : []),
    ...Array.from({ length: b?.marked ?? 0 }, () => 'EMC'),
    ...Array.from({ length: 1 + stray + (b ? b.end : 0) }, () => 'Q'),
  ].join('\n');
  page.node.set(PDFName.of('Contents'), state.ctx.obj([shared(state, open), ...parts, shared(state, close)]));
}

// ---- moving what points into a resized page ----------------------------------------------------------

/** k and the move of an upright uniform transform. */
interface Move { k: number; e: number; f: number }
const moveOf = (m: Matrix): Move => ({ k: m[0], e: m[4], f: m[5] });
const num = (x: number) => PDFNumber.of(Math.round(x * 10000) / 10000);
const asNumber = (o: PDFObject | undefined): number | null => (o instanceof PDFNumber ? o.asNumber() : null);

/** The numbers of an array (looked up), or null when any is not a number. */
function numbersOf(ctx: PDFContext, obj: PDFObject | undefined): number[] | null {
  const a = ctx.lookup(obj);
  if (!(a instanceof PDFArray)) return null;
  const out: number[] = [];
  for (const x of a.asArray()) {
    const v = asNumber(ctx.lookup(x));
    if (v === null) return null;
    out.push(v);
  }
  return out;
}

const points = (mv: Move, xs: number[]) => xs.map((v, i) => (i % 2 === 0 ? mv.k * v + mv.e : mv.k * v + mv.f));
const rect = (mv: Move, xs: number[]) => {
  const [a, b, c, d] = points(mv, xs);
  return [Math.min(a, c), Math.min(b, d), Math.max(a, c), Math.max(b, d)];
};

/** Sets `key` to a new array of moved points (a new array: one shared with another annotation is not moved twice). */
function movePoints(ctx: PDFContext, dict: PDFDict, key: string, mv: Move, how: 'points' | 'rect' | 'scale'): void {
  const xs = numbersOf(ctx, dict.get(PDFName.of(key)));
  if (!xs || (how === 'rect' && xs.length !== 4)) return;
  const out = how === 'rect' ? rect(mv, xs) : how === 'scale' ? xs.map((v) => v * mv.k) : points(mv, xs);
  dict.set(PDFName.of(key), ctx.obj(out.map(num)));
}

function moveNested(ctx: PDFContext, dict: PDFDict, key: string, mv: Move): void {
  const list = ctx.lookup(dict.get(PDFName.of(key)));
  if (!(list instanceof PDFArray)) return;
  const out = list.asArray().map((inner) => {
    const xs = numbersOf(ctx, inner);
    return xs ? ctx.obj(points(mv, xs).map(num)) : inner;
  });
  dict.set(PDFName.of(key), ctx.obj(out));
}

function scaleNumber(dict: PDFDict, key: string, k: number): void {
  const v = asNumber(dict.context.lookup(dict.get(PDFName.of(key))));
  if (v !== null) dict.set(PDFName.of(key), num(v * k));
}

const textOf = (o: PDFObject | undefined): string | null => (o instanceof PDFString || o instanceof PDFHexString ? o.decodeText() : null);

/** A dictionary entry looked up, when it is an array (or a dictionary); anything else counts as absent, never a throw (REV-A S2). */
function arrayIn(dict: PDFDict, key: string): PDFArray | undefined {
  const value = dict.lookup(PDFName.of(key));
  return value instanceof PDFArray ? value : undefined;
}
function dictIn(dict: PDFDict, key: string): PDFDict | undefined {
  const value = dict.lookup(PDFName.of(key));
  return value instanceof PDFDict ? value : undefined;
}

/** A default appearance with its font size scaled ("/Helv 12 Tf 0 g" -> "/Helv 9.73 Tf 0 g"); 0 (auto) stays 0. */
export function scaleAppearance(da: string, k: number): string {
  return da.replace(/(\/\S+\s+)([+-]?(?:\d+\.?\d*|\.\d+))(\s+Tf)/, (all, font: string, size: string, tf: string) => {
    const v = Number(size);
    return v === 0 ? all : `${font}${fmt(v * k, 2)}${tf}`;
  });
}
/** A rich-text default style with its point sizes scaled ("font: 12pt Helvetica"). */
export const scaleStyle = (ds: string, k: number): string => ds.replace(/(\d+\.?\d*|\.\d+)pt\b/g, (_, v: string) => `${fmt(Number(v) * k, 2)}pt`);

/** The nearest value of an inheritable field entry: the annotation, its parents, then the form's. */
function inherited(ctx: PDFContext, dict: PDFDict, key: string, form: PDFDict | undefined): PDFObject | undefined {
  let at: PDFDict | undefined = dict;
  for (let depth = 0; at && depth < 32; depth++) {
    const v = at.get(PDFName.of(key));
    if (v !== undefined) return ctx.lookup(v);
    const parent = ctx.lookup(at.get(PDFName.of('Parent')));
    at = parent instanceof PDFDict ? parent : undefined;
  }
  const fromForm = form?.get(PDFName.of(key));
  return fromForm === undefined ? undefined : ctx.lookup(fromForm);
}

const KNOWN_KINDS = new Set([
  'Text', 'Link', 'FreeText', 'Line', 'Square', 'Circle', 'Polygon', 'PolyLine', 'Highlight', 'Underline', 'Squiggly', 'StrikeOut',
  'Caret', 'Stamp', 'Ink', 'Popup', 'FileAttachment', 'Sound', 'Movie', 'Screen', 'Widget', 'PrinterMark', 'TrapNet', 'Watermark',
  '3D', 'Redact', 'Projection', 'RichMedia',
]);

/**
 * Moves one annotation with its page's content: its box and every point it holds, its border widths and,
 * for a form field or a free-text comment, the text size a reader uses when it draws the text again (set
 * on the annotation itself, so a field shown on other pages keeps its own). Returns false when something
 * it holds cannot be moved exactly (kept as it is and flagged).
 */
function moveAnnotation(ctx: PDFContext, dict: PDFDict, mv: Move, form: PDFDict | undefined): boolean {
  let exact = true;
  movePoints(ctx, dict, 'Rect', mv, 'rect');
  for (const key of ['QuadPoints', 'L', 'Vertices', 'CL']) movePoints(ctx, dict, key, mv, 'points');
  for (const key of ['InkList', 'Path']) moveNested(ctx, dict, key, mv);
  movePoints(ctx, dict, 'RD', mv, 'scale');
  for (const key of ['LL', 'LLE', 'LLO']) scaleNumber(dict, key, mv.k);
  const bs = ctx.lookup(dict.get(PDFName.of('BS')));
  if (bs instanceof PDFDict) {
    const own = bs.clone(ctx);
    scaleNumber(own, 'W', mv.k);
    const dash = numbersOf(ctx, own.get(PDFName.of('D')));
    if (dash) own.set(PDFName.of('D'), ctx.obj(dash.map((v) => num(v * mv.k))));
    dict.set(PDFName.of('BS'), own);
  }
  const border = ctx.lookup(dict.get(PDFName.of('Border')));
  if (border instanceof PDFArray && border.size() >= 3) {
    const out = border.asArray().map((x, i) => {
      const v = asNumber(ctx.lookup(x));
      return i < 3 && v !== null ? num(v * mv.k) : x;
    });
    dict.set(PDFName.of('Border'), ctx.obj(out));
  }
  const kind = dict.get(PDFName.of('Subtype'));
  const name = kind instanceof PDFName ? kind.decodeText() : '';
  if (name === 'Widget' || name === 'FreeText') {
    const da = textOf(name === 'Widget' ? inherited(ctx, dict, 'DA', form) : ctx.lookup(dict.get(PDFName.of('DA'))));
    if (da !== null) dict.set(PDFName.of('DA'), PDFString.of(scaleAppearance(da, mv.k)));
    const ds = textOf(name === 'Widget' ? inherited(ctx, dict, 'DS', undefined) : ctx.lookup(dict.get(PDFName.of('DS'))));
    if (ds !== null) dict.set(PDFName.of('DS'), PDFString.of(scaleStyle(ds, mv.k)));
  }
  if (!KNOWN_KINDS.has(name)) exact = false;
  if (dict.has(PDFName.of('Measure'))) exact = false; // a measuring scale ("1 cm = 2 m") no longer matches
  if (name === 'Watermark' && dict.has(PDFName.of('FixedPrint'))) exact = false;
  return exact;
}

/** The page's patterns, copied with the transform in their /Matrix (pattern space is the page's own, not the drawing's). */
function movePatterns(state: RunState, page: PDFPage, m: Matrix): boolean {
  const { ctx } = state;
  const raw = page.node.getInheritableAttribute(PDFName.of('Resources'));
  const res = ctx.lookup(raw);
  if (!(res instanceof PDFDict)) return true;
  const patterns = dictIn(res, 'Pattern');
  if (!patterns || patterns.keys().length === 0) return true;
  const mkey = m.map((v) => fmt(v, 6)).join(' ');
  let id = state.resourceIds.get(res);
  if (id === undefined) {
    id = ++state.nextResourceId;
    state.resourceIds.set(res, id);
  }
  const resKey = `${id}|${mkey}`;
  let copy = state.resources.get(resKey);
  if (!copy) {
    const own = res.clone(ctx);
    const moved = ctx.obj({}) as PDFDict;
    for (const key of patterns.keys()) {
      const ref = patterns.get(key);
      const obj = ctx.lookup(ref);
      const tag = ref instanceof PDFRef ? ref.tag : `${resKey}/${key.decodeText()}`;
      const patternKey = `${tag}|${mkey}`;
      let target = state.patterns.get(patternKey);
      if (!target) {
        const dict = obj instanceof PDFStream ? obj.dict : obj instanceof PDFDict ? obj : null;
        if (!dict) {
          moved.set(key, ref!);
          continue;
        }
        const before = numbersOf(ctx, dict.get(PDFName.of('Matrix')));
        const matrix = concat(before && before.length === 6 ? (before as unknown as Matrix) : [1, 0, 0, 1, 0, 0], m);
        const clone = obj instanceof PDFStream ? (obj as PDFStream & { clone(c: PDFContext): PDFStream }).clone(ctx) : (obj as PDFDict).clone(ctx);
        const cloneDict = clone instanceof PDFStream ? clone.dict : (clone as PDFDict);
        cloneDict.set(PDFName.of('Matrix'), ctx.obj(matrix.map((v) => PDFNumber.of(Math.round(v * 1e6) / 1e6))));
        target = ctx.register(clone);
        state.patterns.set(patternKey, target);
      }
      moved.set(key, target);
    }
    own.set(PDFName.of('Pattern'), moved);
    copy = ctx.register(own);
    state.resources.set(resKey, copy);
  }
  page.node.set(PDFName.of('Resources'), copy);
  // A form drawn by the page without resources of its own would take the moved patterns and move them twice.
  const forms = dictIn(res, 'XObject');
  if (!forms) return true;
  return forms.keys().every((key) => {
    const x = ctx.lookup(forms.get(key));
    return !(x instanceof PDFStream) || x.dict.get(PDFName.of('Subtype')) !== PDFName.of('Form') || x.dict.has(PDFName.of('Resources'));
  });
}

/** The kinds of destination, with the places of their x and y numbers after the page and the kind. */
const DEST_ARGS: Readonly<Record<string, ('x' | 'y' | 'z')[]>> = {
  XYZ: ['x', 'y', 'z'], Fit: [], FitB: [], FitH: ['y'], FitBH: ['y'], FitV: ['x'], FitBV: ['x'], FitR: ['x', 'y', 'x', 'y'],
};

/**
 * Moves every destination that points into a resized page: bookmarks, named destinations (/Dests and the
 * /Names tree), the opening view, links and other actions of every page, and the document's actions.
 */
async function moveDestinations(state: RunState, moves: Map<PDFRef, Move>, pace: Pace): Promise<void> {
  const { ctx, doc, seen } = state;
  const pages = doc.getPages();
  const moveArray = (a: PDFArray) => {
    if (seen.has(a) || a.size() < 2) return;
    seen.add(a);
    const first = a.get(0);
    const ref = first instanceof PDFRef ? first : first instanceof PDFNumber ? pages[first.asNumber()]?.ref : undefined;
    const mv = ref ? moves.get(ref) : undefined;
    const kind = a.get(1);
    if (!mv || !(kind instanceof PDFName)) return;
    const args = DEST_ARGS[kind.decodeText()] ?? [];
    args.forEach((axis, i) => {
      const v = asNumber(ctx.lookup(a.get(2 + i)));
      if (v === null || axis === 'z') return;
      a.set(2 + i, num(axis === 'x' ? mv.k * v + mv.e : mv.k * v + mv.f));
    });
  };
  const dest = (obj: PDFObject | undefined) => {
    const v = ctx.lookup(obj);
    if (v instanceof PDFArray) moveArray(v);
    else if (v instanceof PDFDict) dest(v.get(PDFName.of('D')));
  };
  const action = (obj: PDFObject | undefined, depth = 0) => {
    const v = ctx.lookup(obj);
    if (depth > 32) return;
    if (v instanceof PDFArray) {
      v.asArray().forEach((a) => action(a, depth + 1));
      return;
    }
    if (!(v instanceof PDFDict) || seen.has(v)) return;
    seen.add(v);
    if (v.get(PDFName.of('S')) === PDFName.of('GoTo')) dest(v.get(PDFName.of('D')));
    action(v.get(PDFName.of('Next')), depth + 1);
  };
  const actions = (obj: PDFObject | undefined) => {
    const v = ctx.lookup(obj);
    if (v instanceof PDFDict) for (const key of v.keys()) action(v.get(key));
  };

  const catalog = doc.catalog;
  const open = ctx.lookup(catalog.get(PDFName.of('OpenAction')));
  if (open instanceof PDFArray) moveArray(open);
  else action(open);
  actions(catalog.get(PDFName.of('AA')));
  const dests = ctx.lookup(catalog.get(PDFName.of('Dests')));
  if (dests instanceof PDFDict) for (const key of dests.keys()) dest(dests.get(key));
  const names = ctx.lookup(catalog.get(PDFName.of('Names')));
  const tree = names instanceof PDFDict ? ctx.lookup(names.get(PDFName.of('Dests'))) : undefined;
  const walkTree = (node: PDFObject | undefined, depth: number) => {
    const v = ctx.lookup(node);
    if (!(v instanceof PDFDict) || depth > 32 || seen.has(v)) return;
    seen.add(v);
    const leaf = ctx.lookup(v.get(PDFName.of('Names')));
    if (leaf instanceof PDFArray) for (let i = 1; i < leaf.size(); i += 2) dest(leaf.get(i));
    const kids = ctx.lookup(v.get(PDFName.of('Kids')));
    if (kids instanceof PDFArray) kids.asArray().forEach((k) => walkTree(k, depth + 1));
  };
  walkTree(tree, 0);

  // Bookmarks: followed through /First and /Next, each item once.
  const outlines = ctx.lookup(catalog.get(PDFName.of('Outlines')));
  const items: PDFObject[] = outlines instanceof PDFDict ? [outlines.get(PDFName.of('First'))].filter((x): x is PDFObject => x !== undefined) : [];
  let visited = 0;
  while (items.length > 0 && visited < 100_000) {
    const item = ctx.lookup(items.pop());
    if (!(item instanceof PDFDict) || seen.has(item)) continue;
    seen.add(item);
    visited++;
    dest(item.get(PDFName.of('Dest')));
    action(item.get(PDFName.of('A')));
    for (const key of ['Next', 'First']) {
      const next = item.get(PDFName.of(key));
      if (next) items.push(next);
    }
    await pace();
  }

  for (const page of pages) {
    await pace();
    actions(page.node.get(PDFName.of('AA')));
    const list = arrayIn(page.node, 'Annots');
    if (!list) continue;
    for (const entry of list.asArray()) {
      const a = ctx.lookup(entry);
      if (!(a instanceof PDFDict)) continue;
      dest(a.get(PDFName.of('Dest')));
      action(a.get(PDFName.of('A')));
      actions(a.get(PDFName.of('AA')));
    }
  }
}

/** The annotations of a page that a reader shows (not popups, not hidden), with their boxes. */
function shownAnnotations(ctx: PDFContext, page: PDFPage): number[][] {
  const list = arrayIn(page.node, 'Annots');
  if (!list) return [];
  const out: number[][] = [];
  for (const entry of list.asArray()) {
    const a = ctx.lookup(entry);
    if (!(a instanceof PDFDict) || a.get(PDFName.of('Subtype')) === PDFName.of('Popup')) continue;
    const flags = asNumber(ctx.lookup(a.get(PDFName.of('F')))) ?? 0;
    if (flags & 2) continue;
    const r = numbersOf(ctx, a.get(PDFName.of('Rect')));
    if (r && r.length === 4) out.push([Math.min(r[0], r[2]), Math.min(r[1], r[3]), Math.max(r[0], r[2]), Math.max(r[1], r[3])]);
  }
  return out;
}

// ---- the run ------------------------------------------------------------------------------------------

const boxArray = (ctx: PDFContext, b: Box) => ctx.obj([b.x, b.y, b.x + b.width, b.y + b.height].map(num));
const add = (list: number[] | undefined, n: number) => {
  if (list && !list.includes(n)) list.push(n);
};

/**
 * Resizes, trims or adds margins to the chosen pages of `file`. Every chosen page is checked first, so
 * that a refusal (naming its page) changes nothing. When no page needs a change (every chosen page is
 * already the paper size), `file` itself is returned, unsaved, and the report says so.
 */
export async function changePageBoxes(file: Uint8Array, options: PageBoxOptions, hooks: PageBoxHooks = {}): Promise<Uint8Array> {
  let doc: PDFDocument;
  try {
    doc = await loadPaced(file, { updateMetadata: false, check: hooks.check });
  } catch (error) {
    if (isStop(error)) throw error; // the run's own Stop, pressed while the file was read
    throw new PdfToolsError('not-a-pdf', 'This file could not be read as a PDF. It may be damaged or protected.');
  }
  const pages = doc.getPages();
  const error = pageBoxError(options, pages.length);
  if (error) throw invalid(error);
  const report = hooks.report;
  const { from, to } = options.pages;
  const total = to - from + 1;
  // One page listed twice would be changed twice (REV-A S6).
  const twice = pageListedTwice(pages, from, to);
  if (twice) throw invalid(`Pages ${twice[0]} and ${twice[1]} are one page listed twice in this file, so they cannot be changed separately. The file may be damaged.`);

  const pace = pacer();
  const plans: { n: number; page: PDFPage; plan: Extract<PagePlan, { kind: 'change' }> }[] = [];
  for (let n = from; n <= to; n++) {
    await pace();
    const page = pages[n - 1];
    let shown: DisplayedPage;
    try {
      shown = displayedPage(page);
    } catch {
      // A box, turn or page tree pdf-lib cannot read (REV-A S2): refused plainly, naming the page.
      throw invalid(`Page ${n} could not be read, so it cannot be changed. The file may be damaged.`);
    }
    const plan = planPage(shown, options, n);
    if (plan.kind === 'keep') add(report?.unchanged, n);
    else plans.push({ n, page, plan });
  }
  if (plans.length === 0) {
    await hooks.onPage?.(total, total);
    return file;
  }

  const ctx = doc.context;
  const state: RunState = { doc, ctx, streams: new Map(), patterns: new Map(), resources: new Map(), resourceIds: new WeakMap(), nextResourceId: 0, seen: new Set() };
  const form = ctx.lookup(doc.catalog.get(PDFName.of('AcroForm')));
  const acroForm = form instanceof PDFDict ? form : undefined;
  const moves = new Map<PDFRef, Move>();
  const moved = new Set<PDFDict>();
  let at = 0;
  for (let n = from; n <= to; n++) {
    await hooks.onPage?.(n - from, total);
    await pace();
    const entry = plans[at];
    if (!entry || entry.n !== n) continue;
    at++;
    const { page, plan } = entry;
    const node = page.node;
    add(report?.changed, n);
    if (plan.clip) wrapContent(state, page, plan.matrix, plan.clip, report, n);
    node.set(PDFName.of('MediaBox'), boxArray(ctx, plan.box));
    node.set(PDFName.of('CropBox'), boxArray(ctx, plan.box));
    for (const key of ['BleedBox', 'TrimBox', 'ArtBox', 'Thumb']) node.delete(PDFName.of(key));
    if (plan.dropUserUnit) node.delete(PDFName.of('UserUnit'));

    if (plan.matrix) {
      const mv = moveOf(plan.matrix);
      moves.set(page.ref, mv);
      let exact = movePatterns(state, page, plan.matrix);
      const list = arrayIn(node, 'Annots');
      for (const a of list?.asArray() ?? []) {
        const dict = ctx.lookup(a);
        if (!(dict instanceof PDFDict)) continue;
        if (moved.has(dict)) {
          exact = false; // listed on two pages: moved once, with the first page
          continue;
        }
        moved.add(dict);
        if (!moveAnnotation(ctx, dict, mv, acroForm)) exact = false;
      }
      const beads = arrayIn(node, 'B');
      for (const b of beads?.asArray() ?? []) {
        const bead = ctx.lookup(b);
        if (bead instanceof PDFDict && !moved.has(bead)) {
          moved.add(bead);
          movePoints(ctx, bead, 'R', mv, 'rect');
        }
      }
      if (node.has(PDFName.of('VP'))) exact = false; // viewports with measuring scales
      if (!exact) add(report?.approximate, n);
    } else if (options.mode === 'trim') {
      const b = plan.box;
      const outside = shownAnnotations(ctx, page).some(([x0, y0, x1, y1]) => x1 <= b.x || x0 >= b.x + b.width || y1 <= b.y || y0 >= b.y + b.height);
      if (outside) add(report?.hiddenAnnotations, n);
    }
  }
  if (moves.size > 0) await moveDestinations(state, moves, pace);
  await hooks.onPage?.(total, total);
  await hooks.onSaving?.();
  // An edit of the source in place: Producer and modification date are ours, the Creator stays (REV-A S12).
  doc.setProducer(PRODUCER);
  doc.setModificationDate(new Date());
  return savePaced(doc);
}
