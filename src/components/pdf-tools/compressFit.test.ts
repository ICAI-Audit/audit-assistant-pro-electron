import { PDFDocument } from 'pdf-lib';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { buildActivityEntry } from '@/lib/pdf-tools/activity';
import { FIT_FLOOR, FIT_LADDER, type FitProgress, type FitResult } from '@/lib/pdf-tools/compressTarget';
import { makeScanPdf, modelRecoder } from '@/lib/pdf-tools/testCompressPdf';
import { makePdf, pageTexts } from '@/lib/pdf-tools/testPdf';
import { createWorkingListStore } from '@/lib/pdf-tools/workingList';
import { PdfToolsError, type WorkingFile } from '@/lib/pdf-tools/types';
import {
  alreadyUnder,
  defaultFitTarget,
  fitBlockedReason,
  fitProgressLabel,
  fitProgressShare,
  fitRunLabel,
  QUICK_SIZES_MB,
  readTargetSize,
  targetSize,
} from './compressFit';
import { runTool, type RunContext, type RunDeps } from './runTool';

vi.setConfig({ testTimeout: 60_000 });

let A2: Uint8Array;
let B3: Uint8Array;
beforeAll(async () => {
  A2 = await makePdf('A', 2);
  B3 = await makePdf('B', 3);
  await pageTexts(A2);
}, 60_000);

const MB = 1_000_000;

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

let seq = 0;
function pdf(name: string, bytes: Uint8Array, pageCount: number, extra: Partial<WorkingFile> = {}): WorkingFile {
  return {
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

/** What compressToTarget says, with `bytes` standing for the result (a real PDF, so the run can check it). */
function fit(outcome: FitResult['outcome'], extra: Partial<FitResult> & { bytes?: Uint8Array | null } = {}): FitResult {
  const bytes = extra.bytes === undefined ? (outcome === 'reached' || outcome === 'not-reached' ? A2.slice() : null) : extra.bytes;
  return {
    outcome,
    bytes,
    targetBytes: 5 * MB,
    originalSize: 12_700_000,
    newSize: bytes ? bytes.length : 6_800_000,
    step: bytes ? FIT_LADDER[6] : null,
    attempts: 4,
    imagesFound: 2,
    imagesReplaced: bytes ? 2 : 0,
    lowestDpi: bytes ? 150 : null,
    imageShare: 0.97,
    ...extra,
  };
}

// ---- the size field ------------------------------------------------------------------------------

describe('reading the size', () => {
  it('takes MB and KB as the strictest portals count them: 1 MB is 1,000,000 bytes, 1 KB is 1,000', () => {
    expect(readTargetSize('5', 'MB')).toEqual({ target: { value: 5, unit: 'MB', bytes: 5_000_000, label: '5 MB' }, error: null });
    expect(readTargetSize(' 1.5 ', 'MB').target).toMatchObject({ bytes: 1_500_000, label: '1.5 MB' });
    expect(readTargetSize('0.75', 'MB').target).toMatchObject({ bytes: 750_000, label: '0.75 MB' });
    expect(readTargetSize('500', 'KB').target).toMatchObject({ bytes: 500_000, label: '500 KB' });
    expect(readTargetSize('05', 'MB').target).toMatchObject({ bytes: 5_000_000, label: '5 MB' });
    expect(readTargetSize('10', 'KB').target).toMatchObject({ bytes: 10_000, label: '10 KB' });
  });

  it('reads a unit typed in the one box: "500 KB", "2mb"', () => {
    expect(readTargetSize('500 KB', 'MB').target).toMatchObject({ bytes: 500_000, label: '500 KB', unit: 'KB' });
    expect(readTargetSize('500kb', 'MB').target).toMatchObject({ bytes: 500_000, label: '500 KB' });
    expect(readTargetSize('2mb', 'MB').target).toMatchObject({ bytes: 2_000_000, label: '2 MB' });
    expect(readTargetSize('2 GB', 'MB').error).toBe('Enter a size in MB, such as 5 or 1.5.');
  });

  it('says what is wrong, in the unit chosen', () => {
    expect(readTargetSize('', 'MB').error).toBe('Enter a size in MB, such as 5 or 1.5.');
    expect(readTargetSize('five', 'MB').error).toBe('Enter a size in MB, such as 5 or 1.5.');
    expect(readTargetSize('1,5', 'MB').error).toBe('Enter a size in MB, such as 5 or 1.5.');
    expect(readTargetSize('-2', 'MB').error).toBe('Enter a size in MB, such as 5 or 1.5.');
    expect(readTargetSize('1.234', 'MB').error).toBe('Enter a size in MB, such as 5 or 1.5.');
    expect(readTargetSize('x', 'KB').error).toBe('Enter a size in KB, such as 500.');
    expect(readTargetSize('9', 'KB').error).toBe('Enter at least 10 KB.');
    expect(readTargetSize('0', 'MB').error).toBe('Enter at least 0.01 MB.');
    expect(readTargetSize('1001', 'MB').error).toBe('Enter at most 1000 MB.');
    expect(readTargetSize('1000001', 'KB').error).toBe('Enter at most 1000000 KB.');
  });

  it('checks a size again from its number and unit (the run does not trust the dialog)', () => {
    expect(targetSize({ value: 2, unit: 'MB' })).toMatchObject({ bytes: 2 * MB, label: '2 MB' });
    expect(targetSize({ value: 0.001, unit: 'MB' })).toBeNull();
    expect(targetSize({ value: Number.NaN, unit: 'MB' })).toBeNull();
    expect(targetSize({ value: 5, unit: 'GB' as never })).toBeNull();
  });

  it('offers 1, 2, 5 and 10 MB, and picks the largest that is under the file by default', () => {
    expect(QUICK_SIZES_MB).toEqual([1, 2, 5, 10]);
    expect(defaultFitTarget([12_700_000])).toEqual({ value: 10, unit: 'MB' });
    expect(defaultFitTarget([6 * MB, 2_500_000])).toEqual({ value: 5, unit: 'MB' });
    expect(defaultFitTarget([1_200_000])).toEqual({ value: 1, unit: 'MB' });
    expect(defaultFitTarget([800_000])).toEqual({ value: 1, unit: 'MB' });
    expect(defaultFitTarget([])).toEqual({ value: 1, unit: 'MB' });
  });

  it('names the run by its result, and says why Run waits', () => {
    const five = readTargetSize('5', 'MB').target!;
    expect(fitRunLabel(1, five)).toBe('Compress to fit 5 MB');
    expect(fitRunLabel(3, five)).toBe('Compress 3 files to fit 5 MB');
    const big = pdf('Big.pdf', A2, 2, { size: 12 * MB });
    const small = pdf('Small.pdf', A2, 2, { size: 3_200_000 });
    expect(alreadyUnder([big, small], five).map((f) => f.name)).toEqual(['Small.pdf']);
    expect(fitBlockedReason([big], readTargetSize('', 'MB'))).toBe('Enter a size in MB, such as 5 or 1.5.');
    expect(fitBlockedReason([big, small], readTargetSize('5', 'MB'))).toBeNull();
    expect(fitBlockedReason([small], readTargetSize('5', 'MB'))).toBe('This file is already under 5 MB (3.1 MB); choose a level to make it smaller anyway.');
    expect(fitBlockedReason([small, small], readTargetSize('5', 'MB'))).toBe('These files are already under 5 MB; choose a level to make them smaller anyway.');
  });
});

describe('progress', () => {
  const step = FIT_LADDER[7];
  it('says which attempt is running and out of how many, in plain words (no dpi on screen)', () => {
    expect(fitProgressLabel({ attempt: 0, attempts: 4, step: null, done: 0, total: 0 })).toBe('Checking the file…');
    expect(fitProgressLabel({ attempt: 2, attempts: 4, step, done: 11, total: 40 })).toBe('Attempt 2 of 4: reducing images (12 of 40)…');
    expect(fitProgressLabel({ attempt: 2, attempts: 4, step, done: 40, total: 40 })).toBe('Attempt 2 of 4: reducing images (40 of 40)…');
    expect(fitProgressLabel({ attempt: 3, attempts: 4, step, done: 40, total: 40, saving: true })).toBe('Attempt 3 of 4: measuring the size…');
    expect(fitProgressLabel({ attempt: 1, attempts: 1, step: FIT_FLOOR, done: 3, total: 40 })).toBe('Trying the smallest readable size (4 of 40)…');
    for (const p of [{ attempt: 2, attempts: 4, step, done: 1, total: 4 }, { attempt: 1, attempts: 1, step: FIT_FLOOR, done: 1, total: 4, saving: true }]) {
      expect(fitProgressLabel(p)).not.toMatch(/dpi|quality|pass/i);
    }
  });

  it('moves the bar through the attempts and never back', () => {
    const shares = [
      { attempt: 0, attempts: 4, step: null, done: 0, total: 0 },
      { attempt: 1, attempts: 4, step, done: 0, total: 10 },
      { attempt: 1, attempts: 4, step, done: 10, total: 10 },
      { attempt: 1, attempts: 4, step, done: 10, total: 10, saving: true },
      { attempt: 2, attempts: 4, step, done: 5, total: 10 },
      { attempt: 4, attempts: 4, step, done: 10, total: 10, saving: true },
    ].map((p) => fitProgressShare(p as FitProgress));
    expect(shares).toEqual([...shares].sort((a, b) => a - b));
    expect(shares[0]).toBe(0);
    expect(shares[shares.length - 1]).toBe(1);
    expect(fitProgressShare({ attempt: 2, attempts: 4, step, done: 5, total: 10 })).toBeCloseTo(0.375);
  });
});

// ---- the run -------------------------------------------------------------------------------------

describe('Fit to a size: the run', () => {
  it('adds a result that fits and says so, in the dialog result style', async () => {
    const { ctx, deps, files } = setup();
    const compressToTarget = vi.fn(async () => fit('reached', { newSize: 4_823_449 }));
    const result = await runTool('compress', [pdf('Scan.pdf', B3, 2, { size: 12_700_000 })], { fit: { value: 5, unit: 'MB' } }, ctx, { ...deps, compressToTarget });
    expect(compressToTarget).toHaveBeenCalledWith(B3, 5 * MB, expect.any(Function), expect.any(Function));
    const [made] = files();
    expect(made).toMatchObject({ name: 'Scan_compressed.pdf', pageCount: 2 });
    expect(result).toMatchObject({ status: 'added', tone: 'success', message: 'Compressed Scan_compressed.pdf' });
    expect(result.detail).toBe('4.6 MB, under your 5 MB (was 12.1 MB).');
  });

  it('records the target and the size reached as numbers, and a step that reads "Compressed to fit 5 MB"', async () => {
    const { ctx, deps, files } = setup();
    const compressToTarget = vi.fn(async () => fit('reached'));
    await runTool('compress', [pdf('Scan.pdf', B3, 2)], { fit: { value: 5, unit: 'MB' } }, ctx, { ...deps, compressToTarget });
    const [made] = files();
    expect(made.operation!.options).toEqual({ targetBytes: 5 * MB, reachedBytes: A2.length, fitsTarget: true, dpi: 150, quality: 0.68, attempts: 4 });
    expect(made.operation!.summary).toMatch(/^Compressed to fit 5 MB \(\d+% smaller: 12\.1 MB → .+\)$/);
    const entry = buildActivityEntry({ file: made, destination: 'vault', sha256: 'ab'.repeat(32), vaultRecordId: 'ev-1' });
    expect(entry.details).toMatch(/^Compressed to fit 5 MB \(/);
    expect(entry.metadata).toMatchObject({ options: { targetBytes: 5 * MB, reachedBytes: A2.length, fitsTarget: true } });
  });

  it('says when the images were left as they were (re-saving alone fitted)', async () => {
    const { ctx, deps } = setup();
    const compressToTarget = vi.fn(async () => fit('reached', { newSize: 4_999_000, step: null, attempts: 0, imagesReplaced: 0, lowestDpi: null }));
    const result = await runTool('compress', [pdf('Scan.pdf', B3, 2)], { fit: { value: 5, unit: 'MB' } }, ctx, { ...deps, compressToTarget });
    expect(result.detail).toBe('4.8 MB, under your 5 MB (was 12.1 MB); the images were not changed.');
  });

  it('warns that small text may be hard to read when it had to go as low as the Strong level or lower', async () => {
    const { ctx, deps } = setup();
    const compressToTarget = vi.fn(async () => fit('reached', { newSize: 1_990_000, step: FIT_LADDER[12], lowestDpi: 84 }));
    const result = await runTool('compress', [pdf('Scan.pdf', B3, 2)], { fit: { value: 2, unit: 'MB' } }, ctx, { ...deps, compressToTarget });
    expect(result.detail).toBe('1.9 MB, under your 2 MB (was 12.1 MB); small text may be hard to read.');
  });

  it('offers the smallest readable result when the size cannot be reached, and says it does not fit', async () => {
    const { ctx, deps, files } = setup();
    const compressToTarget = vi.fn(async () => fit('not-reached', { newSize: 7_130_000, step: FIT_FLOOR }));
    const result = await runTool('compress', [pdf('Scan.pdf', B3, 2, { size: 21 * MB })], { fit: { value: 5, unit: 'MB' } }, ctx, { ...deps, compressToTarget });
    expect(files().map((f) => f.name)).toEqual(['Scan_compressed.pdf']);
    expect(result).toMatchObject({ status: 'added', tone: 'warning', message: 'The smallest readable result is 6.8 MB' });
    expect(result.detail).toBe('It does not fit 5 MB: keep it or remove it, or use Split to divide the file.');
    const made = files()[0];
    expect(made.operation!.options).toMatchObject({ targetBytes: 5 * MB, reachedBytes: 7_130_000, fitsTarget: false, dpi: FIT_FLOOR.dpi, quality: FIT_FLOOR.quality });
    expect(made.operation!.summary).toBe('Compressed to the smallest readable size; does not fit 5 MB (44% smaller: 12.1 MB → 6.8 MB)');
  });

  it('says why little can be gained when images are not the bulk of the file', async () => {
    const { ctx, deps } = setup();
    const compressToTarget = vi.fn(async () => fit('not-reached', { imageShare: 0.08, step: FIT_FLOOR }));
    const result = await runTool('compress', [pdf('Ledger.pdf', B3, 2)], { fit: { value: 1, unit: 'MB' } }, ctx, { ...deps, compressToTarget });
    expect(result.detail).toBe(
      'It does not fit 1 MB, as most of this file is text: keep it or remove it, or use Split to divide the file.',
    );
  });

  it('says "just over" when the rounded size would look as if it fits', async () => {
    const { ctx, deps } = setup();
    // 5,100,000 bytes reads "4.9 MB", which would contradict "does not fit 5 MB".
    const compressToTarget = vi.fn(async () => fit('not-reached', { newSize: 5_100_000, step: FIT_FLOOR }));
    const result = await runTool('compress', [pdf('Scan.pdf', B3, 2)], { fit: { value: 5, unit: 'MB' } }, ctx, { ...deps, compressToTarget });
    expect(result.message).toBe('The smallest readable result is just over 5 MB');
    expect(result.detail).toBe('It does not fit 5 MB: keep it or remove it, or use Split to divide the file.');
  });

  it('adds nothing for a file already under the size, and says so', async () => {
    const { ctx, deps, files } = setup();
    const compressToTarget = vi.fn(async () => fit('already-under', { originalSize: 3_200_000, newSize: 3_200_000 }));
    const result = await runTool('compress', [pdf('Small.pdf', B3, 2)], { fit: { value: 5, unit: 'MB' } }, ctx, { ...deps, compressToTarget });
    expect(files()).toEqual([]);
    expect(result).toMatchObject({ status: 'nothing', message: 'Already under 5 MB', detail: 'This file is 3.1 MB, so nothing was added.' });
  });

  it('adds nothing when nothing can be gained, and says why and what to do', async () => {
    const { ctx, deps, files } = setup();
    const text = vi.fn(async () => fit('no-gain', { imageShare: 0, imagesFound: 0 }));
    const one = await runTool('compress', [pdf('Ledger.pdf', B3, 2)], { fit: { value: 1, unit: 'MB' } }, ctx, { ...deps, compressToTarget: text });
    expect(files()).toEqual([]);
    expect(one).toMatchObject({
      status: 'nothing',
      message: 'Cannot fit 1 MB',
      detail: 'Most of this file is text, which cannot be made smaller, so nothing was added; Split can divide it.',
    });
    const images = vi.fn(async () => fit('no-gain', { imageShare: 0.9 }));
    const two = await runTool('compress', [pdf('Scan.pdf', B3, 2)], { fit: { value: 1, unit: 'MB' } }, ctx, { ...deps, compressToTarget: images });
    expect(two.detail).toBe('Its images cannot be made smaller and stay readable, so nothing was added; Split can divide it.');
  });

  it('gives each of several files its own result and names those that did not fit or were already under', async () => {
    const { ctx, deps, files } = setup();
    const outcomes: Record<string, FitResult> = {
      'One.pdf': fit('reached'),
      'Two.pdf': fit('not-reached', { newSize: 7_130_000, step: FIT_FLOOR }),
      'Three.pdf': fit('already-under', { originalSize: 3_200_000 }),
      'Four.pdf': fit('no-gain', { imageShare: 0.1 }),
    };
    const inputs = ['One.pdf', 'Two.pdf', 'Three.pdf', 'Four.pdf'].map((name) => pdf(name, B3.slice(), 2));
    const byBytes = new Map(inputs.map((f) => [f.bytes, outcomes[f.name]]));
    const compressToTarget = vi.fn(async (bytes: Uint8Array) => byBytes.get(bytes)!);
    const result = await runTool('compress', inputs, { fit: { value: 5, unit: 'MB' }, names: ['', 'Second', '', ''] }, ctx, { ...deps, compressToTarget });
    expect(files().map((f) => f.name)).toEqual(['One_compressed.pdf', 'Second.pdf']);
    expect(result).toMatchObject({ status: 'added', tone: 'warning', message: 'Compressed 2 of 4 files for 5 MB' });
    expect(result.detail).toBe(
      'One_compressed.pdf fits. Does not fit 5 MB, kept for you to decide: Second.pdf (6.8 MB). Already under 5 MB: Three.pdf. Cannot be made smaller: Four.pdf.',
    );
  });

  it('says all fitted when several files all reached the size', async () => {
    const { ctx, deps } = setup();
    const compressToTarget = vi.fn(async () => fit('reached'));
    const result = await runTool('compress', [pdf('One.pdf', B3.slice(), 2), pdf('Two.pdf', B3.slice(), 2)], { fit: { value: 5, unit: 'MB' } }, ctx, { ...deps, compressToTarget });
    expect(result).toMatchObject({ tone: 'success', message: 'Compressed 2 files to fit 5 MB', detail: 'Each is under 5 MB.' });
  });

  it('says so when none of several files needed or allowed a result', async () => {
    const { ctx, deps } = setup();
    const under = vi.fn(async () => fit('already-under', { originalSize: 3_200_000 }));
    const both = await runTool('compress', [pdf('One.pdf', B3.slice(), 2), pdf('Two.pdf', B3.slice(), 2)], { fit: { value: 5, unit: 'MB' } }, ctx, { ...deps, compressToTarget: under });
    expect(both).toMatchObject({ status: 'nothing', message: 'Already under 5 MB', detail: 'These files are already under 5 MB, so nothing was added.' });
    let n = 0;
    const mixed = vi.fn(async () => (n++ === 0 ? fit('already-under') : fit('no-gain', { imageShare: 0.05 })));
    const other = await runTool('compress', [pdf('One.pdf', B3.slice(), 2), pdf('Two.pdf', B3.slice(), 2)], { fit: { value: 5, unit: 'MB' } }, ctx, { ...deps, compressToTarget: mixed });
    expect(other).toMatchObject({
      status: 'nothing',
      message: 'Nothing was added',
      detail: 'Already under 5 MB: One.pdf. Cannot be made smaller: Two.pdf.',
    });
  });

  it('shows which attempt is running in the progress label, file by file', async () => {
    const { ctx, deps, progress } = setup();
    const compressToTarget = vi.fn(async (_b: Uint8Array, _t: number, _r: unknown, onProgress?: (p: FitProgress) => void) => {
      onProgress?.({ attempt: 1, attempts: 4, step: FIT_LADDER[7], done: 3, total: 10 });
      return fit('reached');
    });
    await runTool('compress', [pdf('One.pdf', B3.slice(), 2), pdf('Two.pdf', B3.slice(), 2)], { fit: { value: 5, unit: 'MB' } }, ctx, { ...deps, compressToTarget });
    const labels = progress.mock.calls.map((call) => call[2]);
    expect(labels).toContain('One.pdf: Attempt 1 of 4: reducing images (4 of 10)…');
    expect(labels).toContain('Two.pdf: Attempt 1 of 4: reducing images (4 of 10)…');
  });

  it('stops mid-search and adds nothing', async () => {
    const { controller, ctx, deps, files } = setup();
    const compressToTarget = vi.fn(async (_b: Uint8Array, _t: number, _r: unknown, onProgress?: (p: FitProgress) => void) => {
      onProgress?.({ attempt: 2, attempts: 4, step: FIT_LADDER[3], done: 1, total: 10 });
      controller.abort();
      onProgress?.({ attempt: 2, attempts: 4, step: FIT_LADDER[3], done: 2, total: 10 }); // throws: the Stop
      return fit('reached');
    });
    const result = await runTool('compress', [pdf('A.pdf', B3, 2)], { fit: { value: 5, unit: 'MB' } }, ctx, { ...deps, compressToTarget });
    expect(result.status).toBe('cancelled');
    expect(files()).toEqual([]);
  });

  it('marks a result of a signed file as no longer validly signed, as the levels do', async () => {
    const { ctx, deps, files } = setup();
    const compressToTarget = vi.fn(async () => fit('reached'));
    await runTool('compress', [pdf('Signed.pdf', B3, 2, { hasSignature: true })], { fit: { value: 5, unit: 'MB' } }, ctx, { ...deps, compressToTarget });
    const [made] = files();
    expect(made.signatureInvalid).toBe(true);
    expect(made.operation!.flags).toEqual({ signatureInvalid: true });
    expect(made.operation!.summary).toMatch(/; signature no longer valid$/);
  });

  it('refuses a size out of range before doing anything', async () => {
    const { ctx, deps } = setup();
    const compressToTarget = vi.fn();
    await expect(runTool('compress', [pdf('A.pdf', B3, 2)], { fit: { value: 0, unit: 'MB' } }, ctx, { ...deps, compressToTarget })).rejects.toMatchObject({
      code: 'invalid-target',
      message: 'Choose a size from 10 KB to 1000 MB.',
    });
    expect(compressToTarget).not.toHaveBeenCalled();
  });

  it('shows a single file\'s failure as it is, and names a failed file among several', async () => {
    const one = setup();
    const failing = vi.fn(async () => {
      throw new PdfToolsError('recode-failed', 'The images in this file could not be processed, so it was not compressed.');
    });
    await expect(runTool('compress', [pdf('A.pdf', B3, 2)], { fit: { value: 5, unit: 'MB' } }, one.ctx, { ...one.deps, compressToTarget: failing })).rejects.toMatchObject({ code: 'recode-failed' });
    const two = setup();
    let n = 0;
    const mixed = vi.fn(async () => {
      if (n++ === 0) throw new PdfToolsError('recode-failed', 'The images in this file could not be processed, so it was not compressed.');
      return fit('reached');
    });
    const result = await runTool('compress', [pdf('Bad.pdf', B3.slice(), 2), pdf('Good.pdf', B3.slice(), 2)], { fit: { value: 5, unit: 'MB' } }, two.ctx, { ...two.deps, compressToTarget: mixed });
    expect(two.files().map((f) => f.name)).toEqual(['Good_compressed.pdf']);
    expect(result.tone).toBe('warning');
    expect(result.detail).toContain('Not compressed: Bad.pdf (The images in this file could not be processed, so it was not compressed.)');
  });

  it('runs end to end with the real search: the result fits, keeps its pages and text, and the source is unchanged', async () => {
    const { ctx, deps, files } = setup();
    const scan = await makeScanPdf({ pages: 3, image: { kind: 'jpeg', width: 2480, height: 3508, payloadBytes: 400_000 }, text: true });
    const copy = scan.slice();
    const result = await runTool('compress', [pdf('Scan.pdf', scan, 3)], { fit: { value: 500, unit: 'KB' } }, ctx, { ...deps, recoder: modelRecoder() });
    expect(result.status).toBe('added');
    const [made] = files();
    expect(made.bytes.length).toBeLessThanOrEqual(500_000);
    expect((await PDFDocument.load(made.bytes)).getPageCount()).toBe(3);
    expect(await pageTexts(made.bytes)).toEqual(await pageTexts(scan));
    expect(made.operation!.options).toMatchObject({ targetBytes: 500_000, reachedBytes: made.bytes.length, fitsTarget: true });
    // Byte by byte in a plain loop: toEqual on this 1.2 MB array took 22 s and 96 s on a busy machine (most of the
    // test's time, and why it hit its 60 s limit), while the loop takes milliseconds.
    expect(sameBytes(scan, copy), 'the source is unchanged').toBe(true);
  });

  it('leaves the three levels as they were', async () => {
    const { ctx, deps, files } = setup();
    const compressPdf = vi.fn(async (bytes: Uint8Array) => ({ bytes: A2, originalSize: bytes.byteLength * 2, newSize: A2.byteLength, imagesFound: 1, imagesReplaced: 1 }));
    const compressToTarget = vi.fn();
    await runTool('compress', [pdf('Scan.pdf', B3, 2)], { level: 'recommended' }, ctx, { ...deps, compressPdf, compressToTarget });
    expect(compressToTarget).not.toHaveBeenCalled();
    expect(files()[0].operation!.options).toEqual({ level: 'recommended' });
  });
});
