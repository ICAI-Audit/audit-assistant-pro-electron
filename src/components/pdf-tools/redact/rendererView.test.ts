// The renderer-view reading (fix wave 3, ruling A): what pdf.js draws, read from its own operator list.
// Invented values only (QWXPT4821K, "Ramesh Kumar Gupta").
import { PDFDocument, PDFName, PDFString, StandardFonts, type PDFRef } from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { RedactKind } from '@/lib/pdf-tools/redactPatterns';
import { loosePlaces } from './redactRounds';
import { flaggedOperations, type TextOp } from './rendererView';
import { nodeEnv, type NodeEnv } from './testRedactRun';
import { addAnnot, addContent, addRes, BBOX, cidFont, formX, newPage, RECT, split, splitName, stamp, twins, type3, V, viewLeft, W, type Build } from './testRendererView';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const PAN = 'QWXPT4821K';
const NAME = 'Ramesh Kumar Gupta';
let env: NodeEnv;
beforeAll(async () => {
  env = await nodeEnv();
});
afterAll(async () => {
  await env?.close();
});

const holdsOf = (kind: 'pan' | 'typed', value: string) => (s: string) => loosePlaces(s, kind, value).length > 0;
const spansOf = (kind: 'pan' | 'typed', value: string) => (s: string) => loosePlaces(s, kind, value).map((p): [number, number] => [p.start, p.end]);

async function pageWith(content: string, extra: (doc: PDFDocument, font: PDFRef) => Record<string, unknown> = () => ({})) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const ctx = doc.context;
  const p = doc.addPage([595, 842]);
  p.node.set(PDFName.of('Resources'), ctx.obj({ Font: { F1: font.ref }, ...extra(doc, font.ref) } as never));
  p.node.set(PDFName.of('Contents'), ctx.register(ctx.flateStream(content)));
  return doc.save({ useObjectStreams: false });
}
const read = async (bytes: Uint8Array) => (await env.renderer.renderPagePixels(bytes, 0, 1, { read: true })).textOps ?? [];
const texts = (ops: TextOp[], flagged: Set<number>) => ops.filter((o) => flagged.has(o.index)).map((o) => o.text || o.inner);

describe("the renderer-view reading (T-048 wave 3)", () => {
  it('reads text where pdf.js draws it: a soft mask group writing the PAN in a font read by its glyph names (finding 7)', async () => {
    const bytes = await pageWith('BT /F1 11 Tf 60 780 Td (Ordinary words) Tj ET q /GM gs 0 g 50 590 300 30 re f Q', (doc) => {
      const ctx = doc.context;
      const names = [...new Set(Array.from(PAN))];
      const GLYPH: Record<string, string> = { '1': 'one', '2': 'two', '4': 'four', '8': 'eight' };
      const coded = ctx.register(ctx.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica', Encoding: { Type: 'Encoding', BaseEncoding: 'WinAnsiEncoding', Differences: [0x61, ...names.map((c) => PDFName.of(GLYPH[c] ?? c))] } } as never));
      const enc = Array.from(PAN).map((c) => String.fromCharCode(0x61 + names.indexOf(c))).join('');
      const group = ctx.register(ctx.flateStream(`0 g 0 0 595 842 re f 1 g BT /FD 14 Tf 60 600 Td (${enc}) Tj ET`, { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 595, 842], Group: { S: 'Transparency', CS: 'DeviceGray' }, Resources: { Font: { FD: coded } } } as never));
      return { ExtGState: ctx.obj({ GM: { Type: 'ExtGState', SMask: { Type: 'Mask', S: 'Luminosity', G: group } } } as never) };
    });
    const ops = await read(bytes);
    const { flagged } = flaggedOperations(ops, holdsOf('pan', PAN), spansOf('pan', PAN));
    expect(texts(ops, flagged)).toEqual([PAN]);
    expect(ops.find((o) => o.text === PAN)?.drawing).toMatch(/^(group|form):/);
  });

  it('a pattern cell that writes the PAN flags the operation that sets the pattern; a font with private-use characters is unreadable', async () => {
    const bytes = await pageWith('BT /F1 11 Tf 60 780 Td (Ordinary words) Tj ET /Pattern cs /P1 scn 60 400 200 30 re f BT /FU 11 Tf 60 300 Td (abc) Tj ET', (doc, f1) => {
      const ctx = doc.context;
      const pattern = ctx.register(ctx.flateStream(`BT /F1 12 Tf 4 8 Td (${PAN}) Tj ET`, { Type: 'Pattern', PatternType: 1, PaintType: 1, TilingType: 1, BBox: [0, 0, 200, 30], XStep: 200, YStep: 30, Resources: ctx.obj({ Font: { F1: f1 } } as never) } as never));
      const cmap = '/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CMapName /Lie def /CMapType 2 def 1 begincodespacerange <00> <FF> endcodespacerange 1 beginbfrange <61> <63> <E000> endbfrange endcmap CMapName currentdict /CMap defineresource pop end end';
      const lying = ctx.register(ctx.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica', Encoding: 'WinAnsiEncoding', ToUnicode: ctx.register(ctx.flateStream(cmap)) } as never));
      return { Pattern: ctx.obj({ P1: pattern }), Font: ctx.obj({ F1: f1, FU: lying }) };
    });
    const ops = await read(bytes);
    const { flagged, unreadable } = flaggedOperations(ops, holdsOf('pan', PAN), spansOf('pan', PAN));
    const pattern = ops.find((o) => o.inner.includes(PAN));
    expect(pattern && flagged.has(pattern.index)).toBe(true);
    expect([...unreadable].map((i) => ops.find((o) => o.index === i)?.text.length)).toEqual([3]);
    expect(texts(ops, flagged)).not.toContain('Ordinary words');
  });

  it('joins pieces in drawing order, by position and down a column, rejoins a word broken by a hyphen, and flags only the pieces that hold the value', async () => {
    const bytes = await pageWith(
      'BT /F1 10 Tf 60 780 Td (Received from Ramesh Ku-) Tj 0 -12 Td (mar Gupta today) Tj ET ' +
        'BT /F1 10 Tf 60 650 Td (Ramesh Kumar) Tj 150 0 Td (Salary) Tj -150 -12 Td (Gupta) Tj ET ' +
        'BT /F1 10 Tf 1 0 0 1 60 500 Tm (QWXPT) Tj 1 0 0 1 60 488 Tm (Date 14 Nov 2026) Tj 1 0 0 1 91.7 500 Tm (4821K) Tj ET ' +
        'BT /F1 10 Tf 60 400 Td (Ordinary closing words) Tj ET',
    );
    const ops = await read(bytes);
    const name = flaggedOperations(ops, holdsOf('typed', NAME), spansOf('typed', NAME));
    expect(texts(ops, name.flagged).sort()).toEqual(['Gupta', 'Ramesh Kumar', 'Received from Ramesh Ku-', 'mar Gupta today'].sort());
    const pan = flaggedOperations(ops, holdsOf('pan', PAN), spansOf('pan', PAN));
    expect(texts(ops, pan.flagged).sort()).toEqual(['4821K', 'QWXPT']);
  });

  it('the second drawing executes the same operations: skipped ones read the same and paint nothing', async () => {
    const bytes = await pageWith(`BT /F1 11 Tf 60 780 Td (PAN of the assessee: ) Tj (${PAN}) Tj ( dated) Tj ET`);
    const first = await env.renderer.renderPagePixels(bytes, 0, 2, { read: true });
    const target = first.textOps!.find((o) => o.text === PAN)!;
    const second = await env.renderer.renderPagePixels(bytes, 0, 2, { read: true, skip: new Set([target.index]) });
    expect(second.textOps!.map((o) => [o.index, o.text])).toEqual(first.textOps!.map((o) => [o.index, o.text]));
    let differ = 0;
    for (let i = 0; i < first.data.length; i += 4) if (first.data[i] !== second.data[i]) differ++;
    expect(differ).toBeGreaterThan(50);
  });
});

// ---- Wave 4, lane RX-VIEW (redact-fix-rules-5.md L5): re-test 3 lane T3-A's findings B1-B7, each the tester's
// recipe (redact-retest-3-T3-A.md, probe\fmt.test.ts) and two variations of mine. The measure is the reading's
// own (testRendererView.ts viewLeft): the value's ink the run's second drawing would leave.
const pan = [{ kind: 'pan' as const, value: PAN }];
const typed = [{ kind: 'typed' as const, value: NAME }];
const oddPan = [{ kind: 'pan' as const, value: 'QZXCV0000W' }];
type Make = (b: Build, hide: boolean) => void | Promise<void>;
const kernBack = (b: Build, a: string, c: string) => Math.round(((W(b, a) + W(b, c)) / 16) * 1000);
/** Page content that ends leaving a text state set, as an OCR text layer leaves 3 Tr (B5). */
const leaveState = (b: Build, ops: string) => addContent(b, `BT /F1 9 Tf 1 0 0 1 60 60 Tm ${ops} (scanned page text layer) Tj ET`);
/** A Type 3 font whose glyph 'a' is a filled square (B4). */
const squareT3 = (b: Build) => type3(b, { a: [0x61, 600, '600 0 0 0 500 500 d1 0 0 500 500 re f'] });
/** AG29's font: glyph names a, b, c ... (ordinary but not the letters), each procedure writing its letter (or `chunks`) in Helvetica. */
function innerT3(b: Build, chunks: string[]): { ref: ReturnType<typeof type3>; enc: (parts: string[]) => string } {
  const uniq = [...new Set(chunks)];
  const glyphs: Record<string, [number, number, string]> = {};
  uniq.forEach((chunk, i) => {
    const width = Math.round(W(b, chunk, 1000));
    if (chunk === ' ') glyphs.space = [0x20, 278, '278 0 d0'];
    else glyphs[String.fromCharCode(0x61 + i)] = [0x61 + i, width, `${width} 0 d0 BT /F1 1000 Tf (${chunk}) Tj ET`];
  });
  const code = (chunk: string) => (chunk === ' ' ? 0x20 : 0x61 + uniq.indexOf(chunk));
  return { ref: type3(b, glyphs), enc: (parts) => `<${parts.map((p) => code(p).toString(16).padStart(2, '0')).join('').toUpperCase()}>` };
}
const name2 = ['Ra', 'me', 'sh', ' ', 'Ku', 'ma', 'r', ' ', 'Gu', 'pt', 'a'];

const L5: [string, Make, { kind: RedactKind; value: string }[]][] = [
  // B5 (top priority: OCR'd scans): every annotation appearance starts with a fresh text state.
  ['B5 AG32c: page leaves 3 Tr; a stamp writes the split PAN, no Tr of its own', (b, hide) => {
    leaveState(b, '3 Tr');
    stamp(b, formX(b, split(b, hide), BBOX));
  }, pan],
  ['B5 AG35: OCR-style page (3 Tr left set); a signature stamp writes the typed name across two lines of drawing order', (b, hide) => {
    leaveState(b, '3 Tr');
    stamp(b, formX(b, splitName(b, hide), BBOX));
  }, typed],
  ['B5 var: page leaves 3 Tr, 250 Ts, 40 Tz and 4 Tc; the stamp draws a form that writes the split PAN', (b, hide) => {
    leaveState(b, '3 Tr 250 Ts 40 Tz 4 Tc');
    const inner = formX(b, split(b, hide), BBOX);
    stamp(b, formX(b, 'q 1 0 0 1 0 0 cm /Fi Do Q', BBOX, { Resources: { XObject: { Fi: inner } } }));
  }, pan],
  ['B5 var: page leaves 3 Tr and 20 Tw; a FreeText appearance writes the split name', (b, hide) => {
    leaveState(b, '3 Tr 20 Tw');
    addAnnot(b, { Subtype: 'FreeText', Rect: RECT, Contents: PDFString.of('See note'), DA: PDFString.of('/Helv 12 Tf 0 g'), AP: b.doc.context.obj({ N: formX(b, splitName(b, hide, 'By '), BBOX) } as never) });
  }, typed],
  // B1: a transparency group form's /Matrix is applied once (pdf.js beginGroup only sizes the group).
  ['B1 AG02: the split stamp inside a group form with /Matrix [1 0 0 1 0 -100]', (b, hide) => {
    const inner = formX(b, split(b, hide), BBOX, { Group: { S: 'Transparency' }, Matrix: [1, 0, 0, 1, 0, -100] });
    stamp(b, formX(b, 'q 1 0 0 1 0 100 cm /Fm1 Do Q', BBOX, { Resources: { XObject: { Fm1: inner } } }));
  }, pan],
  ['B1 AG21: the typed name split in a stamp inside a group form with a /Matrix', (b, hide) => {
    const inner = formX(b, splitName(b, hide, 'By '), BBOX, { Group: { S: 'Transparency' }, Matrix: [1, 0, 0, 1, 0, -100] });
    stamp(b, formX(b, 'q 1 0 0 1 0 100 cm /Fm1 Do Q', BBOX, { Resources: { XObject: { Fm1: inner } } }));
  }, typed],
  ['B1 var: page content draws a group form scaled 2 by its /Matrix holding the split PAN', (b, hide) => {
    addRes(b, 'XObject', { Fx: formX(b, split(b, hide), BBOX, { Group: { S: 'Transparency', I: true }, Matrix: [2, 0, 0, 2, -100, -400] }) });
    addContent(b, 'q 0.5 0 0 0.5 150 500 cm /Fx Do Q');
  }, pan],
  ['B1 var: a FreeText draws a skewed group inside a shifted group, the split name inside', (b, hide) => {
    const inner = formX(b, splitName(b, hide, 'By '), BBOX, { Group: { S: 'Transparency' }, Matrix: [1, 0, 0.3, 1, 0, 0] });
    const mid = formX(b, '/Fi Do', BBOX, { Group: { S: 'Transparency' }, Matrix: [1, 0, 0, 1, 0, -40], Resources: { XObject: { Fi: inner } } });
    addAnnot(b, { Subtype: 'FreeText', Rect: RECT, Contents: PDFString.of('Note'), DA: PDFString.of('/Helv 12 Tf 0 g'), AP: b.doc.context.obj({ N: formX(b, 'q 1 0 0 1 0 40 cm /Fm Do Q', BBOX, { Resources: { XObject: { Fm: mid } } }) } as never) });
  }, typed],
  // B2: a negative font size runs the text the other way (pdf.js textHScale * fontDirection).
  ['B2 AG04: the split stamp in -16 Tf with a half-turned text matrix (upright on the page)', (b, hide) => {
    stamp(b, formX(b, split(b, hide, { size: -16, tm: (x, y) => `-1 0 0 -1 ${x} ${y} Tm` }), BBOX));
  }, pan],
  ['B2 AG23: the split stamp in a negative size only (drawn turned half round)', (b, hide) => {
    stamp(b, formX(b, split(b, hide, { size: -16, tm: (x, y) => `1 0 0 1 ${300 - x} ${85 - y} Tm` }), BBOX));
  }, pan],
  ['B2 var: page content, -14 Tf with 150 Tz and 2 Tc, half-turned, other text between the halves', (b, hide) => {
    addContent(b, `BT 150 Tz 2 Tc /F1 -14 Tf -1 0 0 -1 100 600 Tm (PAN ) Tj ${V(hide, '(QWXPT) Tj')} -1 0 0 -1 100 640 Tm (Date 14 Nov 2026) Tj -1 0 0 -1 ${100 + 1.5 * (W(b, 'PAN QWXPT', 14) + 2 * 9)} 600 Tm ${V(hide, '(4821K) Tj')} ET`);
  }, pan],
  ['B2 var: a stamp writes the name in -16 Tf with a TJ of spacing numbers, half-turned, surname last', (b, hide) => {
    const x = 6 + W(b, 'By ');
    stamp(b, formX(b, `BT /F1 -16 Tf -1 0 0 -1 6 55 Tm (By ) Tj ${V(hide, '[(Ramesh) -250 (Kumar)] TJ')} -1 0 0 -1 6 25 Tm (Date 14 Nov 2026) Tj -1 0 0 -1 ${x + W(b, 'Ramesh') + 4 + W(b, 'Kumar') + W(b, ' ')} 55 Tm ${V(hide, '(Gupta) Tj')} ET`, BBOX));
  }, typed],
  // B3: one TJ that draws its glyphs out of order (a backward kern) is read by glyph position too.
  ['B3 AG09: one TJ in a stamp: 4821K, a backward kern, then QWXPT (reads 4821KQWXPT, shows QWXPT4821K)', (b, hide) => {
    stamp(b, formX(b, `BT /F1 16 Tf 1 0 0 1 6 55 Tm (PAN ) Tj 1 0 0 1 ${6 + W(b, 'PAN ') + W(b, 'QWXPT')} 55 Tm ${V(hide, `[(4821K) ${kernBack(b, '4821K', 'QWXPT')} (QWXPT)] TJ`)} ET`, BBOX));
  }, pan],
  ['B3 var: one TJ writes the surname first and the forenames after a backward kern', (b, hide) => {
    stamp(b, formX(b, `BT /F1 16 Tf 1 0 0 1 6 55 Tm (By ) Tj 1 0 0 1 ${6 + W(b, 'By ') + W(b, 'Ramesh Kumar ')} 55 Tm ${V(hide, `[(Gupta) ${kernBack(b, 'Gupta', 'Ramesh Kumar ')} (Ramesh Kumar )] TJ`)} ET`, BBOX));
  }, typed],
  ['B3 var: one TJ in three scrambled pieces (PT48, back to QWX, on to 21K)', (b, hide) => {
    const [a, c] = [W(b, 'PT48'), W(b, 'QWX')];
    stamp(b, formX(b, `BT /F1 16 Tf 1 0 0 1 ${6 + W(b, 'PAN ') + c} 55 Tm ${V(hide, `[(PT48) ${Math.round(((a + c) / 16) * 1000)} (QWX) ${-Math.round((a / 16) * 1000)} (21K)] TJ`)} 1 0 0 1 6 55 Tm (PAN ) Tj ET`, BBOX));
  }, pan],
  // B4: no advance after an invisible Type 3 run, or after any run at size 0 (pdf.js returns before advancing).
  ['B4 AG06: the split stamp with an invisible Type 3 run before the first half', (b, hide) => {
    stamp(b, formX(b, split(b, hide, { before: '3 Tr /T3 16 Tf (aaaaaaaaaaaaaaaa) Tj 0 Tr /F1 16 Tf' }), BBOX, {}, { T3: squareT3(b) }));
  }, pan],
  ['B4 AG07: the split stamp with a zero-size run carrying character spacing before the first half', (b, hide) => {
    stamp(b, formX(b, split(b, hide, { before: '/F1 0 Tf 25 Tc (aaaaaaaaaaaa) Tj 0 Tc /F1 16 Tf' }), BBOX));
  }, pan],
  ['B4 var: page content, an invisible Type 3 TJ with kerning numbers between the halves', (b, hide) => {
    addRes(b, 'Font', { T3: squareT3(b) });
    addContent(b, `BT /F1 16 Tf 1 0 0 1 100 600 Tm ${V(hide, '(QWXPT) Tj')} 3 Tr /T3 16 Tf [(aaa) -500 (aaa)] TJ 0 Tr /F1 16 Tf ${V(hide, '(4821K) Tj')} ET`);
  }, pan],
  ['B4 var: a zero-size run with word spacing and spaces before the name in a stamp', (b, hide) => {
    const xR = 6 + W(b, 'By ');
    stamp(b, formX(b, `BT /F1 16 Tf 1 0 0 1 6 55 Tm (By ) Tj /F1 0 Tf 30 Tw (a a a a a) Tj 0 Tw /F1 16 Tf ${V(hide, '(Ramesh Kumar) Tj')} 1 0 0 1 6 25 Tm (Date 14 Nov 2026) Tj 1 0 0 1 ${xR + W(b, 'Ramesh Kumar ')} 55 Tm ${V(hide, '(Gupta) Tj')} ET`, BBOX));
  }, typed],
  // B6: vertical writing (Identity-V) advances down the column.
  ['B6 AG08: the PAN halves in a vertical CID font in a stamp, a label written between', (b, hide) => {
    const f = cidFont(b, { vertical: true });
    const ap = formX(b, `BT /C1 16 Tf 1 0 0 1 160 190 Tm ${V(hide, `${f.enc('QWXPT')} Tj`)} /F1 10 Tf 1 0 0 1 10 20 Tm (Date 14 Nov 2026) Tj /C1 16 Tf 1 0 0 1 160 110 Tm ${V(hide, `${f.enc('4821K')} Tj`)} ET`, [0, 0, 320, 200], {}, { C1: f.ref });
    addAnnot(b, { Subtype: 'Stamp', Rect: [100, 360, 420, 560], AP: b.doc.context.obj({ N: ap } as never) });
  }, pan],
  ['B6 FT18: the whole PAN in a vertical CID font in page content', (b, hide) => {
    const f = cidFont(b, { vertical: true });
    addRes(b, 'Font', { C1: f.ref });
    addContent(b, `BT /C1 16 Tf 1 0 0 1 300 700 Tm ${V(hide, `${f.enc(PAN)} Tj`)} ET`);
  }, pan],
  ['B6 var: vertical with per-glyph metrics (W2), page content, the halves apart with a label between', (b, hide) => {
    const f = cidFont(b, { vertical: true, w2: true });
    addRes(b, 'Font', { C1: f.ref });
    addContent(b, `BT /C1 14 Tf 1 0 0 1 300 700 Tm ${V(hide, `${f.enc('QWXPT')} Tj`)} /F1 10 Tf 1 0 0 1 60 300 Tm (Date 14 Nov 2026) Tj /C1 14 Tf 1 0 0 1 300 ${700 - 5 * 1.1 * 14} Tm ${V(hide, `${f.enc('4821K')} Tj`)} ET`);
  }, pan],
  ['B6 var: vertical with 3 Tc and 80 Tz in a stamp, the whole PAN', (b, hide) => {
    const f = cidFont(b, { vertical: true });
    const ap = formX(b, `BT 3 Tc 80 Tz /C1 15 Tf 1 0 0 1 160 190 Tm ${V(hide, `${f.enc(PAN)} Tj`)} ET`, [0, 0, 320, 200], {}, { C1: f.ref });
    addAnnot(b, { Subtype: 'Stamp', Rect: [100, 360, 420, 560], AP: b.doc.context.obj({ N: ap } as never) });
  }, pan],
  // B7: a Type 3 font's glyph procedures are read in glyph order, once per glyph shown.
  ['B7 AG29: Type 3 named a, b, c ...; procedures write the typed name in Helvetica (letters repeat)', (b, hide) => {
    const f = innerT3(b, Array.from(NAME));
    addRes(b, 'Font', { T3: f.ref });
    addContent(b, `BT /T3 16 Tf 1 0 0 1 100 560 Tm ${V(hide, `${f.enc(Array.from(NAME))} Tj`)} ET`);
  }, typed],
  ['B7 AG31: the AG29 font in a stamp writing the typed name', (b, hide) => {
    const f = innerT3(b, Array.from(NAME));
    stamp(b, formX(b, `BT /T3 16 Tf 6 50 Td ${V(hide, `${f.enc(Array.from(NAME))} Tj`)} ET`, BBOX, {}, { T3: f.ref }));
  }, typed],
  ['B7 var: the same construction with a PAN that repeats a digit four times (QZXCV0000W)', (b, hide) => {
    const f = innerT3(b, Array.from('QZXCV0000W'));
    addRes(b, 'Font', { T3: f.ref });
    addContent(b, `BT /T3 16 Tf 1 0 0 1 100 560 Tm ${V(hide, `${f.enc(Array.from('QZXCV0000W'))} Tj`)} ET`);
  }, oddPan],
  ['B7 var: each procedure writes two letters; the space glyph repeats', (b, hide) => {
    const f = innerT3(b, name2);
    stamp(b, formX(b, `BT /T3 16 Tf 6 50 Td ${V(hide, `${f.enc(name2)} Tj`)} ET`, BBOX, {}, { T3: f.ref }));
  }, typed],
];

describe('wave 4, lane RX-VIEW: what pdf.js paints, placed and read as it paints it (L5: B1-B7)', () => {
  for (const [title, make, values] of L5) {
    it(title, async () => {
      const files = await twins(make);
      const got = await viewLeft(env, files, values);
      expect(got.ink).toBeGreaterThan(100);
      expect({ left: got.left, flagged: got.flagged }).toMatchObject({ left: 0 });
      // Only what holds the value: never the label written between its pieces, nor the page's own line.
      expect(got.flagged.filter((t) => /Date 14 Nov|Ordinary words/.test(t))).toEqual([]);
    });
  }
  it('with the pixel measure (L1-L2), every operation of these recipes comes out placed: the re-created places agree with what pdf.js painted', async () => {
    const unplaced: string[] = [];
    for (const [title, make, values] of L5) {
      const got = await viewLeft(env, await twins(make), values, { measure: true });
      expect(got.left).toBe(0);
      for (const o of got.ops) if (o.placed === false && o.visible) unplaced.push(`${title.slice(0, 9)}: "${o.text || o.inner}"`);
    }
    expect(unplaced).toEqual([]);
  });
});

// ---- Rulings L1-L4: the guard, for what the re-creation does not foresee ------------------------------------
describe('wave 4, lane RX-VIEW: positions proved by pixels (L1-L4)', () => {
  /** The re-creation made wrong on purpose: the operations reading `text` are moved `by` points along their run (a fault not foreseen). */
  const misplace = (ops: TextOp[], text: RegExp, by: number) =>
    ops.map((o) => (o.at && text.test(o.text) ? { ...o, at: { ...o.at, x: o.at.x + by * o.at.dx, y: o.at.y + by * o.at.dy } } : o));

  it('an ordinary page: every operation placed, in a few drawings, nothing taken as unplaced', async () => {
    const lines = Array.from({ length: 30 }, (_, k) => `BT /F1 10 Tf 60 ${740 - k * 12} Td (Line ${k + 1}: ordinary words of the letter, an amount of Rs. 4,500 and a date) Tj ET`).join(' ');
    // (And a line outside the page, as printers' marks are: nothing of it shows.)
    const bytes = await pageWith(`${lines} BT /F1 10 Tf 60 300 Td (PAN of the assessee: ) Tj (${PAN}) Tj ( dated) Tj ET BT /F1 10 Tf 640 300 Td (Outside the page) Tj ET`);
    const first = await env.renderer.renderPagePixels(bytes, 0, 2, { read: true });
    const { placeOperations } = await import('./rendererView');
    const placed = await placeOperations(first.textOps!, (skip) => env.renderer.renderPagePixels(bytes, 0, 1, skip ? { skip } : {}), { into: first, values: [PAN] });
    expect(placed.ops.filter((o) => o.placed !== true).map((o) => o.text)).toEqual([]);
    expect(placed.ops.find((o) => o.text === 'Outside the page')?.painted).toBeNull();
    expect(placed.drawings).toBeLessThanOrEqual(7);
    // What each painted is where its glyphs are.
    const pan1 = placed.ops.find((o) => o.text === PAN)!;
    expect(pan1.painted!.x0).toBeGreaterThan(150);
    expect(pan1.painted!.x1).toBeLessThan(260);
    expect(pan1.box).not.toBeNull();
  });

  const splitStamp: Make = (b, hide) => {
    stamp(b, formX(b, split(b, hide), BBOX));
  };
  it('a re-creation that is wrong (a piece moved 120 pt): the piece is unplaced and covered whole where it really painted', async () => {
    const files = await twins(splitStamp);
    const wrong = await viewLeft(env, files, pan, { tamper: (ops) => misplace(ops, /^4821K$/, 120) });
    expect(wrong.left).toBeGreaterThan(300);
    const guarded = await viewLeft(env, files, pan, { measure: true, tamper: (ops) => misplace(ops, /^4821K$/, 120) });
    expect(guarded.left).toBe(0);
    const piece = guarded.ops.find((o) => o.text === '4821K')!;
    expect(piece.placed).toBe(false);
    expect(guarded.flagged).toContain('4821K');
  });

  it('a wrong visibility (an operation taken as invisible that paints): measured, made visible and covered', async () => {
    const files = await twins(splitStamp);
    const hideIt = (ops: TextOp[]) => ops.map((o) => (o.text === 'QWXPT' ? { ...o, visible: false } : o));
    expect((await viewLeft(env, files, pan, { tamper: hideIt })).left).toBeGreaterThan(300);
    const guarded = await viewLeft(env, files, pan, { measure: true, tamper: hideIt });
    expect(guarded.left).toBe(0);
    expect(guarded.ops.find((o) => o.text === 'QWXPT')?.visible).toBe(true);
  });

  it('an OCR-style page: the invisible text layer is proved to paint nothing in one drawing; a run taken as invisible that paints is still found', async () => {
    const layer = Array.from({ length: 40 }, (_, k) => `BT 3 Tr /F1 10 Tf 60 ${760 - k * 15} Td (scanned line ${k + 1} of the text layer, Signed by Ramesh Kumar Gupta) Tj ET`).join(' ');
    const bytes = await pageWith(`${layer} BT 0 Tr /F1 12 Tf 60 100 Td (A visible footer line) Tj ET`);
    const first = await env.renderer.renderPagePixels(bytes, 0, 2, { read: true });
    const { placeOperations } = await import('./rendererView');
    const draw = (skip: ReadonlySet<number> | null) => env.renderer.renderPagePixels(bytes, 0, 1, skip ? { skip } : {});
    const placed = await placeOperations(first.textOps!, draw, { into: first, values: [NAME] });
    expect(placed.ops.filter((o) => !o.visible).every((o) => o.placed === true && o.painted === null)).toBe(true);
    // The two visible lines (the page's own and the footer) in one drawing, and one for the whole layer.
    expect(placed.drawings).toBeLessThanOrEqual(3);
    const files = await twins((b, hide) => addContent(b, `BT /F1 16 Tf 1 0 0 1 100 600 Tm (PAN ) Tj ${V(hide, '(QWXPT) Tj')} 1 0 0 1 100 560 Tm (Date 14 Nov 2026) Tj 1 0 0 1 ${100 + W(b, 'PAN QWXPT')} 600 Tm ${V(hide, '(4821K) Tj')} ET`));
    const lost = (ops: TextOp[]) => ops.map((o) => (o.text === '4821K' ? { ...o, visible: false } : o));
    expect((await viewLeft(env, files, pan, { tamper: lost })).left).toBeGreaterThan(300);
    const guarded = await viewLeft(env, files, pan, { measure: true, tamper: lost });
    expect(guarded.left).toBe(0);
    expect(guarded.ops.find((o) => o.text === '4821K')).toMatchObject({ visible: true, placed: false });
  });

  it('out of drawings: what is left unmeasured is unplaced, and covered whole where it holds a part of the value', async () => {
    const files = await twins(splitStamp);
    const got = await viewLeft(env, files, pan, { measure: true, maxDrawings: 0, tamper: (ops) => misplace(ops, /^4821K$/, 120) });
    expect(got.drawings).toBe(0);
    expect(got.ops.filter((o) => o.text).every((o) => o.placed === false)).toBe(true);
    expect(got.flagged.sort()).toEqual(['4821K', 'QWXPT']);
    expect(got.left).toBe(0);
  });

  it('L3: an unplaced operation whose letters only cover the value in another order is covered whole', async () => {
    const files = await twins((b, hide) => addContent(b, `BT /F1 16 Tf 1 0 0 1 100 600 Tm ${V(hide, '(K1284TPXWQ) Tj')} ET`));
    // (The text is the value reversed: no reading finds it; unplaced, its letters are enough to suspect it.)
    const guarded = await viewLeft(env, files, pan, { measure: true, tamper: (ops) => misplace(ops, /K1284/, 200) });
    expect(guarded.flagged).toContain('K1284TPXWQ');
    expect(guarded.left).toBe(0);
  });

  it('L4: a value split between two stamps (AG19), and between page text and a stamp (AG20), is found across the drawings', async () => {
    const ag19 = await twins((b, hide) => {
      const w1 = W(b, 'QWXPT');
      addAnnot(b, { Subtype: 'Stamp', Rect: [100, 500, 100 + w1 + 2, 530], AP: b.doc.context.obj({ N: formX(b, `BT /F1 16 Tf 0 8 Td ${V(hide, '(QWXPT) Tj')} ET`, [0, 0, w1 + 2, 30]) } as never) });
      addAnnot(b, { Subtype: 'Stamp', Rect: [100 + w1, 500, 200 + w1, 530], AP: b.doc.context.obj({ N: formX(b, `BT /F1 16 Tf 0 8 Td ${V(hide, '(4821K) Tj')} ET`, [0, 0, 100, 30]) } as never) });
    });
    const ag20 = await twins((b, hide) => {
      const w1 = W(b, 'QWXPT');
      addContent(b, `BT /F1 16 Tf 1 0 0 1 100 508 Tm ${V(hide, '(QWXPT) Tj')} ET`);
      addAnnot(b, { Subtype: 'Stamp', Rect: [100 + w1, 500, 200 + w1, 530], AP: b.doc.context.obj({ N: formX(b, `BT /F1 16 Tf 0 8 Td ${V(hide, '(4821K) Tj')} ET`, [0, 0, 100, 30]) } as never) });
    });
    // A variation: the name's surname in a stamp placed after the page's forenames, a stamp written between them.
    const mine = await twins((b, hide) => {
      addContent(b, `BT /F1 16 Tf 1 0 0 1 100 508 Tm (Signed by ) Tj ${V(hide, '(Ramesh Kumar) Tj')} ET`);
      addAnnot(b, { Subtype: 'Stamp', Rect: [300, 300, 400, 330], AP: b.doc.context.obj({ N: formX(b, 'BT /F1 12 Tf 0 8 Td (Received) Tj ET', [0, 0, 100, 30]) } as never) });
      const x = 100 + W(b, 'Signed by Ramesh Kumar ');
      addAnnot(b, { Subtype: 'Stamp', Rect: [x, 500, x + 100, 530], AP: b.doc.context.obj({ N: formX(b, `BT /F1 16 Tf 0 8 Td ${V(hide, '(Gupta) Tj')} ET`, [0, 0, 100, 30]) } as never) });
    });
    for (const [files, values] of [[ag19, pan], [ag20, pan], [mine, typed]] as const) {
      const got = await viewLeft(env, files, [...values]);
      expect(got.left).toBe(0);
      expect(got.flagged).not.toContain('Received');
    }
  });
});

// ---- Ruling N, the renderer's side: letters pdf.js invented, or that disagree with the glyph names -----------
describe('wave 4, lane RX-VIEW: fonts whose letters cannot be trusted (N)', () => {
  /** A Type 3 font over the PAN's characters: glyphs are bars (not text), named by `name`, coded a, b, c ... */
  async function t3Page(name: (ch: string) => string, toUnicode: boolean) {
    const b = await newPage();
    const uniq = [...new Set(Array.from(PAN))];
    const glyphs: Record<string, [number, number, string]> = {};
    uniq.forEach((ch, i) => (glyphs[name(ch)] = [0x61 + i, 600, `600 0 0 0 500 700 d1 0 0 ${100 + 40 * i} 700 re f`]));
    const font = type3(b, glyphs, toUnicode ? { toUnicode: Object.fromEntries(uniq.map((ch, i) => [0x61 + i, ch])) } : {});
    addRes(b, 'Font', { T3: font });
    addContent(b, `BT /T3 16 Tf 1 0 0 1 100 600 Tm <${Array.from(PAN).map((ch) => (0x61 + uniq.indexOf(ch)).toString(16)).join('')}> Tj ET`);
    return (await env.renderer.renderPagePixels(await b.doc.save({ useObjectStreams: false }), 0, 1, { read: true })).textOps!.find((o) => o.type3)!;
  }
  const GN: Record<string, string> = { '1': 'one', '2': 'two', '4': 'four', '8': 'eight' };
  const std = (ch: string) => GN[ch] ?? ch;

  it('FT26: Type 3 glyph names with suffixes (Q.sc, four.sc) and no map: pdf.js invents "abcdefghij"; read as the names say, and unreadable', async () => {
    const op = await t3Page((ch) => `${std(ch)}.sc`, false);
    expect(op.text).toBe(PAN);
    expect(op.unreadable).toBe(true);
    expect(op.gaveUp).toBe(true);
    const j = flaggedOperations([op], holdsOf('pan', PAN), spansOf('pan', PAN));
    expect([...j.flagged]).toEqual([op.index]);
    expect(j.places.size).toBe(0);
  });
  it('var: the same suffixed names with a map that agrees with them: readable', async () => {
    const op = await t3Page((ch) => `${std(ch)}.alt`, true);
    expect(op.text).toBe(PAN);
    expect(op.unreadable).toBe(false);
  });
  it('var: names no list knows (g1, g2 ...) and no map: pdf.js made the codes letters; unreadable. Standard names stay readable', async () => {
    const custom = await t3Page((ch) => `g${uniqIndex(ch) + 1}`, false);
    expect(custom.unreadable).toBe(true);
    expect(custom.gaveUp).toBe(true);
    const standard = await t3Page(std, false);
    expect(standard.text).toBe(PAN);
    expect(standard.unreadable).toBe(false);
  });
});
const uniqIndex = (ch: string) => [...new Set(Array.from(PAN))].indexOf(ch);

describe('wave 4, lane RX-VIEW: a simple font whose glyph names the drawing side is given (pdf.js fontExtraProperties)', () => {
  /** One showText of `codes` in a font F1 whose /Differences name each code; pdf.js's letters `unicode`. */
  async function readSimple(names: Record<number, string>, codes: number[], unicode: (code: number) => string) {
    const { OPS } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const { opIdsOf, readOperations } = await import('./rendererView');
    const ids = opIdsOf(OPS as unknown as Record<string, number>);
    const differences: string[] = [];
    for (const [code, name] of Object.entries(names)) differences[Number(code)] = name;
    const glyphs = codes.map((c) => ({ originalCharCode: c, unicode: unicode(c), width: 600, isSpace: false }));
    const list = { fnArray: [ids.beginText, ids.setFont, ids.setTextMatrix, ids.showText], argsArray: [[], ['F1', 16], [[1, 0, 0, 1, 100, 600]], [glyphs]] };
    return readOperations(list, ids, () => ({ fontMatrix: [0.001, 0, 0, 0.001, 0, 0], differences }), () => null)[0];
  }
  const codes = Array.from(PAN).map((ch) => 0x61 + uniqIndex(ch));
  const GN: Record<string, string> = { '1': 'one', '2': 'two', '4': 'four', '8': 'eight' };
  const names = (suffix: string) => Object.fromEntries([...new Set(Array.from(PAN))].map((ch, i) => [0x61 + i, `${GN[ch] ?? ch}${suffix}`]));

  it('FT07 / FT10: names that say the PAN while pdf.js gives other letters (a map of wrong letters, or suffixes it cannot read) are read as the names say, and unreadable', async () => {
    for (const suffix of ['', '.sc']) {
      const op = await readSimple(names(suffix), codes, (c) => String.fromCharCode(c));
      expect(op.text).toBe(PAN);
      expect(op).toMatchObject({ unreadable: true, gaveUp: true });
    }
  });
  it('FT06: right names, a map that gives private-use characters: read by the names, unreadable (the reading gave up on the letters)', async () => {
    const op = await readSimple(names(''), codes, (c) => String.fromCharCode(0xe000 + c - 0x61));
    expect(op.text).toBe(PAN);
    expect(op).toMatchObject({ unreadable: true, gaveUp: true });
  });
  it('control: names and letters that agree stay readable', async () => {
    const op = await readSimple(names(''), codes, (c) => Array.from(PAN)[codes.indexOf(c)]);
    expect(op).toMatchObject({ text: PAN, unreadable: false, gaveUp: false });
  });
});
