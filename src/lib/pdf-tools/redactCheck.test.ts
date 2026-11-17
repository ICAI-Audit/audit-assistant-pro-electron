// The strings check of Redact (design 5.9 "The check", point 3) and the structure check (point 1).
// Every file is built in the test. A value is planted once in one written form and must be found
// and located (to its page, or to a named document place); the "must not be found" cases guard the
// check against matching what is not the value.
import * as zlib from 'node:zlib';
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRef, PDFStream, PDFString, StandardFonts, type PDFObject } from 'pdf-lib';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { buildRedacted, type RebuiltPage } from './redactBuild';
import { checkHits, contentStrings, drawingPass, findTargets, loosePlacesOf, pageCopyVerdicts, pageDrawings, pageDrawingsAndVerdicts, readerGaveUp, stringsHaystack, structureProblems, targetMatcher, targetPass, unboxedPages, type CheckTarget, type PageDrawing, type UnreadableReason } from './redactCheck';
import { buildPageText, type PageTextModel, type TextItemLike } from './pageText';
import { everyOccurrence, proposalsForPage, type FindOptions } from './redactFind';
import { TERM_RULE, keyOf, placesOfValue, type RedactKind } from './redactPatterns';
import { writtenForms } from './testRedactCorpus';
import { rawHaystack } from './testLeakPdf';
import { AADHAAR, GSTIN, standardMeasure } from './testRedactPdf';

vi.setConfig({ testTimeout: 60_000 });

const SECRET = 'BNZPM2501F';
const PAN: CheckTarget = { kind: 'pan', forms: [SECRET], wholeWord: false };
const NONE = new Set<number>();

/** A PDF literal string with every byte written as an octal escape. */
const octal = (bytes: number[]) => `(${bytes.map((b) => `\\${b.toString(8).padStart(3, '0')}`).join('')})`;
const ascii = (text: string) => Array.from(text, (c) => c.charCodeAt(0));
const utf16be = (text: string, bom = true) => [...(bom ? [0xfe, 0xff] : []), ...Array.from(text).flatMap((c) => [c.charCodeAt(0) >> 8, c.charCodeAt(0) & 0xff])];
const hex = (bytes: number[]) => `<${bytes.map((b) => b.toString(16).padStart(2, '0')).join('')}>`;
const plainPage = (n: number) => `BT /F1 12 Tf 50 700 Td (Page ${n} ordinary text) Tj ET`;

interface Built {
  doc: PDFDocument;
  pages: PDFRef[];
}

/**
 * `count` pages of Helvetica text; `contents[i]` replaces page i's content (raw operators). `edit`
 * may add anything before the file is saved.
 */
async function pdfWith(
  contents: Record<number, string>,
  options: { count?: number; objectStreams?: boolean; edit?: (built: Built) => void | Promise<void> } = {},
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages: PDFRef[] = [];
  for (let i = 0; i < (options.count ?? 3); i++) {
    const page = doc.addPage([595, 842]);
    page.node.set(PDFName.of('Resources'), doc.context.obj({ Font: { F1: font.ref } }));
    page.node.set(PDFName.of('Contents'), doc.context.register(doc.context.flateStream(contents[i] ?? plainPage(i + 1))));
    pages.push(page.ref);
  }
  await options.edit?.({ doc, pages });
  return doc.save({ useObjectStreams: options.objectStreams ?? false });
}

/** A seeded byte generator, so the "random" image is the same on every run. */
function noise(length: number, seed = 7): Uint8Array {
  const out = new Uint8Array(length);
  let x = seed;
  for (let i = 0; i < length; i++) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    out[i] = x & 0xff;
  }
  return out;
}

/** A tiny grey page picture (lossless) for rebuilt pages. */
function greyPicture(widthPx = 20, heightPx = 28): RebuiltPage['picture'] {
  return { bytes: zlib.deflateSync(Buffer.alloc(widthPx * heightPx, 230)), widthPx, heightPx, encoding: 'flate-gray' };
}

/** A page rebuilt "with boxes" whose one box is off the page, away from every word of these files. */
const AWAY = { reason: 'boxes' as const, boxes: [{ x0: -3, y0: -3, x1: -2, y1: -2 }] };

describe('contentStrings', () => {
  it('decodes escapes, nested parentheses, hex strings and a UTF-16 mark, and joins each TJ array', () => {
    const content = [
      'BT (\\102\\116Z) Tj (a\\(b\\)c) Tj (x(y)z) Tj (line\\',
      'join) Tj <424E5> Tj <FEFF0042004E> Tj [(BNZ) -20 (PM2501F)] TJ ET',
      '% (not a string) in a comment',
    ].join('\n');
    const strings = contentStrings(content);
    expect(strings).toEqual(expect.arrayContaining(['BNZ', 'a(b)c', 'x(y)z', 'linejoin', 'BN', SECRET]));
    expect(strings).toContain('BNP'); // <424E5> has an odd digit count: the last is read as 50
    expect(strings).not.toContain('not a string');
  });

  it('skips inline image data', () => {
    const strings = contentStrings('BI /W 4 /H 1 /BPC 8 /CS /G ID (ab) EI (after) Tj');
    expect(strings).toEqual(['after']);
  });
});

describe('targetMatcher', () => {
  it('compares codes in compact form, emails in lower case, typed terms as whole words', () => {
    const matches = targetMatcher([
      PAN,
      { kind: 'email', forms: ['r.kumar@example.in'], wholeWord: false },
      { kind: 'typed', forms: ['Sharma & Co'], wholeWord: true },
      { kind: 'aadhaar', forms: ['234567890124', '2345 6789 0124', '2345-6789-0124'], wholeWord: false },
    ]);
    expect(matches('PAN: bnz pm-2501 f')).toBe(true);
    expect(matches('ＢＮＺＰＭ２５０１Ｆ')).toBe(true); // full-width letters and digits
    expect(matches('Write to R.Kumar@Example.IN today')).toBe(true);
    expect(matches('Paid to SHARMA  &\nCO, Pune')).toBe(true);
    expect(matches('Paid to Sharma & Company')).toBe(false);
    expect(matches('UID 2345\u00a06789\u00a00124')).toBe(true);
    expect(matches('BNZPM2501')).toBe(false);
    expect(matches('')).toBe(false);
  });

  it('a typed term inside a longer word is not a match', () => {
    const matches = targetMatcher([{ kind: 'typed', forms: ['harm'], wholeWord: true }]);
    expect(matches('Pharmacy bill')).toBe(false);
    expect(matches('Do no harm.')).toBe(true);
  });

  it('a term made of digits matches with its spaces and hyphens ignored, never inside a longer number', () => {
    const matches = targetMatcher([{ kind: 'typed', forms: ['50100123'], wholeWord: true }]);
    expect(matches('A/c 5010 0123 at Pune')).toBe(true);
    expect(matches('A/c 5010-0123')).toBe(true);
    expect(matches('Ref 950100123')).toBe(false);
  });
});

describe('comparison by kind, in two passes (lead rulings 1 and 2)', () => {
  it("codes: strict with the find's own separators, loose with any other punctuation or folding", () => {
    const pass = targetPass([PAN]);
    expect(pass('PAN BNZPM2501F')).toBe('strict');
    expect(pass('BNZ PM-2501\nF')).toBe('strict'); // one space, hyphen or line break between characters
    expect(pass('bnzpm2501f')).toBe('strict'); // the find ignores case
    // The shared normalisation (R1, stand-in here) folds full-width forms and removes zero-width marks and soft hyphens.
    expect(pass('ＢＮＺＰＭ２５０１Ｆ')).toBe('strict');
    expect(pass(`BNZ${String.fromCharCode(0x200b)}PM25${String.fromCharCode(0xad)}01F`)).toBe('strict');
    // R1's shared rule: up to three characters that are not letters or digits between any two.
    expect(pass('BNZ  PM2501F')).toBe('strict');
    expect(pass('BNZPM.2501F')).toBe('strict');
    expect(pass('BNZPM / 2501/F')).toBe('strict');
    expect(pass('BNZ - / PM2501F')).toBe('loose'); // five: only the second net joins them
    expect(pass('BNZPM2501 / - F')).toBe('loose');
    expect(pass('BNZPM2501E')).toBeNull();
  });

  it('numbers allow up to two separators; the tax document number up to three punctuation marks', () => {
    const aadhaar = targetPass([{ kind: 'aadhaar', forms: ['234567890124'], wholeWord: false }]);
    expect(aadhaar('2345 6789\n0124')).toBe('strict');
    expect(aadhaar('2345 - 6789 - 0124')).toBe('strict');
    expect(aadhaar('2345 -- / 6789 0124')).toBe('loose');
    const din = targetPass([{ kind: 'tax-din', forms: ['ITBAASTS143120242512345678901'], wholeWord: false }]);
    expect(din('DIN: ITBA/AST/S/143(1)/2024-25/1234567890(1)')).toBe('strict');
    expect(din('ITBA / AST / S / 143 ( 1 ) / 2024-25 / 1234567890 ( 1 )')).toBe('loose');
  });

  it('an IP address keeps its dots and is never joined to other digits or dots', () => {
    const ip = targetPass([{ kind: 'ip', forms: ['10.0.0.1', '10001'], wholeWord: false }]);
    expect(ip('Server 10.0.0.1 is down')).toBe('strict');
    expect(ip('Server 10 . 0 . 0 . 1 is down')).toBe('loose');
    expect(ip('Voucher 10001 and invoice 1000.1')).toBeNull(); // a form without its dots is not compared
    expect(ip('Hosts 110.0.0.1, 10.0.0.12 and 10.0.0.1.5')).toBeNull();
  });

  it('emails as written ignoring case; loose without white space', () => {
    const email = targetPass([{ kind: 'email', forms: ['r.kumar@example.in'], wholeWord: false }]);
    expect(email('Mail R.Kumar@Example.in')).toBe('strict');
    expect(email('Mail r.kumar @ example.in')).toBe('strict'); // up to two white-space characters around . @ -
    expect(email('Mail r.kumar   @ example.in')).toBe('loose');
    expect(email('Mail r.ku mar@example.in')).toBe('loose');
    expect(email('Mail rkumar@example.in')).toBeNull();
  });

  it('words: strict ignoring case, with white space or any punctuation between words (folded)', () => {
    const typed = targetPass([{ kind: 'typed', forms: ['Sharma & Co'], wholeWord: true }]);
    expect(typed('paid to SHARMA &\n  co today')).toBe('strict');
    expect(typed('paid to ＳＨＡＲＭＡ & Co today')).toBe('strict');
    // hyphens between the words: the find's own rule since T-052 (redactPatterns.ts TERM_RULE), so strict
    expect(typed('paid to Sharma - & - Co today')).toBe('strict');
    // Any punctuation between the words, or none, is the find's own rule since fix wave 2 (ruling 4: one rule; RX-PAT's
    // findTerm follows loosePlacesOf), so strict too.
    expect(typed('paid to Sharma&Co. today')).toBe('strict');
    expect(typed('paid to Sharma & Company')).toBeNull();
  });

  it('IP addresses in a file: an unrelated number is not a hit, the address is', async () => {
    const target: CheckTarget = { kind: 'ip', forms: ['10.0.0.1', '10001'], wholeWord: false };
    const other = await pdfWith({ 1: 'BT /F1 12 Tf 50 700 Td (Ref 10001, host 110.0.0.12 and 10.0.0.15) Tj ET' });
    expect(await findTargets(other, [target], NONE)).toEqual({ pages: [], elsewhere: [] });
    const same = await pdfWith({ 1: 'BT /F1 12 Tf 50 700 Td (Gateway 10.0.0.1 down) Tj ET' });
    expect(await findTargets(same, [target], NONE)).toEqual({ pages: [1], elsewhere: [] });
  });
});

describe('checkHits: each hit located so a rebuild round can act on it, holding no text of the file', () => {
  it('names the pass, the pages or place, the part, the object and the key', async () => {
    const file = await pdfWith({ 1: `BT /F1 12 Tf 50 700 Td (PAN ${SECRET}) Tj ET` }, {
      edit: ({ doc, pages }) => {
        const outlines = doc.context.nextRef();
        const item = doc.context.register(doc.context.obj({ Title: PDFString.of('Ref BNZPM / / 2501F'), Parent: outlines, Dest: [pages[0], 'Fit'] }));
        doc.context.assign(outlines, doc.context.obj({ Type: 'Outlines', First: item, Last: item, Count: 1 }));
        doc.catalog.set(PDFName.of('Outlines'), outlines);
        const comment = doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Text', Rect: [10, 10, 30, 30], Contents: PDFString.of(`see ${SECRET}`) }));
        doc.context.lookup(pages[2], PDFDict).set(PDFName.of('Annots'), doc.context.obj([comment]));
      },
    });
    const hits = await checkHits(file, [PAN], NONE);
    expect(hits.map(({ pass, pages, elsewhere, part, key }) => ({ pass, pages, elsewhere, part, key }))).toEqual([
      { pass: 'strict', pages: [1], elsewhere: [], part: 'content', key: 'stream' },
      { pass: 'strict', pages: [2], elsewhere: [], part: 'annotation', key: 'Contents' },
      { pass: 'loose', pages: [], elsewhere: ['bookmarks'], part: 'bookmark', key: 'Title' },
    ]);
    for (const hit of hits) expect(hit.object).toMatch(/^\d+ \d+ R$/);
    // Positions where the file gives them: the comment's own rectangle; none for page content or a bookmark.
    expect(hits.map((hit) => hit.boxes)).toEqual([undefined, [{ page: 2, rect: { x0: 10, y0: 10, x1: 30, y1: 30 } }], undefined]);
    const said = JSON.stringify(hits);
    for (const form of [SECRET, 'BNZPM / / 2501F', 'BNZPM', '2501F']) expect(said).not.toContain(form);
  });

  it("on a rebuilt page's text layer, gives the boxes of the words that hold the value, alone or read together", async () => {
    const source = await pdfWith({});
    const word = (text: string, x: number, width: number) => ({ text, transform: [10, 0, 0, 10, x, 600] as const, width });
    const words = [word('PAN', 50, 20), word('BNZPM.', 80, 40), word('2501F', 130, 30), word('kept', 200, 20), word(SECRET, 250, 60)];
    const { bytes } = await buildRedacted(source, [{ pageIndex: 1, picture: greyPicture(), words, ...AWAY }], { titleHasValue: () => false });
    const hits = await checkHits(bytes, [PAN], new Set([1]));
    expect(hits).toHaveLength(1);
    const [hit] = hits;
    expect({ pass: hit.pass, pages: hit.pages, part: hit.part }).toEqual({ pass: 'strict', pages: [1], part: 'text layer' });
    const boxes = hit.boxes!.map(({ page, rect: r }) => [page, ...[r.x0, r.y0, r.x1, r.y1].map((v) => Math.round(v * 100) / 100)]);
    expect(boxes).toEqual([
      [1, 80, 597.5, 120, 609],
      [1, 130, 597.5, 160, 609],
      [1, 250, 597.5, 310, 609],
    ]);
    expect(JSON.stringify(hits)).not.toContain('BNZPM');
    // Read together only: strict when the find joins them, loose when only the second net does; located to its two words either way.
    const together = await buildRedacted(source, [{ pageIndex: 1, picture: greyPicture(), words: words.slice(0, 4), ...AWAY }], { titleHasValue: () => false });
    const [strict] = await checkHits(together.bytes, [PAN], new Set([1]));
    expect(strict.pass).toBe('strict');
    expect(strict.boxes!.map((b) => Math.round(b.rect.x0))).toEqual([80, 130]);
    const apart = [word('PAN', 50, 20), word('BNZPM./', 80, 40), word('/2501F', 130, 30), word('kept', 200, 20)];
    const split = await buildRedacted(source, [{ pageIndex: 1, picture: greyPicture(), words: apart, ...AWAY }], { titleHasValue: () => false });
    const [loose] = await checkHits(split.bytes, [PAN], new Set([1]));
    // the layer's strings read joined (fix wave 2, R1) make it strict; the two words are its boxes either way
    expect(loose.pass).toBe('strict');
    expect(loose.boxes!.map((b) => Math.round(b.rect.x0))).toEqual([80, 130]);
  });
});

describe('findTargets: the value is found in every written form, and located', () => {
  // The last column says whether testLeakPdf's raw-bytes search (inflate, hex strings decoded) sees it.
  const cases: [string, string, boolean][] = [
    ['a literal string with octal escapes', `BT /F1 12 Tf 50 700 Td ${octal(ascii(SECRET))} Tj ET`, false],
    ['a TJ array of two pieces', `BT /F1 12 Tf 50 700 Td [(BNZ) -20 (PM2501F)] TJ ET`, false],
    ['a UTF-16 /ActualText with its mark', `/Span <</ActualText ${octal(utf16be(SECRET))}>> BDC BT /F1 12 Tf 50 700 Td (Page two) Tj ET EMC`, false],
    ['a hex string', `BT /F1 12 Tf 50 700 Td ${hex(ascii(SECRET))} Tj ET`, true],
    ['UTF-16 without a mark', `BT /F1 12 Tf 50 700 Td ${hex(utf16be(SECRET, false))} Tj ET`, true],
    ['a comment', `% ${SECRET}\n${plainPage(2)}`, true],
    ['a name written with escapes', `/Span <</MCID 0>> BDC /BNZ#50#4d2501F gs ${plainPage(2)} EMC`, false],
  ];
  for (const [label, content, rawSees] of cases) {
    it(`${label} in page 2's content is located to page 2 only`, async () => {
      const file = await pdfWith({ 1: content });
      expect(rawHaystack(file).includes(SECRET), 'self-check of the raw-bytes search').toBe(rawSees);
      expect(await findTargets(file, [PAN], NONE)).toEqual({ pages: [1], elsewhere: [] });
    });
  }

  it('a Hindi typed term written as UTF-16 in content, and as UTF-8 in XMP, is found', async () => {
    const term = 'करदाता';
    const typed: CheckTarget = { kind: 'typed', forms: [term], wholeWord: true };
    const asUtf16 = hex(utf16be(term, false));
    const inContent = await pdfWith({ 1: `/Span <</ActualText ${asUtf16}>> BDC BT /F1 12 Tf 50 700 Td (Page two) Tj ET EMC` });
    expect(await findTargets(inContent, [typed], NONE)).toEqual({ pages: [1], elsewhere: [] });
    const inXmp = await pdfWith({}, {
      edit: ({ doc }) => {
        const xmp = Buffer.from(`<x:xmpmeta><rdf:Description dc:creator="${term} and co"/></x:xmpmeta>`, 'utf8');
        doc.catalog.set(PDFName.of('Metadata'), doc.context.register(doc.context.stream(zlib.deflateSync(xmp), { Type: 'Metadata', Subtype: 'XML', Filter: 'FlateDecode' } as never)));
      },
    });
    expect(await findTargets(inXmp, [typed], NONE)).toEqual({ pages: [], elsewhere: ['document properties'] });
    expect(await findTargets(inXmp, [{ ...typed, forms: ['करदाताओं'] }], NONE)).toEqual({ pages: [], elsewhere: [] });
  });

  it('an object inside an object stream (page /PieceInfo) is located to its page', async () => {
    const file = await pdfWith({}, {
      objectStreams: true,
      edit: ({ doc, pages }) => {
        doc.context.lookup(pages[2], PDFDict).set(PDFName.of('PieceInfo'), doc.context.obj({ App: { Private: PDFString.of(SECRET) } }));
      },
    });
    expect(Buffer.from(file).includes(SECRET), 'self-check: compressed').toBe(false);
    expect(await findTargets(file, [PAN], NONE)).toEqual({ pages: [2], elsewhere: [] });
  });

  it('a bookmark title in UTF-16 is located to the bookmarks', async () => {
    const file = await pdfWith({}, {
      objectStreams: true,
      edit: ({ doc, pages }) => {
        const outlines = doc.context.nextRef();
        const item = doc.context.register(doc.context.obj({ Title: PDFHexString.fromText(`Notes ${SECRET} करदाता`), Parent: outlines, Dest: [pages[1], 'Fit'] }));
        doc.context.assign(outlines, doc.context.obj({ Type: 'Outlines', First: item, Last: item, Count: 1 }));
        doc.catalog.set(PDFName.of('Outlines'), outlines);
      },
    });
    expect(await findTargets(file, [PAN], NONE)).toEqual({ pages: [], elsewhere: ['bookmarks'] });
  });

  it('an XMP stream and the /Info title are located to the document properties', async () => {
    for (const where of ['xmp', 'info'] as const) {
      const file = await pdfWith({}, {
        edit: ({ doc }) => {
          if (where === 'info') doc.setTitle(`Return of ${SECRET}`);
          else {
            const xmp = `<?xpacket begin=""?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF><rdf:Description dc:title="${SECRET}"/></rdf:RDF></x:xmpmeta>`;
            doc.catalog.set(PDFName.of('Metadata'), doc.context.register(doc.context.flateStream(xmp, { Type: 'Metadata', Subtype: 'XML' })));
          }
        },
      });
      expect(await findTargets(file, [PAN], NONE), where).toEqual({ pages: [], elsewhere: ['document properties'] });
    }
  });

  it('a form field default value and options are located to the page of its widget', async () => {
    const file = await pdfWith({}, {
      edit: ({ doc, pages }) => {
        const field = doc.context.nextRef();
        const widget = doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Widget', Rect: [50, 600, 250, 620], Parent: field, P: pages[1] }));
        doc.context.assign(field, doc.context.obj({ FT: 'Ch', T: PDFString.of('choice'), V: PDFString.of('one'), DV: PDFString.of(SECRET), Opt: [PDFString.of('one'), PDFString.of('two')], Kids: [widget] }));
        doc.context.lookup(pages[1], PDFDict).set(PDFName.of('Annots'), doc.context.obj([widget]));
        doc.catalog.set(PDFName.of('AcroForm'), doc.context.obj({ Fields: [field] }));
      },
    });
    expect(await findTargets(file, [PAN], NONE)).toEqual({ pages: [1], elsewhere: [] });
    const [hit] = await checkHits(file, [PAN], NONE);
    expect({ part: hit.part, key: hit.key, boxes: hit.boxes }).toEqual({ part: 'field', key: 'DV', boxes: [{ page: 1, rect: { x0: 50, y0: 600, x1: 250, y1: 620 } }] });
  });

  it('a shared font holding the value is located to every page that uses it', async () => {
    const file = await pdfWith({}, {
      edit: ({ doc, pages }) => {
        const cmap = doc.context.register(doc.context.flateStream(`/CIDInit /ProcSet findresource begin\n% ${SECRET}\nend`));
        const font = doc.context.register(doc.context.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica', ToUnicode: cmap }));
        for (const page of [pages[0], pages[2]]) doc.context.lookup(page, PDFDict).set(PDFName.of('Resources'), doc.context.obj({ Font: { F1: font } }));
      },
    });
    expect(await findTargets(file, [PAN], NONE)).toEqual({ pages: [0, 2], elsewhere: [] });
  });

  it('a stream written with a PNG predictor, and one with ASCIIHex then Flate, are decoded', async () => {
    const text = `BT /F1 12 Tf 50 700 Td (${SECRET}) Tj ET`;
    const columns = 8;
    const raw = Buffer.from(text.padEnd(Math.ceil(text.length / columns) * columns, ' '), 'latin1');
    const rows: number[] = [];
    for (let r = 0; r < raw.length / columns; r++) {
      rows.push(1); // Sub: each byte minus the one before it
      for (let c = 0; c < columns; c++) rows.push((raw[r * columns + c] - (c > 0 ? raw[r * columns + c - 1] : 0)) & 0xff);
    }
    const predicted = zlib.deflateSync(Buffer.from(rows));
    const hexThenFlate = Buffer.from(`${zlib.deflateSync(Buffer.from(text, 'latin1')).toString('hex')}>`, 'latin1');
    for (const [label, bytes, dict] of [
      ['PNG predictor', predicted, { Filter: 'FlateDecode', DecodeParms: { Predictor: 12, Columns: columns } }],
      ['ASCIIHex then Flate', hexThenFlate, { Filter: ['ASCIIHexDecode', 'FlateDecode'] }],
    ] as const) {
      const file = await pdfWith({}, {
        edit: ({ doc, pages }) => {
          doc.context.lookup(pages[1], PDFDict).set(PDFName.of('Contents'), doc.context.register(doc.context.stream(bytes, dict as never)));
        },
      });
      expect(rawHaystack(file).includes(SECRET), `self-check ${label}`).toBe(false);
      expect(await findTargets(file, [PAN], NONE), label).toEqual({ pages: [1], elsewhere: [] });
    }
  });

  it('text in a JPEG comment of an image on a copied page is found (the image bytes are searched)', async () => {
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xfe, 0x00, 2 + SECRET.length]), Buffer.from(SECRET, 'latin1'), Buffer.from([0xff, 0xd9])]);
    const file = await pdfWith({ 2: `q 10 0 0 10 50 50 cm /Im0 Do Q` }, {
      edit: ({ doc, pages }) => {
        const image = doc.context.register(doc.context.stream(jpeg, { Type: 'XObject', Subtype: 'Image', Width: 1, Height: 1, ColorSpace: 'DeviceGray', BitsPerComponent: 8, Filter: 'DCTDecode' } as never));
        doc.context.lookup(pages[2], PDFDict).set(PDFName.of('Resources'), doc.context.obj({ XObject: { Im0: image } }));
      },
    });
    expect(await findTargets(file, [PAN], NONE)).toEqual({ pages: [2], elsewhere: [] });
  });

  it('an earlier saved revision and an object nothing refers to are found as "other"', async () => {
    const base = await pdfWith({ 1: `BT /F1 12 Tf 50 700 Td (Old ${SECRET}) Tj ET` });
    // An incremental update replaces page 2's content; the old revision stays in the bytes.
    const loaded = await PDFDocument.load(base);
    const contents = loaded.getPages()[1].node.get(PDFName.of('Contents')) as PDFRef;
    const text = 'BT /F1 12 Tf 50 700 Td (Page 2 new text) Tj ET';
    const latin = Buffer.from(base).toString('latin1');
    const prev = Number(/startxref\s+(\d+)/.exec(latin.slice(latin.lastIndexOf('startxref')))![1]);
    const body = `\n${contents.objectNumber} 0 obj\n<< /Length ${text.length} >>\nstream\n${text}\nendstream\nendobj\n`;
    const xrefAt = base.length + body.length;
    const root = loaded.context.trailerInfo.Root as PDFRef;
    const xref = `xref\n${contents.objectNumber} 1\n${String(base.length + 1).padStart(10, '0')} 00000 n \ntrailer\n<< /Size ${loaded.context.largestObjectNumber + 1} /Root ${root.objectNumber} 0 R /Prev ${prev} >>\nstartxref\n${xrefAt}\n%%EOF\n`;
    const updated = new Uint8Array(Buffer.concat([Buffer.from(base), Buffer.from(body + xref, 'latin1')]));
    expect(await findTargets(updated, [PAN], NONE)).toEqual({ pages: [], elsewhere: ['other'] });

    const orphan = await pdfWith({}, { edit: ({ doc }) => void doc.context.register(doc.context.obj({ Note: PDFString.of(SECRET) })) });
    expect(await findTargets(orphan, [PAN], NONE)).toEqual({ pages: [], elsewhere: ['other'] });
  });

  it("a value written into a rebuilt page's own text layer is found on that page", async () => {
    const source = await pdfWith({});
    const words = [{ text: SECRET, transform: [12, 0, 0, 12, 50, 700] as const, width: 70 }];
    const { bytes } = await buildRedacted(source, [{ pageIndex: 1, picture: greyPicture(), words, ...AWAY }], { titleHasValue: () => false });
    expect(await findTargets(bytes, [PAN], new Set([1]))).toEqual({ pages: [1], elsewhere: [] });
  });

  it('the trial 4b sequence: after the rebuild only page 4 (a UTF-16 /ActualText) holds the value', async () => {
    const source = await pdfWith(
      {
        0: `BT /F1 12 Tf 50 700 Td (PAN ${SECRET} of the assessee) Tj ET`,
        2: 'BT /F1 12 Tf 50 750 Td (Page 3 clean text) Tj ET',
        3: `/Span <</ActualText ${octal(utf16be(SECRET))}>> BDC BT /F1 12 Tf 50 720 Td (Page four) Tj ET EMC`,
        4: 'BT /F1 12 Tf 50 720 Td [(Page fi) -20 (ve, nothing secret)] TJ ET',
      },
      {
        count: 5,
        edit: ({ doc, pages }) => {
          const comment = doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Text', Rect: [400, 740, 420, 760], Contents: PDFString.of(`See ${SECRET}`), P: pages[1] }));
          doc.context.lookup(pages[1], PDFDict).set(PDFName.of('Annots'), doc.context.obj([comment]));
        },
      },
    );
    const rebuilt: RebuiltPage[] = [0, 1].map((pageIndex) => ({ pageIndex, picture: greyPicture(), words: [], ...AWAY }));
    const { bytes } = await buildRedacted(source, rebuilt, { titleHasValue: (t) => t.includes(SECRET) });
    expect(await findTargets(bytes, [PAN], new Set([0, 1]))).toEqual({ pages: [3], elsewhere: [] });
  });
});

describe('findTargets: what is not the value is not found', () => {
  it('(fix wave 2, R1: overturned) the same ten characters split across two strings ARE found: the page shows them together', async () => {
    const file = await pdfWith({ 1: 'BT /F1 12 Tf 50 700 Td (BNZPM) Tj 40 0 Td (2501F) Tj ET' });
    expect(await findTargets(file, [PAN], NONE)).toEqual({ pages: [1], elsewhere: [] });
    // but strings with other letters between them still are not
    const apart = await pdfWith({ 1: 'BT /F1 12 Tf 50 700 Td (BNZPM) Tj 40 0 Td (ledger) Tj 40 0 Td (2501F) Tj ET' });
    expect(await findTargets(apart, [PAN], NONE)).toEqual({ pages: [], elsewhere: [] });
  });

  it('random bytes of a 1 MB picture of a rebuilt page that happen to contain it', async () => {
    const pixels = noise(1024 * 1024);
    pixels.set(Buffer.from(SECRET, 'latin1'), 500_000);
    const file = await pdfWith({ 0: 'q 595 0 0 842 0 0 cm /Im0 Do Q' }, {
      edit: ({ doc, pages }) => {
        const image = doc.context.register(doc.context.stream(pixels, { Type: 'XObject', Subtype: 'Image', Width: 1024, Height: 1024, ColorSpace: 'DeviceGray', BitsPerComponent: 8 } as never));
        doc.context.lookup(pages[0], PDFDict).set(PDFName.of('Resources'), doc.context.obj({ XObject: { Im0: image } }));
      },
    });
    expect(Buffer.from(file).includes(SECRET), 'self-check: in the raw bytes').toBe(true);
    expect(await findTargets(file, [PAN], new Set([0]))).toEqual({ pages: [], elsewhere: [] });
    // Only a rebuilt page's own picture is skipped: the same image on a copied page is searched.
    expect(await findTargets(file, [PAN], NONE)).toEqual({ pages: [0], elsewhere: [] });
  });

  it('a typed term inside a longer word', async () => {
    const file = await pdfWith({ 1: 'BT /F1 12 Tf 50 700 Td (Pharmacy bill paid) Tj ET' });
    const harm: CheckTarget = { kind: 'typed', forms: ['harm'], wholeWord: true };
    expect(await findTargets(file, [harm], NONE)).toEqual({ pages: [], elsewhere: [] });
    const said = await pdfWith({ 1: 'BT /F1 12 Tf 50 700 Td (It did no harm.) Tj ET' });
    expect(await findTargets(said, [harm], NONE)).toEqual({ pages: [1], elsewhere: [] });
  });

  it('no targets, or targets with no usable form, find nothing', async () => {
    const file = await pdfWith({ 1: `BT /F1 12 Tf 50 700 Td (${SECRET}) Tj ET` });
    expect(await findTargets(file, [], NONE)).toEqual({ pages: [], elsewhere: [] });
    expect(await findTargets(file, [{ kind: 'typed', forms: ['  ', '--'], wholeWord: true }], NONE)).toEqual({ pages: [], elsewhere: [] });
  });
});

describe('stringsHaystack', () => {
  it('holds strings decoded from escapes, hex and UTF-16, joined TJ pieces and object-stream contents', async () => {
    const file = await pdfWith(
      {
        0: `BT /F1 12 Tf 50 700 Td ${octal(ascii('OCTAL-ONE'))} Tj [(TJ-) 10 (JOINED)] TJ ${hex(utf16be('UTF16-TWO'))} Tj ET`,
      },
      {
        objectStreams: true,
        edit: ({ doc, pages }) => {
          doc.context.lookup(pages[1], PDFDict).set(PDFName.of('PieceInfo'), doc.context.obj({ App: { Private: PDFHexString.fromText('OBJSTM-THREE') } }));
        },
      },
    );
    const hay = await stringsHaystack(file);
    for (const text of ['OCTAL-ONE', 'TJ-JOINED', 'UTF16-TWO', 'OBJSTM-THREE']) expect(hay, text).toContain(text);
  });
});

describe('structureProblems', () => {
  async function rebuiltFile(): Promise<Uint8Array> {
    const source = await pdfWith({ 0: `BT /F1 12 Tf 50 700 Td (PAN ${SECRET} kept words) Tj ET` });
    const pages: RebuiltPage[] = [0, 2].map((pageIndex) => ({
      pageIndex,
      picture: greyPicture(),
      words: [{ text: 'kept', transform: [12, 0, 0, 12, 50, 700], width: 24 }],
      ...AWAY,
    }));
    return (await buildRedacted(source, pages, { titleHasValue: () => false })).bytes;
  }

  it('finds nothing wrong with the rebuilt pages of a redacted file', async () => {
    expect(await structureProblems(await rebuiltFile(), [0, 2])).toEqual([]);
  });

  it('names a rebuilt page that has comments, extra resources, visible text or another drawing', async () => {
    const bytes = await rebuiltFile();
    const edits: [string, (doc: PDFDocument, page: PDFDict) => void, RegExp][] = [
      [
        'an extra /Annots',
        (doc, page) => page.set(PDFName.of('Annots'), doc.context.obj([doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Text', Rect: [0, 0, 10, 10] }))])),
        /^Page 3 .*\/Annots/,
      ],
      ['an extra resource', (doc, page) => page.lookup(PDFName.of('Resources'), PDFDict).set(PDFName.of('ExtGState'), doc.context.obj({})), /^Page 3 /],
      ['visible text', (doc, page) => page.set(PDFName.of('Contents'), doc.context.register(doc.context.flateStream('BT 0 Tr /Fh 1 Tf 1 0 0 1 9 9 Tm <41> Tj ET'))), /^Page 3 /],
      [
        'another image',
        (doc, page) => {
          const xobjects = page.lookup(PDFName.of('Resources'), PDFDict).lookup(PDFName.of('XObject'), PDFDict);
          xobjects.set(PDFName.of('Im1'), xobjects.get(PDFName.of('Im0')) as PDFObject);
        },
        /^Page 3 /,
      ],
    ];
    for (const [label, edit, expected] of edits) {
      const doc = await PDFDocument.load(bytes);
      edit(doc, doc.getPages()[2].node);
      const problems = await structureProblems(await doc.save(), [0, 2]);
      expect(problems.length, label).toBeGreaterThan(0);
      expect(problems.every((p) => expected.test(p)), `${label}: ${problems.join(' | ')}`).toBe(true);
      expect(problems.join(' '), label).not.toContain(SECRET);
    }
  });

  it('names a rebuilt page that is not in the file', async () => {
    expect(await structureProblems(await rebuiltFile(), [0, 7])).toEqual([expect.stringMatching(/^Page 8 /)]);
  });

  it('does not echo names written in the file', async () => {
    const doc = await PDFDocument.load(await rebuiltFile());
    doc.getPages()[0].node.set(PDFName.of(SECRET), PDFArray.withContext(doc.context));
    const problems = await structureProblems(await doc.save(), [0, 2]);
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.join(' ')).not.toContain(SECRET);
  });

  it('names what a redacted file must not hold anywhere: attached files, scripts, XMP (fix round 1)', async () => {
    const plants: [string, (doc: PDFDocument) => void, RegExp][] = [
      [
        'a page /AF',
        (doc) => {
          const file = doc.context.register(doc.context.flateStream('x', { Type: 'EmbeddedFile' } as never));
          doc.getPages()[1].node.set(PDFName.of('AF'), doc.context.obj([{ Type: 'Filespec', F: PDFString.of('a.txt'), EF: { F: file } }]));
        },
        /^The file holds attached files/,
      ],
      [
        'a JavaScript link',
        (doc) => {
          const link = doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [0, 0, 9, 9], A: { S: 'JavaScript', JS: PDFString.of('x') } }));
          doc.getPages()[1].node.set(PDFName.of('Annots'), doc.context.obj([link]));
        },
        /^The file holds scripts/,
      ],
      ['catalog XMP', (doc) => doc.catalog.set(PDFName.of('Metadata'), doc.context.register(doc.context.flateStream('<x/>', { Type: 'Metadata' } as never))), /^The file holds metadata/],
    ];
    for (const [label, plant, expected] of plants) {
      const doc = await PDFDocument.load(await rebuiltFile());
      plant(doc);
      const problems = await structureProblems(await doc.save(), [0, 2]);
      expect(problems, label).toEqual([expect.stringMatching(expected)]);
    }
  });
});

// ---- fix round 1: what the review (R2-review.md) got past the first check -------------------------------

const V = { pan: 'AQZPK7314L', email: 'devi.rao@example.in', ip: '172.16.9.44' };
const AQ: CheckTarget = { kind: 'pan', forms: [V.pan], wholeWord: false };
const EMAIL: CheckTarget = { kind: 'email', forms: [V.email], wholeWord: false };
const IP: CheckTarget = { kind: 'ip', forms: [V.ip], wholeWord: false };
const fullWidth = (text: string) => Array.from(text, (c) => (c >= '!' && c <= '~' ? String.fromCharCode(c.charCodeAt(0) + 0xfee0) : c)).join('');
const utf8Latin1 = (text: string) => Buffer.from(text, 'utf8').toString('latin1');

/** One annotation on page 2 (index 1) of `pdfWith`'s file. */
const withAnnotation = (dict: Record<string, unknown>) => ({
  edit: ({ doc, pages }: Built) => {
    const annotation = doc.context.register(doc.context.obj({ Type: 'Annot', P: pages[1], ...dict } as never));
    doc.context.lookup(pages[1], PDFDict).set(PDFName.of('Annots'), doc.context.obj([annotation]));
  },
});

describe('fix round 1: the surviving recipes are found (R2-review B1, B3 and the same class)', () => {
  it('B1: an email written with %40 in a web address, also encoded twice, and a base64 data address', async () => {
    const file = await pdfWith({}, withAnnotation({ Subtype: 'Link', Rect: [72, 400, 200, 420], A: { S: 'URI', URI: PDFString.of(`https://portal.example.in/u?e=${V.email.replace('@', '%40')}`) } }));
    const hits = await checkHits(file, [EMAIL], NONE);
    expect(hits.map(({ pages, part, remedy, boxes }) => ({ pages, part, remedy, boxes }))).toEqual([
      { pages: [1], part: 'annotation', remedy: 'boxes', boxes: [{ page: 1, rect: { x0: 72, y0: 400, x1: 200, y1: 420 } }] },
    ]);
    expect(targetPass([EMAIL])('u?e=devi.rao%2540example.in')).toBe('strict');
    expect(targetPass([AQ])(`data:text/plain;base64,${Buffer.from(`PAN ${V.pan}`).toString('base64')}`)).toBe('strict');
  });

  it('B3: an IP address followed by a full stop, or after a leading dot, in content, a comment and a title', async () => {
    const ip = targetPass([IP]);
    expect(ip(`The server is ${V.ip}.`)).toBe('strict');
    expect(ip(`IP.${V.ip} primary`)).toBe('strict');
    expect(ip(`Server ${V.ip}.`)).toBe('strict');
    expect(ip(`${V.ip}.5 and 1${V.ip} and ${V.ip}5`)).toBeNull();
    const inContent = await pdfWith({ 1: `BT /F1 12 Tf 50 700 Td (The server is ${V.ip}.) Tj ET` });
    expect(await findTargets(inContent, [IP], NONE)).toEqual({ pages: [1], elsewhere: [] });
    const inComment = await pdfWith({}, withAnnotation({ Subtype: 'Text', Rect: [10, 10, 30, 30], Contents: PDFString.of(`Server ${V.ip}.`) }));
    expect(await findTargets(inComment, [IP], NONE)).toEqual({ pages: [1], elsewhere: [] });
  });

  it('same class: a typed code split by a kerning space; a format character outside any list', () => {
    expect(targetPass([{ kind: 'typed', forms: ['gx45tr', 'GX45TR'], wholeWord: true }])('Ref GX4 5TR')).toBe('strict');
    expect(targetPass([EMAIL])(`Mail devi.rao@exam${String.fromCharCode(0xfff9)}ple.in`)).toBe('strict');
    expect(targetPass([AQ])(`AQZPK${String.fromCharCode(0x2063)}7314L`)).toBe('strict');
  });

  it('same class: a letter of a code carrying a combining mark (the find folds character by character)', () => {
    const acute = String.fromCharCode(0x301);
    expect(targetPass([AQ])(`PAN AQZPK${acute} 7314L`)).toBe('strict');
    expect(targetPass([AQ])(`PAN AQZP${acute}K7314L`)).toBe('strict');
    // A name typed with a composed letter, written in the file decomposed: the find's fold keeps the two apart, the second net joins them.
    expect(targetPass([{ kind: 'typed', forms: [`Jos${String.fromCharCode(0xe9)} Kurian`], wholeWord: true }])(`Mr Jose${acute} Kurian`)).toBe('loose');
  });

  it('same class: a value split across two /ActualText spans; a full-width value in UTF-8 in a content comment', async () => {
    const split = await pdfWith({ 1: '/Span <</ActualText (AQZPK)>> BDC BT /F1 10 Tf 72 600 Td (XX) Tj ET EMC /Span <</ActualText (7314L)>> BDC BT /F1 10 Tf 90 600 Td (XX) Tj ET EMC' });
    expect(await findTargets(split, [AQ], NONE)).toEqual({ pages: [1], elsewhere: [] });
    const comment = await pdfWith({ 1: `% ${utf8Latin1(fullWidth(V.pan))}\n${plainPage(2)}` });
    expect(await findTargets(comment, [AQ], NONE)).toEqual({ pages: [1], elsewhere: [] });
  });

  it('medium 4: a hex string written with white space is read as a reader reads it, and located to its comment', async () => {
    const file = await pdfWith({}, withAnnotation({ Subtype: 'Text', Rect: [10, 10, 30, 30], NM: PDFHexString.of('41 51 5A 50 4B 37 33 31 34 4C'), Contents: PDFString.of('note') }));
    const hits = await checkHits(file, [AQ], NONE);
    expect(hits.map(({ pages, part, key }) => ({ pages, part, key }))).toEqual([{ pages: [1], part: 'annotation', key: 'NM' }]);
  });

  it('medium 6, ruled again in fix wave 2 (ruling 4): a typed phrase is found across any punctuation between its words', () => {
    const phrase = targetPass([{ kind: 'typed', forms: ['kestrel orchard', 'Kestrel Orchard'], wholeWord: true }]);
    // fix wave 2, ruling 4: any run of punctuation between the words is the phrase, by the find's own rule (this
    // replaces medium 6's null), so the check's strict pass holds it.
    expect(phrase('Kestrel; Orchard; and Kestrel-Orchards')).toBe('strict');
    expect(phrase('Kestrel Orchards and the Orchard of Kestrel')).toBeNull();
    // A comma, a hyphen or a line break between the words is of course the same rule.
    expect(phrase('Kestrel, Orchard')).toBe('strict');
    expect(phrase('Kestrel - Orchard')).toBe('strict');
    expect(phrase('Kestrel\nOrchard')).toBe('strict');
  });
});

describe('fix round 1: a drawn hit needs boxes; flatten only for what is not drawn (ruling E)', () => {
  it("an annotation's appearance that draws the value: drawn, boxed by the annotation's rectangle", async () => {
    const file = await pdfWith({}, {
      edit: (built) => {
        const font = built.doc.context.register(built.doc.context.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica' }));
        const ap = built.doc.context.register(built.doc.context.flateStream(`BT /Helv 14 Tf 4 8 Td (${V.pan}) Tj ET`, { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 200, 30], Resources: { Font: { Helv: font } } } as never));
        withAnnotation({ Subtype: 'Square', Rect: [100, 450, 300, 480], AP: { N: ap } }).edit(built);
      },
    });
    const hits = await checkHits(file, [AQ], NONE);
    expect(hits.map(({ pages, part, drawn, remedy, boxes }) => ({ pages, part, drawn, remedy, boxes }))).toEqual([
      { pages: [1], part: 'annotation', drawn: true, remedy: 'boxes', boxes: [{ page: 1, rect: { x0: 100, y0: 450, x1: 300, y1: 480 } }] },
    ]);
    expect(unboxedPages(hits)).toEqual([]);
  });

  it('page text that draws the value: drawn, no boxes in the file: the find must place them', async () => {
    const hits = await checkHits(await pdfWith({ 1: `BT /F1 12 Tf 50 700 Td (PAN ${V.pan}) Tj ET` }), [AQ], NONE);
    expect(hits.map(({ part, drawn, remedy, boxes }) => ({ part, drawn, remedy, boxes }))).toEqual([{ part: 'content', drawn: true, remedy: 'find', boxes: undefined }]);
    expect(unboxedPages(hits)).toEqual([{ page: 1, drawn: true }]);
  });

  it('an /ActualText only: not drawn, the page may be flattened', async () => {
    const hits = await checkHits(await pdfWith({ 1: `/Span <</ActualText (${V.pan})>> BDC BT /F1 10 Tf 72 600 Td (XXXX) Tj ET EMC` }), [AQ], NONE);
    expect(hits.map(({ part, drawn, remedy }) => ({ part, drawn, remedy }))).toEqual([{ part: 'content', drawn: false, remedy: 'flatten' }]);
    expect(unboxedPages(hits)).toEqual([{ page: 1, drawn: false }]);
  });

  it("a FreeText's text and a field's value are drawn; a comment's note is not; all are boxed by their rectangles", async () => {
    const rect = { x0: 10, y0: 10, x1: 60, y1: 30 };
    const drawnOf = async (dict: Record<string, unknown>) => {
      const hits = await checkHits(await pdfWith({}, withAnnotation({ Rect: [10, 10, 60, 30], ...dict })), [AQ], NONE);
      return hits.map(({ part, drawn, remedy, boxes }) => ({ part, drawn, remedy, boxes }));
    };
    expect(await drawnOf({ Subtype: 'FreeText', Contents: PDFString.of(V.pan), DA: PDFString.of('/Helv 10 Tf 0 g') })).toEqual([{ part: 'annotation', drawn: true, remedy: 'boxes', boxes: [{ page: 1, rect }] }]);
    expect(await drawnOf({ Subtype: 'Widget', FT: 'Tx', T: PDFString.of('pan'), V: PDFString.of(V.pan) })).toEqual([{ part: 'field', drawn: true, remedy: 'boxes', boxes: [{ page: 1, rect }] }]);
    expect(await drawnOf({ Subtype: 'Text', Contents: PDFString.of(V.pan) })).toEqual([{ part: 'annotation', drawn: false, remedy: 'boxes', boxes: [{ page: 1, rect }] }]);
  });

  it("a value in a font's ToUnicode map counts as drawn (the glyphs may show it)", async () => {
    const file = await pdfWith({}, {
      edit: ({ doc, pages }) => {
        const cmap = doc.context.register(doc.context.flateStream(`/CIDInit /ProcSet findresource begin\n% ${V.pan}\nend`));
        const font = doc.context.register(doc.context.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica', ToUnicode: cmap }));
        doc.context.lookup(pages[1], PDFDict).set(PDFName.of('Resources'), doc.context.obj({ Font: { F1: font } }));
      },
    });
    const [hit] = await checkHits(file, [AQ], NONE);
    expect({ pages: hit.pages, drawn: hit.drawn, remedy: hit.remedy }).toEqual({ pages: [1], drawn: true, remedy: 'find' });
  });

  it("a form-level holder (/DR) and a document place cannot be flattened: refused, and say why", async () => {
    const file = await pdfWith({}, {
      edit: ({ doc }) => {
        const font = doc.context.register(doc.context.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: PDFName.of(V.pan) }));
        doc.catalog.set(PDFName.of('AcroForm'), doc.context.obj({ Fields: [], DR: { Font: { F9: font } } }));
        doc.setSubject(`About ${V.pan}`);
      },
    });
    const hits = await checkHits(file, [AQ], NONE);
    const said = hits.map(({ elsewhere, remedy, refusal }) => ({ elsewhere, remedy, refusal }));
    expect(said).toHaveLength(2);
    expect(said).toEqual(
      expect.arrayContaining([
        { elsewhere: ['form'], remedy: 'none', refusal: 'form' },
        { elsewhere: ['document properties'], remedy: 'none', refusal: 'document' },
      ]),
    );
    expect(unboxedPages(hits)).toEqual([]);
  });

  it("only the build's own picture is skipped: a page's own /Im0 that is not one is still searched", async () => {
    const file = await pdfWith({ 0: 'q 10 0 0 10 50 50 cm /Im0 Do Q' }, {
      edit: ({ doc, pages }) => {
        const pixels = Buffer.from(`xx${V.pan}xx`, 'latin1');
        const image = doc.context.register(doc.context.stream(pixels, { Type: 'XObject', Subtype: 'Image', Width: 14, Height: 1, ColorSpace: 'DeviceGray', BitsPerComponent: 8, Interpolate: true } as never));
        doc.context.lookup(pages[0], PDFDict).set(PDFName.of('Resources'), doc.context.obj({ XObject: { Im0: image } }));
      },
    });
    expect(await findTargets(file, [AQ], new Set([0]))).toEqual({ pages: [0], elsewhere: [] });
  });
});

describe('fix round 1: the check can be stopped and reports progress (low 8)', () => {
  it('stops between objects with an AbortError, and counts objects as it reads them', async () => {
    const file = await pdfWith({ 1: `BT /F1 12 Tf 50 700 Td (${V.pan}) Tj ET` });
    const controller = new AbortController();
    controller.abort();
    await expect(checkHits(file, [AQ], NONE, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    const steps: [number, number][] = [];
    await checkHits(file, [AQ], NONE, { onProgress: (done, total) => void steps.push([done, total]) });
    expect(steps.length).toBeGreaterThan(0);
    const [done, total] = steps[steps.length - 1];
    expect(done).toBe(total);
  });

  /** Runs `start` with a progress callback that holds the run until released; says whether it finished while held. */
  async function heldBy(start: (onProgress: () => Promise<void>) => Promise<unknown>): Promise<{ finishedWhileHeld: boolean; calls: number }> {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let calls = 0;
    let finished = false;
    const run = start(() => {
      calls += 1;
      return gate;
    }).then(() => void (finished = true));
    await new Promise((resolve) => setTimeout(resolve, 300));
    const finishedWhileHeld = finished;
    release();
    await run;
    return { finishedWhileHeld, calls };
  }

  it('awaits the progress callback (run lane): the check and the structure check wait for it, so the caller can yield', async () => {
    const file = await pdfWith({ 1: `BT /F1 12 Tf 50 700 Td (${V.pan}) Tj ET` });
    const check = await heldBy((onProgress) => checkHits(file, [AQ], NONE, { onProgress }));
    expect(check.finishedWhileHeld).toBe(false);
    expect(check.calls).toBeGreaterThan(0);
    const structure = await heldBy((onProgress) => structureProblems(file, [1], { onProgress }));
    expect(structure.finishedWhileHeld).toBe(false);
    expect(structure.calls).toBeGreaterThan(0);
  });

  it('a progress callback that throws, or rejects, stops the run with its error; an aborted signal stops the structure check', async () => {
    const file = await pdfWith({ 1: `BT /F1 12 Tf 50 700 Td (${V.pan}) Tj ET` });
    const stopped = () => new DOMException('Stopped by the user.', 'AbortError');
    await expect(checkHits(file, [AQ], NONE, { onProgress: () => { throw stopped(); } })).rejects.toMatchObject({ name: 'AbortError' });
    await expect(checkHits(file, [AQ], NONE, { onProgress: () => Promise.reject(stopped()) })).rejects.toMatchObject({ name: 'AbortError' });
    await expect(structureProblems(file, [1], { onProgress: () => Promise.reject(stopped()) })).rejects.toMatchObject({ name: 'AbortError' });
    const controller = new AbortController();
    controller.abort();
    await expect(structureProblems(file, [1], { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    // Stopped runs keep nothing: the same file checks the same afterwards.
    expect((await checkHits(file, [AQ], NONE)).map((hit) => hit.pages)).toEqual([[1]]);
  });
});

describe('fix round 1: the strict pass and the find agree on every written form (F3)', () => {
  let options: FindOptions;
  beforeAll(async () => {
    options = { groups: new Set(['identity', 'contact', 'bank-tax', 'network', 'names']), terms: [{ text: 'Sharma & Co', reason: '' }], measure: await standardMeasure() };
  });
  const style = { s: { fontFamily: 'sans-serif', ascent: 0.9, descent: -0.2, vertical: false } };
  const pageOf = (index: number, lines: string[]): PageTextModel =>
    buildPageText(index, lines.map((str, i): TextItemLike => ({ str, transform: [10, 0, 0, 10, 50, 780 - i * 12], width: str.length * 5.5, height: 10, fontName: 's', hasEOL: true })), style, [0, 0, 612, 792], 0);
  const at = (key: string, sep: string) => key.slice(0, Math.floor(key.length / 2)) + sep + key.slice(Math.floor(key.length / 2));
  /** Forms beyond the shared list, to see where the second net reaches past the find. */
  const beyond = (kind: RedactKind, key: string): { name: string; text: string; value?: string }[] => {
    if (kind === 'email')
      return [
        { name: 'three spaces before the @', text: key.replace('@', '   @') },
        { name: 'a space inside the name', text: `${key.slice(0, 4)} ${key.slice(4)}` },
        { name: 'a line break inside the domain', text: key.replace('example', 'exam\nple') },
      ];
    if (kind === 'ip')
      return [
        { name: 'as written', text: key },
        { name: 'a full stop after it', text: `${key}.`, value: key }, // the full stop is not the value's
        { name: 'spaces around the dots', text: key.split('.').join(' . ') },
        { name: 'a line break after a dot', text: key.replace('.', '.\n') },
      ];
    if (kind === 'typed')
      return [
        { name: 'as written', text: key },
        { name: 'upper case, wrapped', text: 'SHARMA &\nCO' },
        { name: 'hyphens between the words', text: 'Sharma - & - Co' },
        { name: 'spaced out', text: 'S h a r m a & C o' },
      ];
    return [
      { name: 'a dot and a space', text: at(key, '. ') },
      { name: 'space slash space', text: at(key, ' / ') },
      { name: 'an underscore', text: at(key, '_') },
      { name: 'a tab', text: at(key, '\t') },
      { name: 'two spaces between every character', text: Array.from(key).join('  ') },
      { name: 'four spaces', text: at(key, '    ') },
      { name: 'two slashes with spaces', text: at(key, ' / / ') },
      { name: 'four spaces between every character', text: Array.from(key).join('    ') },
    ];
  };

  it('every form the strict pass flags is one the find boxes; the loose-only forms are listed', () => {
    const seed = pageOf(0, [`PAN ${SECRET} of the assessee`, `Aadhaar ${AADHAAR}`, 'Mobile +91 98450 12345', 'A/c No. 50100123456789', 'mail r.kumar@example.in', `GSTIN ${GSTIN}`, 'IP address 10.0.0.1', 'paid to Sharma & Co today']);
    const found = proposalsForPage(seed, [], options);
    const values: [RedactKind, string][] = [
      ['pan', SECRET],
      ['aadhaar', AADHAAR],
      ['mobile', '9845012345'],
      ['bank-account', '50100123456789'],
      ['email', 'r.kumar@example.in'],
      ['gstin', GSTIN],
      ['ip', '10.0.0.1'],
      ['typed', 'sharma & co'],
    ];
    for (const [kind, key] of values) expect(found.some((p) => p.kind === kind && p.key === key), `${kind} seen on the seed page`).toBe(true);
    const cases = values.flatMap(([kind, key]) => [
      ...(kind === 'ip' || kind === 'typed' ? [] : writtenForms(kind, key).map((form) => ({ kind, key, form, shared: true }))),
      ...beyond(kind, key).map((form) => ({ kind, key, form, shared: false })),
    ]);
    const pages = [seed, ...cases.map((c, i) => pageOf(i + 1, `holds ${c.form.text} here`.split('\n')))];
    const all = everyOccurrence(pages, found, options.measure);
    const results = cases.map((c, i) => {
      const page = pages[i + 1];
      const start = page.text.indexOf('holds ') + 6;
      const value = 'value' in c.form ? c.form.value : undefined;
      const end = value === undefined ? page.text.lastIndexOf(' here') : start + value.length;
      const boxed = all.some((p) => p.page === i + 1 && p.kind === c.kind && p.key === c.key && p.ranges[0][0] <= start && p.ranges[0][1] >= end && p.rects.length > 0);
      const pass = targetPass([{ kind: c.kind, forms: [c.key], wholeWord: c.kind === 'typed' }])(`holds ${c.form.text} here`);
      return { label: `${c.kind}: ${c.form.name}`, shared: c.shared, pass, boxed };
    });
    // Every form of the shared list is a strict hit, and the find boxes it.
    expect(results.filter((r) => r.shared && r.pass !== 'strict').map((r) => r.label)).toEqual([]);
    // No form the strict pass flags is one the find leaves unboxed.
    expect(results.filter((r) => r.pass === 'strict' && !r.boxed).map((r) => r.label)).toEqual([]);
    // What only the second net flags and the find cannot box: such a hit is dealt with by flattening its page, or refused.
    const codesApart = ['four spaces', 'two slashes with spaces', 'four spaces between every character'];
    expect(results.filter((r) => r.pass === 'loose' && !r.boxed).map((r) => r.label)).toEqual([
      ...['pan', 'aadhaar', 'mobile', 'bank-account'].flatMap((kind) => codesApart.map((name) => `${kind}: ${name}`)),
      'email: three spaces before the @',
      'email: a space inside the name',
      'email: a line break inside the domain',
      ...codesApart.map((name) => `gstin: ${name}`),
      'ip: spaces around the dots',
      'ip: a line break after a dot',
      // (typed words with hyphens between them: the find's own rule since T-052, redactPatterns.ts TERM_RULE)
    ]);
    // And the loose pass flags nothing the find boxes: a boxed form is always a strict one.
    expect(results.filter((r) => r.pass === 'loose' && r.boxed).map((r) => r.label)).toEqual([]);
    // Nothing tried here is missed by both passes.
    expect(results.filter((r) => r.pass === null).map((r) => r.label)).toEqual([]);
  });
});

// ---- fix wave (T-052): what the end-to-end review (redact-e2e-review.md) got past the check ------------

const QW = 'QWXPT4821K';
const QW_PAN: CheckTarget = { kind: 'pan', forms: [QW], wholeWord: false };
const NAME: CheckTarget = { kind: 'typed', forms: ['ramesh kumar gupta', 'Ramesh Kumar Gupta'], wholeWord: true };
const decimalRefs = (text: string) => Array.from(text, (c) => `&#${c.charCodeAt(0)};`).join('');
const hexRefs = (text: string) => Array.from(text, (c) => `&#x${c.charCodeAt(0).toString(16)};`).join('');

describe('fix wave B8: rich text and web addresses on a copied page', () => {
  it('finds a value in a comment\'s rich text (/RC) written with character references, decimal or hex, or split across spans', async () => {
    const rich = [
      `<?xml version="1.0"?><body xmlns="http://www.w3.org/1999/xhtml"><p>${decimalRefs(QW)}</p></body>`,
      `<body><p>${hexRefs(QW)}</p></body>`,
      `<body><p><span style="font-weight:bold">${QW.slice(0, 5)}</span><span>${QW.slice(5)}</span></p></body>`,
    ];
    for (const rc of rich) {
      const file = await pdfWith({}, withAnnotation({ Subtype: 'FreeText', Rect: [100, 500, 300, 540], Contents: PDFString.of('see note'), RC: PDFString.of(rc), DA: PDFString.of('/Helv 10 Tf 0 g') }));
      const hits = await checkHits(file, [QW_PAN], NONE);
      expect(hits.map(({ pages, part, key, remedy, boxes }) => ({ pages, part, key, remedy, boxes })), rc.slice(0, 30)).toEqual([
        { pages: [1], part: 'annotation', key: 'RC', remedy: 'boxes', boxes: [{ page: 1, rect: { x0: 100, y0: 500, x1: 300, y1: 540 } }] },
      ]);
    }
    // The same readings for the run's own check of what pdf.js reads, and words across tags and entities.
    const pass = targetPass([QW_PAN, NAME]);
    expect(pass(`<p>${decimalRefs(QW)}</p>`)).toBe('strict');
    expect(pass(`<p>${hexRefs(QW).toUpperCase().replace(/&#X/g, '&#x')}</p>`)).toBe('strict');
    expect(pass('<p>Ramesh</p><p>Kumar&#160;Gupta</p>')).not.toBeNull();
    expect(pass('<b>Ramesh</b> <i>Kumar</i> Gupta &amp; Co')).toBe('strict');
    // A tag never joins what is apart in the text itself.
    expect(targetPass([QW_PAN])('<p>QWXPT is not 4821K</p>')).toBeNull();
  });

  it('reads "+" in a web address as a space, as a browser does in a query', async () => {
    const address = 'https://portal.example.in/u?name=Ramesh+Kumar+Gupta';
    const file = await pdfWith({}, withAnnotation({ Subtype: 'Link', Rect: [100, 500, 300, 520], A: { S: 'URI', URI: PDFString.of(address) } }));
    const hits = await checkHits(file, [NAME], NONE);
    expect(hits.map(({ pages, part, remedy }) => ({ pages, part, remedy }))).toEqual([{ pages: [1], part: 'annotation', remedy: 'boxes' }]);
    // and so the build's matcher removes such a link from a copied page
    expect(targetMatcher([NAME])(address)).toBe(true);
    expect(targetMatcher([NAME])('https://portal.example.in/u?name=Ramesh+Kumar%20Gupta')).toBe(true);
    // Since fix wave 2 (ruling 4) any punctuation between the words, or none, is a leftover: an encoded plus, words run together.
    expect(targetMatcher([NAME])('https://portal.example.in/u?name=Ramesh%2BKumar%2BGupta')).toBe(true);
    expect(targetMatcher([NAME])('https://portal.example.in/u?name=Rameshkumar+Gupta')).toBe(true);
    expect(targetMatcher([NAME])('https://portal.example.in/u?name=Rameshkumari+Gupta')).toBe(false);
  });
});

describe("fix wave, non-blocking 3: a rebuilt page's text layer boxes only the words that hold a value", () => {
  it('does not take the next word along with a word that holds the value alone (the word on the line below was blacked out)', async () => {
    const source = await pdfWith({});
    const word = (text: string, x: number, y: number, width: number) => ({ text, transform: [11, 0, 0, 11, x, y] as const, width });
    const words = [word('PAN', 60, 780, 22), word('of', 85, 780, 10), word('BNZPM::::2501F', 60, 700, 90), word('Ordinary', 60, 650, 44), word('closing', 108, 650, 36), word('words', 148, 650, 30)];
    const { bytes } = await buildRedacted(source, [{ pageIndex: 0, picture: greyPicture(), words, ...AWAY }], { titleHasValue: () => false });
    const hits = await checkHits(bytes, [PAN], new Set([0]));
    expect(hits.map((hit) => ({ part: hit.part, pass: hit.pass, boxes: hit.boxes!.map((b) => [b.page, Math.round(b.rect.x0), Math.round(b.rect.y0)]) }))).toEqual([
      { part: 'text layer', pass: 'loose', boxes: [[0, 60, 697]] },
    ]);
  });
});

describe('fix wave round 2: a short added number (8 digits or fewer) needs no digit joined to it in the loose pass too', () => {
  // RX-PAT (T-052): the find places a PIN code, cheque number, membership number, director's DIN and the
  // like only where no digit is joined to it (redactPatterns.ts placesOfValue). The check's loose pass keeps
  // that boundary, with any punctuation between the digits, so an amount or a longer reference is not a
  // "survivor" that fails a good run or boxes unrelated digits.
  const PIN: CheckTarget = { kind: 'pin-code', forms: ['400001'], wholeWord: false };
  const DIN: CheckTarget = { kind: 'director-din', forms: ['01234567'], wholeWord: false };

  it('does not take a look-alike inside an amount or a longer number for the value', async () => {
    const pin = targetPass([PIN]);
    expect(pin('Total Rs. 14000012.00 paid')).toBeNull();
    expect(pin('Ref 2400001 dated 1-4-2025')).toBeNull();
    expect(pin('UTR 1400001.9 cleared')).toBeNull();
    expect(pin('Item code 4000012 in stock')).toBeNull();
    expect(targetPass([DIN])('Amount 1012345678 received')).toBeNull();
    const amounts = await pdfWith({ 1: 'BT /F1 12 Tf 50 700 Td (Total Rs. 14000012.00 and ref 2400001) Tj ET' });
    expect(await checkHits(amounts, [PIN], NONE)).toEqual([]);
  });

  it('still catches the value written anyhow on its own, strict or loose', async () => {
    const pin = targetPass([PIN]);
    expect(pin('Pune - 400001')).toBe('strict');
    expect(pin('PIN 400 001.')).toBe('strict');
    expect(pin('PIN 4-0-0-0-0-1')).toBe('strict');
    // more marks between the digits than the find allows, nothing joined to it: still a leftover
    expect(pin('PIN 400 .... 001')).toBe('loose');
    expect(targetPass([DIN])('DIN 0123 / / / / 4567')).toBe('loose');
    const survivor = await pdfWith({ 1: 'BT /F1 12 Tf 50 700 Td (Mumbai PIN 400 .... 001 and Rs. 14000012.00) Tj ET' });
    expect(await findTargets(survivor, [PIN], NONE)).toEqual({ pages: [1], elsewhere: [] });
    // The kinds of before T-052 keep their rule: a number inside a longer run is a place of it.
    expect(targetPass([{ kind: 'micr', forms: ['400240002'], wholeWord: false }])('ref 14002400021')).not.toBeNull();
  });

  it("the strict pass is the find's rule for typed words, the loose rule since fix wave 2 (TERM_RULE): one place from the find and the check", () => {
    expect(TERM_RULE).toContain('whatever is between them');
    const name = targetPass([NAME]);
    const key = keyOf('typed', 'Ramesh Kumar Gupta');
    for (const written of ['RAMESH.KUMAR.GUPTA', 'Ramesh_Kumar_Gupta', 'Ramesh Kumar, Gupta', 'Ramesh-Kumar-Gupta', 'Ramesh .  Kumar\nGupta', 'Ramesh ... Kumar Gupta', 'RameshKumarGupta', 'Ramesh;Kumar;Gupta', 'Ramesh/Kumar/Gupta', 'Ramesh....Kumar Gupta']) {
      const text = `paid to ${written} today`;
      expect(name(text), written).toBe('strict');
      // ruling 4: the same single place from the find's rule and the check's (and the run's net)
      const place = [{ start: 8, end: 8 + written.length }];
      expect(placesOfValue(text, 'typed', key), written).toEqual(place);
      expect(loosePlacesOf(text, 'typed', 'Ramesh Kumar Gupta'), written).toEqual(place);
    }
    for (const written of ['RameshKumarGuptaji', 'Ramesh Dasgupta', 'Ramesh Kumari Gupta', 'ShriRamesh Kumar Gupta']) {
      const text = `paid to ${written} today`;
      expect(name(text), written).toBeNull();
      expect(placesOfValue(text, 'typed', key), written).toEqual([]);
      expect(loosePlacesOf(text, 'typed', 'Ramesh Kumar Gupta'), written).toEqual([]);
    }
  });
});

// ---- fix wave 2 (T-052): what the adversarial re-test (redact-retest-1.md) got past ---------------------

const ch = (code: number) => String.fromCharCode(code);
/** Annotations on page 2 (index 1) of pdfWith's file, each given its own dictionary. */
const withAnnotations = (make: (doc: PDFDocument, page: PDFRef) => Record<string, unknown>[]) => ({
  edit: ({ doc, pages }: Built) => {
    const refs = make(doc, pages[1]).map((dict) => doc.context.register(doc.context.obj({ Type: 'Annot', P: pages[1], F: 4, ...dict } as never)));
    doc.context.lookup(pages[1], PDFDict).set(PDFName.of('Annots'), doc.context.obj(refs));
  },
});
/** A form XObject (an appearance) drawing `content` in Helvetica. */
const appearance = (doc: PDFDocument, content: string, bbox = [0, 0, 200, 50]) =>
  doc.context.register(doc.context.flateStream(content, { Type: 'XObject', Subtype: 'Form', BBox: bbox, Resources: { Font: { F1: doc.context.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica', Encoding: 'WinAnsiEncoding' }) } } } as never));

describe('fix wave 2, R7 and R8: one loose rule for values, typed words and file names (ruling 4)', () => {
  it('finds a typed name with any punctuation between its words, or none, on any page (R7)', async () => {
    const name = targetPass([NAME]);
    const separators = [ch(0x2013), ch(0x2014), ch(0xb7), ch(0x2022), '/', ';', ':', '....', ' & ', "'", ') (', '', ' - - - - '];
    for (const sep of separators) expect(name(`Contact: Ramesh${sep}Kumar${sep}Gupta end`), JSON.stringify(sep)).not.toBeNull();
    const copied = await pdfWith({ 1: 'BT /F1 12 Tf 50 700 Td (Contact: Ramesh/Kumar/Gupta end) Tj ET' });
    expect(await findTargets(copied, [NAME], NONE)).toEqual({ pages: [1], elsewhere: [] });
    // never inside a longer word
    expect(name('Contact: ShriRameshKumarGupta and RameshKumarGuptaji')).toBeNull();
    expect(targetPass([{ kind: 'typed', forms: ['gupta', 'Gupta'], wholeWord: true }])('Mr Dasgupta signed')).toBeNull();
  });

  it('finds a typed name run together in the file name (R8), and nothing in an unrelated name', () => {
    const holds = targetMatcher([NAME]);
    expect(holds('RameshKumarGupta_Form16.pdf')).toBe(true);
    expect(holds('RAMESHKUMARGUPTA.pdf')).toBe(true);
    expect(holds('Gupta-Ramesh-Kumar.pdf')).toBe(false);
    expect(holds('Form16_2025-26.pdf')).toBe(false);
  });

  it("loosePlacesOf is that rule in the text's offsets, so what the check flags the run can box", () => {
    const dash = ch(0x2013);
    const text = `Paid to Ramesh${dash}Kumar${dash}Gupta and RameshKumarGupta; not ShriRameshKumarGupta.`;
    expect(loosePlacesOf(text, 'typed', 'Ramesh Kumar Gupta').map((p) => text.slice(p.start, p.end))).toEqual([`Ramesh${dash}Kumar${dash}Gupta`, 'RameshKumarGupta']);
    const codes = 'PAN B N Z P M / 2501F and the ledger ref 14000012, PIN 400 .. 001.';
    expect(loosePlacesOf(codes, 'pan', SECRET).map((p) => codes.slice(p.start, p.end))).toEqual(['B N Z P M / 2501F']);
    expect(loosePlacesOf(codes, 'pin-code', '400001').map((p) => codes.slice(p.start, p.end))).toEqual(['400 .. 001']);
    // full-width letters fold; offsets stay the text's own
    const wide = `Paid to ${Array.from('RAMESH', (c) => ch(c.charCodeAt(0) + 0xfee0)).join('')} Kumar Gupta.`;
    expect(loosePlacesOf(wide, 'typed', 'Ramesh Kumar Gupta').map((p) => [p.start, p.end])).toEqual([[8, 26]]);
    // the check and loosePlacesOf agree: a text is a leftover exactly when it has a loose place
    const forms = [...[ch(0x2013), '/', ';', '', ' & '].map((s) => `x Ramesh${s}Kumar${s}Gupta y`), 'x Ramesh Kumari Gupta y', 'x RameshKumarGuptas y'];
    for (const f of forms) expect(targetPass([NAME])(f) !== null, f).toBe(loosePlacesOf(f, 'typed', 'Ramesh Kumar Gupta').length > 0);
  });
});

describe('fix wave 2, R1: text an appearance draws in pieces is read joined (in drawing order, across lines)', () => {
  const signature = (pieces: string) => `BT /F1 9 Tf 6 30 Td 11 TL ${pieces} ET`;
  const cases: [string, CheckTarget, string][] = [
    ['name wrapped over two lines (T*)', NAME, signature('(Digitally signed by ) Tj (RAMESH) Tj T* (KUMAR GUPTA) Tj T* (Date: 2026.11.14) Tj')],
    ['name wrapped with Td', NAME, signature('(Digitally signed by RAMESH) Tj 0 -11 Td (KUMAR GUPTA) Tj')],
    ['name word by word', NAME, signature('(Ramesh) Tj 3 0 Td (Kumar) Tj 3 0 Td (Gupta) Tj')],
    ["name with the ' operator", NAME, signature("(Signed by Ramesh) Tj (Kumar Gupta) '")],
    ['PAN in two strings', QW_PAN, signature(`(PAN ) Tj (${QW.slice(0, 5)}) Tj (${QW.slice(5)}) Tj`)],
    ['PAN in two text objects', QW_PAN, `BT /F1 9 Tf 6 30 Td (${QW.slice(0, 5)}) Tj ET BT /F1 9 Tf 40 30 Td (${QW.slice(5)}) Tj ET`],
    ['PAN with the " operator', QW_PAN, signature(`(PAN) Tj 1 0 (${QW.slice(0, 5)}) " (${QW.slice(5)}) Tj`)],
    ['PAN one character per string', QW_PAN, signature(Array.from(QW, (c) => `(${c}) Tj`).join(' '))],
    // my own variations: a word cut inside it, and a name over three lines with mixed operators
    ['name cut inside a word', NAME, signature('(RAM) Tj (ESH KU) Tj T* (MAR GUP) Tj (TA) Tj')],
    ['name over three lines, mixed operators', NAME, signature("(Ramesh) Tj T* (Kumar) ' 0 -11 Td [(Gu) -20 (pta)] TJ")],
  ];
  for (const [label, target, content] of cases) {
    it(`${label}: located to the stamp and boxed by its rectangle`, async () => {
      const file = await pdfWith({}, withAnnotations((doc) => [{ Subtype: 'Stamp', Rect: [300, 500, 500, 550], AP: { N: appearance(doc, content) } }]));
      const hits = await checkHits(file, [target], NONE);
      expect(hits.map(({ pages, drawn, remedy, boxes }) => ({ pages, drawn, remedy, boxes }))).toEqual([
        { pages: [1], drawn: true, remedy: 'boxes', boxes: [{ page: 1, rect: { x0: 300, y0: 500, x1: 500, y1: 550 } }] },
      ]);
    });
  }
  it('pieces of different words with letters between them do not make the value', async () => {
    const file = await pdfWith({}, withAnnotations((doc) => [{ Subtype: 'Stamp', Rect: [300, 500, 500, 550], AP: { N: appearance(doc, signature('(QWXPT) Tj T* (Verified on 4821) Tj T* (K-Block) Tj')) } }]));
    expect(await checkHits(file, [QW_PAN], NONE)).toEqual([]);
  });
});

describe('fix wave 2, R2: one appearance drawn by several annotations gives every one of their rectangles', () => {
  it('two stamps sharing one stored stream on one page: both rectangles', async () => {
    const file = await pdfWith({}, withAnnotations((doc) => {
      const shared = appearance(doc, `BT /F1 10 Tf 6 30 Td (VERIFIED) Tj 0 -13 Td (PAN ${QW}) Tj ET`);
      return [
        { Subtype: 'Stamp', Rect: [300, 500, 500, 550], AP: { N: shared } },
        { Subtype: 'Stamp', Rect: [300, 200, 500, 250], AP: { N: shared } },
      ];
    }));
    const hits = await checkHits(file, [QW_PAN], NONE);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ pages: [1], remedy: 'boxes' });
    expect(hits[0].boxes).toEqual([
      { page: 1, rect: { x0: 300, y0: 500, x1: 500, y1: 550 } },
      { page: 1, rect: { x0: 300, y0: 200, x1: 500, y1: 250 } },
    ]);
  });

  it('my variations: three widgets sharing an appearance; one form drawn inside two appearances', async () => {
    const widgets = await pdfWith({}, withAnnotations((doc) => {
      const shared = appearance(doc, `/Tx BMC BT /F1 10 Tf 2 5 Td (${QW}) Tj ET EMC`, [0, 0, 150, 20]);
      return [0, 1, 2].map((k) => ({ Subtype: 'Widget', FT: 'Tx', T: PDFString.of(`pan${k}`), Rect: [100, 600 - 40 * k, 250, 620 - 40 * k], AP: { N: shared } }));
    }));
    const [hit] = await checkHits(widgets, [QW_PAN], NONE);
    expect(hit.boxes?.map((b) => b.rect.y0)).toEqual([600, 560, 520]);
    const nested = await pdfWith({}, withAnnotations((doc) => {
      const inner = appearance(doc, `BT /F1 10 Tf 6 10 Td (PAN ${QW}) Tj ET`);
      const outer = (y: number) => doc.context.register(doc.context.flateStream(`q 1 0 0 1 0 ${y} cm /In Do Q`, { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 200, 50], Resources: { XObject: { In: inner } } } as never));
      return [
        { Subtype: 'Stamp', Rect: [300, 500, 500, 550], AP: { N: outer(0) } },
        { Subtype: 'Stamp', Rect: [300, 100, 500, 150], AP: { N: outer(5) } },
      ];
    }));
    const located = await checkHits(nested, [QW_PAN], NONE);
    expect(located.flatMap((h) => h.boxes ?? []).map((b) => b.rect.y0).sort((a, b) => a - b)).toEqual([100, 500]);
  });
});


describe('fix wave 2: pageDrawings reads every drawing besides ordinary page text (rulings 1, 2, 5; rx2-contract.md (b))', () => {
  const helv = (doc: PDFDocument) => doc.context.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica', Encoding: 'WinAnsiEncoding' });
  const form = (doc: PDFDocument, content: string, resources: Record<string, unknown> = { Font: { F1: helv(doc) } }, bbox = [0, 0, 200, 50]) =>
    doc.context.register(doc.context.flateStream(content, { Type: 'XObject', Subtype: 'Form', BBox: bbox, Resources: resources } as never));
  const toUnicode = (doc: PDFDocument, pairs: [number, number][]) =>
    doc.context.register(doc.context.flateStream(`/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CMapName /T def 1 begincodespacerange <00> <FF> endcodespacerange ${pairs.length} beginbfchar ${pairs.map(([c, u]) => `<${c.toString(16).padStart(2, '0')}> <${u.toString(16).padStart(4, '0')}>`).join(' ')} endbfchar endcmap end end`));
  const PAN_CODES = '<0102030405060708090A>';
  /** Glyph names /Q /W /X /P /T /four /eight /two /one /K on codes 1 to 10 (the PAN shown), and a map that says "abcdefghij". */
  const lyingFont = (doc: PDFDocument) =>
    doc.context.obj({
      Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica',
      Encoding: { Type: 'Encoding', Differences: [1, ...['Q', 'W', 'X', 'P', 'T', 'four', 'eight', 'two', 'one', 'K'].map((n) => PDFName.of(n))] },
      ToUnicode: toUnicode(doc, Array.from({ length: 10 }, (_, k) => [k + 1, 0x61 + k] as [number, number])),
    });
  const pagePlus = (content: string, resources: (doc: PDFDocument) => Record<string, unknown>, more?: (doc: PDFDocument, page: PDFRef, pages: PDFRef[]) => void) =>
    pdfWith({ 1: content }, {
      edit: ({ doc, pages }) => {
        const page = doc.context.lookup(pages[1], PDFDict);
        page.set(PDFName.of('Resources'), doc.context.obj({ Font: { F1: helv(doc) }, ...resources(doc) } as never));
        more?.(doc, pages[1], pages);
      },
    });
  const brief = (d: PageDrawing) => ({ page: d.page, kind: d.kind, text: d.text?.joined, unreadable: d.unreadable });

  it('R1, R2: one appearance drawing per annotation (even sharing one stream), its pieces joined, its rectangle given', async () => {
    const file = await pdfWith({}, withAnnotations((doc) => {
      const shared = appearance(doc, `BT /F1 10 Tf 6 30 Td (VERIFIED) Tj 0 -13 Td (PAN ) Tj (${QW.slice(0, 5)}) Tj (${QW.slice(5)}) Tj ET`);
      return [
        { Subtype: 'Stamp', Rect: [300, 500, 500, 550], AP: { N: shared } },
        { Subtype: 'Stamp', Rect: [300, 200, 500, 250], AP: { N: shared } },
        { Subtype: 'Stamp', Rect: [10, 10, 60, 60], AP: { N: shared }, F: 2 },
      ];
    }));
    const drawings = await pageDrawings(file, [1]);
    expect(drawings.map((d) => [d.kind, d.source.annotation?.index, d.source.annotation?.rect.y0, d.text?.joined])).toEqual([
      ['appearance', 0, 500, `VERIFIEDPAN ${QW}`],
      ['appearance', 1, 200, `VERIFIEDPAN ${QW}`],
    ]);
    expect(drawings[0].text?.spaced).toBe(`VERIFIED${String.fromCharCode(10)}PAN  ${QW.slice(0, 5)} ${QW.slice(5)}`);
    expect(drawings.map(drawingPass([QW_PAN]))).toEqual(['strict', 'strict']);
    expect(drawings[0].source.stream).toBe(drawings[1].source.stream);
    expect(drawings[0].source.strings).toHaveLength(4);
  });

  it('R3: a form drawn by the page and again inside a stamp, and a pattern that draws a form: each is a drawing of its own', async () => {
    const file = await pagePlus('BT /F1 11 Tf 60 780 Td (Ordinary words) Tj ET q 1 0 0 1 60 600 cm /Blk Do Q /Pattern cs /P1 scn 60 400 180 60 re f', (doc) => {
      const block = form(doc, `BT /F1 10 Tf 0 10 Td (PAN ${QW}) Tj ET`);
      const pattern = doc.context.register(doc.context.flateStream('q /In Do Q', { Type: 'Pattern', PatternType: 1, PaintType: 1, TilingType: 1, BBox: [0, 0, 90, 20], XStep: 90, YStep: 20, Resources: { XObject: { In: block } } } as never));
      return { XObject: { Blk: block }, Pattern: { P1: pattern } };
    }, (doc, page) => {
      const pageDict = doc.context.lookup(page, PDFDict);
      const block = ((pageDict.get(PDFName.of('Resources')) as PDFDict).get(PDFName.of('XObject')) as PDFDict).get(PDFName.of('Blk'));
      const stampAp = form(doc, 'q /Blk Do Q', { XObject: { Blk: block } });
      const stamp = doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Stamp', P: page, F: 4, Rect: [300, 100, 500, 150], AP: { N: stampAp } } as never));
      pageDict.set(PDFName.of('Annots'), doc.context.obj([stamp]));
    });
    const drawings = await pageDrawings(file, [1]);
    expect(drawings.map(brief)).toEqual([
      { page: 1, kind: 'form', text: `PAN ${QW}`, unreadable: undefined },
      { page: 1, kind: 'pattern', text: `PAN ${QW}`, unreadable: undefined },
      { page: 1, kind: 'appearance', text: `PAN ${QW}`, unreadable: undefined },
    ]);
  });

  it('R3: text whose map says other characters than its glyphs is a content drawing, unreadable since fix wave 4 (ruling N); a font with no usable map is unreadable', async () => {
    const lying = await pagePlus(`BT /F1 11 Tf 60 780 Td (PAN of the assessee: ${QW}) Tj ET BT /F9 11 Tf 60 700 Td ${PAN_CODES} Tj ET`, (doc) => ({ Font: { F1: helv(doc), F9: lyingFont(doc) } }));
    const read = await pageDrawings(lying, [1]);
    // Fix wave 4, ruling N overturns "read by its glyph names": a map that disagrees with the names is not trusted at all.
    expect(read.map(brief)).toEqual([{ page: 1, kind: 'content', text: undefined, unreadable: 'font' }]);
    expect(read[0].source.strings).toHaveLength(1);
    const blind = await pagePlus(`BT /F9 11 Tf 60 700 Td ${PAN_CODES} Tj ET`, (doc) => ({
      Font: { F9: doc.context.obj({ Type: 'Font', Subtype: 'TrueType', BaseFont: 'ABCDEF+Sub', FontDescriptor: { Type: 'FontDescriptor', Flags: 4 }, ToUnicode: toUnicode(doc, Array.from({ length: 10 }, (_, k) => [k + 1, 0xe000 + k] as [number, number])) }) },
    }));
    expect((await pageDrawings(blind, [1])).map(brief)).toEqual([{ page: 1, kind: 'content', text: undefined, unreadable: 'font' }]);
  });

  it('R4: a Type 3 glyph procedure that writes the value, directly or through a form, is a glyph drawing with that text', async () => {
    for (const proc of [`1000 0 d0 BT /F1 100 Tf 0 300 Td (${QW}) Tj ET`, '1000 0 d0 q /Fm Do Q']) {
      const file = await pagePlus('BT /T3 100 Tf 60 300 Td (a) Tj ET', (doc) => {
        const inner = form(doc, `BT /F1 100 Tf 0 300 Td (${QW}) Tj ET`);
        const charProc = doc.context.register(doc.context.flateStream(proc));
        return {
          Font: {
            F1: helv(doc),
            T3: doc.context.obj({ Type: 'Font', Subtype: 'Type3', FontBBox: [0, 0, 1000, 1000], FontMatrix: [0.001, 0, 0, 0.001, 0, 0], CharProcs: { a: charProc }, Encoding: { Type: 'Encoding', Differences: [97, PDFName.of('a')] }, FirstChar: 97, LastChar: 97, Widths: [1000], Resources: { Font: { F1: helv(doc) }, XObject: { Fm: inner } } } as never),
          },
        };
      });
      const drawings = await pageDrawings(file, [1]);
      expect(drawings.map((d) => [d.kind, d.text?.joined]), proc).toEqual([['glyph', QW]]);
      expect(drawingPass([QW_PAN])(drawings[0])).toBe('strict');
    }
  });

  it('R5: what the reader cannot be sure of is unreadable, never "no text"', async () => {
    const stamp = (edit: (doc: PDFDocument, ap: PDFRef) => void) =>
      pdfWith({}, withAnnotations((doc) => {
        const ap = appearance(doc, `BT /F1 10 Tf 6 30 Td (PAN ${QW}) Tj ET`, [0, 0, 201, 51]);
        edit(doc, ap);
        return [{ Subtype: 'Stamp', Rect: [300, 500, 500, 550], AP: { N: ap } }];
      }));
    const filtered = (filter: PDFObject) => stamp((doc, ap) => doc.context.lookup(ap, PDFStream).dict.set(PDFName.of('Filter'), filter));
    const reasons: (UnreadableReason | undefined)[] = [];
    for (const file of [
      await filtered(PDFName.of('Fl')),
      await filtered(PDFName.of('AHx')),
      await stamp((doc, ap) => doc.context.lookup(ap, PDFStream).dict.set(PDFName.of('Filter'), doc.context.obj([PDFName.of('Crypt'), PDFName.of('FlateDecode')]))),
    ]) reasons.push((await pageDrawings(file, [1]))[0]?.unreadable);
    // A malformed number in the appearance's dictionary, and a second copy of it after %%EOF.
    const plain = await stamp(() => undefined);
    const text = Buffer.from(plain).toString('latin1');
    const malformed = Buffer.from(text.replace('/BBox [ 0 0 201 51 ]', '/BBox [ 0 0 201 51 ] /Junk 1.2.3.4.5'), 'latin1');
    expect(malformed.length).toBeGreaterThan(plain.length);
    reasons.push((await pageDrawings(new Uint8Array(malformed), [1]))[0]?.unreadable);
    const apNumber = Number(/(\d+) 0 obj\s*<<[^>]*\/BBox \[ 0 0 201 51 \]/.exec(text)?.[1]);
    const appended = Buffer.concat([Buffer.from(plain), Buffer.from(`\n${apNumber} 0 obj\n<< /Type /XObject /Subtype /Form /BBox [0 0 1 1] /Length 0 >>\nstream\n\nendstream\nendobj\n`, 'latin1')]);
    reasons.push((await pageDrawings(new Uint8Array(appended), [1]))[0]?.unreadable);
    expect(reasons).toEqual(['filter', 'filter', 'filter', 'parse', 'parse']);
    // The readable original reads.
    expect((await pageDrawings(plain, [1])).map(brief)).toEqual([{ page: 1, kind: 'appearance', text: `PAN ${QW}`, unreadable: undefined }]);
  });

  it('R6: alternative text on a structure element is a drawing placed by its MCIDs, and the check locates its hit to that page', async () => {
    const file = await pagePlus(`/Span <</MCID 0>> BDC BT /F9 11 Tf 60 700 Td ${PAN_CODES} Tj ET EMC BT /F1 11 Tf 60 650 Td (ordinary) Tj ET`, (doc) => ({ Font: { F1: helv(doc), F9: lyingFont(doc) } }), (doc, page) => {
      const root = doc.context.nextRef();
      const element = doc.context.register(doc.context.obj({ Type: 'StructElem', S: 'Span', P: root, Pg: page, K: 0, ActualText: PDFString.of(QW) } as never));
      doc.context.assign(root, doc.context.obj({ Type: 'StructTreeRoot', K: [element] } as never));
      doc.catalog.set(PDFName.of('StructTreeRoot'), root);
      doc.catalog.set(PDFName.of('MarkInfo'), doc.context.obj({ Marked: true }));
    });
    const alts = (await pageDrawings(file, [1])).filter((d) => d.kind === 'alt');
    expect(alts.map((d) => [d.text?.joined, d.source.mcids, d.source.spans?.length])).toEqual([[QW, [0], 1]]);
    const hits = await checkHits(file, [QW_PAN], NONE);
    const structural = hits.find((h) => h.key === 'ActualText');
    expect(structural).toMatchObject({ pages: [1], drawn: false, remedy: 'flatten', marked: [{ page: 1, mcids: [0] }] });
  });

  it('an ordinary page gives no unreadable drawing; a form header reads as its text', async () => {
    const file = await pagePlus('BT /F1 11 Tf 60 780 Td (Ordinary words of a ledger page) Tj ET q 1 0 0 1 60 800 cm /Hd Do Q', (doc) => ({ XObject: { Hd: form(doc, 'BT /F1 9 Tf 0 0 Td (Kestrel and Co - Chartered Accountants) Tj ET') } }), (doc, page) => {
      const link = doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Link', P: page, Rect: [60, 770, 200, 790], A: { S: 'URI', URI: PDFString.of('https://example.in/') } } as never));
      doc.context.lookup(page, PDFDict).set(PDFName.of('Annots'), doc.context.obj([link]));
    });
    const drawings = await pageDrawings(file, [0, 1, 2]);
    expect(drawings.map(brief)).toEqual([{ page: 1, kind: 'form', text: 'Kestrel and Co - Chartered Accountants', unreadable: undefined }]);
  });
});


describe('fix wave 2: my own variations the fixes must also hold (redact-fix-rules-2.md)', () => {
  const helv = (doc: PDFDocument) => doc.context.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica', Encoding: 'WinAnsiEncoding' });
  const form = (doc: PDFDocument, content: string, resources: Record<string, unknown>) =>
    doc.context.register(doc.context.flateStream(content, { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 200, 50], Resources: resources } as never));
  const onPage1 = (content: string, resources: (doc: PDFDocument) => Record<string, unknown>, more?: (doc: PDFDocument, page: PDFRef) => void) =>
    pdfWith({ 1: content }, {
      edit: ({ doc, pages }) => {
        doc.context.lookup(pages[1], PDFDict).set(PDFName.of('Resources'), doc.context.obj({ Font: { F1: helv(doc) }, ...resources(doc) } as never));
        more?.(doc, pages[1]);
      },
    });
  const lying = (doc: PDFDocument) =>
    doc.context.obj({
      Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica',
      Encoding: { Type: 'Encoding', Differences: [1, ...['Q', 'W', 'X', 'P', 'T', 'four', 'eight', 'two', 'one', 'K'].map((n) => PDFName.of(n))] },
      ToUnicode: doc.context.register(doc.context.flateStream(`begincmap 1 begincodespacerange <00> <FF> endcodespacerange 10 beginbfchar ${Array.from({ length: 10 }, (_, k) => `<${(k + 1).toString(16).padStart(2, '0')}> <${(0x30 + k).toString(16).padStart(4, '0')}>`).join(' ')} endbfchar endcmap`)),
    });

  it('R3 a: a form two levels deep in the page reads with everything it draws', async () => {
    const file = await onPage1('q /Outer Do Q', (doc) => {
      const inner = form(doc, `BT /F1 10 Tf 0 10 Td (${QW.slice(0, 5)}) Tj ( ${QW.slice(5)}) Tj ET`, { Font: { F1: helv(doc) } });
      return { XObject: { Outer: form(doc, 'q /In Do Q', { XObject: { In: inner } }) } };
    });
    const drawings = await pageDrawings(file, [1]);
    expect(drawings.map((d) => [d.kind, drawingPass([QW_PAN])(d)])).toEqual([['form', 'strict']]);
  });

  it('R3 b: a form whose text is shown in a font with a lying map is unreadable (fix wave 4, ruling N; it was read by its glyph names)', async () => {
    const file = await onPage1('q /Blk Do Q', (doc) => ({ XObject: { Blk: form(doc, 'BT /F9 10 Tf 0 10 Td <0102030405060708090A> Tj ET', { Font: { F9: lying(doc) } }) } }));
    expect((await pageDrawings(file, [1])).map((d) => [d.kind, d.text?.joined, d.unreadable])).toEqual([['form', undefined, 'font']]);
  });

  it('R4 a: a Type 3 glyph used inside a stamp: the stamp reads with what the glyph writes', async () => {
    const file = await pdfWith({}, withAnnotations((doc) => {
      const charProc = doc.context.register(doc.context.flateStream(`1000 0 d0 BT /F1 100 Tf 0 300 Td (${QW}) Tj ET`));
      const t3 = doc.context.obj({ Type: 'Font', Subtype: 'Type3', FontBBox: [0, 0, 1000, 1000], FontMatrix: [0.001, 0, 0, 0.001, 0, 0], CharProcs: { a: charProc }, Encoding: { Type: 'Encoding', Differences: [97, PDFName.of('a')] }, FirstChar: 97, LastChar: 97, Widths: [1000], Resources: { Font: { F1: helv(doc) } } } as never);
      return [{ Subtype: 'Stamp', Rect: [300, 500, 500, 550], AP: { N: form(doc, 'BT /T3 20 Tf 5 5 Td (a) Tj ET', { Font: { T3: t3 } }) } }];
    }));
    const [stamp] = await pageDrawings(file, [1]);
    expect(stamp.kind).toBe('appearance');
    expect(drawingPass([QW_PAN])(stamp)).toBe('strict');
  });

  it('R4 b: a glyph procedure the reader cannot decode is a drawing it cannot read', async () => {
    const file = await onPage1('BT /T3 100 Tf 60 300 Td (a) Tj ET', (doc) => {
      const charProc = doc.context.register(doc.context.flateStream(`1000 0 d0 BT /F1 100 Tf 0 300 Td (${QW}) Tj ET`));
      doc.context.lookup(charProc, PDFStream).dict.set(PDFName.of('Filter'), PDFName.of('Fl'));
      return { Font: { F1: helv(doc), T3: doc.context.obj({ Type: 'Font', Subtype: 'Type3', FontBBox: [0, 0, 1000, 1000], FontMatrix: [0.001, 0, 0, 0.001, 0, 0], CharProcs: { a: charProc }, Encoding: { Type: 'Encoding', Differences: [97, PDFName.of('a')] }, FirstChar: 97, LastChar: 97, Widths: [1000], Resources: { Font: { F1: helv(doc) } } } as never) } };
    });
    expect((await pageDrawings(file, [1])).map((d) => [d.kind, d.unreadable])).toEqual([['glyph', 'filter']]);
  });

  it('R5 a: the page content itself in an abbreviated filter is unreadable content; R5 b: an object defined twice in one revision is unreadable', async () => {
    const abbreviated = await pdfWith({}, {
      edit: ({ doc, pages }) => {
        const content = doc.context.flateStream(`BT /F1 12 Tf 50 700 Td (PAN ${QW}) Tj ET`);
        content.dict.set(PDFName.of('Filter'), PDFName.of('Fl'));
        doc.context.lookup(pages[1], PDFDict).set(PDFName.of('Contents'), doc.context.register(content));
      },
    });
    expect((await pageDrawings(abbreviated, [1])).map((d) => [d.kind, d.unreadable])).toEqual([['content', 'filter']]);
    const plain = await pdfWith({}, withAnnotations((doc) => [{ Subtype: 'Stamp', Rect: [300, 500, 500, 550], AP: { N: appearance(doc, `BT /F1 10 Tf 6 30 Td (PAN ${QW}) Tj ET`, [0, 0, 202, 52]) } }]));
    const text = Buffer.from(plain).toString('latin1');
    const found = /(\d+) 0 obj\s*<<[^>]*\/BBox \[ 0 0 202 52 \]/.exec(text)!;
    const copy = `${found[1]} 0 obj\n<< /Type /XObject /Subtype /Form /BBox [0 0 1 1] /Length 0 >>\nstream\n\nendstream\nendobj\n`;
    const twice = Buffer.from(text.slice(0, found.index) + copy + text.slice(found.index), 'latin1');
    expect((await pageDrawings(new Uint8Array(twice), [1])).map((d) => [d.kind, d.unreadable])).toEqual([['appearance', 'parse']]);
  });

  it('R6 a: /Alt on a figure whose kids are marked-content references; R6 b: an element that takes its page from its parent', async () => {
    const tagged = (kids: (page: PDFRef) => unknown, ownPage: boolean) =>
      onPage1('/Figure <</MCID 3>> BDC q 10 0 0 10 60 600 cm 0 g 0 0 1 1 re f Q EMC', () => ({}), (doc, page) => {
        const root = doc.context.nextRef();
        const parent = doc.context.nextRef();
        const element = doc.context.register(doc.context.obj({ Type: 'StructElem', S: 'Figure', P: parent, ...(ownPage ? { Pg: page } : {}), K: kids(page), Alt: PDFString.of(`Signature of Ramesh Kumar Gupta, PAN ${QW}`) } as never));
        doc.context.assign(parent, doc.context.obj({ Type: 'StructElem', S: 'Sect', P: root, Pg: page, K: [element] } as never));
        doc.context.assign(root, doc.context.obj({ Type: 'StructTreeRoot', K: [parent] } as never));
        doc.catalog.set(PDFName.of('StructTreeRoot'), root);
      });
    for (const file of [await tagged((page) => [{ Type: 'MCR', MCID: 3, Pg: page }], true), await tagged(() => 3, false)]) {
      const alts = (await pageDrawings(file, [1])).filter((d) => d.kind === 'alt');
      expect(alts.map((d) => [d.source.mcids, d.source.spans?.length, drawingPass([QW_PAN, NAME])(d)])).toEqual([[[3], 1, 'strict']]);
      const hit = (await checkHits(file, [QW_PAN], NONE)).find((h) => h.key === 'Alt');
      expect(hit).toMatchObject({ pages: [1], marked: [{ page: 1, mcids: [3] }] });
    }
  });
});


describe('fix wave 2, R4 and ruling 2: a Type 3 glyph that draws a picture is unreadable; a glyph that paints its own bitmap is a glyph', () => {
  it('reports the first, not the second', async () => {
    const make = (proc: string) =>
      pdfWith({ 1: 'BT /T3 100 Tf 60 300 Td (a) Tj ET' }, {
        edit: ({ doc, pages }) => {
          const picture = doc.context.register(doc.context.flateStream(new Uint8Array(4), { Type: 'XObject', Subtype: 'Image', Width: 2, Height: 2, ColorSpace: 'DeviceGray', BitsPerComponent: 8 } as never));
          const charProc = doc.context.register(doc.context.flateStream(proc));
          const t3 = doc.context.obj({ Type: 'Font', Subtype: 'Type3', FontBBox: [0, 0, 1000, 1000], FontMatrix: [0.001, 0, 0, 0.001, 0, 0], CharProcs: { a: charProc }, Encoding: { Type: 'Encoding', Differences: [97, PDFName.of('a')] }, FirstChar: 97, LastChar: 97, Widths: [1000], Resources: { XObject: { Pic: picture } } } as never);
          doc.context.lookup(pages[1], PDFDict).set(PDFName.of('Resources'), doc.context.obj({ Font: { T3: t3 } } as never));
        },
      });
    const picture = await pageDrawings(await make('1000 0 d0 q 1000 0 0 300 0 0 cm /Pic Do Q'), [1]);
    expect(picture.map((d) => [d.kind, d.unreadable])).toEqual([['glyph', 'type3']]);
    const bitmap = await pageDrawings(await make('1000 0 0 0 1000 1000 d1 q 1000 0 0 1000 0 0 cm BI /W 2 /H 2 /IM true /BPC 1 ID xx EI Q'), [1]);
    expect(bitmap).toEqual([]);
  });
});

// ---- fix wave 3 (T-052): what the second adversarial re-test (redact-retest-2.md) got past ---------------

describe('fix wave 3, findings 4 to 8: the pdf-lib reader as the second net (Ruling A keeps it; rulings B and 2)', () => {
  const RTP: CheckTarget = { kind: 'pan', forms: [QW], wholeWord: false };
  const holds = drawingPass([RTP, NAME]);
  const helv = (doc: PDFDocument) => doc.context.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica', Encoding: 'WinAnsiEncoding' });
  const GLYPHS = ['Q', 'W', 'X', 'P', 'T', 'four', 'eight', 'two', 'one', 'K'];
  /** The re-tester's coded font (codedFont 'names'): codes a to j, glyph names that say the PAN, no character map. */
  const coded = (doc: PDFDocument) => doc.context.register(doc.context.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica', Encoding: { Type: 'Encoding', BaseEncoding: 'WinAnsiEncoding', Differences: [0x61, ...GLYPHS.map((n) => PDFName.of(n))] } } as never));
  const CODED = '(abcdefghij)';
  const formOf = (doc: PDFDocument, content: string, resources: Record<string, unknown> | undefined, bbox = [0, 0, 200, 50]) =>
    doc.context.register(doc.context.flateStream(content, { Type: 'XObject', Subtype: 'Form', BBox: bbox, ...(resources ? { Resources: resources } : {}) } as never));
  const stampFile = (make: (doc: PDFDocument) => PDFRef) => pdfWith({}, withAnnotations((doc) => [{ Subtype: 'Stamp', Rect: [100, 500, 300, 550], AP: { N: make(doc) } }]));
  const pageFile = (content: string, resources: (doc: PDFDocument) => Record<string, unknown>) =>
    pdfWith({ 1: content }, { edit: ({ doc, pages }) => doc.context.lookup(pages[1], PDFDict).set(PDFName.of('Resources'), doc.context.obj({ Font: { F1: helv(doc) }, ...resources(doc) } as never)) });
  const summary = (drawings: readonly PageDrawing[]) => drawings.map((d) => ({ kind: d.kind, holds: holds(d) !== null, unreadable: d.unreadable }));
  const type3 = (doc: PDFDocument, proc: string, encoding: unknown, resources: Record<string, unknown>) =>
    doc.context.obj({ Type: 'Font', Subtype: 'Type3', FontBBox: [0, 0, 1000, 1000], FontMatrix: [0.001, 0, 0, 0.001, 0, 0], CharProcs: { a: doc.context.register(doc.context.flateStream(proc)) }, Encoding: encoding, FirstChar: 97, LastChar: 97, Widths: [1000], Resources: resources } as never);

  it("finding 4: an inline image ending in EI with no space before it does not hide the rest of the stamp (the re-tester's N1a, N1d)", async () => {
    const plain = await stampFile((doc) => formOf(doc, `0 0 1 RG 1 1 198 48 re S q 4 0 0 4 2 2 cm BI /W 2 /H 1 /BPC 8 /CS /G ID AAEI Q BT /F1 9 Tf 6 20 Td (PAN ) Tj (QWXPT) Tj (4821K) Tj ET`, { Font: { F1: helv(doc) } }));
    expect(summary(await pageDrawings(plain, [1]))).toEqual([{ kind: 'appearance', holds: true, unreadable: undefined }]);
    const inCode = await stampFile((doc) => formOf(doc, `q 4 0 0 4 2 2 cm BI /W 2 /H 1 /BPC 8 /CS /G ID AAEI Q BT /FD 9 Tf 6 20 Td ${CODED} Tj ET`, { Font: { F1: helv(doc), FD: coded(doc) } }));
    expect(summary(await pageDrawings(inCode, [1]))).toEqual([{ kind: 'appearance', holds: true, unreadable: undefined }]);
  });

  it('finding 4, my variations: an "EI" inside the data is not its end; no end at all is unreadable, never empty', async () => {
    const inside = await stampFile((doc) => formOf(doc, `q BI /W 4 /H 1 /BPC 8 /CS /G ID AEI ${ch(1)}${ch(2)}${ch(3)}B EI Q BT /F1 9 Tf 6 20 Td (PAN ${QW}) Tj ET q BI /W 2 /H 1 /BPC 8 /CS /G ID AEI xyz EI Q`, { Font: { F1: helv(doc) } }));
    expect(summary(await pageDrawings(inside, [1]))).toEqual([{ kind: 'appearance', holds: true, unreadable: undefined }]);
    const endless = await stampFile((doc) => formOf(doc, `q BI /W 2 /H 1 /BPC 8 /CS /G ID AAQ BT /F1 9 Tf 6 20 Td (PAN ${QW}) Tj ET`, { Font: { F1: helv(doc) } }));
    const drawings = await pageDrawings(endless, [1]);
    expect(summary(drawings)).toEqual([{ kind: 'appearance', holds: false, unreadable: 'parse' }]);
    expect(readerGaveUp(drawings[0])).toBe(true);
  });

  it("finding 5: a font set by a graphics state, or inherited by a form, is the font read (the re-tester's N2, N3)", async () => {
    const byState = await stampFile((doc) => formOf(doc, `0 0 1 RG 1 1 198 48 re S BT /F1 9 Tf 6 30 Td (VERIFIED) Tj /GS1 gs 0 -12 Td ${CODED} Tj ET`, { Font: { F1: helv(doc) }, ExtGState: { GS1: { Type: 'ExtGState', Font: [coded(doc), 9] } } }));
    expect(summary(await pageDrawings(byState, [1]))).toEqual([{ kind: 'appearance', holds: true, unreadable: undefined }]);
    const inherited = await stampFile((doc) => {
      const inner = formOf(doc, `BT 6 18 Td ${CODED} Tj ET`, undefined);
      return formOf(doc, `0 0 1 RG 1 1 198 48 re S BT /F1 9 Tf 6 34 Td (VERIFIED) Tj ET BT /FD 9 Tf ET /Fm1 Do`, { Font: { F1: helv(doc), FD: coded(doc) }, XObject: { Fm1: inner } });
    });
    expect(summary(await pageDrawings(inherited, [1]))).toEqual([{ kind: 'appearance', holds: true, unreadable: undefined }]);
  });

  it('finding 5, my variations: text shown with no font is unreadable (never plain letters); a font inherited through two forms', async () => {
    const none = await stampFile((doc) => formOf(doc, `BT 6 18 Td (PAN ${QW}) Tj ET`, undefined));
    const drawings = await pageDrawings(none, [1]);
    expect(summary(drawings)).toEqual([{ kind: 'appearance', holds: false, unreadable: 'font' }]);
    expect(readerGaveUp(drawings[0])).toBe(true);
    const twice = await stampFile((doc) => {
      const innermost = formOf(doc, `BT 6 18 Td ${CODED} Tj ET`, undefined);
      const middle = formOf(doc, '/Fm2 Do', { XObject: { Fm2: innermost } });
      return formOf(doc, 'BT /FD 9 Tf ET /Fm1 Do', { Font: { FD: coded(doc) }, XObject: { Fm1: middle } });
    });
    expect(summary(await pageDrawings(twice, [1]))).toEqual([{ kind: 'appearance', holds: true, unreadable: undefined }]);
  });

  it("finding 6: a Type 3 font whose /Encoding is a name takes its glyph names from it (the re-tester's N11)", async () => {
    const file = await pageFile('BT /T3 100 Tf 60 600 Td (a) Tj ET', (doc) => ({ Font: { T3: doc.context.register(type3(doc, `1000 0 d0 BT /FD 100 Tf 0 300 Td ${CODED} Tj ET`, PDFName.of('WinAnsiEncoding'), { Font: { FD: coded(doc) } })) } }));
    expect(summary(await pageDrawings(file, [1]))).toEqual([{ kind: 'glyph', holds: true, unreadable: undefined }]);
  });

  it('finding 6, my variations: a /BaseEncoding without /Differences; a code whose glyph cannot be named is unreadable', async () => {
    const base = await pageFile('BT /T3 100 Tf 60 600 Td (a) Tj ET', (doc) => ({ Font: { T3: type3(doc, `1000 0 d0 BT /FD 100 Tf 0 300 Td ${CODED} Tj ET`, { Type: 'Encoding', BaseEncoding: 'WinAnsiEncoding' }, { Font: { FD: coded(doc) } }) } }));
    expect(summary(await pageDrawings(base, [1]))).toEqual([{ kind: 'glyph', holds: true, unreadable: undefined }]);
    const unnamed = await pageFile('BT /T3 100 Tf 60 600 Td <C8> Tj ET', (doc) => ({ Font: { T3: type3(doc, `1000 0 d0 BT /FD 100 Tf 0 300 Td ${CODED} Tj ET`, PDFName.of('WinAnsiEncoding'), { Font: { FD: coded(doc) } }) } }));
    const drawings = await pageDrawings(unnamed, [1]);
    expect(summary(drawings)).toEqual([{ kind: 'glyph', holds: false, unreadable: 'type3' }]);
    expect(readerGaveUp(drawings[0])).toBe(true);
  });

  it("finding 7: a soft mask's group that writes the value is a drawing (the re-tester's N5)", async () => {
    const file = await pageFile('q /GM gs 0 g 50 590 300 30 re f Q', (doc) => {
      const group = formOf(doc, `0 g 0 0 595 842 re f 1 g BT /FD 14 Tf 60 600 Td ${CODED} Tj ET`, { Font: { FD: coded(doc) } }, [0, 0, 595, 842]);
      return { ExtGState: { GM: { Type: 'ExtGState', SMask: { Type: 'Mask', S: 'Luminosity', G: group } } } };
    });
    expect(summary(await pageDrawings(file, [1]))).toEqual([{ kind: 'form', holds: true, unreadable: undefined }]);
  });

  it('finding 7, my variations: a soft mask set inside a stamp is read with it; /SMask /None draws nothing', async () => {
    const inStamp = await stampFile((doc) => {
      const group = formOf(doc, `0 g 0 0 200 50 re f 1 g BT /FD 9 Tf 6 20 Td ${CODED} Tj ET`, { Font: { FD: coded(doc) } });
      return formOf(doc, 'q /GM gs 0 g 0 0 200 50 re f Q', { ExtGState: { GM: { Type: 'ExtGState', SMask: { Type: 'Mask', S: 'Luminosity', G: group } } } });
    });
    expect(summary(await pageDrawings(inStamp, [1]))).toEqual([{ kind: 'appearance', holds: true, unreadable: undefined }]);
    const none = await pageFile('q /GN gs 0 g 50 590 300 30 re f Q', () => ({ ExtGState: { GN: { Type: 'ExtGState', SMask: 'None' } } }));
    expect(await pageDrawings(none, [1])).toEqual([]);
  });

  it("finding 8: what the reader gives up on says so, so a copied page is rebuilt (the re-tester's N6, N9b)", async () => {
    const deep = await stampFile((doc) => {
      let inner = formOf(doc, `BT /FD 9 Tf 6 18 Td ${CODED} Tj ET`, { Font: { FD: coded(doc) } });
      for (let k = 0; k < 34; k++) inner = formOf(doc, '/Fm Do', { XObject: { Fm: inner } });
      return inner;
    });
    const drawings = await pageDrawings(deep, [1]);
    expect(summary(drawings)).toEqual([{ kind: 'appearance', holds: false, unreadable: 'depth' }]);
    expect(readerGaveUp(drawings[0])).toBe(true);
    // A Type 3 font written directly in the page's resources (no object of its own): read, and it holds the PAN.
    const direct = await pageFile('BT /T3 100 Tf 60 600 Td (a) Tj ET', (doc) => ({ Font: { T3: type3(doc, `1000 0 d0 BT /FD 100 Tf 0 300 Td ${CODED} Tj ET`, { Type: 'Encoding', Differences: [97, PDFName.of('a')] }, { Font: { FD: coded(doc) } }) } }));
    expect(summary(await pageDrawings(direct, [1]))).toEqual([{ kind: 'glyph', holds: true, unreadable: undefined }]);
  });

  it('finding 8: page text in a font of its own with no usable map (symbol bullets) is the one unreadable drawing the reader does not give up on', async () => {
    const bullets = await pageFile('BT /FS 10 Tf 60 600 Td <B7> Tj 0 -14 Td <B7> Tj ET BT /F1 10 Tf 75 600 Td (First point) Tj ET', (doc) => ({
      Font: { F1: helv(doc), FS: doc.context.obj({ Type: 'Font', Subtype: 'TrueType', BaseFont: 'SymbolMT', FontDescriptor: { Type: 'FontDescriptor', Flags: 4, FontName: 'SymbolMT' } } as never) },
    }));
    const drawings = await pageDrawings(bullets, [1]);
    expect(summary(drawings)).toEqual([{ kind: 'content', holds: false, unreadable: 'font' }]);
    expect(readerGaveUp(drawings[0])).toBe(false);
    // Page text shown with no font at all is not like the bullets: the reader gives up on it.
    const noFont = await pageFile(`BT 60 600 Td (PAN ${QW}) Tj ET`, () => ({}));
    const shown = await pageDrawings(noFont, [1]);
    expect(summary(shown)).toEqual([{ kind: 'content', holds: false, unreadable: 'font' }]);
    expect(readerGaveUp(shown[0])).toBe(true);
  });
});

describe("fix wave 3, Ruling C: a rebuilt page's text layer is read by position too (redact-retest-2 finding 1)", () => {
  const word = (text: string, x: number, y: number) => ({ text, transform: [10, 0, 0, 10, x, y] as [number, number, number, number, number, number], width: text.length * 5.5 });
  const layered = async (words: ReturnType<typeof word>[]) =>
    buildRedacted(await pdfWith({}, { count: 1 }), [{ pageIndex: 0, picture: greyPicture(), words, ...AWAY }], { titleHasValue: () => false });

  it('finds a name wrapped in a table cell whose layer runs across the row, and boxes the name only', async () => {
    const result = await layered([word('Ramesh', 56, 738), word('Kumar', 92, 738), word(QW, 190, 738), word('12,40,000.00', 330, 738), word('Gupta', 56, 724), word('Devi', 56, 706), word('Rao', 80, 706), word('BNZPM2501F', 190, 706), word('9,10,000.00', 330, 706)]);
    const hits = await checkHits(result.bytes, [NAME], new Set([0]));
    expect(hits).toHaveLength(1);
    expect(hits[0].boxes?.map((b) => Math.round(b.rect.x0))).toEqual([56, 92, 56]);
  });

  it('my variations: a word broken by a hyphen at a line end; nothing joined across two columns', async () => {
    const broken = await layered([word('received', 60, 700), word('from', 110, 700), word('Ramesh', 140, 700), word('Ku-', 180, 700), word('mar', 60, 686), word('Gupta', 85, 686), word('today', 120, 686)]);
    const hits = await checkHits(broken.bytes, [NAME], new Set([0]));
    expect(hits.map((h) => h.boxes?.length)).toEqual([4]);
    // Column 1 ends "Ramesh"; column 2 starts "Kumar Gupta" on the next line: two columns, not one name.
    const columns = await layered([word('The', 50, 760), word('loan', 80, 760), word('of', 220, 760), word('the', 240, 760), word('paid', 50, 747), word('Ramesh', 80, 747), word('bank', 220, 747), word('was', 250, 747), word('on', 50, 734), word('time', 70, 734), word('Kumar', 220, 734), word('Gupta', 260, 734)]);
    expect(await checkHits(columns.bytes, [NAME], new Set([0]))).toEqual([]);
  });
});

describe('fix wave 3, Ruling D: an image is searched for the value, not read as text, and never in one long stretch (redact-retest-2 finding 2)', () => {
  const imageFile = (data: Uint8Array, dict: Record<string, unknown>) =>
    pdfWith({ 1: 'q 100 0 0 100 50 50 cm /Im9 Do Q' }, {
      edit: ({ doc, pages }) => {
        const image = doc.context.register(doc.context.stream(data, { Type: 'XObject', Subtype: 'Image', Width: 1, Height: 1, ColorSpace: 'DeviceGray', BitsPerComponent: 8, ...dict } as never));
        doc.context.lookup(pages[1], PDFDict).set(PDFName.of('Resources'), doc.context.obj({ XObject: { Im9: image } }));
      },
    });
  const segment = (marker: number, body: Buffer) => Buffer.concat([Buffer.from([0xff, marker, (body.length + 2) >> 8, (body.length + 2) & 0xff]), body]);
  const jpeg = (...parts: Buffer[]) => new Uint8Array(Buffer.concat([Buffer.from([0xff, 0xd8]), ...parts]));
  const TARGETS: CheckTarget[] = [{ kind: 'pan', forms: [QW], wholeWord: false }, NAME];

  it('reads the text a JPEG holds by design (EXIF, XMP, a comment, what follows its end) both ways, its picture data for the exact bytes only', async () => {
    const scan = Buffer.concat([Buffer.from([0xff, 0xda, 0x00, 0x08, 1, 1, 0, 0, 0x3f, 0]), Buffer.from(noise(4096).map((b) => (b === 0xff ? 0xfe : b)))]);
    const cases: [string, Uint8Array, boolean][] = [
      ['XMP, the name with other punctuation', jpeg(segment(0xe1, Buffer.from(`http://ns.adobe.com/xap/1.0/${ch(0)}<dc:creator>Ramesh/Kumar/Gupta</dc:creator>`, 'latin1')), scan, Buffer.from([0xff, 0xd9])), true],
      ['EXIF, the PAN spaced', jpeg(segment(0xe1, Buffer.from(`Exif${ch(0)}${ch(0)}Artist Q W X P T 4 8 2 1 K`, 'latin1')), scan, Buffer.from([0xff, 0xd9])), true],
      ['a comment', jpeg(segment(0xfe, Buffer.from('Paid to Ramesh Kumar Gupta', 'latin1')), scan, Buffer.from([0xff, 0xd9])), true],
      ['after the end marker', jpeg(segment(0xe0, Buffer.from(`JFIF${ch(0)}`, 'latin1')), scan, Buffer.from([0xff, 0xd9]), Buffer.from('trailer Ramesh-Kumar-Gupta', 'latin1')), true],
      ['the exact bytes inside the scan data', jpeg(scan, Buffer.from(QW, 'latin1'), Buffer.from([0xff, 0xd9])), true],
      ['the PAN with other punctuation inside the scan data', jpeg(scan.subarray(0, 2000), Buffer.from('Q-W-X-P-T-4-8-2-1-K', 'latin1'), scan.subarray(2000), Buffer.from([0xff, 0xd9])), false],
    ];
    for (const [label, data, found] of cases) {
      const file = await imageFile(data, { Filter: 'DCTDecode' });
      expect((await findTargets(file, TARGETS, NONE)).pages, label).toEqual(found ? [1] : []);
    }
  });

  it("my variations: a Flate image's inflated pixels hold the exact bytes; spaced letters in pixels are not text", async () => {
    const pixels = noise(64 * 1024);
    pixels.set(Buffer.from('Ramesh Kumar Gupta', 'latin1'), 30_000);
    const exact = await imageFile(new Uint8Array(zlib.deflateSync(pixels)), { Filter: 'FlateDecode', Width: 256, Height: 256 });
    expect((await findTargets(exact, TARGETS, NONE)).pages).toEqual([1]);
    const spaced = noise(64 * 1024);
    spaced.set(Buffer.from('R a m e s h / K u m a r / G u p t a', 'latin1'), 30_000);
    const notText = await imageFile(new Uint8Array(zlib.deflateSync(spaced)), { Filter: 'FlateDecode', Width: 256, Height: 256 });
    expect((await findTargets(notText, TARGETS, NONE)).pages).toEqual([]);
  });

  it('the fold made in one call reads as the character-by-character fold: marks inside a word, format characters, letters outside the first plane', () => {
    const acute = ch(0x301);
    const name = targetPass([NAME]);
    expect(name(`Paid to Rame${acute}sh Kumar Gupta`)).not.toBeNull();
    expect(name(`Paid to Ram${ch(0xad)}esh Ku${ch(0x200b)}mar Gupta`)).not.toBeNull();
    // A letter outside the first plane between the words is a letter, so the words are not joined across it.
    expect(name(`Paid to Ramesh${String.fromCodePoint(0x1d400)}Kumar Gupta`)).toBeNull();
    expect(name(`Paid to Ramesh${String.fromCodePoint(0x1f600)}Kumar Gupta`)).not.toBeNull();
  });

  it('a 6 MB scanned page is checked without a stretch of a second between two pauses (it held the thread 21 s)', async () => {
    const pixels = noise(1240 * 1754 * 3);
    const file = await imageFile(new Uint8Array(zlib.deflateSync(pixels, { level: 1 })), { Filter: 'FlateDecode', Width: 1240, Height: 1754, ColorSpace: 'DeviceRGB' });
    // The main thread's CPU time between two pauses (other work on the machine lengthens the wall clock, not this).
    const cpu = (process as unknown as { threadCpuUsage?: (since?: { user: number; system: number }) => { user: number; system: number } }).threadCpuUsage ?? process.cpuUsage;
    let last = cpu();
    let worst = 0;
    const hits = await checkHits(file, TARGETS, NONE, {
      onProgress: async () => {
        const used = cpu(last);
        worst = Math.max(worst, (used.user + used.system) / 1000);
        await new Promise((resolve) => setTimeout(resolve, 0));
        last = cpu();
      },
    });
    expect(hits).toEqual([]);
    // About 0.3 s is the target (measured in the report); the test allows a margin for a slow machine.
    expect(worst).toBeLessThan(1000);
  });
});

// ---- fix wave 4 (T-052): re-test 3, lane T3-A (redact-fix-rules-5.md rulings M, N, O) ----------------------

describe('fix wave 4, rulings N, O and M: letters the reader cannot trust, two inline-image ends, and the copy allow-list', () => {
  const helv = (doc: PDFDocument) => doc.context.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica', Encoding: 'WinAnsiEncoding' });
  const GLYPHS = ['Q', 'W', 'X', 'P', 'T', 'four', 'eight', 'two', 'one', 'K'];
  /** Codes a to j shown with glyph names given by `name` and no map (the re-tester's namedFont / type3Font). */
  const named = (doc: PDFDocument, name: (glyph: string) => string, type3 = false) =>
    doc.context.register(
      doc.context.obj(
        (type3
          ? {
              Type: 'Font', Subtype: 'Type3', FontBBox: [0, 0, 1000, 1000], FontMatrix: [0.001, 0, 0, 0.001, 0, 0],
              CharProcs: Object.fromEntries(GLYPHS.map((g) => [name(g), doc.context.register(doc.context.flateStream('600 0 d0 0 0 m 500 0 l 500 700 l h f'))])),
              Encoding: { Type: 'Encoding', Differences: [0x61, ...GLYPHS.map((g) => PDFName.of(name(g)))] }, FirstChar: 0x61, LastChar: 0x6a, Widths: GLYPHS.map(() => 600),
            }
          : { Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica', Encoding: { Type: 'Encoding', BaseEncoding: 'WinAnsiEncoding', Differences: [0x61, ...GLYPHS.map((g) => PDFName.of(name(g)))] } }) as never,
      ),
    );
  const page2 = (content: string, resources: (doc: PDFDocument) => Record<string, unknown>, more?: (doc: PDFDocument, page: PDFRef) => void) =>
    pdfWith({ 1: content }, {
      edit: ({ doc, pages }) => {
        doc.context.lookup(pages[1], PDFDict).set(PDFName.of('Resources'), doc.context.obj({ Font: { F1: helv(doc) }, ...resources(doc) } as never));
        more?.(doc, pages[1]);
      },
    });
  const verdict = async (file: Uint8Array) => (await pageCopyVerdicts(file, [1]))[0];

  it("ruling N: suffixed glyph names (Q.sc) with no map are letters pdf.js invents: unreadable, and the page is not plain (the re-tester's FT26, FT10)", async () => {
    const t3 = await page2('BT /T3 16 Tf 60 600 Td (abcdefghij) Tj ET', (doc) => ({ Font: { F1: helv(doc), T3: named(doc, (g) => `${g}.sc`, true) } }));
    expect((await pageDrawings(t3, [1])).map((d) => [d.kind, d.unreadable])).toEqual([['content', 'font']]);
    expect(await verdict(t3)).toEqual({ page: 1, plain: false, reasons: ['font', 'type3'] });
    const simple = await page2('BT /FX 16 Tf 60 600 Td (abcdefghij) Tj ET', (doc) => ({ Font: { F1: helv(doc), FX: named(doc, (g) => `${g}.sc`) } }));
    expect((await pageDrawings(simple, [1])).map((d) => [d.kind, d.unreadable])).toEqual([['content', 'font']]);
    expect(await verdict(simple)).toEqual({ page: 1, plain: false, reasons: ['font'] });
  });

  it('ruling N, my variations: standard glyph names with no map are trusted and plain; a stamp in a suffixed font is unreadable', async () => {
    const standard = await page2('BT /FX 16 Tf 60 600 Td (abcdefghij) Tj ET', (doc) => ({ Font: { F1: helv(doc), FX: named(doc, (g) => g) } }));
    expect(await pageDrawings(standard, [1])).toEqual([]);
    expect(await verdict(standard)).toEqual({ page: 1, plain: true, reasons: [] });
    const stamp = await pdfWith({}, withAnnotations((doc) => [{ Subtype: 'Stamp', Rect: [100, 500, 300, 550], AP: { N: doc.context.register(doc.context.flateStream('BT /FX 9 Tf 6 20 Td (abcdefghij) Tj ET', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 200, 50], Resources: { Font: { FX: named(doc, (g) => `${g}.alt`) } } } as never)) } }]));
    expect((await pageDrawings(stamp, [1])).map((d) => [d.kind, d.unreadable])).toEqual([['appearance', 'font']]);
  });

  it("ruling O: an inline image whose first EI is followed by NUL (the re-tester's DM01d): what follows its data length is read too", async () => {
    const nul = ch(0);
    const file = await page2(`q BI /W 2 /H 1 /BPC 8 /CS /G ID ${nul}${nul}EI${nul} q /Fm Do Q EI Q`, (doc) => ({
      XObject: { Fm: doc.context.register(doc.context.flateStream(`BT /F1 16 Tf 60 600 Td (PAN ${QW}) Tj ET`, { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 595, 842], Resources: { Font: { F1: helv(doc) } } } as never)) },
    }));
    const drawings = await pageDrawings(file, [1]);
    expect(drawings.map((d) => [d.kind, d.text?.joined])).toEqual([['form', `PAN ${QW}`]]);
    expect(await verdict(file)).toEqual({ page: 1, plain: false, reasons: ['damaged', 'inline-image'] });
  });

  it("ruling O: the split PAN as page text in the second continuation (the re-tester's DM01d exactly) is a drawing that holds it", async () => {
    const nul = ch(0);
    const file = await page2(`q BI /W 2 /H 1 /BPC 8 /CS /G ID ${nul}${nul}EI${nul} BT /F1 16 Tf 60 600 Td (QWXPT) Tj (4821K) Tj ET EI Q`, () => ({}));
    const drawings = await pageDrawings(file, [1]);
    expect(drawings.map((d) => [d.kind, d.text?.joined])).toEqual([['content', QW]]);
    expect(drawingPass([QW_PAN])(drawings[0])).not.toBeNull();
    expect(await verdict(file)).toEqual({ page: 1, plain: false, reasons: ['damaged', 'inline-image'] });
  });

  it('ruling O, my variations: an inline image both rules end alike is not ambiguous; a filtered one has no data length', async () => {
    const plainEnd = await page2('q BI /W 2 /H 1 /BPC 8 /CS /G ID AB EI Q BT /F1 11 Tf 60 600 Td (Ordinary words) Tj ET', () => ({}));
    expect(await pageDrawings(plainEnd, [1])).toEqual([]);
    expect(await verdict(plainEnd)).toEqual({ page: 1, plain: false, reasons: ['inline-image'] });
    const filtered = await page2('q BI /W 2 /H 1 /BPC 8 /CS /G /F /AHx ID 4142> EI Q BT /F1 11 Tf 60 600 Td (Ordinary words) Tj ET', () => ({}));
    expect(await verdict(filtered)).toEqual({ page: 1, plain: false, reasons: ['inline-image'] });
  });

  it('ruling M: an ordinary page is plain; each item off the allow-list makes it not plain, with its reason', async () => {
    expect(await verdict(await page2('BT /F1 11 Tf 60 600 Td (Ordinary words of a ledger) Tj ET', () => ({})))).toEqual({ page: 1, plain: true, reasons: [] });
    const link = (doc: PDFDocument, page: PDFRef) => doc.context.lookup(page, PDFDict).set(PDFName.of('Annots'), doc.context.obj([doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Square', P: page, Rect: [60, 500, 200, 520] } as never))]));
    // An OCR layer leaves 3 Tr set at the end of the content: with an annotation on the page, not plain (T3-A's B5).
    const ocr = 'BT /F1 11 Tf 60 600 Td (Ordinary words) Tj ET BT 3 Tr /F1 9 Tf 60 400 Td (scanned page text layer) Tj ET';
    expect(await verdict(await page2(ocr, () => ({}), link))).toEqual({ page: 1, plain: false, reasons: ['text-state'] });
    expect(await verdict(await page2(ocr, () => ({})))).toEqual({ page: 1, plain: true, reasons: [] });
    // Restored by Q, or set back to its default, the state is not left odd; Tz and Ts left set are.
    expect(await verdict(await page2(`q ${ocr} Q`, () => ({}), link))).toEqual({ page: 1, plain: true, reasons: [] });
    expect(await verdict(await page2(`${ocr} BT 0 Tr ET`, () => ({}), link))).toEqual({ page: 1, plain: true, reasons: [] });
    expect(await verdict(await page2('BT 80 Tz /F1 11 Tf 60 600 Td (Narrow words) Tj ET', () => ({}), link))).toEqual({ page: 1, plain: false, reasons: ['text-state'] });
    expect(await verdict(await page2('BT 4 Ts /F1 11 Tf 60 600 Td (Raised words) Tj ET', () => ({}), link))).toEqual({ page: 1, plain: false, reasons: ['text-state'] });
    expect(await verdict(await page2('BT /F1 -16 Tf -1 0 0 -1 300 600 Tm (Mirrored words) Tj ET', () => ({})))).toEqual({ page: 1, plain: false, reasons: ['font-size'] });
    expect(await verdict(await page2('BT /F1 11 Tf 60 600 Td (Text in) Tj /F7 11 Tf (a missing font) Tj ET', () => ({})))).toEqual({ page: 1, plain: false, reasons: ['font', 'gave-up'] });
  });

  it('ruling M, my variations: damaged content and a drawing the reader gives up on; every page of a file at once', async () => {
    const damaged = await pdfWith({}, {
      edit: ({ doc, pages }) => {
        doc.context.lookup(pages[1], PDFDict).set(PDFName.of('Contents'), doc.context.register(doc.context.stream(zlib.deflateSync(Buffer.from('BT /F1 11 Tf 60 600 Td (Words) Tj ET')), { Filter: 'Fl' } as never)));
      },
    });
    expect(await verdict(damaged)).toEqual({ page: 1, plain: false, reasons: ['damaged', 'gave-up'] });
    const deep = await pdfWith({}, withAnnotations((doc) => {
      let inner = doc.context.register(doc.context.flateStream('BT /F1 9 Tf 6 18 Td (Deep words) Tj ET', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 200, 50], Resources: { Font: { F1: helv(doc) } } } as never));
      for (let k = 0; k < 34; k++) inner = doc.context.register(doc.context.flateStream('/Fm Do', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 200, 50], Resources: { XObject: { Fm: inner } } } as never));
      return [{ Subtype: 'Stamp', Rect: [100, 500, 300, 550], AP: { N: inner } }];
    }));
    expect((await pageCopyVerdicts(deep, [0, 1, 2])).map((v) => [v.page, v.plain, v.reasons])).toEqual([
      [0, true, []],
      [1, false, ['gave-up']],
      [2, true, []],
    ]);
    // Read once for both: the same drawings as pageDrawings, the same verdicts as pageCopyVerdicts.
    const both = await pageDrawingsAndVerdicts(deep, [0, 1, 2]);
    expect(both.drawings).toEqual(await pageDrawings(deep, [0, 1, 2]));
    expect(both.verdicts).toEqual(await pageCopyVerdicts(deep, [0, 1, 2]));
  });

  // RX-RUN's K1 note: Chrome writes an Indian-script cluster's letters on its first glyph and maps the others to
  // U+0000 (the re-tester's H14, H15: Nirmala UI). Codes: 1 र, 2 U+0000, 3 म, 4 A, 5 the digit 4.
  const clusterFont = (doc: PDFDocument) =>
    doc.context.obj({
      Type: 'Font', Subtype: 'Type0', BaseFont: 'ABCDEF+SampleIndic', Encoding: 'Identity-H',
      DescendantFonts: [doc.context.obj({ Type: 'Font', Subtype: 'CIDFontType2', BaseFont: 'ABCDEF+SampleIndic', CIDSystemInfo: { Registry: PDFString.of('Adobe'), Ordering: PDFString.of('Identity'), Supplement: 0 } } as never)],
      ToUnicode: doc.context.register(doc.context.flateStream('begincmap 1 begincodespacerange <00> <FF> endcodespacerange 5 beginbfchar <01> <0930> <02> <0000> <03> <092E> <04> <0041> <05> <0034> endbfchar endcmap')),
    } as never);
  const inCluster = (shows: string) => page2(`BT /FI 12 Tf 60 600 Td ${shows} ET`, (doc) => ({ Font: { F1: helv(doc), FI: clusterFont(doc) } }));

  it("K1 note: a glyph mapped to U+0000 inside an Indian-script cluster is no letter: the font's other words stay readable (the page is still not plain)", async () => {
    const file = await inCluster('<010203> Tj');
    expect(await pageDrawings(file, [1])).toEqual([]);
    expect(await verdict(file)).toEqual({ page: 1, plain: false, reasons: ['font'] });
  });

  it('K1 note, my variations: beside a Latin letter or a digit, or alone, U+0000 keeps the text unreadable; after an Indian-script string it is a cluster part', async () => {
    for (const shows of ['<040203> Tj', '<050201> Tj', '<02> Tj']) {
      expect((await pageDrawings(await inCluster(shows), [1])).map((d) => [d.kind, d.unreadable])).toEqual([['content', 'font']]);
    }
    expect(await pageDrawings(await inCluster('<0103> Tj <02> Tj'), [1])).toEqual([]);
    expect((await pageDrawings(await inCluster('<0304> Tj <02> Tj'), [1])).map((d) => [d.kind, d.unreadable])).toEqual([['content', 'font']]);
  });
});

// ---- final pass (T-052), F2: the byte reading of a large stream body gives the window turns ------------------------

describe('final pass, F2: a large stream body read byte by byte, in turns', () => {
  /** Text-like bytes (invented words), `size` of them, with no value in them. */
  const wordsOf = (size: number): Uint8Array => {
    const out = new Uint8Array(size);
    let seed = 20261116;
    for (let i = 0; i < size; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      out[i] = seed % 7 === 0 ? 0x20 : 0x61 + (seed % 26);
    }
    return out;
  };
  /**
   * A stream object written twice under one number after the file's end: the reader keeps the later one, so the
   * earlier body is read by the byte reading alone (as a body left behind by an edit is).
   */
  const withBodyLeftBehind = async (body: Uint8Array): Promise<Uint8Array> => {
    const base = Buffer.from(await pdfWith({}));
    const object = (data: Uint8Array) => Buffer.concat([Buffer.from(`\n900 0 obj\n<< /Length ${data.length} >>\nstream\n`, 'latin1'), Buffer.from(data), Buffer.from('\nendstream\nendobj\n', 'latin1')]);
    return new Uint8Array(Buffer.concat([base, object(body), object(Buffer.from('nothing here', 'latin1'))]));
  };
  /** How often the check pauses when every chance of a pause is taken (the clock moves a second at each look). */
  const pauses = async (file: Uint8Array): Promise<{ count: number; hits: Awaited<ReturnType<typeof checkHits>> }> => {
    let at = 0;
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => (at += 1000));
    let count = 0;
    try {
      const hits = await checkHits(file, [AQ], NONE, { onProgress: () => void (count += 1) });
      return { count, hits };
    } finally {
      clock.mockRestore();
    }
  };

  it('pauses inside a body of 2 MB, once for each 256 KB of it, not only before it', async () => {
    const small = await pauses(await withBodyLeftBehind(wordsOf(1024)));
    const large = await pauses(await withBodyLeftBehind(wordsOf(2 * 1024 * 1024)));
    expect(small.hits).toEqual([]);
    expect(large.hits).toEqual([]);
    expect(large.count - small.count).toBeGreaterThanOrEqual(8);
  });

  it('finds what it found before: a value in such a body, at its start, across the edge of two slices and at its end; nothing where there is none', async () => {
    const edge = 256 * 1024;
    for (const at of [10, edge - 4, 3 * edge - 9, 2 * 1024 * 1024 - 40]) {
      const body = wordsOf(2 * 1024 * 1024);
      body.set(Buffer.from(` ${V.pan} `, 'latin1'), at);
      const hits = await checkHits(await withBodyLeftBehind(body), [AQ], NONE, { onProgress: () => undefined });
      expect(hits.map((h) => [h.part, h.pass, h.remedy]), `at ${at}`).toEqual([['bytes', 'strict', 'none']]);
      // The same without a caller that paces (no pause is taken at all).
      expect((await checkHits(await withBodyLeftBehind(body), [AQ], NONE)).map((h) => h.part), `at ${at}, at once`).toEqual(['bytes']);
    }
    expect(await checkHits(await withBodyLeftBehind(wordsOf(2 * 1024 * 1024)), [AQ], NONE, { onProgress: () => undefined })).toEqual([]);
  });
});
