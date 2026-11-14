import { PdfToolsError } from '@/lib/pdf-tools/types';

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The message to show for a failure: a PdfToolsError's own words, never a library's raw text. */
export function plainMessage(error: unknown, fallback = 'This file could not be read. It may be damaged.'): string {
  return error instanceof PdfToolsError ? error.message : fallback;
}
