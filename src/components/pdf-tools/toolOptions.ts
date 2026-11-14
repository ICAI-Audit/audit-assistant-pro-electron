// The rules behind the tool dialogs' fields, as plain functions so that they are unit-tested:
// result names, Split and Delete pages checks, the page-number form, the Images to PDF margin,
// the PDF to images size check, progress throttling and the page-number preview. Messages repeat
// the lib's own words where the lib checks the same thing (the tests compare them).
import { cleanFileName } from '@/lib/pdf-tools/fileNames';
import {
  defaultPageNumberOptions,
  pageNumberLabel,
  type NumberFormat,
  type NumberPosition,
  type PageNumberOptions,
} from '@/lib/pdf-tools/pageNumbers';
import { formatBytes } from './format';
import { readPageList } from './pageSelection';

// The characters cleanFileName replaces.
// eslint-disable-next-line no-control-regex
const ILLEGAL = /[\\/:*?"<>|\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;

/**
 * The name a result is saved under: the typed name cleaned with cleanFileName, or the default when
 * nothing usable was typed (empty, or only spaces, dots and characters a file name cannot hold).
 */
export function resolveResultName(input: string, fallback: string, extension: 'pdf' | 'png' | 'jpg'): string {
  const typed = input.trim();
  const suffix = `.${extension}`;
  const base = typed.toLowerCase().endsWith(suffix) ? typed.slice(0, -suffix.length) : typed;
  const meaningful = base.replace(ILLEGAL, '').replace(/[.\s]/g, '');
  return cleanFileName(meaningful === '' ? fallback : typed, extension);
}

/** Longest stem for parts and page images, so `<stem>_part_01.pdf` or `<stem>_page_0001.png` fits 120 characters. */
export const MAX_STEM_LENGTH = 90;

/** The stem that Split's parts and PDF to images' pictures are named from, cleaned the same way. */
export function resolveStem(input: string, fallback: string): string {
  let stem = resolveResultName(input, `${fallback}.pdf`, 'pdf').slice(0, -'.pdf'.length);
  if (stem.length > MAX_STEM_LENGTH) {
    stem = stem.slice(0, MAX_STEM_LENGTH);
    if (/[\uD800-\uDBFF]$/.test(stem)) stem = stem.slice(0, -1);
  }
  return stem;
}

const whole = (text: string) => (/^\d+$/.test(text.trim()) ? Number(text.trim()) : Number.NaN);
const decimal = (text: string) => (/^\d+(\.\d+)?$/.test(text.trim()) ? Number(text.trim()) : Number.NaN);

// Split -----------------------------------------------------------------------------------------

/** Page range mode: null when From and To are valid for the file, otherwise what is wrong. */
export function rangeError(fromText: string, toText: string, pageCount: number): string | null {
  const from = whole(fromText);
  const to = whole(toText);
  if (Number.isNaN(from) || Number.isNaN(to)) return `Enter whole page numbers from 1 to ${pageCount}.`;
  return readPageList(`${from}-${to}`, pageCount, 'as-written').error;
}

/** Every-N mode: N must be from 1 to one less than the page count (splitEvery's own rule and words). */
export function splitSizeError(nText: string, pageCount: number): string | null {
  if (pageCount < 2) return 'This file has only one page, so it cannot be split into parts.';
  const n = whole(nText);
  if (!Number.isInteger(n) || n < 1 || n >= pageCount) return `Enter a number from 1 to ${pageCount - 1}.`;
  return null;
}

export function partCount(pageCount: number, n: number): number {
  return Math.ceil(pageCount / n);
}

// Delete pages ----------------------------------------------------------------------------------

export function pagesLeft(indices: number[], pageCount: number): number {
  return pageCount - new Set(indices).size;
}

/** Removing every page is refused, in deletePages's words. */
export function deleteError(indices: number[], pageCount: number): string | null {
  return pagesLeft(indices, pageCount) <= 0 ? 'You cannot delete every page of a PDF.' : null;
}

// Page numbers ----------------------------------------------------------------------------------

/** What the page-number fields hold; numbers stay text until they are read. */
export interface PageNumberForm {
  position: NumberPosition;
  format: NumberFormat;
  prefix: string;
  suffix: string;
  startNumber: string;
  range: 'all' | 'some';
  fromPage: string;
  toPage: string;
  fontSize: string;
  marginPt: string;
  /** #rrggbb */
  color: string;
}

/** The bounds addPageNumbers accepts, used for the inputs' min and max. */
export const PAGE_NUMBER_LIMITS = {
  startNumber: { min: 0, max: 1_000_000 },
  fontSize: { min: 6, max: 36 },
  marginPt: { min: 8, max: 144 },
} as const;

export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!match) return null;
  const [r, g, b] = match.slice(1).map((part) => parseInt(part, 16) / 255);
  return { r, g, b };
}

export function rgbToHex(color: { r: number; g: number; b: number }): string {
  const part = (c: number) => Math.round(Math.min(1, Math.max(0, c)) * 255).toString(16).padStart(2, '0');
  return `#${part(color.r)}${part(color.g)}${part(color.b)}`;
}

export function defaultPageNumberForm(pageCount: number): PageNumberForm {
  const d = defaultPageNumberOptions(pageCount);
  return {
    position: d.position,
    format: d.format,
    prefix: d.prefix ?? '',
    suffix: d.suffix ?? '',
    startNumber: String(d.startNumber),
    range: 'all',
    fromPage: String(d.fromPage),
    toPage: String(d.toPage),
    fontSize: String(d.fontSize),
    marginPt: String(d.marginPt),
    color: rgbToHex(d.color),
  };
}

/** The page-number field an error belongs to ('range' covers both From and To). */
export type PageNumberField = 'startNumber' | 'range' | 'fontSize' | 'marginPt' | 'color';

export type FormReading =
  | { options: PageNumberOptions; error: null; field: null }
  | { options: null; error: string; field: PageNumberField };

/** Reads the form in the order addPageNumbers checks it, with the same messages. */
export function readPageNumberForm(form: PageNumberForm, pageCount: number): FormReading {
  const fail = (field: PageNumberField, error: string): FormReading => ({ options: null, error, field });
  const { startNumber: startLimit, fontSize: sizeLimit, marginPt: marginLimit } = PAGE_NUMBER_LIMITS;

  const startNumber = whole(form.startNumber);
  if (!(startNumber >= startLimit.min && startNumber <= startLimit.max)) return fail('startNumber', 'Enter a starting number between 0 and 1,000,000.');

  const fromPage = form.range === 'all' ? 1 : whole(form.fromPage);
  const toPage = form.range === 'all' ? pageCount : whole(form.toPage);
  if (!(fromPage >= 1 && toPage <= pageCount && fromPage <= toPage)) {
    return fail('range', `Enter a page range between 1 and ${pageCount}, with the first page not after the last.`);
  }

  const fontSize = decimal(form.fontSize);
  if (!(fontSize >= sizeLimit.min && fontSize <= sizeLimit.max)) return fail('fontSize', 'Enter a font size from 6 to 36.');
  const marginPt = decimal(form.marginPt);
  if (!(marginPt >= marginLimit.min && marginPt <= marginLimit.max)) return fail('marginPt', 'Enter a margin from 8 to 144 points.');
  const color = hexToRgb(form.color);
  if (!color) return fail('color', 'Choose a valid colour for the page number.');

  return {
    options: { position: form.position, format: form.format, prefix: form.prefix, suffix: form.suffix, startNumber, fromPage, toPage, fontSize, marginPt, color },
    error: null,
    field: null,
  };
}

/**
 * The preview numbers a one-page extract of the first numbered page. On one page, "of N" would
 * count one page, so those formats become the equivalent custom text with the real total.
 */
export function previewPlan(options: PageNumberOptions): { pageIndex: number; options: PageNumberOptions; label: string } {
  const total = options.toPage - options.fromPage + 1 + options.startNumber - 1;
  const label = pageNumberLabel(options, options.startNumber, total);
  let { format, prefix, suffix } = options;
  if (format === 'n-of-total' || format === 'page-n-of-total') {
    prefix = format === 'page-n-of-total' ? 'Page ' : '';
    suffix = ` of ${total}`;
    format = 'custom';
  }
  return { pageIndex: options.fromPage - 1, options: { ...options, format, prefix, suffix, fromPage: 1, toPage: 1 }, label };
}

/** The preview's page is page 1 of the extract: say which page of the file it really is. */
export function previewMessage(message: string, realPage: number): string {
  return message.replace(/does not fit on page 1\./, `does not fit on page ${realPage}.`);
}

const CLOSE_UP_PAD = 16;
const CAP_HEIGHT = 0.718;

/**
 * Where to place a rendered page (CSS object-position, in px) so that a view of viewWidth x
 * viewHeight shows the page number at its chosen corner. The page never leaves a gap in the view.
 */
export function closeUpOffset(o: {
  imageWidth: number;
  imageHeight: number;
  pxPerPt: number;
  position: NumberPosition;
  marginPt: number;
  fontSize: number;
  viewWidth: number;
  viewHeight: number;
}): { x: number; y: number } {
  const [vertical, horizontal] = o.position.split('-') as ['top' | 'bottom', 'left' | 'center' | 'right'];
  const margin = o.marginPt * o.pxPerPt;
  const size = o.fontSize * o.pxPerPt;
  const middleY = vertical === 'bottom' ? o.imageHeight - margin - size / 2 : margin + (size * CAP_HEIGHT) / 2;
  let x =
    horizontal === 'center'
      ? (o.viewWidth - o.imageWidth) / 2
      : horizontal === 'left'
        ? CLOSE_UP_PAD - margin
        : o.viewWidth - CLOSE_UP_PAD - (o.imageWidth - margin);
  let y = o.viewHeight / 2 - middleY;
  const clamp = (value: number, view: number, image: number) => (image <= view ? (view - image) / 2 : Math.min(0, Math.max(view - image, value)));
  x = clamp(x, o.viewWidth, o.imageWidth);
  y = clamp(y, o.viewHeight, o.imageHeight);
  return { x, y };
}

// Images to PDF ---------------------------------------------------------------------------------

/** 279 pt is the most an A4 page can take and keep 36 pt for the image (imagesToPdf's rule). */
export const IMAGE_MARGIN = { min: 0, max: 279, default: 28 } as const;

export function readImageMargin(text: string): { marginPt: number; error: null } | { marginPt: null; error: string } {
  const value = decimal(text);
  if (!(value >= IMAGE_MARGIN.min && value <= IMAGE_MARGIN.max)) {
    return { marginPt: null, error: `Enter a margin from ${IMAGE_MARGIN.min} to ${IMAGE_MARGIN.max} points.` };
  }
  return { marginPt: value, error: null };
}

/** Points to millimetres, for the hint beside a margin. */
export const ptToMm = (pt: number) => (pt * 25.4) / 72;

// PDF to images ---------------------------------------------------------------------------------

// Typical bytes per pixel for rendered document pages: text pages compress far better than scans,
// so this is a planning figure, not a limit. The real sizes are checked as the pages are made.
const A4_SQUARE_INCHES = 8.27 * 11.69;
const BYTES_PER_PIXEL = { png: 0.25, jpg: 0.12 } as const;

export function estimateImageBytes(pages: number, dpi: 100 | 150 | 300, format: 'png' | 'jpg'): number {
  return Math.round(pages * A4_SQUARE_INCHES * dpi * dpi * BYTES_PER_PIXEL[format]);
}

/**
 * A warning (not a refusal) when the estimate is more than the room left: the estimate is a
 * planning figure, and the real sizes are checked as the images are made. It suggests only what
 * the chosen resolution and type are not already using (the same rule as the run's own messages).
 */
export function imageBudgetWarning(
  estimate: number,
  listBytes: number,
  maxBytes: number,
  choice: { dpi: 100 | 150 | 300; format: 'png' | 'jpg' },
): string | null {
  const left = Math.max(0, maxBytes - listBytes);
  if (estimate <= left) return null;
  const smaller = ['fewer pages', choice.dpi > 100 ? 'a lower resolution' : null, choice.format === 'png' ? 'JPG' : null].filter((x): x is string => x !== null);
  const advice =
    smaller.length === 1
      ? '. Choosing fewer pages makes them smaller.'
      : `; ${smaller.slice(0, -1).join(', ')} or ${smaller[smaller.length - 1]} make them smaller.`;
  return `These images may come to about ${formatBytes(estimate)}, more than the ${formatBytes(left)} left in the list (${formatBytes(maxBytes)} at most). If they do not fit, the run stops and nothing is added${advice}`;
}

// Progress --------------------------------------------------------------------------------------

/** Passes at most one update per interval, plus the last one and any change of label. */
export function throttleProgress(
  report: (done: number, total: number, label?: string) => void,
  intervalMs = 100,
  now: () => number = () => Date.now(),
): (done: number, total: number, label?: string) => void {
  let last = Number.NEGATIVE_INFINITY;
  let lastLabel: string | undefined;
  return (done, total, label) => {
    const t = now();
    const final = total > 0 && done >= total;
    if (!final && label === lastLabel && t - last < intervalMs) return;
    last = t;
    lastLabel = label;
    report(done, total, label);
  };
}
