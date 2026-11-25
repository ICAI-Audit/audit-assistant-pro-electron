// The Compare run step (compareRun.ts) on the step contract of toolStep.ts: two PDFs in, a report out,
// `<later name>_changes.pdf`, built with run.verifyPdf and run.result. The page text is read through the
// test seam (createStep) with pdf.js in Node, from invented PDF pairs built with pdf-lib.
import { PDFDocument } from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { inspectPdf } from '@/lib/pdf-tools/inspect';
import { asLines, compareFixture, fixedTextSource, fixturePages, inventedWords, pdfjsTextSource, textPdf, type CompareFixture, type CompareFixtureName } from '@/lib/pdf-tools/testComparePdf';
import { createWorkingListStore, LIST_MAX_BYTES, LIST_WARN_BYTES } from '@/lib/pdf-tools/workingList';
import { PdfToolsError, type WorkingFile } from '@/lib/pdf-tools/types';
import { Cancelled, Run, Stale, type RunContext, type StepDeps } from '../toolStep';
import { BUILT, createStep, type CompareRunOptions } from './compareRun';
import { RECORD_KEYS } from './compareForm';

vi.setConfig({ testTimeout: 90_000 });

const reader = pdfjsTextSource();
const step = createStep(reader);
const fixtures = new Map<CompareFixtureName, CompareFixture>();
const NAMES: CompareFixtureName[] = ['draft-signed', 'inserted-page', 'removed-page', 'different-counts', 'identical', 'large-page', 'scanned'];

beforeAll(async () => {
  for (const name of NAMES) fixtures.set(name, await compareFixture(name));
}, 90_000);
afterAll(() => reader.close());

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
  const onProgress = vi.fn((_done: number, _total: number, label?: string) => {
    if (label) labels.push(label);
  });
  const ctx: RunContext = { contextKey: 'u1:A', session: store.getState().session, store, signal: controller.signal, onProgress };
  const deps: StepDeps = { inspectPdf, paint: async () => undefined, yieldToUi: async () => undefined, newId: () => `id-${++seq}`, maxBytes: LIST_MAX_BYTES, warnBytes: LIST_WARN_BYTES };
  return { store, controller, onProgress, labels, ctx, deps, run: new Run('compare', ctx, deps) };
}

function pair(name: CompareFixtureName, extra: { earlier?: Partial<WorkingFile>; later?: Partial<WorkingFile> } = {}) {
  const f = fixtures.get(name)!;
  const earlier = pdf('Accounts draft.pdf', f.earlier, f.earlierPages, extra.earlier);
  const later = pdf('Accounts signed.pdf', f.later, f.laterPages, extra.later);
  return { f, earlier, later, inputs: [earlier, later] };
}

/** Every word of a fixture's pages (for "no fixture word in the record"). */
function fixtureWords(name: CompareFixtureName): string[] {
  const { earlier, later } = fixturePages(name);
  return [...earlier, ...later].flatMap((p) => (typeof p === 'string' ? p.split(/\s+/) : [])).filter((w) => w.length >= 4 && !/^(Vera|Example|Notes|accounts|Note)$/.test(w));
}

describe('compare run step', () => {
  it('is built', () => {
    expect(BUILT).toBe(true);
  });

  it('a draft and its signed set differing on two pages: one report, <later>_changes.pdf, "2 of 12 pages differ."', async () => {
    const { run, labels } = harness();
    const { earlier, later, inputs } = pair('draft-signed', { later: { hasSignature: true, wasProtected: false } });
    const made = await step(run, inputs, { earlierId: earlier.id });
    expect(made.files).toHaveLength(1);
    const [row] = made.files;
    expect(row).toMatchObject({ name: 'Accounts signed_changes.pdf', kind: 'pdf', mimeType: 'application/pdf', origin: 'result', hasSignature: false });
    // A report is a new document: never badged as made from a signed file, and it carries no title or author.
    expect(row.signatureInvalid).toBeUndefined();
    expect(row.carried).toBeUndefined();
    const doc = await PDFDocument.load(row.bytes, { updateMetadata: false });
    expect(row.pageCount).toBe(doc.getPageCount());
    expect(doc.getTitle()).toBeUndefined();
    expect(doc.getAuthor()).toBeUndefined();
    expect(made.describe(made.files)).toEqual({ message: '2 of 12 pages differ.', detail: 'The report Accounts signed_changes.pdf lists each change with the words around it.', tone: 'success' });
    expect(row.operation?.summary).toBe('Compared 2 files: 2 of 12 pages differ');
    expect(row.operation?.sources.map((s) => s.name)).toEqual(['Accounts draft.pdf', 'Accounts signed.pdf']);
    expect(row.operation?.options).toMatchObject({ pagesEarlier: 12, pagesLater: 12, pagesDiffer: 2, wordsAdded: 7, pagesOnlyEarlier: 0, pagesOnlyLater: 0 });
    expect(Object.keys(row.operation?.options ?? {}).every((k) => RECORD_KEYS.includes(k))).toBe(true);
    expect(row.operation?.flags).toBeUndefined();
    expect(labels).toContain('Reading the earlier version: page 1 of 12');
    expect(labels).toContain('Reading the later version: page 12 of 12');
    expect(labels).toContain('Comparing the text…');
    expect(labels).toContain('Writing the report…');
  });

  it('no word of either document gets into the record (summary or options)', async () => {
    for (const name of ['draft-signed', 'different-counts'] as const) {
      const { run } = harness();
      const { earlier, inputs } = pair(name);
      const [row] = (await step(run, inputs, { earlierId: earlier.id })).files;
      const record = JSON.stringify({ summary: row.operation?.summary, options: row.operation?.options });
      for (const word of fixtureWords(name)) expect(record, word).not.toContain(word);
    }
  });

  it('Swap: with the signed set as the earlier version, the report is named after the draft', async () => {
    const { run } = harness();
    const { later, inputs } = pair('draft-signed');
    const made = await step(run, inputs, { earlierId: later.id });
    expect(made.files[0].name).toBe('Accounts draft_changes.pdf');
    expect(made.describe(made.files).message).toBe('2 of 12 pages differ.');
    expect(made.files[0].operation?.sources.map((s) => s.name)).toEqual(['Accounts signed.pdf', 'Accounts draft.pdf']);
  });

  it('takes the name typed in the dialog, with .pdf added', async () => {
    const { run } = harness();
    const { earlier, inputs } = pair('draft-signed');
    const made = await step(run, inputs, { earlierId: earlier.id, name: 'What changed' });
    expect(made.files[0].name).toBe('What changed.pdf');
  });

  it('an inserted page does not make every later page differ', async () => {
    const { run } = harness();
    const { earlier, inputs } = pair('inserted-page');
    const made = await step(run, inputs, { earlierId: earlier.id });
    const said = made.describe(made.files);
    expect(said.message).toBe('No page that is in both versions differs. 1 page is only in the later version.');
    expect(made.files[0].operation?.options).toMatchObject({ pagesDiffer: 0, pagesOnlyLater: 1, pagesOnlyEarlier: 0 });
  });

  it('a removed page is listed only in the earlier version', async () => {
    const { run } = harness();
    const { earlier, inputs } = pair('removed-page');
    const said = (await step(run, inputs, { earlierId: earlier.id })).describe([]);
    expect(said.message).toBe('No page that is in both versions differs. 1 page is only in the earlier version.');
  });

  it('different page counts: a page removed and two added at the end', async () => {
    const { run } = harness();
    const { earlier, inputs } = pair('different-counts');
    const made = await step(run, inputs, { earlierId: earlier.id });
    expect(made.describe(made.files).message).toBe('No page that is in both versions differs. 1 page is only in the earlier version; 2 pages are only in the later version.');
    expect(made.files[0].operation?.summary).toBe('Compared 2 files: 0 of 13 pages differ; 1 page only in the earlier version, 2 pages only in the later version');
    expect(made.files[0].operation?.options).toMatchObject({ pagesEarlier: 12, pagesLater: 13, pagesDiffer: 0, pagesOnlyEarlier: 1, pagesOnlyLater: 2 });
  });

  it('a paragraph re-wrapped with words hyphenated across line ends is no difference (Round 2)', async () => {
    const earlier = await textPdf([
      'The inter-\nnational co-\noperative society closed its accounts for 2024-\n25 and the self-\nassessment tax was paid in full by the trea-\nsurer on time',
    ]);
    const later = await textPdf(['The international co-operative society closed its accounts for 2024-25 and\nthe self-assessment tax was paid in full by the treasurer on time']);
    const { run } = harness();
    const a = pdf('Minutes draft.pdf', earlier, 1);
    const made = await step(run, [a, pdf('Minutes final.pdf', later, 1)], { earlierId: a.id });
    expect(made.files).toEqual([]);
    expect(made.describe([]).message).toBe('No text differences found.');
  });

  it('identical files: no result, and "No text differences found."', async () => {
    const { run, store } = harness();
    const { earlier, inputs } = pair('identical');
    const made = await step(run, inputs, { earlierId: earlier.id });
    expect(made.files).toEqual([]);
    expect(made.describe([]).message).toBe('No text differences found.');
    expect(store.getState().files).toEqual([]);
  });

  it('a page over 5,000 words: compared in larger pieces, and the message says so', async () => {
    const { run } = harness();
    const { earlier, inputs } = pair('large-page');
    const made = await step(run, inputs, { earlierId: earlier.id });
    const said = made.describe(made.files);
    expect(said.message).toBe('1 of 3 pages differs.');
    expect(said.detail).toContain('1 very long page was compared in larger pieces');
    expect(made.files[0].operation?.options).toMatchObject({ pagesComparedCoarsely: 1, wordsChanged: 6, wordsAdded: 4, wordsRemoved: 3 });
  });

  it('one file with no text (scanned): refused, it must be made searchable first', async () => {
    const { run } = harness();
    const { earlier, inputs } = pair('scanned');
    const failure = step(run, inputs, { earlierId: earlier.id });
    await expect(failure).rejects.toBeInstanceOf(PdfToolsError);
    await expect(failure).rejects.toThrow('Accounts signed.pdf has no text to read; it looks scanned. Make it searchable first. Nothing was added.');
  });

  it('a word in another script is printed as [word in another script] and the message says so', async () => {
    const a = new Uint8Array([1]);
    const b = new Uint8Array([2]);
    const source = fixedTextSource(
      new Map<Uint8Array, string[]>([
        [a, ['The ledger lekha खाता balance is 1,00,000.00 as at the year end and is carried forward']],
        [b, ['The ledger lekha खाता balance is 1,20,000.00 as at the year end and is carried forward']],
      ]),
    );
    const { run } = harness();
    const earlier = pdf('Hindi draft.pdf', a, 1);
    const later = pdf('Hindi final.pdf', b, 1);
    const made = await createStep(source)(run, [earlier, later], { earlierId: earlier.id });
    const said = made.describe(made.files);
    expect(said.message).toBe('1 of 1 page differs.');
    expect(said.detail).toContain('1 word in another script could not be printed and is shown as [word in another script].');
    expect(JSON.stringify(made.files[0].operation)).not.toContain('खाता');
  });

  it('Stop while the text is read: the run ends with Cancelled and nothing is added', async () => {
    const { run, controller, ctx, store } = harness();
    const { earlier, inputs } = pair('draft-signed');
    const onProgress = ctx.onProgress;
    ctx.onProgress = (done, total, label) => {
      onProgress(done, total, label);
      if (done >= 8) controller.abort();
    };
    await expect(step(run, inputs, { earlierId: earlier.id })).rejects.toBeInstanceOf(Cancelled);
    expect(store.getState().files).toEqual([]);
  });

  it('Stop while comparing a long page lands within the comparison, at its next turn', async () => {
    // 5,000 words against the same words in reverse order: some tenths of a second of comparing.
    const words = inventedWords(31, 5_000);
    const a = new Uint8Array([3]);
    const b = new Uint8Array([4]);
    const source = fixedTextSource(new Map<Uint8Array, string[]>([[a, [asLines(words).join('\n')]], [b, [asLines([...words].reverse()).join('\n')]]]));
    const { run, controller, ctx } = harness();
    const earlier = pdf('Long draft.pdf', a, 1);
    let stoppedAt = 0;
    ctx.onProgress = (_done, _total, label) => {
      if (label === 'Comparing the text…')
        setTimeout(() => {
          stoppedAt = performance.now();
          controller.abort();
        }, 0);
    };
    await expect(createStep(source)(run, [earlier, pdf('Long final.pdf', b, 1)], { earlierId: earlier.id })).rejects.toBeInstanceOf(Cancelled);
    expect(stoppedAt).toBeGreaterThan(0);
    expect(performance.now() - stoppedAt).toBeLessThan(150);
  });

  it('a change of engagement while reading is silent (Stale)', async () => {
    const { run, ctx, store } = harness();
    const { earlier, inputs } = pair('draft-signed');
    const onProgress = ctx.onProgress;
    ctx.onProgress = (done, total, label) => {
      onProgress(done, total, label);
      if (done >= 4) store.setContext('u2:B');
    };
    await expect(step(run, inputs, { earlierId: earlier.id })).rejects.toBeInstanceOf(Stale);
  });

  it('refuses anything but two PDFs, an unknown earlier file, and a file over 1,000 pages (before reading)', async () => {
    const { run } = harness();
    const { earlier, later, inputs } = pair('draft-signed');
    const opts: CompareRunOptions = { earlierId: earlier.id };
    await expect(step(run, [earlier], opts)).rejects.toThrow('Select exactly two PDFs to compare.');
    const image = { ...later, kind: 'image' as const, mimeType: 'image/png', pageCount: null };
    await expect(step(run, [earlier, image], opts)).rejects.toThrow('Select exactly two PDFs to compare.');
    await expect(step(run, inputs, { earlierId: 'nobody' })).rejects.toThrow('Select exactly two PDFs to compare.');
    const read = vi.fn(reader.pageTextContent);
    const big = { ...later, pageCount: 1001 };
    await expect(createStep({ pageTextContent: read })(run, [earlier, big], opts)).rejects.toThrow('Accounts signed.pdf has more than 1,000 pages. Compare takes files of up to 1,000 pages: split it first. Nothing was added.');
    expect(read).not.toHaveBeenCalled();
  });

  it('a file the reader cannot read ends with a plain sentence', async () => {
    const { run } = harness();
    const { earlier, inputs } = pair('draft-signed');
    const broken = createStep({ pageTextContent: async () => Promise.reject(new Error('worker gone')) });
    await expect(broken(run, inputs, { earlierId: earlier.id })).rejects.toThrow('Accounts draft.pdf could not be read. Open it in a PDF reader, save a fresh copy and add that. Nothing was added.');
  });
});
