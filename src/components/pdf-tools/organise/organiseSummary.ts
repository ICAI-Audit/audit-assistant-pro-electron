// What the Organise pages dialog says about an edit (design 5.15): how many pages were moved, rotated
// and removed; the line above the grid, which is also the activity summary; the primary button's words;
// the record's metadata; and why Run cannot be pressed. "Rotate" is the owner's word (ux-audit C10);
// the code and the record's metadata key keep the design's "turn". Page numbers only: never a file name
// or anything from the file.
import { formatPageList } from '@/lib/pdf-tools/pageList';
import { isTurnOnly, type PagePlan } from '@/lib/pdf-tools/pageOrder';
import { operationSummary } from '@/lib/pdf-tools/resultNames';
import { PHASE_TWO_ERROR_MESSAGES } from '@/lib/pdf-tools/types';
import { hasChanges, type OrganiseEditState, type OrganiseTile } from '../organiseEdit';

export interface OrganiseCounts {
  /** The fewest pages that had to be moved to give the new order (see movedCount). */
  moved: number;
  /** Kept pages that are rotated (turned, in the code's words). */
  turned: number;
  removed: number;
  kept: number;
}

/**
 * The fewest pages that had to move to give `order` (source indices of the kept pages): the kept
 * pages less the longest run that is still in the file's order (a longest increasing subsequence).
 * Taking one page of ten to the end is 1 moved, not the ten that shifted.
 */
export function movedCount(order: readonly number[]): number {
  const tails: number[] = [];
  for (const value of order) {
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (tails[mid] < value) low = mid + 1;
      else high = mid;
    }
    tails[low] = value;
  }
  return order.length - tails.length;
}

export function countsOfTiles(tiles: readonly OrganiseTile[]): OrganiseCounts {
  const kept = tiles.filter((tile) => !tile.removed);
  return {
    moved: movedCount(kept.map((tile) => tile.source)),
    turned: kept.filter((tile) => tile.turn !== 0).length,
    removed: tiles.length - kept.length,
    kept: kept.length,
  };
}

export function countsOfPlan(plan: PagePlan, pageCount: number): OrganiseCounts {
  return {
    moved: movedCount(plan.order),
    turned: plan.order.filter((source) => (plan.turns[source] ?? 0) !== 0).length,
    removed: pageCount - plan.order.length,
    kept: plan.order.length,
  };
}

/** "3 moved, 2 rotated, 1 removed" (the owner's word is "rotate"); only what changed; "No changes yet" when nothing did. */
export function changeLine(counts: OrganiseCounts): string {
  const parts = [
    counts.moved > 0 ? `${counts.moved} moved` : null,
    counts.turned > 0 ? `${counts.turned} rotated` : null,
    counts.removed > 0 ? `${counts.removed} removed` : null,
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(', ') : 'No changes yet';
}

const pages = (n: number) => `${n} ${n === 1 ? 'page' : 'pages'}`;

/** The primary button: a verb and the result (ux-audit E1), "Save 12 pages in the new order". */
export function runLabel(counts: OrganiseCounts): string {
  if (counts.kept === 0) return 'Save in the new order';
  const saved = `Save ${pages(counts.kept)}`;
  if (counts.moved > 0) return `${saved} in the new order`;
  if (counts.removed > 0) return `${saved} without the ${counts.removed === 1 ? 'removed page' : `${counts.removed} removed pages`}`;
  if (counts.turned > 0) return `${saved} with ${counts.turned} rotated`;
  return saved;
}

export const NOTHING_TO_DO = 'Nothing to do yet. Move, rotate or remove a page first.';
export const ALL_REMOVED = PHASE_TWO_ERROR_MESSAGES['organise-all-removed'] ?? 'You cannot remove every page. Keep at least one.';

/** Why Run cannot be pressed, or null when it can. */
export function runBlockedReason(state: OrganiseEditState): string | null {
  if (!hasChanges(state)) return NOTHING_TO_DO;
  if (state.tiles.every((tile) => tile.removed)) return ALL_REMOVED;
  return null;
}

/** The record's `order` is cut to this many characters (design 5.15). */
export const ORDER_MAX_LENGTH = 200;

/** A page list cut at a separator so that it and ", …" fit in `max` characters. */
export function cutList(list: string, max: number): string {
  if (list.length <= max) return list;
  const ending = ', …';
  const room = list.slice(0, max - ending.length + 1);
  const at = room.lastIndexOf(', ');
  return `${at > 0 ? room.slice(0, at) : room.slice(0, max - ending.length)}${ending}`;
}

/**
 * Pages (from 0, ascending) as a list like formatPageList's, cut at a part so that it and ", … and N more"
 * fit in `max` characters; N counts the pages left out of the list.
 */
export function cutPageList(indices: readonly number[], max: number): string {
  const runs: { text: string; pages: number }[] = [];
  for (let i = 0; i < indices.length; ) {
    let j = i;
    while (j + 1 < indices.length && indices[j + 1] === indices[j] + 1) j++;
    runs.push({ text: j > i ? `${indices[i] + 1}-${indices[j] + 1}` : `${indices[i] + 1}`, pages: j - i + 1 });
    i = j + 1;
  }
  const whole = runs.map((run) => run.text).join(', ');
  if (whole.length <= max) return whole;
  let text = '';
  let listed = 0;
  for (const run of runs) {
    const next = text === '' ? run.text : `${text}, ${run.text}`;
    if (`${next}, … and ${indices.length - listed - run.pages} more`.length > max) break;
    text = next;
    listed += run.pages;
  }
  return `${text === '' ? '' : `${text}, `}… and ${indices.length - listed} more`;
}

/**
 * The activity record of a run: the summary ("Organised pages: 3 moved, 2 rotated, 1 removed") and
 * the metadata of design 5.15 (`order` as a page list, `turned`, `removed` as a page list), with
 * `moved` and `method` ('in-place' for a turn-only run, 'page-copy' otherwise). `notKept` are the
 * library's sentences about what the copy did not keep; they end the summary, in its words.
 */
export function organiseRecord(plan: PagePlan, pageCount: number, notKept: readonly string[] = []): { summary: string; options: Record<string, string | number> } {
  const counts = countsOfPlan(plan, pageCount);
  const kept = new Set(plan.order);
  const removed = Array.from({ length: pageCount }, (_, index) => index).filter((index) => !kept.has(index));
  return {
    // The library's own sentences about what was not kept (pageOrder.ts organiseNotes), as they are.
    // One source for the line (resultNames.ts operationSummary, the same words as changeLine).
    summary: [operationSummary('organise-pages', { moved: counts.moved, turned: counts.turned, removed: counts.removed }), ...notKept.map((note) => note.replace(/\.$/, ''))].join('; '),
    options: {
      order: cutList(formatPageList([...plan.order]), ORDER_MAX_LENGTH),
      moved: counts.moved,
      turned: counts.turned,
      removed: cutPageList(removed, ORDER_MAX_LENGTH),
      method: isTurnOnly(plan, pageCount) ? 'in-place' : 'page-copy',
    },
  };
}
