// Redact's reading of a page as the renderer draws it (fix wave 3, ruling A: one reader, the renderer's own).
//
// pdf.js hands the drawing side an operator list per page: page content, forms however nested, soft-mask
// groups and annotation appearances (its own generated ones included) are in it in drawing order; a tiling
// pattern carries its own list in its arguments, and a Type 3 font its glyph procedures' lists. Text
// operations carry the glyphs pdf.js will paint, with their Unicode as pdf.js has them (from the font's map,
// or its glyph names, or its base encoding). This module reads that list: it never parses the file.
//
// Each text-painting operation is listed with the drawing it belongs to (the page's content, or the
// outermost annotation, form or group it sits in), its text, whether that text can be trusted, and where
// it painted (pdf.js `recordOperations`). `flaggedOperations` then says which operations hold a chosen
// value (read alone, joined in drawing order, in position order and down a column, with a word broken at
// a line end by a hyphen rejoined) or cannot be read. The run draws the page again with those operations
// skipped (`operationsFilter`): the two drawings, made by the same engine, differ only where they paint.
//
// Wave 4 (redact-fix-rules-5.md, ruling L): where each glyph lands is re-created here from pdf.js's own text
// state, and that re-creation is only a hint. `placeOperations` measures where each operation really painted
// (the page drawn again with operations skipped, compared pixel by pixel) and trusts the hint only where the
// two agree; an operation whose hint does not agree is unplaced, and one that holds any part of a chosen
// value is then covered whole over what it painted.
import { textBlocks, type PixelBox, type Rect } from '@/lib/pdf-tools/pageText';

/** pdf.js's operator ids this reading needs (pdfjs-dist `OPS`, passed in so that this module stays free of pdf.js). */
export interface OpIds {
  save: number;
  restore: number;
  transform: number;
  beginText: number;
  setTextMatrix: number;
  moveText: number;
  setLeadingMoveText: number;
  nextLine: number;
  setLeading: number;
  setCharSpacing: number;
  setWordSpacing: number;
  setHScale: number;
  setTextRise: number;
  setGState: number;
  setFont: number;
  setTextRenderingMode: number;
  showText: number;
  showSpacedText: number;
  nextLineShowText: number;
  nextLineSetSpacingShowText: number;
  setStrokeColorN: number;
  setFillColorN: number;
  paintFormXObjectBegin: number;
  paintFormXObjectEnd: number;
  beginGroup: number;
  endGroup: number;
  beginAnnotation: number;
  endAnnotation: number;
  paintImageXObject: number;
  paintImageXObjectRepeat: number;
  paintImageMaskXObject: number;
  paintImageMaskXObjectGroup: number;
  paintImageMaskXObjectRepeat: number;
  paintInlineImageXObject: number;
  paintInlineImageXObjectGroup: number;
  paintSolidColorImageMask: number;
}

/** The ids this reading needs, picked from pdfjs-dist's `OPS`. */
export function opIdsOf(OPS: Record<string, number>): OpIds {
  const names: (keyof OpIds)[] = [
    'save', 'restore', 'transform', 'beginText', 'setTextMatrix', 'moveText', 'setLeadingMoveText', 'nextLine', 'setLeading', 'setCharSpacing',
    'setWordSpacing', 'setHScale', 'setTextRise', 'setGState', 'setFont', 'setTextRenderingMode', 'showText', 'showSpacedText', 'nextLineShowText', 'nextLineSetSpacingShowText',
    'setStrokeColorN', 'setFillColorN', 'paintFormXObjectBegin', 'paintFormXObjectEnd', 'beginGroup', 'endGroup', 'beginAnnotation', 'endAnnotation',
    'paintImageXObject', 'paintImageXObjectRepeat', 'paintImageMaskXObject', 'paintImageMaskXObjectGroup', 'paintImageMaskXObjectRepeat',
    'paintInlineImageXObject', 'paintInlineImageXObjectGroup', 'paintSolidColorImageMask',
  ];
  const ids = {} as OpIds;
  for (const name of names) ids[name] = typeof OPS[name] === 'number' ? OPS[name] : -1;
  return ids;
}

/** An operator list as pdf.js gives it to the drawing side. */
export interface OperatorList {
  fnArray: ArrayLike<number>;
  argsArray: ArrayLike<unknown>;
}

/** A font as pdf.js hands it to the drawing side: only what this reading uses. */
export interface ViewFont {
  isType3Font?: boolean;
  /** Glyph space to text space (pdf.js `fontMatrix`; 0.001 for most fonts). */
  fontMatrix?: number[];
  /** Type 3: each glyph procedure's operator list, by the glyph's `operatorListId` (its glyph name). */
  charProcOperatorList?: Record<string, OperatorList>;
  /** Written down the page (a vertical CMap such as Identity-V). */
  vertical?: boolean;
  /** Vertical writing: [advance, x, y] of the glyphs that have no metrics of their own, in glyph units (pdf.js `defaultVMetrics`). */
  defaultVMetrics?: number[];
  /** pdf.js could not use the font and writes the text with a system font in one piece. */
  isInvalidPDFjsFont?: boolean;
  /** Only when the document is opened with pdf.js `fontExtraProperties`: the glyph names by code. */
  differences?: unknown[];
  defaultEncoding?: unknown[];
}

/** One operation that paints text (itself, or through a Type 3 glyph's procedure or a tiling pattern). */
export interface TextOp {
  /** Index in the page's operator list: the index `operationsFilter` takes. */
  index: number;
  /** The page's content ('page'), or the outermost annotation, form or group it sits in ('annot:12', 'form:40', 'group:7'). */
  drawing: string;
  /** The glyphs' Unicode as pdf.js has them, in drawing order (a wide gap in a spaced array gives a space). */
  text: string;
  /** Some glyph's Unicode cannot be trusted (none, private use, the replacement character, a control character, letters pdf.js invented or that disagree with the glyph names). */
  unreadable: boolean;
  /** Painted at all (text rendering mode 3, invisible, paints nothing). */
  visible: boolean;
  /** Text read inside what this operation draws (a Type 3 glyph's procedure, a tiling pattern's cell), glyph by glyph in drawing order. */
  inner: string;
  /** The same with a space between the glyphs' procedures (a procedure that writes a whole word). */
  innerSpaced?: string;
  /** What it draws inside cannot be read (unreadable text, a picture in a glyph, too deep). */
  innerUnreadable: boolean;
  /**
   * The reading gave up on it (as RX-LIB's `readerGaveUp`): no font the renderer knows, a Type 3 glyph or a
   * pattern whose drawing cannot be read, letters pdf.js invented. False when only its font's map cannot be
   * trusted (symbol-font bullets: private-use or missing Unicode in a font the renderer has).
   */
  gaveUp?: boolean;
  /** Where it painted, in the drawing's pixels; null when the renderer did not record it (or only the whole page). */
  box: PixelBox | null;
  /**
   * Where it starts on the page (user space, pdf.js's own text state), its text size there, the direction it
   * runs (dx, dy) and, with `ux`/`uy`, the vector from the baseline to one em above it as its glyphs stand
   * (turned, mirrored or stretched with the text); null for a pattern.
   */
  at: { x: number; y: number; size: number; dx: number; dy: number; width: number; ux?: number; uy?: number } | null;
  /** Each character's start along the text from where it starts, in page units, and the end after the last. */
  chars?: number[];
  /** Each character's own end along the text (its glyph's advance, without the spacing after it). */
  ends?: number[];
  /** Operations that follow one another with nothing setting the text position between them share a run: skipping one moves the ones after it. */
  run?: number;
  /** A Type 3 font: `chars` say where pdf.js advances, not where the glyph procedures paint (a hint only until measured). */
  type3?: boolean;
  /**
   * Ruling L (wave 4), set by `placeOperations`: true when the re-created glyph positions agree with what pdf.js
   * painted for this operation; false when they do not (unplaced: its positions are not used). Absent: not measured.
   */
  placed?: boolean;
  /** Ruling L1: where it painted, measured from the pixels, in user space; null when it paints nothing that shows. */
  painted?: Rect | null;
}

/** A character a reader extracts when a font's map cannot be trusted (as redactRounds.ts `untrusted`). */
const untrusted = (cp: number) => (cp >= 0xe000 && cp <= 0xf8ff) || cp >= 0xf0000 || cp === 0xfffd || (cp < 0x20 && cp !== 0x09 && cp !== 0x0a && cp !== 0x0d);

const MAX_NESTING = 16;
/** A gap in a spaced text array, in thousandths of the font size, wide enough to read as a space. */
const SPACE_GAP = 200;

// ---- glyph names (ruling N, the renderer's side) ---------------------------------------------------------

const GLYPH_CHARS: Readonly<Record<string, string>> = {
  space: ' ', exclam: '!', quotedbl: '"', numbersign: '#', dollar: '$', percent: '%', ampersand: '&', quotesingle: "'", parenleft: '(', parenright: ')',
  asterisk: '*', plus: '+', comma: ',', hyphen: '-', minus: '-', period: '.', slash: '/', zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5',
  six: '6', seven: '7', eight: '8', nine: '9', colon: ':', semicolon: ';', less: '<', equal: '=', greater: '>', question: '?', at: '@', bracketleft: '[',
  backslash: String.fromCharCode(92), bracketright: ']', asciicircum: '^', underscore: '_', grave: '`', braceleft: '{', bar: '|', braceright: '}', asciitilde: '~',
  quoteright: String.fromCharCode(0x2019), quoteleft: String.fromCharCode(0x2018), quotedblleft: String.fromCharCode(0x201c), quotedblright: String.fromCharCode(0x201d),
  endash: String.fromCharCode(0x2013), emdash: String.fromCharCode(0x2014), bullet: String.fromCharCode(0x2022), periodcentered: String.fromCharCode(0xb7),
  fi: 'fi', fl: 'fl', ff: 'ff', ffi: 'ffi', ffl: 'ffl', nbspace: String.fromCharCode(0xa0), Euro: String.fromCharCode(0x20ac),
};

/**
 * The character a glyph name stands for by the glyph-list rules: what follows the first period is a suffix
 * (Q.sc is Q), an underscore joins a ligature's parts, uniXXXX and uXXXX[XX] give the code, single letters,
 * digit and punctuation names; else undefined (RX-LIB's redactCheck.ts reads names the same way).
 */
export function glyphNameChar(glyphName: string): string | undefined {
  const base = glyphName.split('.')[0];
  if (base === '') return undefined;
  if (base.includes('_')) {
    const parts = base.split('_').map(glyphNameChar);
    return parts.every((p) => p !== undefined) ? parts.join('') : undefined;
  }
  if (/^[A-Za-z]$/.test(base)) return base;
  if (Object.prototype.hasOwnProperty.call(GLYPH_CHARS, base)) return GLYPH_CHARS[base];
  const uni = /^uni((?:[0-9A-F]{4})+)$/.exec(base);
  if (uni) return String.fromCharCode(...(uni[1].match(/.{4}/g) ?? []).map((h) => parseInt(h, 16)));
  const u = /^u([0-9A-F]{4,6})$/.exec(base);
  if (u) {
    const cp = parseInt(u[1], 16);
    return cp <= 0x10ffff ? String.fromCodePoint(cp) : undefined;
  }
  return undefined;
}

/** Names pdf.js turns into a code by its own rules (Gxx, gxxxx, Cdd), so its letters for them are its reading of the name. */
const pdfjsCodeName = (n: string) =>
  (n.length === 3 && n[0] === 'G' && /^[0-9A-Fa-f]{2}$/.test(n.slice(1))) || (n.length === 5 && n[0] === 'g' && /^[0-9A-Fa-f]{4}$/.test(n.slice(1))) || ((n[0] === 'C' || n[0] === 'c') && n.length >= 3 && n.length <= 4 && /^[0-9A-Fa-f]+$/.test(n.slice(1)));

/**
 * Ruling N: a glyph whose name says one character while pdf.js gives another (Q.sc given as 'a'), or whose
 * name no list knows and whose letter pdf.js made from the code itself (it invented the letter), cannot be
 * read. `letter`: the name's own character, read in its place. `mapped`: the font's letters may come from a
 * map of its own, so a letter equal to its code is not taken as invented.
 */
function nameVerdict(name: string, unicode: string, code: unknown, mapped: boolean): { lies: boolean; letter?: string } {
  if (name === '' || name === '.notdef' || unicode === '') return { lies: false };
  const own = glyphNameChar(name);
  if (own !== undefined) return own.normalize('NFKC') === unicode.normalize('NFKC') ? { lies: false } : { lies: true, letter: own };
  const base = name.split('.')[0];
  if (!name.includes('.') && (/^[A-Za-z]+$/.test(base) || /^afii\d+$/.test(base) || pdfjsCodeName(base))) return { lies: false };
  return { lies: !mapped && typeof code === 'number' && unicode === String.fromCharCode(code) };
}

/** How a font's glyphs are named on the drawing side: a Type 3 glyph by its procedure's id; another font only when pdf.js was asked for its extra properties. */
function glyphNamer(font: ViewFont | null): { name: (g: GlyphLike) => string | undefined; mapped: boolean } | null {
  if (!font) return null;
  if (font.isType3Font) return { name: (g) => (g.operatorListId === undefined || g.operatorListId === null ? undefined : String(g.operatorListId)), mapped: false };
  const [diff, enc] = [font.differences, font.defaultEncoding];
  if (!Array.isArray(diff) && !Array.isArray(enc)) return null;
  return {
    name: (g) => {
      const c = g.originalCharCode;
      if (typeof c !== 'number') return undefined;
      const n = (Array.isArray(diff) ? diff[c] : undefined) || (Array.isArray(enc) ? enc[c] : undefined);
      return typeof n === 'string' ? n : undefined;
    },
    mapped: true,
  };
}

interface GlyphLike {
  unicode?: unknown;
  isSpace?: unknown;
  operatorListId?: unknown;
  width?: unknown;
  originalCharCode?: unknown;
  vmetric?: unknown;
}

interface ShowMetrics {
  /** The font size, without its sign; `dir` is the sign (pdf.js fontDirection). */
  fontSize: number;
  dir: number;
  /** pdf.js fontMatrix[0] (and, for a Type 3 font, fontMatrix[4], which pdf.js adds to each advance). */
  fm0: number;
  fm4: number;
  charSpacing: number;
  wordSpacing: number;
  type3: boolean;
  vertical: boolean;
  vmetrics?: number[];
  invalid: boolean;
}

interface GlyphRun {
  text: string;
  unreadable: boolean;
  /** The glyph names disagree with the letters, or pdf.js invented them (ruling N). */
  namesLie: boolean;
  /** Each glyph in drawing order, by its procedure's id (Type 3), or a space. */
  seq: { id?: string; space: boolean }[];
  /** Each character's start and own end along the text, in the units pdf.js advances in (before the horizontal scale). */
  pos: number[];
  ends: number[];
  /** The advance of the whole operation. */
  end: number;
}

/**
 * The text of a glyph array (glyphs and spacing numbers), whether any glyph's Unicode is untrusted, and each
 * character's place along the text, as pdf.js canvas.js showText / showType3Text advance: a spacing number
 * moves by its thousandths of the size (against the reading direction across, with it down a column); a
 * glyph by its width (vertical: its vertical advance) times the size and the font matrix, plus the character
 * and word spacing (by the size's sign, except in a Type 3 font).
 */
function glyphText(glyphs: unknown, m: ShowMetrics, namer: ReturnType<typeof glyphNamer>): GlyphRun {
  const run: GlyphRun = { text: '', unreadable: false, namesLie: false, seq: [], pos: [], ends: [], end: 0 };
  if (!Array.isArray(glyphs)) {
    run.unreadable = true;
    return run;
  }
  let x = 0;
  const wAS = m.fontSize * m.fm0;
  for (const g of glyphs as unknown[]) {
    if (typeof g === 'number') {
      const move = ((m.vertical ? g : -g) * m.fontSize) / 1000;
      if ((m.vertical ? g : -g) >= SPACE_GAP && !run.text.endsWith(' ')) {
        run.text += ' ';
        run.pos.push(x);
        run.ends.push(x + move);
        run.seq.push({ space: true });
      }
      if (!m.invalid) x += move;
      continue;
    }
    if (g === null || typeof g !== 'object') continue;
    const glyph = g as GlyphLike;
    const width = typeof glyph.width === 'number' ? glyph.width : 0;
    const spacing = (glyph.isSpace === true ? m.wordSpacing : 0) + m.charSpacing;
    let own: number;
    let advance: number;
    if (m.type3) {
      own = (m.fm0 * width + m.fm4) * m.fontSize;
      advance = own + spacing;
    } else if (m.vertical) {
      const vm = Array.isArray(glyph.vmetric) ? (glyph.vmetric as number[]) : m.vmetrics;
      const w = vm ? -num(vm[0]) : width;
      own = w * wAS;
      advance = own - spacing * m.dir;
    } else {
      own = width * wAS;
      advance = m.invalid ? own : own + spacing * m.dir;
    }
    const start = x;
    x += advance;
    let u = typeof glyph.unicode === 'string' ? glyph.unicode : '';
    if (namer) {
      const name = namer.name(glyph);
      if (name !== undefined) {
        const verdict = nameVerdict(name, u, glyph.originalCharCode, namer.mapped);
        if (verdict.lies) {
          run.unreadable = true;
          run.namesLie = true;
          if (verdict.letter !== undefined) u = verdict.letter;
        }
      }
    }
    const space = glyph.isSpace === true || /^\s+$/.test(u);
    run.seq.push(m.type3 && glyph.operatorListId !== undefined && glyph.operatorListId !== null ? { id: String(glyph.operatorListId), space } : { space });
    if (u === '') {
      if (glyph.isSpace === true) {
        run.text += ' ';
        run.pos.push(start);
        run.ends.push(start + own);
      } else run.unreadable = true;
      continue;
    }
    for (const ch of u) {
      if (untrusted(ch.codePointAt(0) ?? 0)) run.unreadable = true;
      for (let k = 0; k < ch.length; k++) {
        run.pos.push(start);
        run.ends.push(start + own);
      }
    }
    run.text += u;
  }
  run.end = x;
  return run;
}
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

const IMAGE_OPS = (ids: OpIds) =>
  new Set([ids.paintImageXObject, ids.paintImageXObjectRepeat, ids.paintInlineImageXObject, ids.paintInlineImageXObjectGroup, ids.paintImageMaskXObject, ids.paintImageMaskXObjectGroup, ids.paintImageMaskXObjectRepeat, ids.paintSolidColorImageMask]);

/** The text an operator list paints anywhere inside it (for a glyph's procedure or a pattern's cell), joined, and whether it can be read. */
function innerText(list: OperatorList | undefined, ids: OpIds, font: (name: string) => ViewFont | null, depth: number, glyphProc: boolean): { text: string; unreadable: boolean } {
  if (!list || depth > MAX_NESTING) return { text: '', unreadable: true };
  const ops = readOperations(list, ids, font, () => null, depth + 1);
  let text = ops.filter((o) => o.visible).map((o) => `${o.text}${o.inner ? ` ${o.inner}` : ''}`).join(' ');
  let unreadable = ops.some((o) => o.visible && (o.unreadable || o.innerUnreadable));
  if (glyphProc) {
    // A picture drawn by a glyph's procedure could be anything (a bitmap glyph is an inline mask: a glyph).
    const images = IMAGE_OPS(ids);
    images.delete(ids.paintImageMaskXObject);
    images.delete(ids.paintInlineImageXObject);
    images.delete(ids.paintInlineImageXObjectGroup);
    images.delete(ids.paintSolidColorImageMask);
    for (let i = 0; i < list.fnArray.length; i++) if (images.has(list.fnArray[i])) unreadable = true;
  }
  text = text.replace(/\s+/g, ' ').trim();
  return { text, unreadable };
}

/**
 * Every operation of `list` that paints text, with its drawing, text, trust, visibility, start point and box
 * (see TextOp). `font` looks a font up by the name pdf.js gave it (its common objects); `box` gives where an
 * operation painted (pdf.js `recordedBBoxes`). Start points follow pdf.js's own text state (canvas.js): the
 * current transform, the text matrix, the text position moved by Td, TD, T*, and advanced by each show (not
 * at all for a run at size 0 or an invisible Type 3 run, as pdf.js returns before advancing); a negative size
 * runs the text the other way and turns its glyphs; a vertical font advances down the column; each
 * annotation's appearance starts with a fresh text state, as pdf.js begins it; a transparency group's matrix
 * is taken once (by the form that follows its beginning, as pdf.js draws it).
 */
export function readOperations(list: OperatorList, ids: OpIds, font: (name: string) => ViewFont | null, box: (index: number) => PixelBox | null, depth = 0): TextOp[] {
  const out: TextOp[] = [];
  const drawings: string[] = [];
  type State = {
    mode: number;
    font: ViewFont | null;
    fontKnown: boolean;
    ctm: M;
    tm: M;
    x: number;
    y: number;
    lineX: number;
    lineY: number;
    leading: number;
    size: number;
    charSpacing: number;
    wordSpacing: number;
    hScale: number;
    rise: number;
    run: number;
  };
  let runs = 0;
  const fresh = (ctm: M): State => ({ mode: 0, font: null, fontKnown: false, ctm, tm: IDENTITY, x: 0, y: 0, lineX: 0, lineY: 0, leading: 0, size: 0, charSpacing: 0, wordSpacing: 0, hScale: 1, rise: 0, run: ++runs });
  let state: State = fresh(IDENTITY);
  const saved: State[] = [];
  const push = () => saved.push({ ...state });
  const pop = () => {
    state = saved.pop() ?? state;
  };
  // pdf.js passes some matrices as typed arrays (a text matrix is a Float32Array).
  const matrix = (v: unknown): M | null => {
    if (!(Array.isArray(v) || ArrayBuffer.isView(v))) return null;
    const a = Array.from(v as ArrayLike<number>);
    return a.length === 6 && a.every((n) => typeof n === 'number' && Number.isFinite(n)) ? (a as M) : null;
  };
  const moveText = (x: number, y: number) => {
    state.lineX += x;
    state.x = state.lineX;
    state.lineY += y;
    state.y = state.lineY;
    state.run = ++runs;
  };
  const n = list.fnArray.length;
  for (let i = 0; i < n; i++) {
    const fn = list.fnArray[i];
    const args = (list.argsArray[i] ?? []) as unknown[];
    if (fn === ids.save) push();
    else if (fn === ids.restore) pop();
    else if (fn === ids.transform) {
      const m = matrix(args);
      if (m) state.ctm = mul(state.ctm, m);
    } else if (fn === ids.setTextRenderingMode) state.mode = num(args[0]);
    else if (fn === ids.beginText) {
      state.tm = IDENTITY;
      state.x = state.y = state.lineX = state.lineY = 0;
      state.run = ++runs;
    } else if (fn === ids.setTextMatrix) {
      state.tm = matrix(args[0]) ?? matrix(args) ?? IDENTITY;
      state.x = state.y = state.lineX = state.lineY = 0;
      state.run = ++runs;
    } else if (fn === ids.moveText) moveText(num(args[0]), num(args[1]));
    else if (fn === ids.setLeadingMoveText) {
      state.leading = num(args[1]);
      moveText(num(args[0]), num(args[1]));
    } else if (fn === ids.setLeading) state.leading = -num(args[0]);
    else if (fn === ids.nextLine) moveText(0, state.leading);
    else if (fn === ids.setCharSpacing) state.charSpacing = num(args[0]);
    else if (fn === ids.setWordSpacing) state.wordSpacing = num(args[0]);
    else if (fn === ids.setHScale) state.hScale = num(args[0]) / 100;
    else if (fn === ids.setTextRise) state.rise = num(args[0]);
    else if (fn === ids.setFont) {
      state.font = typeof args[0] === 'string' ? font(args[0]) : null;
      state.fontKnown = state.font !== null;
      state.size = num(args[1]);
    } else if (fn === ids.setGState && Array.isArray(args[0])) {
      for (const entry of args[0] as unknown[]) {
        if (!Array.isArray(entry) || entry[0] !== 'Font') continue;
        const value = entry[1] as unknown[];
        state.font = Array.isArray(value) && typeof value[0] === 'string' ? font(value[0]) : null;
        state.fontKnown = state.font !== null;
        state.size = Array.isArray(value) ? num(value[1]) : 0;
      }
    } else if (fn === ids.beginAnnotation) {
      drawings.push(`annot:${i}`);
      push();
      // B5 (wave 4): pdf.js begins each appearance afresh (canvas.js beginAnnotation: a new CanvasExtraState),
      // from the page's base: its rectangle's transform, then its matrix. What the page content left set (an
      // OCR text layer's 3 Tr, a rise, a scale) does not carry into it.
      state = fresh(mul(matrix(args[2]) ?? IDENTITY, matrix(args[3]) ?? IDENTITY));
    } else if (fn === ids.paintFormXObjectBegin) {
      drawings.push(`form:${i}`);
      push();
      const m = matrix(args[0]);
      if (m) state.ctm = mul(state.ctm, m);
    } else if (fn === ids.beginGroup) {
      // B1 (wave 4): a group's matrix only sizes pdf.js's group canvas (canvas.js beginGroup); the form that
      // follows (paintFormXObjectBegin, the same matrix) applies it, once.
      drawings.push(`group:${i}`);
      push();
    } else if (fn === ids.endAnnotation || fn === ids.paintFormXObjectEnd || fn === ids.endGroup) {
      drawings.pop();
      pop();
    } else if (fn === ids.showText || fn === ids.showSpacedText || fn === ids.nextLineShowText || fn === ids.nextLineSetSpacingShowText) {
      // pdf.js's evaluator turns ' and " into T* (and Tw, Tc) and a show; taken the same way here should they come.
      if (fn === ids.nextLineSetSpacingShowText) {
        state.wordSpacing = num(args[0]);
        state.charSpacing = num(args[1]);
      }
      if (fn === ids.nextLineShowText || fn === ids.nextLineSetSpacingShowText) moveText(0, state.leading);
      const glyphs = fn === ids.nextLineSetSpacingShowText ? args[2] : args[0];
      const f = state.font;
      const type3 = f?.isType3Font === true;
      const vertical = f?.vertical === true && !type3;
      const fontSize = Math.abs(state.size);
      const dir = state.size < 0 ? -1 : 1;
      const fm = f?.fontMatrix && f.fontMatrix.length >= 6 ? f.fontMatrix.map(num) : [0.001, 0, 0, 0.001, 0, 0];
      const read = glyphText(glyphs, { fontSize, dir, fm0: fm[0], fm4: type3 ? fm[4] : 0, charSpacing: state.charSpacing, wordSpacing: state.wordSpacing, type3, vertical, vmetrics: f?.defaultVMetrics, invalid: f?.isInvalidPDFjsFont === true }, glyphNamer(f));
      let inner = '';
      let innerSpaced = '';
      let innerUnreadable = false;
      if (type3 && f) {
        // B7 (wave 4): the glyphs' procedures in drawing order, once per glyph shown (not once per kind).
        const known = new Map<string, { text: string; unreadable: boolean }>();
        const parts: string[] = [];
        for (const g of read.seq) {
          let part = '';
          if (g.id !== undefined) {
            let r = known.get(g.id);
            if (!r) {
              r = innerText(f.charProcOperatorList?.[g.id], ids, font, depth, true);
              known.set(g.id, r);
              innerUnreadable ||= r.unreadable;
            }
            part = r.text;
          }
          if (part === '' && g.space) part = ' ';
          if (part !== '') parts.push(part);
        }
        inner = parts.join('').replace(/\s+/g, ' ').trim();
        innerSpaced = parts.join(' ').replace(/\s+/g, ' ').trim();
      }
      // Where it starts (page user space), which way it runs, and the text position after it (pdf.js's advance).
      const full = mul(state.ctm, state.tm);
      const vec = (vx: number, vy: number): [number, number] => [full[0] * vx + full[2] * vy, full[1] * vx + full[3] * vy];
      const tHS = state.hScale * dir;
      // pdf.js's textHScale carries the size's sign (B2): a negative size runs the text back and turns its glyphs.
      let runVec = vertical ? vec(0, dir > 0 ? -1 : 1) : vec(tHS, 0);
      if (!(Math.hypot(runVec[0], runVec[1]) > 0)) runVec = vec(vertical ? 0 : 1, vertical ? -1 : 0);
      const along = Math.hypot(runVec[0], runVec[1]) || 1;
      // The glyphs' up (across a column for vertical writing, B6), one em long.
      const up = vertical ? vec(tHS * fontSize, 0) : vec(0, (type3 ? Math.sign(fm[3] || 1) : 1) * dir * fontSize);
      // A vertical font's glyphs stand centred on the column (pdf.js places each at half its width to the left).
      const [sx, sy] = vertical ? [state.x - 0.3 * tHS * fontSize, state.y + state.rise] : [state.x, state.y + state.rise];
      const [ax, ay] = apply(full, sx, sy);
      const scaleOf = Math.sqrt(Math.abs(full[0] * full[3] - full[1] * full[2])) || 1;
      out.push({
        index: i,
        drawing: drawings[0] ?? 'page',
        text: read.text,
        // A text shown with no font the renderer knows cannot be told.
        unreadable: read.unreadable || !state.fontKnown,
        visible: state.mode !== 3,
        inner,
        ...(type3 ? { innerSpaced } : {}),
        innerUnreadable,
        gaveUp: !state.fontKnown || innerUnreadable || !Array.isArray(glyphs) || (read.unreadable && type3) || read.namesLie,
        box: box(i),
        at: { x: ax, y: ay, size: fontSize * scaleOf, dx: runVec[0] / along, dy: runVec[1] / along, width: Math.abs(read.end) * along, ux: up[0], uy: up[1] },
        // Each character's start along the text in page units (a Type 3 glyph may paint anywhere: a hint, `type3`).
        chars: [...read.pos, read.end].map((p) => p * along),
        ends: read.ends.map((p) => p * along),
        run: state.run,
        ...(type3 ? { type3: true } : {}),
      });
      // B4 (wave 4): pdf.js returns before advancing for a run at size 0, and for an invisible Type 3 run.
      if (!(fontSize === 0 || (type3 && state.mode === 3))) {
        if (vertical) state.y -= read.end;
        else state.x += read.end * tHS;
      }
    } else if ((fn === ids.setFillColorN || fn === ids.setStrokeColorN) && args[0] === 'TilingPattern') {
      const r = innerText(args[2] as OperatorList | undefined, ids, font, depth, false);
      if (r.text || r.unreadable) out.push({ index: i, drawing: drawings[0] ?? 'page', text: '', unreadable: false, visible: true, inner: r.text, innerUnreadable: r.unreadable, gaveUp: r.unreadable, box: box(i), at: null, run: ++runs });
    }
  }
  return out;
}

type M = [number, number, number, number, number, number];
const IDENTITY: M = [1, 0, 0, 1, 0, 0];
/** pdf.js Util.transform: `m2` first, then `m1`. */
const mul = (m1: M, m2: M): M => [
  m1[0] * m2[0] + m1[2] * m2[1],
  m1[1] * m2[0] + m1[3] * m2[1],
  m1[0] * m2[2] + m1[2] * m2[3],
  m1[1] * m2[2] + m1[3] * m2[3],
  m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
  m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
];
const apply = (m: M, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/** A word broken at a line end by a hyphen (or a soft hyphen) and a letter starting the next piece. */
const HYPHEN_END = /[-\u00ad]\s*$/;
const LETTER_START = /^\s*\p{L}/u;

/**
 * Pieces joined into one text, with the operation each character came from (-1 for what the join put in).
 * `sep`: '' or ' '; a hyphen ending a piece before a piece starting with a letter is dropped, with no separator.
 */
function join(pieces: { op: number; text: string }[], sep: string): { text: string; owner: number[]; local: number[] } {
  let text = '';
  const owner: number[] = [];
  const local: number[] = [];
  pieces.forEach((p, k) => {
    let t = p.text;
    let lead = 0;
    if (k > 0) {
      const prev = pieces[k - 1].text;
      if (HYPHEN_END.test(prev) && LETTER_START.test(t)) {
        // Drop the hyphen (and any space after it) already appended for the previous piece.
        const cut = text.search(/[-\u00ad]\s*$/);
        if (cut >= 0) {
          text = text.slice(0, cut);
          owner.length = cut;
          local.length = cut;
        }
        lead = t.length - t.replace(/^\s+/, '').length;
        t = t.slice(lead);
      } else if (sep) {
        text += sep;
        owner.push(-1);
        local.push(-1);
      }
    }
    for (let j = 0; j < t.length; j++) {
      owner.push(p.op);
      local.push(lead + j);
    }
    text += t;
  });
  return { text, owner, local };
}

/**
 * Where a place of a value covers characters in a joined reading: for each operation, the ranges of its own
 * text the places take; null when the places cannot be told.
 */
function opsHolding(pieces: { op: number; text: string }[], holds: (text: string) => boolean, spans: (text: string) => [number, number][]): Map<number, [number, number][]> | null {
  const found = new Map<number, [number, number][]>();
  for (const sep of ['', ' ']) {
    const { text, owner, local } = join(pieces, sep);
    if (!holds(text)) continue;
    const places = spans(text).filter(([a, b]) => b > a);
    if (places.length === 0) return null;
    for (const [a, b] of places) {
      for (let j = a; j < b; j++) {
        if (owner[j] < 0) continue;
        const list = found.get(owner[j]) ?? [];
        list.push([local[j], local[j] + 1]);
        found.set(owner[j], list);
      }
    }
  }
  return found;
}

// ---- parts of a chosen value (ruling L3) ---------------------------------------------------------------

const compactOf = (s: string) => s.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/**
 * Ruling L3: what makes an operation suspect when its places cannot be trusted. `suspect`: its text holds any
 * part of a chosen value, in stream order (it lies inside the value, or ends with the value's start or begins
 * with its end, two characters or more) or in any order (its letters cover the value's). `matters`: it holds
 * the value or a piece of three characters or more (measured alone by placeOperations).
 */
export function valueParts(values: readonly string[]): { suspect: (text: string) => boolean; matters: (text: string) => boolean } {
  const vs = [...new Set(values.map(compactOf))].filter((v) => v.length >= 2);
  const piece = (t: string, v: string, inside: number, edge: number) => {
    if (t.length === 0) return false;
    if (t.includes(v)) return true;
    if (t.length >= inside && v.includes(t)) return true;
    for (let k = Math.min(t.length, v.length) - 1; k >= edge; k--) if (t.endsWith(v.slice(0, k)) || t.startsWith(v.slice(v.length - k))) return true;
    return false;
  };
  const covers = (t: string, v: string) => {
    if (t.length < v.length) return false;
    const count = new Map<string, number>();
    for (const ch of t) count.set(ch, (count.get(ch) ?? 0) + 1);
    for (const ch of v) {
      const c = count.get(ch) ?? 0;
      if (c === 0) return false;
      count.set(ch, c - 1);
    }
    return true;
  };
  return {
    suspect: (text) => {
      const t = compactOf(text);
      return t !== '' && vs.some((v) => piece(t, v, 1, 2) || covers(t, v));
    },
    matters: (text) => {
      const t = compactOf(text);
      return t !== '' && vs.some((v) => piece(t, v, 3, 3));
    },
  };
}

// ---- reading by position ---------------------------------------------------------------------------------

/** An operation where it reads: its start, size, run direction and glyph up (unit), from its trusted positions or, unplaced, from what it painted. */
interface Laid {
  o: TextOp;
  x: number;
  y: number;
  size: number;
  dx: number;
  dy: number;
  ux: number;
  uy: number;
  width: number;
}
function laidOf(o: TextOp): Laid | null {
  if (o.placed === false && o.painted) {
    const p = o.painted;
    return { o, x: p.x0, y: p.y0, size: Math.max(1, p.y1 - p.y0), dx: 1, dy: 0, ux: 0, uy: 1, width: Math.max(0, p.x1 - p.x0) };
  }
  // (Unplaced with nothing known of where it painted, as when the measure ran out of drawings: its re-created
  // place is all there is to read it by; L3 covers it whole if it holds a part of a value.)
  const a = o.at;
  if (!a) return null;
  const [ux, uy] = a.ux !== undefined && a.uy !== undefined && Math.hypot(a.ux, a.uy) > 0 ? [a.ux, a.uy] : [-a.dy, a.dx];
  const l = Math.hypot(ux, uy) || 1;
  return { o, x: a.x, y: a.y, size: a.size, dx: a.dx, dy: a.dy, ux: ux / l, uy: uy / l, width: a.width };
}

/**
 * Operations read in position order in their own frame (the way their text runs, glyphs upright): grouped by
 * direction, line by line from the top of the glyphs down, then along each line; and down each column
 * (operations starting at about the same place along). Upright text: top to bottom, left to right.
 */
function positionReadings(laid: readonly Laid[], columnTolerancePt: number): TextOp[][] {
  const frames = new Map<string, Laid[]>();
  for (const p of laid) {
    const angle = Math.round((Math.atan2(p.dy, p.dx) * 180) / Math.PI / 5) * 5;
    const mirrored = p.dx * p.uy - p.dy * p.ux < 0;
    const key = `${angle}:${mirrored ? 'm' : ''}`;
    frames.set(key, [...(frames.get(key) ?? []), p]);
  }
  const out: TextOp[][] = [];
  for (const group of frames.values()) {
    if (group.length < 2) continue;
    const { dx, dy, ux, uy } = group[0];
    // Across: square to the run, towards the glyphs' tops (a slanted up, italic, does not tilt the lines).
    const side = dx * uy - dy * ux < 0 ? -1 : 1;
    const alongOf = (p: Laid) => p.x * dx + p.y * dy;
    const acrossOf = (p: Laid) => (-p.x * dy + p.y * dx) * side;
    const byTop = [...group].sort((a, b) => acrossOf(b) - acrossOf(a));
    const lines: Laid[][] = [];
    for (const p of byTop) {
      const current = lines[lines.length - 1];
      if (current && acrossOf(current[0]) - acrossOf(p) <= 0.5 * Math.max(1, current[0].size, p.size)) current.push(p);
      else lines.push([p]);
    }
    out.push(lines.flatMap((l) => l.sort((a, b) => alongOf(a) - alongOf(b)).map((p) => p.o)));
    const byStart = [...group].sort((a, b) => alongOf(a) - alongOf(b));
    let column: Laid[] = [];
    const flush = () => {
      if (column.length > 1) out.push([...column].sort((a, b) => acrossOf(b) - acrossOf(a)).map((p) => p.o));
      column = [];
    };
    for (const p of byStart) {
      if (column.length > 0 && alongOf(p) - alongOf(column[0]) > columnTolerancePt) flush();
      column.push(p);
    }
    flush();
  }
  return out;
}

/** B3 (wave 4): an operation's characters in the order its glyphs stand along the text, when pdf.js paints them out of the order they are written (a backward kern); else null. */
function shownOrder(o: TextOp): { text: string; order: number[] } | null {
  const starts = o.chars;
  if (!starts || !o.ends || o.ends.length !== o.text.length || starts.length !== o.text.length + 1 || o.text.length < 2) return null;
  let backward = false;
  for (let k = 1; k < o.text.length; k++) if (starts[k] < starts[k - 1] - 0.01) backward = true;
  if (!backward) return null;
  const order = Array.from({ length: o.text.length }, (_, k) => k).sort((a, b) => starts[a] - starts[b] || a - b);
  return { text: order.map((k) => o.text[k]).join(''), order };
}

/**
 * The operations to skip in the proof's second drawing: each visible one that cannot be read, or that
 * holds a chosen value read alone (and, B3, in the order its glyphs stand), or (with others) joined in
 * drawing order, in position order (line by line) or down a column, within its drawing and (L4) across the
 * page's drawings (page text and a stamp, two stamps). A word broken at a line end by a hyphen is rejoined.
 * Where a joined reading of one drawing holds a value whose places cannot be told, every text operation of
 * that drawing is skipped. L3: with `values` (the chosen values' forms), an operation `placeOperations` found
 * unplaced is flagged whole when it holds any part of one (valueParts), and every unplaced one flagged is
 * flagged whole (its positions are not used). `held`: those flagged for a value; `gaveUp`: the unreadable
 * ones the reading gave up on (TextOp.gaveUp), not those whose font's map only cannot be trusted.
 */
export function flaggedOperations(
  ops: readonly TextOp[],
  holds: (text: string) => boolean,
  spans: (text: string) => [number, number][],
  columnTolerancePt = 3,
  values: readonly string[] = [],
): { flagged: Set<number>; unreadable: Set<number>; places: Map<number, [number, number][]>; held: Set<number>; gaveUp: Set<number> } {
  const flagged = new Set<number>();
  const unreadable = new Set<number>();
  // Flagged because they hold a chosen value (alone, inside, or joined), and unreadable ones the reading gave up on.
  const held = new Set<number>();
  const gaveUp = new Set<number>();
  // Operations flagged whole (unreadable, inner text, places unknown) and the others' own character ranges.
  const whole = new Set<number>();
  const places = new Map<number, [number, number][]>();
  const parts = valueParts(values);
  const addPlaces = (op: number, ranges: [number, number][]) => {
    flagged.add(op);
    held.add(op);
    places.set(op, [...(places.get(op) ?? []), ...ranges]);
  };
  const addWhole = (op: number) => {
    flagged.add(op);
    held.add(op);
    whole.add(op);
  };
  const visible = ops.filter((o) => o.visible);
  for (const o of visible) {
    if (o.unreadable || o.innerUnreadable) {
      flagged.add(o.index);
      unreadable.add(o.index);
      whole.add(o.index);
      if (o.gaveUp !== false) gaveUp.add(o.index);
    }
    if ((o.inner && holds(o.inner)) || (o.innerSpaced && holds(o.innerSpaced))) addWhole(o.index);
    if (o.text && holds(o.text)) {
      const own = spans(o.text).filter(([a, b]) => b > a);
      if (own.length > 0) addPlaces(o.index, own);
      else addWhole(o.index);
    }
    const shown = shownOrder(o);
    if (shown && holds(shown.text)) {
      const own = spans(shown.text).filter(([a, b]) => b > a);
      if (own.length > 0) addPlaces(o.index, own.flatMap(([a, b]) => shown.order.slice(a, b).map((k): [number, number] => [k, k + 1])));
      else addWhole(o.index);
    }
    if (o.placed === false && (parts.suspect(o.text) || parts.suspect(o.inner))) addWhole(o.index);
  }
  const take = (list: TextOp[], partsOnly = false) => {
    if (list.length < 2) return;
    const holding = opsHolding(list.map((o) => ({ op: o.index, text: o.text })), holds, spans);
    if (holding === null) {
      for (const o of list) if (!partsOnly || parts.suspect(o.text)) addWhole(o.index);
    } else for (const [i, ranges] of holding) addPlaces(i, ranges);
  };
  const readAll = (list: TextOp[], partsOnly: boolean) => {
    take(list, partsOnly);
    const laid = list.map(laidOf).filter((p): p is Laid => p !== null);
    if (laid.length < 2) return;
    for (const reading of positionReadings(laid, columnTolerancePt)) take(reading, partsOnly);
    // RX-LIB's blocks (pageText.ts textBlocks, ruling C): a column, a table cell, read top to bottom.
    const blocks = textBlocks(laid.map((p) => ({ x: p.x, y: p.y, dx: p.dx, dy: p.dy, width: p.width, size: p.size, blank: !/\S/.test(p.o.text) })));
    for (const block of blocks) take(block.flat().map((i) => laid[i].o), partsOnly);
  };
  const withText = visible.filter((o) => o.text);
  const byDrawing = new Map<string, TextOp[]>();
  for (const o of withText) byDrawing.set(o.drawing, [...(byDrawing.get(o.drawing) ?? []), o]);
  for (const list of byDrawing.values()) readAll(list, false);
  // L4 (wave 4): across the page's drawings too (AG19, AG20); where its places cannot be told there, only
  // the operations that hold a part of a value are taken whole.
  if (byDrawing.size > 1) readAll(withText, true);
  const byIndex = new Map(ops.map((o) => [o.index, o]));
  for (const op of flagged) if (byIndex.get(op)?.placed === false) whole.add(op);
  for (const op of whole) places.delete(op);
  return { flagged, unreadable, places, held, gaveUp };
}

/**
 * Where an operation's characters `ranges` (of its own text) paint, as one pixel box of the drawing: each
 * range's stretch along the text (from `chars` and `ends`), widened at each end by `shape.along` of the text
 * size (half by default; a negative value shrinks it), from `shape.below` of an em under the baseline (0.4)
 * to `shape.above` of it over the baseline (1), the em being the glyphs' own up (`at.ux`, `at.uy`), through
 * `transform` (pdf.js `viewport.transform`: user space to pixels). An operation `placeOperations` found
 * unplaced gives what it painted, whole (ruling L3). Null when it cannot be told (no positions; a Type 3
 * font's, until measured).
 */
export function charsBox(
  op: TextOp,
  ranges: readonly [number, number][],
  transform: readonly number[],
  shape: { along?: number; below?: number; above?: number } = {},
): PixelBox | null {
  if (transform.length < 6) return null;
  const [a, b, c, d, e, f] = transform;
  const toPx = (x: number, y: number): [number, number] => [a * x + c * y + e, b * x + d * y + f];
  if (op.placed === false) return op.painted ? rectBox(op.painted, toPx) : null;
  const at = op.at;
  const chars = op.chars;
  if (!at || !chars || chars.length < 2 || ranges.length === 0 || (op.type3 && op.placed !== true)) return null;
  const [ux, uy] = at.ux !== undefined && at.uy !== undefined && Math.hypot(at.ux, at.uy) > 0 ? [at.ux, at.uy] : [-at.dy * at.size, at.dx * at.size];
  const widen = (shape.along ?? 0.5) * at.size;
  const [below, above] = [shape.below ?? 0.4, shape.above ?? 1];
  const ends = op.ends && op.ends.length === chars.length - 1 ? op.ends : null;
  const last = chars.length - 1;
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const [from, to] of ranges) {
    let lo = Infinity;
    let hi = -Infinity;
    if (ends) {
      const i0 = Math.max(0, Math.min(from, last - 1));
      const i1 = Math.max(i0 + 1, Math.min(to, last));
      for (let k = i0; k < i1; k++) {
        lo = Math.min(lo, chars[k], ends[k]);
        hi = Math.max(hi, chars[k], ends[k]);
      }
    } else {
      const [start, end] = [chars[Math.max(0, Math.min(from, last))], chars[Math.max(0, Math.min(to, last))]];
      [lo, hi] = [Math.min(start, end), Math.max(start, end)];
    }
    let s = lo - widen;
    let t = hi + widen;
    // Shrunk past each other: the middle of the stretch.
    if (t < s) s = t = (lo + hi) / 2;
    for (const along of [s, t]) {
      for (const across of [-below, above]) {
        const [px, py] = toPx(at.x + at.dx * along + ux * across, at.y + at.dy * along + uy * across);
        left = Math.min(left, px);
        right = Math.max(right, px);
        top = Math.min(top, py);
        bottom = Math.max(bottom, py);
      }
    }
  }
  if (![left, top, right, bottom].every(Number.isFinite)) return null;
  return { left: Math.floor(left), top: Math.floor(top), right: Math.ceil(right), bottom: Math.ceil(bottom) };
}

/** A user-space rectangle as the pixel box around its corners. */
function rectBox(r: Rect, toPx: (x: number, y: number) => [number, number]): PixelBox | null {
  const corners = [toPx(r.x0, r.y0), toPx(r.x1, r.y0), toPx(r.x0, r.y1), toPx(r.x1, r.y1)];
  const xs = corners.map((p) => p[0]);
  const ys = corners.map((p) => p[1]);
  if (![...xs, ...ys].every(Number.isFinite)) return null;
  return { left: Math.floor(Math.min(...xs)), top: Math.floor(Math.min(...ys)), right: Math.ceil(Math.max(...xs)), bottom: Math.ceil(Math.max(...ys)) };
}

// ---- ruling L1-L2: where each operation really painted ------------------------------------------------------

/** A drawing made for the measure: the page's pixels and the transform from user space to them. */
export interface MeasureDrawing {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  transform: readonly number[];
}

/**
 * The re-created glyph box an operation's ink must lie in to agree: half its size beyond each end along, 0.45 of
 * an em below the baseline and 1.15 above (every ordinary font's descenders, accents and Indian-script vowel
 * signs), and HINT_PAD_PX more; never wider than where the run's second drawing looks for a skipped operation's
 * ink (charsBox's own shape, 0.4 below and 1 above, and a 6 pt cell: redactPages.ts), so that an operation
 * that agrees is always covered there.
 */
const hintShape = (em: number) => ({ along: 0.5, below: Math.min(0.45, 0.4 + 4 / Math.max(em, 1e-6)), above: Math.min(1.15, 1 + 4 / Math.max(em, 1e-6)) });
const HINT_PAD_PX = 2;
/** An operation's own glyphs, for telling its ink from its neighbours' in a run. */
const CORE_SHAPE = { along: 0, below: 0.25, above: 0.9 };
/** Operations drawn skipped together keep their boxes this far apart (pixels). */
const GROUP_GAP_PX = 1;
/** At most this many drawings beyond the first, for one page. */
export const MEASURE_MAX_DRAWINGS = 24;
/** Runs holding a chosen value or a piece of one are measured alone (at most this many on a page). */
const ISOLATE_MAX = 4;

interface Unit {
  ops: TextOp[];
  /** Their slots (index into the measure's op list). */
  slots: number[];
  /** The union of their glyph boxes; null when one with glyphs has none (it is measured alone). */
  box: PixelBox | null;
  glyphs: boolean;
  verdict?: { placed: boolean; painted: PixelBox | null };
}

/**
 * Rulings L1 and L2 (wave 4): where each text operation of `ops` (one page's reading, `readOperations`) really
 * painted, and whether its re-created glyph boxes agree with that. `draw(null)` draws the page; `draw(skip)`
 * draws it with those operations skipped (pdf.js `operationsFilter`), by the same engine, so the two differ
 * only where the skipped ones painted. Operations are measured by runs (those that follow one another with
 * nothing setting the text position: skipping one would move the next), many runs a drawing: runs whose glyph
 * boxes lie apart are skipped together and each difference is given to the run whose box holds it. A
 * difference no box holds means a run painted outside its box: the drawing's runs are halved and drawn again
 * until it is found (a run alone owns all it changes). A run whose glyphs should show but whose box shows no
 * difference is drawn again with the others like it, alone, so a run that painted wholly elsewhere is found
 * too. Runs that hold a chosen value or a piece of one (`values`) are drawn alone. At most
 * MEASURE_MAX_DRAWINGS drawings are made; what is left unmeasured is unplaced, with nothing known of where it
 * painted. `tick` gives the window a turn between drawings. `into`: the drawing `ops` came from, whose pixel
 * boxes (`TextOp.box`) are widened to what each operation painted.
 *
 * Each operation comes back with `placed` (its ink lies inside its glyph boxes, grown by HINT_SHAPE: they agree)
 * and `painted` (user space); an operation taken as invisible whose run painted outside the visible ones'
 * boxes comes back visible and unplaced.
 */
export async function placeOperations(
  ops: readonly TextOp[],
  draw: (skip: ReadonlySet<number> | null) => Promise<MeasureDrawing>,
  options: { into?: { transform: readonly number[]; width: number; height: number }; values?: readonly string[]; tick?: () => Promise<void>; maxDrawings?: number; full?: MeasureDrawing } = {},
): Promise<{ ops: TextOp[]; drawings: number }> {
  const measured = ops.filter((o) => o.index >= 0);
  if (measured.length === 0) return { ops: [...ops], drawings: 0 };
  // `full`: the page as drawn already at the measure's scale (a glance), else drawn here.
  const full = options.full ?? (await draw(null));
  const { width: w, height: h } = full;
  const n = w * h;
  const t = full.transform;
  if (full.data.length < n * 4 || t.length < 6) throw new Error('The page could not be drawn for the measure.');
  const budget = options.maxDrawings ?? MEASURE_MAX_DRAWINGS;
  let drawings = 0;
  const matters = valueParts(options.values ?? []).matters;
  const clip = (b: PixelBox): PixelBox | null => {
    const r = { left: Math.max(0, b.left), top: Math.max(0, b.top), right: Math.min(w, b.right), bottom: Math.min(h, b.bottom) };
    return r.right > r.left && r.bottom > r.top ? r : null;
  };
  const hasGlyphs = (o: TextOp) => /\S/.test(o.text) || o.inner !== '' || o.at === null;
  // Each operation's glyph box in the measure's pixels (all its characters, grown by the tolerance), or null.
  const hints = measured.map((o) => {
    if (!o.at || !o.chars || o.chars.length < 2) return null;
    const em = o.at.ux !== undefined && o.at.uy !== undefined && Math.hypot(o.at.ux, o.at.uy) > 0 ? Math.hypot(o.at.ux, o.at.uy) : o.at.size;
    const b = charsBox({ ...o, placed: true, type3: undefined }, [[0, o.chars.length - 1]], t, hintShape(em));
    return b ? { left: b.left - HINT_PAD_PX, top: b.top - HINT_PAD_PX, right: b.right + HINT_PAD_PX, bottom: b.bottom + HINT_PAD_PX } : null;
  });
  // Each visible operation's own glyphs (not grown): within a run, ink there is its own, not a neighbour's.
  const cores = measured.map((o) => (o.visible && o.at && o.chars && o.chars.length >= 2 ? charsBox({ ...o, placed: true, type3: undefined }, [[0, o.chars.length - 1]], t, CORE_SHAPE) : null));
  // Per slot: ink counted inside its box, the box of that ink, and ink inside its box only where no visible operation of its run has one.
  const ink = new Int32Array(measured.length);
  const hidden = new Int32Array(measured.length);
  const inkBox = measured.map(() => ({ left: w, top: h, right: 0, bottom: 0 }));
  // Runs.
  const units: Unit[] = [];
  const byRun = new Map<number, Unit>();
  measured.forEach((o, slot) => {
    const key = o.run ?? -1 - slot;
    let u = byRun.get(key);
    if (!u) {
      u = { ops: [], slots: [], box: null, glyphs: false };
      byRun.set(key, u);
      units.push(u);
    }
    u.ops.push(o);
    u.slots.push(slot);
  });
  const unhinted = new Set<Unit>();
  for (const u of units) {
    let box: PixelBox | null = null;
    for (const slot of u.slots) {
      const o = measured[slot];
      if (!hasGlyphs(o)) continue;
      u.glyphs = true;
      const b = hints[slot] ? clip(hints[slot]!) : null;
      if (!hints[slot]) unhinted.add(u);
      if (!b) continue;
      box = box ? { left: Math.min(box.left, b.left), top: Math.min(box.top, b.top), right: Math.max(box.right, b.right), bottom: Math.max(box.bottom, b.bottom) } : b;
    }
    u.box = unhinted.has(u) ? null : box;
  }
  const labels = new Int32Array(n);
  const a32 = full.data.byteOffset % 4 === 0 ? new Uint32Array(full.data.buffer, full.data.byteOffset, n) : null;
  /** One drawing with the runs of `set` skipped; each difference given to the operation whose box holds it (with `attribute`). Null: over the budget. */
  const measure = async (set: Unit[], attribute: boolean): Promise<{ stray: number; strayBox: PixelBox } | null> => {
    if (drawings >= budget) return null;
    drawings++;
    const skip = new Set<number>();
    for (const u of set) for (const o of u.ops) skip.add(o.index);
    const d = await draw(skip);
    if (d.width !== w || d.height !== h || d.data.length < n * 4) throw new Error('The page was drawn at another size for the measure.');
    const filled: PixelBox[] = [];
    if (attribute) {
      const fill = (b: PixelBox | null, label: number) => {
        if (!b) return;
        for (let y = b.top; y < b.bottom; y++) labels.fill(label, y * w + b.left, y * w + b.right);
        filled.push(b);
      };
      for (const u of set) {
        // Invisible operations first, so a visible one's box wins where they overlap; each one's own glyphs last.
        const order = [...u.slots].sort((x, y) => Number(measured[x].visible) - Number(measured[y].visible));
        for (const slot of order) fill(hints[slot] ? clip(hints[slot]!) : null, (slot + 1) * 2 + (measured[slot].visible ? 1 : 0));
        for (const slot of order) if (hints[slot] && cores[slot]) fill(clip(cores[slot]!), (slot + 1) * 2 + 1);
      }
    }
    for (const u of set) for (const slot of u.slots) {
      ink[slot] = 0;
      hidden[slot] = 0;
      inkBox[slot] = { left: w, top: h, right: 0, bottom: 0 };
    }
    let stray = 0;
    const strayBox = { left: w, top: h, right: 0, bottom: 0 };
    const b32 = a32 && d.data.byteOffset % 4 === 0 ? new Uint32Array(d.data.buffer, d.data.byteOffset, n) : null;
    const fa = full.data;
    const fb = d.data;
    for (let p = 0; p < n; p++) {
      if (a32 && b32) {
        if (a32[p] === b32[p]) continue;
      } else {
        const q = p * 4;
        if (fa[q] === fb[q] && fa[q + 1] === fb[q + 1] && fa[q + 2] === fb[q + 2] && fa[q + 3] === fb[q + 3]) continue;
      }
      const x = p % w;
      const y = (p - x) / w;
      const label = labels[p];
      if (label === 0) {
        stray++;
        grow(strayBox, x, y);
        continue;
      }
      const slot = (label >> 1) - 1;
      ink[slot]++;
      grow(inkBox[slot], x, y);
      if ((label & 1) === 0) hidden[slot]++;
    }
    for (const b of filled) for (let y = b.top; y < b.bottom; y++) labels.fill(0, y * w + b.left, y * w + b.right);
    await options.tick?.();
    return { stray, strayBox };
  };
  const unionOf = (u: Unit, extra?: PixelBox): PixelBox | null => {
    let box: PixelBox | null = extra && extra.right > extra.left ? { ...extra } : null;
    for (const slot of u.slots) {
      const b = inkBox[slot];
      if (b.right <= b.left) continue;
      box = box ? { left: Math.min(box.left, b.left), top: Math.min(box.top, b.top), right: Math.max(box.right, b.right), bottom: Math.max(box.bottom, b.bottom) } : { ...b };
    }
    return box;
  };
  const inkOf = (u: Unit) => u.slots.reduce((s, slot) => s + ink[slot], 0);
  const empties: Unit[] = [];
  const conclude = (u: Unit, strayBox?: PixelBox) => {
    if (strayBox) u.verdict = { placed: false, painted: unionOf(u, strayBox) };
    else if (u.slots.some((slot) => hidden[slot] > 0)) u.verdict = { placed: false, painted: unionOf(u) };
    else if (inkOf(u) === 0 && u.glyphs && u.ops.some((o) => o.visible && hasGlyphs(o) && (o.at?.size ?? 1) > 0)) empties.push(u);
    else u.verdict = { placed: true, painted: unionOf(u) };
  };
  const unmeasured = (u: Unit, painted: PixelBox | null) => {
    u.verdict ??= { placed: false, painted };
  };
  const halves = (set: Unit[]): [Unit[], Unit[]] => [set.slice(0, Math.ceil(set.length / 2)), set.slice(Math.ceil(set.length / 2))];
  // A set of runs whose boxes lie apart, drawn skipped together; halved where a difference no box holds is found.
  const resolve = async (set: Unit[], parentStray?: PixelBox): Promise<void> => {
    const r = await measure(set, true);
    if (r === null) {
      for (const u of set) unmeasured(u, parentStray ? unionOf(u, parentStray) : null);
      return;
    }
    if (r.stray === 0) {
      for (const u of set) conclude(u);
      return;
    }
    if (set.length === 1) {
      conclude(set[0], r.strayBox);
      return;
    }
    const [x, y] = halves(set);
    await resolve(x, r.strayBox);
    await resolve(y, r.strayBox);
  };
  // Runs whose glyphs should show and whose boxes showed nothing: drawn skipped together, alone, then halved.
  const resolveEmpty = async (set: Unit[]): Promise<void> => {
    const r = await measure(set, false);
    if (r === null) {
      for (const u of set) unmeasured(u, null);
      return;
    }
    if (r.stray === 0) {
      for (const u of set) u.verdict = { placed: true, painted: null };
      return;
    }
    if (set.length === 1) {
      set[0].verdict = { placed: false, painted: { ...r.strayBox } };
      return;
    }
    const [x, y] = halves(set);
    await resolveEmpty(x);
    await resolveEmpty(y);
  };
  // Runs whose every operation is invisible (an OCR text layer): one drawing with all of them skipped proves
  // they paint nothing (else they are measured with the others, below).
  const unseen = units.filter((u) => u.glyphs && u.ops.every((o) => !o.visible));
  if (unseen.length > 0) {
    const r = await measure(unseen, false);
    if (r !== null && r.stray === 0) for (const u of unseen) u.verdict = { placed: true, painted: null };
  }
  // Groups: runs with a glyph box, apart from every other in the group; the ones that matter, alone.
  const alone: Unit[] = [];
  const grouped: Unit[] = [];
  // Runs whose glyph boxes lie wholly off the drawing (outside the crop box): together, nothing to tell apart.
  const offPage: Unit[] = [];
  let isolated = 0;
  for (const u of units) {
    if (u.verdict) continue;
    if (!u.glyphs && !u.ops.some((o) => o.inner !== '')) {
      // Nothing it shows.
      u.verdict = { placed: true, painted: null };
      continue;
    }
    if (!u.box && !unhinted.has(u)) offPage.push(u);
    else if (!u.box) alone.push(u);
    else if (isolated < ISOLATE_MAX && u.ops.some((o) => matters(o.text) || matters(o.inner))) {
      isolated++;
      alone.push(u);
    } else grouped.push(u);
  }
  grouped.sort((x, y) => x.box!.top - y.box!.top || x.box!.left - y.box!.left);
  const groups: { units: Unit[]; boxes: PixelBox[] }[] = [];
  const apart = (p: PixelBox, q: PixelBox) => p.right + GROUP_GAP_PX <= q.left || q.right + GROUP_GAP_PX <= p.left || p.bottom + GROUP_GAP_PX <= q.top || q.bottom + GROUP_GAP_PX <= p.top;
  for (const u of grouped) {
    const g = groups.find((x) => x.boxes.every((b) => apart(b, u.box!)));
    if (g) {
      g.units.push(u);
      g.boxes.push(u.box!);
    } else groups.push({ units: [u], boxes: [u.box!] });
  }
  for (const g of groups) await resolve(g.units);
  if (offPage.length > 0) await resolve(offPage);
  for (const u of alone) await resolve([u]);
  if (empties.length > 0) await resolveEmpty(empties);
  // Back to user space (and to the caller's pixels).
  const det = t[0] * t[3] - t[1] * t[2];
  const toUser = (x: number, y: number): [number, number] => [(t[3] * (x - t[4]) - t[2] * (y - t[5])) / det, (-t[1] * (x - t[4]) + t[0] * (y - t[5])) / det];
  const userRect = (b: PixelBox | null): Rect | null => {
    if (!b || b.right <= b.left || b.bottom <= b.top || !(Math.abs(det) > 0)) return null;
    const corners = [toUser(b.left, b.top), toUser(b.right, b.top), toUser(b.left, b.bottom), toUser(b.right, b.bottom)];
    const xs = corners.map((c) => c[0]);
    const ys = corners.map((c) => c[1]);
    return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
  };
  const into = options.into;
  const intoPx = into && into.transform.length >= 6 ? (x: number, y: number): [number, number] => [into.transform[0] * x + into.transform[2] * y + into.transform[4], into.transform[1] * x + into.transform[3] * y + into.transform[5]] : null;
  const verdicts = new Map<number, { placed: boolean; painted: Rect | null; visible?: boolean }>();
  for (const u of units) {
    const v = u.verdict ?? { placed: false, painted: null };
    for (const slot of u.slots) {
      const o = measured[slot];
      const own = v.placed ? (inkBox[slot].right > inkBox[slot].left ? inkBox[slot] : null) : v.painted;
      verdicts.set(o.index, { placed: v.placed, painted: userRect(own), ...(!v.placed && v.painted && !o.visible && hasGlyphs(o) ? { visible: true } : {}) });
    }
  }
  const result = ops.map((o) => {
    const v = verdicts.get(o.index);
    if (!v || o.index < 0) return { ...o };
    let box = o.box;
    if (intoPx && v.painted) {
      const b = rectBox(v.painted, intoPx);
      const c = b && into ? { left: Math.max(0, b.left), top: Math.max(0, b.top), right: Math.min(into.width, b.right), bottom: Math.min(into.height, b.bottom) } : null;
      if (c && c.right > c.left && c.bottom > c.top) box = box ? { left: Math.min(box.left, c.left), top: Math.min(box.top, c.top), right: Math.max(box.right, c.right), bottom: Math.max(box.bottom, c.bottom) } : c;
    }
    return { ...o, ...(v.visible ? { visible: true } : {}), placed: v.placed, painted: v.painted, box };
  });
  return { ops: result, drawings };
}

/**
 * `ops` (a reading of a page, from a drawing at any scale) with the placement `placedOps` measured for the same
 * page (placeOperations, by operation index): `placed`, `painted` and a corrected `visible`; each box widened to
 * what the operation painted, in the pixels of `into` (the drawing `ops` came from). An operation the measure
 * did not see is unplaced, with nothing known of where it painted.
 */
export function withPlacement(ops: readonly TextOp[], placedOps: readonly TextOp[], into?: { transform: readonly number[]; width: number; height: number }): TextOp[] {
  const byIndex = new Map(placedOps.map((o) => [o.index, o]));
  const t = into?.transform;
  const toPx = t && t.length >= 6 ? (x: number, y: number): [number, number] => [t[0] * x + t[2] * y + t[4], t[1] * x + t[3] * y + t[5]] : null;
  return ops.map((o) => {
    if (o.index < 0) return { ...o };
    const p = byIndex.get(o.index);
    if (!p || p.placed === undefined) return { ...o, placed: false, painted: null };
    let box = o.box;
    const b = toPx && p.painted ? rectBox(p.painted, toPx) : null;
    const c = b && into ? { left: Math.max(0, b.left), top: Math.max(0, b.top), right: Math.min(into.width, b.right), bottom: Math.min(into.height, b.bottom) } : null;
    if (c && c.right > c.left && c.bottom > c.top) box = box ? { left: Math.min(box.left, c.left), top: Math.min(box.top, c.top), right: Math.max(box.right, c.right), bottom: Math.max(box.bottom, c.bottom) } : c;
    return { ...o, visible: o.visible || p.visible, placed: p.placed, painted: p.painted ?? null, box };
  });
}

function grow(b: PixelBox, x: number, y: number) {
  if (x < b.left) b.left = x;
  if (y < b.top) b.top = y;
  if (x + 1 > b.right) b.right = x + 1;
  if (y + 1 > b.bottom) b.bottom = y + 1;
}
