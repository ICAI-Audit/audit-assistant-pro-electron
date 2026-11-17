// Where a result comes from when it was made from other results: the steps that made its sources,
// oldest first, and the files those steps started from. A result carries this in its operation
// record, so the activity entry of the last step can name the earlier steps and the true sources
// (with their Evidence Vault record ids), even though the results in between were never sent anywhere.
import type { OperationRecord, OperationStep, SourceRef, WorkingFile } from './types';

/** Steps a result's record keeps; older ones are only counted. The activity entry lists fewer. */
export const MAX_KEPT_STEPS = 50;

export function sourceRef(file: Pick<WorkingFile, 'name' | 'origin' | 'evidenceId'> & { id?: string }): SourceRef {
  const ref: SourceRef = { name: file.name, origin: file.origin };
  if (file.evidenceId) ref.evidenceId = file.evidenceId;
  if (file.id) ref.fileId = file.id;
  return ref;
}

function once<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const k = key(item);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// The same working file reached through two results is one source; two files with one name are two.
const sourceKey = (s: SourceRef) => (s.fileId ? `file:${s.fileId}` : s.evidenceId ? `vault:${s.evidenceId}` : `${s.origin}:${s.name}`);

/**
 * The history a result made from `sources` (in their order) carries: nothing when no source is a
 * result. A step reached through two sources (two parts of one split, merged) is kept once, as is
 * an original source; at most MAX_KEPT_STEPS steps are kept, the newest, and the rest counted.
 * The count can include a dropped step twice when two merged results both dropped it.
 */
export function historyOf(sources: readonly WorkingFile[]): Pick<OperationRecord, 'earlier' | 'earlierNotListed' | 'originalSources'> {
  const steps: OperationStep[] = [];
  const originals: SourceRef[] = [];
  let notListed = 0;
  let fromResults = false;
  for (const file of sources) {
    const operation = file.origin === 'result' ? file.operation : undefined;
    if (!operation) {
      originals.push(sourceRef(file));
      continue;
    }
    fromResults = true;
    notListed += operation.earlierNotListed ?? 0;
    steps.push(...(operation.earlier ?? []), { tool: operation.tool, summary: operation.summary, resultName: file.name, options: operation.options, resultId: file.id });
    // A record without original sources was made from originals only: its sources are they.
    originals.push(...(operation.originalSources ?? operation.sources));
  }
  if (!fromResults) return {};
  const unique = once(steps, (step) => step.resultId);
  const kept = unique.slice(-MAX_KEPT_STEPS);
  notListed += unique.length - kept.length;
  const history: Pick<OperationRecord, 'earlier' | 'earlierNotListed' | 'originalSources'> = { earlier: kept, originalSources: once(originals, sourceKey) };
  if (notListed > 0) history.earlierNotListed = notListed;
  return history;
}
