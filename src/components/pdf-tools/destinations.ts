// Where results go besides the list: the Evidence Vault, a working paper, and the activity record
// of a save to the computer (spec section 6). No React here; the screen passes in the store, the
// existing hooks' functions and the scope, so the rules are unit-tested.
//
// Confidentiality. The scope (context key, session, engagement, user) is taken when the user
// confirms, before anything is awaited. After every await the store must still be in that scope
// before anything new is started (the next file, an attachment after its vault step), and before
// a row is marked or anything is reported; if it is not, the batch stops without a word and lets
// go of the bytes. An upload or attachment already under way when the engagement changes was
// started for its own engagement and is written there (useEvidenceFiles' upload is the one from the
// render the user confirmed in). It is not marked or shown, but its activity entry, which holds the
// only record of its SHA-256, is still written, silently and with the captured engagement id, as
// long as the same user is signed in (never under another user's name).
import { buildActivityEntry, type ActivityEntry } from '@/lib/pdf-tools/activity';
import type { WorkingListStore } from '@/lib/pdf-tools/workingList';
import type { Destination, SourceRef, VaultRecord, WorkingFile } from '@/lib/pdf-tools/types';
import { plainMessage } from './format';
import { cleanedName, numberedName } from './saveToComputer';
import { isLockedFlag } from './vaultBytes';

export type EvidenceType = 'document' | 'screenshot' | 'confirmation' | 'analysis' | 'other';

/** The vault's own five types, in the order its upload form lists them. */
export const EVIDENCE_TYPES: readonly { value: EvidenceType; label: string }[] = [
  { value: 'document', label: 'Document' },
  { value: 'screenshot', label: 'Screenshot' },
  { value: 'confirmation', label: 'Confirmation' },
  { value: 'analysis', label: 'Analysis' },
  { value: 'other', label: 'Other' },
];

export const ATTACH_FAILED = 'Attachment failed. The file is in the Evidence Vault; you can retry.';
export const LOG_FAILED = 'Saved, but the activity record could not be written.';
export const NOT_IN_VAULT = 'It is no longer in the Evidence Vault. Attach it again to add it there first.';
export const VAULT_UNCHECKED = 'The Evidence Vault could not be checked for this file. Try again.';
const VAULT_REFUSED = 'The Evidence Vault did not accept it.';

/** The longest a check (is the record there? who is signed in?) may take before it counts as unanswered. */
export const CHECK_TIMEOUT_MS = 10_000;

/** The promise's answer, or `fallback` when it fails or does not answer within `ms`. */
export function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}

/** Badge tone per destination: a download's completion is not confirmed, so it is not shown as a save. */
export const SENT_TONES: Record<Destination, 'success' | 'neutral'> = {
  computer: 'success',
  download: 'neutral',
  vault: 'success',
  'working-paper': 'success',
};

/**
 * A result not known to be kept anywhere: sent nowhere, or only to a download whose completion
 * cannot be seen. It is marked "Not saved" and removing it asks first.
 */
export function isUnsavedResult(file: Pick<WorkingFile, 'origin' | 'sentTo'>): boolean {
  return file.origin === 'result' && file.sentTo.every((d) => d === 'download');
}

/** Whether a vault record a row points at still exists. 'unknown': it could not be checked. */
export type VaultRecordState = 'present' | 'missing' | 'unknown';

/** The vault list the screen holds: `loaded` once its first fetch has finished (it may have failed). */
export interface VaultListView {
  loaded: boolean;
  ids: ReadonlySet<string>;
}

/** What a destination is tied to, captured when the user confirms. */
export interface DestinationScope {
  contextKey: string;
  session: number;
  engagementId: string;
  userId: string;
}

/** The vault form: a name per file (by id; blank or missing means the file's own name), one type and one reference. */
export interface VaultForm {
  names: Record<string, string>;
  fileType: EvidenceType;
  workpaperRef: string;
}

export interface AttachTarget {
  programId: string;
  programName: string;
  sectionId?: string | null;
  sectionName?: string;
  boxId?: string | null;
  boxHeader?: string;
}

/** The row useEvidenceFiles().uploadFile returns. */
export interface UploadedRow {
  id: string;
  name: string;
  file_path: string;
  file_type: string;
  file_size: number;
}

/** What useAuditExecutionAttachments().createAttachment inserts. */
export interface AttachmentInput {
  audit_program_id: string;
  section_id: string | null;
  box_id: string | null;
  file_name: string;
  file_type: string;
  file_size: number;
  file_path: string;
  uploaded_by: string;
  description: string | null;
  is_evidence: boolean;
}

/** What useActivityLogs().logActivity takes; the engagement is always the scope's. */
export interface ActivityParams {
  action: string;
  entity: string;
  entityId?: string;
  engagementId: string;
  details: string;
  metadata: Record<string, unknown>;
}

export interface DestinationDeps {
  store: Pick<WorkingListStore, 'getState' | 'markSent' | 'unmarkVault'>;
  hash(bytes: Uint8Array): Promise<string>;
  /** Returns the inserted row, or null when it failed (the hook has already said why). */
  uploadFile(file: File, meta: { name: string; file_type: string; workpaper_ref?: string }): Promise<UploadedRow | null>;
  /** Returns the inserted attachment, or null when it failed (the hook has already said why). */
  createAttachment(input: AttachmentInput): Promise<unknown>;
  logActivity(params: ActivityParams): Promise<boolean>;
  /** Checks, before an attachment reuses a row's vault record, that the record still exists. */
  vaultRecordState?(record: VaultRecord, engagementId: string): Promise<VaultRecordState>;
  /**
   * The user the main process has signed in, or null. Asked before a late entry when the store
   * cannot tell: its key is emptied both on sign-out and by the engagement watch.
   */
  signedInUserId?(): Promise<string | null>;
}

export interface BatchOptions {
  /** Checked before each file: a file being sent is finished, the rest are not started. */
  signal?: AbortSignal;
  onProgress?(done: number, total: number, name: string): void;
}

export interface BatchFailure {
  id: string;
  name: string;
  /**
   * 'vault': not added to the vault; 'attach': in the vault but not attached; 'check': its vault
   * record is gone or could not be checked, so it was not attached.
   */
  stage: 'vault' | 'attach' | 'check';
  reason: string;
}

export interface BatchResult {
  /** 'stale': the engagement or session changed; nothing more is to be said. */
  status: 'done' | 'stopped' | 'stale';
  succeeded: { id: string; name: string }[];
  failed: BatchFailure[];
  /** Ids of the files that got a new vault record in this batch. */
  addedToVault: string[];
  /** Ids of the rows whose vault mark was dropped because their record is gone. */
  droppedFromVault: string[];
  logFailures: number;
  notStarted: number;
}

const isLive = (scope: DestinationScope, store: Pick<WorkingListStore, 'getState'>): boolean => {
  const state = store.getState();
  return state.contextKey === scope.contextKey && state.session === scope.session;
};

/**
 * Whether the user who confirmed is still the one signed in. A store showing another user's list
 * says no at once. An emptied store (sign-out, or the engagement watch noticing a change) cannot
 * tell, so the main process is asked; without that question (tests) an emptied store says no.
 */
async function sameUser(scope: DestinationScope, deps: Pick<DestinationDeps, 'store' | 'signedInUserId'>): Promise<boolean> {
  const key = deps.store.getState().contextKey;
  if (key !== null) return key.startsWith(`${scope.userId}:`);
  if (!deps.signedInUserId) return false;
  try {
    // No answer within the limit counts as "not the same user": nothing is written.
    return (await withTimeout(deps.signedInUserId(), CHECK_TIMEOUT_MS, null)) === scope.userId;
  } catch {
    return false;
  }
}

/**
 * The entry of work that finished after the user changed engagement: written silently, with the
 * captured engagement id, and only while the same user is signed in. Nothing is marked or shown.
 */
async function writeLateLog(entry: () => ActivityEntry, scope: DestinationScope, deps: DestinationDeps): Promise<void> {
  if (!(await sameUser(scope, deps))) return;
  try {
    await writeLog(entry(), scope, deps);
  } catch {
    // nothing can be shown after a change; the vault's own "Uploaded" entry still exists
  }
}

/** Whether a vault record still exists: the loaded list first, then one lookup by id for any it does not show. */
export async function vaultRecordState(
  record: VaultRecord,
  list: VaultListView,
  lookup: (id: string) => Promise<VaultRecordState>,
): Promise<VaultRecordState> {
  // A list whose first load failed is empty, so absence from it proves nothing: the lookup decides,
  // and a file is never uploaded a second time because of a failed load.
  if (list.loaded && list.ids.has(record.id)) return 'present';
  try {
    return await lookup(record.id);
  } catch {
    return 'unknown';
  }
}

/**
 * Before a destination dialog opens: drops the vault mark of rows whose vault record has gone, so
 * the dialog offers the vault form for them again. Rows that could not be checked keep their mark
 * (the attachment checks again). Nothing is dropped if the scope moved on meanwhile.
 */
export async function dropMissingVaultRecords(
  files: readonly WorkingFile[],
  check: (record: VaultRecord, engagementId: string) => Promise<VaultRecordState>,
  scope: DestinationScope,
  store: Pick<WorkingListStore, 'getState' | 'unmarkVault'>,
): Promise<{ status: 'done' | 'stale'; dropped: string[] }> {
  const withRecord = files.filter((f) => f.vaultRecord);
  // Checked within the engagement captured at the click; an unanswered check keeps the mark, so the
  // dialog always opens within the time limit.
  const states = await Promise.all(withRecord.map((f) => withTimeout(check(f.vaultRecord!, scope.engagementId), CHECK_TIMEOUT_MS, 'unknown' as VaultRecordState)));
  if (!isLive(scope, store)) return { status: 'stale', dropped: [] };
  const dropped: string[] = [];
  withRecord.forEach((file, i) => {
    if (states[i] === 'missing' && store.unmarkVault(scope.contextKey, scope.session, file.id)) dropped.push(file.id);
  });
  return { status: 'done', dropped };
}

/** Results only, in list order: inputs from the computer or the vault are not sent anywhere from here. */
export function resultsOf(files: readonly WorkingFile[]): WorkingFile[] {
  return files.filter((f) => f.origin === 'result');
}

/** The cleaned name a file goes to the vault under: the typed name, else its own; its type decides the extension. */
export function vaultName(file: WorkingFile, typed?: string): string {
  const name = typed?.trim() ? typed.trim() : file.name;
  return cleanedName({ name, bytes: file.bytes, mimeType: file.mimeType });
}

/**
 * The names a batch goes to the vault under, by file id. A name repeated within the batch gets a
 * number, as "name (2).pdf" (compared without case, as Windows does), so that no two uploads can
 * be given the same stored path. A vault file of the same name from before is only warned about.
 */
export function batchNames(files: readonly WorkingFile[], form: Pick<VaultForm, 'names'>): Record<string, string> {
  const used = new Set<string>();
  const out: Record<string, string> = {};
  for (const file of files) {
    const base = vaultName(file, form.names[file.id]);
    let name = base;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = numberedName(base, n);
    used.add(name.toLowerCase());
    out[file.id] = name;
  }
  return out;
}

async function writeLog(entry: ActivityEntry, scope: DestinationScope, deps: DestinationDeps): Promise<boolean> {
  const params: ActivityParams = { action: entry.action, entity: entry.entity, engagementId: scope.engagementId, details: entry.details, metadata: entry.metadata };
  if (entry.entityId) params.entityId = entry.entityId;
  try {
    return (await deps.logActivity(params)) === true;
  } catch {
    return false;
  }
}

async function fingerprint(file: WorkingFile, deps: DestinationDeps): Promise<string | null> {
  try {
    return await deps.hash(file.bytes);
  } catch {
    return null;
  }
}

type Step<T> = { kind: 'ok'; value: T } | { kind: 'failed'; reason: string } | { kind: 'stale' };
const STALE = { kind: 'stale' } as const;

/** One file into the vault: fingerprint, upload, mark, log. */
async function putInVault(
  file: WorkingFile,
  name: string,
  form: VaultForm,
  scope: DestinationScope,
  deps: DestinationDeps,
): Promise<Step<{ record: VaultRecord; sha: string | null; logged: boolean }>> {
  const sha = await fingerprint(file, deps);
  if (!isLive(scope, deps.store)) return STALE;

  const meta: { name: string; file_type: string; workpaper_ref?: string } = { name, file_type: form.fileType };
  const ref = form.workpaperRef.trim();
  if (ref) meta.workpaper_ref = ref;
  let row: UploadedRow | null;
  let reason = VAULT_REFUSED;
  try {
    row = await deps.uploadFile(new File([file.bytes as BlobPart], name, { type: file.mimeType }), meta);
  } catch (error) {
    row = null;
    reason = plainMessage(error, VAULT_REFUSED);
  }
  const vaultEntry = (uploaded: UploadedRow, hash: string) =>
    buildActivityEntry({ file: { ...file, name: uploaded.name }, destination: 'vault', sha256: hash, vaultRecordId: uploaded.id });
  if (!isLive(scope, deps.store)) {
    // Finished in the engagement it was started for: recorded there, silently; not marked or shown.
    if (row && sha !== null) await writeLateLog(() => vaultEntry(row!, sha), scope, deps);
    return STALE;
  }
  if (!row) return { kind: 'failed', reason };

  const record: VaultRecord = { id: row.id, name: row.name, file_path: row.file_path, file_type: row.file_type, file_size: Number(row.file_size) };
  deps.store.markSent(file.id, 'vault', record);
  // The vault holds no hash of its files; without one the record cannot be written (counted as a log failure).
  const logged = sha !== null && (await writeLog(vaultEntry(row, sha), scope, deps));
  return { kind: 'ok', value: { record, sha, logged } };
}

function emptyResult(): BatchResult {
  return { status: 'done', succeeded: [], failed: [], addedToVault: [], droppedFromVault: [], logFailures: 0, notStarted: 0 };
}

/** Runs `each` over the files in order, with Stop, progress and the scope check before each file. */
async function inTurn(
  files: readonly WorkingFile[],
  scope: DestinationScope,
  deps: DestinationDeps,
  options: BatchOptions,
  each: (file: WorkingFile, result: BatchResult) => Promise<'stale' | void>,
): Promise<BatchResult> {
  const result = emptyResult();
  for (const [index, file] of files.entries()) {
    if (!isLive(scope, deps.store)) return { ...result, status: 'stale' };
    if (options.signal?.aborted) return { ...result, status: 'stopped', notStarted: files.length - index };
    options.onProgress?.(index, files.length, file.name);
    if ((await each(file, result)) === 'stale') return { ...result, status: 'stale' };
  }
  if (!isLive(scope, deps.store)) return { ...result, status: 'stale' };
  options.onProgress?.(files.length, files.length, '');
  return result;
}

/** Adds each file to the current engagement's Evidence Vault through its existing upload. */
export function addToVault(
  files: readonly WorkingFile[],
  form: VaultForm,
  scope: DestinationScope,
  deps: DestinationDeps,
  options: BatchOptions = {},
): Promise<BatchResult> {
  const names = batchNames(files, form);
  return inTurn(files, scope, deps, options, async (file, result) => {
    const step = await putInVault(file, names[file.id], form, scope, deps);
    if (step.kind === 'stale') return 'stale';
    if (step.kind === 'failed') {
      result.failed.push({ id: file.id, name: names[file.id], stage: 'vault', reason: step.reason });
      return;
    }
    result.succeeded.push({ id: file.id, name: step.value.record.name });
    result.addedToVault.push(file.id);
    if (!step.value.logged) result.logFailures += 1;
  });
}

/**
 * Attaches each file to a programme, section or box. A file already in the vault is attached from
 * its one record; any other is added to the vault first (with `form`), since an attachment always
 * points at a vault file. If the attachment fails, the vault record stays: it is valid evidence.
 */
export function attachToWorkingPaper(
  files: readonly WorkingFile[],
  form: VaultForm | null,
  target: AttachTarget,
  scope: DestinationScope,
  deps: DestinationDeps,
  options: BatchOptions = {},
): Promise<BatchResult> {
  const names = form ? batchNames(files.filter((f) => !f.vaultRecord), form) : {};
  return inTurn(files, scope, deps, options, async (file, result) => {
    let record = file.vaultRecord;
    let sha: string | null;
    if (record) {
      // An attachment must never point at nothing: the record is checked before it is reused.
      if (deps.vaultRecordState) {
        // Within the engagement captured at confirm; no answer within the limit is "could not be checked".
        let state: VaultRecordState;
        try {
          state = await withTimeout(deps.vaultRecordState(record, scope.engagementId), CHECK_TIMEOUT_MS, 'unknown');
        } catch {
          state = 'unknown';
        }
        if (!isLive(scope, deps.store)) return 'stale';
        if (state === 'missing') {
          if (deps.store.unmarkVault(scope.contextKey, scope.session, file.id)) result.droppedFromVault.push(file.id);
          result.failed.push({ id: file.id, name: record.name, stage: 'check', reason: NOT_IN_VAULT });
          return;
        }
        if (state === 'unknown') {
          result.failed.push({ id: file.id, name: record.name, stage: 'check', reason: VAULT_UNCHECKED });
          return;
        }
      }
      sha = await fingerprint(file, deps);
      if (!isLive(scope, deps.store)) return 'stale';
    } else {
      if (!form) {
        result.failed.push({ id: file.id, name: file.name, stage: 'vault', reason: 'It is not in the Evidence Vault yet.' });
        return;
      }
      const step = await putInVault(file, names[file.id], form, scope, deps);
      if (step.kind === 'stale') return 'stale';
      if (step.kind === 'failed') {
        result.failed.push({ id: file.id, name: names[file.id], stage: 'vault', reason: step.reason });
        return;
      }
      ({ record, sha } = step.value);
      result.addedToVault.push(file.id);
      if (!step.value.logged) result.logFailures += 1;
      // The vault step ended with its entry being written: no attachment is started after a change.
      if (!isLive(scope, deps.store)) return 'stale';
    }

    const attachEntry = (hash: string) => {
      const workingPaper: { programName: string; sectionName?: string; boxHeader?: string } = { programName: target.programName };
      if (target.sectionId && target.sectionName) workingPaper.sectionName = target.sectionName;
      if (target.boxId && target.boxHeader) workingPaper.boxHeader = target.boxHeader;
      return buildActivityEntry({ file: { ...file, name: record!.name }, destination: 'working-paper', sha256: hash, vaultRecordId: record!.id, workingPaper });
    };

    let created: unknown;
    try {
      created = await deps.createAttachment({
        audit_program_id: target.programId,
        section_id: target.sectionId ?? null,
        box_id: target.boxId ?? null,
        file_name: record.name,
        file_type: record.file_type,
        file_size: record.file_size,
        file_path: record.file_path,
        uploaded_by: scope.userId,
        description: null,
        is_evidence: true,
      });
    } catch {
      created = null;
    }
    if (!isLive(scope, deps.store)) {
      // Attached in the engagement it was started for: recorded there, silently; not marked or shown.
      if (created && sha !== null) await writeLateLog(() => attachEntry(sha!), scope, deps);
      return 'stale';
    }
    if (!created) {
      result.failed.push({ id: file.id, name: record.name, stage: 'attach', reason: ATTACH_FAILED });
      return;
    }

    deps.store.markSent(file.id, 'working-paper');
    result.succeeded.push({ id: file.id, name: record.name });
    const logged = sha !== null && (await writeLog(attachEntry(sha), scope, deps));
    if (!logged) result.logFailures += 1;
  });
}

/**
 * The activity entry of a save to the computer ('computer', through a save dialog) or a download
 * ('download', the fallback, whose completion cannot be seen). An input saved as it is was not made
 * by a tool: the entry says what it is and names it as its own source.
 */
function computerEntry(file: WorkingFile, sha: string, destination: 'computer' | 'download', zip: boolean): ActivityEntry {
  if (file.operation !== undefined || file.origin === 'result') return buildActivityEntry({ file, destination, sha256: sha, zip });
  const source: SourceRef = file.evidenceId ? { name: file.name, origin: file.origin, evidenceId: file.evidenceId } : { name: file.name, origin: file.origin };
  return buildActivityEntry({
    file,
    destination,
    sha256: sha,
    zip,
    summary: `Copy of a file from the ${file.origin === 'vault' ? 'Evidence Vault' : 'computer'}${file.wasProtected ? ', without its password' : ''}`,
    sources: [source],
  });
}

/**
 * After a save to the computer: marks the saved rows "Saved to computer" (or "Sent to download")
 * and logs one entry each. `markIds` are the files written; `hashes` are in the order of `files`
 * (null where the fingerprint failed: marked, not logged). After a change of engagement nothing is
 * marked, and the entries are still written silently for the same user (see the header).
 */
export async function recordComputerSave(
  args: { files: readonly WorkingFile[]; markIds: readonly string[]; download: boolean; zip: boolean; hashes: readonly (string | null)[] },
  scope: DestinationScope,
  deps: DestinationDeps,
): Promise<{ status: 'done' | 'stale'; logFailures: number }> {
  const live = isLive(scope, deps.store);
  if (!live && !(await sameUser(scope, deps))) return { status: 'stale', logFailures: 0 };
  const destination = args.download ? 'download' : 'computer';
  const marked = new Set(args.markIds);
  const saved = args.files.map((file, i) => ({ file, sha: args.hashes[i] ?? null })).filter(({ file }) => marked.has(file.id));
  if (live) for (const { file } of saved) deps.store.markSent(file.id, destination);
  let logFailures = 0;
  for (const { file, sha } of saved) {
    if (!isLive(scope, deps.store) && !(await sameUser(scope, deps))) return { status: 'stale', logFailures };
    if (sha === null || !(await writeLog(computerEntry(file, sha, destination, args.zip), scope, deps))) logFailures += 1;
  }
  return { status: isLive(scope, deps.store) ? 'done' : 'stale', logFailures };
}

// ---- what the user is told ----------------------------------------------------------------------

export interface SummaryToast {
  tone: 'success' | 'warning' | 'error';
  title: string;
  description?: string;
}

const files = (n: number) => `${n} ${n === 1 ? 'file' : 'files'}`;
const names = (list: { name: string }[]) => list.map((f) => f.name).join(', ');

export function targetText(target: AttachTarget): string {
  return [target.programName, target.sectionId ? target.sectionName : null, target.sectionId && target.boxId ? target.boxHeader : null].filter(Boolean).join(' › ');
}

function reasons(failed: BatchFailure[]): string {
  return failed.map((f) => `${f.name}: ${f.reason}`).join(' ');
}

export function vaultSummary(result: BatchResult): SummaryToast | null {
  if (result.status === 'stale') return null;
  const ok = result.succeeded.length;
  const bad = result.failed.length;
  if (result.status === 'stopped') {
    return { tone: 'warning', title: `Stopped: ${ok} added, ${bad + result.notStarted} not added`, description: bad > 0 ? reasons(result.failed) : undefined };
  }
  if (bad === 0) {
    return ok === 1
      ? { tone: 'success', title: 'Added to the Evidence Vault', description: result.succeeded[0].name }
      : { tone: 'success', title: `Added ${files(ok)} to the Evidence Vault`, description: names(result.succeeded) };
  }
  if (ok === 0) return { tone: 'error', title: 'Not added to the Evidence Vault', description: reasons(result.failed) };
  return { tone: 'warning', title: `${ok} added, ${bad} failed: ${names(result.failed)}`, description: reasons(result.failed) };
}

export function attachSummary(result: BatchResult, target: AttachTarget): SummaryToast | null {
  if (result.status === 'stale') return null;
  const ok = result.succeeded.length;
  const bad = result.failed.length;
  const where = targetText(target);
  const explain = (failed: BatchFailure[]) =>
    failed
      .map((f) =>
        f.stage === 'attach'
          ? `${f.name} is in the Evidence Vault; you can retry.`
          : f.stage === 'check'
            ? `${f.name}: ${f.reason}`
            : `${f.name} was not added to the Evidence Vault: ${f.reason}`,
      )
      .join(' ');
  if (result.status === 'stopped') {
    return { tone: 'warning', title: `Stopped: ${ok} attached, ${bad + result.notStarted} not attached`, description: bad > 0 ? explain(result.failed) : undefined };
  }
  if (bad === 0) {
    return ok === 1
      ? { tone: 'success', title: 'Attached to the working paper', description: `${result.succeeded[0].name} → ${where}` }
      : { tone: 'success', title: `Attached ${files(ok)} to the working paper`, description: `${names(result.succeeded)} → ${where}` };
  }
  if (ok === 0 && bad === 1 && result.failed[0].stage === 'attach') return { tone: 'error', title: ATTACH_FAILED };
  if (ok === 0) return { tone: 'error', title: 'Not attached', description: explain(result.failed) };
  return { tone: 'warning', title: `${ok} attached, ${bad} failed: ${names(result.failed)}`, description: explain(result.failed) };
}

/** The dialog closes unless nothing at all was written (then it stays open, with the form as typed). */
export function shouldCloseAfter(result: BatchResult): boolean {
  // A row whose vault record was found gone has changed: reopening shows the vault form for it.
  return result.status !== 'done' || result.succeeded.length > 0 || result.addedToVault.length > 0 || result.droppedFromVault.length > 0;
}

// ---- working-paper choices ----------------------------------------------------------------------

export interface TargetOption {
  id: string;
  /** The name as stored (for the record); `label` adds "(locked)" or "(not applicable)". */
  name: string;
  label: string;
  locked: boolean;
}

const byOrder = <T extends { order?: number | null }>(list: readonly T[]) => [...list].sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));

/** This engagement's programmes only (the hook may still hold the previous engagement's for a moment). */
export function programmesFor<T extends { engagement_id: string }>(programs: readonly T[], engagementId: string | null): T[] {
  return engagementId ? programs.filter((p) => p.engagement_id === engagementId) : [];
}

/** Sections in their order. A locked one is listed but cannot be chosen (spec 6: PDF Tools adds nothing to locked work). */
export function sectionOptions(sections: readonly { id: string; name: string; order?: number | null; locked?: unknown; is_applicable?: unknown }[]): TargetOption[] {
  return byOrder(sections).map((s) => {
    const locked = isLockedFlag(s.locked);
    const notApplicable = s.is_applicable === 0 || s.is_applicable === false || s.is_applicable === '0';
    return { id: s.id, name: s.name, label: `${s.name}${locked ? ' (locked)' : notApplicable ? ' (not applicable)' : ''}`, locked };
  });
}

export function boxOptions(boxes: readonly { id: string; header: string; order?: number | null; locked?: unknown }[]): TargetOption[] {
  return byOrder(boxes).map((b) => {
    const locked = isLockedFlag(b.locked);
    return { id: b.id, name: b.header, label: `${b.header}${locked ? ' (locked)' : ''}`, locked };
  });
}

/** Whether this engagement's vault already holds a file of this name (compared without case, as Windows does). */
export function sameNameInVault(rows: readonly { name: string; engagement_id: string | null }[], engagementId: string | null, name: string): boolean {
  if (!engagementId) return false;
  const wanted = name.trim().toLowerCase();
  return rows.some((r) => r.engagement_id === engagementId && r.name.trim().toLowerCase() === wanted);
}
