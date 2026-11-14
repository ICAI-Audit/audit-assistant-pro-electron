import { describe, expect, it, vi } from 'vitest';
import { sha256Hex } from '@/lib/pdf-tools/hash';
import { createWorkingListStore } from '@/lib/pdf-tools/workingList';
import type { VaultRecord, WorkingFile } from '@/lib/pdf-tools/types';
import {
  addToVault,
  attachSummary,
  attachToWorkingPaper,
  ATTACH_FAILED,
  batchNames,
  CHECK_TIMEOUT_MS,
  dropMissingVaultRecords,
  isUnsavedResult,
  NOT_IN_VAULT,
  SENT_TONES,
  withTimeout,
  VAULT_UNCHECKED,
  vaultRecordState,
  type VaultRecordState,
  boxOptions,
  LOG_FAILED,
  programmesFor,
  recordComputerSave,
  resultsOf,
  sameNameInVault,
  sectionOptions,
  shouldCloseAfter,
  targetText,
  vaultName,
  vaultSummary,
  type ActivityParams,
  type AttachmentInput,
  type AttachTarget,
  type BatchResult,
  type DestinationDeps,
  type DestinationScope,
  type UploadedRow,
  type VaultForm,
} from './destinations';

const PDF = (text: string) => new TextEncoder().encode(`%PDF-1.7\n${text}\n%%EOF`);

function result(id: string, name: string, over: Partial<WorkingFile> = {}): WorkingFile {
  const bytes = over.bytes ?? PDF(`content of ${id}`);
  return {
    id,
    name,
    kind: 'pdf',
    mimeType: 'application/pdf',
    origin: 'result',
    bytes,
    size: bytes.byteLength,
    pageCount: 3,
    wasProtected: false,
    hasRestrictions: false,
    hasSignature: false,
    sentTo: [],
    operation: { tool: 'merge', summary: 'Merged 2 files', sources: [{ name: 'A.pdf', origin: 'computer' }, { name: 'B.pdf', origin: 'vault', evidenceId: 'ev-src' }], options: {} },
    ...over,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

interface Uploaded {
  name: string;
  type: string;
  bytes: number[];
  meta: { name: string; file_type: string; workpaper_ref?: string };
  engagementId: string;
}

/** A store in engagement E1 holding the given results, and fakes that record what they were given. */
function setup(files: WorkingFile[], engagement = 'E1') {
  const store = createWorkingListStore();
  store.setContext(`u1:${engagement}`);
  store.addResults(`u1:${engagement}`, files, store.getState().session);
  const scope: DestinationScope = { contextKey: `u1:${engagement}`, session: store.getState().session, engagementId: engagement, userId: 'u1' };
  const uploads: Uploaded[] = [];
  const attachments: AttachmentInput[] = [];
  const logs: ActivityParams[] = [];
  let seq = 0;
  // The engagement an upload is written to is fixed when the dialog was confirmed, as useEvidenceFiles' closure is.
  const uploadFor = (engagementId: string): DestinationDeps['uploadFile'] =>
    vi.fn(async (file: File, meta) => {
      uploads.push({ name: file.name, type: file.type, bytes: Array.from(new Uint8Array(await file.arrayBuffer())), meta, engagementId });
      seq += 1;
      return { id: `ev-${seq}`, name: meta.name, file_path: `${engagementId}/u1/170000000000${seq}-${file.name}`, file_type: meta.file_type, file_size: file.size } satisfies UploadedRow;
    });
  const deps: DestinationDeps = {
    store,
    hash: sha256Hex,
    uploadFile: uploadFor(engagement),
    createAttachment: vi.fn(async (input: AttachmentInput) => {
      attachments.push(input);
      return { id: `att-${attachments.length}`, ...input };
    }),
    logActivity: vi.fn(async (params: ActivityParams) => {
      logs.push(params);
      return true;
    }),
  };
  const current = (id: string) => store.getState().files.find((f) => f.id === id)!;
  return { store, scope, deps, uploads, attachments, logs, current, uploadFor };
}

const FORM: VaultForm = { names: {}, fileType: 'document', workpaperRef: '' };

describe('vaultName', () => {
  it('cleans the typed name and keeps the right extension, else uses the file name', () => {
    const file = result('r1', 'A_merged.pdf');
    expect(vaultName(file, 'Bank: final?')).toBe('Bank_ final_.pdf');
    expect(vaultName(file, '   ')).toBe('A_merged.pdf');
    expect(vaultName(file)).toBe('A_merged.pdf');
    expect(vaultName(file, 'Report.PDF')).toBe('Report.pdf');
    const png = result('r2', 'Beta_page_001.png', { kind: 'image', mimeType: 'image/png', pageCount: null });
    expect(vaultName(png, 'Scan')).toBe('Scan.png');
    expect(vaultName(png, 'Scan.gif')).toBe('Scan.png');
    expect(vaultName(file, 'x'.repeat(300)).length).toBeLessThanOrEqual(120);
  });
});

describe('resultsOf', () => {
  it('keeps only results, in list order', () => {
    const files = [result('a', 'a.pdf', { origin: 'computer' }), result('b', 'b.pdf'), result('c', 'c.pdf', { origin: 'vault', evidenceId: 'e' }), result('d', 'd.pdf')];
    expect(resultsOf(files).map((f) => f.id)).toEqual(['b', 'd']);
  });
});

describe('addToVault', () => {
  it('uploads each result with its cleaned name, type and reference, marks it and logs it for the engagement', async () => {
    const files = [result('r1', 'A_merged.pdf'), result('r2', 'Beta_page_001.png', { kind: 'image', mimeType: 'image/png', pageCount: null, bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2]) })];
    const { scope, deps, uploads, logs, current } = setup(files);
    const progress: [number, number, string][] = [];
    const outcome = await addToVault(files, { names: { r1: 'Bank: final?' }, fileType: 'confirmation', workpaperRef: ' A.1.1 ' }, scope, deps, {
      onProgress: (done, total, name) => progress.push([done, total, name]),
    });

    expect(outcome).toMatchObject({ status: 'done', logFailures: 0, notStarted: 0, failed: [] });
    expect(outcome.succeeded.map((s) => s.name)).toEqual(['Bank_ final_.pdf', 'Beta_page_001.png']);
    expect(outcome.addedToVault).toEqual(['r1', 'r2']);
    expect(uploads.map((u) => [u.name, u.type, u.meta, u.engagementId])).toEqual([
      ['Bank_ final_.pdf', 'application/pdf', { name: 'Bank_ final_.pdf', file_type: 'confirmation', workpaper_ref: 'A.1.1' }, 'E1'],
      ['Beta_page_001.png', 'image/png', { name: 'Beta_page_001.png', file_type: 'confirmation', workpaper_ref: 'A.1.1' }, 'E1'],
    ]);
    expect(uploads[0].bytes).toEqual(Array.from(files[0].bytes));
    expect(uploads[1].bytes).toEqual([0x89, 0x50, 0x4e, 0x47, 1, 2]);

    const record: VaultRecord = { id: 'ev-1', name: 'Bank_ final_.pdf', file_path: 'E1/u1/1700000000001-Bank_ final_.pdf', file_type: 'confirmation', file_size: files[0].size };
    expect(current('r1').sentTo).toEqual(['vault']);
    expect(current('r1').vaultRecord).toEqual(record);
    expect(current('r2').vaultRecord?.id).toBe('ev-2');

    const sha = await sha256Hex(files[0].bytes);
    expect(logs).toHaveLength(2);
    expect(logs[0]).toMatchObject({ action: 'Added to Evidence Vault', entity: 'PDF Tools', entityId: 'ev-1', engagementId: 'E1' });
    expect(logs[0].details).toBe(
      `Merged 2 files → Bank_ final_.pdf (3 pages, SHA-256 ${sha.slice(0, 12)}…). Sources: A.pdf [computer]; B.pdf [vault]. Destination: Evidence Vault.`,
    );
    expect(logs[0].metadata).toMatchObject({ sha256: sha, vaultRecordId: 'ev-1', destination: 'vault', resultName: 'Bank_ final_.pdf' });
    expect(progress.map((p) => p.slice(0, 2))).toEqual([
      [0, 2],
      [1, 2],
      [2, 2],
    ]);
  });

  it('gives repeated names within one batch a number, ignoring case', async () => {
    const files = [result('r1', 'A.pdf'), result('r2', 'a.PDF'), result('r3', 'Other.pdf')];
    const { scope, deps, uploads } = setup(files);
    expect(batchNames(files, { ...FORM, names: { r3: 'A' } })).toEqual({ r1: 'A.pdf', r2: 'a (2).pdf', r3: 'A (3).pdf' });
    await addToVault(files, { ...FORM, names: { r3: 'A' } }, scope, deps);
    expect(uploads.map((u) => u.name)).toEqual(['A.pdf', 'a (2).pdf', 'A (3).pdf']);
  });

  it('leaves out an empty reference', async () => {
    const files = [result('r1', 'A.pdf')];
    const { scope, deps, uploads } = setup(files);
    await addToVault(files, { ...FORM, workpaperRef: '   ' }, scope, deps);
    expect(uploads[0].meta).toEqual({ name: 'A.pdf', file_type: 'document' });
  });

  it('leaves a row "Not saved" when the vault refuses it (null), and goes on with the others', async () => {
    const files = [result('r1', 'One.pdf'), result('r2', 'Two.pdf'), result('r3', 'Three.pdf')];
    const { scope, deps, logs, current } = setup(files);
    const real = deps.uploadFile;
    deps.uploadFile = vi.fn(async (file, meta) => (meta.name === 'Two.pdf' ? null : real(file, meta)));
    const outcome = await addToVault(files, FORM, scope, deps);
    expect(outcome.status).toBe('done');
    expect(outcome.succeeded.map((s) => s.name)).toEqual(['One.pdf', 'Three.pdf']);
    expect(outcome.failed).toEqual([{ id: 'r2', name: 'Two.pdf', stage: 'vault', reason: expect.any(String) }]);
    expect(current('r2').sentTo).toEqual([]);
    expect(current('r2').vaultRecord).toBeUndefined();
    expect(current('r3').sentTo).toEqual(['vault']);
    expect(logs.map((l) => l.entityId)).toEqual(['ev-1', 'ev-2']);
  });

  it('treats a throwing upload like a refusal', async () => {
    const files = [result('r1', 'One.pdf'), result('r2', 'Two.pdf')];
    const { scope, deps, current } = setup(files);
    const real = deps.uploadFile;
    deps.uploadFile = vi.fn(async (file, meta) => {
      if (meta.name === 'One.pdf') throw new Error('disk full');
      return real(file, meta);
    });
    const outcome = await addToVault(files, FORM, scope, deps);
    expect(outcome.failed.map((f) => f.name)).toEqual(['One.pdf']);
    expect(current('r1').sentTo).toEqual([]);
    expect(current('r2').sentTo).toEqual(['vault']);
  });

  it('keeps the vault mark when the activity record cannot be written (false or a throw)', async () => {
    const files = [result('r1', 'One.pdf'), result('r2', 'Two.pdf')];
    const { scope, deps, current } = setup(files);
    let call = 0;
    deps.logActivity = vi.fn(async () => {
      call += 1;
      if (call === 1) return false;
      throw new Error('database locked');
    });
    const outcome = await addToVault(files, FORM, scope, deps);
    expect(outcome.logFailures).toBe(2);
    expect(outcome.succeeded).toHaveLength(2);
    expect(current('r1').sentTo).toEqual(['vault']);
    expect(current('r2').sentTo).toEqual(['vault']);
  });

  /** Starts a two-file vault batch whose first upload waits; `next` is where the store goes meanwhile. */
  async function switchDuringUpload(next: string | null) {
    const files = [result('r1', 'One.pdf'), result('r2', 'Two.pdf')];
    const t = setup(files);
    const gate = deferred<void>();
    const real = t.deps.uploadFile;
    t.deps.uploadFile = vi.fn(async (file, meta) => {
      const row = await real(file, meta);
      await gate.promise;
      return row;
    });
    const marks = vi.spyOn(t.store, 'markSent');
    const running = addToVault(files, FORM, t.scope, t.deps);
    await vi.waitFor(() => expect(t.uploads).toHaveLength(1));
    t.store.setContext(next);
    gate.resolve();
    return { ...t, files, marks, outcome: await running };
  }

  it('after a change of engagement during an upload: the finished file gets its entry in its own engagement, silently; nothing is marked; no more is sent', async () => {
    const { outcome, files, uploads, deps, marks, logs, store } = await switchDuringUpload('u1:E2');
    expect(outcome.status).toBe('stale');
    expect(uploads.map((u) => u.engagementId)).toEqual(['E1']); // written to the engagement it was started for
    expect(deps.uploadFile).toHaveBeenCalledTimes(1);
    expect(marks).not.toHaveBeenCalled();
    expect(store.getState().files).toEqual([]);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ action: 'Added to Evidence Vault', engagementId: 'E1', entityId: 'ev-1' });
    expect(logs[0].metadata.sha256).toBe(await sha256Hex(files[0].bytes));
    expect(outcome.logFailures).toBe(0); // not counted: nothing is shown after a change
  });

  it('also writes the late entry after sign-out and sign-in again as the same user (a new session)', async () => {
    const files = [result('r1', 'One.pdf')];
    const { store, scope, deps, logs } = setup(files);
    const gate = deferred<void>();
    const real = deps.uploadFile;
    deps.uploadFile = vi.fn(async (file, meta) => {
      await gate.promise;
      return real(file, meta);
    });
    const running = addToVault(files, FORM, scope, deps);
    await vi.waitFor(() => expect(deps.uploadFile).toHaveBeenCalled());
    store.setContext(null);
    store.setContext('u1:E1');
    gate.resolve();
    expect((await running).status).toBe('stale');
    expect(logs.map((l) => [l.action, l.engagementId])).toEqual([['Added to Evidence Vault', 'E1']]);
  });

  it('writes no late entry after sign-out, nor when another user is signed in', async () => {
    expect((await switchDuringUpload(null)).logs).toEqual([]);
    expect((await switchDuringUpload('u2:E1')).logs).toEqual([]);
  });

  it('asks the main process who is signed in when the store cannot tell (its key emptied by the engagement watch)', async () => {
    // The watch empties the store's key on a change of engagement, as sign-out does: only the main
    // process's signed-in user tells the two apart.
    for (const [signedIn, expected] of [
      ['u1', 1],
      [null, 0],
      ['u2', 0],
    ] as const) {
      const files = [result('r1', 'One.pdf'), result('r2', 'Two.pdf')];
      const t = setup(files);
      t.deps.signedInUserId = vi.fn(async () => signedIn);
      const gate = deferred<void>();
      const real = t.deps.uploadFile;
      t.deps.uploadFile = vi.fn(async (file, meta) => {
        const row = await real(file, meta);
        await gate.promise;
        return row;
      });
      const running = addToVault(files, FORM, t.scope, t.deps);
      await vi.waitFor(() => expect(t.uploads).toHaveLength(1));
      t.store.setContext(null);
      gate.resolve();
      expect((await running).status).toBe('stale');
      expect(t.logs).toHaveLength(expected);
      if (expected) expect(t.logs[0]).toMatchObject({ engagementId: 'E1', entityId: 'ev-1' });
      expect(t.deps.uploadFile).toHaveBeenCalledTimes(1);
    }
  });

  it('does not ask the main process when the store already shows another user, nor write if asking fails', async () => {
    const shownOther = await switchDuringUpload('u2:E1');
    expect(shownOther.logs).toEqual([]);
    const files = [result('r1', 'One.pdf')];
    const t = setup(files);
    const ask = vi.fn(async (): Promise<string | null> => 'u1');
    t.deps.signedInUserId = ask;
    t.deps.uploadFile = vi.fn(async () => {
      t.store.setContext('u2:E1');
      return { id: 'ev-1', name: 'One.pdf', file_path: 'E1/u1/1-One.pdf', file_type: 'document', file_size: 1 };
    });
    await addToVault(files, FORM, t.scope, t.deps);
    expect(ask).not.toHaveBeenCalled();
    expect(t.logs).toEqual([]);
    const t2 = setup(files);
    t2.deps.signedInUserId = vi.fn(async () => {
      throw new Error('IPC closed');
    });
    t2.deps.uploadFile = vi.fn(async () => {
      t2.store.setContext(null);
      return { id: 'ev-1', name: 'One.pdf', file_path: 'E1/u1/1-One.pdf', file_type: 'document', file_size: 1 };
    });
    await addToVault(files, FORM, t2.scope, t2.deps);
    expect(t2.logs).toEqual([]);
  });

  it('sends nothing more, and does not even fingerprint the next file, after a change during an entry being written', async () => {
    const files = [result('r1', 'One.pdf'), result('r2', 'Two.pdf')];
    const { store, scope, deps, logs } = setup(files);
    deps.hash = vi.fn(sha256Hex);
    deps.logActivity = vi.fn(async (params: ActivityParams) => {
      logs.push(params);
      store.setContext('u1:E2'); // the user switches while file 1's entry is being written
      return true;
    });
    const progress: string[] = [];
    const outcome = await addToVault(files, FORM, scope, deps, { onProgress: (_d, _t, name) => progress.push(name) });
    expect(outcome.status).toBe('stale');
    expect(deps.hash).toHaveBeenCalledTimes(1);
    expect(deps.uploadFile).toHaveBeenCalledTimes(1);
    expect(progress).toEqual(['One.pdf']);
    expect(logs).toHaveLength(1);
  });

  it('uploads nothing when the engagement changed while the file was being fingerprinted', async () => {
    const files = [result('r1', 'One.pdf')];
    const { store, scope, deps } = setup(files);
    const gate = deferred<string>();
    deps.hash = vi.fn(() => gate.promise);
    const running = addToVault(files, FORM, scope, deps);
    store.setContext('u1:E2');
    gate.resolve('ab'.repeat(32));
    expect((await running).status).toBe('stale');
    expect(deps.uploadFile).not.toHaveBeenCalled();
  });

  it('does nothing for a scope that is not the current one', async () => {
    const files = [result('r1', 'One.pdf')];
    const { scope, deps } = setup(files);
    expect((await addToVault(files, FORM, { ...scope, session: scope.session + 1 }, deps)).status).toBe('stale');
    expect((await addToVault(files, FORM, { ...scope, contextKey: 'u1:E9' }, deps)).status).toBe('stale');
    expect(deps.uploadFile).not.toHaveBeenCalled();
  });

  it('stops before the next file when asked, and counts what was not started', async () => {
    const files = [result('r1', 'One.pdf'), result('r2', 'Two.pdf'), result('r3', 'Three.pdf')];
    const { scope, deps, current } = setup(files);
    const controller = new AbortController();
    const real = deps.uploadFile;
    deps.uploadFile = vi.fn(async (file, meta) => {
      controller.abort(); // the user pressed Stop while the first file was being sent
      return real(file, meta);
    });
    const outcome = await addToVault(files, FORM, scope, deps, { signal: controller.signal });
    expect(outcome).toMatchObject({ status: 'stopped', notStarted: 2 });
    expect(outcome.succeeded.map((s) => s.name)).toEqual(['One.pdf']);
    expect(current('r1').sentTo).toEqual(['vault']);
    expect(current('r2').sentTo).toEqual([]);
  });

  it('never puts file contents into the activity record', async () => {
    const files = [result('r1', 'One.pdf', { bytes: PDF('SECRET-CLIENT-CONTENT') })];
    const { scope, deps, logs } = setup(files);
    await addToVault(files, FORM, scope, deps);
    expect(JSON.stringify(logs)).not.toContain('SECRET-CLIENT-CONTENT');
  });
});

const TARGET: AttachTarget = { programId: 'p1', programName: 'Synthetic Sales programme', sectionId: 's1', sectionName: 'Trade Receivables', boxId: 'b1', boxHeader: 'Procedure' };

describe('attachToWorkingPaper', () => {
  it('attaches a result already in the vault from its one record, with no second upload', async () => {
    const record: VaultRecord = { id: 'ev-9', name: 'A_merged.pdf', file_path: 'E1/u1/1700-A_merged.pdf', file_type: 'analysis', file_size: 41 };
    const files = [result('r1', 'A_merged.pdf', { sentTo: ['vault'], vaultRecord: record })];
    const { scope, deps, attachments, logs, current } = setup(files);
    const outcome = await attachToWorkingPaper(files, null, TARGET, scope, deps);
    expect(outcome).toMatchObject({ status: 'done', addedToVault: [], logFailures: 0 });
    expect(deps.uploadFile).not.toHaveBeenCalled();
    expect(attachments).toEqual([
      {
        audit_program_id: 'p1',
        section_id: 's1',
        box_id: 'b1',
        file_name: 'A_merged.pdf',
        file_type: 'analysis',
        file_size: 41,
        file_path: 'E1/u1/1700-A_merged.pdf',
        uploaded_by: 'u1',
        description: null,
        is_evidence: true,
      },
    ]);
    expect(current('r1').sentTo).toEqual(['vault', 'working-paper']);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ action: 'Attached to working paper', entity: 'PDF Tools', entityId: 'ev-9', engagementId: 'E1' });
    expect(logs[0].details.endsWith('Destination: Working paper Synthetic Sales programme, section Trade Receivables, box Procedure.')).toBe(true);
    expect(logs[0].metadata).toMatchObject({ vaultRecordId: 'ev-9', workingPaper: { programName: 'Synthetic Sales programme', sectionName: 'Trade Receivables', boxHeader: 'Procedure' } });
  });

  it('attaches to the whole programme or section when none is chosen', async () => {
    const record: VaultRecord = { id: 'ev-9', name: 'A.pdf', file_path: 'E1/u1/1-A.pdf', file_type: 'document', file_size: 1 };
    const files = [result('r1', 'A.pdf', { sentTo: ['vault'], vaultRecord: record })];
    const { scope, deps, attachments, logs } = setup(files);
    await attachToWorkingPaper(files, null, { programId: 'p1', programName: 'P' }, scope, deps);
    expect(attachments[0]).toMatchObject({ section_id: null, box_id: null });
    expect(logs[0].details.endsWith('Destination: Working paper P.')).toBe(true);
  });

  it('adds a result that is not in the vault to the vault first, then attaches that record', async () => {
    const files = [result('r1', 'A_merged.pdf')];
    const { scope, deps, uploads, attachments, logs, current } = setup(files);
    const outcome = await attachToWorkingPaper(files, { names: { r1: 'Receivables support' }, fileType: 'analysis', workpaperRef: 'B.2' }, TARGET, scope, deps);
    expect(outcome).toMatchObject({ status: 'done', addedToVault: ['r1'] });
    expect(uploads).toHaveLength(1);
    expect(uploads[0].meta).toEqual({ name: 'Receivables support.pdf', file_type: 'analysis', workpaper_ref: 'B.2' });
    expect(attachments[0]).toMatchObject({ file_name: 'Receivables support.pdf', file_path: 'E1/u1/1700000000001-Receivables support.pdf', file_type: 'analysis' });
    expect(current('r1').sentTo).toEqual(['vault', 'working-paper']);
    expect(logs.map((l) => [l.action, l.entityId, l.engagementId])).toEqual([
      ['Added to Evidence Vault', 'ev-1', 'E1'],
      ['Attached to working paper', 'ev-1', 'E1'],
    ]);
  });

  it('"Add to vault" then "Attach" makes exactly one vault record', async () => {
    const files = [result('r1', 'A_merged.pdf')];
    const { scope, deps, uploads, attachments, current } = setup(files);
    await addToVault(files, FORM, scope, deps);
    // The screen passes the row as it is now: it carries the record the first step made.
    await attachToWorkingPaper([current('r1')], FORM, TARGET, scope, deps);
    await attachToWorkingPaper([current('r1')], FORM, { ...TARGET, boxId: 'b2', boxHeader: 'Conclusion' }, scope, deps);
    expect(uploads).toHaveLength(1);
    expect(attachments.map((a) => a.file_path)).toEqual([current('r1').vaultRecord!.file_path, current('r1').vaultRecord!.file_path]);
  });

  it('keeps the vault mark and says the attachment failed when the attachment is refused', async () => {
    const files = [result('r1', 'A.pdf')];
    const { scope, deps, logs, current } = setup(files);
    deps.createAttachment = vi.fn(async () => null);
    const outcome = await attachToWorkingPaper(files, FORM, TARGET, scope, deps);
    expect(outcome.failed).toEqual([{ id: 'r1', name: 'A.pdf', stage: 'attach', reason: ATTACH_FAILED }]);
    expect(outcome.addedToVault).toEqual(['r1']);
    expect(current('r1').sentTo).toEqual(['vault']);
    expect(current('r1').vaultRecord?.id).toBe('ev-1');
    expect(logs.map((l) => l.action)).toEqual(['Added to Evidence Vault']);
    expect(attachSummary(outcome, TARGET)).toEqual({ tone: 'error', title: ATTACH_FAILED });
    expect(shouldCloseAfter(outcome)).toBe(true);
  });

  it('treats a throwing attachment like a refusal and goes on with the others', async () => {
    const record = (id: string): VaultRecord => ({ id, name: `${id}.pdf`, file_path: `E1/u1/1-${id}.pdf`, file_type: 'document', file_size: 1 });
    const files = [result('r1', 'r1.pdf', { vaultRecord: record('ev-a'), sentTo: ['vault'] }), result('r2', 'r2.pdf', { vaultRecord: record('ev-b'), sentTo: ['vault'] })];
    const { scope, deps, current } = setup(files);
    deps.createAttachment = vi.fn(async (input: AttachmentInput) => {
      if (input.file_name === 'ev-a.pdf') throw new Error('FOREIGN KEY constraint failed');
      return { id: 'att' };
    });
    const outcome = await attachToWorkingPaper(files, null, TARGET, scope, deps);
    expect(outcome.failed.map((f) => [f.id, f.stage])).toEqual([['r1', 'attach']]);
    expect(outcome.succeeded.map((s) => s.id)).toEqual(['r2']);
    expect(current('r2').sentTo).toEqual(['vault', 'working-paper']);
  });

  it('does not attach a file the vault refused', async () => {
    const files = [result('r1', 'A.pdf')];
    const { scope, deps, current } = setup(files);
    deps.uploadFile = vi.fn(async () => null);
    const outcome = await attachToWorkingPaper(files, FORM, TARGET, scope, deps);
    expect(outcome.failed).toEqual([{ id: 'r1', name: 'A.pdf', stage: 'vault', reason: expect.any(String) }]);
    expect(deps.createAttachment).not.toHaveBeenCalled();
    expect(current('r1').sentTo).toEqual([]);
    expect(shouldCloseAfter(outcome)).toBe(false);
  });

  it('after a change of engagement while attaching: the finished attachment gets its entry silently; nothing marked; no more attached', async () => {
    const record: VaultRecord = { id: 'ev-9', name: 'A.pdf', file_path: 'E1/u1/1-A.pdf', file_type: 'document', file_size: 1 };
    const files = [result('r1', 'A.pdf', { vaultRecord: record, sentTo: ['vault'] }), result('r2', 'B.pdf', { vaultRecord: record, sentTo: ['vault'] })];
    const { store, scope, deps, logs } = setup(files);
    const gate = deferred<unknown>();
    deps.createAttachment = vi.fn(() => gate.promise);
    const marks = vi.spyOn(store, 'markSent');
    const running = attachToWorkingPaper(files, null, TARGET, scope, deps);
    await vi.waitFor(() => expect(deps.createAttachment).toHaveBeenCalled());
    store.setContext('u1:E2');
    gate.resolve({ id: 'att' });
    expect((await running).status).toBe('stale');
    expect(deps.createAttachment).toHaveBeenCalledTimes(1);
    expect(marks).not.toHaveBeenCalled();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ action: 'Attached to working paper', engagementId: 'E1', entityId: 'ev-9' });
    expect(logs[0].metadata.sha256).toBe(await sha256Hex(files[0].bytes));
  });

  it('writes no late attach entry when another user is signed in, and none when the attachment failed', async () => {
    const record: VaultRecord = { id: 'ev-9', name: 'A.pdf', file_path: 'E1/u1/1-A.pdf', file_type: 'document', file_size: 1 };
    for (const [next, answer] of [
      ['u2:E1', { id: 'att' }],
      ['u1:E2', null],
    ] as const) {
      const files = [result('r1', 'A.pdf', { vaultRecord: record, sentTo: ['vault'] })];
      const { store, scope, deps, logs } = setup(files);
      const gate = deferred<unknown>();
      deps.createAttachment = vi.fn(() => gate.promise);
      const running = attachToWorkingPaper(files, null, TARGET, scope, deps);
      await vi.waitFor(() => expect(deps.createAttachment).toHaveBeenCalled());
      store.setContext(next);
      gate.resolve(answer);
      expect((await running).status).toBe('stale');
      expect(logs).toEqual([]);
    }
  });

  it('sends no attachment after a change during the vault step’s entry, and no next file after a change during an attach entry', async () => {
    // A change while the vault entry is being written: the vault step is done, the attachment is not sent.
    {
      const files = [result('r1', 'A.pdf')];
      const { store, scope, deps } = setup(files);
      deps.logActivity = vi.fn(async () => {
        store.setContext('u1:E2');
        return true;
      });
      expect((await attachToWorkingPaper(files, FORM, TARGET, scope, deps)).status).toBe('stale');
      expect(deps.uploadFile).toHaveBeenCalledTimes(1);
      expect(deps.createAttachment).not.toHaveBeenCalled();
    }
    // A change while file 1's attach entry is being written: file 2 is not even fingerprinted.
    {
      const record: VaultRecord = { id: 'ev-9', name: 'A.pdf', file_path: 'E1/u1/1-A.pdf', file_type: 'document', file_size: 1 };
      const files = [result('r1', 'A.pdf', { vaultRecord: record, sentTo: ['vault'] }), result('r2', 'B.pdf', { vaultRecord: record, sentTo: ['vault'] })];
      const { store, scope, deps } = setup(files);
      deps.hash = vi.fn(sha256Hex);
      deps.logActivity = vi.fn(async () => {
        store.setContext('u1:E2');
        return true;
      });
      expect((await attachToWorkingPaper(files, null, TARGET, scope, deps)).status).toBe('stale');
      expect(deps.createAttachment).toHaveBeenCalledTimes(1);
      expect(deps.hash).toHaveBeenCalledTimes(1);
    }
  });

  it('never attaches after a change of engagement during the vault step', async () => {
    const files = [result('r1', 'A.pdf')];
    const { store, scope, deps, uploads } = setup(files);
    const gate = deferred<void>();
    const real = deps.uploadFile;
    deps.uploadFile = vi.fn(async (file, meta) => {
      const row = await real(file, meta);
      await gate.promise;
      return row;
    });
    const running = attachToWorkingPaper(files, FORM, TARGET, scope, deps);
    await vi.waitFor(() => expect(uploads).toHaveLength(1));
    store.setContext('u1:E2');
    gate.resolve();
    expect((await running).status).toBe('stale');
    expect(deps.createAttachment).not.toHaveBeenCalled();
  });
});

describe('vault records that may have been deleted', () => {
  const record: VaultRecord = { id: 'ev-9', name: 'A.pdf', file_path: 'E1/u1/1-A.pdf', file_type: 'document', file_size: 1 };

  it('trusts the loaded vault list, and asks by id only when the list does not show the record or has not loaded', async () => {
    const lookup = vi.fn(async (): Promise<VaultRecordState> => 'missing');
    expect(await vaultRecordState(record, { loaded: true, ids: new Set(['ev-9']) }, lookup)).toBe('present');
    expect(lookup).not.toHaveBeenCalled();
    expect(await vaultRecordState(record, { loaded: true, ids: new Set() }, lookup)).toBe('missing');
    expect(lookup).toHaveBeenCalledWith('ev-9');
    // a list that failed its first load is empty: the lookup decides, so nothing is uploaded twice
    expect(await vaultRecordState(record, { loaded: true, ids: new Set() }, async () => 'present')).toBe('present');
    expect(await vaultRecordState(record, { loaded: false, ids: new Set(['ev-9']) }, async () => 'present')).toBe('present');
    expect(
      await vaultRecordState(record, { loaded: true, ids: new Set() }, async () => {
        throw new Error('database locked');
      }),
    ).toBe('unknown');
  });

  it('when the dialog opens: drops the vault mark of rows whose record is gone, keeps the rest', async () => {
    const files = [
      result('r1', 'A.pdf', { vaultRecord: record, sentTo: ['vault', 'working-paper'] }),
      result('r2', 'B.pdf', { vaultRecord: { ...record, id: 'ev-2' }, sentTo: ['vault'] }),
      result('r3', 'C.pdf', { vaultRecord: { ...record, id: 'ev-3' }, sentTo: ['vault'] }),
      result('r4', 'D.pdf'),
    ];
    const { scope, store, current } = setup(files);
    const answers: Record<string, VaultRecordState> = { 'ev-9': 'missing', 'ev-2': 'present', 'ev-3': 'unknown' };
    const check = vi.fn(async (r: VaultRecord) => answers[r.id]);
    expect(await dropMissingVaultRecords(files, check, scope, store)).toEqual({ status: 'done', dropped: ['r1'] });
    expect(check).toHaveBeenCalledTimes(3);
    expect(current('r1').sentTo).toEqual(['working-paper']);
    expect(current('r1').vaultRecord).toBeUndefined();
    expect(current('r2').vaultRecord?.id).toBe('ev-2');
    expect(current('r3').vaultRecord?.id).toBe('ev-3');
  });

  it('drops nothing when the engagement changed while checking', async () => {
    const files = [result('r1', 'A.pdf', { vaultRecord: record, sentTo: ['vault'] })];
    const { scope, store } = setup(files);
    const gate = deferred<VaultRecordState>();
    const unmark = vi.spyOn(store, 'unmarkVault');
    const running = dropMissingVaultRecords(files, () => gate.promise, scope, store);
    store.setContext('u1:E2');
    gate.resolve('missing');
    expect(await running).toEqual({ status: 'stale', dropped: [] });
    expect(unmark).not.toHaveBeenCalled();
  });

  it('at confirm: a record that is gone is never attached; its mark is dropped and the user is told to attach again', async () => {
    const files = [result('r1', 'A.pdf', { vaultRecord: record, sentTo: ['vault'] }), result('r2', 'B.pdf', { vaultRecord: { ...record, id: 'ev-2', file_path: 'E1/u1/2-B.pdf' }, sentTo: ['vault'] })];
    const { scope, deps, attachments, logs, current } = setup(files);
    deps.vaultRecordState = vi.fn(async (r: VaultRecord) => (r.id === 'ev-9' ? 'missing' : 'present'));
    const outcome = await attachToWorkingPaper(files, null, TARGET, scope, deps);
    expect(attachments.map((a) => a.file_path)).toEqual(['E1/u1/2-B.pdf']);
    expect(deps.uploadFile).not.toHaveBeenCalled();
    expect(outcome.failed).toEqual([{ id: 'r1', name: 'A.pdf', stage: 'check', reason: NOT_IN_VAULT }]);
    expect(outcome.droppedFromVault).toEqual(['r1']);
    expect(shouldCloseAfter({ ...outcome, succeeded: [] })).toBe(true); // reopening shows the vault form
    expect(current('r1').sentTo).toEqual([]);
    expect(current('r1').vaultRecord).toBeUndefined();
    expect(logs.map((l) => l.entityId)).toEqual(['ev-2']);
    expect(attachSummary(outcome, TARGET)?.description).toContain(`A.pdf: ${NOT_IN_VAULT}`);
  });

  it('at confirm: a record that cannot be checked is not attached, and keeps its mark', async () => {
    const files = [result('r1', 'A.pdf', { vaultRecord: record, sentTo: ['vault'] })];
    const { scope, deps, current } = setup(files);
    deps.vaultRecordState = vi.fn(async () => 'unknown' as const);
    const outcome = await attachToWorkingPaper(files, null, TARGET, scope, deps);
    expect(deps.createAttachment).not.toHaveBeenCalled();
    expect(outcome.failed).toEqual([{ id: 'r1', name: 'A.pdf', stage: 'check', reason: VAULT_UNCHECKED }]);
    expect(current('r1').vaultRecord?.id).toBe('ev-9');
    expect(shouldCloseAfter(outcome)).toBe(false);
  });

  it('at confirm: nothing is dropped or attached when the engagement changed during the check', async () => {
    const files = [result('r1', 'A.pdf', { vaultRecord: record, sentTo: ['vault'] })];
    const { store, scope, deps } = setup(files);
    const gate = deferred<VaultRecordState>();
    deps.vaultRecordState = vi.fn(() => gate.promise);
    const unmark = vi.spyOn(store, 'unmarkVault');
    const running = attachToWorkingPaper(files, null, TARGET, scope, deps);
    await vi.waitFor(() => expect(deps.vaultRecordState).toHaveBeenCalled());
    store.setContext('u1:E2');
    gate.resolve('missing');
    expect((await running).status).toBe('stale');
    expect(unmark).not.toHaveBeenCalled();
    expect(deps.createAttachment).not.toHaveBeenCalled();
  });
});

describe('downloads, the engagement of a check, and checks that never answer', () => {
  const record: VaultRecord = { id: 'ev-9', name: 'A.pdf', file_path: 'E1/u1/1-A.pdf', file_type: 'document', file_size: 1 };
  const quickHash = async () => 'ab'.repeat(32);

  it('a result only sent to a download still counts as unsaved; its badge is neutral, not a confirmed save', () => {
    expect(isUnsavedResult(result('r', 'A.pdf'))).toBe(true);
    expect(isUnsavedResult(result('r', 'A.pdf', { sentTo: ['download'] }))).toBe(true);
    expect(isUnsavedResult(result('r', 'A.pdf', { sentTo: ['download', 'vault'] }))).toBe(false);
    expect(isUnsavedResult(result('r', 'A.pdf', { sentTo: ['computer'] }))).toBe(false);
    expect(isUnsavedResult(result('r', 'A.pdf', { origin: 'computer', operation: undefined }))).toBe(false);
    expect(SENT_TONES.download).toBe('neutral');
    expect([SENT_TONES.computer, SENT_TONES.vault, SENT_TONES['working-paper']]).toEqual(['success', 'success', 'success']);
  });

  it('the record is checked within the engagement captured at confirm', async () => {
    const files = [result('r1', 'A.pdf', { vaultRecord: record, sentTo: ['vault'] })];
    const { scope, deps } = setup(files);
    deps.vaultRecordState = vi.fn(async () => 'present' as const);
    await attachToWorkingPaper(files, null, TARGET, scope, deps);
    expect(deps.vaultRecordState).toHaveBeenCalledWith(record, 'E1');
    const check = vi.fn(async () => 'present' as const);
    const t = setup(files);
    await dropMissingVaultRecords(files, check, t.scope, t.store);
    expect(check).toHaveBeenCalledWith(record, 'E1');
  });

  it('withTimeout gives the answer, or the fallback after the limit or on a failure', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      expect(await withTimeout(Promise.resolve('x'), 1000, 'late')).toBe('x');
      expect(await withTimeout(Promise.reject(new Error('no')), 1000, 'late')).toBe('late');
      const hanging = withTimeout(new Promise<string>(() => undefined), 1000, 'late');
      await vi.advanceTimersByTimeAsync(1000);
      expect(await hanging).toBe('late');
    } finally {
      vi.useRealTimers();
    }
  });

  it('a vault check that never answers is "could not be checked" after the limit: not attached, mark kept', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const files = [result('r1', 'A.pdf', { vaultRecord: record, sentTo: ['vault'] })];
      const { scope, deps, current } = setup(files);
      deps.hash = quickHash;
      deps.vaultRecordState = vi.fn(() => new Promise<VaultRecordState>(() => undefined));
      const running = attachToWorkingPaper(files, null, TARGET, scope, deps);
      await vi.advanceTimersByTimeAsync(CHECK_TIMEOUT_MS);
      const outcome = await running;
      expect(outcome.failed).toEqual([{ id: 'r1', name: 'A.pdf', stage: 'check', reason: VAULT_UNCHECKED }]);
      expect(deps.createAttachment).not.toHaveBeenCalled();
      expect(current('r1').vaultRecord?.id).toBe('ev-9');
    } finally {
      vi.useRealTimers();
    }
  });

  it('an open-time check that never answers lets the dialog open after the limit, dropping nothing', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const files = [result('r1', 'A.pdf', { vaultRecord: record, sentTo: ['vault'] })];
      const { scope, store, current } = setup(files);
      const running = dropMissingVaultRecords(files, () => new Promise<VaultRecordState>(() => undefined), scope, store);
      await vi.advanceTimersByTimeAsync(CHECK_TIMEOUT_MS);
      expect(await running).toEqual({ status: 'done', dropped: [] });
      expect(current('r1').vaultRecord?.id).toBe('ev-9');
    } finally {
      vi.useRealTimers();
    }
  });

  it('a signed-in-user question that never answers writes no late entry after the limit', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const files = [result('r1', 'One.pdf'), result('r2', 'Two.pdf')];
      const { store, scope, deps, logs } = setup(files);
      deps.hash = quickHash;
      deps.signedInUserId = vi.fn(() => new Promise<string | null>(() => undefined));
      deps.uploadFile = vi.fn(async () => {
        store.setContext(null); // the engagement watch empties the store during the upload
        return { id: 'ev-1', name: 'One.pdf', file_path: 'E1/u1/1-One.pdf', file_type: 'document', file_size: 1 };
      });
      const running = addToVault(files, FORM, scope, deps);
      await vi.advanceTimersByTimeAsync(CHECK_TIMEOUT_MS);
      expect((await running).status).toBe('stale');
      expect(logs).toEqual([]);
      expect(deps.uploadFile).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('recordComputerSave', () => {
  const sha = 'cd'.repeat(32);

  it('marks each saved file and logs it for the engagement', async () => {
    const files = [result('r1', 'One.pdf'), result('r2', 'Two.pdf')];
    const { scope, deps, logs, current } = setup(files);
    const outcome = await recordComputerSave({ files, markIds: ['r1', 'r2'], download: false, zip: false, hashes: [sha, sha] }, scope, deps);
    expect(outcome).toEqual({ status: 'done', logFailures: 0 });
    expect(current('r1').sentTo).toEqual(['computer']);
    expect(current('r2').sentTo).toEqual(['computer']);
    expect(logs.map((l) => [l.action, l.engagementId, l.entityId])).toEqual([
      ['Saved to computer', 'E1', undefined],
      ['Saved to computer', 'E1', undefined],
    ]);
    expect(logs[0].details.endsWith('Destination: Computer.')).toBe(true);
  });

  it('logs only the files that were marked (a folder save that stopped part-way)', async () => {
    const files = [result('r1', 'One.pdf'), result('r2', 'Two.pdf')];
    const { scope, deps, logs, current } = setup(files);
    await recordComputerSave({ files, markIds: ['r1'], download: false, zip: false, hashes: [sha, sha] }, scope, deps);
    expect(current('r2').sentTo).toEqual([]);
    expect(logs).toHaveLength(1);
    expect(logs[0].details).toContain('One.pdf');
  });

  it('a download is marked "download" and recorded as sent, its completion not confirmed; a zip says so', async () => {
    const files = [result('r1', 'One.pdf')];
    const { scope, deps, logs, current } = setup(files);
    await recordComputerSave({ files, markIds: ['r1'], download: true, zip: false, hashes: [sha] }, scope, deps);
    expect(current('r1').sentTo).toEqual(['download']);
    await recordComputerSave({ files, markIds: ['r1'], download: false, zip: true, hashes: [sha] }, scope, deps);
    await recordComputerSave({ files, markIds: ['r1'], download: true, zip: true, hashes: [sha] }, scope, deps);
    await recordComputerSave({ files, markIds: ['r1'], download: false, zip: false, hashes: [sha] }, scope, deps);
    expect(current('r1').sentTo).toEqual(['download', 'computer']);
    expect(logs[0]).toMatchObject({ action: 'Sent to download', engagementId: 'E1' });
    expect(logs[0].details.endsWith('Destination: Computer, by download (completion not confirmed).')).toBe(true);
    expect(logs[0].metadata).toMatchObject({ destination: 'download', sha256: sha });
    expect(logs[0].metadata).not.toHaveProperty('zip');
    expect(logs[1]).toMatchObject({ action: 'Saved to computer' });
    expect(logs[1].details.endsWith('Destination: Computer, in one zip file.')).toBe(true);
    expect(logs[1].metadata).toMatchObject({ destination: 'computer', zip: true });
    expect(logs[2].details.endsWith('Destination: Computer, in one zip file, by download (completion not confirmed).')).toBe(true);
    expect(logs[3].details.endsWith('Destination: Computer.')).toBe(true);
    expect(JSON.stringify(logs)).not.toMatch(/Downloads folder/);
  });

  it('describes an input saved as it is (not a result) for what it is', async () => {
    const files = [
      result('i1', 'Bank.pdf', { origin: 'computer', operation: undefined }),
      result('i2', 'Locked letter.pdf', { origin: 'vault', evidenceId: 'ev-4', wasProtected: true, operation: undefined }),
    ];
    const { scope, deps, logs } = setup(files);
    await recordComputerSave({ files, markIds: ['i1', 'i2'], download: false, zip: false, hashes: [sha, sha] }, scope, deps);
    expect(logs[0].details.startsWith('Copy of a file from the computer → Bank.pdf (3 pages')).toBe(true);
    expect(logs[0].details).toContain('Sources: Bank.pdf [computer].');
    expect(logs[1].details.startsWith('Copy of a file from the Evidence Vault, without its password → Locked letter.pdf')).toBe(true);
    expect(logs[1].metadata.sources).toEqual([{ name: 'Locked letter.pdf', origin: 'vault', evidenceId: 'ev-4' }]);
    expect(logs[1].metadata.tool).toBeNull();
  });

  it('after a change of engagement: marks nothing, but writes the entries of the files saved, silently, in their own engagement', async () => {
    const files = [result('r1', 'One.pdf')];
    const { store, scope, deps, logs } = setup(files);
    store.setContext('u1:E2');
    const marks = vi.spyOn(store, 'markSent');
    expect(await recordComputerSave({ files, markIds: ['r1'], download: false, zip: false, hashes: [sha] }, scope, deps)).toEqual({ status: 'stale', logFailures: 0 });
    expect(marks).not.toHaveBeenCalled();
    expect(logs.map((l) => [l.action, l.engagementId])).toEqual([['Saved to computer', 'E1']]);
  });

  it('after the engagement watch emptied the store: writes the entries when the main process still has the same user', async () => {
    for (const [signedIn, expected] of [
      ['u1', 1],
      [null, 0],
    ] as const) {
      const files = [result('r1', 'One.pdf')];
      const { store, scope, deps, logs } = setup(files);
      deps.signedInUserId = vi.fn(async () => signedIn);
      store.setContext(null);
      const marks = vi.spyOn(store, 'markSent');
      expect((await recordComputerSave({ files, markIds: ['r1'], download: false, zip: false, hashes: [sha] }, scope, deps)).status).toBe('stale');
      expect(marks).not.toHaveBeenCalled();
      expect(logs).toHaveLength(expected);
    }
  });

  it('after sign-out or with another user signed in: marks nothing and writes nothing', async () => {
    for (const next of [null, 'u2:E1']) {
      const files = [result('r1', 'One.pdf')];
      const { store, scope, deps, logs } = setup(files);
      store.setContext(next);
      expect((await recordComputerSave({ files, markIds: ['r1'], download: false, zip: false, hashes: [sha] }, scope, deps)).status).toBe('stale');
      expect(logs).toEqual([]);
    }
  });

  it('a change between two entries: the rest are still written for the same user, and stop for another user', async () => {
    for (const [next, expected] of [
      ['u1:E2', 2],
      ['u2:E2', 1],
    ] as const) {
      const files = [result('r1', 'One.pdf'), result('r2', 'Two.pdf')];
      const { store, scope, deps, logs } = setup(files);
      deps.logActivity = vi.fn(async (params: ActivityParams) => {
        logs.push(params);
        store.setContext(next);
        return true;
      });
      expect((await recordComputerSave({ files, markIds: ['r1', 'r2'], download: false, zip: false, hashes: [sha, sha] }, scope, deps)).status).toBe('stale');
      expect(logs).toHaveLength(expected);
      expect(logs.every((l) => l.engagementId === 'E1')).toBe(true);
    }
  });

  it('counts a missing fingerprint or a failed write as a log failure, keeping the mark', async () => {
    const files = [result('r1', 'One.pdf'), result('r2', 'Two.pdf')];
    const { scope, deps, current } = setup(files);
    deps.logActivity = vi.fn(async () => false);
    const outcome = await recordComputerSave({ files, markIds: ['r1', 'r2'], download: false, zip: false, hashes: [null, sha] }, scope, deps);
    expect(outcome).toEqual({ status: 'done', logFailures: 2 });
    expect(deps.logActivity).toHaveBeenCalledTimes(1);
    expect(current('r1').sentTo).toEqual(['computer']);
  });
});

const batch = (over: Partial<BatchResult>): BatchResult => ({ status: 'done', succeeded: [], failed: [], addedToVault: [], droppedFromVault: [], logFailures: 0, notStarted: 0, ...over });

describe('summaries', () => {
  it('words the vault outcome', () => {
    expect(vaultSummary(batch({ succeeded: [{ id: 'a', name: 'A.pdf' }] }))).toEqual({ tone: 'success', title: 'Added to the Evidence Vault', description: 'A.pdf' });
    expect(vaultSummary(batch({ succeeded: [{ id: 'a', name: 'A.pdf' }, { id: 'b', name: 'B.pdf' }, { id: 'c', name: 'C.pdf' }] }))).toMatchObject({
      tone: 'success',
      title: 'Added 3 files to the Evidence Vault',
    });
    const mixed = vaultSummary(
      batch({
        succeeded: [
          { id: 'a', name: 'A.pdf' },
          { id: 'b', name: 'B.pdf' },
          { id: 'c', name: 'C.pdf' },
        ],
        failed: [{ id: 'd', name: 'D.pdf', stage: 'vault', reason: 'The Evidence Vault did not accept it.' }],
      }),
    );
    expect(mixed).toMatchObject({ tone: 'warning', title: '3 added, 1 failed: D.pdf' });
    expect(vaultSummary(batch({ failed: [{ id: 'd', name: 'D.pdf', stage: 'vault', reason: 'x' }] }))).toMatchObject({ tone: 'error', title: 'Not added to the Evidence Vault' });
    expect(vaultSummary(batch({ status: 'stopped', succeeded: [{ id: 'a', name: 'A.pdf' }], notStarted: 2 }))).toMatchObject({ tone: 'warning', title: 'Stopped: 1 added, 2 not added' });
    expect(vaultSummary(batch({ status: 'stale', succeeded: [{ id: 'a', name: 'A.pdf' }] }))).toBeNull();
  });

  it('words the working-paper outcome', () => {
    expect(attachSummary(batch({ succeeded: [{ id: 'a', name: 'A.pdf' }] }), TARGET)).toEqual({
      tone: 'success',
      title: 'Attached to the working paper',
      description: 'A.pdf → Synthetic Sales programme › Trade Receivables › Procedure',
    });
    expect(attachSummary(batch({ succeeded: [{ id: 'a', name: 'A.pdf' }, { id: 'b', name: 'B.pdf' }] }), TARGET)).toMatchObject({ title: 'Attached 2 files to the working paper' });
    const mixed = attachSummary(
      batch({
        succeeded: [{ id: 'a', name: 'A.pdf' }],
        failed: [
          { id: 'b', name: 'B.pdf', stage: 'attach', reason: ATTACH_FAILED },
          { id: 'c', name: 'C.pdf', stage: 'vault', reason: 'x' },
        ],
      }),
      TARGET,
    );
    expect(mixed?.tone).toBe('warning');
    expect(mixed?.title).toBe('1 attached, 2 failed: B.pdf, C.pdf');
    expect(mixed?.description).toContain('B.pdf is in the Evidence Vault; you can retry');
    expect(attachSummary(batch({ status: 'stale' }), TARGET)).toBeNull();
    const none = attachSummary(
      batch({
        failed: [
          { id: 'b', name: 'B.pdf', stage: 'attach', reason: ATTACH_FAILED },
          { id: 'c', name: 'C.pdf', stage: 'attach', reason: ATTACH_FAILED },
        ],
      }),
      TARGET,
    );
    expect(none).toMatchObject({ tone: 'error', title: 'Not attached' });
    expect(none?.description).toContain('B.pdf is in the Evidence Vault; you can retry.');
  });

  it('closes the dialog unless nothing at all was written', () => {
    expect(shouldCloseAfter(batch({ failed: [{ id: 'a', name: 'A.pdf', stage: 'vault', reason: 'x' }] }))).toBe(false);
    expect(shouldCloseAfter(batch({ succeeded: [{ id: 'a', name: 'A.pdf' }] }))).toBe(true);
    expect(shouldCloseAfter(batch({ status: 'stale' }))).toBe(true);
    expect(shouldCloseAfter(batch({ status: 'stopped' }))).toBe(true);
  });

  it('has the exact wording the brief asks for', () => {
    expect(ATTACH_FAILED).toBe('Attachment failed. The file is in the Evidence Vault; you can retry.');
    expect(LOG_FAILED).toBe('Saved, but the activity record could not be written.');
  });
});

describe('working-paper choices', () => {
  it("lists only this engagement's programmes", () => {
    const programs = [
      { id: 'p1', name: 'Sales', engagement_id: 'E1', workpaper_reference: 'S.1' },
      { id: 'p2', name: 'Other', engagement_id: 'E2', workpaper_reference: null },
    ];
    expect(programmesFor(programs, 'E1').map((p) => p.id)).toEqual(['p1']);
    expect(programmesFor(programs, null)).toEqual([]);
  });

  it('orders sections and boxes and marks locked ones "(locked)"', () => {
    const sections = [
      { id: 's2', name: 'Cash and Bank', order: 2, locked: 1, is_applicable: 1 },
      { id: 's1', name: 'Trade Receivables', order: 1, locked: 0, is_applicable: 1 },
      { id: 's3', name: 'CWIP', order: 3, locked: false, is_applicable: 0 },
    ];
    expect(sectionOptions(sections)).toEqual([
      { id: 's1', name: 'Trade Receivables', label: 'Trade Receivables', locked: false },
      { id: 's2', name: 'Cash and Bank', label: 'Cash and Bank (locked)', locked: true },
      { id: 's3', name: 'CWIP', label: 'CWIP (not applicable)', locked: false },
    ]);
    const boxes = [
      { id: 'b2', header: 'Conclusion', order: 4, locked: 'true' },
      { id: 'b1', header: 'Procedure', order: 2, locked: 0 },
    ];
    expect(boxOptions(boxes)).toEqual([
      { id: 'b1', name: 'Procedure', label: 'Procedure', locked: false },
      { id: 'b2', name: 'Conclusion', label: 'Conclusion (locked)', locked: true },
    ]);
  });

  it('names the target', () => {
    expect(targetText(TARGET)).toBe('Synthetic Sales programme › Trade Receivables › Procedure');
    expect(targetText({ programId: 'p', programName: 'P' })).toBe('P');
  });

  it("finds a same-named vault file in this engagement only, ignoring case", () => {
    const rows = [
      { name: 'Bank.PDF', engagement_id: 'E1' },
      { name: 'Ledger.pdf', engagement_id: 'E2' },
    ];
    expect(sameNameInVault(rows, 'E1', 'bank.pdf')).toBe(true);
    expect(sameNameInVault(rows, 'E1', 'Ledger.pdf')).toBe(false);
    expect(sameNameInVault(rows, null, 'bank.pdf')).toBe(false);
  });
});
