import { PDFDocument } from 'pdf-lib';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { buildActivityEntry } from '@/lib/pdf-tools/activity';
import { emptyMarkReport } from '@/lib/pdf-tools/marks';
import { makePdf } from '@/lib/pdf-tools/testPdf';
import { createWorkingListStore } from '@/lib/pdf-tools/workingList';
import { PdfToolsError, type WorkingFile } from '@/lib/pdf-tools/types';
import { runTool, type RunContext, type RunDeps } from './runTool';
import { pageNumberRunNotes, watermarkRunNotes } from './marks/markNotes';
import { CHECK_NOTICE_BYTES, CHECKING_RESULT, markFlags, markNotes, onePdf, Run, type ToolStep } from './toolStep';

vi.setConfig({ testTimeout: 20_000 });

// The phase 2 run modules are replaced here, so these tests pin the contract whatever state the dialog
// lanes' modules are in: a built module's step runs through runTool's checks, a stub never runs, a module
// that cannot be loaded says so.
const fake = vi.hoisted(() => ({
  built: true,
  step: null as null | ((...args: unknown[]) => Promise<unknown>),
}));
vi.mock('./watermarkRun', () => ({
  get BUILT() {
    return fake.built;
  },
  step: (...args: unknown[]) => fake.step!(...args),
}));
vi.mock('./bookmarksRun', () => ({ BUILT: false, step: () => Promise.reject(new Error('a stub must never run')) }));
vi.mock('./protectRun', () => {
  throw new Error('Failed to fetch dynamically imported module');
});

let A2: Uint8Array;
beforeAll(async () => {
  A2 = await makePdf('A', 2);
}, 60_000);

function pdf(name: string, bytes: Uint8Array, pageCount: number, extra: Partial<WorkingFile> = {}): WorkingFile {
  return {
    id: `in-${name}`,
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
  };
}

function setup() {
  const store = createWorkingListStore();
  store.setContext('u1:A');
  const controller = new AbortController();
  const progress = vi.fn();
  const ctx: RunContext = { contextKey: 'u1:A', session: store.getState().session, store, signal: controller.signal, onProgress: progress };
  const deps: Partial<RunDeps> = { paint: async () => undefined, yieldToUi: async () => undefined };
  return { store, controller, ctx, deps, progress, files: () => store.getState().files };
}

const watermarkOptions = { options: { pages: 'first' as const, tokens: { date: '14-11-2026', client: '' } }, name: '' };

describe('"protection removed" on a record (QA-FIX E; T-064 contract section 4)', () => {
  const run = (tool: ConstructorParameters<typeof Run>[0]) => {
    const { ctx } = setup();
    return new Run(tool, ctx, { inspectPdf: async () => { throw new Error('not used'); }, paint: async () => undefined, yieldToUi: async () => undefined, newId: () => 'id-1', maxBytes: 1e9, warnBytes: 1e9 });
  };
  const unlocked = () => pdf('Locked.pdf', A2, 2, { wasProtected: true });

  it('is said for a tool whose result is a copy of an unlocked file, PDF to Excel and PDF to Word included', () => {
    for (const tool of ['merge', 'compress', 'watermark', 'pdf-to-excel', 'pdf-to-word'] as const) expect(run(tool).protectionRemoved([unlocked()]), tool).toBe(true);
  });

  it('is never said for Protect, nor for a report about the files: Document check and Compare', () => {
    for (const tool of ['protect', 'document-check', 'compare'] as const) {
      expect(run(tool).protectionRemoved([unlocked()]), tool).toBe(false);
      const row = run(tool).result({ name: 'r.pdf', bytes: A2, kind: 'pdf', mimeType: 'application/pdf', pageCount: 2 }, [unlocked()], { summary: 'Report', options: {} });
      expect(row.operation, tool).toMatchObject({ summary: 'Report' });
      expect(row.operation?.flags, tool).toBeUndefined();
    }
    const row = run('pdf-to-word').result({ name: 'r.docx', bytes: A2, kind: 'office', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', pageCount: null }, [unlocked()], { summary: 'Converted to Word: 2 pages', options: {} });
    expect(row.operation).toMatchObject({ summary: 'Converted to Word: 2 pages; protection removed', flags: { protectionRemoved: true } });
  });
});

describe('a phase 2 run module through runTool (the step contract)', () => {
  it("runs a built module's step, which checks, verifies and names its result like a phase 1 step", async () => {
    const { ctx, deps, files, progress } = setup();
    const step: ToolStep<unknown> = async (run, inputs) => {
      const source = onePdf(inputs);
      run.progress(0, 1, 'Marking…');
      const report = emptyMarkReport();
      report.unverified.push(2);
      const file = await run.pdfResult('A_watermarked.pdf', source.bytes.slice(), source.pageCount, inputs, { summary: 'Watermark DRAFT, pages 1-2', options: { text: 'DRAFT' } }, { flags: markFlags(report) });
      return { files: [file], describe: ([made]) => ({ message: `Made ${made.name}`, detail: markNotes(report, 'watermark').join(' '), tone: 'warning' }) };
    };
    fake.built = true;
    fake.step = step as never;
    const source = pdf('A.pdf', A2, 2, { hasSignature: true });
    const result = await runTool('watermark', [source], watermarkOptions as never, ctx, deps);
    expect(result).toMatchObject({ status: 'added', added: 1, message: 'Made A_watermarked.pdf', tone: 'warning' });
    expect(result.detail).toBe(watermarkRunNotes({ ...emptyMarkReport(), unverified: [2] }).join(' '));
    const [made] = files();
    expect(made).toMatchObject({ origin: 'result', hasSignature: false, signatureInvalid: true, pageCount: 2 });
    expect(made.operation).toMatchObject({ tool: 'watermark', summary: 'Watermark DRAFT, pages 1-2; signature no longer valid; a mark may be misplaced', flags: { signatureInvalid: true, markMayBeMisplaced: true } });
    expect(buildActivityEntry({ file: made, destination: 'computer', sha256: 'cd'.repeat(32) }).metadata).toMatchObject({ tool: 'watermark', markMayBeMisplaced: true, signatureInvalid: true });
    expect(progress).toHaveBeenCalledWith(0, 1, 'Marking…');
  });

  it("notes on a result whether it holds attachments in the document's list, as found by inspectPdf", async () => {
    const { ctx, deps, files } = setup();
    const attachedDoc = await PDFDocument.load(A2);
    await attachedDoc.attach(new TextEncoder().encode('synthetic attachment body'), 'notes.txt', { mimeType: 'text/plain' });
    const attached = await attachedDoc.save();
    fake.built = true;
    fake.step = (async (run: Parameters<ToolStep<unknown>>[0], inputs: WorkingFile[]) => {
      const kept = await run.pdfResult('kept.pdf', attached, 2, inputs, { summary: 'kept', options: {} });
      const plain = await run.pdfResult('plain.pdf', A2.slice(), 2, inputs, { summary: 'plain', options: {} });
      return { files: [kept, plain], describe: () => ({ message: 'Made', tone: 'success' }) };
    }) as never;
    await runTool('watermark', [pdf('A.pdf', A2, 2)], watermarkOptions as never, ctx, deps);
    expect(files().map((f) => [f.name, f.hasAttachments])).toEqual([
      ['kept.pdf', true],
      ['plain.pdf', false],
    ]);
  });

  it('leaves nothing of the document text a step matched, whether the run adds, fails or is stopped', async () => {
    const statics = () => (RegExp as unknown as { input: string; lastMatch: string; $1: string });
    const readsText = (then: 'add' | 'fail' | 'stop', controller?: AbortController) =>
      (async (run: Parameters<ToolStep<unknown>>[0], inputs: WorkingFile[]) => {
        /Invoice (\d+)/.exec('Synthetic page text: Invoice 4471 for BNZPM');
        if (then === 'fail') throw new PdfToolsError('wrong-input', 'This step failed.');
        if (then === 'stop') {
          controller!.abort();
          run.check();
        }
        const file = await run.pdfResult('A_marked.pdf', A2.slice(), 2, inputs, { summary: 'x', options: {} });
        /Invoice (\d+)/.exec('Synthetic page text: Invoice 4471 for BNZPM');
        return { files: [file], describe: () => ({ message: 'Made', tone: 'success' }) };
      }) as never;
    fake.built = true;

    const added = setup();
    fake.step = readsText('add');
    expect(await runTool('watermark', [pdf('A.pdf', A2, 2)], watermarkOptions as never, added.ctx, added.deps)).toMatchObject({ status: 'added' });
    expect([statics().input, statics().lastMatch, statics().$1]).toEqual(['', '', '']);

    const failed = setup();
    fake.step = readsText('fail');
    await expect(runTool('watermark', [pdf('A.pdf', A2, 2)], watermarkOptions as never, failed.ctx, failed.deps)).rejects.toMatchObject({ code: 'wrong-input' });
    expect(statics().input).toBe('');

    const stopped = setup();
    fake.step = readsText('stop', stopped.controller);
    expect(await runTool('watermark', [pdf('A.pdf', A2, 2)], watermarkOptions as never, stopped.ctx, stopped.deps)).toMatchObject({ status: 'cancelled' });
    expect(statics().input).toBe('');
  });

  it('says "Checking the result…" and lets it paint before it opens a large result again, not a small one', async () => {
    const { ctx, deps, progress } = setup();
    const events: string[] = [];
    progress.mockImplementation((_d: number, _t: number, label?: string) => events.push(`progress ${label}`));
    const info = {
      encrypted: false,
      pageCount: 2,
      hasSignature: false,
      hasFormFields: false,
      hasBookmarks: false,
      hasPageLinks: false,
      hasAttachments: false,
      carried: { comments: 0, attachments: 0, properties: [] },
    };
    const runDeps: Partial<RunDeps> = {
      ...deps,
      paint: async () => void events.push('paint'),
      inspectPdf: async (bytes: Uint8Array) => (events.push(`inspect ${bytes.byteLength >= CHECK_NOTICE_BYTES ? 'large' : 'small'}`), info),
    };
    fake.built = true;
    fake.step = (async (run: Parameters<ToolStep<unknown>>[0], inputs: WorkingFile[]) => {
      const small = await run.pdfResult('small.pdf', A2.slice(), 2, inputs, { summary: 's', options: {} });
      const large = await run.pdfResult('large.pdf', new Uint8Array(CHECK_NOTICE_BYTES), 2, inputs, { summary: 'l', options: {} });
      return { files: [small, large], describe: () => ({ message: 'Made', tone: 'success' }) };
    }) as never;
    await runTool('watermark', [pdf('A.pdf', A2, 2)], watermarkOptions as never, ctx, runDeps);
    expect(events).toEqual(['inspect small', `progress ${CHECKING_RESULT}`, 'paint', 'inspect large']);
  });

  it('adds nothing when the list moves on while the step works, and says nothing', async () => {
    const { store, ctx, deps, files } = setup();
    fake.built = true;
    fake.step = (async (run: Parameters<ToolStep<unknown>>[0], inputs: WorkingFile[]) => {
      store.setContext('u1:B');
      const file = await run.pdfResult('x.pdf', inputs[0].bytes, 2, inputs, { summary: 'x', options: {} });
      return { files: [file], describe: () => ({ message: 'x' }) };
    }) as never;
    const result = await runTool('watermark', [pdf('A.pdf', A2, 2)], watermarkOptions as never, ctx, deps);
    expect(result).toEqual({ status: 'stale', added: 0, ids: [] });
    expect(files()).toEqual([]);
  });

  it('a module whose BUILT is not true never runs its step', async () => {
    const { ctx, deps, files } = setup();
    await expect(runTool('bookmarks', [pdf('A.pdf', A2, 2)], { items: [] }, ctx, deps)).rejects.toMatchObject({ code: 'tool-not-built' });
    expect(files()).toEqual([]);
    fake.built = false;
    fake.step = vi.fn() as never;
    await expect(runTool('watermark', [pdf('A.pdf', A2, 2)], watermarkOptions as never, ctx, deps)).rejects.toBeInstanceOf(PdfToolsError);
    expect(fake.step).not.toHaveBeenCalled();
    fake.built = true;
  });

  it('a module that cannot be loaded says so in plain words, and a stop while it loads is a stop', async () => {
    const { ctx, deps, controller } = setup();
    await expect(runTool('protect', [pdf('A.pdf', A2, 2)], { password: 'not used here' }, ctx, deps)).rejects.toMatchObject({
      code: 'tool-load-failed',
      message: 'This tool could not be loaded. Try again; if it happens again, restart the application.',
    });
    controller.abort();
    expect(await runTool('protect', [pdf('A.pdf', A2, 2)], { password: 'not used here' }, ctx, deps)).toMatchObject({ status: 'cancelled' });
  });

  it("counts a result's preview bytes when it checks the list's room before adding", async () => {
    const { ctx, files } = setup();
    fake.built = true;
    fake.step = (async (run: Parameters<ToolStep<unknown>>[0], inputs: WorkingFile[]) => {
      const file = run.result(
        { name: 'A_protected.pdf', bytes: new Uint8Array(100), kind: 'pdf', mimeType: 'application/pdf', pageCount: 2, protectedOutput: true, previewBytes: new Uint8Array(150) },
        inputs,
        { summary: 'Protected with a password (AES-256)', options: { protection: 'AES-256' } },
      );
      return { files: [file], describe: () => ({ message: 'Protected' }) };
    }) as never;
    const source = pdf('A.pdf', A2, 2);
    // The source is not in this list, so only the result counts: its file (100 bytes) would fit in 200,
    // the file and its preview (250 bytes) do not.
    await expect(runTool('watermark', [source], watermarkOptions as never, ctx, { paint: async () => undefined, maxBytes: 200 })).rejects.toMatchObject({ code: 'list-full' });
    expect(files()).toEqual([]);
    const roomy = await runTool('watermark', [source], watermarkOptions as never, ctx, { paint: async () => undefined, maxBytes: 250 });
    expect(roomy.status).toBe('added');
    expect(files()[0]).toMatchObject({ protectedOutput: true, size: 100 });
  });
});

describe('what a marks report says', () => {
  it('flags a mark that may be misplaced on a damaged or unreadable page only', () => {
    expect(markFlags(emptyMarkReport())).toEqual({});
    expect(markFlags({ ...emptyMarkReport(), damaged: [3] })).toEqual({ markMayBeMisplaced: true });
    expect(markFlags({ ...emptyMarkReport(), unverified: [1] })).toEqual({ markMayBeMisplaced: true });
    expect(markFlags({ ...emptyMarkReport(), hiddenBehind: [1], clipped: [1], underFields: [1], uncertain: [1] })).toEqual({});
  });

  it('says what the one source of mark notes says (marks/markNotes.ts), for each tool', () => {
    const report = { hiddenBehind: [2, 3, 4], uncertain: [9], clipped: [1], damaged: [5], unverified: [7, 6], underFields: [1, 2] };
    expect(markNotes(report, 'watermark')).toEqual(watermarkRunNotes(report));
    expect(markNotes(report, 'page-numbers')).toEqual(pageNumberRunNotes(report));
    expect(markNotes(report, 'watermark').some((note) => note.includes('may be misplaced'))).toBe(true);
    expect(markNotes(emptyMarkReport(), 'page-numbers')).toEqual([]);
  });
});
