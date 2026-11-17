import { PDFArray, PDFDocument, PDFName, PDFRawStream, StandardFonts } from 'pdf-lib';
import { beforeAll, describe, expect, it, onTestFinished, vi } from 'vitest';
import { COMPRESS_LEVELS, compressAtStep, type ImageRecoder, type RecodeRequest } from './compress';
import { compressToTarget, FIT_FLOOR, FIT_LADDER, FIT_MAX_ATTEMPTS, FIT_MIN_TARGET_BYTES, type FitProgress } from './compressTarget';
import { fakeJpeg, makeMostlyTextPdf, makeScanPdf, makeTextPdf, modelBytes, modelRecoder } from './testCompressPdf';
import { pageTexts } from './testPdf';

vi.setConfig({ testTimeout: 60_000 });

beforeAll(async () => {
  await import('pdfjs-dist/legacy/build/pdf.mjs');
}, 60_000);

// Four A4 pages scanned at 300 dpi, 400 KB a page as stored: about 1.6 MB.
const scan = () => makeScanPdf({ pages: 4, image: { kind: 'jpeg', width: 2480, height: 3508, payloadBytes: 400_000 }, text: true });

/** The size the file has at every step of the ladder, worked out one by one (what the search must agree with). */
async function sizesAtEveryStep(file: Uint8Array, recode: ImageRecoder): Promise<number[]> {
  const sizes: number[] = [];
  for (const step of FIT_LADDER) sizes.push((await compressAtStep(file, step, recode)).bytes.length);
  return sizes;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

describe('the ladder', () => {
  it('goes from gentle to the floor, never raising the resolution or the quality, and holds the three levels', () => {
    expect(FIT_LADDER.length).toBe(15);
    for (let i = 1; i < FIT_LADDER.length; i++) {
      expect(FIT_LADDER[i].dpi).toBeLessThanOrEqual(FIT_LADDER[i - 1].dpi);
      expect(FIT_LADDER[i].quality).toBeLessThanOrEqual(FIT_LADDER[i - 1].quality);
      expect(FIT_LADDER[i].dpi < FIT_LADDER[i - 1].dpi || FIT_LADDER[i].quality < FIT_LADDER[i - 1].quality).toBe(true);
    }
    expect(FIT_LADDER[FIT_LADDER.length - 1]).toEqual(FIT_FLOOR);
    for (const level of Object.values(COMPRESS_LEVELS)) expect(FIT_LADDER).toContainEqual({ dpi: level.dpi, quality: level.quality });
    // Binary search over 15 steps: never more than four image passes.
    expect(FIT_MAX_ATTEMPTS).toBe(4);
  });

  it('has its floor below the Strong level and at 72 dpi or more', () => {
    expect(FIT_FLOOR.dpi).toBeGreaterThanOrEqual(72);
    expect(FIT_FLOOR.dpi).toBeLessThan(COMPRESS_LEVELS.extreme.dpi);
    expect(FIT_FLOOR.quality).toBeLessThan(COMPRESS_LEVELS.extreme.quality);
  });
});

describe('compressToTarget: reaching the size', () => {
  it('picks the best-quality step that fits, which is the largest result under the target, for every target', async () => {
    const file = await scan();
    const recode = modelRecoder();
    // The modification date is in every result: pinned, so that a size depends only on the images.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-15T10:00:00Z'));
    onTestFinished(() => {
      vi.useRealTimers();
    });
    const sizes = await sizesAtEveryStep(file, recode);
    // The model makes each step no larger than the one before.
    for (let i = 1; i < sizes.length; i++) expect(sizes[i]).toBeLessThanOrEqual(sizes[i - 1]);
    // The file re-saved with every image as it was: when that fits, no image is touched.
    const asItIs = (await compressAtStep(file, FIT_LADDER[0], async () => null)).bytes.length;
    const floor = sizes[sizes.length - 1];
    // Targets between the floor and the source, plus each step's exact size (the edge must count as fitting).
    const targets = [...sizes, ...Array.from({ length: 9 }, (_, k) => Math.round(floor + ((file.length - floor) * (k + 0.5)) / 9))];
    for (const target of targets) {
      const seen: RecodeRequest[] = [];
      const res = await compressToTarget(file, target, modelRecoder(seen));
      const best = sizes.findIndex((size) => size <= target);
      expect(res.outcome, `target ${target}`).toBe('reached');
      expect(res.newSize).toBeLessThanOrEqual(target);
      expect(res.bytes!.length).toBe(res.newSize);
      if (asItIs <= target) {
        expect(res).toMatchObject({ newSize: asItIs, step: null, attempts: 0, imagesReplaced: 0 });
        expect(seen).toEqual([]);
        continue;
      }
      expect(res.newSize, `target ${target}`).toBe(sizes[best]);
      expect(res.step).toEqual(FIT_LADDER[best]);
      expect(res.attempts).toBe(FIT_MAX_ATTEMPTS);
      expect(res.newSize).toBeLessThan(file.length);
      // No step's result between the target and the one chosen: nothing closer under the target was missed.
      expect(sizes.filter((s) => s <= target && s > res.newSize)).toEqual([]);
    }
    // A hang guard only: the sizes decide. 61 s against the file's 60 s in INT3's full run on a machine at about
    // twenty times its idle load (each save now gives the window a turn by the clock, pace.ts).
  }, 300_000);

  it('fits a scan whose images carry an ICC colour profile, and keeps the profile', async () => {
    const file = await makeScanPdf({ pages: 4, image: { kind: 'jpeg', width: 2480, height: 3508, payloadBytes: 400_000, profile: true } });
    const target = Math.round(file.length * 0.3);
    const res = await compressToTarget(file, target, modelRecoder());
    expect(res).toMatchObject({ outcome: 'reached', imagesFound: 4, imagesReplaced: 4 });
    expect(res.newSize).toBeLessThanOrEqual(target);
    expect(res.imageShare).toBeGreaterThan(0.95);
    const out = await PDFDocument.load(res.bytes!);
    const images = out.context.enumerateIndirectObjects().filter(([, o]) => o instanceof PDFRawStream && o.dict.get(PDFName.of('Subtype')) === PDFName.of('Image'));
    expect(images).toHaveLength(4);
    for (const [, image] of images) expect((image as PDFRawStream).dict.lookup(PDFName.of('ColorSpace'), PDFArray).lookup(0)).toBe(PDFName.of('ICCBased'));
  });

  it('returns a whole, readable file with the text and the pages kept', async () => {
    const file = await scan();
    const res = await compressToTarget(file, Math.round(file.length * 0.3), modelRecoder());
    expect(res.outcome).toBe('reached');
    const out = await PDFDocument.load(res.bytes!, { updateMetadata: false });
    expect(out.getPageCount()).toBe(4);
    expect(out.getProducer()).toBe('ICAI VERA');
    expect(await pageTexts(res.bytes!)).toEqual(await pageTexts(file));
    expect(res).toMatchObject({ originalSize: file.length, targetBytes: Math.round(file.length * 0.3), imagesFound: 4, imagesReplaced: 4 });
    expect(res.imageShare).toBeGreaterThan(0.95);
  });

  it('gives the same bytes as the level when the step chosen is that level', async () => {
    const file = await scan();
    const recode = modelRecoder();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-15T10:00:00Z'));
    try {
      const balanced = await compressAtStep(file, COMPRESS_LEVELS.recommended, recode);
      const res = await compressToTarget(file, balanced.bytes.length, recode);
      expect(res.step).toEqual({ dpi: 150, quality: 0.68 });
      expect(sameBytes(res.bytes!, balanced.bytes)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('never asks for more pixels than the image has, nor for a higher quality than the step', async () => {
    // 100 dpi scans: every step at or above 100 dpi asks for the image at its own size.
    const file = await makeScanPdf({ pages: 2, image: { kind: 'jpeg', width: 827, height: 1169, payloadBytes: 300_000 } });
    const seen: RecodeRequest[] = [];
    await compressToTarget(file, Math.round(file.length * 0.2), modelRecoder(seen));
    expect(seen.length).toBeGreaterThan(0);
    for (const r of seen) {
      expect(r.targetWidth).toBeLessThanOrEqual(827);
      expect(r.targetHeight).toBeLessThanOrEqual(1169);
      expect(FIT_LADDER.some((s) => s.quality === r.quality)).toBe(true);
    }
  });

  it('never replaces an image with a larger one: a recoder that only grows images leaves the file as it was', async () => {
    const file = await scan();
    const growing: ImageRecoder = async (r) => fakeJpeg(r.targetWidth, r.targetHeight, r.source.bytes.length + 100);
    const res = await compressToTarget(file, Math.round(file.length * 0.5), growing);
    expect(res.imagesReplaced).toBe(0);
    expect(res.outcome).toBe('no-gain');
    expect(res.bytes).toBeNull();
  });

  it('keeps images that would shrink by less than a tenth, as the levels do', async () => {
    const file = await scan();
    // Only the floor step shrinks an image enough to be used.
    const recode: ImageRecoder = async (r) => fakeJpeg(r.targetWidth, r.targetHeight, r.quality <= FIT_FLOOR.quality ? 50_000 : Math.floor(r.source.bytes.length * 0.95));
    const res = await compressToTarget(file, Math.round(file.length * 0.5), recode);
    expect(res).toMatchObject({ outcome: 'reached', step: FIT_FLOOR, imagesReplaced: 4 });
  });

  it('leaves the images alone when re-saving alone fits, and runs no image pass', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    // A loose file (no object streams): re-saving it compactly makes it smaller.
    for (let n = 0; n < 400; n++) doc.addPage([300, 400]).drawText(`Page ${n}`, { x: 20, y: 200, size: 12, font });
    const loose = await doc.save({ useObjectStreams: false });
    expect(loose.length).toBeGreaterThan(5 * FIT_MIN_TARGET_BYTES);
    // Pinned, as above: the re-save here and the one in the search must not differ by the clock.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-15T10:00:00Z'));
    onTestFinished(() => {
      vi.useRealTimers();
    });
    const resaved = (await compressAtStep(loose, FIT_FLOOR, modelRecoder())).bytes.length;
    expect(resaved).toBeLessThan(loose.length);
    let calls = 0;
    const res = await compressToTarget(loose, resaved + 10, async () => { calls++; return null; });
    expect(res).toMatchObject({ outcome: 'reached', step: null, attempts: 0, imagesReplaced: 0 });
    expect(res.newSize).toBeLessThanOrEqual(resaved + 10);
    expect(calls).toBe(0);
  });
});

describe('compressToTarget: when the size is not reached', () => {
  it('offers the smallest readable result, made at the floor, and says it does not fit', async () => {
    const file = await scan();
    const recode = modelRecoder();
    // The modification date is in every result: pinned, so that the floor's size here and in the search is the
    // same (two saves a second apart differ by a few bytes, and a busy machine puts them in different seconds).
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-15T10:00:00Z'));
    onTestFinished(() => {
      vi.useRealTimers();
    });
    const floor = (await compressAtStep(file, FIT_FLOOR, recode)).bytes.length;
    const res = await compressToTarget(file, floor - 1, recode);
    expect(res).toMatchObject({ outcome: 'not-reached', step: FIT_FLOOR, newSize: floor, targetBytes: floor - 1 });
    expect(res.bytes!.length).toBe(floor);
    expect(res.attempts).toBeLessThanOrEqual(FIT_MAX_ATTEMPTS);
    expect(res.lowestDpi).toBe(FIT_FLOOR.dpi);
  });

  it('never goes below the floor, whatever the target', async () => {
    const file = await scan();
    const seen: RecodeRequest[] = [];
    await compressToTarget(file, FIT_MIN_TARGET_BYTES, modelRecoder(seen));
    expect(seen.length).toBeGreaterThan(0);
    for (const r of seen) {
      expect(r.quality).toBeGreaterThanOrEqual(FIT_FLOOR.quality);
      // A4 at the floor dpi, as each image fills its page.
      expect(r.targetWidth).toBeGreaterThanOrEqual(Math.round(8.27 * FIT_FLOOR.dpi) - 1);
    }
  });

  it('goes straight to the floor when the part that is not images is already over the target', async () => {
    const file = await makeMostlyTextPdf(30);
    const attempts: number[] = [];
    const res = await compressToTarget(file, Math.round(file.length * 0.5), modelRecoder(), (p) => attempts.push(p.attempt));
    expect(res.attempts).toBe(1);
    expect(Math.max(...attempts)).toBe(1);
    expect(res.outcome === 'not-reached' || res.outcome === 'no-gain').toBe(true);
    expect(res.imageShare).toBeLessThan(0.5);
  });

  it('says nothing can be gained from a text-only file, without asking for any image', async () => {
    const file = await makeTextPdf(20);
    let calls = 0;
    const res = await compressToTarget(file, Math.round(file.length * 0.5), async () => { calls++; return null; });
    expect(calls).toBe(0);
    expect(res).toMatchObject({ outcome: 'no-gain', bytes: null, imagesFound: 0, imageShare: 0 });
  });
});

describe('compressToTarget: already under', () => {
  it('does nothing when the file is already at or under the target', async () => {
    const file = await scan();
    for (const target of [file.length, file.length + 1, file.length * 3]) {
      let calls = 0;
      const res = await compressToTarget(file, target, async () => { calls++; return null; });
      expect(res).toMatchObject({ outcome: 'already-under', bytes: null, attempts: 0, newSize: file.length, originalSize: file.length });
      expect(calls).toBe(0);
    }
  });
});

describe('compressToTarget: progress and stopping', () => {
  it('says which attempt is running, out of how many, and at which step', async () => {
    const file = await scan();
    const progress: FitProgress[] = [];
    const res = await compressToTarget(file, Math.round(file.length * 0.25), modelRecoder(), (p) => progress.push({ ...p }));
    const attempts = progress.filter((p) => p.attempt > 0);
    expect(attempts.length).toBeGreaterThan(0);
    expect(new Set(attempts.map((p) => p.attempts))).toEqual(new Set([FIT_MAX_ATTEMPTS]));
    expect(Math.max(...attempts.map((p) => p.attempt))).toBe(res.attempts);
    for (const p of attempts) expect(FIT_LADDER).toContainEqual(p.step);
    // Attempt numbers only go up, and each attempt reports its images up to (total, total).
    const order = attempts.map((p) => p.attempt);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    for (let a = 1; a <= res.attempts; a++) {
      const mine = attempts.filter((p) => p.attempt === a && !p.saving);
      expect(mine.at(-1)).toMatchObject({ done: 4, total: 4 });
    }
    expect(progress[0]).toMatchObject({ attempt: 0, step: null });
  });

  it('stops part-way through an attempt and leaves nothing: no result, the input unchanged, no more images asked', async () => {
    const file = await scan();
    const copy = file.slice();
    const stop = new Error('stopped');
    let calls = 0;
    let callsAtStop = -1;
    const run = compressToTarget(file, Math.round(file.length * 0.25), async (r) => { calls++; return fakeJpeg(r.targetWidth, r.targetHeight, modelBytes(r)); }, (p) => {
      if (p.attempt === 2 && p.done === 1) {
        callsAtStop = calls;
        throw stop;
      }
    });
    await expect(run).rejects.toBe(stop);
    expect(calls).toBe(callsAtStop);
    expect(sameBytes(file, copy)).toBe(true);
  });

  it('stops during the first check too', async () => {
    const file = await scan();
    const stop = new Error('stopped');
    let calls = 0;
    await expect(compressToTarget(file, 1000_000, async () => { calls++; return null; }, () => { throw stop; })).rejects.toBe(stop);
    expect(calls).toBe(0);
  });
});

describe('compressToTarget: refusals and failures', () => {
  it('refuses a target below the smallest size it accepts, or one that is not a whole number of bytes', async () => {
    const file = await scan();
    for (const bad of [0, -5, FIT_MIN_TARGET_BYTES - 1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(compressToTarget(file, bad, modelRecoder())).rejects.toMatchObject({ code: 'invalid-target' });
    }
  });

  it('refuses a password-protected file and bytes that are not a PDF, as the levels do', async () => {
    const doc = await PDFDocument.create({ updateMetadata: false });
    doc.addPage();
    doc.context.trailerInfo.Encrypt = doc.context.register(doc.context.obj({ Filter: 'Standard', V: 1, R: 2 }));
    await expect(compressToTarget(await doc.save(), 20_000, modelRecoder())).rejects.toMatchObject({ code: 'encrypted' });
    await expect(compressToTarget(new TextEncoder().encode('hello'.repeat(10_000)), 20_000, modelRecoder())).rejects.toMatchObject({ code: 'not-a-pdf' });
  });

  it('reports a failure when every image fails to recode, as the levels do', async () => {
    const file = await scan();
    await expect(compressToTarget(file, Math.round(file.length * 0.5), async () => { throw new Error('no canvas'); })).rejects.toMatchObject({ code: 'recode-failed' });
  });

  it('recodes an image shared by several pages once per attempt', async () => {
    const doc = await PDFDocument.create();
    const { addImage, drawImage, A4 } = await import('./testCompressPdf');
    const ref = addImage(doc, { kind: 'jpeg', width: 2480, height: 3508, payloadBytes: 600_000 });
    for (let n = 0; n < 3; n++) drawImage(doc.addPage(A4), 'Im1', ref, [0, 0, ...A4]);
    const file = await doc.save();
    const seen: RecodeRequest[] = [];
    const res = await compressToTarget(file, Math.round(file.length * 0.3), modelRecoder(seen));
    expect(seen.length).toBe(res.attempts);
    expect(res.imagesFound).toBe(1);
  });
});
