// The Redact run step (design 5.9; plan Task A9), end to end in Node: the real find, review, drawing,
// build and check, with pdf.js's Node canvas standing in for the application's renderer. Every claim of
// removal is checked on the result's bytes (rawHaystack: every stream inflated), with the check itself
// (findTargets), and with pdf.js reading the result.
import { PDFDocument, PDFHexString, PDFName, PDFString, StandardFonts, type PDFFont, type PDFObject, type PDFPage } from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildActivityEntry } from '@/lib/pdf-tools/activity';
import { inspectPdf } from '@/lib/pdf-tools/inspect';
import { findTargets } from '@/lib/pdf-tools/redactCheck';
import { rawHaystack } from '@/lib/pdf-tools/testLeakPdf';
import { AADHAAR, EMAIL, GSTIN, HIDDEN_PAN, lit, makePositionsPdf, OUTSIDE_PAN, PAN, PAN2, WHITE_PAN } from '@/lib/pdf-tools/testRedactPdf';
import { createWorkingListStore, LIST_MAX_BYTES, LIST_WARN_BYTES } from '@/lib/pdf-tools/workingList';
import { PdfToolsError, type WorkingFile } from '@/lib/pdf-tools/types';
import { RenderTimeoutError } from '../renderQueue';
import { Cancelled, Run, Stale, type RunContext, type StepDeps } from '../toolStep';
import { findInFile } from './redactFindRun';
import { DEFAULT_CHOICES, runOptionsFrom, type RedactChoices } from './redactChoices';
import { BUILT, judgeWithSpansInTurns, makeStep, silenceWatch, spansInTurns, spansOf, type RedactRunOptions } from './redactRun';
import { initialReview, reviewReducer, type ReviewState } from './reviewState';
import { inkLeft, nodeEnv, type NodeEnv } from './testRedactRun';

vi.setConfig({ testTimeout: 240_000 });

let env: NodeEnv;
let positions: Uint8Array;
beforeAll(async () => {
  env = await nodeEnv();
  positions = (await makePositionsPdf()).bytes;
}, 120_000);
afterAll(async () => {
  await env?.close();
});

let seq = 0;
const pdf = (name: string, bytes: Uint8Array, pageCount: number, extra: Partial<WorkingFile> = {}): WorkingFile => ({
  id: `in-${++seq}`,
  name,
  kind: 'pdf',
  mimeType: 'application/pdf',
  origin: 'computer',
  bytes,
  size: bytes.byteLength,
  pageCount,
  wasProtected: false,
  hasRestrictions: false,
  hasSignature: false,
  sentTo: [],
  ...extra,
});

function harness() {
  const store = createWorkingListStore();
  store.setContext('u1:A');
  const controller = new AbortController();
  const progress = vi.fn();
  const ctx: RunContext = { contextKey: 'u1:A', session: store.getState().session, store, signal: controller.signal, onProgress: progress };
  const deps: StepDeps = { inspectPdf, paint: async () => undefined, yieldToUi: async () => undefined, newId: () => `id-${++seq}`, maxBytes: LIST_MAX_BYTES, warnBytes: LIST_WARN_BYTES };
  return { store, controller, progress, run: new Run('redact', ctx, deps) };
}

/** The dialog's path, without the screen: find, review (Balanced, then `change`), options. */
async function reviewed(file: WorkingFile, change: (s: ReviewState) => ReviewState = (s) => s, choices: Partial<RedactChoices> = {}, terms: { text: string; reason: string }[] = []) {
  const found = await findInFile(file.bytes, { reader: env.renderer, signal: new AbortController().signal, live: () => true, onProgress: () => undefined, terms, measure: env.measure });
  let state = reviewReducer(initialReview('balanced'), { type: 'loaded', proposals: found.proposals, held: found.held });
  for (const term of terms) state = reviewReducer(state, { type: 'add-term', term });
  state = change(state);
  return { found, state, options: runOptionsFrom(state, found, { ...DEFAULT_CHOICES, ...choices }, file.id) };
}

async function pdfjsTexts(bytes: Uint8Array): Promise<string[]> {
  const { openPdfjs } = await import('@/lib/pdf-tools/testRedactPdf');
  const doc = await openPdfjs(bytes);
  try {
    const out: string[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const content = await (await doc.getPage(n)).getTextContent();
      out.push(content.items.map((i) => ('str' in i ? i.str : '')).join(' '));
    }
    return out;
  } finally {
    await doc.destroy();
  }
}

/** A text file with values on pages 1 and 3 and none on page 2. */
async function lettersPdf(values: { pan: string; extra?: string } = { pan: PAN }): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const lines = [
    [`PAN of the assessee: ${values.pan}`, `Contact ${EMAIL} for the notice`, `Aadhaar ${AADHAAR.slice(0, 4)} ${AADHAAR.slice(4, 8)} ${AADHAAR.slice(8)} linked`, values.extra ?? 'Ordinary words stay searchable'],
    ['Page two has ordinary text only', 'Revenue from operations 1,25,000'],
    [`Again the PAN ${values.pan} on the last page`, 'Closing remarks of the auditor'],
  ];
  for (const page of lines) {
    const p = doc.addPage([595, 842]);
    page.forEach((line, i) => p.drawText(line, { x: 60, y: 780 - i * 24, size: 11, font }));
  }
  return doc.save({ useObjectStreams: false });
}

describe('the Redact run', () => {
  it('is switched on', () => {
    expect(BUILT).toBe(true);
  });

  it('removes every ticked value from the bytes, the check and pdf.js; keeps the rest searchable; names the result _redacted', async () => {
    const source = pdf('Positions.pdf', positions, 5);
    const { options } = await reviewed(source);
    expect(options.areas.length).toBeGreaterThan(0);
    const { run } = harness();
    const made = await makeStep(env)(run, [source], options);
    const [file] = made.files;
    expect(file.name).toBe('Positions_redacted.pdf');
    expect(file.pageCount).toBe(5);
    const raw = rawHaystack(file.bytes);
    for (const value of [PAN, PAN2, GSTIN, HIDDEN_PAN, WHITE_PAN, OUTSIDE_PAN, EMAIL, AADHAAR]) expect(raw.includes(value), value.slice(0, 2)).toBe(false);
    const finding = await findTargets(file.bytes, options.targets, new Set([0, 1, 2, 3, 4]));
    expect(finding).toEqual({ pages: [], elsewhere: [] });
    const texts = await pdfjsTexts(file.bytes);
    for (const text of texts) {
      expect(text).not.toContain(PAN);
      expect(text.replace(/\s/g, '')).not.toContain(PAN);
      expect(text).toContain('assessee:');
    }
    expect(positions.length).toBeGreaterThan(0); // the source bytes are untouched
    expect(source.bytes).toBe(positions);
  });

  it('keeps only the twelve keys in the record and never a value, term, token or replacement in the record or the message', async () => {
    const pan = 'QWXPT4821K';
    const bytes = await lettersPdf({ pan, extra: 'Confidential project Kestrel Orchard here' });
    const source = pdf('Letter.pdf', bytes, 3);
    const { options } = await reviewed(source, (s) => s, { mode: 'replace', style: 'token', token: 'NOTE' }, [{ text: 'Kestrel Orchard', reason: 'Project QWXPT' }]);
    const { run } = harness();
    const made = await makeStep(env)(run, [source], options);
    const [file] = made.files;
    const entry = buildActivityEntry({ file, destination: 'computer', sha256: 'a'.repeat(64) });
    const keys = Object.keys((entry.metadata as { options: Record<string, unknown> }).options).sort();
    expect(keys).toEqual(['areas', 'autoBoxesDropped', 'bookmarksRemoved', 'counts', 'dpi', 'mode', 'output', 'pagesRebuilt', 'pagesRebuiltHidden', 'replacement', 'textLayerCharsOmitted', 'valuesLeftVisible']);
    expect((entry.metadata as { options: Record<string, unknown> }).options.replacement).toBe('token-custom');
    const said = JSON.stringify([entry, file.operation, made.describe(made.files)]);
    for (const secret of [pan, EMAIL, AADHAAR, 'Kestrel', 'Orchard', 'NOTE', 'QWXPT']) expect(said.includes(secret), secret.slice(0, 2)).toBe(false);
    expect(rawHaystack(file.bytes).includes('Kestrel')).toBe(false);
    expect(rawHaystack(file.bytes).includes(pan)).toBe(false);
  });

  it('property: no generated value, term or replacement longer than 3 characters reaches the record, the message or an error', async () => {
    let seed = 11;
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) >>> 0;
      return seed % n;
    };
    const L = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    for (let round = 0; round < 3; round++) {
      const pan = `${L[rnd(24)]}${L[rnd(24)]}${L[rnd(24)]}P${L[rnd(24)]}${1000 + rnd(9000)}${L[rnd(24)]}`;
      const term = `Zeta${rnd(1000)} Quill`;
      const token = `Hid ${rnd(1000)}`;
      const bytes = await lettersPdf({ pan, extra: `Memo ${term} attached` });
      const source = pdf('Memo.pdf', bytes, 3);
      const { options } = await reviewed(source, (s) => s, { mode: 'replace', style: round === 0 ? 'masked' : 'token', token }, [{ text: term, reason: 'Typed' }]);
      const { run } = harness();
      const made = await makeStep(env)(run, [source], options);
      const said = JSON.stringify([buildActivityEntry({ file: made.files[0], destination: 'computer', sha256: 'b'.repeat(64) }), made.files[0].operation, made.describe(made.files)]);
      const secrets = [pan, pan.slice(-4), term, token, EMAIL, AADHAAR].filter((s) => s.length > 3);
      for (const s of secrets) expect(said.includes(s), `round ${round}`).toBe(false);
      // A failing run says nothing either: a target the document properties hold ("ICAI VERA") cannot be boxed.
      const failing = await makeStep(env)(harness().run, [source], { ...options, targets: [...options.targets, { kind: 'typed', forms: ['ICAI VERA'], wholeWord: true }] }).catch((e: unknown) => e);
      expect(failing).toBeInstanceOf(PdfToolsError);
      for (const s of secrets) expect((failing as Error).message.includes(s)).toBe(false);
    }
  });

  it('a value only in a marked-content tag on a copied page cannot be boxed: not verified without a way to ask, nothing added', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const p1 = doc.addPage([595, 842]);
    p1.drawText(`PAN of the assessee: ${PAN}`, { x: 60, y: 780, size: 11, font });
    const p2 = doc.addPage([595, 842]);
    const ctx = doc.context;
    p2.node.set(PDFName.of('Resources'), ctx.obj({ Font: { F1: font.ref } }));
    p2.node.set(PDFName.of('Contents'), ctx.register(ctx.flateStream(`/${PAN} BMC BT /F1 11 Tf 60 780 Td (XXXX) Tj ET EMC`)));
    const bytes = await doc.save({ useObjectStreams: false });
    const source = pdf('Alt.pdf', bytes, 2);
    const { options } = await reviewed(source);
    const { run, store } = harness();
    const before = store.getState().files.length;
    const error = await makeStep(env)(run, [source], options).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PdfToolsError);
    expect((error as PdfToolsError).code).toBe('redact-check-failed');
    expect((error as PdfToolsError).message).toMatch(/page 2/);
    expect((error as PdfToolsError).message).toMatch(/Nothing was added/);
    expect((error as PdfToolsError).message).not.toContain(PAN);
    expect(store.getState().files.length).toBe(before);
  });

  it('flattens, on the user\'s confirmation, a copied page whose value is only in a marked-content tag; the result is verified', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    doc.addPage([595, 842]).drawText(`PAN of the assessee: ${PAN}`, { x: 60, y: 780, size: 11, font });
    const p2 = doc.addPage([595, 842]);
    const ctx = doc.context;
    p2.node.set(PDFName.of('Resources'), ctx.obj({ Font: { F1: font.ref } }));
    p2.node.set(PDFName.of('Contents'), ctx.register(ctx.flateStream(`/${PAN} BMC BT /F1 11 Tf 60 780 Td (XXXX visible words) Tj ET EMC`)));
    const source = pdf('Alt.pdf', await doc.save({ useObjectStreams: false }), 2);
    const confirmFlatten = vi.fn(async (_pages: number[]) => true);
    const { options } = await reviewed(source);
    const made = await makeStep(env)(harness().run, [source], { ...options, confirmFlatten });
    expect(confirmFlatten).toHaveBeenCalledTimes(1);
    expect(confirmFlatten.mock.calls[0][0]).toEqual([1]);
    const [file] = made.files;
    expect(rawHaystack(file.bytes).includes(PAN)).toBe(false);
    expect(file.operation?.summary).toMatch(/1 page flattened on the user's confirmation/);
    expect(file.operation?.options?.pagesRebuiltHidden).toBe(1);
    expect(made.describe([file]).detail).toMatch(/Page 2 was flattened, as you confirmed\./);
    // The flattened page keeps its words searchable.
    expect((await pdfjsTexts(file.bytes))[1]).toContain('visible');
  });

  it('a scanned page (no text) with a hand-drawn box: the page becomes a picture, the box is solid black, other pages are untouched', async () => {
    const doc = await PDFDocument.create();
    const ctx = doc.context;
    const zlib = await import('node:zlib');
    // A grey "scan" 200 x 280 px with a dark block where the value would be.
    const pixels = Buffer.alloc(200 * 280, 235);
    for (let y = 40; y < 60; y++) for (let x = 30; x < 120; x++) pixels[y * 200 + x] = 20;
    const image = ctx.register(ctx.stream(zlib.deflateSync(pixels), { Type: 'XObject', Subtype: 'Image', Width: 200, Height: 280, ColorSpace: 'DeviceGray', BitsPerComponent: 8, Filter: 'FlateDecode' } as never));
    const scan = doc.addPage([400, 560]);
    scan.node.set(PDFName.of('Resources'), ctx.obj({ XObject: { Im1: image } }));
    scan.node.set(PDFName.of('Contents'), ctx.register(ctx.flateStream('q 400 0 0 560 0 0 cm /Im1 Do Q')));
    const font = await doc.embedFont(StandardFonts.Helvetica);
    doc.addPage([400, 560]).drawText('A text page that stays as it is', { x: 40, y: 500, size: 11, font });
    const source = pdf('Scan.pdf', await doc.save({ useObjectStreams: false }), 2);
    // The dark block is at x 60-240, y 440-480 in points (pixels 30-120, rows 40-60 of 280 scaled by 2).
    const box = { x0: 56, y0: 436, x1: 244, y1: 484 };
    const { found, options } = await reviewed(source, (s) => reviewReducer(s, { type: 'draw', box: { id: 'd1', page: 0, rect: box } }));
    expect(found.pagesWithoutText).toEqual([0]);
    const made = await makeStep(env)(harness().run, [source], options);
    const [file] = made.files;
    const { openPdfjs, renderPdfjsPage } = await import('@/lib/pdf-tools/testRedactPdf');
    const [after, before] = [await openPdfjs(file.bytes), await openPdfjs(source.bytes)];
    try {
      const page = await renderPdfjsPage(after, 0, 200);
      const inside = page.pixels(page.pixelRect({ x0: box.x0 + 1, y0: box.y0 + 1, x1: box.x1 - 1, y1: box.y1 - 1 }));
      let dark = 0;
      for (let i = 0; i < inside.length; i += 4) if (inside[i] < 40 && inside[i + 1] < 40 && inside[i + 2] < 40) dark++;
      expect(dark / (inside.length / 4)).toBeGreaterThan(0.99);
      // The copied page is drawn exactly as before.
      const a = await renderPdfjsPage(after, 1, 100);
      const b = await renderPdfjsPage(before, 1, 100);
      expect(Buffer.from(a.pixels({ left: 0, top: 0, right: a.width, bottom: a.height })).equals(Buffer.from(b.pixels({ left: 0, top: 0, right: b.width, bottom: b.height })))).toBe(true);
    } finally {
      await after.destroy();
      await before.destroy();
    }
  });

  it('leaves no pixel of a value\'s ink outside its box (fonts, italics, letter-spacing, a monospaced face reported otherwise, an underlined value)', async () => {
    const { makeInkPdfs, openPdfjs, renderPdfjsPage } = await import('@/lib/pdf-tools/testRedactPdf');
    const cases = [
      { id: 'Helvetica', content: `BT /F1 10 Tf 72 600 Td (PAN of the assessee: ) Tj {V} (${PAN}) Tj {N} (, dated 01-04-2025) Tj ET` },
      { id: 'Times-Italic', content: `BT /F4 11 Tf 72 600 Td (PAN of the assessee: ) Tj {V} (${PAN}) Tj {N} (, dated 01-04-2025) Tj ET` },
      { id: 'letter-spaced', content: `BT /F1 10 Tf 1.2 Tc 72 600 Td (PAN of the assessee: ) Tj {V} (${PAN}) Tj {N} (, dated 01-04-2025) Tj ET` },
      { id: 'monospaced reported as sans-serif', content: `BT /F5 14 Tf 20 600 Td (MWMWMW WMWMWM MWMWMW WMWMWM PAN holder ) Tj {V} (IIJPL1111J) Tj {N} ( MWMW) Tj ET` },
      { id: 'bold, underlined', content: `BT /F6 10 Tf 72 600 Td (PAN of the assessee: ) Tj {V} (${PAN}) Tj {N} ( underlined) Tj ET 0.8 w 72 597 m 330 597 l S` },
    ];
    const { visible, hidden } = await makeInkPdfs(cases);
    const source = pdf('Ink.pdf', visible, cases.length);
    const { options } = await reviewed(source);
    expect(new Set(options.areas.map((a) => a.page))).toEqual(new Set(cases.map((_, i) => i)));
    const made = await makeStep(env)(harness().run, [source], options);
    const [result, show, hide] = [await openPdfjs(made.files[0].bytes), await openPdfjs(visible), await openPdfjs(hidden)];
    try {
      for (let page = 0; page < cases.length; page++) {
        const [r, a, b] = [await renderPdfjsPage(result, page, 200), await renderPdfjsPage(show, page, 200), await renderPdfjsPage(hide, page, 200)];
        const all = { left: 0, top: 0, right: a.width, bottom: a.height };
        const [R, A, B] = [r.pixels(all), a.pixels(all), b.pixels(all)];
        let ink = 0;
        let shown = 0;
        for (let i = 0; i < A.length; i += 4) {
          if (Math.max(Math.abs(A[i] - B[i]), Math.abs(A[i + 1] - B[i + 1]), Math.abs(A[i + 2] - B[i + 2])) <= 24) continue;
          ink++;
          if (Math.max(R[i], R[i + 1], R[i + 2]) > 60) shown++;
        }
        expect(ink, cases[page].id).toBeGreaterThan(50);
        expect(shown, cases[page].id).toBe(0);
      }
    } finally {
      await Promise.all([result.destroy(), show.destroy(), hide.destroy()]);
    }
  });

  it('a Stop between pages, or a change of engagement, adds nothing and says nothing', async () => {
    const source = pdf('Positions.pdf', positions, 5);
    const { options } = await reviewed(source);
    const stopped = harness();
    const onStop = makeStep({ ...env, renderer: { ...env.renderer, renderPagePixels: async (...a) => (stopped.controller.abort(), env.renderer.renderPagePixels(...a)) } });
    await expect(onStop(stopped.run, [source], options)).rejects.toBeInstanceOf(Cancelled);
    const moved = harness();
    const onMove = makeStep({ ...env, renderer: { ...env.renderer, renderPagePixels: async (...a) => (moved.store.setContext('u1:B'), env.renderer.renderPagePixels(...a)) } });
    await expect(onMove(moved.run, [source], options)).rejects.toBeInstanceOf(Stale);
    expect(moved.store.getState().files).toEqual([]);
  });

  it('refuses another file, nothing chosen, and more than 5,000 ticked places', async () => {
    const source = pdf('Positions.pdf', positions, 5);
    const { options } = await reviewed(source);
    const step = makeStep(env);
    await expect(step(harness().run, [source], { ...options, fileId: 'other' })).rejects.toThrow(/another file/);
    await expect(step(harness().run, [source], { ...options, areas: [] })).rejects.toMatchObject({ code: 'redact-nothing-chosen' });
    await expect(step(harness().run, [source], { ...options, ticked: 5001 })).rejects.toMatchObject({ code: 'redact-too-many' });
    await expect(step(harness().run, [source], { ...options, mode: 'replace', replacement: { style: 'token', token: '' } } as RedactRunOptions)).rejects.toThrow(/1 to 30/);
  });
});

// ---- the end-to-end review's survivors (redact-e2e-review.md, T-048 fix wave) -------------------------------
// Each recipe is built twice: as the reader sees it, and as a twin in which only the value is invisible.
// "left" counts the value's ink still visible in the result at 200 dpi (inkLeft, the review's measure).

const VALUE = 'QWXPT4821K';
const SIGNER = 'Ramesh Kumar Gupta';

interface Build {
  doc: PDFDocument;
  font: PDFFont;
}
async function newDoc(): Promise<Build> {
  const doc = await PDFDocument.create();
  return { doc, font: await doc.embedFont(StandardFonts.Helvetica) };
}
function rawPage(b: Build, content: string, resources: Record<string, PDFObject> = {}): PDFPage {
  const page = b.doc.addPage([595, 842]);
  const ctx = b.doc.context;
  page.node.set(PDFName.of('Resources'), ctx.obj({ Font: { F1: b.font.ref }, ...resources }));
  page.node.set(PDFName.of('Contents'), ctx.register(ctx.flateStream(content)));
  return page;
}
function appearance(b: Build, content: string, bbox: number[]) {
  const ctx = b.doc.context;
  return ctx.register(ctx.flateStream(content, { Type: 'XObject', Subtype: 'Form', BBox: bbox, Resources: { Font: { F1: b.font.ref } } } as never));
}
function addAnnot(b: Build, page: PDFPage, dict: Record<string, unknown>) {
  const ctx = b.doc.context;
  const ref = ctx.register(ctx.obj({ Type: 'Annot', P: page.ref, F: 4, ...dict } as never));
  const annots = page.node.get(PDFName.of('Annots'));
  if (annots) (annots as unknown as { push(o: PDFObject): void }).push(ref);
  else page.node.set(PDFName.of('Annots'), ctx.obj([ref]));
  return ref;
}
const save = (b: Build) => b.doc.save({ useObjectStreams: false });
/** Invisible in the twin: render mode 3 around `s`, back to 0 after it. */
const shown = (hide: boolean, s: string) => (hide ? `3 Tr ${s} 0 Tr` : s);

/** Builds both files, runs Redact on the visible one, and measures what is left of the value on `pages`. */
async function survivors(
  name: string,
  make: (hide: boolean) => Promise<Uint8Array>,
  pages: number[],
  opts: { terms?: { text: string; reason: string }[]; choices?: Partial<RedactChoices>; confirmFlatten?: RedactRunOptions['confirmFlatten'] } = {},
) {
  const [visible, hidden] = [await make(false), await make(true)];
  const count = (await PDFDocument.load(visible)).getPageCount();
  const source = pdf(name, visible, count);
  const { options } = await reviewed(source, (s) => s, opts.choices ?? {}, opts.terms ?? []);
  const made = await makeStep(env)(harness().run, [source], { ...options, ...(opts.confirmFlatten ? { confirmFlatten: opts.confirmFlatten } : {}) });
  const [file] = made.files;
  const left: { page: number; ink: number; left: number }[] = [];
  for (const page of pages) left.push({ page, ...(await inkLeft(env, visible, hidden, file.bytes, page)) });
  return { file, made, left, options };
}

describe("the end-to-end review's recipes (T-048)", () => {
  it('B1: a stamp whose appearance draws the PAN on the redacted page is covered (no pixel of it left)', async () => {
    const { left } = await survivors('Stamp.pdf', async (hide) => {
      const b = await newDoc();
      const page = rawPage(b, `BT /F1 11 Tf 60 780 Td ${lit(`PAN of the assessee: ${VALUE}`)} Tj 0 -20 Td (Ordinary words stay) Tj ET`);
      const ap = appearance(b, `0.8 0 0 RG 1 1 178 38 re S BT /F1 10 Tf ${hide ? '3 Tr ' : ''}6 22 Td (VERIFIED) Tj 0 -13 Td ${lit(`PAN ${VALUE}`)} Tj ET`, [0, 0, 180, 40]);
      addAnnot(b, page, { Subtype: 'Stamp', Rect: [330, 500, 510, 540], AP: b.doc.context.obj({ N: ap }), Name: 'Approved' });
      return save(b);
    }, [0]);
    expect(left[0].ink).toBeGreaterThan(300);
    expect(left[0].left).toBe(0);
  });

  it('B1: a signature appearance drawing the typed name on the redacted page is covered', async () => {
    const { left, file } = await survivors('Signed.pdf', async (hide) => {
      const b = await newDoc();
      const page = rawPage(b, `BT /F1 11 Tf 60 780 Td (For Kestrel and Co, Chartered Accountants) Tj 0 -20 Td ${lit(`${SIGNER}, Partner`)} Tj 0 -20 Td (Membership number is on record) Tj ET`);
      const ap = appearance(b, `BT /F1 9 Tf ${hide ? '3 Tr ' : ''}4 30 Td (Digitally signed by) Tj 0 -11 Td ${lit(SIGNER)} Tj 0 -11 Td (Date: 2026.09.30 17:10:22) Tj ET`, [0, 0, 180, 44]);
      const ctx = b.doc.context;
      const sig = ctx.register(ctx.obj({ Type: 'Sig', Filter: 'Adobe.PPKLite', SubFilter: 'adbe.pkcs7.detached', M: PDFString.of('D:20260930171022') } as never));
      const widget = addAnnot(b, page, { Subtype: 'Widget', FT: 'Sig', T: PDFString.of('Signature1'), Rect: [330, 600, 510, 644], AP: ctx.obj({ N: ap }), V: sig, F: 132 });
      b.doc.catalog.set(PDFName.of('AcroForm'), ctx.obj({ Fields: [widget], SigFlags: 3 }));
      return save(b);
    }, [0], { terms: [{ text: SIGNER, reason: 'Typed' }] });
    expect(left[0].ink).toBeGreaterThan(300);
    expect(left[0].left).toBe(0);
    expect(rawHaystack(file.bytes).includes('Gupta')).toBe(false);
  });

  it('B1: a tiling pattern that draws the PAN on the redacted page is covered where it paints', async () => {
    const { left } = await survivors('Pattern.pdf', async (hide) => {
      const b = await newDoc();
      const ctx = b.doc.context;
      const pattern = ctx.register(ctx.flateStream(`BT /F1 10 Tf ${hide ? '3 Tr ' : ''}2 6 Td ${lit(VALUE)} Tj ET`, { Type: 'Pattern', PatternType: 1, PaintType: 1, TilingType: 1, BBox: [0, 0, 90, 20], XStep: 90, YStep: 20, Resources: { Font: { F1: b.font.ref } } } as never));
      rawPage(b, `BT /F1 11 Tf 60 780 Td ${lit(`PAN of the assessee: ${VALUE}`)} Tj ET /Pattern cs /P1 scn 60 400 180 60 re f`, { Pattern: ctx.obj({ P1: pattern }) });
      return save(b);
    }, [0]);
    expect(left[0].ink).toBeGreaterThan(300);
    expect(left[0].left).toBe(0);
  });

  for (const output of ['picture', 'searchable'] as const) {
    it(`B2: ${output}: a typed name written with hyphens, and a PAN with colons, on the same page are covered as in Searchable`, async () => {
      const name = await survivors(`Hyphen-${output}.pdf`, async (hide) => {
        const b = await newDoc();
        rawPage(b, `BT /F1 11 Tf 60 780 Td ${lit(`Signed by ${SIGNER}, Partner`)} Tj ET BT /F1 11 Tf 60 700 Td (Contact: ) Tj ${shown(hide, `${lit('Ramesh-Kumar-Gupta')} Tj`)} ET BT /F1 11 Tf 60 650 Td (Ordinary closing words) Tj ET`);
        return save(b);
      }, [0], { choices: { output }, terms: [{ text: SIGNER, reason: 'Typed' }] });
      expect(name.left[0].ink).toBeGreaterThan(300);
      expect(name.left[0].left).toBe(0);
      const code = await survivors(`Colons-${output}.pdf`, async (hide) => {
        const b = await newDoc();
        // (The render mode is graphics state: it is set back after the value, or the next line would count as its ink.)
        rawPage(b, `BT /F1 11 Tf 60 780 Td ${lit('PAN of the assessee: BNZPM2501F')} Tj ET BT /F1 11 Tf 60 700 Td ${shown(hide, `${lit('BNZPM::::2501F')} Tj`)} ET BT /F1 11 Tf 60 650 Td (Ordinary closing words) Tj ET`);
        return save(b);
      }, [0], { choices: { output } });
      expect(code.left[0].ink).toBeGreaterThan(300);
      expect(code.left[0].left).toBe(0);
    });
  }

  it('B4: a signed page with the name in its appearance and in the signature dictionary is boxed, never flattened', async () => {
    const confirmFlatten = vi.fn(async () => true);
    const { left, file, made } = await survivors('Signed-report.pdf', async (hide) => {
      const b = await newDoc();
      const ctx = b.doc.context;
      rawPage(b, `BT /F1 11 Tf 60 780 Td (For Kestrel and Co) Tj 0 -20 Td ${lit(`${SIGNER}, Partner`)} Tj ET`);
      const page = rawPage(b, 'BT /F1 11 Tf 60 780 Td (Annexure with ordinary words only) Tj ET');
      const ap = appearance(b, `BT /F1 9 Tf 4 30 Td (Digitally signed by) Tj 0 -11 Td ${shown(hide, `${lit(SIGNER)} Tj`)} 0 -11 Td (Date: 2026.09.30) Tj ET`, [0, 0, 180, 44]);
      const sig = ctx.register(ctx.obj({ Type: 'Sig', Filter: 'Adobe.PPKLite', SubFilter: 'adbe.pkcs7.detached', Name: PDFString.of(SIGNER), Reason: PDFString.of(`Signed by ${SIGNER}`), Location: PDFString.of('Pune'), ContactInfo: PDFString.of(`${SIGNER} 98450 12345`), M: PDFString.of('D:20260930171022'), Contents: PDFHexString.of('3082010013') } as never));
      const widget = addAnnot(b, page, { Subtype: 'Widget', FT: 'Sig', T: PDFString.of('Signature1'), Rect: [330, 600, 510, 644], AP: ctx.obj({ N: ap }), V: sig, F: 132 });
      b.doc.catalog.set(PDFName.of('AcroForm'), ctx.obj({ Fields: [widget], SigFlags: 3 }));
      return save(b);
    }, [0, 1], { terms: [{ text: SIGNER, reason: 'Typed' }], confirmFlatten });
    expect(confirmFlatten).not.toHaveBeenCalled();
    expect(left[1].ink).toBeGreaterThan(300);
    expect(left.map((l) => l.left)).toEqual([0, 0]);
    expect(file.operation?.summary).not.toMatch(/flattened/);
    expect(made.describe([file]).detail).toMatch(/Page 2 also held redacted text/);
    // The pages named first are the user's; the page the check added has its own sentence.
    expect(made.describe([file]).detail).toMatch(/^1 area removed on page 1; that page is now a picture with searchable text\. /);
    expect(rawHaystack(file.bytes).includes('Gupta')).toBe(false);
  });

  it('B5: alternative text over glyphs the reader cannot read: the marked content is boxed where it paints, not flattened', async () => {
    const confirmFlatten = vi.fn(async () => true);
    const { left, file } = await survivors('Tagged.pdf', async (hide) => {
      const b = await newDoc();
      const ctx = b.doc.context;
      rawPage(b, `BT /F1 11 Tf 60 780 Td ${lit(`PAN of the assessee: ${VALUE}`)} Tj ET`);
      const names = ['Q', 'W', 'X', 'P', 'T', 'four', 'eight', 'two', 'one', 'K'];
      const hex = (n: number) => n.toString(16).padStart(2, '0');
      const cmap = `/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CMapName /Adobe-Identity-UCS def /CMapType 2 def 1 begincodespacerange <00> <FF> endcodespacerange 10 beginbfchar ${names.map((_, i) => `<${hex(i + 1)}> <E0${hex(i + 1)}>`).join(' ')} endbfchar endcmap CMapName currentdict /CMap defineresource pop end end`;
      const odd = ctx.register(ctx.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica', Encoding: { Type: 'Encoding', Differences: [1, ...names.map((n) => PDFName.of(n))] }, ToUnicode: ctx.register(ctx.flateStream(cmap)) } as never));
      rawPage(b, `BT /F1 11 Tf 60 780 Td (Second page: ordinary words) Tj ET /Span <</ActualText ${lit(VALUE)}>> BDC BT /F9 11 Tf 60 700 Td ${shown(hide, '<0102030405060708090A> Tj')} ET EMC`, { Font: ctx.obj({ F1: b.font.ref, F9: odd }) });
      return save(b);
    }, [0, 1], { confirmFlatten });
    expect(confirmFlatten).not.toHaveBeenCalled();
    expect(left[1].ink).toBeGreaterThan(300);
    expect(left.map((l) => l.left)).toEqual([0, 0]);
    expect(file.operation?.summary).not.toMatch(/flattened/);
    expect(rawHaystack(file.bytes).includes(VALUE)).toBe(false);
  });

  it('B5: alternative text over a drawing (outlined text): the drawing is boxed', async () => {
    const { left } = await survivors('Outline.pdf', async (hide) => {
      const b = await newDoc();
      rawPage(b, `BT /F1 11 Tf 60 780 Td ${lit(`PAN of the assessee: ${VALUE}`)} Tj ET`);
      rawPage(b, `BT /F1 11 Tf 60 780 Td (Second page: ordinary words) Tj ET /Figure <</Alt ${lit(`Signature of PAN holder ${VALUE}`)}>> BDC ${hide ? '' : '0 0 0 rg 60 700 8 12 re f 72 700 3 12 re f 80 700 8 3 re f 92 700 2 12 re f'} EMC`);
      return save(b);
    }, [1], { confirmFlatten: async () => true });
    expect(left[0].ink).toBeGreaterThan(100);
    expect(left[0].left).toBe(0);
  });

  it('a comment drawn over the whole page whose appearance writes the PAN: boxed where it writes, or the run fails; never a pass with it showing', async () => {
    const make = (border: boolean) => async (hide: boolean) => {
      const b = await newDoc();
      const page = rawPage(b, `BT /F1 11 Tf 60 780 Td ${lit(`PAN of the assessee: ${VALUE}`)} Tj ET`);
      const ap = appearance(b, `${border ? '0 0 1 RG 4 4 587 834 re S ' : ''}BT /F1 12 Tf ${hide ? '3 Tr ' : ''}100 300 Td ${lit(`Reviewed: PAN ${VALUE}`)} Tj ET`, [0, 0, 595, 842]);
      addAnnot(b, page, { Subtype: 'Square', Rect: [0, 0, 595, 842], Contents: PDFString.of(`PAN ${VALUE}`), AP: b.doc.context.obj({ N: ap }) });
      return save(b);
    };
    const { left, file } = await survivors('Whole-page.pdf', make(false), [0]);
    expect(left[0].ink).toBeGreaterThan(300);
    expect(left[0].left).toBe(0);
    // Not by blacking out the page: its other words stay searchable (a word touching the PAN's box goes with it).
    expect((await pdfjsTexts(file.bytes))[0]).toContain('of the');
    // With a frame around the page the drawing cannot be placed: the run fails, nothing is added.
    const framed = await make(true)(false);
    const source = pdf('Whole-page-framed.pdf', framed, 1);
    const { options } = await reviewed(source);
    const error = await makeStep(env)(harness().run, [source], options).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PdfToolsError);
    expect((error as PdfToolsError).code).toBe('redact-check-failed');
    expect((error as PdfToolsError).message).toMatch(/\(page 1\)/);
  });

  it('a page-sized place that reached the review without the find\'s mark (promoted, "everywhere") does not black out the page', async () => {
    const make = async (hide: boolean) => {
      const b = await newDoc();
      const page = rawPage(b, `BT /F1 11 Tf 60 780 Td ${lit(`PAN of the assessee: ${VALUE}`)} Tj ET`);
      const ap = appearance(b, `BT /F1 12 Tf ${hide ? '3 Tr ' : ''}100 300 Td ${lit(`Reviewed: PAN ${VALUE}`)} Tj ET`, [0, 0, 595, 842]);
      addAnnot(b, page, { Subtype: 'Square', Rect: [0, 0, 595, 842], Contents: PDFString.of(`PAN ${VALUE}`), AP: b.doc.context.obj({ N: ap }) });
      return save(b);
    };
    const [visible, hidden] = [await make(false), await make(true)];
    const source = pdf('Promoted.pdf', visible, 1);
    const { options } = await reviewed(source);
    // As a promoted value's other places would arrive: the comment's whole-page place, visible, ticked.
    const areas = [...options.areas.filter((a) => a.ranges.length > 0), { page: 0, rects: [{ x0: 0, y0: 0, x1: 595, y1: 842 }], kind: 'pan' as const, hidden: false, angle: 0, ranges: [] as [number, number][] }];
    const made = await makeStep(env)(harness().run, [source], { ...options, areas });
    const [file] = made.files;
    const { ink, left } = await inkLeft(env, visible, hidden, file.bytes, 0);
    expect(ink).toBeGreaterThan(300);
    expect(left).toBe(0);
    expect((await pdfjsTexts(file.bytes))[0]).toContain('of the');
  });

  it('B6: a file named with the PAN gives "Redacted document.pdf"; no record, name or message holds the value', async () => {
    const b = await newDoc();
    rawPage(b, `BT /F1 11 Tf 60 780 Td ${lit(`PAN of the assessee: ${VALUE}`)} Tj ET`);
    const bytes = await save(b);
    const source = pdf(`Form16_${VALUE}_2025-26.pdf`, bytes, 1);
    const { options } = await reviewed(source);
    for (const name of [undefined, `Copy ${VALUE}.pdf`]) {
      const made = await makeStep(env)(harness().run, [source], { ...options, ...(name ? { name } : {}) });
      const [file] = made.files;
      expect(file.name).toBe('Redacted document.pdf');
      const said = JSON.stringify([file.name, file.operation, made.describe(made.files), buildActivityEntry({ file, destination: 'computer', sha256: 'd'.repeat(64) })]);
      expect(said.includes(VALUE)).toBe(false);
      expect(file.operation?.sources?.[0]?.name).toBe('Original file (name withheld)');
    }
    // A name that holds no value is kept as it is.
    const plainSource = pdf('Form16.pdf', bytes, 1);
    const plain = await makeStep(env)(harness().run, [plainSource], { ...options, fileId: plainSource.id });
    expect(plain.files[0].name).toBe('Form16_redacted.pdf');
    expect(plain.files[0].operation?.sources?.[0]?.name).toBe('Form16.pdf');
  });

  it('a picture the build cannot take ends with the fixed sentence, never a raw RangeError', async () => {
    const source = pdf('Letter.pdf', await lettersPdf(), 3);
    const { options } = await reviewed(source);
    const zlib = await import('node:zlib');
    const broken = makeStep({ ...env, codecs: () => ({ deflate: async (samples: Uint8Array) => new Uint8Array(zlib.deflateSync(samples.subarray(0, samples.length >> 1))) }) });
    const error = await broken(harness().run, [source], options).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PdfToolsError);
    expect((error as PdfToolsError).code).toBe('render-failed');
    expect((error as PdfToolsError).message).toBe('A page could not be drawn for redaction. Nothing was added. Try again; if it fails again, restart the application.');
  });
});

// ---- wave 2: the retest's survivors (redact-retest-1.md R1 to R8; lead ruling: the unit of trust is the drawing) ----

const PLAIN = `BT /F1 11 Tf 60 780 Td ${lit(`PAN of the assessee: ${VALUE}`)} Tj ET`;
const SIGNED = `BT /F1 11 Tf 60 740 Td ${lit(`Signed by ${SIGNER}, Partner`)} Tj ET`;
const ORD = 'BT /F1 11 Tf 60 780 Td (Ordinary words only on this page) Tj ET';
const hidden3 = (hide: boolean, s: string) => (hide ? `3 Tr ${s} 0 Tr` : s);
const formOf = (b: Build, content: string, bbox: number[], extra: Record<string, unknown> = {}) =>
  b.doc.context.register(b.doc.context.flateStream(content, { Type: 'XObject', Subtype: 'Form', BBox: bbox, Resources: { Font: { F1: b.font.ref } }, ...extra } as never));
/** Helvetica whose character map says private-use characters: the page shows the letters, a reader extracts nonsense. */
function lyingFont(b: Build) {
  const ctx = b.doc.context;
  const cmap = '/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CMapName /Lie def /CMapType 2 def 1 begincodespacerange <00> <FF> endcodespacerange 1 beginbfrange <20> <7E> <E000> endbfrange endcmap CMapName currentdict /CMap defineresource pop end end';
  return ctx.register(ctx.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica', Encoding: 'WinAnsiEncoding', ToUnicode: ctx.register(ctx.flateStream(cmap)) } as never));
}
/** A Type 3 font with one glyph ("a") whose procedure is `proc`. */
function type3(b: Build, proc: string, resources: Record<string, unknown> = {}) {
  const ctx = b.doc.context;
  const stream = ctx.register(ctx.flateStream(proc));
  return ctx.register(ctx.obj({ Type: 'Font', Subtype: 'Type3', FontBBox: [0, 0, 1000, 1000], FontMatrix: [0.001, 0, 0, 0.001, 0, 0], CharProcs: { a: stream }, Encoding: { Type: 'Encoding', Differences: [97, 'a'] }, FirstChar: 97, LastChar: 97, Widths: [1000], Resources: { Font: { F1: b.font.ref }, ...resources } } as never));
}
/** A font whose codes a..j show the letters of `text` (glyph names) and whose map says private-use characters. */
function codedFont(b: Build, text: string) {
  const ctx = b.doc.context;
  const GLYPH: Record<string, string> = { '0': 'zero', '1': 'one', '2': 'two', '3': 'three', '4': 'four', '5': 'five', '6': 'six', '7': 'seven', '8': 'eight', '9': 'nine' };
  const uniq = [...new Set(Array.from(text))];
  const lines = uniq.map((_, i) => `<${(0x61 + i).toString(16)}> <${(0xe000 + i).toString(16)}>`);
  const cmap = `/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CMapName /Sub def /CMapType 2 def 1 begincodespacerange <00> <FF> endcodespacerange ${lines.length} beginbfchar ${lines.join(' ')} endbfchar endcmap CMapName currentdict /CMap defineresource pop end end`;
  const ref = ctx.register(ctx.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica', Encoding: { Type: 'Encoding', BaseEncoding: 'WinAnsiEncoding', Differences: [0x61, ...uniq.map((ch) => PDFName.of(GLYPH[ch] ?? ch))] }, ToUnicode: ctx.register(ctx.flateStream(cmap)) } as never));
  return { ref, enc: Array.from(text).map((ch) => String.fromCharCode(0x61 + uniq.indexOf(ch))).join('') };
}
const fontsWith = (b: Build, more: Record<string, unknown>) => b.doc.context.obj({ F1: b.font.ref, ...more } as never);

/** Runs the recipe: success with no pixel of the value left on any of `pages` (the review's measure), or a refusal when `refusalAllowed`. */
async function holds2(name: string, make: (hide: boolean) => Promise<Uint8Array>, pages: number[], opts: Parameters<typeof survivors>[3] & { refusalAllowed?: boolean; change?: (s: ReviewState) => ReviewState } = {}) {
  const [visible, hidden] = [await make(false), await make(true)];
  const count = (await PDFDocument.load(visible)).getPageCount();
  const source = pdf(name, visible, count);
  const { options } = await reviewed(source, opts.change ?? ((s) => s), opts.choices ?? {}, opts.terms ?? []);
  const result = await makeStep(env)(harness().run, [source], { ...options, ...(opts.confirmFlatten ? { confirmFlatten: opts.confirmFlatten } : {}) }).catch((e: unknown) => e);
  if (result instanceof PdfToolsError) {
    expect(opts.refusalAllowed, `${name}: refused: ${result.message}`).toBe(true);
    return { refused: true as const, message: result.message };
  }
  const made = result as Awaited<ReturnType<ReturnType<typeof makeStep>>>;
  const left: number[] = [];
  for (const page of pages) left.push((await inkLeft(env, visible, hidden, made.files[0].bytes, page)).left);
  expect(left, name).toEqual(pages.map(() => 0));
  return { refused: false as const, made, detail: made.describe(made.files).detail };
}
const typed = { terms: [{ text: SIGNER, reason: 'Typed' }] };

describe("wave 2: the retest's survivors (T-048)", () => {
  it('R1: a signature box that writes the name over two lines, on the redacted page and on a copied page; a PAN in pieces', async () => {
    const box = (h: boolean) => `BT /F1 9 Tf 6 30 Td 11 TL (Digitally signed by ) Tj ${hidden3(h, '(RAMESH) Tj')} T* ${hidden3(h, '(KUMAR GUPTA) Tj')} T* (Date: 2026.11.14 10:22:31) Tj ET`;
    for (const where of ['redacted', 'copied'] as const) {
      await holds2(`R1-wrapped-${where}.pdf`, async (hide) => {
        const b = await newDoc();
        const ctx = b.doc.context;
        const p1 = rawPage(b, `${PLAIN} ${SIGNED}`);
        const p = where === 'redacted' ? p1 : rawPage(b, ORD);
        const widget = addAnnot(b, p, { Subtype: 'Widget', FT: 'Sig', T: PDFString.of('Signature1'), Rect: [330, 600, 510, 644], AP: ctx.obj({ N: appearance(b, box(hide), [0, 0, 180, 44]) }), F: 132 });
        b.doc.catalog.set(PDFName.of('AcroForm'), ctx.obj({ Fields: [widget], SigFlags: 3 }));
        return save(b);
      }, where === 'redacted' ? [0] : [0, 1], typed);
    }
    // Variations: the PAN in two strings on a copied page; one character a string with the quote operator on the redacted page.
    await holds2('R1-pan-two-strings-copied.pdf', async (hide) => {
      const b = await newDoc();
      rawPage(b, PLAIN);
      addAnnot(b, rawPage(b, ORD), { Subtype: 'Stamp', Rect: [100, 500, 300, 540], AP: b.doc.context.obj({ N: appearance(b, `BT /F1 9 Tf 6 20 Td (PAN ) Tj ${hidden3(hide, '(QWXPT) Tj (4821K) Tj')} ET`, [0, 0, 200, 40]) }) });
      return save(b);
    }, [1]);
    await holds2('R1-pan-by-quote-redacted.pdf', async (hide) => {
      const b = await newDoc();
      addAnnot(b, rawPage(b, PLAIN), { Subtype: 'Stamp', Rect: [100, 500, 300, 560], AP: b.doc.context.obj({ N: appearance(b, `BT /F1 9 Tf 10 TL 6 50 Td (PAN) Tj ${hidden3(hide, Array.from(VALUE).map((c) => `(${c}) '`).join(' '))} ET`, [0, 0, 200, 60]) }) });
      return save(b);
    }, [0]);
  });

  it('R2: one appearance used by two (and three) stamps: every instance is covered, and "covered there too" is true', async () => {
    for (const where of ['same-page', 'copied', 'three'] as const) {
      const out = await holds2(`R2-${where}.pdf`, async (hide) => {
        const b = await newDoc();
        const ap = formOf(b, `0 0 1 RG 1 1 198 38 re S BT /F1 10 Tf 8 22 Td (VERIFIED) Tj 0 -14 Td ${hidden3(hide, lit(`PAN ${VALUE}`) + ' Tj')} ET`, [0, 0, 200, 40]);
        const p1 = rawPage(b, PLAIN);
        const p = where === 'copied' ? rawPage(b, ORD) : p1;
        for (const y of where === 'three' ? [600, 400, 200] : [600, 300]) addAnnot(b, p, { Subtype: 'Stamp', Rect: [100, y, 300, y + 40], AP: b.doc.context.obj({ N: ap }) });
        return save(b);
      }, where === 'copied' ? [0, 1] : [0]);
      if (where === 'copied' && !out.refused) expect(out.detail).toMatch(/Page 2 also held redacted text/);
    }
  });

  it('R3: a covered place never vouches for another drawing: a lying map, a form drawn by the page and a stamp, a stamp listed in the page resources, a pattern drawing a shared form, and the copied-page stand-in', async () => {
    await holds2('R3-lying-map.pdf', async (hide) => {
      const b = await newDoc();
      rawPage(b, `${PLAIN} BT /F3 12 Tf 60 500 Td ${hidden3(hide, `${lit(VALUE)} Tj`)} ET`, { Font: fontsWith(b, { F3: lyingFont(b) }) });
      return save(b);
    }, [0]);
    await holds2('R3-form-page-and-stamp.pdf', async (hide) => {
      const b = await newDoc();
      const block = formOf(b, `BT /F1 10 Tf 4 6 Td ${hidden3(hide, `${lit(`PAN ${VALUE}`)} Tj`)} ET`, [0, 0, 180, 20]);
      const ap = formOf(b, '1 0 0 RG 1 1 198 38 re S q 1 0 0 1 10 10 cm /Blk Do Q', [0, 0, 200, 40], { Resources: b.doc.context.obj({ XObject: { Blk: block } }) });
      const p = rawPage(b, `${ORD} q 1 0 0 1 60 700 cm /Blk Do Q`, { XObject: b.doc.context.obj({ Blk: block }) });
      addAnnot(b, p, { Subtype: 'Stamp', Rect: [100, 300, 300, 340], AP: b.doc.context.obj({ N: ap }) });
      return save(b);
    }, [0]);
    await holds2('R3-appearance-in-resources.pdf', async (hide) => {
      const b = await newDoc();
      const ap = formOf(b, `BT /F1 10 Tf 8 12 Td ${hidden3(hide, `${lit(`PAN ${VALUE}`)} Tj`)} ET`, [0, 0, 200, 40]);
      const p = rawPage(b, PLAIN, { XObject: b.doc.context.obj({ Fm9: ap }) });
      addAnnot(b, p, { Subtype: 'Stamp', Rect: [100, 600, 300, 640], AP: b.doc.context.obj({ N: ap }) });
      return save(b);
    }, [0]);
    await holds2('R3-pattern-shared-form.pdf', async (hide) => {
      const b = await newDoc();
      const ctx = b.doc.context;
      const fm = formOf(b, `BT /F1 12 Tf 4 8 Td ${hidden3(hide, `${lit(VALUE)} Tj`)} ET`, [0, 0, 200, 30]);
      const pattern = ctx.register(ctx.flateStream('/FmP Do', { Type: 'Pattern', PatternType: 1, PaintType: 1, TilingType: 1, BBox: [0, 0, 200, 30], XStep: 200, YStep: 30, Resources: ctx.obj({ Font: { F1: b.font.ref }, XObject: { FmP: fm } } as never) } as never));
      rawPage(b, `${PLAIN} /Pattern cs /P1 scn 60 400 200 30 re f`, { XObject: ctx.obj({ FmP: fm }), Pattern: ctx.obj({ P1: pattern }) });
      return save(b);
    }, [0]);
    const e3 = await holds2('R3-copied-stand-in.pdf', async (hide) => {
      const b = await newDoc();
      rawPage(b, `${PLAIN} ${SIGNED}`);
      rawPage(b, `${ORD} BT /F1 11 Tf 60 700 Td (Contact: Ramesh;Kumar;Gupta) Tj ET BT /F3 12 Tf 60 500 Td ${hidden3(hide, `${lit(VALUE)} Tj`)} ET`, { Font: fontsWith(b, { F3: lyingFont(b) }) });
      return save(b);
    }, [1], typed);
    expect(e3.refused).toBe(false);
    // Variation: the lying-map PAN as a kerned array.
    await holds2('R3-lying-map-array.pdf', async (hide) => {
      const b = await newDoc();
      rawPage(b, `${PLAIN} BT /F3 12 Tf 60 500 Td ${hidden3(hide, '[(QWX) -40 (PT48) 20 (21K)] TJ')} ET`, { Font: fontsWith(b, { F3: lyingFont(b) }) });
      return save(b);
    }, [0]);
  });

  it('R4: a Type 3 glyph procedure that writes the PAN: covered on the redacted page; the "draw a small box anywhere" route covers it too (or stops), never a pass with it shown', async () => {
    const proc = (hide: boolean) => `1000 0 d0 BT /F1 100 Tf 0 300 Td ${hidden3(hide, `${lit(VALUE)} Tj`)} ET`;
    await holds2('R4-type3-same-page.pdf', async (hide) => {
      const b = await newDoc();
      rawPage(b, `${PLAIN} BT /T3 100 Tf 60 500 Td (a) Tj ET`, { Font: fontsWith(b, { T3: type3(b, proc(hide)) }) });
      return save(b);
    }, [0]);
    await holds2('R4-type3-other-page-drawn-box.pdf', async (hide) => {
      const b = await newDoc();
      rawPage(b, PLAIN);
      rawPage(b, `${ORD} BT /T3 100 Tf 60 500 Td (a) Tj ET`, { Font: fontsWith(b, { T3: type3(b, proc(hide)) }) });
      return save(b);
    }, [1], { refusalAllowed: true, change: (s) => reviewReducer(s, { type: 'draw', box: { id: 'd1', page: 1, rect: { x0: 400, y0: 100, x1: 450, y1: 120 } } }) });
    // Variation: the glyph procedure draws a form that writes it.
    await holds2('R4-type3-form.pdf', async (hide) => {
      const b = await newDoc();
      const fm = formOf(b, `BT /F1 100 Tf 0 300 Td ${hidden3(hide, `${lit(VALUE)} Tj`)} ET`, [0, 0, 1000, 1000]);
      rawPage(b, `${PLAIN} BT /T3 100 Tf 60 500 Td (a) Tj ET`, { Font: fontsWith(b, { T3: type3(b, '1000 0 d0 /Fm0 Do', { XObject: { Fm0: fm } }) }) });
      return save(b);
    }, [0]);
  });

  it('R5: a stamp the checker cannot read (abbreviated filters, a malformed number) on the redacted page is covered whole or the run stops', async () => {
    const apText = (hide: boolean) => `0 0 1 RG 1 1 198 38 re S BT /F1 10 Tf 8 12 Td ${hidden3(hide, `${lit(`PAN ${VALUE}`)} Tj`)} ET`;
    const zlib = await import('node:zlib');
    const encoders: Record<string, (b: Build, c: string) => ReturnType<Build['doc']['context']['register']>> = {
      Fl: (b, c) => b.doc.context.register(b.doc.context.stream(zlib.deflateSync(Buffer.from(c, 'latin1')), { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 200, 40], Resources: { Font: { F1: b.font.ref } }, Filter: 'Fl' } as never)),
      AHx: (b, c) => b.doc.context.register(b.doc.context.stream(Buffer.from(c, 'latin1').toString('hex') + '>', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 200, 40], Resources: { Font: { F1: b.font.ref } }, Filter: ['AHx'] } as never)),
      malformed: (b, c) => b.doc.context.register(b.doc.context.stream(c, { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 200, 40], Resources: { Font: { F1: b.font.ref } }, Junk: 123456789 } as never)),
    };
    for (const [name, enc] of Object.entries(encoders)) {
      await holds2(`R5-${name}.pdf`, async (hide) => {
        const b = await newDoc();
        addAnnot(b, rawPage(b, PLAIN), { Subtype: 'Stamp', Rect: [100, 500, 300, 540], AP: b.doc.context.obj({ N: enc(b, apText(hide)) }) });
        let bytes = await save(b);
        if (name === 'malformed') bytes = Uint8Array.from(Buffer.from(Buffer.from(bytes).toString('latin1').replace('/Junk 123456789', '/Junk 1.2.3.4.5'), 'latin1'));
        return bytes;
      }, [0], { refusalAllowed: true });
    }
  });

  it('R6: alternative text in the structure tree over unreadable glyphs, on a copied page and on the redacted page (and /Alt)', async () => {
    for (const [where, key] of [['copied', 'ActualText'], ['rebuilt', 'ActualText'], ['copied', 'Alt']] as const) {
      await holds2(`R6-${where}-${key}.pdf`, async (hide) => {
        const b = await newDoc();
        const ctx = b.doc.context;
        const cf = codedFont(b, VALUE);
        const glyphs = `/Span <</MCID 0>> BDC BT /F3 12 Tf 60 500 Td ${hidden3(hide, `${lit(cf.enc)} Tj`)} ET EMC`;
        let target: PDFPage;
        if (where === 'copied') {
          rawPage(b, PLAIN);
          target = rawPage(b, `${ORD} ${glyphs}`, { Font: fontsWith(b, { F3: cf.ref }) });
        } else target = rawPage(b, `${PLAIN} ${glyphs}`, { Font: fontsWith(b, { F3: cf.ref }) });
        const root = ctx.register(ctx.obj({ Type: 'StructTreeRoot' } as never));
        const elem = ctx.register(ctx.obj({ Type: 'StructElem', S: 'Span', P: root, Pg: target.ref, K: 0, [key]: PDFString.of(VALUE) } as never));
        (ctx.lookup(root) as unknown as { set(k: PDFName, v: unknown): void }).set(PDFName.of('K'), ctx.obj([elem]));
        b.doc.catalog.set(PDFName.of('StructTreeRoot'), root);
        target.node.set(PDFName.of('StructParents'), ctx.obj(0));
        return save(b);
      }, where === 'copied' ? [1] : [0]);
    }
  });

  it('ruling 2: on a page to rebuild, text in a font whose map cannot be trusted (private-use characters) is covered, with one sentence saying so', async () => {
    const out = await holds2('Ruling2-untrusted-font.pdf', async (hide) => {
      const b = await newDoc();
      const cf = codedFont(b, VALUE);
      rawPage(b, `${PLAIN} BT /F3 12 Tf 60 500 Td ${hidden3(hide, `${lit(cf.enc)} Tj`)} ET`, { Font: fontsWith(b, { F3: cf.ref }) });
      return save(b);
    }, [0]);
    if (!out.refused) expect(out.detail).toMatch(/could not be read was covered/);
  });

  it('ruling 6: the words beside a value written in pieces (two shows, a kerned array) stay visible; the value does not', async () => {
    const page = (labels: 'show' | 'hide' | 'plain', value: 'show' | 'hide') => {
      const L = (s: string) => (labels === 'hide' ? `3 Tr ${lit(s)} Tj 0 Tr` : `${lit(s)} Tj`);
      const LA = (s: string) => (labels === 'hide' ? `3 Tr [${lit(s)}] TJ 0 Tr` : `[${lit(s)}] TJ`);
      const V = (s: string) => (value === 'hide' ? `3 Tr ${s} 0 Tr` : s);
      if (labels === 'plain' && value === 'show') return `BT /F1 10 Tf 72 670 Td (PAN: QWXPT) Tj (4821K, dated today) Tj ET BT /F1 10 Tf 72 640 Td [(Ref: QW) -120 (XPT4) 80 (821K, noted)] TJ ET`;
      return `BT /F1 10 Tf 72 670 Td ${L('PAN: ')} ${V('(QWXPT) Tj (4821K) Tj')} ${L(', dated today')} ET BT /F1 10 Tf 72 640 Td ${LA('Ref: ')} ${V('[(QW) -120 (XPT4) 80 (821K)] TJ')} ${LA(', noted')} ET`;
    };
    const make = async (content: string) => {
      const b = await newDoc();
      rawPage(b, content);
      return save(b);
    };
    const [visible, labelsHidden, valueHidden] = [await make(page('plain', 'show')), await make(page('hide', 'show')), await make(page('show', 'hide'))];
    const source = pdf('Pieces.pdf', visible, 1);
    const { options } = await reviewed(source);
    const made = await makeStep(env)(harness().run, [source], options);
    const result = made.files[0].bytes;
    expect((await inkLeft(env, visible, valueHidden, result, 0)).left).toBe(0);
    const words = await inkLeft(env, visible, labelsHidden, result, 0);
    expect(words.ink).toBeGreaterThan(0);
    expect(words.left / words.ink).toBeGreaterThan(0.8);
  });

  // ---- wave 2b: a run never waits for ever ----
  /** The renderer of `env`, with the `which`-th drawing (0-based) replaced by `instead`. */
  const oneDrawing = (which: number, instead: () => Promise<never>) => {
    let n = 0;
    return { ...env.renderer, renderPagePixels: (...args: Parameters<NodeEnv['renderer']['renderPagePixels']>) => (n++ === which ? instead() : env.renderer.renderPagePixels(...args)) };
  };
  const plainPdf = async () => {
    const b = await newDoc();
    rawPage(b, `${PLAIN} ${ORD.replace('780', '700')}`);
    return save(b);
  };

  it('wave 2b: a drawing that never settles ends the run with the fixed sentence, soon, adding nothing', async () => {
    const source = pdf('Silent.pdf', await plainPdf(), 1);
    const { options } = await reviewed(source);
    const h = harness();
    const started = Date.now();
    // The second drawing is the proof's copy of the page (the first is the page itself).
    const error = await makeStep({ ...env, stallMs: 300, renderer: oneDrawing(1, () => new Promise<never>(() => undefined)) })(h.run, [source], options).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PdfToolsError);
    expect((error as PdfToolsError).message).toBe('Redact stopped because a page took too long to draw or read. Nothing was added. Try again; if it happens again, restart the application.');
    expect(Date.now() - started).toBeLessThan(15_000);
    expect(h.store.getState().files).toHaveLength(0);
  });

  it('wave 2b: a second drawing that is refused (a worker gone) ends the run with the fixed sentence, adding nothing', async () => {
    const source = pdf('Refused.pdf', await plainPdf(), 1);
    const { options } = await reviewed(source);
    const h = harness();
    const error = await makeStep({ ...env, renderer: oneDrawing(1, () => Promise.reject(new Error('Worker was terminated'))) })(h.run, [source], options).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PdfToolsError);
    expect((error as PdfToolsError).message).toBe('A page could not be drawn for redaction. Nothing was added. Try again; if it fails again, restart the application.');
    expect(h.store.getState().files).toHaveLength(0);
  });

  it('wave 2b: silence is counted in active time: an hour asleep or a throttled window is not a stall; work resets it; Stop passes through', () => {
    vi.useFakeTimers();
    try {
      let clock = 0;
      const outer = new AbortController();
      const watch = silenceWatch(1000, outer.signal, () => clock); // a tick every 50 ms
      const pass = (ms: number) => {
        for (let t = 0; t < ms; t += 50) {
          clock += 50;
          vi.advanceTimersByTime(50);
        }
      };
      // The machine asleep for an hour between two ticks; then a hidden window ticking once a minute for ten minutes.
      clock += 3_600_000;
      vi.advanceTimersByTime(50);
      for (let k = 0; k < 10; k++) {
        clock += 60_000;
        vi.advanceTimersByTime(50);
      }
      expect(watch.error).toBeNull();
      // Work touches it: 900 ms of silence, a touch, 900 ms more: still no stall.
      watch.touch();
      pass(900);
      watch.touch();
      pass(900);
      expect(watch.error).toBeNull();
      expect(watch.signal.aborted).toBe(false);
      // A whole second of silence: the stall, with its sentence, and the signal aborted with it.
      pass(150);
      expect(watch.error?.message).toMatch(/^Redact stopped because a page took too long to draw or read\. Nothing was added\./);
      expect(watch.signal.reason).toBe(watch.error);
      watch.stop();
      // The user's Stop is passed through as it is.
      const other = new AbortController();
      const second = silenceWatch(1000, other.signal, () => clock);
      other.abort(new DOMException('Stopped.', 'AbortError'));
      expect(second.signal.aborted).toBe(true);
      expect(second.error).toBeNull();
      second.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('wave 2b: waiting for the user to answer a question is never silence', async () => {
    const b = await newDoc();
    const ctx = b.doc.context;
    rawPage(b, PLAIN);
    const target = rawPage(b, ORD);
    const root = ctx.register(ctx.obj({ Type: 'StructTreeRoot' } as never));
    const elem = ctx.register(ctx.obj({ Type: 'StructElem', S: 'Figure', P: root, Pg: target.ref, K: 7, Alt: PDFString.of(VALUE) } as never));
    (ctx.lookup(root) as unknown as { set(k: PDFName, v: unknown): void }).set(PDFName.of('K'), ctx.obj([elem]));
    b.doc.catalog.set(PDFName.of('StructTreeRoot'), root);
    target.node.set(PDFName.of('StructParents'), ctx.obj(0));
    const source = pdf('Slow-answer.pdf', await save(b), 2);
    const { options } = await reviewed(source);
    const slowYes = async () => {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      return true;
    };
    const made = await makeStep({ ...env, stallMs: 2000 })(harness().run, [source], { ...options, confirmFlatten: slowYes });
    expect(made.files).toHaveLength(1);
  });

  // RX-LIB's per-drawing reading (rx2-contract.md (b)): every drawing on a page to rebuild that cannot be read,
  // or that holds a target, is boxed where that instance paints, or the run asks, or it stops.
  it('pageDrawings: bullets in a symbol font with no map on a page to rebuild are boxed where they paint, not refused; one sentence says so', async () => {
    const out = await holds2('Drawings-symbol-bullets.pdf', async (hide) => {
      const b = await newDoc();
      const ctx = b.doc.context;
      const sym = ctx.obj({ Type: 'Font', Subtype: 'TrueType', BaseFont: 'Wingdings-Regular', FirstChar: 167, LastChar: 167, Widths: [500], FontDescriptor: { Type: 'FontDescriptor', FontName: 'Wingdings-Regular', Flags: 4, FontBBox: [0, 0, 1000, 1000], ItalicAngle: 0, Ascent: 900, Descent: -200, CapHeight: 700, StemV: 80 } } as never);
      const bullets = [1, 2, 3].map((k) => `BT /F2 10 Tf 60 ${700 - k * 14} Td ${hidden3(hide, '<a7> Tj')} ET BT /F1 10 Tf 75 ${700 - k * 14} Td (Point number ${k} of the list) Tj ET`).join(' ');
      rawPage(b, `${PLAIN} ${bullets}`, { Font: fontsWith(b, { F2: sym }) });
      return save(b);
    }, [0]);
    expect(out.refused).toBe(false);
    if (!out.refused) expect(out.detail).toMatch(/could not be read was covered whole/);
  });

  it('Ruling B with readerGaveUp: a copied page whose only unreadable text is symbol-font bullets stays copied (its text kept); a stamp the reader gives up on (too deep) makes it rebuilt', async () => {
    const make = async (second: 'bullets' | 'deep') => {
      const b = await newDoc();
      const ctx = b.doc.context;
      const sym = ctx.obj({ Type: 'Font', Subtype: 'TrueType', BaseFont: 'Wingdings-Regular', FirstChar: 167, LastChar: 167, Widths: [500], FontDescriptor: { Type: 'FontDescriptor', FontName: 'Wingdings-Regular', Flags: 4, FontBBox: [0, 0, 1000, 1000], ItalicAngle: 0, Ascent: 900, Descent: -200, CapHeight: 700, StemV: 80 } } as never);
      rawPage(b, PLAIN);
      const lines = [1, 2, 3].map((k) => `BT /F1 10 Tf 75 ${700 - k * 14} Td (Point number ${k} of the list) Tj ET`).join(' ');
      const odd = second === 'bullets' ? [1, 2, 3].map((k) => `BT /F2 10 Tf 60 ${700 - k * 14} Td <a7> Tj ET`).join(' ') : '';
      const page2 = rawPage(b, `${lines} ${odd}`, { Font: fontsWith(b, { F2: sym }) });
      if (second === 'deep') {
        let inner = formStream(b, 'BT /F1 9 Tf 6 18 Td (Approved) Tj ET', { Font: { F1: b.font.ref } });
        for (let k = 0; k < 34; k++) inner = formStream(b, '/Fm Do', { XObject: { Fm: inner } });
        stampOf(b, page2, inner);
      }
      return save(b);
    };
    for (const second of ['bullets', 'deep'] as const) {
      const bytes = await make(second);
      const source = pdf(`W3-B-copied-${second}.pdf`, bytes, 2);
      const { options } = await reviewed(source);
      const made = await makeStep(env)(harness().run, [source], options);
      const detail = made.describe(made.files).detail ?? '';
      const { openPdfjs } = await import('@/lib/pdf-tools/testRedactPdf');
      const doc = await openPdfjs(made.files[0].bytes);
      const text = (await (await doc.getPage(2)).getTextContent()).items.map((i) => ('str' in i ? i.str : '')).join('');
      await doc.destroy();
      if (second === 'bullets') {
        // Wave 4, ruling M overturns the copy here: a font with no usable map is off the allow-list, so the page is
        // rebuilt (bullets boxed, one sentence), and its words stay searchable.
        expect(text.replace(/\s+/g, ''), second).toMatch(/number1ofthelist/);
        expect(detail, second).toMatch(/^1 area removed on page 1; that page is now a picture/);
        expect(detail, second).toMatch(/On pages? [^.]*2[^.]*, text or a drawing that could not be read was covered whole|Page 2 was also made a picture, to be safe/);
      } else {
        // Rebuilt under the proof, the stamp boxed where it paints, with one sentence.
        expect(detail, second).toMatch(/On pages? [^.]*2[^.]*, text or a drawing that could not be read was covered whole/);
      }
    }
  });

  it('pageDrawings: a Type 3 glyph that draws a picture (it cannot be read) on a page to rebuild is boxed where it paints', async () => {
    await holds2('Drawings-type3-picture.pdf', async (hide) => {
      const b = await newDoc();
      const ctx = b.doc.context;
      const image = ctx.register(ctx.stream(new Uint8Array(64), { Type: 'XObject', Subtype: 'Image', Width: 8, Height: 8, ColorSpace: 'DeviceGray', BitsPerComponent: 8 } as never));
      const font = type3(b, '1000 0 d0 q 800 0 0 800 0 0 cm /Im0 Do Q', { XObject: { Im0: image } });
      rawPage(b, `${PLAIN} BT /T3 40 Tf 60 500 Td ${hide ? '' : '(a) Tj'} ET`, { Font: fontsWith(b, { T3: font }) });
      return save(b);
    }, [0]);
  });

  it('CheckHit.marked: alternative text of a structure element whose marked content is not on the page: the run asks with "may show" (R6)', async () => {
    for (const where of ['rebuilt', 'copied'] as const) {
      const b = await newDoc();
      const ctx = b.doc.context;
      rawPage(b, PLAIN);
      const target = where === 'rebuilt' ? b.doc.getPage(0) : rawPage(b, ORD);
      const root = ctx.register(ctx.obj({ Type: 'StructTreeRoot' } as never));
      const elem = ctx.register(ctx.obj({ Type: 'StructElem', S: 'Figure', P: root, Pg: target.ref, K: 7, Alt: PDFString.of(VALUE) } as never));
      (ctx.lookup(root) as unknown as { set(k: PDFName, v: unknown): void }).set(PDFName.of('K'), ctx.obj([elem]));
      b.doc.catalog.set(PDFName.of('StructTreeRoot'), root);
      target.node.set(PDFName.of('StructParents'), ctx.obj(0));
      const bytes = await save(b);
      const source = pdf(`Marked-${where}.pdf`, bytes, (await PDFDocument.load(bytes)).getPageCount());
      const { options } = await reviewed(source);
      const page = where === 'rebuilt' ? 0 : 1;
      const yes = vi.fn(async (_pages: number[], _info: { mayShow: number[] }) => true);
      await makeStep(env)(harness().run, [source], { ...options, confirmFlatten: yes });
      expect(yes, where).toHaveBeenCalled();
      expect(yes.mock.calls[0][1].mayShow, where).toContain(page);
      // A "no" adds nothing.
      const no = vi.fn(async () => false);
      await expect(makeStep(env)(harness().run, [source], { ...options, confirmFlatten: no }), where).rejects.toBeInstanceOf(PdfToolsError);
    }
  });

  it('R8: a file named with the typed name run together gives "Redacted document.pdf", and the record withholds it', async () => {
    const b = await newDoc();
    rawPage(b, `BT /F1 11 Tf 60 780 Td ${lit(`Certificate for ${SIGNER}, employee`)} Tj ET`);
    const bytes = await save(b);
    for (const name of ['RameshKumarGupta_Form16.pdf', 'RAMESHKUMARGUPTA.pdf', 'Form16-ramesh.kumar.gupta.pdf']) {
      const source = pdf(name, bytes, 1);
      const { options } = await reviewed(source, (s) => s, {}, [{ text: SIGNER, reason: 'Typed' }]);
      const made = await makeStep(env)(harness().run, [source], options);
      const [file] = made.files;
      expect(file.name, name).toBe('Redacted document.pdf');
      const said = JSON.stringify([file.operation, made.describe(made.files)]).toLowerCase();
      expect(said.includes('rameshkumargupta'), name).toBe(false);
      expect(file.operation?.sources?.[0]?.name).toBe('Original file (name withheld)');
    }
  });
});

// ---- wave 3: the renderer's own reading (redact-retest-2.md findings 3 to 8; redact-fix-rules-3.md rulings A and B) ----

/** A font whose bytes are a, b, c, ... and whose glyph names spell `text` (no character map): the renderer reads it by the names. */
function namedFont(b: Build, text: string) {
  const ctx = b.doc.context;
  const GLYPH: Record<string, string> = { ' ': 'space', '0': 'zero', '1': 'one', '2': 'two', '3': 'three', '4': 'four', '5': 'five', '6': 'six', '7': 'seven', '8': 'eight', '9': 'nine' };
  const uniq = [...new Set(Array.from(text))];
  const ref = ctx.register(ctx.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica', Encoding: { Type: 'Encoding', BaseEncoding: 'WinAnsiEncoding', Differences: [0x61, ...uniq.map((ch) => PDFName.of(GLYPH[ch] ?? ch))] } } as never));
  return { ref, enc: Array.from(text).map((ch) => String.fromCharCode(0x61 + uniq.indexOf(ch))).join('') };
}
const stampOf = (b: Build, target: PDFPage, stream: unknown) => addAnnot(b, target, { Subtype: 'Stamp', Rect: [100, 500, 300, 550], AP: b.doc.context.obj({ N: stream } as never) });
const formStream = (b: Build, content: string, resources: Record<string, unknown>) =>
  b.doc.context.register(b.doc.context.flateStream(content, { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 200, 50], Resources: resources } as never));
const N = PDFName.of;
/** The recipe on the redacted page and on a copied page (the drawing alone on page 2). */
async function bothPages(id: string, make: (b: Build, hide: boolean, target: PDFPage) => void, opts: Parameters<typeof holds2>[3] = {}) {
  for (const where of ['redacted', 'copied'] as const) {
    await holds2(`${id}-${where}.pdf`, async (hide) => {
      const b = await newDoc();
      const p1 = rawPage(b, `${PLAIN} ${SIGNED}`);
      const target = where === 'redacted' ? p1 : rawPage(b, ORD);
      make(b, hide, target);
      return save(b);
    }, where === 'redacted' ? [0] : [0, 1], opts);
  }
}

describe("wave 3: the renderer's own reading (T-048)", () => {
  it('finding 3: a stamp that writes other text between the pieces of the PAN (placed back with Tm); and a name the same way', async () => {
    await bothPages('W3-F3-stamp-order', (b, hide, target) => {
      stampOf(b, target, formStream(b, `BT /F1 9 Tf 1 0 0 1 6 30 Tm (PAN ) Tj ${hidden3(hide, '(QWXPT) Tj')} 1 0 0 1 6 12 Tm (Date 14 Nov 2026) Tj 1 0 0 1 49.5 30 Tm ${hidden3(hide, '(4821K) Tj')} ET`, { Font: { F1: b.font.ref } }));
    });
    // Variation: the typed name, its surname written last.
    await bothPages('W3-F3-stamp-order-name', (b, hide, target) => {
      stampOf(b, target, formStream(b, `BT /F1 9 Tf 1 0 0 1 6 30 Tm ${hidden3(hide, '(Ramesh Kumar) Tj')} 1 0 0 1 6 12 Tm (Partner) Tj 1 0 0 1 64 30 Tm ${hidden3(hide, '( Gupta) Tj')} ET`, { Font: { F1: b.font.ref } }));
    }, typed);
  });

  it('finding 4: an inline picture that ends without a space before EI, then the PAN in pieces (plain and in a font read by its glyph names)', async () => {
    const pic = 'q 4 0 0 4 2 2 cm BI /W 2 /H 1 /BPC 8 /CS /G ID AAEI Q';
    await bothPages('W3-F4-inline-EI', (b, hide, target) => {
      stampOf(b, target, formStream(b, `0 0 1 RG 1 1 198 48 re S ${pic} BT /F1 9 Tf 6 20 Td (PAN ) Tj ${hidden3(hide, '(QWXPT) Tj (4821K) Tj')} ET`, { Font: { F1: b.font.ref } }));
    });
    await bothPages('W3-F4-inline-EI-named-font', (b, hide, target) => {
      const f = namedFont(b, VALUE);
      stampOf(b, target, formStream(b, `${pic} BT /FD 9 Tf 6 20 Td ${hidden3(hide, `(${f.enc}) Tj`)} ET`, { Font: { F1: b.font.ref, FD: f.ref } }));
    });
  });

  it('finding 5: a font set by a graphics state, or inherited by a form, that the renderer reads by its glyph names', async () => {
    await bothPages('W3-F5-gs-font', (b, hide, target) => {
      const f = namedFont(b, VALUE);
      stampOf(b, target, formStream(b, `BT /F1 9 Tf 6 30 Td (VERIFIED) Tj /GS1 gs 0 -12 Td ${hidden3(hide, `(${f.enc}) Tj`)} ET`, { Font: { F1: b.font.ref }, ExtGState: { GS1: { Type: 'ExtGState', Font: [f.ref, 9] } } }));
    });
    await bothPages('W3-F5-inherited-font', (b, hide, target) => {
      const f = namedFont(b, VALUE);
      const inner = formStream(b, `BT 6 18 Td ${hidden3(hide, `(${f.enc}) Tj`)} ET`, {});
      stampOf(b, target, formStream(b, `BT /F1 9 Tf 6 34 Td (VERIFIED) Tj ET BT /FD 9 Tf ET /Fm1 Do`, { Font: { F1: b.font.ref, FD: f.ref }, XObject: { Fm1: inner } }));
    });
  });

  it('finding 6: a Type 3 font whose encoding is a name, its glyph writing the PAN (in a named font, and in plain text)', async () => {
    for (const named of [true, false]) {
      await bothPages(`W3-F6-type3-named-encoding-${named ? 'named' : 'plain'}`, (b, hide, target) => {
        const ctx = b.doc.context;
        const f = namedFont(b, VALUE);
        const proc = ctx.register(ctx.flateStream(`1000 0 d0 BT /FD 100 Tf 0 300 Td ${hidden3(hide, named ? `(${f.enc}) Tj` : `(QWXPT) Tj (4821K) Tj`)} ET`));
        const t3 = ctx.register(ctx.obj({ Type: 'Font', Subtype: 'Type3', FontBBox: [0, 0, 1000, 1000], FontMatrix: [0.001, 0, 0, 0.001, 0, 0], CharProcs: { a: proc }, Encoding: 'WinAnsiEncoding', FirstChar: 97, LastChar: 97, Widths: [1000], Resources: { Font: { FD: named ? f.ref : b.font.ref } } } as never));
        (target.node.get(N('Resources')) as unknown as { get(k: PDFName): { set(k: PDFName, v: unknown): void } }).get(N('Font')).set(N('T3'), t3);
        const more = ctx.register(ctx.flateStream(' BT /T3 60 Tf 60 400 Td (a) Tj ET'));
        target.node.set(N('Contents'), ctx.obj([target.node.get(N('Contents')), more] as never));
      });
    }
  });

  it('finding 8: on a copied page, a stamp 34 forms deep and a Type 3 font written in the resources, each writing the PAN in a named font', async () => {
    await bothPages('W3-F8-deep-forms', (b, hide, target) => {
      const f = namedFont(b, VALUE);
      let inner = formStream(b, `BT /FD 9 Tf 6 18 Td ${hidden3(hide, `(${f.enc}) Tj`)} ET`, { Font: { FD: f.ref } });
      for (let k = 0; k < 34; k++) inner = formStream(b, '/Fm Do', { XObject: { Fm: inner } });
      stampOf(b, target, inner);
    }, { refusalAllowed: true });
    await bothPages('W3-F8-type3-direct', (b, hide, target) => {
      const ctx = b.doc.context;
      const f = namedFont(b, VALUE);
      const proc = ctx.register(ctx.flateStream(`1000 0 d0 BT /FD 100 Tf 0 300 Td ${hidden3(hide, `(${f.enc}) Tj`)} ET`));
      (target.node.get(N('Resources')) as unknown as { get(k: PDFName): { set(k: PDFName, v: unknown): void } }).get(N('Font')).set(N('T3'), ctx.obj({ Type: 'Font', Subtype: 'Type3', FontBBox: [0, 0, 1000, 1000], FontMatrix: [0.001, 0, 0, 0.001, 0, 0], CharProcs: { a: proc }, Encoding: { Type: 'Encoding', Differences: [97, 'a'] }, FirstChar: 97, LastChar: 97, Widths: [1000], Resources: { Font: { FD: f.ref } } } as never));
      const more = ctx.register(ctx.flateStream(' BT /T3 60 Tf 60 400 Td (a) Tj ET'));
      target.node.set(N('Contents'), ctx.obj([target.node.get(N('Contents')), more] as never));
    }, { refusalAllowed: true });
  });

  it('finding 1 (on our side): a typed name broken at a line end by a hyphen, and one wrapped in a table cell written across the row, on the redacted page', async () => {
    await holds2('W3-F1-hyphen.pdf', async (hide) => {
      const b = await newDoc();
      rawPage(b, `${PLAIN} ${SIGNED} BT /F1 11 Tf 60 700 Td (Confirmation was received from ) Tj ${hidden3(hide, '(Ramesh Ku-) Tj')} 0 -15 Td ${hidden3(hide, '(mar Gupta) Tj')} ( regarding the loan.) Tj ET`);
      return save(b);
    }, [0], typed);
    await holds2('W3-F1-table-row-wise.pdf', async (hide) => {
      const b = await newDoc();
      // As the re-test wrote it: the name is also on the page in one piece (so the review lists it).
      rawPage(b, `${PLAIN} ${SIGNED} BT /F1 10 Tf 60 650 Td ${hidden3(hide, '(Ramesh Kumar) Tj')} 150 0 Td (Salary account) Tj 150 0 Td (12,40,000.00) Tj -300 -13 Td ${hidden3(hide, '(Gupta) Tj')} ET`);
      return save(b);
    }, [0], typed);
  });

  it('wave 3b: a page tree node that is its own parent (pdf-lib overflows the stack copying pages) ends with the plain "damaged" refusal, adding nothing', async () => {
    for (const pages of [1, 2]) {
      const b = await newDoc();
      rawPage(b, PLAIN);
      if (pages === 2) rawPage(b, ORD);
      const tree = b.doc.catalog.get(N('Pages'));
      (b.doc.catalog.lookup(N('Pages')) as unknown as { set(k: PDFName, v: unknown): void }).set(N('Parent'), tree);
      const bytes = await save(b);
      const source = pdf(`W3b-self-parent-${pages}.pdf`, bytes, pages);
      const { options } = await reviewed(source);
      expect(options.areas.length, `${pages}`).toBeGreaterThan(0);
      const h = harness();
      const result = await makeStep(env)(h.run, [source], options).catch((e: unknown) => e);
      expect(result, `${pages}`).toMatchObject({ name: 'PdfToolsError', code: 'not-a-pdf', message: 'This file could not be read as a PDF. It may be damaged.' });
      expect(h.store.getState().files ?? [], `${pages}`).toHaveLength(0);
    }
  });

  it('wave 3b: a typed name the find places nowhere (only inside a stamp) is still looked for: covered where it paints, on the redacted page and on a copied page', async () => {
    for (const where of ['redacted', 'copied'] as const) {
      // The find reads the page's text, not a stamp's appearance: the review has no place for the name.
      const out = await holds2(`W3b-typed-only-in-stamp-${where}.pdf`, async (hide) => {
        const b = await newDoc();
        const p1 = rawPage(b, PLAIN);
        const target = where === 'redacted' ? p1 : rawPage(b, ORD);
        stampOf(b, target, formStream(b, `BT /F1 9 Tf 6 20 Td (Checked by ) Tj ${hidden3(hide, '(Ramesh Kumar Gupta) Tj')} ET`, { Font: { F1: b.font.ref } }));
        return save(b);
      }, where === 'redacted' ? [0] : [0, 1], typed);
      if (!out.refused && where === 'copied') expect(out.detail).toMatch(/Page 2 also held redacted text the review did not list/);
    }
  });

  it('ruling F: a value found and boxed inside a line the file reading cannot cut gets no box beside it, no "showed outside" note, and its words stay', async () => {
    // One show writes the line (as printed files do). In a font read by its glyph names the file reading cannot
    // cut it, so the renderer's reading is the proof; in Helvetica the file reading cuts it (the comparison).
    // The twins split the line into three shows at the same places, to hide the value or the words.
    const [before, after] = ['PAN of the assessee: ', ', verified on 14 Nov 2026'];
    const LINE = `${before}${VALUE}${after}`;
    const kept: Record<string, number> = {};
    for (const named of [true, false]) {
      const make = async (hide: 'none' | 'value' | 'words') => {
        const b = await newDoc();
        const f = namedFont(b, LINE.replace(/[:,]/g, ' '));
        const enc = named ? f.enc : LINE;
        const [w1, v, w2] = [enc.slice(0, before.length), enc.slice(before.length, before.length + VALUE.length), enc.slice(before.length + VALUE.length)];
        const line =
          hide === 'none' ? `${lit(enc)} Tj` : `${hidden3(hide === 'words', `${lit(w1)} Tj`)} ${hidden3(hide === 'value', `${lit(v)} Tj`)} ${hidden3(hide === 'words', `${lit(w2)} Tj`)}`;
        rawPage(b, `BT /${named ? 'FD' : 'F1'} 11 Tf 72 700 Td ${line} ET BT /F1 11 Tf 72 660 Td (Ordinary words on the line below) Tj ET`, { Font: b.doc.context.obj({ F1: b.font.ref, FD: f.ref } as never) });
        return save(b);
      };
      const [visible, valueHidden, wordsHidden] = [await make('none'), await make('value'), await make('words')];
      const source = pdf(`W3-F-ordinary-line-${named ? 'named' : 'plain'}.pdf`, visible, 1);
      const { options } = await reviewed(source);
      expect(options.areas.length).toBeGreaterThan(0);
      const made = await makeStep(env)(harness().run, [source], options);
      const result = made.files[0].bytes;
      expect((await inkLeft(env, visible, valueHidden, result, 0)).left).toBe(0);
      expect(made.describe(made.files).detail).not.toMatch(/showed outside the places found/);
      const words = await inkLeft(env, visible, wordsHidden, result, 0);
      expect(words.ink).toBeGreaterThan(0);
      kept[named ? 'named' : 'plain'] = words.left / words.ink;
    }
    // The renderer's proof keeps as much of the words as the file reading's.
    expect(kept.named).toBeGreaterThanOrEqual(kept.plain - 0.01);
  });
});

// ---- wave 4 (RX-RUN2): redact-fix-rules-5.md ruling M, the copy allow-list --------------------------------------

/** True when page `index` of `bytes` is one the build rebuilt: a picture, no comment, no font that is not the text layer's own. */
async function isPicturePage(bytes: Uint8Array, index: number): Promise<boolean> {
  const doc = await PDFDocument.load(bytes);
  const ctx = doc.context;
  const node = doc.getPage(index).node;
  const resources = ctx.lookup(node.get(N('Resources')));
  const dict = (v: unknown) => (v && typeof (v as { get?: unknown }).get === 'function' ? (v as { get(k: PDFName): PDFObject | undefined; entries(): [PDFName, PDFObject][] }) : undefined);
  const res = dict(resources);
  const xo = dict(res ? ctx.lookup(res.get(N('XObject'))) : undefined);
  const image = (xo?.entries() ?? []).some(([, v]) => {
    const s = ctx.lookup(v) as { dict?: { get(k: PDFName): PDFObject | undefined } } | undefined;
    return s?.dict?.get(N('Subtype')) === N('Image');
  });
  const fonts = dict(res ? ctx.lookup(res.get(N('Font'))) : undefined);
  const odd = (fonts?.entries() ?? []).some(([, v]) => {
    const f = dict(ctx.lookup(v));
    return f?.get(N('Subtype')) === N('Type3') || dict(ctx.lookup(f?.get(N('Encoding'))))?.get(N('Differences')) !== undefined;
  });
  return image && node.get(N('Annots')) === undefined && !odd;
}

/** The share of page `index` that is black in `result` and was not dark in `source` (72 dpi): what Redact blacked out. */
async function blackAdded(source: Uint8Array, result: Uint8Array, index: number): Promise<number> {
  const [a, b] = [await env.renderer.renderPagePixels(source, index, 1), await env.renderer.renderPagePixels(result, index, 1)];
  if (a.width !== b.width || a.height !== b.height) return 1;
  let n = 0;
  for (let i = 0; i < a.width * a.height; i++) {
    const black = b.data[i * 4] < 40 && b.data[i * 4 + 1] < 40 && b.data[i * 4 + 2] < 40;
    const dark = a.data[i * 4] < 90 && a.data[i * 4 + 1] < 90 && a.data[i * 4 + 2] < 90;
    if (black && !dark) n++;
  }
  return n / (a.width * a.height);
}

const W16 = (b: Build, s: string) => b.font.widthOfTextAtSize(s, 16);
/** The re-tester's "split": the PAN's halves at 16 pt with another line written between them (`tm` places each piece). */
function splitPan(b: Build, hide: boolean, o: { size?: number; tm?: (x: number, y: number) => string } = {}) {
  const tm = o.tm ?? ((x: number, y: number) => `1 0 0 1 ${x} ${y} Tm`);
  const xK = 6 + W16(b, 'PAN ') + W16(b, 'QWXPT');
  return `BT /F1 ${o.size ?? 16} Tf ${tm(6, 55)} (PAN ) Tj ${hidden3(hide, '(QWXPT) Tj')} ${tm(6, 25)} (Date 14 Nov 2026) Tj ${tm(xK, 55)} ${hidden3(hide, '(4821K) Tj')} ET`;
}
const GLYPHS10 = ['Q', 'W', 'X', 'P', 'T', 'four', 'eight', 'two', 'one', 'K'];
/** Codes a to j, glyph names with a suffix (Q.sc) and no map: a Type 3 font drawing shapes (FT26), or Helvetica (FT10). */
function suffixedFont(b: Build, type3: boolean) {
  const ctx = b.doc.context;
  const names = GLYPHS10.map((g) => N(`${g}.sc`));
  return ctx.register(
    ctx.obj(
      (type3
        ? {
            Type: 'Font', Subtype: 'Type3', FontBBox: [0, 0, 1000, 1000], FontMatrix: [0.001, 0, 0, 0.001, 0, 0],
            CharProcs: Object.fromEntries(GLYPHS10.map((g, i) => [`${g}.sc`, ctx.register(ctx.flateStream(`600 0 d0 ${40 + i * 20} 0 m 500 0 l 500 ${300 + i * 40} l h f`))])),
            Encoding: { Type: 'Encoding', Differences: [0x61, ...names] }, FirstChar: 0x61, LastChar: 0x6a, Widths: GLYPHS10.map(() => 600),
          }
        : { Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica', Encoding: { Type: 'Encoding', BaseEncoding: 'WinAnsiEncoding', Differences: [0x61, ...names] } }) as never,
    ),
  );
}

describe('wave 4 (RX-RUN2), ruling M: a page is copied only when it is on the allow-list (T-048)', () => {
  /** Page 1 holds the PAN and the name (rebuilt); page 2 holds the recipe alone (copied, unless ruling M). */
  async function copiedRecipe(id: string, make: (b: Build, hide: boolean, target: PDFPage) => void) {
    const build = async (hide: boolean) => {
      const b = await newDoc();
      rawPage(b, `${PLAIN} ${SIGNED}`);
      make(b, hide, rawPage(b, ORD));
      return save(b);
    };
    const [visible, hidden] = [await build(false), await build(true)];
    const source = pdf(`${id}.pdf`, visible, 2);
    const { options } = await reviewed(source, (s) => s, {}, typed.terms);
    expect(new Set(options.areas.map((a) => a.page)), id).toEqual(new Set([0]));
    const made = await makeStep(env)(harness().run, [source], options);
    const result = made.files[0].bytes;
    return { result, detail: made.describe(made.files).detail ?? '', ink: await inkLeft(env, visible, hidden, result, 1), visible };
  }

  it("FT26-C: a Type 3 font with suffixed glyph names (letters pdf.js invents) alone on a copied page: the page is rebuilt and the glyphs covered", async () => {
    const out = await copiedRecipe('M-FT26-C', (b, hide, target) => {
      target.node.set(N('Resources'), b.doc.context.obj({ Font: { F1: b.font.ref, T3: suffixedFont(b, true) } } as never));
      target.node.set(N('Contents'), b.doc.context.register(b.doc.context.flateStream(`${ORD} BT /T3 16 Tf 100 600 Td ${hidden3(hide, '(abcdefghij) Tj')} ET`)));
    });
    expect(await isPicturePage(out.result, 1)).toBe(true);
    expect(out.ink.ink).toBeGreaterThan(0);
    expect(out.ink.left).toBe(0);
  });

  it('FT10-C: Helvetica with suffixed glyph names and no map alone on a copied page: the page is rebuilt (another reader reads the PAN from the names)', async () => {
    const out = await copiedRecipe('M-FT10-C', (b, hide, target) => {
      target.node.set(N('Resources'), b.doc.context.obj({ Font: { F1: b.font.ref, FX: suffixedFont(b, false) } } as never));
      target.node.set(N('Contents'), b.doc.context.register(b.doc.context.flateStream(`${ORD} BT /FX 16 Tf 100 600 Td ${hidden3(hide, '(abcdefghij) Tj')} ET`)));
    });
    expect(await isPicturePage(out.result, 1)).toBe(true);
    // The font whose glyph names give the PAN to other readers is gone from the result.
    expect(rawHaystack(out.result).includes('/Q.sc')).toBe(false);
  });

  it('DM01d-C: an inline image whose first EI is followed by NUL, then the split PAN as page text, alone on a copied page: the page is rebuilt', async () => {
    const out = await copiedRecipe('M-DM01d-C', (b, hide, target) => {
      const content = `${ORD} BI /W 2 /H 1 /BPC 8 /CS /G ID \u0000\u0000EI\u0000 ${splitPan(b, hide).replace(/1 0 0 1 ([\d.]+) (\d+) Tm/g, (_m, x, y) => `1 0 0 1 ${100 + Number(x)} ${545 + Number(y)} Tm`)} EI Q q Q`;
      target.node.set(N('Contents'), b.doc.context.register(b.doc.context.flateStream(Uint8Array.from(content, (c) => c.charCodeAt(0) & 0xff))));
    });
    expect(await isPicturePage(out.result, 1)).toBe(true);
    expect(rawHaystack(out.result).includes('QWXPT')).toBe(false);
  });

  it('AG23-C: a stamp writing the split PAN with a negative font size alone on a copied page: the page is rebuilt (its stamp no longer copied as text)', async () => {
    const out = await copiedRecipe('M-AG23-C', (b, hide, target) => {
      const stamp = formOf(b, splitPan(b, hide, { size: -16, tm: (x, y) => `1 0 0 1 ${300 - x} ${85 - y} Tm` }), [0, 0, 320, 90]);
      addAnnot(b, target, { Subtype: 'Stamp', Rect: [100, 470, 420, 560], AP: b.doc.context.obj({ N: stamp } as never) });
    });
    expect(await isPicturePage(out.result, 1)).toBe(true);
    expect(rawHaystack(out.result).includes('4821K')).toBe(false);
  });

  it('my variations: an ordinary inline image makes its page a picture with its words searchable and one sentence; a plain page beside it stays copied', async () => {
    const b = await newDoc();
    rawPage(b, `${PLAIN} ${SIGNED}`);
    rawPage(b, `q 40 0 0 20 60 700 cm BI /W 2 /H 1 /BPC 8 /CS /G ID AB EI Q ${ORD}`);
    rawPage(b, 'BT /F1 11 Tf 60 780 Td (A plain page of ordinary words) Tj ET');
    const bytes = await save(b);
    const source = pdf('M-inline-image.pdf', bytes, 3);
    const { options } = await reviewed(source, (s) => s, {}, typed.terms);
    const made = await makeStep(env)(harness().run, [source], options);
    const result = made.files[0].bytes;
    expect(await isPicturePage(result, 1)).toBe(true);
    expect(await isPicturePage(result, 2)).toBe(false);
    const texts = (await pdfjsTexts(result)).map((t) => t.replace(/\s+/g, ''));
    expect(texts[1]).toMatch(/Ordinarywordsonlyonthispage/);
    expect(texts[2]).toMatch(/Aplainpageofordinarywords/);
    expect(await blackAdded(bytes, result, 1)).toBeLessThan(0.0005);
    const detail = made.describe(made.files).detail ?? '';
    expect(detail).toMatch(/^2 areas removed on page 1; that page is now a picture with searchable text\./);
    expect(detail).toMatch(/Page 2 was also made a picture, to be safe\./);
    expect(detail).not.toMatch(/Page 3/);
  });

  it('my variations: mirrored words in a negative font size on a copied page holding no value: rebuilt as it shows, nothing blacked out, one sentence', async () => {
    const make = async (hide: boolean) => {
      const b = await newDoc();
      rawPage(b, `${PLAIN} ${SIGNED}`);
      rawPage(b, `${ORD} BT /F1 -16 Tf -1 0 0 -1 300 600 Tm ${hidden3(hide, '(Mirrored words) Tj')} ET`);
      return save(b);
    };
    const [visible, hidden] = [await make(false), await make(true)];
    const source = pdf('M-negative-size.pdf', visible, 2);
    const { options } = await reviewed(source, (s) => s, {}, typed.terms);
    const made = await makeStep(env)(harness().run, [source], options);
    const result = made.files[0].bytes;
    expect(await isPicturePage(result, 1)).toBe(true);
    // The mirrored words are not a chosen value: nothing on the page was blacked out.
    expect((await inkLeft(env, visible, hidden, result, 1)).ink).toBeGreaterThan(0);
    expect(await blackAdded(visible, result, 1)).toBeLessThan(0.0005);
    expect(made.describe(made.files).detail).toMatch(/Page 2 was also made a picture, to be safe\./);
  });

  it('FT06-C and FT07-C: Helvetica whose glyph names spell the PAN and whose map lies (private-use, or other letters), alone on a copied page: rebuilt and covered', async () => {
    for (const lie of ['private-use', 'letters'] as const) {
      const out = await copiedRecipe(`M-FT0${lie === 'private-use' ? 6 : 7}-C`, (b, hide, target) => {
        const ctx = b.doc.context;
        const f = codedFont(b, VALUE);
        if (lie === 'letters') {
          const font = ctx.lookup(f.ref) as unknown as { set(k: PDFName, v: unknown): void };
          const lines = [...new Set(Array.from(VALUE))].map((_, i) => `<${(0x61 + i).toString(16)}> <${(0x61 + i).toString(16).padStart(4, '0')}>`);
          font.set(N('ToUnicode'), ctx.register(ctx.flateStream(`/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CMapName /Wrong def /CMapType 2 def 1 begincodespacerange <00> <FF> endcodespacerange ${lines.length} beginbfchar ${lines.join(' ')} endbfchar endcmap CMapName currentdict /CMap defineresource pop end end`)));
        }
        target.node.set(N('Resources'), ctx.obj({ Font: { F1: b.font.ref, FX: f.ref } } as never));
        target.node.set(N('Contents'), ctx.register(ctx.flateStream(`${ORD} BT /FX 16 Tf 100 600 Td ${hidden3(hide, `${lit(f.enc)} Tj`)} ET`)));
      });
      expect(await isPicturePage(out.result, 1), lie).toBe(true);
      expect(out.ink.ink, lie).toBeGreaterThan(0);
      expect(out.ink.left, lie).toBe(0);
    }
  });

  it('FT16-C, FT16b-C and FT17-C: an embedded CID font with no map, or a private-use map, writing the PAN (and the typed name) alone on a copied page: rebuilt and covered', async () => {
    for (const recipe of ['FT16', 'FT16b', 'FT17'] as const) {
      const build = async (hide: boolean) => {
        const { jsPDF } = await import('jspdf');
        const fs = await import('node:fs');
        const { STANDARD_FONTS_DIR } = await import('@/lib/pdf-tools/testRedactPdf');
        const j = new jsPDF({ unit: 'pt', format: [595, 842], compress: true });
        j.addFileToVFS('liberation.ttf', fs.readFileSync(`${STANDARD_FONTS_DIR}LiberationSans-Regular.ttf`).toString('base64'));
        j.addFont('liberation.ttf', 'liberation', 'normal');
        j.setFont('helvetica', 'normal');
        j.setFontSize(11);
        j.text(`PAN of the assessee: ${VALUE}`, 60, 62);
        j.text(`Signed by ${SIGNER}, Partner`, 60, 102);
        j.addPage();
        j.text('Ordinary words only on this page', 60, 62);
        j.setFont('liberation', 'normal');
        j.setFontSize(16);
        const mode = hide ? { renderingMode: 'invisible' as const } : {};
        j.text(VALUE, 100, 242, mode);
        if (recipe === 'FT16b') j.text(SIGNER, 100, 282, mode);
        const doc = await PDFDocument.load(new Uint8Array(j.output('arraybuffer')));
        const ctx = doc.context;
        for (const [, object] of ctx.enumerateIndirectObjects()) {
          const dict = object as unknown as { get?(k: PDFName): PDFObject | undefined; set?(k: PDFName, v: PDFObject): void; delete?(k: PDFName): void };
          if (typeof dict.get !== 'function' || dict.get(N('Subtype')) !== N('Type0')) continue;
          if (recipe === 'FT17') {
            const cmap = '/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CMapName /Pua def /CMapType 2 def 1 begincodespacerange <0000> <FFFF> endcodespacerange 1 beginbfrange <0000> <0FFF> <E000> endbfrange endcmap CMapName currentdict /CMap defineresource pop end end';
            dict.set!(N('ToUnicode'), ctx.register(ctx.flateStream(cmap)));
          } else dict.delete!(N('ToUnicode'));
        }
        return doc.save({ useObjectStreams: false });
      };
      const [visible, hidden] = [await build(false), await build(true)];
      const source = pdf(`M-${recipe}-C.pdf`, visible, 2);
      const { options } = await reviewed(source, (s) => s, {}, typed.terms);
      const made = await makeStep(env)(harness().run, [source], options);
      const result = made.files[0].bytes;
      expect(await isPicturePage(result, 1), recipe).toBe(true);
      const ink = await inkLeft(env, visible, hidden, result, 1);
      expect(ink.ink, recipe).toBeGreaterThan(0);
      expect(ink.left, recipe).toBe(0);
    }
  });

  it('my variations: an OCR-like text layer left in render mode 3 with a signature stamp writing the name in pieces, on a copied page: rebuilt, and the name covered', async () => {
    const out = await copiedRecipe('M-text-state-stamp', (b, hide, target) => {
      target.node.set(N('Contents'), b.doc.context.register(b.doc.context.flateStream(`${ORD} BT 3 Tr /F1 9 Tf 60 400 Td (scanned page text layer) Tj ET`)));
      const stamp = formOf(b, `BT /F1 12 Tf 1 0 0 1 6 40 Tm (Signed: ) Tj ${hidden3(hide, '(Ramesh Kumar) Tj')} 1 0 0 1 6 20 Tm (14 Nov 2026) Tj 1 0 0 1 ${6 + b.font.widthOfTextAtSize('Signed: Ramesh Kumar ', 12)} 40 Tm ${hidden3(hide, '(Gupta) Tj')} ET`, [0, 0, 320, 60]);
      addAnnot(b, target, { Subtype: 'Stamp', Rect: [100, 470, 420, 530], AP: b.doc.context.obj({ N: stamp } as never) });
    });
    expect(await isPicturePage(out.result, 1)).toBe(true);
    expect(rawHaystack(out.result).includes('Gupta')).toBe(false);
  });
});

describe('wave 6 (RX-RUN2): a busy machine (T-048)', () => {
  it('a drawing the busy renderer could not finish is drawn again; if it never can, the run says the computer was busy, not that a page could not be drawn', async () => {
    const make = async () => {
      const b = await newDoc();
      rawPage(b, PLAIN);
      return save(b);
    };
    const bytes = await make();
    let fails = 2;
    const flaky = { ...env, renderer: { ...env.renderer, renderPagePixels: (...a: Parameters<typeof env.renderer.renderPagePixels>) => (fails-- > 0 ? Promise.reject(new RenderTimeoutError()) : env.renderer.renderPagePixels(...a)) } };
    const source = pdf('busy.pdf', bytes, 1);
    const { options } = await reviewed(source);
    const made = await makeStep(flaky)(harness().run, [source], options);
    expect(made.files).toHaveLength(1);
    const stuck = { ...env, renderer: { ...env.renderer, renderPagePixels: () => Promise.reject(new RenderTimeoutError()) } };
    const error = (await makeStep(stuck)(harness().run, [source], (await reviewed(source)).options).catch((e: unknown) => e)) as Error;
    expect(error.message).toBe('The computer was too busy to finish. Nothing was added. Close other programs, then try again.');
  });
});

describe('wave 4 (RX-RUN2), K4: a scan with a hidden text layer (T-048)', () => {
  it('a page whose only text is an invisible layer over a picture gets one sentence: the picture may still show a value the layer misread', async () => {
    const make = async (ocr: boolean) => {
      const b = await newDoc();
      const ctx = b.doc.context;
      const image = ctx.register(ctx.flateStream(new Uint8Array(64 * 64).fill(200), { Type: 'XObject', Subtype: 'Image', Width: 64, Height: 64, ColorSpace: 'DeviceGray', BitsPerComponent: 8 } as never));
      const layer = `BT 3 Tr /F1 11 Tf 60 780 Td ${lit(`PAN of the assessee: ${VALUE}`)} Tj ET`;
      rawPage(b, ocr ? `q 475 0 0 700 60 80 cm /Im0 Do Q ${layer}` : `q 475 0 0 700 60 80 cm /Im0 Do Q ${PLAIN}`, { XObject: ctx.obj({ Im0: image } as never) });
      return save(b);
    };
    for (const ocr of [true, false]) {
      const bytes = await make(ocr);
      const source = pdf(`K4-${ocr ? 'scan' : 'text'}.pdf`, bytes, 1);
      const { options } = await reviewed(source);
      expect(options.areas.length, String(ocr)).toBeGreaterThan(0);
      const made = await makeStep(env)(harness().run, [source], options);
      const detail = made.describe(made.files).detail ?? '';
      if (ocr) expect(detail).toMatch(/Page 1 is a scan with hidden text: where that text misread a value, the scan may still show it, so look at the page\./);
      else expect(detail).not.toMatch(/is a scan with hidden text/);
    }
  });
});

// ---- wave 4 (RX-RUN2): redact-fix-rules-4.md K1, Indian-script text on a rebuilt page -----------------------------

/** Stand-in letters the composite font's map turns into Devanagari; `q` is a cluster's other glyph (U+0000, as Chrome writes). */
const DEVANAGARI: Readonly<Record<string, string>> = {
  k: 'क', a: 'ा', m: 'म', r: 'र', g: 'ग', u: 'ु', s: 'स', i: 'ि', e: 'े', n: 'न', t: 'त', p: 'प', d: 'द', l: 'ल', y: 'य', h: 'ह',
  c: 'च', o: 'ो', v: 'व', b: 'ब', j: 'ज', f: 'फ', w: 'व', x: 'ख', z: 'झ', q: '\u0000',
};
const HINDI_LINES = ['kaqrya laya ka adeqsh', 'is suqchana ke anuqsar', 'aap apna paqtra sahit', 'nirdhaqrit tithi tak', 'upaqsthit hon athva likhit', 'utqtar dein yah adeqsh'];

/**
 * An invented bilingual notice: Latin lines in Helvetica (the PAN and the signer: `hide` makes them invisible for the
 * twin), and six "Hindi" lines in a composite font (Liberation Sans written by jsPDF as Identity-H) whose map gives
 * Devanagari letters, each cluster's other glyph U+0000, as Chrome writes Indian scripts (re-test 3, H14). An English
 * word ends each Hindi line. `beside`: a cluster glyph shown on its own right after a Latin label, so that the file
 * reading refuses the whole font (as on H14). `digits`: two cluster glyphs before a tab and digits (as on H15).
 */
async function bilingualNotice(hide: boolean, opts: { beside?: boolean; digits?: boolean } = {}): Promise<Uint8Array> {
  const { jsPDF } = await import('jspdf');
  const fs = await import('node:fs');
  const { STANDARD_FONTS_DIR } = await import('@/lib/pdf-tools/testRedactPdf');
  const j = new jsPDF({ unit: 'pt', format: [595, 842], compress: false });
  j.addFileToVFS('liberation.ttf', fs.readFileSync(`${STANDARD_FONTS_DIR}LiberationSans-Regular.ttf`).toString('base64'));
  j.addFont('liberation.ttf', 'liberation', 'normal');
  j.setFont('liberation', 'normal');
  j.setFontSize(14);
  HINDI_LINES.forEach((line, i) => j.text(line, 60, 200 + i * 28));
  if (opts.beside) {
    j.text('ADDRESS', 60, 380);
    j.text('q', 60 + j.getTextWidth('ADDRESS') + 2, 380);
    j.text('ai kamra', 60 + j.getTextWidth('ADDRESS') + 2 + j.getTextWidth('q'), 380);
  }
  if (opts.digits) j.text('sanqq\t50100', 60, 410);
  const doc = await PDFDocument.load(new Uint8Array(j.output('arraybuffer')));
  const ctx = doc.context;
  // The map: each stand-in letter's glyph to its Devanagari letter (capitals and digits stay Latin).
  for (const [, object] of ctx.enumerateIndirectObjects()) {
    const dict = object as unknown as { get?(k: PDFName): PDFObject | undefined; set?(k: PDFName, v: PDFObject): void };
    if (typeof dict.get !== 'function' || dict.get(N('Subtype')) !== N('Type0')) continue;
    const ref = dict.get(N('ToUnicode')) as unknown as Parameters<typeof ctx.lookup>[0];
    const stream = ctx.lookup(ref) as unknown as { getContents(): Uint8Array };
    const text = Buffer.from(stream.getContents()).toString('latin1');
    const pairs = [...text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)].flatMap((block) => [...block[1].matchAll(/<([0-9a-fA-F]{4})>\s*<([0-9a-fA-F]{4})>/g)]);
    const lines = pairs.map((m) => {
      const ch = String.fromCharCode(parseInt(m[2], 16));
      const to = DEVANAGARI[ch] ?? ch;
      return `<${m[1]}> <${to.charCodeAt(0).toString(16).padStart(4, '0')}>`;
    });
    const cmap = `/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CMapName /Adobe-Identity-UCS def /CMapType 2 def 1 begincodespacerange <0000> <FFFF> endcodespacerange ${lines.length} beginbfchar ${lines.join(' ')} endbfchar endcmap CMapName currentdict /CMap defineresource pop end end`;
    dict.set!(N('ToUnicode'), ctx.register(ctx.flateStream(cmap)));
  }
  const page = doc.getPage(0);
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const res = ctx.lookup(page.node.get(N('Resources'))) as unknown as { get(k: PDFName): PDFObject | undefined };
  const fonts = ctx.lookup(res.get(N('Font'))) as unknown as { set(k: PDFName, v: PDFObject): void };
  fonts.set(N('HV'), helv.ref);
  const latin = [
    `BT /HV 11 Tf 60 780 Td (PAN of the assessee: ) Tj ${hidden3(hide, `(${VALUE}) Tj`)} ET`,
    `BT /HV 11 Tf 60 760 Td (Signed by ) Tj ${hidden3(hide, `(${SIGNER}) Tj`)} (, Partner) Tj ET`,
    ...HINDI_LINES.map((line, i) => `BT /HV 11 Tf ${60 + 7.5 * line.length + 12} ${842 - 200 - i * 28} Td (notice) Tj ET`),
  ].join('\n');
  const contents = page.node.get(N('Contents'));
  page.node.set(N('Contents'), ctx.obj([...(contents && 'asArray' in (contents as object) ? (contents as unknown as { asArray(): PDFObject[] }).asArray() : [contents as PDFObject]), ctx.register(ctx.flateStream(latin))]));
  return doc.save({ useObjectStreams: false });
}

describe('wave 4 (RX-RUN2), K1: text that holds no chosen value stays visible on a rebuilt page (T-048)', () => {
  /** Black added on page 1 and what the review asked (the areas' share of the page). */
  async function measure(visible: Uint8Array, opts: { terms?: { text: string; reason: string }[] } = {}) {
    const source = pdf('K1-notice.pdf', visible, 1);
    const { options } = await reviewed(source, (s) => s, {}, opts.terms ?? typed.terms);
    const made = await makeStep(env)(harness().run, [source], options);
    const result = made.files[0].bytes;
    const asked = options.areas.filter((a) => a.page === 0 && !a.hidden).flatMap((a) => a.rects).reduce((s, r) => s + Math.abs((r.x1 - r.x0) * (r.y1 - r.y0)), 0) / (595 * 842);
    return { result, black: await blackAdded(visible, result, 0), asked, detail: made.describe(made.files).detail ?? '' };
  }

  it("the re-tester's H14 shape: Hindi in a composite font with cluster glyphs, one of them beside a Latin label; only the Latin values asked: black within a point of what was asked, the values gone, the English words kept", async () => {
    const [visible, hidden] = [await bilingualNotice(false, { beside: true }), await bilingualNotice(true, { beside: true })];
    const out = await measure(visible);
    expect((await inkLeft(env, visible, hidden, out.result, 0)).left).toBe(0);
    expect(out.black).toBeLessThan(out.asked + 0.01);
    const text = (await pdfjsTexts(out.result))[0];
    expect(text.match(/notice/g)?.length ?? 0).toBeGreaterThanOrEqual(5);
    // Ruling R (wave 5): only the glyph beside the label was covered, by itself: never "covered whole" (T4-B, H14).
    expect(out.detail).not.toMatch(/covered whole/);
    expect(out.detail).toMatch(/On page 1, some letters that could not be read were covered, to be safe\./);
    expect(out.detail).toMatch(/cannot be made searchable \(for example Hindi and ₹\)/);
  });

  it('my variations: two cluster glyphs before a tab and digits (H15) are covered by themselves only; the same with no Latin beside anything', async () => {
    for (const opts of [{ digits: true }, {}]) {
      const [visible, hidden] = [await bilingualNotice(false, opts), await bilingualNotice(true, opts)];
      const out = await measure(visible);
      expect((await inkLeft(env, visible, hidden, out.result, 0)).left, JSON.stringify(opts)).toBe(0);
      expect(out.black, JSON.stringify(opts)).toBeLessThan(out.asked + 0.01);
    }
  });

  it('wave 5, ruling R: a Devanagari word typed and placed nowhere: every run of that script that cannot be read is covered whole, as round 3 did, and the result says so', async () => {
    const visible = await bilingualNotice(false, { beside: true });
    // A word of letters the page does not hold: the find places it nowhere (T4-B: the conjunct of a typed name).
    const out = await measure(visible, { terms: [...typed.terms, { text: 'ठढण', reason: 'Typed' }] });
    expect(out.black).toBeGreaterThan(out.asked + 0.015);
    expect(out.detail).toMatch(/On page 1, text or a drawing that could not be read was covered whole, to be safe\./);
    expect(out.detail).not.toMatch(/It is still visible/);
    // The English word at the end of each Hindi line is drawn apart: it stays.
    expect((await pdfjsTexts(out.result))[0].match(/notice/g)?.length ?? 0).toBeGreaterThanOrEqual(5);
  });

  it('wave 5, ruling R: a Devanagari word typed and found: the other cluster glyphs are covered by themselves, so far less is covered than when it is found nowhere', async () => {
    const visible = await bilingualNotice(false, { beside: true });
    // "लाया": the stand-ins "laya" of the first Hindi line. That line also has a cluster glyph, so the proof cannot
    // tell its parts apart and covers it whole (said so); every other line keeps its words.
    const found = await measure(visible, { terms: [...typed.terms, { text: 'लाया', reason: 'Typed' }] });
    const nowhere = await measure(visible, { terms: [...typed.terms, { text: 'ठढण', reason: 'Typed' }] });
    expect(found.asked).toBeGreaterThan(nowhere.asked);
    expect(found.black).toBeGreaterThan(found.asked + 0.002);
    expect(found.black).toBeLessThan(nowhere.black - 0.006);
    expect(found.detail).toMatch(/On page 1, text or a drawing that could not be read was covered whole, to be safe\./);
  });
});
// ---- final pass (T-048), F1: the judge's answer for one text is searched one chosen value at a time -----------------

/** About 200 invented values (100 PAN-shaped, 100 typed names) and a page of text that holds each of them. */
function manyValues() {
  const letters = 'ABCDEFGHJKLMNQRSTUVWXYZ';
  const pans = Array.from({ length: 100 }, (_, i) => `Q${letters[i % 23]}${letters[(i * 7) % 23]}P${letters[(i * 3) % 23]}${String(1000 + i * 37).slice(-4)}${letters[(i * 5) % 23]}`);
  const names = Array.from({ length: 100 }, (_, i) => `Zor${letters[i % 23].toLowerCase()}vane Quill${letters[(i * 11) % 23].toLowerCase()}feather${i}`);
  const targets = [
    ...pans.map((v) => ({ kind: 'pan' as const, forms: [v], wholeWord: false })),
    ...names.map((v) => ({ kind: 'typed' as const, forms: [v, v.toUpperCase()], wholeWord: true })),
  ];
  const text = pans.map((v, i) => `Row ${i + 1} PAN ${v} of ${names[i]} amount 1,2${i},000.00 and again ${v.split('').join(' ')} by ${names[(i + 1) % 100].toUpperCase()}`).join('\n');
  return { targets, text };
}

describe('final pass, F1: one answer of the judge in turns (T-048)', () => {
  it('gives exactly the answer of the search made at once, on a text with about 200 values', async () => {
    const { targets, text } = manyValues();
    const atOnce = spansOf(targets, text);
    expect(targets).toHaveLength(200);
    expect(atOnce.length).toBeGreaterThanOrEqual(300);
    expect(await spansInTurns(targets, text, () => undefined)).toEqual(atOnce);
    // The same when every chance of a turn is taken.
    expect(await spansInTurns(targets, text, () => Promise.resolve())).toEqual(atOnce);
  });

  it('asks for a turn before each chosen value, and waits for the turn it is given', async () => {
    const { targets, text } = manyValues();
    let asked = 0;
    let waiting = 0;
    let overlapped = false;
    const pace = () => {
      asked += 1;
      if (waiting > 0) overlapped = true;
      waiting += 1;
      return new Promise<void>((resolve) => setTimeout(() => {
        waiting -= 1;
        resolve();
      }, 0));
    };
    await spansInTurns(targets, text, pace);
    expect(asked).toBe(targets.length);
    expect(overlapped).toBe(false);
  });

  it('a Stop lands at the next turn: nothing is searched after it', async () => {
    const { targets, text } = manyValues();
    let asked = 0;
    const stop = new Error('stopped');
    const pace = () => {
      asked += 1;
      if (asked === 5) throw stop;
      return undefined;
    };
    await expect(spansInTurns(targets, text, pace)).rejects.toBe(stop);
    expect(asked).toBe(5);
  });

  it('the judge takes every answer from the search in turns, never from one made at once, and its verdict is the same', async () => {
    const { targets, text } = manyValues();
    const texts = [text, text.slice(0, 4000), 'no value here at all'];
    const judge = (holds: (t: string) => boolean, spans: (t: string) => [number, number][]) => texts.map((t) => (holds(t) ? spans(t) : []));
    const holds = (t: string) => t.includes('PAN');
    const expected = judge(holds, (t) => spansOf(targets, t));
    const searched: string[] = [];
    let turns = 0;
    const memo = { holds: new Map<string, boolean>(), spans: new Map<string, [number, number][]>() };
    const verdict = await judgeWithSpansInTurns(
      judge,
      {
        holds,
        spansInTurns: (t) => {
          searched.push(t);
          return spansInTurns(targets, t, () => {
            turns += 1;
            return undefined;
          });
        },
      },
      () => undefined,
      memo,
    );
    expect(verdict).toEqual(expected);
    expect(expected[0].length).toBeGreaterThanOrEqual(300);
    // Each text that holds a value was searched once, in turns; the kept answers are the real ones.
    expect(searched).toEqual([text, text.slice(0, 4000)]);
    expect(turns).toBe(2 * targets.length);
    expect(memo.spans.get(text)).toEqual(expected[0]);
    // Asked again for the same page, nothing is searched again.
    expect(await judgeWithSpansInTurns(judge, { holds, spansInTurns: () => Promise.reject(new Error('searched again')) }, () => undefined, memo)).toEqual(expected);
  });
});
