// "Select the files just added" (UX audit C1.1, T1-1): files added from the computer or the Evidence
// Vault become the selection, so a tool can be used at once. Results already become the selection
// when a tool adds them (PdfTools finishRun).
//
// The rule, for one adding (a batch: everything the user gave at once, plus anything given while it is
// still being added): the first file of the batch to arrive REPLACES the selection; each later file of
// the same batch is ADDED to the selection as it then is, so a file the user unticks meanwhile stays
// unticked. Results (made by a tool meanwhile) are never part of a batch.
import type { WorkingFile } from '@/lib/pdf-tools/types';

export interface AddBatch {
  /** The rows the list held when the batch began. */
  before: ReadonlySet<string>;
  /** The batch's files already seen arriving. */
  seen: ReadonlySet<string>;
}

export function startBatch(files: readonly Pick<WorkingFile, 'id'>[]): AddBatch {
  return { before: new Set(files.map((f) => f.id)), seen: new Set() };
}

/**
 * The selection once the batch's newly arrived files are counted, and the batch to keep; null when no
 * file of the batch has arrived since the last call (nothing to change).
 */
export function selectionAfterAdding(
  batch: AddBatch,
  files: readonly Pick<WorkingFile, 'id' | 'origin'>[],
  selectedIds: readonly string[],
): { selectedIds: string[]; batch: AddBatch } | null {
  const arrived = files.filter((f) => f.origin !== 'result' && !batch.before.has(f.id) && !batch.seen.has(f.id)).map((f) => f.id);
  if (arrived.length === 0) return null;
  const kept = batch.seen.size === 0 ? [] : selectedIds;
  return {
    selectedIds: Array.from(new Set([...kept, ...arrived])),
    batch: { before: batch.before, seen: new Set([...batch.seen, ...arrived]) },
  };
}
