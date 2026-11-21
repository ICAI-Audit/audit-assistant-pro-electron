// The Document check run step (documentCheckRun.ts) on the step contract of toolStep.ts: one PDF in, one PDF
// report out, `<name>_check.pdf`, built with run.verifyPdf then run.result (never run.pdfResult: the report is
// not a copy of the signed file). The record holds RECORD_KEYS only. Every file is invented and built here; the
// page text is read with pdf.js, as the app's reader does.
import { PDFDocument, PDFHexString, PDFName, PDFString, StandardFonts } from 'pdf-lib';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { buildActivityEntry } from '@/lib/pdf-tools/activity';
import { charsIn, checkDocument, type DocumentFacts } from '@/lib/pdf-tools/documentCheck';
import { inspectPdf } from '@/lib/pdf-tools/inspect';
import { createWorkingListStore, LIST_MAX_BYTES, LIST_WARN_BYTES } from '@/lib/pdf-tools/workingList';
import { PROTECTED_OUTPUT_REASON, type WorkingFile } from '@/lib/pdf-tools/types';
import { runTool } from '../runTool';
import { Cancelled, Run, Stale, type RunContext, type StepDeps } from '../toolStep';
import { RECORD_KEYS } from './documentCheckForm';
import { BUILT, createStep, type DocumentCheckRunOptions, type PageTextReader } from './documentCheckRun';

vi.setConfig({ testTimeout: 90_000 });

const MARKERS = ['MKCHECKTITLE', 'MKCHECKAUTHOR', 'MKCHECKSIGNER', 'MKCHECKREASON', 'MKCHECKPLACE'];

/** A three-page signed file whose title, author and signature carry markers. */
async function signedFile(): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let n = 1; n <= 3; n++) doc.addPage([300, 400]).drawText(`Invented statement page ${n} with plenty of words`, { x: 20, y: 200, size: 9, font });
  doc.setTitle('MKCHECKTITLE');
  doc.setAuthor('MKCHECKAUTHOR');
  const { context } = doc;
  const page = doc.getPage(0);
  const sig = context.register(
    context.obj({
      Type: 'Sig',
      Filter: 'Adobe.PPKLite',
      ByteRange: [0, 10, 20, 30],
      Contents: PDFHexString.of('00'.repeat(32)),
      Name: PDFString.of('MKCHECKSIGNER'),
      M: PDFString.of("D:20261117140500+05'30'"),
      Reason: PDFString.of('MKCHECKREASON'),
      Location: PDFString.of('MKCHECKPLACE'),
    }),
  );
  const widget = context.register(context.obj({ Type: 'Annot', Subtype: 'Widget', FT: 'Sig', T: PDFString.of('Signature1'), V: sig, Rect: [0, 0, 0, 0], P: page.ref }));
  page.node.set(PDFName.of('Annots'), context.obj([widget]));
  doc.catalog.set(PDFName.of('AcroForm'), context.obj({ Fields: [widget], SigFlags: 3 }));
  return doc.save({ useObjectStreams: false });
}

/** pdf.js text counts, as the app's reader makes them (one document per file, opened once). */
function pdfjsReader(): PageTextReader & { calls: number[] } {
  const docs = new Map<Uint8Array, Promise<{ getPage(n: number): Promise<{ getTextContent(): Promise<{ items: unknown[] }> }> }>>();
  const calls: number[] = [];
  return {
    calls,
    async pageChars(file, pageIndex) {
      calls.push(pageIndex);
      if (!docs.has(file)) {
        docs.set(
          file,
          import('pdfjs-dist/legacy/build/pdf.mjs').then(({ getDocument }) => getDocument({ data: file.slice(), isEvalSupported: false, verbosity: 0 }).promise as never),
        );
      }
      const doc = await docs.get(file)!;
      const content = await (await doc.getPage(pageIndex + 1)).getTextContent();
      return charsIn(content.items.map((item) => ({ str: typeof item === 'object' && item !== null && 'str' in item ? String((item as { str: unknown }).str) : '' })));
    },
  };
}

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
  const labels: string[] = [];
  const progress = vi.fn((_done: number, total: number, label?: string) => {
    if (label) labels.push(`${label}|${total}`);
  });
  const ctx: RunContext = { contextKey: 'u1:A', session: store.getState().session, store, signal: controller.signal, onProgress: progress };
  const deps: StepDeps = { inspectPdf, paint: async () => undefined, yieldToUi: async () => undefined, newId: () => `id-${++seq}`, maxBytes: LIST_MAX_BYTES, warnBytes: LIST_WARN_BYTES };
  return { store, controller, labels, ctx, deps, run: new Run('document-check', ctx, deps) };
}

const NOW = () => new Date(2026, 10, 17, 14, 5);

let signed: Uint8Array;
let signedFacts: DocumentFacts;
beforeAll(async () => {
  signed = await signedFile();
  const reader = pdfjsReader();
  signedFacts = await checkDocument(signed, { size: signed.byteLength, wasProtected: false, hasRestrictions: false }, { pageChars: (i) => reader.pageChars(signed, i) });
}, 90_000);

describe('document check run step', () => {
  it('is built', () => {
    expect(BUILT).toBe(true);
  });

  it('reads the file itself when the dialog gave no facts, and adds one report named _check', async () => {
    const { run, labels } = harness();
    const reader = pdfjsReader();
    const source = pdf('Invented Statement.pdf', signed, 3, { hasSignature: true });
    const made = await createStep(reader, NOW)(run, [source], {});
    expect(reader.calls).toEqual([0, 1, 2]);
    expect(labels).toEqual(expect.arrayContaining(['Reading page 1 of 3|3', 'Reading page 3 of 3|3', 'Writing the report…|0']));
    expect(made.files).toHaveLength(1);
    const [file] = made.files;
    expect(file.name).toBe('Invented Statement_check.pdf');
    expect(file.kind).toBe('pdf');
    expect(file.mimeType).toBe('application/pdf');
    expect(file.pageCount).toBe(1);
    expect(file.origin).toBe('result');
    // The report is not a copy of the signed file: it is never marked as one.
    expect(file.signatureInvalid).toBeUndefined();
    expect(file.hasSignature).toBe(false);
    expect(file.carried).toBeUndefined();
    expect(file.operation?.summary).toBe('Document check: 3 pages');
    expect(file.operation?.flags).toBeUndefined();
    expect(file.operation?.options).toEqual({ pages: 3, signatures: 1, pagesWithText: 3, pagesScanned: 0, protection: 'none' });
    const back = await PDFDocument.load(file.bytes, { updateMetadata: false });
    expect(back.getTitle()).toBeUndefined();
    expect(back.getAuthor()).toBeUndefined();
    expect(made.describe(made.files)).toEqual({
      message: 'Report added: Invented Statement_check.pdf',
      detail: 'Open the file in Adobe Acrobat Reader to verify the signature.',
      tone: 'success',
    });
  });

  it('uses the facts the dialog read when they fit the file, and reads again when they do not', async () => {
    const source = pdf('Invented Statement.pdf', signed, 3, { hasSignature: true });
    const reader = pdfjsReader();
    const made = await createStep(reader, NOW)(harness().run, [source], { facts: signedFacts });
    expect(reader.calls).toEqual([]);
    expect(made.files[0].operation?.options).toEqual({ pages: 3, signatures: 1, pagesWithText: 3, pagesScanned: 0, protection: 'none' });

    for (const facts of [{ ...signedFacts, pageCount: 4 }, { ...signedFacts, sizeBytes: 1 }, { ...signedFacts, protection: 'password' as const }, { pageCount: 3 } as unknown as DocumentFacts]) {
      const again = pdfjsReader();
      await createStep(again, NOW)(harness().run, [source], { facts });
      expect(again.calls).toEqual([0, 1, 2]);
    }
  });

  it('takes the typed name, cleaned, and falls back to the default', async () => {
    const source = pdf('Invented Statement.pdf', signed, 3);
    const named = await createStep(pdfjsReader(), NOW)(harness().run, [source], { facts: signedFacts, name: 'Year end: check' });
    expect(named.files[0].name).toBe('Year end_ check.pdf');
    const blank = await createStep(pdfjsReader(), NOW)(harness().run, [source], { facts: signedFacts, name: '  ' });
    expect(blank.files[0].name).toBe('Invented Statement_check.pdf');
  });

  it('records counts and the protection choice only: no title, author, signer or reason', async () => {
    const source = pdf('Invented Statement.pdf', signed, 3, { hasSignature: true });
    const made = await createStep(pdfjsReader(), NOW)(harness().run, [source], { facts: signedFacts });
    const [file] = made.files;
    expect(Object.keys(file.operation!.options).sort()).toEqual([...RECORD_KEYS].sort());
    const said = JSON.stringify({ summary: file.operation!.summary, options: file.operation!.options, message: made.describe(made.files) });
    for (const marker of MARKERS) expect(said).not.toContain(marker);
    const entry = buildActivityEntry({ file, destination: 'computer', sha256: 'a'.repeat(64) });
    for (const marker of MARKERS) expect(JSON.stringify(entry)).not.toContain(marker);
  });

  it('says how many words could not be printed', async () => {
    const source = pdf('बैलेंस.pdf', signed, 3);
    const made = await createStep(pdfjsReader(), NOW)(harness().run, [source], { facts: { ...signedFacts, signatures: [] } });
    expect(made.describe(made.files).detail).toBe('1 word in another script is shown as [word in another script].');
  });

  it('refuses anything but one PDF, and a file protected by PDF Tools', async () => {
    const source = pdf('Invented Statement.pdf', signed, 3);
    const step = createStep(pdfjsReader(), NOW);
    await expect(step(harness().run, [source, source], {})).rejects.toMatchObject({ code: 'wrong-input' });
    await expect(step(harness().run, [pdf('Locked.pdf', signed, 3, { protectedOutput: true })], {})).rejects.toMatchObject({ message: PROTECTED_OUTPUT_REASON });
  });

  it('stops while reading, adding nothing', async () => {
    const { run, controller } = harness();
    const inner = pdfjsReader();
    const reader: PageTextReader = {
      pageChars: async (file, i, opts) => {
        if (i === 1) controller.abort();
        return inner.pageChars(file, i, opts);
      },
    };
    await expect(createStep(reader, NOW)(run, [pdf('Invented Statement.pdf', signed, 3)], {})).rejects.toBeInstanceOf(Cancelled);
  });

  it('ends silently when the list moves on while reading', async () => {
    const { run, store } = harness();
    const inner = pdfjsReader();
    const reader: PageTextReader = {
      pageChars: async (file, i, opts) => {
        if (i === 1) store.setContext('u1:B');
        return inner.pageChars(file, i, opts);
      },
    };
    await expect(createStep(reader, NOW)(run, [pdf('Invented Statement.pdf', signed, 3)], {})).rejects.toBeInstanceOf(Stale);
  });

  it('through runTool: adds the report, and a stopped or stale run adds nothing and says nothing', async () => {
    const source = pdf('Invented Statement.pdf', signed, 3, { hasSignature: true });
    const quick = { paint: async () => undefined, yieldToUi: async () => undefined };
    const options: DocumentCheckRunOptions = { facts: signedFacts };

    const ok = harness();
    const added = await runTool('document-check', [source], options, ok.ctx, quick);
    expect(added).toMatchObject({ status: 'added', added: 1, message: 'Report added: Invented Statement_check.pdf' });
    expect(ok.store.getState().files.map((f) => f.name)).toEqual(['Invented Statement_check.pdf']);

    const stopped = harness();
    stopped.controller.abort();
    const outcome = await runTool('document-check', [source], options, stopped.ctx, quick);
    expect(outcome.status).toBe('cancelled');
    expect(stopped.store.getState().files).toEqual([]);

    const stale = harness();
    stale.store.setContext('u1:B');
    const silent = await runTool('document-check', [source], options, stale.ctx, quick);
    expect(silent).toMatchObject({ status: 'stale', added: 0 });
    expect(stale.store.getState().files).toEqual([]);
  });
});
