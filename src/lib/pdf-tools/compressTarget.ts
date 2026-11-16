// Compress, "Fit to a size" (owner decision, 15 November 2026): find the best image quality that brings a PDF
// under a size limit, as portals ask (1, 2, 5, 10 MB), instead of the user trying the three levels in turn.
//
// How (design call): the levels' own image decisions (compress.ts) are run at the steps of one ladder, from
// gentle to a floor, and a binary search finds the gentlest step whose saved file fits. Each step lowers the
// resolution, the JPEG quality or both, so each is smaller than the one before; the three levels are steps of
// it, so a result at a level's step is byte for byte that level's result. Images are never enlarged, an image
// is replaced only when its new encoding is under 90% of the old (so never by something larger), and text,
// fonts and drawings are not touched. Before any image is touched the file is re-saved once: if that alone
// fits, the images stay as they are; and if the part that is not images is already over the target, only the
// floor is tried. The search keeps the result closest under the target; when nothing fits, the floor's
// result: the smallest the file can be while staying readable.
//
// The floor, 72 dpi at JPEG quality 0.36 (design call, from the visual check in lane CT's report): below it,
// ordinary 10 pt text in a scan stops being readable at 100% zoom. At the floor it is soft but readable;
// small print (8 pt and less) and fine figures may not be. The search never goes under it.
import { allRecodesFailed, openCompression, recodeFailed, WORTHWHILE_RATIO, type CompressSettings, type ImageRecoder } from './compress';
import { PdfToolsError } from './types';

export type FitStep = Readonly<CompressSettings>;

/**
 * Gentlest first; the last is the floor. Neither the resolution nor the quality ever rises along it. It holds
 * the three levels exactly: Light (200 dpi, 0.82) at 3, Balanced (150, 0.68) at 6, Strong (96, 0.45) at 10.
 * Fifteen steps: a binary search over them takes exactly four passes.
 */
export const FIT_LADDER: readonly FitStep[] = Object.freeze([
  { dpi: 300, quality: 0.85 },
  { dpi: 250, quality: 0.85 },
  { dpi: 225, quality: 0.82 },
  { dpi: 200, quality: 0.82 },
  { dpi: 200, quality: 0.74 },
  { dpi: 175, quality: 0.7 },
  { dpi: 150, quality: 0.68 },
  { dpi: 135, quality: 0.62 },
  { dpi: 120, quality: 0.56 },
  { dpi: 110, quality: 0.5 },
  { dpi: 96, quality: 0.45 },
  { dpi: 90, quality: 0.42 },
  { dpi: 84, quality: 0.4 },
  { dpi: 78, quality: 0.38 },
  { dpi: 72, quality: 0.36 },
].map((step) => Object.freeze(step)));

/** The lowest step: under it pages stop being readable. */
export const FIT_FLOOR: FitStep = FIT_LADDER[FIT_LADDER.length - 1];

/** Image passes a search can take at most. */
export const FIT_MAX_ATTEMPTS = Math.ceil(Math.log2(FIT_LADDER.length + 1));

/** The smallest target accepted: 10 KB (10,000 bytes). */
export const FIT_MIN_TARGET_BYTES = 10_000;

// Room for what a replaced image's dictionary and the cross-reference stream can lose besides the image data
// itself, so the bound below never wrongly calls a target out of reach.
const DICT_SLACK_PER_IMAGE = 64;
const SLACK = 4096;

export interface FitProgress {
  /** 0 while the file is read and re-saved once; then 1, 2… for each pass over the images. */
  attempt: number;
  /** Passes planned: FIT_MAX_ATTEMPTS, or 1 when only the floor is tried. */
  attempts: number;
  /** The ladder step of this pass; null during the first check. */
  step: FitStep | null;
  /** Images done in this pass, of `total`. */
  done: number;
  total: number;
  /** The pass's images are done and the file is being saved to measure it. */
  saving?: boolean;
}

/**
 * - 'already-under': the file is at or under the target; nothing was made.
 * - 'reached': `bytes` fit the target.
 * - 'not-reached': nothing fits; `bytes` is the smallest readable result (the floor's), offered to the user.
 * - 'no-gain': nothing fits and nothing worthwhile could be made (less than 1% smaller); no bytes.
 */
export type FitOutcome = 'already-under' | 'reached' | 'not-reached' | 'no-gain';

export interface FitResult {
  outcome: FitOutcome;
  bytes: Uint8Array | null;
  targetBytes: number;
  originalSize: number;
  /** The size of `bytes`; for 'already-under' the original's size; for 'no-gain' the smallest size found. */
  newSize: number;
  /** The step `bytes` were made at; null when the images were left as they were. */
  step: FitStep | null;
  /** Image passes run. */
  attempts: number;
  imagesFound: number;
  imagesReplaced: number;
  /** The lowest resolution of a replaced image, in dpi of its page; null when none was replaced. */
  lowestDpi: number | null;
  /** The recodable images' share of the original's bytes, 0 to 1: how much there is to gain. */
  imageShare: number;
}

interface Made {
  bytes: Uint8Array;
  step: FitStep | null;
  replaced: number;
  lowestDpi: number | null;
}

/**
 * Searches for the best image quality that brings `file` to `targetBytes` or under.
 *
 * `onProgress` may throw to stop: the error propagates and nothing is returned (the input is never changed).
 * Throws 'invalid-target' for a target under FIT_MIN_TARGET_BYTES or not a whole number of bytes, and
 * 'not-a-pdf', 'encrypted' and 'recode-failed' as compressPdf does.
 */
export async function compressToTarget(
  file: Uint8Array,
  targetBytes: number,
  recode: ImageRecoder,
  onProgress?: (progress: FitProgress) => void,
): Promise<FitResult> {
  if (!Number.isSafeInteger(targetBytes) || targetBytes < FIT_MIN_TARGET_BYTES) {
    throw new PdfToolsError('invalid-target', 'Choose a size of at least 10 KB.');
  }
  onProgress?.({ attempt: 0, attempts: FIT_MAX_ATTEMPTS, step: null, done: 0, total: 0 });
  const session = await openCompression(file);
  const imageShare = file.length > 0 ? Math.min(1, session.imageBytes / file.length) : 0;
  const base = { targetBytes, originalSize: file.length, imagesFound: session.imagesFound, imageShare };
  const result = (outcome: FitOutcome, made: Made | null, attempts: number, newSize = made?.bytes.length ?? file.length): FitResult => ({
    ...base,
    outcome,
    bytes: made?.bytes ?? null,
    newSize,
    step: made?.step ?? null,
    attempts,
    imagesReplaced: made?.replaced ?? 0,
    lowestDpi: made?.lowestDpi ?? null,
  });
  if (file.length <= targetBytes) return result('already-under', null, 0, file.length);

  // The first check: the file re-saved as it is. Its size before the stamp judges whether a result is worth
  // making at all (a shorter Producer alone is no gain, as for the levels).
  onProgress?.({ attempt: 0, attempts: FIT_MAX_ATTEMPTS, step: null, done: 0, total: 0 });
  const unstamped = (await session.save()).length;
  session.stamp();
  let stampDelta = 0;
  const worthwhile = (size: number) => size - stampDelta <= file.length * WORTHWHILE_RATIO;
  // The re-saved bytes are kept only when they are the answer, so a large file is not held twice during the search.
  const firstCheck = (resaved: Uint8Array): FitResult | number => {
    stampDelta = resaved.length - unstamped;
    const asItIs: Made = { bytes: resaved, step: null, replaced: 0, lowestDpi: null };
    if (resaved.length <= targetBytes) return result('reached', asItIs, 0);
    if (session.candidateCount === 0) return worthwhile(resaved.length) ? result('not-reached', asItIs, 0) : result('no-gain', null, 0, resaved.length);
    return resaved.length;
  };
  const resavedSize = firstCheck(await session.save());
  if (typeof resavedSize !== 'number') return resavedSize;

  // Even with every image gone the file would not fit: only the floor is worth trying.
  const leastPossible = resavedSize - session.imageBytes - DICT_SLACK_PER_IMAGE * session.candidateCount - SLACK;
  const ladder = leastPossible >= targetBytes ? [FIT_FLOOR] : FIT_LADDER;
  const attempts = ladder === FIT_LADDER ? FIT_MAX_ATTEMPTS : 1;

  // Binary search for the gentlest step that fits. Whatever the sizes, it keeps the fitting result closest
  // under the target, and, until something fits, the smallest result seen (the floor's, when nothing fits).
  let best: Made | null = null;
  let smallest: Made | null = null;
  let attempt = 0;
  let lo = 0;
  let hi = ladder.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const step = ladder[mid];
    attempt += 1;
    session.restore();
    const pass = await session.recodeAll(step, recode, (done, total) => onProgress?.({ attempt, attempts, step, done, total }));
    if (allRecodesFailed(pass)) throw recodeFailed();
    onProgress?.({ attempt, attempts, step, done: session.candidateCount, total: session.candidateCount, saving: true });
    const made: Made = { bytes: await session.save(), step, replaced: pass.replaced, lowestDpi: pass.lowestDpi };
    const size = made.bytes.length;
    if (size <= targetBytes) {
      if (!best || size > best.bytes.length) best = made;
      hi = mid;
    } else {
      lo = mid + 1;
    }
    // Once something fits, the smallest is no longer needed (one copy fewer held during the search).
    smallest = best ? null : !smallest || size < smallest.bytes.length ? made : smallest;
  }

  if (best) return result('reached', best, attempt);
  if (smallest && worthwhile(smallest.bytes.length)) return result('not-reached', smallest, attempt);
  return result('no-gain', null, attempt, smallest?.bytes.length ?? resavedSize);
}
