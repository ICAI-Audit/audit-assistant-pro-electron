import { useSyncExternalStore } from 'react';

/**
 * Presentation preferences for the Financial Statement Review module and the VERA user menu (T-088, UI only).
 *
 *   reportHeading  show the full centred report heading on screen (default off; the heading stays in the page for assistive
 *                  technology and is always in the PDF/Excel output, which is built elsewhere)
 *   density        'auto' (by window width) | 'compact' | 'regular' | 'comfortable'
 *   focus          hide the VERA sidebar and top bar (not remembered)
 *
 * Remembered values use namespaced localStorage keys. Nothing here touches data or logic.
 */
export type Density = 'auto' | 'compact' | 'regular' | 'comfortable';

const KEYS = { heading: 'vera.fsr.reportHeading', density: 'vera.fsr.density' } as const;
const DENSITIES: Density[] = ['auto', 'compact', 'regular', 'comfortable'];
const listeners = new Set<() => void>();
let focus = false;

const emit = () => listeners.forEach((l) => l());
const read = (key: string): string | null => {
  try { return localStorage.getItem(key); } catch { return null; }
};
const write = (key: string, value: string | null) => {
  try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch { /* not remembered */ }
};

export const fsrPrefs = {
  getReportHeading: (): boolean => read(KEYS.heading) === 'on',
  setReportHeading(on: boolean) { write(KEYS.heading, on ? 'on' : 'off'); emit(); },

  getDensity: (): Density => {
    const value = read(KEYS.density) as Density | null;
    return value && DENSITIES.includes(value) ? value : 'auto';
  },
  setDensity(density: Density) { write(KEYS.density, density === 'auto' ? null : density); emit(); },

  getFocus: (): boolean => focus,
  setFocus(on: boolean) {
    if (focus === on) return;
    focus = on;
    if (on) document.documentElement.setAttribute('data-fsr-focus', '1');
    else document.documentElement.removeAttribute('data-fsr-focus');
    emit();
  },

  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },

  /** Mirrors the preferences onto an element as data attributes the stylesheet reads. Returns an unbind function. */
  bind(el: Element | null | undefined) {
    if (!el) return () => {};
    const apply = () => {
      el.setAttribute('data-report-heading', fsrPrefs.getReportHeading() ? 'on' : 'off');
      const density = fsrPrefs.getDensity();
      if (density === 'auto') el.removeAttribute('data-density');
      else el.setAttribute('data-density', density);
    };
    apply();
    return fsrPrefs.subscribe(apply);
  },
};

export function useFsrReportHeading() {
  return useSyncExternalStore(fsrPrefs.subscribe, fsrPrefs.getReportHeading);
}
export function useFsrDensity() {
  return useSyncExternalStore(fsrPrefs.subscribe, fsrPrefs.getDensity);
}
export function useFsrFocus() {
  return useSyncExternalStore(fsrPrefs.subscribe, fsrPrefs.getFocus);
}
