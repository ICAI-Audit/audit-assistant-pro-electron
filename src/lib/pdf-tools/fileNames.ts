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

const ELLIPSIS = '…';
/** Below this many characters before an earlier cut, a fresh cut is made instead of shortening it. */
const MIN_HEAD = 8;

/** Joins the two ends of a cut: no half of a character pair, no dot or space either side of the "…". */
function joinCut(head: string, tail: string): string {
  const start = head.replace(/[\uD800-\uDBFF]$/, '').replace(/[. ]+$/, '');
  const end = tail.replace(/^[\uDC00-\uDFFF]/, '').replace(/^[. ]+/, '');
  return `${start}${ELLIPSIS}${end}`;
}

/**
 * Shortens `text` to at most `limit` UTF-16 units by cutting its middle, so that its start and its end
 * stay (QA-FIX G: "…for AY 2025-26 - final copy v3 revised" is the part that tells two files apart). A
 * name cut before is cut again at the same place: its end stays and there is never a second "…".
 */
export function cutMiddle(text: string, limit: number): string {
  if (text.length <= limit) return text;
  if (limit < 3) return text.slice(0, limit).replace(/[\uD800-\uDBFF]$/, '');
  const at = text.indexOf(ELLIPSIS);
  if (at > 0 && at < text.length - 1) {
    const tail = text.slice(at + 1);
    const room = limit - 1 - tail.length;
    if (room >= MIN_HEAD) return joinCut(text.slice(0, room), tail);
  }
  const keep = limit - 1;
  const headLength = Math.ceil(keep / 2);
  return joinCut(text.slice(0, headLength), text.slice(text.length - (keep - headLength)));
}

/** Cuts to `limit` UTF-16 units in the middle (cutMiddle), then trims dots and spaces at the ends. */
function fit(base: string, limit: number): string {
  const out = trimDotsAndSpaces(cutMiddle(base, limit));
  return out === '' || out === ELLIPSIS ? FALLBACK_BASE : out;
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
