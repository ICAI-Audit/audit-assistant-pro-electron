// The Resize or crop pages dialog as plain data: the form, its defaults, its checks in the words the
// dialog shows (the library's words where it has them), the mapping from millimetres to the library's
// points, the crop frame's arithmetic (mouse and keys), the Run label, the result name, and what a run
// says and records. No React here; the dialog is PageBoxDialog.tsx, the run step pageBoxRun.ts.
import { normaliseRotation, type DisplayedPage } from '@/lib/pdf-tools/marks';
import { MIN_SIDE_PT, PAPERS, PT_PER_MM, pageBoxError, planPage, type Direction, type PageBoxOptions, type PageBoxReport, type PaperName, type Sides } from '@/lib/pdf-tools/pageBox';
import { defaultResultName } from '@/lib/pdf-tools/resultNames';
import { PdfToolsError } from '@/lib/pdf-tools/types';
import { plural } from '../format';
import { pagesInWords } from '../marks/markText';
import type { SizePreset } from '../marks/units';
import { chosenPages } from '../marks/watermarkForm';

export type BoxMode = 'resize' | 'crop';
export type CropKind = 'trim' | 'margin';
export type MarginChoice = 'none' | 'narrow' | 'normal' | 'other';
export type EdgeName = 'left' | 'top' | 'right' | 'bottom';
export const EDGES: readonly EdgeName[] = ['left', 'top', 'right', 'bottom'];
/** Edges in millimetres, as typed or dragged. */
export type EdgesMm = Record<EdgeName, number>;

export interface PageBoxForm {
  mode: BoxMode;
  paper: PaperName | 'custom';
  /** The custom paper, in mm as typed. */
  width: string;
  height: string;
  direction: Direction;
  /** Enlarge pages smaller than the paper (off: "Do not enlarge small pages", the default). */
  enlarge: boolean;
  margin: MarginChoice;
  marginMm: string;
  cropKind: CropKind;
  /** Each edge in mm as typed (blank counts as 0). */
  edges: Record<EdgeName, string>;
  mirror: boolean;
  pages: 'all' | 'range';
  from: string;
  to: string;
}

export function defaultPageBoxForm(pageCount: number): PageBoxForm {
  return {
    mode: 'resize',
    paper: 'a4',
    width: '210',
    height: '297',
    direction: 'keep',
    enlarge: false,
    margin: 'none',
    marginMm: '10',
    cropKind: 'trim',
    edges: { left: '10', top: '10', right: '10', bottom: '10' },
    mirror: false,
    pages: 'all',
    from: '1',
    to: String(Math.max(1, pageCount)),
  };
}

export const PAPER_CHOICES: readonly { id: PaperName | 'custom'; label: string; detail: string }[] = [
  ...(Object.keys(PAPERS) as PaperName[]).map((id) => ({ id, label: PAPERS[id].label, detail: `${PAPERS[id].widthMm} × ${PAPERS[id].heightMm} mm` })),
  { id: 'custom', label: 'Other size', detail: 'Width and height in mm' },
];

/** Margins around the content of a resized page (UX audit C6.5: presets in mm, then a typed value). */
export const MARGIN_PRESETS: readonly SizePreset[] = [
  { id: 'none', label: 'None', pt: 0, recommended: true },
  { id: 'narrow', label: 'Narrow', pt: 5 * PT_PER_MM },
  { id: 'normal', label: 'Normal', pt: 10 * PT_PER_MM },
];
const MARGIN_MM: Record<Exclude<MarginChoice, 'other'>, number> = { none: 0, narrow: 5, normal: 10 };

export const SIZE_LIMITS_MM = { min: 10, max: 5080 } as const;
const MARGIN_MAX_MM = 200;
const ADD_MAX_MM = 500;

/** A page as displayed, from pdf.js's reading of it (its visible box, own turn and unit). */
export function shapeOf(g: { view: readonly number[]; rotate: number; userUnit: number }): DisplayedPage {
  const [x0, y0, x1, y1] = g.view;
  const box = { x: Math.min(x0, x1), y: Math.min(y0, y1), width: Math.abs(x1 - x0), height: Math.abs(y1 - y0) };
  const rotation = normaliseRotation(g.rotate);
  const unit = g.userUnit > 0 ? g.userUnit : 1;
  const sideways = rotation === 90 || rotation === 270;
  return { box, rotation, unit, width: (sideways ? box.height : box.width) * unit, height: (sideways ? box.width : box.height) * unit };
}

const round1 = (x: number) => Math.round(x * 10) / 10;
const mmText = (mm: number) => `${round1(mm)} mm`;
const capital = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

/** A typed number of mm (blank is 0 when `blankIsZero`), or NaN. */
function mmOf(text: string, blankIsZero = false): number {
  const t = text.trim();
  if (t === '' && blankIsZero) return 0;
  return /^\d+(\.\d+)?$/.test(t) ? Number(t) : Number.NaN;
}

export function edgesMm(form: Pick<PageBoxForm, 'edges'>): EdgesMm {
  return { left: mmOf(form.edges.left, true), top: mmOf(form.edges.top, true), right: mmOf(form.edges.right, true), bottom: mmOf(form.edges.bottom, true) };
}

/** "A4", "Letter" or "200 × 300 mm": the paper in words. */
export function sizeLabel(form: Pick<PageBoxForm, 'paper' | 'width' | 'height'>): string {
  if (form.paper !== 'custom') return PAPERS[form.paper].label;
  const show = (text: string) => {
    const v = mmOf(text);
    return Number.isNaN(v) ? text.trim() || '…' : String(round1(v));
  };
  return `${show(form.width)} × ${show(form.height)} mm`;
}

/** A page's size as displayed, in words: "216 × 279 mm (Letter)", "297 × 210 mm (A4 landscape)", "80 × 120 mm". */
export function pageSizeText(width: number, height: number): string {
  const mm = `${Math.round(width / PT_PER_MM)} × ${Math.round(height / PT_PER_MM)} mm`;
  const short = Math.min(width, height);
  const long = Math.max(width, height);
  const paper = (Object.keys(PAPERS) as PaperName[]).find((p) => Math.abs(PAPERS[p].width - short) <= PT_PER_MM && Math.abs(PAPERS[p].height - long) <= PT_PER_MM);
  return paper ? `${mm} (${PAPERS[paper].label}${width > height ? ' landscape' : ''})` : mm;
}

/** The paper of the library's options in words: a named paper either way round, else its size in mm. */
export function paperLabelOf(size: { width: number; height: number }): string {
  const short = Math.min(size.width, size.height);
  const long = Math.max(size.width, size.height);
  const paper = (Object.keys(PAPERS) as PaperName[]).find((p) => Math.abs(PAPERS[p].width - short) < 0.01 && Math.abs(PAPERS[p].height - long) < 0.01);
  return paper ? PAPERS[paper].label : `${round1(size.width / PT_PER_MM)} × ${round1(size.height / PT_PER_MM)} mm`;
}

export type PageBoxField = 'size' | 'margin' | 'edges' | 'pages';

export interface PageBoxReading {
  options: PageBoxOptions | null;
  errors: Partial<Record<PageBoxField, string>>;
  /** The first problem (for Run's reason), or a page-level refusal, or "nothing would change". */
  first: string | null;
  /** Once the pages' sizes are known: the chosen pages, how many change, how many are already that size. */
  counts: { chosen: number; change: number; same: number } | null;
  /** Once the pages' sizes are known: the pages that change. */
  changing: number[] | null;
}

/**
 * Reads the form: the library's options, or the problems field by field. With the pages' shapes it also
 * checks every chosen page as the run will (a trim that leaves too little names the page) and counts the
 * pages that would change; when none would, Run waits with a reason.
 */
export function readPageBoxForm(form: PageBoxForm, ctx: { pageCount: number; shapes: readonly DisplayedPage[] | null }): PageBoxReading {
  const errors: Partial<Record<PageBoxField, string>> = {};
  const pages = chosenPages(form, ctx.pageCount);
  if (!pages) errors.pages = `Enter a page range between 1 and ${ctx.pageCount}, with the first page not after the last.`;
  const range = pages ? { from: pages[0], to: pages[pages.length - 1] } : { from: 1, to: ctx.pageCount };

  let options: PageBoxOptions;
  if (form.mode === 'resize') {
    let size = { width: PAPERS.a4.width, height: PAPERS.a4.height };
    if (form.paper === 'custom') {
      const w = mmOf(form.width);
      const h = mmOf(form.height);
      if (![w, h].every((v) => v >= SIZE_LIMITS_MM.min && v <= SIZE_LIMITS_MM.max)) errors.size = 'Enter a width and height from 10 to 5,080 mm.';
      else size = { width: w * PT_PER_MM, height: h * PT_PER_MM };
    } else size = { width: PAPERS[form.paper].width, height: PAPERS[form.paper].height };
    let marginMm = form.margin === 'other' ? mmOf(form.marginMm) : MARGIN_MM[form.margin];
    if (!(marginMm >= 0 && marginMm <= MARGIN_MAX_MM)) {
      errors.margin = `Enter a margin in millimetres, from 0 to ${MARGIN_MAX_MM}.`;
      marginMm = 0;
    }
    options = { mode: 'resize', size, direction: form.direction, enlarge: form.enlarge, margin: marginMm * PT_PER_MM, pages: range };
    if (!errors.size && !errors.margin && Math.min(size.width, size.height) - 2 * options.margin < MIN_SIDE_PT - 1e-6) {
      errors.margin = 'The margin leaves less than 10 mm for the page content. Use a smaller margin.';
    }
  } else {
    const mm = edgesMm(form);
    const values = EDGES.map((e) => mm[e]);
    const sides: Sides = { left: mm.left * PT_PER_MM, top: mm.top * PT_PER_MM, right: mm.right * PT_PER_MM, bottom: mm.bottom * PT_PER_MM };
    options = { mode: form.cropKind, sides, mirror: form.mirror, pages: range };
    if (!values.every((v) => v >= 0)) errors.edges = 'Enter each edge as a number of millimetres, 0 or more.';
    else if (form.cropKind === 'margin' && values.some((v) => v > ADD_MAX_MM)) errors.edges = 'Enter a margin of at most 500 mm on each edge.';
    else {
      const library = pageBoxError(options, ctx.pageCount);
      if (library && !errors.pages) errors.edges = library;
    }
  }

  // Every chosen page, as the run will see it: a page-level refusal names the page.
  let counts: PageBoxReading['counts'] = null;
  let changing: number[] | null = null;
  if (pages && Object.keys(errors).length === 0 && ctx.shapes && ctx.shapes.length === ctx.pageCount) {
    try {
      const list = pages.filter((n) => planPage(ctx.shapes![n - 1], options, n).kind === 'change');
      changing = list;
      counts = { chosen: pages.length, change: list.length, same: pages.length - list.length };
    } catch (error) {
      const message = error instanceof PdfToolsError ? error.message : 'These values cannot be used on the chosen pages.';
      if (form.mode === 'resize') errors.margin = message;
      else errors.edges = message;
    }
  }
  const order: PageBoxField[] = ['size', 'margin', 'edges', 'pages'];
  let first = order.map((f) => errors[f]).find((e): e is string => Boolean(e)) ?? null;
  if (!first && counts && counts.change === 0) {
    const what = counts.chosen === 1 ? `Page ${pages![0]} is` : `All ${counts.chosen} chosen pages are`;
    first = `${what} already ${sizeLabel(form)}. Choose another size, add a margin, or choose other pages.`;
  }
  return { options: first ? null : options, errors, first, counts, changing };
}

/** The Run button: a verb, how many pages and, for a resize, the paper ("Resize 3 pages to A4", "Trim page 2"). */
export function pageBoxRunLabel(form: PageBoxForm, reading: PageBoxReading, pageCount: number): string {
  const pages = reading.changing ?? chosenPages(form, pageCount) ?? [];
  const which = pageCount === 1 ? 'the page' : pages.length === 1 ? `page ${pages[0]}` : plural(pages.length, 'page');
  if (form.mode === 'resize') return pages.length === 0 ? 'Resize pages' : `Resize ${which} to ${sizeLabel(form)}`;
  return form.cropKind === 'trim' ? `Trim ${which}` : `Add margins to ${which}`;
}

const DIRECTION_WORDS: Record<Direction, string> = { keep: 'each page keeps its direction', portrait: 'all pages portrait', landscape: 'all pages landscape' };

/** The closed line of the resize's "More options": "Each page keeps its direction, small pages keep their size, no margin". */
export function resizeSummary(form: Pick<PageBoxForm, 'paper' | 'width' | 'height' | 'direction' | 'enlarge' | 'margin' | 'marginMm'>): string {
  const own = form.paper === 'custom' ? `own size ${sizeLabel(form)}, ` : '';
  const small = form.enlarge ? 'small pages enlarged to fit' : 'small pages keep their size';
  const mm = form.margin === 'other' ? mmOf(form.marginMm) : MARGIN_MM[form.margin];
  const margin = mm > 0 ? `${mmText(mm)} margin` : Number.isNaN(mm) ? 'margin to check' : 'no margin';
  return capital(`${own}${DIRECTION_WORDS[form.direction] ?? DIRECTION_WORDS.keep}, ${small}, ${margin}`);
}

/** The closed line of the crop's "More options". */
export function cropSummary(form: Pick<PageBoxForm, 'mirror' | 'cropKind'>): string {
  const pages = form.mirror ? 'Left and right swapped on even pages' : 'The same on every page';
  return form.cropKind === 'margin' ? `${pages}, white space added instead of trimming` : pages;
}

/** Under the size: the chosen pages that are already that size ("1 page is already A4 and stays as it is."). */
export function sameNote(counts: { same: number }, size: string): string {
  return counts.same === 1 ? `1 page is already ${size} and stays as it is.` : `${counts.same} pages are already ${size} and stay as they are.`;
}

/** `<name>_resized.pdf`, `<name>_cropped.pdf` or `<name>_with_margins.pdf`: the shared naming rule (resultNames.ts). */
export function pageBoxResultName(sourceName: string, form: Pick<PageBoxForm, 'mode' | 'cropKind'>): string {
  return defaultResultName('resize-crop', sourceName, { pageBoxMode: form.mode === 'resize' ? 'resize' : form.cropKind });
}

// ---- the crop frame ----------------------------------------------------------------------------------

/** The stored edge that a displayed edge of page `page` is: on even pages, mirrored, left and right swap. */
function storedEdge(edge: EdgeName, mirror: boolean, page: number): EdgeName {
  if (!mirror || page % 2 !== 0) return edge;
  return edge === 'left' ? 'right' : edge === 'right' ? 'left' : edge;
}

/** The edges as displayed on page `page`. */
export function shownEdges(edges: EdgesMm, mirror: boolean, page: number): EdgesMm {
  return { left: edges[storedEdge('left', mirror, page)], top: edges.top, right: edges[storedEdge('right', mirror, page)], bottom: edges.bottom };
}

/** Where the frame's edges are, in percent of the page as displayed, from each side. */
export function frameOf(edges: EdgesMm, shape: Pick<DisplayedPage, 'width' | 'height'>, mirror: boolean, page: number): EdgesMm {
  const e = shownEdges(edges, mirror, page);
  return {
    left: (e.left * PT_PER_MM * 100) / shape.width,
    top: (e.top * PT_PER_MM * 100) / shape.height,
    right: (e.right * PT_PER_MM * 100) / shape.width,
    bottom: (e.bottom * PT_PER_MM * 100) / shape.height,
  };
}

const opposite: Record<EdgeName, EdgeName> = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' };
const across = (edge: EdgeName) => edge === 'left' || edge === 'right';

/**
 * Moves a displayed edge of page `page` inwards by `deltaMm` (outwards when negative): never out of the
 * page, never closer than 10 mm to the opposite edge. Values are kept to a tenth of a millimetre.
 */
export function moveEdge(edges: EdgesMm, edge: EdgeName, deltaMm: number, shape: Pick<DisplayedPage, 'width' | 'height'>, mirror: boolean, page: number): EdgesMm {
  const shown = shownEdges(edges, mirror, page);
  const sizeMm = (across(edge) ? shape.width : shape.height) / PT_PER_MM;
  const max = Math.max(0, sizeMm - shown[opposite[edge]] - MIN_SIDE_PT / PT_PER_MM);
  const next = Math.min(max, Math.max(0, round1(shown[edge] + deltaMm)));
  return { ...edges, [storedEdge(edge, mirror, page)]: Math.floor(next * 10 + 1e-6) / 10 };
}

/** Moves the whole frame by (du right, dv down) mm without changing its size, within the page. */
export function moveFrame(edges: EdgesMm, du: number, dv: number, mirror: boolean, page: number): EdgesMm {
  const s = shownEdges(edges, mirror, page);
  const dx = Math.min(Math.max(du, -s.left), s.right);
  const dy = Math.min(Math.max(dv, -s.top), s.bottom);
  const moved = { left: round1(s.left + dx), right: round1(s.right - dx), top: round1(s.top + dy), bottom: round1(s.bottom - dy) };
  return { ...edges, [storedEdge('left', mirror, page)]: moved.left, [storedEdge('right', mirror, page)]: moved.right, top: moved.top, bottom: moved.bottom };
}

const EDGE_WORD: Record<EdgeName, string> = { left: 'Left', top: 'Top', right: 'Right', bottom: 'Bottom' };
/** What a screen reader hears when an edge moves: "Left edge: 12 mm trimmed". */
export function edgeAnnouncement(edge: EdgeName, mm: number): string {
  return mm > 0 ? `${EDGE_WORD[edge]} edge: ${round1(mm)} mm trimmed` : `${EDGE_WORD[edge]} edge: not trimmed`;
}

/** The options for a one-page copy of page `page` (the preview): page 1 of the copy, mirrored as the real page is. */
export function onePageOptions(options: PageBoxOptions, page: number): PageBoxOptions {
  if (options.mode === 'resize') return { ...options, pages: { from: 1, to: 1 } };
  const s = options.sides;
  const sides = options.mirror && page % 2 === 0 ? { left: s.right, top: s.top, right: s.left, bottom: s.bottom } : { ...s };
  return { ...options, mirror: false, sides, pages: { from: 1, to: 1 } };
}

// ---- what a run says and records -------------------------------------------------------------------------

const many = (pages: readonly number[]) => new Set(pages).size > 1;

/** Pages the user should look at: damaged or unreadable drawing, or something kept as it was. */
export function pagesToCheck(report: PageBoxReport): number[] {
  return [...new Set([...report.damaged, ...report.unverified, ...report.approximate])].sort((a, b) => a - b);
}

/** What the run did, and each thing kept and flagged, in one short sentence each (owner: no technical words). */
export function pageBoxRunNotes(report: PageBoxReport, options: PageBoxOptions, size: string): { done: string; notes: string[] } {
  const changed = report.changed.length;
  let done: string;
  if (options.mode === 'resize') {
    const same = report.unchanged.length;
    done = `${plural(changed, 'page')} resized to ${size}${same > 0 ? `; ${same} ${same === 1 ? 'was' : 'were'} already ${size} and ${same === 1 ? 'is' : 'are'} unchanged` : ''}.`;
  } else if (options.mode === 'trim') done = `${plural(changed, 'page')} trimmed; the trimmed parts are hidden, not removed.`;
  else done = `Margins added to ${plural(changed, 'page')}.`;

  const notes: string[] = [];
  const drawing = [...new Set([...report.damaged, ...report.unverified])].sort((a, b) => a - b);
  if (drawing.length > 0) {
    notes.push(`Check ${pagesInWords(drawing)}: ${many(drawing) ? 'their' : 'its'} content could not be read exactly, so ${many(drawing) ? 'they' : 'it'} may look different.`);
  }
  if (report.approximate.length > 0) {
    const p = report.approximate;
    notes.push(`Check ${pagesInWords(p)}: a comment or measurement on ${many(p) ? 'them' : 'it'} may not have resized exactly.`);
  }
  if (report.hiddenAnnotations.length > 0) {
    notes.push(`On ${pagesInWords(report.hiddenAnnotations)} a link, comment or form field is now in the trimmed part, hidden but still in the file.`);
  }
  return { done, notes };
}

function rangeText(options: PageBoxOptions, pageCount: number): string {
  const { from, to } = options.pages;
  return from === 1 && to === pageCount ? 'all' : from === to ? String(from) : `${from}-${to}`;
}
const mmNumber = (pt: number) => round1(pt / PT_PER_MM);

/** The record (counts and choices only): "Resized 3 pages to A4, 1 already A4", with flat options. */
export function pageBoxRecord(options: PageBoxOptions, report: PageBoxReport, pageCount: number, size: string): { summary: string; options: Record<string, string | number | boolean> } {
  const changed = report.changed.length;
  const check = pagesToCheck(report).length;
  const tail = check > 0 ? `; ${plural(check, 'page')} to check` : '';
  if (options.mode === 'resize') {
    const same = report.unchanged.length;
    return {
      summary: `Resized ${plural(changed, 'page')} to ${size}${same > 0 ? `, ${same} already ${size}` : ''}${tail}`,
      options: { mode: 'resize', size, direction: options.direction, enlarge: options.enlarge, marginMm: mmNumber(options.margin), pages: rangeText(options, pageCount), changed, unchanged: same, pagesToCheck: check },
    };
  }
  const s = options.sides;
  const mm = { left: mmNumber(s.left), top: mmNumber(s.top), right: mmNumber(s.right), bottom: mmNumber(s.bottom) };
  const values = EDGES.map((e) => mm[e]);
  const edgesText = values.every((v) => v === values[0])
    ? `${mmText(values[0])} on every edge`
    : EDGES.filter((e) => mm[e] > 0).map((e) => `${e} ${mmText(mm[e])}`).join(', ');
  const verb = options.mode === 'trim' ? `Trimmed ${plural(changed, 'page')}` : `Added margins to ${plural(changed, 'page')}`;
  return {
    summary: `${verb}: ${edgesText}${options.mirror ? ', mirrored on even pages' : ''}${tail}`,
    options: { mode: options.mode, leftMm: mm.left, topMm: mm.top, rightMm: mm.right, bottomMm: mm.bottom, mirror: options.mirror, pages: rangeText(options, pageCount), changed, pagesToCheck: check },
  };
}
