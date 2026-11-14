import { PdfToolsError, type Destination, type VaultRecord, type WorkingFile } from './types';

export const LIST_WARN_BYTES = 150 * 1024 * 1024;
export const LIST_MAX_BYTES = 300 * 1024 * 1024;

export interface WorkingListState {
  contextKey: string | null;
  /** Counts every change of context key (including to/from null). Capture it before an await and pass it back. */
  session: number;
  files: WorkingFile[];
  selectedIds: string[];
}

export interface WorkingListStore {
  getState(): WorkingListState;
  subscribe(listener: () => void): () => void;
  setContext(contextKey: string | null): void;
  addFiles(
    contextKey: string,
    files: WorkingFile[],
    session?: number,
  ): { added: number; refused: number; overWarn: boolean };
  /**
   * Adds all the files, or none. Returns false (silently) when the context or session is no longer
   * current; throws PdfToolsError 'list-full' when they would take the list past its maximum size.
   */
  addResults(contextKey: string, files: WorkingFile[], session?: number): boolean;
  remove(ids: string[]): void;
  move(id: string, direction: 'up' | 'down'): void;
  setSelected(ids: string[]): void;
  markSent(id: string, destination: Destination, vaultRecord?: VaultRecord): void;
  /**
   * Drops a row's vault mark and record (its vault file has gone). Only in the given context and
   * session; returns whether the row changed.
   */
  unmarkVault(contextKey: string, session: number, id: string): boolean;
}

export interface WorkingListOptions {
  warnBytes?: number;
  maxBytes?: number;
}

export function contextKeyFor(userId: string, engagementId: string): string {
  return `${userId}:${engagementId}`;
}

export function newFileId(): string {
  return crypto.randomUUID();
}

/** Selected files in list order (the merge order), not in the order they were ticked. */
export function selectedInOrder(state: WorkingListState): WorkingFile[] {
  const chosen = new Set(state.selectedIds);
  return state.files.filter((f) => chosen.has(f.id));
}

/** Frozen copy of a file; `size` is always the real byte length. The bytes themselves are shared, not frozen. */
function frozenFile(file: WorkingFile, id: string = file.id): WorkingFile {
  const copy: WorkingFile = {
    ...file,
    id,
    size: file.bytes.byteLength,
    sentTo: Object.freeze([...file.sentTo]) as Destination[],
  };
  if (file.vaultRecord) copy.vaultRecord = Object.freeze({ ...file.vaultRecord });
  return Object.freeze(copy);
}

export function createWorkingListStore(options: WorkingListOptions = {}): WorkingListStore {
  const warnBytes = options.warnBytes ?? LIST_WARN_BYTES;
  const maxBytes = options.maxBytes ?? LIST_MAX_BYTES;

  const freezeState = (s: WorkingListState): WorkingListState => {
    Object.freeze(s.files);
    Object.freeze(s.selectedIds);
    return Object.freeze(s);
  };

  let state: WorkingListState = freezeState({ contextKey: null, session: 0, files: [], selectedIds: [] });
  const listeners = new Set<() => void>();

  const commit = (next: WorkingListState): void => {
    state = freezeState(next);
    // A listener removed mid-round is still called once in this round (we iterate a copy).
    for (const listener of Array.from(listeners)) {
      try {
        listener();
      } catch {
        // one bad listener must not break the store or the others
      }
    }
  };

  const isCurrent = (contextKey: string, session?: number): boolean =>
    contextKey === state.contextKey && (session === undefined || session === state.session);

  /** Copy, freeze and de-duplicate ids of incoming files. */
  const intake = (incoming: WorkingFile[]): WorkingFile[] => {
    const taken = new Set(state.files.map((f) => f.id));
    return incoming.map((file) => {
      const id = taken.has(file.id) ? newFileId() : file.id;
      taken.add(id);
      return frozenFile(file, id);
    });
  };

  const updateFile = (id: string, change: (f: WorkingFile) => WorkingFile): void => {
    if (!state.files.some((f) => f.id === id)) return;
    commit({ ...state, files: state.files.map((f) => (f.id === id ? frozenFile(change(f)) : f)) });
  };

  return {
    getState: () => state,

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    setContext(contextKey) {
      if (contextKey === state.contextKey) return;
      commit({ contextKey, session: state.session + 1, files: [], selectedIds: [] });
    },

    addFiles(contextKey, files, session) {
      if (!isCurrent(contextKey, session)) return { added: 0, refused: 0, overWarn: false };
      let total = state.files.reduce((sum, f) => sum + f.size, 0);
      const accepted: WorkingFile[] = [];
      let refused = 0;
      for (const file of files) {
        const length = file.bytes.byteLength;
        if (total + length > maxBytes) {
          refused += 1;
        } else {
          accepted.push(file);
          total += length;
        }
      }
      if (accepted.length > 0) {
        commit({ ...state, files: [...state.files, ...intake(accepted)] });
      }
      return { added: accepted.length, refused, overWarn: total > warnBytes };
    },

    addResults(contextKey, files, session) {
      if (!isCurrent(contextKey, session)) return false;
      const held = state.files.reduce((sum, f) => sum + f.size, 0);
      const incoming = files.reduce((sum, f) => sum + f.bytes.byteLength, 0);
      if (held + incoming > maxBytes) {
        throw new PdfToolsError('list-full', `The list is full: ${Math.round(maxBytes / 1048576)} MB is the most PDF Tools can hold. Remove some files and try again.`);
      }
      if (files.length > 0) {
        commit({ ...state, files: [...state.files, ...intake(files)] });
      }
      return true;
    },

    remove(ids) {
      const gone = new Set(ids);
      if (!state.files.some((f) => gone.has(f.id))) return;
      commit({
        ...state,
        files: state.files.filter((f) => !gone.has(f.id)),
        selectedIds: state.selectedIds.filter((id) => !gone.has(id)),
      });
    },

    move(id, direction) {
      const from = state.files.findIndex((f) => f.id === id);
      const to = direction === 'up' ? from - 1 : from + 1;
      if (from < 0 || to < 0 || to >= state.files.length) return;
      const files = state.files.slice();
      [files[from], files[to]] = [files[to], files[from]];
      commit({ ...state, files });
    },

    setSelected(ids) {
      const known = new Set(state.files.map((f) => f.id));
      const next = Array.from(new Set(ids)).filter((id) => known.has(id));
      const same = next.length === state.selectedIds.length && next.every((id, i) => id === state.selectedIds[i]);
      if (same) return;
      commit({ ...state, selectedIds: next });
    },

    markSent(id, destination, vaultRecord) {
      updateFile(id, (f) => ({
        ...f,
        sentTo: f.sentTo.includes(destination) ? f.sentTo : [...f.sentTo, destination],
        vaultRecord: vaultRecord ?? f.vaultRecord,
      }));
    },

    unmarkVault(contextKey, session, id) {
      if (!isCurrent(contextKey, session)) return false;
      const current = state.files.find((f) => f.id === id);
      if (!current || (!current.sentTo.includes('vault') && !current.vaultRecord)) return false;
      updateFile(id, (f) => {
        const { vaultRecord: _gone, ...rest } = f;
        void _gone;
        return { ...rest, sentTo: f.sentTo.filter((d) => d !== 'vault') };
      });
      return true;
    },
  };
}

export const workingListStore: WorkingListStore = createWorkingListStore();
