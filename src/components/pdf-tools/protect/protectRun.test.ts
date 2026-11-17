// The Protect run step (protectRun.ts) on the step contract of toolStep.ts: one PDF in, one AES-256
// copy out, checked by the library; the row keeps the unprotected bytes for previews; the record holds
// the protection only. Every file is built here; results are read back with pdf.js and the app's own
// unlockPdf, and searched raw (every stream inflated) for what must not be readable.
import { PDFDocument, PDFName, PDFString, StandardFonts } from 'pdf-lib';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildActivityEntry } from '@/lib/pdf-tools/activity';
import { inspectPdf } from '@/lib/pdf-tools/inspect';
import { NO_LONGER_ARCHIVAL_NOTE, PROTECT_MAX_BYTES } from '@/lib/pdf-tools/protect';
import { rawHaystack } from '@/lib/pdf-tools/testLeakPdf';
import { makeFormPdf, makePdf, pageTexts } from '@/lib/pdf-tools/testPdf';
import { unlockPdf } from '@/lib/pdf-tools/unlock';
import { createWorkingListStore, heldBytes, LIST_MAX_BYTES, LIST_WARN_BYTES } from '@/lib/pdf-tools/workingList';
import { PdfToolsError, PROTECTED_OUTPUT_REASON, type WorkingFile } from '@/lib/pdf-tools/types';
import { BUILT, step, type ProtectRunOptions } from '../protectRun';
import { runTool } from '../runTool';
import { Cancelled, Run, Stale, type RunContext, type StepDeps } from '../toolStep';
import { PHASE_LABELS } from './protectForm';

vi.setConfig({ testTimeout: 90_000 });

const PASSWORD = 'Unique-Vera-Secret-7319';
const MARKERS = ['MKPROTECTTITLE', 'MKPROTECTAUTHOR', 'MKPROTECTCOMMENT', 'MKPROTECTFIELD', 'MKPROTECTPAGETEXT'];

let three: Uint8Array;
let marked: Uint8Array;
beforeAll(async () => {
  three = await makePdf('Prot', 3);
  marked = await markedPdf();
  await pageTexts(three); // pays the cold pdf.js import once
}, 90_000);
afterEach(() => vi.restoreAllMocks());

/** A two-page PDF with a marker in its title, author, a comment, a form field and its page text, all plain in the file. */
async function markedPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([300, 400]);
  page.drawText('MKPROTECTPAGETEXT p1', { x: 20, y: 360, size: 12, font });
  doc.addPage([300, 400]).drawText('Second p2', { x: 20, y: 360, size: 12, font });
  doc.setTitle('MKPROTECTTITLE');
  doc.setAuthor('MKPROTECTAUTHOR');
  const field = doc.getForm().createTextField('balance');
  field.setText('MKPROTECTFIELD');
  field.addToPage(page, { x: 20, y: 300, width: 200, height: 24, font });
  const note = doc.context.register(
    doc.context.obj({ Type: 'Annot', Subtype: 'Text', Rect: [20, 200, 40, 220], Contents: PDFString.of('MKPROTECTCOMMENT'), Open: false }),
  );
  page.node.set(PDFName.of('Annots'), doc.context.obj([...(page.node.Annots()?.asArray() ?? []), note]));
  return doc.save({ useObjectStreams: false });
}

async function pdfaPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.load(three);
  const xmp =
    '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" ' +
    'xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/"><pdfaid:part>2</pdfaid:part><pdfaid:conformance>B</pdfaid:conformance></rdf:Description></rdf:RDF></x:xmpmeta>';
  doc.catalog.set(PDFName.of('Metadata'), doc.context.register(doc.context.stream(new TextEncoder().encode(xmp), { Type: 'Metadata', Subtype: 'XML' })));
  return doc.save();
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
  return { store, controller, progress, labels, ctx, deps, run: new Run('protect', ctx, deps) };
}

const opts = (over: Partial<ProtectRunOptions> = {}): ProtectRunOptions => ({ password: PASSWORD, ...over });

/** Page count with the password, or how pdf.js refused ("PasswordException 1" none given, "2" wrong). */
async function pdfjsOpen(bytes: Uint8Array, password?: string): Promise<number | string> {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  try {
    const doc = await getDocument({ data: bytes.slice(), password, isEvalSupported: false, verbosity: 0 }).promise;
    const pages = doc.numPages;
    await doc.destroy();
    return pages;
  } catch (error) {
    const e = error as { name?: string; code?: number };
    return `${e.name} ${e.code}`;
  }
}

const latin1 = (bytes: Uint8Array) => Buffer.from(bytes).toString('latin1');
const spellings = (text: string) => [text, Buffer.from(text, 'utf16le').toString('latin1'), Buffer.from(text, 'utf8').toString('hex'), Buffer.from(text, 'utf8').toString('hex').toUpperCase()];

describe('protect run step', () => {
  it('is built', () => {
    expect(BUILT).toBe(true);
  });

  it('makes one protected copy, named _protected, that opens only with the password; the row keeps the unprotected bytes for previews', async () => {
    const { run } = harness();
    const source = pdf('Ledger.pdf', three, 3, { wasProtected: true, hasFormFields: false });
    const made = await step(run, [source], opts());
    expect(made.files).toHaveLength(1);
    const [file] = made.files;
    expect(file).toMatchObject({ name: 'Ledger_protected.pdf', kind: 'pdf', mimeType: 'application/pdf', pageCount: 3, protectedOutput: true, origin: 'result', hasSignature: false });
    // A protected copy is not "a copy without its password" (FileList's "Protection removed", savePlan's note).
    expect(file.wasProtected).toBe(false);
    expect(file.size).toBe(file.bytes.byteLength);

    expect(await pdfjsOpen(file.bytes)).toBe('PasswordException 1');
    expect(await pdfjsOpen(file.bytes, 'not-the-password')).toBe('PasswordException 2');
    expect(await pdfjsOpen(file.bytes, PASSWORD)).toBe(3);
    expect(await pageTexts(await unlockPdf(file.bytes, PASSWORD))).toEqual(await pageTexts(three));
    expect((await inspectPdf(file.bytes)).encrypted).toBe(true);

    // The preview bytes are the checked, unprotected copy: no password needed, same text.
    expect(file.previewBytes).toBeInstanceOf(Uint8Array);
    expect(await pdfjsOpen(file.previewBytes!)).toBe(3);
    expect(await pageTexts(file.previewBytes!)).toEqual(await pageTexts(three));

    expect(file.operation).toMatchObject({ tool: 'protect', summary: 'Protected with a password (AES-256)', options: { protection: 'AES-256' } });
    expect(file.operation?.flags).toBeUndefined();
    expect(made.describe([file])).toEqual({
      message: 'Protected: Ledger_protected.pdf',
      detail: 'It opens only with the password you set. VERA does not keep it. The unprotected original stays in the list.',
      tone: 'success',
    });
    expect(source.bytes).toBe(three); // the source is not changed
  });

  it('counts what the protected copy still carries, from its checked unprotected bytes (QA-FIX A)', async () => {
    const { run } = harness();
    const [file] = (await step(run, [pdf('Marked.pdf', marked, 2)], opts())).files;
    expect(file.carried).toEqual({ comments: 1, attachments: 0, properties: ['title', 'author'] });
    const [plain] = (await step(harness().run, [pdf('Ledger.pdf', three, 3)], opts())).files;
    expect(plain.carried).toBeUndefined();
  });

  it('reports the three phases in order, each with a moving bar, and how far the two slow ones have got', async () => {
    const { run, labels } = harness();
    await step(run, [pdf('Ledger.pdf', three, 3)], opts());
    // Each phase starts with its label and a moving bar (total 0), in order.
    expect(labels.filter((l) => l.endsWith('|0'))).toEqual([`${PHASE_LABELS.preparing}|0`, `${PHASE_LABELS.encrypting}|0`, `${PHASE_LABELS.checking}|0`]);
    // Then the encrypting and checking phases measure their progress under the same label (QA-FIX I).
    const measured = labels.filter((l) => !l.endsWith('|0'));
    expect(measured.some((l) => l.startsWith(PHASE_LABELS.encrypting))).toBe(true);
    expect(measured.some((l) => l.startsWith(PHASE_LABELS.checking))).toBe(true);
    expect(labels.indexOf(`${PHASE_LABELS.checking}|0`)).toBeGreaterThan(labels.findIndex((l) => l.startsWith(PHASE_LABELS.encrypting) && !l.endsWith('|0')));
  });

  it('leaves no title, author, comment, field value or page text readable in the raw bytes, and never the password', async () => {
    const { run } = harness();
    const source = pdf('Marked.pdf', marked, 2);
    const before = rawHaystack(marked);
    expect(MARKERS.filter((m) => !before.includes(m))).toEqual([]); // every marker is readable in the source
    const [file] = (await step(run, [source], opts())).files;
    const after = rawHaystack(file.bytes);
    expect(MARKERS.filter((m) => after.includes(m))).toEqual([]);
    const unlocked = rawHaystack(await unlockPdf(file.bytes, PASSWORD));
    expect(MARKERS.filter((m) => !unlocked.includes(m))).toEqual([]); // all of it is still there with the password
    for (const bytes of [file.bytes, file.previewBytes!]) {
      const raw = latin1(bytes) + rawHaystack(bytes);
      expect(spellings(PASSWORD).filter((s) => raw.includes(s))).toEqual([]);
    }
  });

  it('keeps the password out of the record, the activity entry, the progress, the message and the console', async () => {
    const { run, labels } = harness();
    const logged: string[] = [];
    for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => void logged.push(args.map(String).join(' ')));
    }
    const made = await step(run, [pdf('Ledger.pdf', three, 3)], opts());
    const [file] = made.files;
    const entry = buildActivityEntry({ file, destination: 'vault', sha256: 'a'.repeat(64), vaultRecordId: 'v1' });
    expect(entry.metadata.options).toEqual({ protection: 'AES-256' });
    expect(entry.details).toContain('Protected with a password (AES-256)');
    const everything = [JSON.stringify(file.operation), JSON.stringify(entry), labels.join('\n'), JSON.stringify(made.describe([file])), logged.join('\n')].join('\n');
    expect(everything).not.toContain(PASSWORD);
    expect(Object.keys(file.operation!.options)).toEqual(['protection']); // no hint, no length
  });

  it('round-trips a Hindi password (with the rupee sign)', async () => {
    const { run } = harness();
    const hindi = 'पासवर्ड₹2025';
    const [file] = (await step(run, [pdf('Hindi.pdf', three, 3)], opts({ password: hindi }))).files;
    expect(await pdfjsOpen(file.bytes, hindi)).toBe(3);
    expect(await pdfjsOpen(file.bytes, 'पासवर्ड₹2026')).toBe('PasswordException 2');
  });

  it('keeps a typed result name', async () => {
    const { run } = harness();
    const [file] = (await step(run, [pdf('Ledger.pdf', three, 3)], opts({ name: 'For the bank' }))).files;
    expect(file.name).toBe('For the bank.pdf');
  });

  it('marks a result of a signed file "signature no longer valid"', async () => {
    const { run } = harness();
    const signed = await makeFormPdf({ signature: true });
    const made = await step(run, [pdf('Signed.pdf', signed, 3, { hasSignature: true })], opts());
    const [file] = made.files;
    expect(file.signatureInvalid).toBe(true);
    expect(file.hasSignature).toBe(false);
    expect(file.operation?.flags).toEqual({ signatureInvalid: true });
    expect(file.operation?.summary).toBe('Protected with a password (AES-256); signature no longer valid');
    const said = made.describe([file]);
    expect(said.tone).toBe('warning');
    expect(said.detail).toContain('Signature no longer valid: keep the signed original as the evidence.');
  });

  it('says and records that a PDF/A source makes a copy that is no longer PDF/A', async () => {
    const { run } = harness();
    const made = await step(run, [pdf('Archive.pdf', await pdfaPdf(), 3)], opts());
    const [file] = made.files;
    expect(file.operation?.options).toEqual({ protection: 'AES-256', noLongerArchival: true });
    const said = made.describe([file]);
    expect(said.tone).toBe('warning');
    expect(said.detail).toContain(NO_LONGER_ARCHIVAL_NOTE);
  });

  it('refuses, before reading the file: a result of Protect, a file over the cap, an unusable password', async () => {
    const { run } = harness();
    await expect(step(run, [pdf('Ledger_protected.pdf', three, 3, { protectedOutput: true })], opts())).rejects.toThrow(PROTECTED_OUTPUT_REASON);
    const big = step(run, [pdf('Huge.pdf', three, 3, { size: PROTECT_MAX_BYTES + 1 })], opts());
    await expect(big).rejects.toMatchObject({ code: 'protect-too-large' });
    await expect(step(run, [pdf('Huge.pdf', three, 3, { size: PROTECT_MAX_BYTES + 1 })], opts())).rejects.toThrow(
      'This file is larger than 150 MB, too large to protect in PDF Tools. Nothing was added. Compress it or split it into parts, then protect the smaller files.',
    );
    await expect(step(run, [pdf('Ledger.pdf', three, 3)], opts({ password: 'short' }))).rejects.toMatchObject({ code: 'password-too-short' });
    await expect(step(run, [pdf('Ledger.pdf', three, 3)], { password: undefined as unknown as string })).rejects.toMatchObject({ code: 'password-too-short' });
    await expect(step(run, [pdf('a.pdf', three, 3), pdf('b.pdf', three, 3)], opts())).rejects.toThrow('Choose exactly one PDF.');
  });

  it('a file the library cannot read is refused in words that say nothing was added, without the password', async () => {
    const { run } = harness();
    const junk = new TextEncoder().encode(`%PDF-1.7\n${PASSWORD} this is not a real PDF`);
    const attempt = step(run, [pdf('Broken.pdf', junk, 1)], opts());
    await expect(attempt).rejects.toBeInstanceOf(PdfToolsError);
    const error = (await attempt.catch((e: unknown) => e)) as PdfToolsError;
    expect(error.message).toMatch(/Nothing was added\./);
    expect(`${error.message} ${error.stack} ${JSON.stringify(error)}`).not.toContain(PASSWORD);
  });

  it('stops at a phase boundary when the user stops, and makes nothing', async () => {
    for (const phase of ['encrypting', 'checking'] as const) {
      const { run, controller, progress } = harness();
      progress.mockImplementation((_d: number, _t: number, label?: string) => {
        if (label === PHASE_LABELS[phase]) controller.abort();
      });
      await expect(step(run, [pdf('Ledger.pdf', three, 3)], opts())).rejects.toBeInstanceOf(Cancelled);
    }
  });

  it('ends without a word when the engagement changes during the run', async () => {
    const { run, store, progress } = harness();
    progress.mockImplementation((_d: number, _t: number, label?: string) => {
      if (label === PHASE_LABELS.encrypting) store.setContext('u1:B');
    });
    await expect(step(run, [pdf('Ledger.pdf', three, 3)], opts())).rejects.toBeInstanceOf(Stale);
  });

  it('through runTool: adds one row, its preview bytes counted in the list; a stop adds nothing', async () => {
    const { store, ctx } = harness();
    const source = pdf('Ledger.pdf', three, 3);
    const result = await runTool('protect', [source], opts(), ctx, { paint: async () => undefined, yieldToUi: async () => undefined });
    expect(result).toMatchObject({ status: 'added', added: 1, message: 'Protected: Ledger_protected.pdf', tone: 'success' });
    const [row] = store.getState().files;
    expect(row).toMatchObject({ name: 'Ledger_protected.pdf', protectedOutput: true });
    expect(heldBytes(row)).toBe(row.size + row.previewBytes!.byteLength);

    const stopped = harness();
    stopped.progress.mockImplementation((_d: number, _t: number, label?: string) => {
      if (label === PHASE_LABELS.checking) stopped.controller.abort();
    });
    const outcome = await runTool('protect', [source], opts(), stopped.ctx, { paint: async () => undefined, yieldToUi: async () => undefined });
    expect(outcome.status).toBe('cancelled');
    expect(stopped.store.getState().files).toEqual([]);
  });
});
