// Compress, "Fit to a size" (owner decision, 15 November 2026), on the screen's side: reading the size the
// user wants, the run step that calls the search (src/lib/pdf-tools/compressTarget.ts) for each file, and every
// message it gives. Plain functions, so that they are unit-tested; the dialog (dialogs/CompressDialog.tsx) and
// runTool.ts's compress step call them.
//
// Sizes are counted the way the strictest portals count them: 1 MB is 1,000,000 bytes and 1 KB is 1,000
// (design call). A result under "5 MB" is then under 5,000,000 bytes, so it passes a portal that counts either
// way. The application shows sizes in 1,024s (formatBytes), so a result that does not fit but would read as if
// it did ("4.9 MB" for 5,100,000 bytes against 5 MB) is called "just over 5 MB".
//
// On screen (owner, 15 November 2026): four quick picks and one box, no technical words (no dpi, quality or
// passes), one short sentence per outcome. The dpi and quality used are kept in the record only.
import { COMPRESS_LEVELS, type CompressLevel, type ImageRecoder } from '@/lib/pdf-tools/compress';
import { compressToTarget, FIT_MIN_TARGET_BYTES, type FitProgress, type FitResult } from '@/lib/pdf-tools/compressTarget';
import { stripExtension } from '@/lib/pdf-tools/fileNames';
import { defaultResultName } from '@/lib/pdf-tools/resultNames';
import { PdfToolsError, type WorkingFile } from '@/lib/pdf-tools/types';
import { formatBytes, plural } from './format';
import { resolveResultName } from './toolOptions';
import { Cancelled, Stale, wrongInput, type Made, type Run, type StepDeps } from './toolStep';

export type SizeUnit = 'MB' | 'KB';

const UNIT_BYTES: Readonly<Record<SizeUnit, number>> = { MB: 1_000_000, KB: 1_000 };

/** The quick picks, in MB: common portal limits. */
export const QUICK_SIZES_MB = [1, 2, 5, 10] as const;

/** The largest size accepted: 1,000 MB (more than the list can hold, so any file is under it). */
export const FIT_MAX_TARGET_BYTES = 1_000_000_000;

/** What the dialog passes: the number and unit as the user chose them. The run reads them again. */
export interface FitTarget {
  value: number;
  unit: SizeUnit;
}

/** A size that can be used: its bytes, and its label in the user's own words ("1.5 MB"). */
export interface TargetSize extends FitTarget {
  bytes: number;
  label: string;
}

export type TargetReading = { target: TargetSize; error: null } | { target: null; error: string };

/** The options of a Fit to a size run (runTool.ts CompressRunOptions). */
export interface CompressFitOptions {
  fit: FitTarget;
  /** One per input, in order; an empty or unusable name falls back to the default. */
  names?: string[];
}

/** The run's needs: the step contract's, the search and the image recoder (runTool.ts RunDeps holds both). */
export interface FitDeps extends StepDeps {
  compressToTarget: typeof compressToTarget;
  recoder: ImageRecoder;
}

// A number with at most two decimal places, and a unit if the user typed one ("500 KB", "2mb").
const NUMBER = /^(\d+(?:\.\d{1,2})?)\s*(mb|kb)?$/i;

/** The size for a number and unit, or null when it is not a usable size (out of range, not a number). */
export function targetSize(target: FitTarget): TargetSize | null {
  const { value, unit } = target;
  if (!Object.prototype.hasOwnProperty.call(UNIT_BYTES, unit) || typeof value !== 'number' || !Number.isFinite(value)) return null;
  const bytes = Math.round(value * UNIT_BYTES[unit]);
  if (bytes < FIT_MIN_TARGET_BYTES || bytes > FIT_MAX_TARGET_BYTES) return null;
  return { value, unit, bytes, label: `${value} ${unit}` };
}

/**
 * Reads the size typed in the one box: "5", "1.5", "0.75" in `unit` (MB in the dialog), or with its own unit
 * typed after it ("500 KB"), so that no unit control is needed (owner, 15 November 2026: one box, no settings).
 */
export function readTargetSize(text: string, unit: SizeUnit = 'MB'): TargetReading {
  const example = unit === 'MB' ? '5 or 1.5' : '500';
  const match = NUMBER.exec(text.trim());
  if (!match) return { target: null, error: `Enter a size in ${unit}, such as ${example}.` };
  if (match[2]) unit = match[2].toUpperCase() as SizeUnit;
  const value = Number(match[1]);
  const bytes = value * UNIT_BYTES[unit];
  if (bytes < FIT_MIN_TARGET_BYTES) return { target: null, error: `Enter at least ${FIT_MIN_TARGET_BYTES / UNIT_BYTES[unit]} ${unit}.` };
  if (bytes > FIT_MAX_TARGET_BYTES) return { target: null, error: `Enter at most ${FIT_MAX_TARGET_BYTES / UNIT_BYTES[unit]} ${unit}.` };
  const target = targetSize({ value, unit });
  return target ? { target, error: null } : { target: null, error: `Enter a size in ${unit}, such as ${example}.` };
}

/** The size offered first: the largest quick pick under the largest file, else 1 MB. */
export function defaultFitTarget(fileSizes: readonly number[]): FitTarget {
  const largest = fileSizes.length > 0 ? Math.max(...fileSizes) : 0;
  const under = QUICK_SIZES_MB.filter((mb) => mb * UNIT_BYTES.MB < largest);
  return { value: under.length > 0 ? under[under.length - 1] : QUICK_SIZES_MB[0], unit: 'MB' };
}

/** "Compress to fit 5 MB", "Compress 3 files to fit 5 MB". */
export function fitRunLabel(count: number, target: TargetSize): string {
  return count === 1 ? `Compress to fit ${target.label}` : `Compress ${count} files to fit ${target.label}`;
}

/** The chosen files that are already at or under the size: nothing is made for them. */
export function alreadyUnder(files: readonly WorkingFile[], target: TargetSize): WorkingFile[] {
  return files.filter((f) => f.size <= target.bytes);
}

/** Why Run waits (principle 8): the size cannot be read, or every file is already under it. */
export function fitBlockedReason(files: readonly WorkingFile[], reading: TargetReading): string | null {
  if (!reading.target) return reading.error;
  const target = reading.target;
  if (files.length === 0 || alreadyUnder(files, target).length < files.length) return null;
  if (files.length === 1) return `This file is already under ${target.label} (${formatBytes(files[0].size)}); choose a level to make it smaller anyway.`;
  return `These files are already under ${target.label}; choose a level to make them smaller anyway.`;
}

// ---- progress ------------------------------------------------------------------------------------

/** What the search is doing, for the progress line, in plain words: which attempt, of how many (no dpi on screen). */
export function fitProgressLabel(p: FitProgress): string {
  if (p.attempt === 0 || !p.step) return 'Checking the file…';
  const count = `(${Math.min(p.done + 1, p.total)} of ${p.total})`;
  if (p.attempts === 1) return p.saving ? 'Trying the smallest readable size: measuring the size…' : `Trying the smallest readable size ${count}…`;
  const attempt = `Attempt ${p.attempt} of ${p.attempts}`;
  return p.saving ? `${attempt}: measuring the size…` : `${attempt}: reducing images ${count}…`;
}

/** How far through the search, 0 to 1: the attempts share the bar evenly. */
export function fitProgressShare(p: FitProgress): number {
  if (p.attempt === 0 || p.attempts <= 0) return 0;
  const within = p.saving ? 1 : p.total > 0 ? p.done / p.total : 1;
  return Math.min(1, Math.max(0, (p.attempt - 1 + within) / p.attempts));
}

// ---- messages and record -------------------------------------------------------------------------

// Below this share of images, compression has little to work on (design call: images under half the file).
const IMAGES_ARE_BULK = 0.5;
// One short sentence per outcome, no technical words (owner, 15 November 2026).
const KEEP_OR_REMOVE = 'keep it or remove it, or use Split to divide the file.';

const indian = (n: number) => n.toLocaleString('en-IN');

/**
 * A size over the target as the messages show it: "just over 5 MB" when the rounded size (1,024s) would read as
 * if it fitted ("4.9 MB" for 5,100,000 bytes against 5 MB).
 */
function overSize(size: number, target: TargetSize): string {
  const shown = formatBytes(size);
  const looksUnder = shown.endsWith(` ${target.unit}`) && Number.parseFloat(shown) <= target.value;
  return looksUnder ? `just over ${target.label}` : shown;
}

function percentSmaller(before: number, after: number): number {
  return Math.min(99, Math.max(1, Math.round((1 - after / before) * 100)));
}

/**
 * "4.6 MB → 2.7 MB"; when the two would read the same ("1.0 MB → 1.0 MB" for a result 1% smaller, user Q&A
 * 5.8), in whole KB, and failing that in bytes, so that the sizes always differ as the files do.
 */
export function sizesText(before: number, after: number): string {
  const usual = [formatBytes(before), formatBytes(after)];
  if (usual[0] !== usual[1] || before === after) return `${usual[0]} → ${usual[1]}`;
  const kb = [before, after].map((n) => Math.round(n / 1024));
  if (kb[0] !== kb[1]) return `${indian(kb[0])} KB → ${indian(kb[1])} KB`;
  return `${indian(before)} bytes → ${indian(after)} bytes`;
}

const LEVEL_IN_NAME: Readonly<Record<CompressLevel, string>> = { low: 'light', recommended: 'balanced', extreme: 'strong' };
const MAX_NAME = 120;

/**
 * The suggested name says how the copy was made (user Q&A 1.24): "Scan_compressed_balanced.pdf",
 * "Scan_compressed_5MB.pdf"; plain "Scan_compressed.pdf" while no size can be read. A long name is cut in
 * its stem, so the ending stays whole.
 */
export function compressResultName(sourceName: string, mode: CompressLevel | 'fit', target?: TargetSize | null): string {
  const plain = defaultResultName('compress', sourceName);
  const how = mode === 'fit' ? (target ? `${target.value}${target.unit}` : null) : LEVEL_IN_NAME[mode];
  if (!how) return plain;
  const ending = `_compressed_${how}`;
  let stem = stripExtension(sourceName);
  const room = MAX_NAME - ending.length - '.pdf'.length;
  if (stem.length > room) stem = stem.slice(0, /[\uD800-\uDBFF]/.test(stem[room - 1] ?? '') ? room - 1 : room);
  return resolveResultName(`${stem}${ending}`, plain, 'pdf');
}

/** The record's one line: "Compressed to fit 5 MB (62% smaller: 12.1 MB → 4.6 MB)". */
export function fitSummary(outcome: FitResult, target: TargetSize): string {
  const sizes = `${percentSmaller(outcome.originalSize, outcome.newSize)}% smaller: ${sizesText(outcome.originalSize, outcome.newSize)}`;
  return outcome.outcome === 'reached'
    ? `Compressed to fit ${target.label} (${sizes})`
    : `Compressed to the smallest readable size; does not fit ${target.label} (${sizes})`;
}

/** The record's options, flat numbers: the target and the size reached, as the levels record their level. */
export function fitRecord(outcome: FitResult, target: TargetSize): Record<string, number | boolean> {
  const record: Record<string, number | boolean> = { targetBytes: target.bytes, reachedBytes: outcome.newSize, fitsTarget: outcome.outcome === 'reached' };
  if (outcome.step) {
    record.dpi = outcome.step.dpi;
    record.quality = outcome.step.quality;
  }
  record.attempts = outcome.attempts;
  return record;
}

/** One sentence: "4.6 MB, under your 5 MB (was 12.1 MB)", and what the user should know about it. */
function reachedDetail(outcome: FitResult, target: TargetSize): string {
  const reached = `${formatBytes(outcome.newSize)}, under your ${target.label} (was ${formatBytes(outcome.originalSize)})`;
  if (!outcome.step) return `${reached}; the images were not changed.`;
  // As far as the Strong level or further: the Strong level's own warning.
  if (outcome.step.quality <= COMPRESS_LEVELS.extreme.quality) return `${reached}; small text may be hard to read.`;
  return `${reached}.`;
}

function noGainDetail(outcome: FitResult): string {
  return outcome.imageShare < IMAGES_ARE_BULK
    ? 'Most of this file is text, which cannot be made smaller, so nothing was added; Split can divide it.'
    : 'Its images cannot be made smaller and stay readable, so nothing was added; Split can divide it.';
}

interface Done {
  source: WorkingFile;
  outcome: FitResult;
  file?: WorkingFile;
}

/**
 * Compress, Fit to a size: each file on its own, searched for the best quality under the size. A file that
 * fits gets its result; one that cannot fit gets its smallest readable result, added for the user to keep or
 * remove, and the message says it does not fit; one already under, or that cannot be made smaller, gets none.
 * Signed and protected sources are handled as the levels handle them (run.pdfResult).
 */
export async function compressToFit(run: Run<FitDeps>, inputs: WorkingFile[], opts: CompressFitOptions): Promise<Made> {
  if (inputs.length === 0 || inputs.some((f) => f.kind !== 'pdf')) throw wrongInput('Only PDFs can be compressed.');
  const target = targetSize(opts.fit);
  if (!target) throw new PdfToolsError('invalid-target', `Choose a size from ${FIT_MIN_TARGET_BYTES / 1000} KB to ${FIT_MAX_TARGET_BYTES / 1_000_000} MB.`);
  const STEPS = 1000; // per file, so several files share one bar
  const several = inputs.length > 1;
  const done: Done[] = [];
  const failed: { name: string; reason: string }[] = [];
  for (const [i, source] of inputs.entries()) {
    const prefix = several ? `${source.name}: ` : '';
    try {
      run.progress(i * STEPS, inputs.length * STEPS, `${prefix}Checking the file…`);
      await run.deps.paint();
      run.check();
      // A Stop ends the search by throwing from its progress callback; nothing of this file is kept.
      const outcome = await run.deps.compressToTarget(source.bytes, target.bytes, run.deps.recoder, (p) => {
        run.progress(i * STEPS + Math.round(fitProgressShare(p) * STEPS), inputs.length * STEPS, `${prefix}${fitProgressLabel(p)}`);
      });
      run.check();
      if (!outcome.bytes || (outcome.outcome !== 'reached' && outcome.outcome !== 'not-reached')) {
        done.push({ source, outcome });
        continue;
      }
      const name = resolveResultName(opts.names?.[i] ?? '', defaultResultName('compress', source.name), 'pdf');
      const record = { summary: fitSummary(outcome, target), options: fitRecord(outcome, target) };
      done.push({ source, outcome, file: await run.pdfResult(name, outcome.bytes, source.pageCount, [source], record) });
    } catch (error) {
      // As for the levels: one file failing does not lose the others; a Stop or a change of engagement stops all.
      if (!several || error instanceof Stale || error instanceof Cancelled || !run.live() || run.ctx.signal.aborted) throw error;
      failed.push({ name: source.name, reason: error instanceof PdfToolsError ? error.message : 'It could not be compressed.' });
    }
  }
  const files = done.flatMap((d) => (d.file ? [d.file] : []));
  return { files, describe: (made) => describeFit(made, done, failed, target, inputs.length) };
}

function describeFit(made: WorkingFile[], done: Done[], failed: { name: string; reason: string }[], target: TargetSize, inputs: number) {
  // The final rows, in the order made (a name already in the list got a number when added).
  const rows = new Map(done.filter((d) => d.file).map((d, k) => [d, made[k] ?? d.file!]));
  const reached = [...rows].filter(([d]) => d.outcome.outcome === 'reached');
  const over = [...rows].filter(([d]) => d.outcome.outcome === 'not-reached');
  const under = done.filter((d) => d.outcome.outcome === 'already-under');
  const noGain = done.filter((d) => d.outcome.outcome === 'no-gain');
  const failedNote = failed.length > 0 ? `Not compressed: ${failed.map((f) => `${f.name} (${f.reason})`).join('; ')}` : '';

  if (inputs === 1 && failed.length === 0) {
    const [d] = done;
    const row = rows.get(d);
    if (row && d.outcome.outcome === 'reached') return { message: `Compressed ${row.name}`, detail: reachedDetail(d.outcome, target) };
    if (row) {
      // The owner's words: "The smallest readable result is 6.8 MB. It does not fit 5 MB." The result is in the
      // list, selected, with the toast's Save and Add buttons: keeping it is one click, removing it another.
      const why = d.outcome.imageShare < IMAGES_ARE_BULK ? ', as most of this file is text' : '';
      return {
        message: `The smallest readable result is ${overSize(d.outcome.newSize, target)}`,
        detail: `It does not fit ${target.label}${why}: ${KEEP_OR_REMOVE}`,
        tone: 'warning' as const,
      };
    }
    if (d.outcome.outcome === 'already-under') {
      return { message: `Already under ${target.label}`, detail: `This file is ${formatBytes(d.outcome.originalSize)}, so nothing was added.` };
    }
    return { message: `Cannot fit ${target.label}`, detail: noGainDetail(d.outcome) };
  }

  const underNote = under.length > 0 ? `Already under ${target.label}: ${under.map((d) => d.source.name).join(', ')}.` : '';
  const noGainNote = noGain.length > 0 ? `Cannot be made smaller: ${noGain.map((d) => d.source.name).join(', ')}.` : '';
  if (made.length === 0) {
    if (failed.length > 0) throw new PdfToolsError('compress-failed', ['No file was compressed.', failedNote, underNote, noGainNote].filter(Boolean).join(' '));
    if (noGain.length === 0) return { message: `Already under ${target.label}`, detail: `These files are already under ${target.label}, so nothing was added.` };
    return { message: 'Nothing was added', detail: [underNote, noGainNote].filter(Boolean).join(' ') };
  }
  const allFit = reached.length === inputs;
  const reachedNote = allFit ? `Each is under ${target.label}.` : reached.length > 0 ? `${reached.map(([, row]) => row.name).join(', ')} ${reached.length === 1 ? 'fits' : 'fit'}.` : '';
  const overNote =
    over.length > 0 ? `Does not fit ${target.label}, kept for you to decide: ${over.map(([d, row]) => `${row.name} (${overSize(d.outcome.newSize, target)})`).join(', ')}.` : '';
  return {
    message: allFit ? `Compressed ${plural(made.length, 'file')} to fit ${target.label}` : `Compressed ${made.length} of ${inputs} files for ${target.label}`,
    detail: [reachedNote, overNote, underNote, noGainNote, failedNote].filter(Boolean).join(' '),
    tone: over.length > 0 || failed.length > 0 ? ('warning' as const) : ('success' as const),
  };
}
