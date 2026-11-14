const MAX_NAME_LENGTH = 120;
const FALLBACK_BASE = 'document';
const RESERVED = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;
// Characters Windows refuses, control characters, and the line and paragraph separators.
// eslint-disable-next-line no-control-regex
const ILLEGAL = /[\\/:*?"<>|\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

const trimDotsAndSpaces = (s: string) => s.replace(/^[. ]+|[. ]+$/g, '');

/** Builds a safe file name ending in `.extension`, at most 120 characters, valid on Windows. */
export function cleanFileName(name: string, extension: string): string {
  const suffix = `.${extension.toLowerCase()}`;
  let base = name.replace(ILLEGAL, '_').replace(LONE_SURROGATE, '_').replace(/[. ]+$/, '');
  if (base.toLowerCase().endsWith(suffix)) base = base.slice(0, -suffix.length);
  base = trimDotsAndSpaces(base);
  if (base === '') base = FALLBACK_BASE;

  const limit = MAX_NAME_LENGTH - suffix.length;
  base = fit(base, limit);

  // Windows reserves these names even when an extension follows. This must be the
  // last transformation: cutting and trimming can expose a reserved stem, and the
  // added underscore is re-fitted (the stem is only a few characters, so it survives).
  const firstDot = base.indexOf('.');
  const stem = (firstDot === -1 ? base : base.slice(0, firstDot)).trimEnd();
  if (RESERVED.test(stem)) {
    base = fit(`${stem}_${base.slice(firstDot === -1 ? base.length : firstDot)}`, limit);
  }

  return base + suffix;
}

/** Cuts to `limit` UTF-16 units without splitting a surrogate pair, then trims dots and spaces. */
function fit(base: string, limit: number): string {
  let out = base.slice(0, limit);
  if (/[\uD800-\uDBFF]$/.test(out)) out = out.slice(0, -1);
  out = trimDotsAndSpaces(out);
  return out === '' ? FALLBACK_BASE : out;
}

/** Removes the last extension; a leading dot alone is not an extension. */
export function stripExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

const pad = (n: number, width: number) => String(n).padStart(width, '0');

/** Joins stem and ending; a stem too long for the name limit is cut (the ending never is). */
function withEnding(base: string, ending: string): string {
  if (trimDotsAndSpaces(base) === '') base = FALLBACK_BASE;
  return base.length + ending.length <= MAX_NAME_LENGTH ? base + ending : fit(base, MAX_NAME_LENGTH - ending.length) + ending;
}

export function partName(base: string, index: number, total: number): string {
  return withEnding(base, `_part_${pad(index, Math.max(2, String(total).length))}.pdf`);
}

export function pageImageName(base: string, pageNumber: number, total: number, ext: 'png' | 'jpg'): string {
  return withEnding(base, `_page_${pad(pageNumber, Math.max(3, String(total).length))}.${ext}`);
}
