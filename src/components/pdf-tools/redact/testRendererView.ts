// TEST HELPER (Redact, the renderer-view reading, T-048 wave 4 lane RX-VIEW): recipes that place an invented
// value with one PDF feature (re-test 3 lane T3-A's, rebuilt here), and the reading's own measure of what of
// the value it would leave showing. Never imported by the application. Invented values only.
import * as fs from 'node:fs';
import { PDFDocument, PDFName, PDFString, StandardFonts, type PDFDict, type PDFFont, type PDFPage, type PDFRef } from 'pdf-lib';
import { loosePlacesOf } from '@/lib/pdf-tools/redactCheck';
import type { RedactKind } from '@/lib/pdf-tools/redactPatterns';
import { charsBox, flaggedOperations, placeOperations, type TextOp } from './rendererView';
import type { NodeEnv } from './testRedactRun';

export const PAN = 'QWXPT4821K';
export const NAME = 'Ramesh Kumar Gupta';

export interface Build {
  doc: PDFDocument;
  font: PDFFont;
  page: PDFPage;
}

/** `s`, or `s` made invisible (the twin without the value: re-test 3's `V`). */
export const V = (hide: boolean, s: string) => (hide ? `3 Tr ${s} 0 Tr` : s);

/** A one-page document with an ordinary line of Helvetica (F1) and `content` after it. */
export async function newPage(content = ''): Promise<Build> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([595, 842]);
  const ctx = doc.context;
  page.node.set(PDFName.of('Resources'), ctx.obj({ Font: { F1: font.ref } } as never));
  page.node.set(PDFName.of('Contents'), ctx.register(ctx.flateStream(`BT /F1 11 Tf 60 780 Td (Ordinary words only on this page) Tj ET ${content}`)));
  return { doc, font, page };
}

/** Adds entries to the page's /Resources /<kind>. */
export function addRes(b: Build, kind: string, entries: Record<string, PDFRef>) {
  const res = b.page.node.lookup(PDFName.of('Resources')) as PDFDict;
  let sub = res.lookup(PDFName.of(kind)) as PDFDict | undefined;
  if (!sub) {
    sub = b.doc.context.obj({}) as PDFDict;
    res.set(PDFName.of(kind), sub);
  }
  for (const [k, v] of Object.entries(entries)) sub.set(PDFName.of(k), v);
}

/** Appends a content stream to the page. */
export function addContent(b: Build, content: string) {
  const ctx = b.doc.context;
  const stream = ctx.register(ctx.flateStream(content));
  b.page.node.set(PDFName.of('Contents'), ctx.obj([b.page.node.get(PDFName.of('Contents')), stream] as never));
}

/** A form XObject with Helvetica as F1 (and `fonts`), `extra` entries in its dictionary. */
export function formX(b: Build, content: string, bbox: number[], extra: Record<string, unknown> = {}, fonts: Record<string, PDFRef> = {}): PDFRef {
  const ctx = b.doc.context;
  return ctx.register(ctx.flateStream(content, { Type: 'XObject', Subtype: 'Form', BBox: bbox, Resources: { Font: { F1: b.font.ref, ...fonts } }, ...extra } as never));
}

export function addAnnot(b: Build, dict: Record<string, unknown>, flags = 4): PDFRef {
  const ctx = b.doc.context;
  const ref = ctx.register(ctx.obj({ Type: 'Annot', P: b.page.ref, F: flags, ...dict } as never));
  const annots = b.page.node.get(PDFName.of('Annots'));
  if (annots) (annots as unknown as { push(o: PDFRef): void }).push(ref);
  else b.page.node.set(PDFName.of('Annots'), ctx.obj([ref]));
  return ref;
}

export const RECT = [100, 470, 420, 560];
export const BBOX = [0, 0, 320, 90];
/** A Stamp at RECT drawing `ap`. */
export const stamp = (b: Build, ap: PDFRef, extra: Record<string, unknown> = {}) => addAnnot(b, { Subtype: 'Stamp', Rect: RECT, AP: b.doc.context.obj({ N: ap } as never), ...extra });

export const W = (b: Build, s: string, size = 16) => b.font.widthOfTextAtSize(s, size);

/**
 * Re-test 2's finding 3 at 16 pt (re-test 3's `split`): the PAN's halves with another line written between
 * them, so drawing order reads "PAN QWXPT Date 14 Nov 2026 4821K" and the page shows "PAN QWXPT4821K".
 */
export function split(b: Build, hide: boolean, o: { font?: string; size?: number; tm?: (x: number, y: number) => string; before?: string; between?: string; first?: string; second?: string } = {}) {
  const f = o.font ?? 'F1';
  const s = o.size ?? 16;
  const tm = o.tm ?? ((x: number, y: number) => `1 0 0 1 ${x} ${y} Tm`);
  const [first, second] = [o.first ?? 'QWXPT', o.second ?? '4821K'];
  const xQ = 6 + W(b, 'PAN ');
  const xK = xQ + W(b, first);
  return `BT /${f} ${s} Tf ${tm(6, 55)} (PAN ) Tj ${o.before ?? ''} ${V(hide, `(${first}) Tj`)} ${tm(6, 25)} (Date 14 Nov 2026) Tj ${o.between ?? ''} ${tm(xK, 55)} ${V(hide, `(${second}) Tj`)} ET`;
}

/** The typed name split the same way inside a signature box: "Signed: Ramesh Kumar" ... "Gupta". */
export function splitName(b: Build, hide: boolean, label = 'Signed: ') {
  const xR = 6 + W(b, label);
  return `BT /F1 16 Tf 1 0 0 1 6 55 Tm (${label}) Tj ${V(hide, '(Ramesh Kumar) Tj')} 1 0 0 1 6 25 Tm (Date 14 Nov 2026) Tj 1 0 0 1 ${xR + W(b, 'Ramesh Kumar ')} 55 Tm ${V(hide, '(Gupta) Tj')} ET`;
}

/**
 * A Type 3 font. `glyphs` maps each glyph name to [code, width, procedure]; `names` true gives the glyph
 * names in /Differences (else the base encoding names them). Resources: Helvetica as F1.
 */
export function type3(b: Build, glyphs: Record<string, [number, number, string]>, opts: { toUnicode?: Record<number, string>; fontMatrix?: number[] } = {}): PDFRef {
  const ctx = b.doc.context;
  const procs: Record<string, PDFRef> = {};
  const codes = Object.values(glyphs).map(([c]) => c);
  const [first, last] = [Math.min(...codes), Math.max(...codes)];
  const widths: number[] = Array.from({ length: last - first + 1 }, () => 0);
  const diffs: unknown[] = [];
  for (const [name, [code, width, body]] of Object.entries(glyphs)) {
    procs[name] = ctx.register(ctx.flateStream(body));
    widths[code - first] = width;
    diffs.push(code, PDFName.of(name));
  }
  const dict: Record<string, unknown> = {
    Type: 'Font', Subtype: 'Type3', FontBBox: [-200, -300, 1300, 1100], FontMatrix: opts.fontMatrix ?? [0.001, 0, 0, 0.001, 0, 0], CharProcs: procs,
    Encoding: { Type: 'Encoding', Differences: diffs }, FirstChar: first, LastChar: last, Widths: widths, Resources: { Font: { F1: b.font.ref } },
  };
  if (opts.toUnicode) dict.ToUnicode = cmap(b, Object.entries(opts.toUnicode).map(([code, text]) => [Number(code), text]), 1);
  return ctx.register(ctx.obj(dict as never));
}

/** A ToUnicode map stream: codes of `bytes` bytes to text. */
function cmap(b: Build, pairs: [number, string][], bytes: 1 | 2): PDFRef {
  const hex = (n: number) => n.toString(16).padStart(bytes * 2, '0').toUpperCase();
  const u16 = (s: string) => Array.from(s).map((c) => c.charCodeAt(0).toString(16).padStart(4, '0')).join('').toUpperCase();
  const space = bytes === 1 ? '<00> <FF>' : '<0000> <FFFF>';
  const body = `/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CMapName /RV def /CMapType 2 def 1 begincodespacerange ${space} endcodespacerange ${pairs.length} beginbfchar ${pairs.map(([c, t]) => `<${hex(c)}> <${u16(t)}>`).join(' ')} endbfchar endcmap CMapName currentdict /CMap defineresource pop end end`;
  return b.doc.context.register(b.doc.context.flateStream(body));
}

// ---- a TrueType font from pdf.js's own standard fonts (Liberation Sans), for CID fonts ---------------------
interface Ttf {
  bytes: Buffer;
  gid(ch: string): number;
  /** Advance in thousandths of an em. */
  adv(gid: number): number;
}
let liberation: Ttf | null = null;
function ttf(): Ttf {
  if (liberation) return liberation;
  const b = fs.readFileSync(`${process.cwd().replace(/\\/g, '/')}/node_modules/pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf`);
  const t: Record<string, number> = {};
  for (let i = 0; i < b.readUInt16BE(4); i++) t[b.toString('latin1', 12 + 16 * i, 16 + 16 * i)] = b.readUInt32BE(12 + 16 * i + 8);
  const upem = b.readUInt16BE(t.head + 18);
  const nHM = b.readUInt16BE(t.hhea + 34);
  let sub = -1;
  for (let i = 0; i < b.readUInt16BE(t.cmap + 2); i++) {
    const [pid, eid, off] = [b.readUInt16BE(t.cmap + 4 + 8 * i), b.readUInt16BE(t.cmap + 6 + 8 * i), b.readUInt32BE(t.cmap + 8 + 8 * i)];
    if (pid === 3 && eid === 1 && b.readUInt16BE(t.cmap + off) === 4) sub = t.cmap + off;
  }
  const segX2 = b.readUInt16BE(sub + 6);
  const gid = (ch: string) => {
    const c = ch.charCodeAt(0);
    for (let i = 0; i < segX2 / 2; i++) {
      if (c > b.readUInt16BE(sub + 14 + 2 * i)) continue;
      const start = b.readUInt16BE(sub + 16 + segX2 + 2 * i);
      if (c < start) return 0;
      const delta = b.readInt16BE(sub + 16 + 2 * segX2 + 2 * i);
      const roAt = sub + 16 + 3 * segX2 + 2 * i;
      const ro = b.readUInt16BE(roAt);
      if (ro === 0) return (c + delta) & 0xffff;
      const g = b.readUInt16BE(roAt + ro + 2 * (c - start));
      return g === 0 ? 0 : (g + delta) & 0xffff;
    }
    return 0;
  };
  const adv = (g: number) => Math.round((b.readUInt16BE(t.hmtx + 4 * Math.min(g, nHM - 1)) * 1000) / upem);
  return (liberation = { bytes: b, gid, adv });
}

/**
 * A Type 0 font over Liberation Sans (CIDFontType2, CIDToGIDMap Identity: codes are glyph ids, two bytes
 * each) with a right ToUnicode map. `vertical`: Identity-V; `w2`: per-glyph vertical metrics.
 */
export function cidFont(b: Build, opts: { vertical?: boolean; w2?: boolean } = {}): { ref: PDFRef; enc: (s: string) => string } {
  const ctx = b.doc.context;
  const font = ttf();
  const chars = [...new Set(Array.from('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 :,.-'))];
  const gids = chars.map((ch) => [ch, font.gid(ch)] as const);
  const widths: unknown[] = [];
  for (const [, g] of gids) widths.push(g, [font.adv(g)]);
  const fd = ctx.register(ctx.obj({ Type: 'FontDescriptor', FontName: 'LiberationSans', Flags: 32, FontBBox: [-200, -300, 1300, 1000], ItalicAngle: 0, Ascent: 905, Descent: -212, CapHeight: 716, StemV: 80, FontFile2: ctx.register(ctx.flateStream(font.bytes, { Length1: font.bytes.length } as never)) } as never));
  const cidDict: Record<string, unknown> = { Type: 'Font', Subtype: 'CIDFontType2', BaseFont: 'LiberationSans', CIDSystemInfo: { Registry: PDFString.of('Adobe'), Ordering: PDFString.of('Identity'), Supplement: 0 }, FontDescriptor: fd, W: widths, DW: 1000, CIDToGIDMap: 'Identity' };
  // Per-glyph vertical metrics: each glyph advances 1100 units down, its origin 300 left of centre, 900 below.
  if (opts.w2) cidDict.W2 = gids.flatMap(([, g]) => [g, g, -1100, 300, 900]);
  const cid = ctx.register(ctx.obj(cidDict as never));
  const toUnicode = cmap(b, gids.map(([ch, g]) => [g, ch]), 2);
  const ref = ctx.register(ctx.obj({ Type: 'Font', Subtype: 'Type0', BaseFont: 'LiberationSans', Encoding: opts.vertical ? 'Identity-V' : 'Identity-H', DescendantFonts: [cid], ToUnicode: toUnicode } as never));
  return { ref, enc: (s: string) => `<${Array.from(s).map((ch) => font.gid(ch).toString(16).padStart(4, '0')).join('').toUpperCase()}>` };
}

export const save = (b: Build) => b.doc.save({ useObjectStreams: false });

/** The visible file and its twin (the same with the value invisible), made by `make(b, hide)`. */
export async function twins(make: (b: Build, hide: boolean) => void | Promise<void>): Promise<[Uint8Array, Uint8Array]> {
  const out: Uint8Array[] = [];
  for (const hide of [false, true]) {
    const b = await newPage();
    await make(b, hide);
    out.push(await save(b));
  }
  return [out[0], out[1]];
}

const lum = (d: Uint8ClampedArray, i: number) => 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
const differs = (a: Uint8ClampedArray, b: Uint8ClampedArray, p: number) => a[p * 4] !== b[p * 4] || a[p * 4 + 1] !== b[p * 4 + 1] || a[p * 4 + 2] !== b[p * 4 + 2];

export interface ViewLeft {
  /** The value's ink: pixels where the page differs from its twin. */
  ink: number;
  /** Of those, the ones the reading would leave: not removed when the flagged operations are skipped, or outside where the run looks. */
  left: number;
  /** The texts of the operations flagged. */
  flagged: string[];
  ops: TextOp[];
  drawings: number;
}

/**
 * What the renderer-view reading leaves of `values` on `page`, done as the run does it (redactPages.ts
 * drawRebuiltPage, step 2): the page read, (with `measure`) its operations placed by pixels (placeOperations),
 * judged (flaggedOperations), drawn again with the flagged ones skipped, and the difference looked for only
 * where each flagged operation's chosen characters paint (else where it painted), a cell around. The value's
 * ink is found from the twin; an ink pixel counts as left when the second drawing still shows it or it lies
 * outside where the run looks.
 */
export async function viewLeft(
  env: NodeEnv,
  [visible, hidden]: [Uint8Array, Uint8Array],
  values: { kind: RedactKind; value: string }[],
  opts: { page?: number; scale?: number; measure?: boolean; tamper?: (ops: TextOp[]) => TextOp[]; maxDrawings?: number } = {},
): Promise<ViewLeft> {
  const page = opts.page ?? 0;
  const scale = opts.scale ?? 2;
  const first = await env.renderer.renderPagePixels(visible, page, scale, { read: true });
  let ops = first.textOps ?? [];
  // A fault of the re-creation, made on purpose (the guard's tests).
  if (opts.tamper) ops = opts.tamper(ops);
  let drawings = 0;
  if (opts.measure) {
    const placed = await placeOperations(ops, (skip) => env.renderer.renderPagePixels(visible, page, 1, skip ? { skip } : {}), { into: first, values: values.map((v) => v.value), ...(opts.maxDrawings !== undefined ? { maxDrawings: opts.maxDrawings } : {}) });
    ops = placed.ops;
    drawings = placed.drawings;
  }
  const holds = (s: string) => values.some((v) => loosePlacesOf(s, v.kind, v.value).length > 0);
  const spans = (s: string) => values.flatMap((v) => loosePlacesOf(s, v.kind, v.value).map((p): [number, number] => [p.start, p.end]));
  const judged = flaggedOperations(ops, holds, spans, 3, values.map((v) => v.value));
  const second = judged.flagged.size > 0 ? await env.renderer.renderPagePixels(visible, page, scale, { skip: judged.flagged }) : first;
  const twin = await env.renderer.renderPagePixels(hidden, page, scale);
  const [w, h] = [first.width, first.height];
  const cell = Math.max(4, Math.round(6 * scale));
  const flaggedOps = ops.filter((o) => judged.flagged.has(o.index));
  const regionOf = (o: TextOp) => (judged.places.has(o.index) ? charsBox(o, judged.places.get(o.index)!, first.transform) : null) ?? o.box;
  let inside: Uint8Array | null = null;
  if (flaggedOps.length > 0 && flaggedOps.every((o) => regionOf(o) !== null)) {
    inside = new Uint8Array(w * h);
    for (const o of flaggedOps) {
      const r = regionOf(o)!;
      for (let y = Math.max(0, r.top - cell); y < Math.min(h, r.bottom + cell); y++) inside.fill(1, y * w + Math.max(0, r.left - cell), y * w + Math.min(w, r.right + cell));
    }
  }
  let ink = 0;
  let left = 0;
  for (let p = 0; p < w * h; p++) {
    if (Math.abs(lum(first.data, p) - lum(twin.data, p)) < 60) continue;
    ink++;
    const removed = judged.flagged.size > 0 && differs(first.data, second.data, p);
    if (!removed || (inside !== null && inside[p] === 0)) left++;
  }
  return { ink, left, flagged: flaggedOps.map((o) => o.text || o.inner), ops, drawings };
}
