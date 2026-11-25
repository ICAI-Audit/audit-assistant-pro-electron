// A file's words and ruling lines, page by page, for PDF to Excel and PDF to Word (T-064; design 5.11).
//
// Words come from the page renderer's text (pdf.js), each with its box; lines come from the page's own
// content (rulingLines.ts, pdf-lib). Both are given in display coordinates, as layout.ts wants them:
// points, origin at the top-left corner of the page as shown after /Rotate, y growing downwards.
//
// One page is read per call, so a 500-page file never holds the window: the caller's loop goes page by
// page, and the reader gives the window a turn inside a page too when one is due (pace.ts). Nothing read
// is kept after the call returns, logged or stored.
//
// How each word is set (T-064, the quality round) comes from the page's own content too: where each run of
// text starts, with its font and colour (rulingLines.ts pageDrawings); a word takes the look of the run it
// lies in (the nearest start before it on its baseline). The page's filled boxes and pictures are passed on
// by their boxes; a picture's file is made only when asked for.
//
// Invisible text (text rendering mode 3, as a recognition layer over a scan writes it) is told from the page's content
// as well: a word of an invisible run is marked `hidden`, and so is every word of a page all of whose text is
// invisible. Such a word carries no colour: the layer's fill colour was never shown, and may be white.
import type { PDFDocument } from 'pdf-lib';
import type { PageExtras, PageWords, Segment, Word } from '@/lib/pdf-tools/layout';
import { dingbatSign, RUPEE_SIGN } from '@/lib/pdf-tools/pdfFontLook';
import { pictureFile, type PictureFile } from '@/lib/pdf-tools/pdfPictures';
import { isStop, loadPaced, pacer } from '@/lib/pdf-tools/pace';
import { buildPageText, wordRanges, wordRect, type FontStyleLike, type MeasureChar, type TextItemLike } from '@/lib/pdf-tools/pageText';
import { displayTransform, pageDrawings, type TextStart } from '@/lib/pdf-tools/rulingLines';
import * as renderer from '../pdfRenderer';
import { createCanvasMeasure } from '../viewer/canvasMeasure';

export interface WordsReader {
  pageCount: number;
  /** Page `i` (0-based): its words and its ruling lines, in display coordinates. */
  page(i: number): Promise<PageRead>;
  /** Lets go of what the reader holds. Call it when the run ends, however it ends. */
  close(): void;
}

export interface PageRead {
  words: PageWords;
  segments: Segment[];
  /** The page's filled boxes and the boxes of its pictures, in display coordinates. */
  extras?: PageExtras;
  /** Picture `index` of `extras.pictures` as a file, or null when it is of a kind that is not carried over. */
  picture?: (index: number) => PictureFile | null;
}

/** What the reader reads with: the page renderer in the application, pdf.js in Node in the tests. */
export interface WordsSource {
  pageTextContent(file: Uint8Array, pageIndex: number, options?: { signal?: AbortSignal }): Promise<{ items: TextItemLike[]; styles: Record<string, FontStyleLike> }>;
  pageGeometries(file: Uint8Array, options?: { signal?: AbortSignal }): Promise<{ view: [number, number, number, number]; rotate: number; userUnit: number }[]>;
  /** A measure of character widths (a canvas in the application), and how to let it go. */
  createMeasure(): { measure: MeasureChar; clear(): void };
  /** The file opened for reading its lines; `check` throws to stop. */
  loadDocument(file: Uint8Array, check: () => void): Promise<PDFDocument>;
}

const aborted = (): DOMException => new DOMException('Aborted', 'AbortError');

/** Two drawings of one word (bold made by drawing twice) lie within this of each other on every side. */
const SAME_WORD_PT = 1;
/** Words are placed this many at a time between looks at the clock. */
const WORDS_PER_LOOK = 128;
/** A run's start lies within this of the baseline of the words it sets, and at most this far past a word's own start. */
const SAME_BASELINE_PT = 1.2;
const START_SLACK_PT = 1.5;

/** The starts of text runs, found by baseline: across the page for upright text, down it for turned text. */
function startsIndex(starts: readonly TextStart[]): (turn: number, baseline: number, from: number, to: number) => { start: TextStart; before: number } | null {
  const byY = new Map<number, TextStart[]>();
  const byX = new Map<number, TextStart[]>();
  for (const s of starts) {
    for (const [map, key] of [[byY, Math.round(s.y)], [byX, Math.round(s.x)]] as const) {
      const list = map.get(key);
      if (list) list.push(s);
      else map.set(key, [s]);
    }
  }
  return (turn, baseline, from, to) => {
    const across = turn === 0 || turn === 180;
    const map = across ? byY : byX;
    let best: TextStart | null = null;
    let bestAt = Infinity;
    for (let key = Math.round(baseline) - 2; key <= Math.round(baseline) + 2; key++) {
      for (const s of map.get(key) ?? []) {
        if (Math.abs((across ? s.y : s.x) - baseline) > SAME_BASELINE_PT) continue;
        // How far before the word's own start the run starts, along the way the text reads.
        const before = turn === 0 ? from - s.x : turn === 180 ? s.x - to : turn === 90 ? s.y - to : from - s.y;
        if (before < -START_SLACK_PT || before >= bestAt) continue;
        best = s;
        bestAt = before;
      }
    }
    return best ? { start: best, before: bestAt } : null;
  };
}

/** A reader over `source` (the test seam; the application uses openWordsReader). */
export function createWordsReader(source: WordsSource): (file: Uint8Array, opts?: { signal?: AbortSignal }) => Promise<WordsReader> {
  return async (file, opts = {}) => {
    const { signal } = opts;
    const check = () => {
      if (signal?.aborted) throw aborted();
    };
    check();
    const geometries = await source.pageGeometries(file, { signal });
    check();
    // The file as pdf-lib reads it, for its lines. A file pdf-lib cannot read still gives its words:
    // its tables are then found from how the text lines up.
    let doc: PDFDocument | null = null;
    try {
      doc = await source.loadDocument(file, check);
    } catch (error) {
      if (isStop(error) || signal?.aborted) throw error;
      doc = null;
    }
    check();
    let measure: ReturnType<WordsSource['createMeasure']> | null = source.createMeasure();
    const pace = pacer(check);
    let closed = false;
    const files = new Map<unknown, PictureFile | null>();

    return {
      pageCount: geometries.length,
      async page(i) {
        if (closed || !measure) throw new Error('The words reader is closed.');
        if (!Number.isInteger(i) || i < 0 || i >= geometries.length) throw new RangeError(`No page ${i}.`);
        check();
        const geometry = geometries[i];
        const content = await source.pageTextContent(file, i, { signal });
        check();
        let turn = pace();
        if (turn) await turn;
        const unit = Number.isFinite(geometry.userUnit) && geometry.userUnit > 0 ? geometry.userUnit : 1;
        const model = buildPageText(i, content.items, content.styles, geometry.view, geometry.rotate);
        const sideways = model.rotate === 90 || model.rotate === 270;
        const viewWidth = (model.view[2] - model.view[0]) * unit;
        const viewHeight = (model.view[3] - model.view[1]) * unit;
        const width = sideways ? viewHeight : viewWidth;
        const height = sideways ? viewWidth : viewHeight;
        const place = displayTransform(model.view, model.rotate, unit);
        const words: Word[] = [];
        const drawings = doc && !closed ? pageDrawings(doc, i) : null;
        const startOf = drawings && drawings.starts.length > 0 ? startsIndex(drawings.starts) : null;
        const allHidden = drawings?.hiddenText === 'all';
        const seen = new Map<string, Word[]>();
        // The renderer's name for a font, and the font it is in the file: told from the words that stand right where a run starts.
        const votes = new Map<string, Map<string, number>>();
        const styled: { word: Word; name: string }[] = [];
        // Only on a page that uses the standard symbol font: each word with the renderer's font name of each of its characters.
        let anySigns = false;
        if (drawings) for (const look of drawings.fonts.values()) if (look.signs) anySigns = true;
        const lettered: { word: Word; names: string[] }[] = [];
        const ranges = wordRanges(model);
        for (let k = 0; k < ranges.length; k++) {
          if (k > 0 && k % WORDS_PER_LOOK === 0) {
            turn = pace();
            if (turn) await turn;
            if (closed || !measure) throw aborted();
          }
          const range = ranges[k];
          const at = model.map[range[0]];
          if (!at) continue;
          const rect = wordRect(model, range, measure.measure);
          const a = place(rect.x0, rect.y0);
          const b = place(rect.x1, rect.y1);
          const x0 = Math.min(a[0], b[0]);
          const y0 = Math.min(a[1], b[1]);
          const x1 = Math.max(a[0], b[0]);
          const y1 = Math.max(a[1], b[1]);
          // Text outside the visible page is not on the page a reader sees.
          if (!(x1 > 0 && y1 > 0 && x0 < width && y0 < height)) continue;
          const item = model.items[at[0]];
          const text = model.text.slice(range[0], range[1]);
          const again = seen.get(text);
          if (again?.some((w) => Math.abs(w.x0 - x0) <= SAME_WORD_PT && Math.abs(w.x1 - x1) <= SAME_WORD_PT && Math.abs(w.y0 - y0) <= SAME_WORD_PT && Math.abs(w.y1 - y1) <= SAME_WORD_PT)) continue;
          const size = (Math.hypot(item.transform[2], item.transform[3]) || item.height || Math.hypot(item.transform[0], item.transform[1]) || 0) * unit;
          const word: Word = { text, x0, y0, x1, y1, size, font: item.fontName };
          if (allHidden) word.hidden = true;
          // Which way it reads, how far it is stretched, and the look of the run it lies in.
          const t = item.transform;
          const o = place(t[4], t[5]);
          const along = place(t[4] + t[0], t[5] + t[1]);
          const dx = along[0] - o[0];
          const dy = along[1] - o[1];
          const reads = Math.min(Math.abs(dx), Math.abs(dy)) > 0.17 * Math.max(Math.abs(dx), Math.abs(dy)) ? -1 : Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 0 : 180) : dy < 0 ? 90 : 270;
          if (reads !== 0) word.turn = reads;
          const wide = Math.hypot(t[0], t[1]);
          const tall = Math.hypot(t[2], t[3]);
          if (wide > 0 && tall > 0 && Math.abs(wide / tall - 1) > 0.02) word.stretch = Math.round((wide / tall) * 100) / 100;
          if (startOf && reads >= 0) {
            const upright = reads === 0 || reads === 180;
            const hit = startOf(reads, upright ? o[1] : o[0], upright ? x0 : y0, upright ? x1 : y1);
            const start = hit?.start;
            const look = start ? drawings?.fonts.get(start.font) : undefined;
            if (look) {
              word.family = look.family;
              if (look.bold) word.bold = true;
              if (look.italic) word.italic = true;
            }
            if (start?.hidden) word.hidden = true;
            if (start && start.color !== '000000' && !word.hidden) word.color = start.color;
            styled.push({ word, name: item.fontName });
            if (start && start.font !== '' && hit.before <= START_SLACK_PT) {
              let byFont = votes.get(item.fontName);
              if (!byFont) votes.set(item.fontName, (byFont = new Map()));
              byFont.set(start.font, (byFont.get(start.font) ?? 0) + 1);
            }
          }
          words.push(word);
          if (again) again.push(word);
          else seen.set(text, [word]);
          if (anySigns) {
            const names: string[] = [];
            let from = at[0];
            for (let c = range[0]; c < range[1]; c++) {
              const index = model.map[c]?.[0] ?? at[0];
              const piece = model.items[index] ?? item;
              names.push(piece.fontName);
              if (index === from || !startOf || reads !== 0) continue;
              // A piece of another font inside the word (a sign between brackets): which font of the file is it in?
              from = index;
              const origin = place(piece.transform[4], piece.transform[5]);
              const hit = startOf(0, origin[1], origin[0], origin[0]);
              if (hit && hit.start.font !== '' && hit.before <= START_SLACK_PT) {
                let byFont = votes.get(piece.fontName);
                if (!byFont) votes.set(piece.fontName, (byFont = new Map()));
                byFont.set(hit.start.font, (byFont.get(hit.start.font) ?? 0) + 1);
              }
            }
            lettered.push({ word, names });
          }
        }
        // A run that changes font in the middle of a line has no start of its own: its words take the look of
        // the font the renderer names for them.
        for (const { word, name } of styled) {
          const byFont = votes.get(name);
          if (!byFont) continue;
          let best = '';
          let most = 0;
          for (const [font, n] of byFont) if (n > most) [best, most] = [font, n];
          const look = drawings?.fonts.get(best);
          if (!look) continue;
          word.family = look.family;
          if (look.bold) word.bold = true;
          else delete word.bold;
          if (look.italic) word.italic = true;
          else delete word.italic;
        }
        // Text of the standard symbol font is character codes of its own: each becomes the sign the page shows. The one
        // letter a page sets in a font that names itself a rupee font is the rupee sign.
        if (anySigns) {
          const signFonts = new Map<string, 'dingbats' | 'rupee'>();
          for (const [name, byFont] of votes) {
            let best = '';
            let most = 0;
            for (const [font, n] of byFont) if (n > most) [best, most] = [font, n];
            const signs = drawings?.fonts.get(best)?.signs;
            if (signs) signFonts.set(name, signs);
          }
          // Which letters the page sets in each rupee font: only a font used for one letter is read as the sign.
          const letters = new Map<string, Set<string>>();
          for (const { word, names } of lettered) {
            if (names.length !== word.text.length) continue;
            for (let c = 0; c < names.length; c++) {
              if (signFonts.get(names[c]) !== 'rupee') continue;
              let set = letters.get(names[c]);
              if (!set) letters.set(names[c], (set = new Set()));
              set.add(word.text[c]);
            }
          }
          const signOf = (name: string, text: string, c: number): string | null => {
            const signs = signFonts.get(name);
            if (signs === 'dingbats') return dingbatSign(text.charCodeAt(c));
            if (signs === 'rupee' && letters.get(name)?.size === 1) return RUPEE_SIGN;
            return null;
          };
          if (signFonts.size > 0) {
            for (const { word, names } of lettered) {
              if (names.length !== word.text.length || !names.some((n) => signFonts.has(n))) continue;
              let out = '';
              for (let c = 0; c < names.length; c++) out += signOf(names[c], word.text, c) ?? word.text[c];
              word.text = out;
            }
          }
        }
        turn = pace();
        if (turn) await turn;
        check();
        const pictures = drawings?.pictures ?? [];
        return {
          words: { pageIndex: i, width, height, words },
          segments: drawings?.segments ?? [],
          extras: { shades: drawings?.shades ?? [], pictures: pictures.map((p) => ({ x0: p.x0, y0: p.y0, x1: p.x1, y1: p.y1, alpha: p.alpha })), ...(drawings && drawings.strokes.length > 0 ? { strokes: drawings.strokes } : {}) },
          picture: (index) => {
            const image = pictures[index]?.image;
            if (!image) return null;
            // One file for a picture however many pages show it (a logo on every page).
            let file = files.get(image);
            if (file === undefined) files.set(image, (file = pictureFile(image)));
            return file;
          },
        };
      },
      close() {
        closed = true;
        doc = null;
        measure?.clear();
        measure = null;
      },
    };
  };
}

const appSource: WordsSource = {
  pageTextContent: (file, pageIndex, options) => renderer.pageTextContent(file, pageIndex, { ...options, priority: 'run' }),
  pageGeometries: (file, options) => renderer.pageGeometries(file, { ...options, priority: 'run' }),
  createMeasure: createCanvasMeasure,
  loadDocument: (file, check) => loadPaced(file, { ignoreEncryption: true, updateMetadata: false, check }),
};

/**
 * Opens `file` for reading its words and ruling lines page by page. Rejects with an AbortError when
 * `opts.signal` is aborted (at open, or in a page read), and with the renderer's own error when the
 * file cannot be read. A word's `font` is the renderer's name for its font on that page: it tells one
 * font from another, nothing more.
 */
export function openWordsReader(file: Uint8Array, opts?: { signal?: AbortSignal }): Promise<WordsReader> {
  return createWordsReader(appSource)(file, opts);
}
