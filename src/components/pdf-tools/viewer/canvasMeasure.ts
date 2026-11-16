// Character widths for placing search highlights inside a text item (searchGeometry.ts): a character's
// advance at 100 px in one of the fallback families, measured one character at a time with a canvas
// (a whole string would be kerned). Each viewer search has its own measure and cache, emptied when the
// search closes: the cache holds the characters of the page text that were measured.
import type { MeasureChar } from '@/lib/pdf-tools/pageText';
import { SEARCH_FALLBACK_FAMILY } from './searchGeometry';

type MeasuringContext = { font: string; measureText(text: string): { width: number } };

export interface CanvasMeasure {
  measure: MeasureChar;
  /** Lets the measured characters and the canvas go. */
  clear(): void;
}

export function createCanvasMeasure(): CanvasMeasure {
  let context: MeasuringContext | null | undefined;
  let family = '';
  const widths = new Map<string, number>();
  const families = new Set(Object.values(SEARCH_FALLBACK_FAMILY));
  const measure: MeasureChar = (ch, wanted) => {
    const known = families.has(wanted) ? wanted : 'Arial';
    const key = `${known}\u0000${ch}`;
    const cached = widths.get(key);
    if (cached !== undefined) return cached;
    if (context === undefined) {
      try {
        const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(8, 8) : document.createElement('canvas');
        context = (canvas.getContext('2d') as MeasuringContext | null) ?? null;
      } catch {
        context = null;
      }
    }
    let width = 0;
    if (context) {
      if (family !== known) {
        context.font = `100px "${known}"`;
        family = known;
      }
      width = context.measureText(ch).width;
    }
    // 0 when nothing can be measured: the item is then shared out by character count.
    const value = Number.isFinite(width) && width > 0 ? width : 0;
    widths.set(key, value);
    return value;
  };
  return {
    measure,
    clear() {
      widths.clear();
      context = undefined;
      family = '';
    },
  };
}
