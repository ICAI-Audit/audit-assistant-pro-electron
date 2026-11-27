import { useSyncExternalStore } from 'react';

/**
 * Presentation bridge between the Financial Statement Review module and the VERA top bar (T-088, UI only).
 *
 * The module no longer draws its own page-header band. What that band showed now lives in the top bar: the engagement and
 * constitution as a second line under the client switcher, and the financial-period list inside the switcher menu. The module
 * publishes those values here and registers its own period handler; the top bar only displays them and forwards a choice.
 * Nothing here owns data or decides anything.
 */
export interface FsrPeriod {
  id: number | string;
  label: string;
  range: string;
  locked: boolean;
}

export interface FsrShellState {
  /** True while a Financial Statement Review screen is mounted. */
  active: boolean;
  /** e.g. "Statutory audit FY 2024-25 · Company". */
  context: string;
  periods: FsrPeriod[];
  selectedPeriodId: number | string | null;
}

const EMPTY: FsrShellState = { active: false, context: '', periods: [], selectedPeriodId: null };
let state: FsrShellState = EMPTY;
let selectHandler: ((id: number | string) => void) | null = null;
const listeners = new Set<() => void>();

const same = (a: FsrShellState, b: FsrShellState) =>
  a.active === b.active && a.context === b.context && a.selectedPeriodId === b.selectedPeriodId
  && a.periods.length === b.periods.length
  && a.periods.every((p, i) => p.id === b.periods[i].id && p.label === b.periods[i].label && p.locked === b.periods[i].locked);

export const fsrShellBridge = {
  publish(next: Partial<FsrShellState>) {
    const merged = { ...state, ...next };
    if (same(state, merged)) return;
    state = merged;
    listeners.forEach((l) => l());
  },
  reset() {
    if (state === EMPTY) return;
    state = EMPTY;
    listeners.forEach((l) => l());
  },
  /** The module registers its own period-change handler; returns an unregister function. */
  registerSelect(fn: (id: number | string) => void) {
    selectHandler = fn;
    return () => { if (selectHandler === fn) selectHandler = null; };
  },
  selectPeriod(id: number | string) {
    selectHandler?.(id);
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
  getSnapshot: () => state,
};

export function useFsrShell(): FsrShellState {
  return useSyncExternalStore(fsrShellBridge.subscribe, fsrShellBridge.getSnapshot);
}
