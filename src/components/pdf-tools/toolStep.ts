// THE STEP CONTRACT: what a tool's run step receives, may use and returns. Phase 1's steps (runTool.ts)
// and every phase 2 run module follow it; runTool() calls the step, then checks, names and adds what it made.
//
// A phase 2 run module (bookmarksRun.ts, organiseRun.ts, watermarkRun.ts, protectRun.ts,
// redact/redactRun.ts) exports exactly:
//
//   export const BUILT = true;                       // false only in the stub; the toolbar shows "Soon" until true
//   export interface <Tool>RunOptions { …; name?: string }   // what its dialog passes to run.start(...)
//   export const step: ToolStep<<Tool>RunOptions> = async (run, inputs, options) => { …; return { files, describe } };
//
// and nothing it needs from runTool.ts: it imports from here (types and helpers) and from the libraries.
// runTool.ts loads the module lazily, the first time the tool runs.
//
// What a step gets:
// - `inputs`: the files chosen when the tool was opened, in list order (WorkingFile, read-only; their
//   `bytes` are never changed: libraries copy what they change, the renderer copies what it gives its worker).
// - `options`: the dialog's options, as the dialog passed them. Check them again here: a dialog's checks
//   are a convenience, the step's are the rule.
// - `run` (Run below):
//   - `run.ctx.contextKey`, `run.ctx.session`: the list's scope, captured when Run was pressed;
//     `run.ctx.signal`: the AbortSignal of Cancel/Stop; `run.ctx.store`: the list (read only through `run`).
//   - `run.check()`: throws when the list moved on (engagement, user, session) or the user stopped. Call it
//     after every await of slow work and before anything is added; never catch what it throws (if you must
//     catch a library error, re-throw when `!run.live() || run.ctx.signal.aborted`).
//   - `run.live()`: the scope is still current (for libraries that take a `live: () => boolean`).
//   - `run.progress(done, total, label)`: moves the bar (`total` 0 = cannot be measured) and checks.
//   - `run.slowStep(label)`: shows a busy label, lets it paint, checks; use before a single long library call.
//   - `pageByPage(run, label)`: a ready `onPage(done, total)` hook for libraries that report pages
//     (moves the bar about a hundred times, yields to the window, checks: a Stop takes effect between pages).
//   - `run.ensureRoom(bytes, what)`: refuses BEFORE slow work when the list (heldBytes, so preview bytes
//     count) cannot take `bytes` more; the real size is checked again before adding.
//   - `run.pdfResult(name, bytes, expectedPages, sources, record, extra)`: re-opens the PDF (inspectPdf),
//     checks its page count, works out the flags (signature no longer valid when a source was signed;
//     resources kept whole and bookmarks not carried from `extra.report`; `extra.flags` added as given),
//     ends the summary with their notes, and builds the result row. Use it for every PDF result that is
//     not encrypted.
//   - `run.result(made, sources, record, groupId)`: builds a row without opening it (images; Protect's
//     encrypted file, after the step has verified it itself). Flags and notes are then the step's to set:
//     `run.madeFromSigned(sources)` says whether `signatureInvalid` applies; `summaryWithNotes` adds notes.
//   - `run.deps.paint()`, `run.deps.yieldToUi()`, `run.deps.newId()` (a group id for several results).
// What a step returns: `Made` = `{ files, describe }`. `files` are the result rows (nothing is added
// until the step returns, and only if nothing threw); `describe(files)` writes the message from the final
// rows (names are settled when they are added: a name already in the list gets " (2)"). Return no files to
// say "nothing was made" (then `describe([])` is the notice). Throw a PdfToolsError with a plain message for
// a failure: it is shown as it is; any other error becomes "The tool could not finish…".
// Records: `record.summary` is one line (operationSummary in resultNames.ts, or the tool's own as its design
// section gives it) and `record.options` holds flat strings, numbers and booleans only (activity.ts keeps
// only the allowed keys for Redact and Protect: never a value, term, token or password). A step never logs,
// toasts or formats a secret into a message; its dialog shows the message `describe` returns.
import { carriesAnything, type inspectPdf, type PdfInfo } from '@/lib/pdf-tools/inspect';
import type { MarkReport } from '@/lib/pdf-tools/marks';
import type { BookmarkReport, OrganiseReport } from '@/lib/pdf-tools/organise';
import { historyOf, sourceRef } from '@/lib/pdf-tools/provenance';
import { summaryWithNotes } from '@/lib/pdf-tools/resultNames';
import { listHeldBytes, type WorkingListStore } from '@/lib/pdf-tools/workingList';
import { PdfToolsError, type OperationFlags, type OperationRecord, type ToolId, type WorkingFile } from '@/lib/pdf-tools/types';
import { formatBytes } from './format';
import { markMayBeMisplaced, pageNumberRunNotes, watermarkRunNotes } from './marks/markNotes';

export interface RunContext {
  contextKey: string;
  /** The list's session when Run was pressed (from the screen's guarded state). */
  session: number;
  store: Pick<WorkingListStore, 'getState' | 'addResults'>;
  signal: AbortSignal;
  /** `total` 0 means the step cannot be measured; `label` says what is happening. */
  onProgress: (done: number, total: number, label?: string) => void;
}

/** What the run itself needs; runTool's RunDeps adds the phase 1 libraries its own steps call. */
export interface StepDeps {
  inspectPdf: typeof inspectPdf;
  /** Lets the busy state paint before a slow step on the main thread. */
  paint: () => Promise<void>;
  /** Lets the window handle input between pages. */
  yieldToUi: () => Promise<void>;
  newId: () => string;
  maxBytes: number;
  /** Above this the list is large: the screen warns once when results take it past. */
  warnBytes: number;
}

export interface Description {
  message: string;
  detail?: string;
  tone?: 'success' | 'warning';
}

/**
 * What a tool made. The names are settled only when the results are added (a name the list
 * already holds gets a number), so the message is written from the final files.
 */
export interface Made {
  files: WorkingFile[];
  describe(files: WorkingFile[]): Description;
}

/** The list moved on (engagement, user, session): the run ends without a word. Never caught by a step. */
export class Stale extends Error {}
/** The user stopped the run: nothing is added. Never caught by a step. */
export class Cancelled extends Error {}

export const unverified = () => new PdfToolsError('unverified', 'The result could not be verified and was not added.');
export const wrongInput = (message: string) => new PdfToolsError('wrong-input', message);

/** From this size a result's check is announced first ("Checking the result…"): it takes a noticeable time. */
export const CHECK_NOTICE_BYTES = 10 * 1024 * 1024;
export const CHECKING_RESULT = 'Checking the result…';

/** The fields of a result row a step sets; the run sets the rest (id, origin, size, record, marks). */
export type MadeFile = Pick<WorkingFile, 'name' | 'bytes' | 'kind' | 'mimeType' | 'pageCount'> &
  Partial<Pick<WorkingFile, 'signatureInvalid' | 'sharedResourcesKept' | 'hasFormFields' | 'hasBookmarks' | 'hasPageLinks' | 'hasAttachments' | 'carried' | 'protectedOutput' | 'previewBytes'>>;

export interface PdfResultExtra {
  /** The results of one run that belong together (the parts of a split). */
  groupId?: string;
  /** From the page copy (Split, Delete pages, Organise pages) and the bookmark carry (also Merge). */
  report?: OrganiseReport & BookmarkReport;
  /** Flags the step worked out itself (a mark that may be misplaced, Redact's); only `true` ones count. */
  flags?: OperationFlags;
}

/** Shared by every tool step: the run's checks and how a result row is built. */
export class Run<D extends StepDeps = StepDeps> {
  constructor(
    readonly tool: ToolId,
    readonly ctx: RunContext,
    readonly deps: D,
  ) {}

  live(): boolean {
    const state = this.ctx.store.getState();
    return state.session === this.ctx.session && state.contextKey === this.ctx.contextKey;
  }

  /** Stops the run when the list moved on or the user cancelled. */
  check(): void {
    if (!this.live()) throw new Stale();
    if (this.ctx.signal.aborted) throw new Cancelled();
  }

  progress(done: number, total: number, label?: string): void {
    this.check();
    this.ctx.onProgress(done, total, label);
  }

  /** Shows the step, lets it paint, then checks again before the slow work starts. */
  async slowStep(label: string): Promise<void> {
    this.progress(0, 0, label);
    await this.deps.paint();
    this.check();
  }

  /** What the list holds now: its files and any preview bytes kept with them (workingList.ts heldBytes). */
  listBytes(): number {
    this.check(); // only this session's files are counted
    return listHeldBytes(this.ctx.store.getState().files);
  }

  /**
   * Refuses before the slow work when the outcome is already known: the list is full, or `adding`
   * bytes (a fair lower bound of what will be made) would not fit. The real size is checked again
   * before the results are added.
   */
  ensureRoom(adding = 0, what = 'The result'): void {
    const list = this.listBytes();
    const max = this.deps.maxBytes;
    if (list >= max) {
      throw new PdfToolsError('list-full', `The list is full: ${formatBytes(max)} is the most PDF Tools can hold. Remove some files and try again.`);
    }
    if (list + adding > max) {
      throw new PdfToolsError('list-full', `${what} would take the list over ${formatBytes(max)}. Remove some files from the list and try again.`);
    }
  }

  async verifyPdf(bytes: Uint8Array, expectedPages: number | null): Promise<PdfInfo & { pageCount: number }> {
    let info;
    try {
      info = await this.deps.inspectPdf(bytes);
    } catch {
      throw unverified();
    }
    if (info.encrypted || info.pageCount === null) throw unverified();
    if (expectedPages !== null && info.pageCount !== expectedPages) throw unverified();
    return { ...info, pageCount: info.pageCount };
  }

  /** Every result of a signed file (or of a result marked so) may still hold the signature, no longer valid. */
  madeFromSigned(sources: readonly WorkingFile[]): boolean {
    return sources.some((f) => f.hasSignature || f.signatureInvalid);
  }

  /**
   * Whether a source's password or restrictions were taken off when it was opened (QA-FIX E): the record says
   * "protection removed". Not for Protect, whose result has a password of its own, nor for Document check and
   * Compare (T-064): their result is a report about the files, not a copy of one.
   */
  protectionRemoved(sources: readonly WorkingFile[]): boolean {
    return this.tool !== 'protect' && this.tool !== 'document-check' && this.tool !== 'compare' && sources.some((f) => f.wasProtected);
  }

  result(made: MadeFile, sources: WorkingFile[], record: Pick<OperationRecord, 'summary' | 'options' | 'flags'>, groupId?: string): WorkingFile {
    const flags: OperationFlags = { ...(record.flags ?? {}) };
    let summary = record.summary;
    if (this.protectionRemoved(sources) && !flags.protectionRemoved) {
      flags.protectionRemoved = true;
      summary = summaryWithNotes(summary, { protectionRemoved: true });
    }
    const operation: OperationRecord = { tool: this.tool, summary, sources: sources.map(sourceRef), options: record.options, ...historyOf(sources) };
    if (Object.keys(flags).length > 0) operation.flags = flags;
    const file: WorkingFile = {
      ...made,
      id: this.deps.newId(),
      origin: 'result',
      size: made.bytes.byteLength,
      // The file in hand: a result never has a password unless Protect gave it one (protectedOutput).
      // That a source had one is provenance, kept in the record (flags.protectionRemoved).
      wasProtected: false,
      hasRestrictions: false,
      hasSignature: false, // a result never carries a valid signature
      operation,
      sentTo: [],
    };
    if (groupId) file.groupId = groupId;
    return file;
  }

  async pdfResult(
    name: string,
    bytes: Uint8Array,
    expectedPages: number | null,
    sources: WorkingFile[],
    record: Pick<OperationRecord, 'summary' | 'options'>,
    extra: PdfResultExtra = {},
  ): Promise<WorkingFile> {
    this.check();
    // Opening a large result again for the check holds the window for a while (about 2.5 s for 41 MB,
    // W2-RD): say so first and let it paint, so the window does not seem to hang.
    if (bytes.byteLength >= CHECK_NOTICE_BYTES) await this.slowStep(CHECKING_RESULT);
    const info = await this.verifyPdf(bytes, expectedPages);
    this.check();
    const signatureInvalid = this.madeFromSigned(sources);
    const sharedResourcesKept = extra.report?.sharedResourcesKept === true;
    const flags: OperationFlags = {};
    for (const [flag, on] of Object.entries(extra.flags ?? {}) as [keyof OperationFlags, boolean | undefined][]) if (on === true) flags[flag] = true;
    // Only when a bookmark of the sources is not in this result (design 5.10): never for the pages of another part.
    if ((extra.report?.bookmarksDropped ?? 0) > 0) flags.bookmarksDropped = true;
    if (signatureInvalid) flags.signatureInvalid = true;
    if (sharedResourcesKept) flags.sharedResourcesKept = true;
    if (this.protectionRemoved(sources)) flags.protectionRemoved = true;
    const made: MadeFile = {
      name,
      bytes,
      kind: 'pdf',
      mimeType: 'application/pdf',
      pageCount: info.pageCount,
      hasFormFields: info.hasFormFields,
      hasBookmarks: info.hasBookmarks,
      hasPageLinks: info.hasPageLinks,
      hasAttachments: info.hasAttachments,
      // What the copy still carries, counted from its own bytes (said in the run's message and on its row).
      ...(carriesAnything(info.carried) ? { carried: info.carried } : {}),
      ...(signatureInvalid ? { signatureInvalid: true } : {}),
      ...(sharedResourcesKept ? { sharedResourcesKept: true } : {}),
    };
    return this.result(made, sources, { summary: summaryWithNotes(record.summary, flags), options: record.options, flags }, extra.groupId);
  }
}

/** A tool's run step: phase 1's in runTool.ts, phase 2's as `step` in each run module. */
export type ToolStep<O> = (run: Run, inputs: WorkingFile[], options: O) => Promise<Made>;

/** What every phase 2 run module exports (see the top of this file). */
export interface RunModule<O> {
  /** False only while the module is the integration stub: the tool is shown as "Soon" and never runs. */
  BUILT: boolean;
  step: ToolStep<O>;
}

/** The one PDF a single-file tool works on; anything else is refused. */
export function onePdf(inputs: WorkingFile[]): WorkingFile & { pageCount: number } {
  const [file] = inputs;
  if (inputs.length !== 1 || file.kind !== 'pdf' || file.pageCount === null) throw wrongInput('Choose exactly one PDF.');
  return file as WorkingFile & { pageCount: number };
}

/**
 * Page-by-page progress for a library that reports pages on the main thread: the bar moves, and a
 * cancel takes effect between pages, about a hundred times in a run however long the file.
 */
export function pageByPage(run: Run, label: (page: number, total: number) => string) {
  return async (done: number, total: number) => {
    if (done % Math.max(1, Math.ceil(total / 100)) !== 0) return;
    run.progress(Math.min(done, total), total, label(Math.min(done + 1, total), total));
    await run.deps.yieldToUi();
    run.check();
  };
}

// ---- marks (Watermark, Page numbers) ---------------------------------------------------------------
// One source for what a marks run says: the Watermark lane's marks/markNotes.ts (it gives each warning a
// next step, UX audit principle 6); these two names stay for the run steps that already use them.

/** The flag a marks library report sets: a mark in front may be misplaced on a damaged or unreadable page. */
export function markFlags(report: MarkReport): OperationFlags {
  return markMayBeMisplaced(report) ? { markMayBeMisplaced: true } : {};
}

/** The sentences a marks run adds to its message (marks/markNotes.ts). */
export function markNotes(report: MarkReport, tool: 'watermark' | 'page-numbers'): string[] {
  return tool === 'watermark' ? watermarkRunNotes(report) : pageNumberRunNotes(report);
}
