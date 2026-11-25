// Watermark, stamp and logo drawn on pages (design 5.16). Placement, layers, opacity and the handling of
// the page's own content are in marks.ts; this file holds the options, their checks and the page loop.
import type { PDFDocument, PDFImage } from 'pdf-lib';
import {
  type DisplayedPage,
  addImageMark,
  addTextMark,
  assertPrintable,
  autoSize,
  diagonalAngle,
  displayedPage,
  embedMarkFont,
  emptyMarkReport,
  hasWidgets,
  type MarkHooks,
  type MarkReport,
  type FontFamily,
  type Placement,
  HIDDEN_SHARE,
  markRegion,
  PRODUCER,
  pageCoverage,
  pageHealth,
  pageListedTwice,
  prepareMarks,
  textWidth,
  CAP_HEIGHT,
} from './marks';
import { isStop, loadPaced, pacer, savePaced } from './pace';
import { PdfToolsError } from './types';

export type { Anchor, FontFamily, MarkHooks, MarkReport, Placement } from './marks';
export { emptyMarkReport };
export interface Rgb { r: number; g: number; b: number } // each 0..1

export interface WatermarkOptions {
  watermark?: { text: string; font: FontFamily; bold: boolean; italic: boolean; size: number | 'auto'; angle: 'diagonal' | number; placement: Placement; color: Rgb; opacity: number; layer: 'behind' | 'front' };
  stamp?: { text: string; size: number; bold: boolean; color: Rgb; opacity: number; angle: number; placement: Placement };
  /** The image's own bytes, taken from a working-list image: the options hold no path. Already prepared (downscaled) by the caller. */
  logo?: { image: Uint8Array; format: 'png' | 'jpeg'; widthShare: number; opacity: number; placement: Placement };
  pages: { from: number; to: number } | 'first';
  tokens: { date: string; client: string };
}

// Defaults of design 5.16 (the owner's earlier tool's numbers where it had them).
export const WATERMARK_DEFAULTS = {
  watermark: { text: 'DRAFT', font: 'helvetica', bold: true, italic: false, size: 'auto', angle: 'diagonal', color: { r: 0.5, g: 0.5, b: 0.5 }, opacity: 0.25, layer: 'front', placement: { anchor: 'center', padPt: 0 } },
  stamp: { size: 20, bold: true, color: { r: 0.627, g: 0, b: 0 }, opacity: 0.78, angle: 0, placement: { anchor: 'top-right', padPt: 20 } },
  logo: { widthShare: 0.18, opacity: 1, placement: { anchor: 'top-left', padPt: 20 } },
} as const;
const LOGO_MAX_HEIGHT_SHARE = 0.35;
const LOGO_MIN_WIDTH_PT = 28;
const AUTO_SHARE = 0.8;
const MAX_LOGO_PIXELS = 25_000_000;

const FONTS: FontFamily[] = ['helvetica', 'times', 'courier'];
const validColor = (c: Rgb | undefined): boolean => !!c && [c.r, c.g, c.b].every((x) => Number.isFinite(x) && x >= 0 && x <= 1);
const inRange = (x: unknown, lo: number, hi: number): boolean => typeof x === 'number' && Number.isFinite(x) && x >= lo && x <= hi;

function placementError(p: Placement | undefined, what: string): string | null {
  const ANCHORS = ['top-left', 'top-center', 'top-right', 'middle-left', 'center', 'middle-right', 'bottom-left', 'bottom-center', 'bottom-right'];
  if (!p) return `Choose where the ${what} should go.`;
  if ('point' in p) return inRange(p.point?.u, 0, 1) && inRange(p.point?.v, 0, 1) ? null : `Click inside the page to place the ${what}.`;
  if (!ANCHORS.includes(p.anchor)) return `Choose where the ${what} should go.`;
  return inRange(p.padPt, 0, 144) ? null : `Enter a distance from the edge between 0 and 144 points for the ${what}.`;
}

/** The first thing wrong with the options, in the words the dialog shows, or null. */
export function watermarkError(options: WatermarkOptions, pageCount: number): string | null {
  const { watermark, stamp, logo, pages } = options;
  if (!watermark && !stamp && !logo) return 'Turn on at least one of the watermark, the stamp and the logo.';
  if (pages === 'first' && pageCount < 1) return 'This file has no pages to mark.';
  if (pages !== 'first') {
    if (!pages || !Number.isInteger(pages.from) || !Number.isInteger(pages.to) || pages.from < 1 || pages.to > pageCount || pages.from > pages.to) {
      return `Enter a page range between 1 and ${pageCount}, with the first page not after the last.`;
    }
  }
  if (watermark) {
    if (typeof watermark.text !== 'string' || [...watermark.text.trim()].length < 1 || [...watermark.text].length > 60) return 'Enter watermark text of 1 to 60 characters.';
    if (!FONTS.includes(watermark.font)) return 'Choose a font for the watermark.';
    if (watermark.size !== 'auto' && !inRange(watermark.size, 12, 200)) return 'Enter a watermark size from 12 to 200, or choose Auto.';
    if (watermark.angle !== 'diagonal' && !inRange(watermark.angle, -90, 90)) return 'Enter a watermark angle from -90 to 90 degrees.';
    const wt = markTokenError(watermark.text, 'watermark');
    if (wt) return wt;
    if (!validColor(watermark.color)) return 'Choose a valid colour for the watermark.';
    if (!inRange(watermark.opacity, 0.05, 1)) return 'Enter a watermark opacity from 5% to 100%.';
    if (watermark.layer !== 'behind' && watermark.layer !== 'front') return 'Choose whether the watermark goes in front of the page or behind it.';
    const p = placementError(watermark.placement, 'watermark');
    if (p) return p;
  }
  if (stamp) {
    if (typeof stamp.text !== 'string' || [...stamp.text.trim()].length < 1 || [...stamp.text].length > 60) return 'Enter stamp text of 1 to 60 characters.';
    if (!inRange(stamp.size, 8, 72)) return 'Enter a stamp size from 8 to 72.';
    if (!inRange(stamp.angle, -90, 90)) return 'Enter a stamp angle from -90 to 90 degrees.';
    const st = markTokenError(stamp.text, 'stamp');
    if (st) return st;
    if (!validColor(stamp.color)) return 'Choose a valid colour for the stamp.';
    if (!inRange(stamp.opacity, 0.05, 1)) return 'Enter a stamp opacity from 5% to 100%.';
    const p = placementError(stamp.placement, 'stamp');
    if (p) return p;
  }
  if (logo) {
    if (!(logo.image instanceof Uint8Array) || logo.image.length === 0 || (logo.format !== 'png' && logo.format !== 'jpeg')) return 'Choose a PNG or JPG image for the logo.';
    if (!inRange(logo.widthShare, 0.05, 0.5)) return 'Enter a logo width from 5% to 50% of the page width.';
    if (!inRange(logo.opacity, 0.1, 1)) return 'Enter a logo opacity from 10% to 100%.';
    const p = placementError(logo.placement, 'logo');
    if (p) return p;
  }
  return null;
}

function invalid(message: string): PdfToolsError {
  return new PdfToolsError('invalid-watermark-options', message);
}

/**
 * The tokens a stamp or watermark text may use: `{date}` and `{client}` (5.17), in any letter case.
 * What was filled in is not read again.
 */
export function fillMarkTokens(text: string, tokens: { date: string; client: string }): string {
  return text.replace(/\{(date|client)\}/gi, (_, name: string) => tokens[name.toLowerCase() as 'date' | 'client']);
}
export const fillStampTokens = fillMarkTokens;

/** Names the first brace token that is not `{date}` or `{client}`, or null. A brace that does not close is plain text. */
function markTokenError(text: string, what: string): string | null {
  for (const m of text.matchAll(/\{([^{}]*)\}/g)) {
    if (!/^(date|client)$/i.test(m[1])) return `The ${what} text has {${m[1]}}, which is not a known name. Use {date} or {client}.`;
  }
  return null;
}

/**
 * The record text of the run: "Watermark DRAFT, stamp (custom text), logo, pages 1-12". `words` says what
 * each text is in the record (a ready-made text, a template of tokens, or "(custom text)": activity.ts
 * typedTextRecord), never the text as typed; without them the parts are only named. The logo is never named:
 * its file name is not recorded.
 */
export function describeWatermark(options: WatermarkOptions, pageCount: number, words: { watermark?: string; stamp?: string } = {}): string {
  const parts: string[] = [];
  if (options.watermark) parts.push(words.watermark ? `Watermark ${words.watermark}` : 'Watermark');
  if (options.stamp) parts.push(words.stamp ? `stamp ${words.stamp}` : 'stamp');
  if (options.logo) parts.push('logo');
  const pages = options.pages === 'first' ? 'page 1' : options.pages.from === options.pages.to ? `page ${options.pages.from}` : `pages ${options.pages.from}-${options.pages.to}`;
  const all = options.pages !== 'first' && options.pages.from === 1 && options.pages.to === pageCount;
  const text = parts.join(', ');
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}, ${all ? 'all pages' : pages}`;
}

/** Width x height from the header, without decoding: PNG (IHDR) and JPEG (the start-of-frame marker). 0 when unknown. */
function imagePixels(bytes: Uint8Array): number {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50) return v.getUint32(16) * v.getUint32(20);
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) { i++; continue; }
      const marker = bytes[i + 1];
      if (marker === 0xff) { i++; continue; }
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return v.getUint16(i + 5) * v.getUint16(i + 7);
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      i += 2 + v.getUint16(i + 2);
    }
  }
  return 0;
}

/** The words the dialog says (marks/markText.ts markTextError) for a text that {client} and {date} leave empty. */
const emptyText = (what: 'watermark' | 'stamp') => invalid(`This engagement has no client name, so the ${what} would be empty. Type the text instead.`);

export async function addWatermark(file: Uint8Array, options: WatermarkOptions, hooks: MarkHooks = {}): Promise<Uint8Array> {
  let doc: PDFDocument;
  try {
    doc = await loadPaced(file, { updateMetadata: false, check: hooks.check });
  } catch (error) {
    if (isStop(error)) throw error; // the run's own Stop, pressed while the file was read
    throw new PdfToolsError('not-a-pdf', 'This file could not be read as a PDF. It may be damaged or protected.');
  }
  const pages = doc.getPages();
  const error = watermarkError(options, pages.length);
  if (error) throw invalid(error);

  const first = options.pages === 'first' ? 1 : options.pages.from;
  const last = options.pages === 'first' ? 1 : options.pages.to;
  const { watermark, stamp, logo } = options;
  // Without tokens a {client} or {date} is filled with nothing (and refused below if nothing is left).
  const tokens = options.tokens ?? { date: '', client: '' };

  // Fonts and texts first: refuse unsupported characters before anything is drawn.
  const wmFont = watermark ? await embedMarkFont(doc, watermark.font, watermark.bold, watermark.italic) : null;
  const stampFont = stamp ? await embedMarkFont(doc, 'helvetica', stamp.bold, false) : null;
  const stampText = stamp ? fillMarkTokens(stamp.text, tokens) : '';
  const wmText = watermark ? fillMarkTokens(watermark.text, tokens) : '';
  if (watermark && wmFont) {
    assertPrintable(wmFont, watermark.text, 'watermark text');
    assertPrintable(wmFont, wmText, 'client name or date used in the watermark text');
    // REV-A M4: "{client}" with no client name would print nothing and still report success.
    if (wmText.trim() === '') throw emptyText('watermark');
  }
  if (stamp && stampFont) {
    assertPrintable(stampFont, stamp.text, 'stamp text');
    assertPrintable(stampFont, stampText, 'client name or date used in the stamp text');
    if (stampText.trim() === '') throw emptyText('stamp');
  }

  let image: PDFImage | null = null;
  if (logo) {
    if (imagePixels(logo.image) > MAX_LOGO_PIXELS) throw invalid('The logo image is too large. Use a smaller picture.');
    try {
      image = logo.format === 'png' ? await doc.embedPng(logo.image) : await doc.embedJpg(logo.image);
    } catch {
      throw invalid('The logo image could not be read. Use a PNG or JPG picture.');
    }
  }

  // Check every page first so a failure leaves nothing half-marked and names the first page that is too small.
  const twice = pageListedTwice(pages, first, last);
  if (twice) throw invalid(`Pages ${twice[0]} and ${twice[1]} are one page listed twice in this file, so they cannot be marked separately. The file may be damaged.`);
  const pace = pacer();
  for (let n = first; n <= last; n++) {
    let d: DisplayedPage;
    try {
      d = displayedPage(pages[n - 1]);
    } catch {
      // A box, turn or page tree pdf-lib cannot read (REV-A S2): refused plainly, naming the page.
      throw invalid(`Page ${n} could not be read, so it cannot be marked. The file may be damaged.`);
    }
    // REV-A M5: a page with no size would get a mark no one can see.
    if (!(d.width > 0 && d.height > 0)) throw invalid(`Page ${n} has no size, so it cannot be marked. The file may be damaged.`);
    await pace();
    if (stamp && stampFont) {
      const w = textWidth(stampFont, stampText, stamp.size);
      const h = stamp.size * CAP_HEIGHT;
      const rad = (stamp.angle * Math.PI) / 180;
      const bw = Math.abs(w * Math.cos(rad)) + Math.abs(h * Math.sin(rad));
      const bh = Math.abs(w * Math.sin(rad)) + Math.abs(h * Math.cos(rad));
      const pad = 'padPt' in stamp.placement ? stamp.placement.padPt : 0;
      if (bw + 2 * pad > d.width || bh + 2 * pad > d.height) throw invalid(`The stamp does not fit on page ${n}. Use shorter text, a smaller size or a smaller distance from the edge.`);
    }
    if (logo && image) {
      const pad = 'padPt' in logo.placement ? logo.placement.padPt : 0;
      if (LOGO_MIN_WIDTH_PT + 2 * pad > d.width || 2 * pad >= d.height) throw invalid(`The logo does not fit on page ${n}. Use a smaller distance from the edge.`);
    }
  }

  const total = last - first + 1;
  await prepareMarks(doc, pace);
  const report = hooks.report;
  for (let n = first; n <= last; n++) {
    await hooks.onPage?.(n - first, total);
    await pace();
    const page = pages[n - 1];
    const d = displayedPage(page);
    let front = false;
    if (watermark && wmFont) {
      const angle = watermark.angle === 'diagonal' ? diagonalAngle(d) : watermark.angle;
      const size = watermark.size === 'auto' ? autoSize(wmText, wmFont, d, angle, AUTO_SHARE) : watermark.size;
      const where = markRegion(d, textWidth(wmFont, wmText, size), size * CAP_HEIGHT, angle, watermark.placement);
      if (report && !where.inside) report.clipped.push(n);
      if (watermark.layer === 'behind' && report) {
        // Hidden is judged by what lies over the watermark's own area, not over the page.
        const c = pageCoverage(page, where.region);
        if (c.known && c.covered >= HIDDEN_SHARE) report.hiddenBehind.push(n);
        else if (c.known && c.covered + c.unknown >= HIDDEN_SHARE) report.uncertain.push(n);
      }
      addTextMark(doc, page, { text: wmText, font: wmFont, size, angleDeg: angle, opacity: watermark.opacity, color: watermark.color, placement: watermark.placement, layer: watermark.layer });
      if (watermark.layer === 'front') front = true;
    }
    if (logo && image) {
      addImageMark(doc, page, { image, widthShare: logo.widthShare, maxHeightShare: LOGO_MAX_HEIGHT_SHARE, minWidthPt: LOGO_MIN_WIDTH_PT, opacity: logo.opacity, placement: logo.placement });
      front = true;
    }
    if (stamp && stampFont) {
      addTextMark(doc, page, { text: stampText, font: stampFont, size: stamp.size, angleDeg: stamp.angle, opacity: stamp.opacity, color: stamp.color, placement: stamp.placement, layer: 'front' });
      front = true;
    }
    if (report) {
      const health = pageHealth(page);
      if (front && health.damaged) report.damaged.push(n);
      if (health.unverified) report.unverified.push(n);
      if (front && hasWidgets(page)) report.underFields.push(n);
    }
  }
  await hooks.onPage?.(total, total);
  // An edit of the source in place: Producer and modification date are ours, the Creator stays (REV-A S12).
  doc.setProducer(PRODUCER);
  doc.setModificationDate(new Date());
  return savePaced(doc);
}
