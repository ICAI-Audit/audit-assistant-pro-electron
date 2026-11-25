// The auditor's units (UX audit, principle 5): sizes and margins are chosen from presets and shown in
// millimetres; the libraries work in points, so the conversion happens here, in the option mapping.
// A text size is shown as the height of its capital letters, which is what a reader measures on paper.
import { CAP_HEIGHT } from '@/lib/pdf-tools/marks';

export const MM_PER_PT = 25.4 / 72;

/** The height of a capital letter, in mm, of text set at `pt`. */
export const letterMm = (pt: number): number => pt * CAP_HEIGHT * MM_PER_PT;

/** "2.5 mm" under 4 mm (to the half), "10 mm" from 4 mm (whole). */
export function mmText(mm: number): string {
  const value = mm < 4 ? Math.round(mm * 2) / 2 : Math.round(mm);
  return `${value} mm`;
}

const round2 = (x: number) => Math.round(x * 100) / 100;
const clamp = (x: number, limits: { min: number; max: number }) => Math.min(limits.max, Math.max(limits.min, x));

/** The size in points whose capital letters are `mm` tall, held within the library's limits (the mm limits round to them). */
export function ptForLetter(mm: number, ptLimits: { min: number; max: number }): number {
  return clamp(round2(mm / (CAP_HEIGHT * MM_PER_PT)), ptLimits);
}

/** A distance in mm as points, held within the library's limits. */
export function ptForMm(mm: number, ptLimits: { min: number; max: number }): number {
  return clamp(round2(mm / MM_PER_PT), ptLimits);
}

/** A typed number of millimetres within `limits`, or NaN. */
export function readMm(text: string, limits: { min: number; max: number }): number {
  const t = text.trim();
  if (!/^\d+(\.\d+)?$/.test(t)) return Number.NaN;
  const mm = Number(t);
  return mm >= limits.min && mm <= limits.max ? mm : Number.NaN;
}

export interface SizePreset {
  id: string;
  label: string;
  pt: number;
  recommended?: boolean;
}

/** Fixed watermark sizes (Auto, the default, fits each page). */
export const WATERMARK_SIZES: readonly SizePreset[] = [
  { id: 'small', label: 'Small', pt: 36 },
  { id: 'medium', label: 'Medium', pt: 72 },
  { id: 'large', label: 'Large', pt: 120 },
];
/** Stamp sizes; 20 pt is the design's (the owner's) number. */
export const STAMP_SIZES: readonly SizePreset[] = [
  { id: 'small', label: 'Small', pt: 14 },
  { id: 'medium', label: 'Medium', pt: 20, recommended: true },
  { id: 'large', label: 'Large', pt: 32 },
];
/** Page number, header and footer sizes; 10 pt is phase 1's default. */
export const NUMBER_SIZES: readonly SizePreset[] = [
  { id: 'small', label: 'Small', pt: 8 },
  { id: 'normal', label: 'Normal', pt: 10, recommended: true },
  { id: 'large', label: 'Large', pt: 14 },
];
/** Margins of Page numbers; 28 pt (10 mm) is phase 1's default, so existing results stay the same. */
export const MARGINS: readonly SizePreset[] = [
  { id: 'narrow', label: 'Narrow', pt: 14 },
  { id: 'normal', label: 'Normal', pt: 28, recommended: true },
  { id: 'wide', label: 'Wide', pt: 57 },
];

/** Typed letter heights and margins, in mm. */
export const MM_LIMITS = {
  watermark: { min: 3, max: 50 },
  stamp: { min: 2, max: 18 },
  number: { min: 1.5, max: 9 },
  margin: { min: 3, max: 50 },
} as const;

/** The preset a size in points is, or 'other'. */
export function sizeChoiceOf(pt: number, presets: readonly SizePreset[]): string {
  return presets.find((p) => Math.abs(p.pt - pt) < 0.01)?.id ?? 'other';
}

export interface Swatch {
  value: string;
  label: string;
}

/** The colours offered first; "Other" opens the system colour picker. */
export const SWATCHES: readonly Swatch[] = [
  { value: '#000000', label: 'Black' },
  { value: '#808080', label: 'Grey' },
  { value: '#a00000', label: 'Dark red' },
  { value: '#1e3a8a', label: 'Dark blue' },
];

/** "grey", "dark red", or the code of a colour that is not a swatch. */
export function colourName(hex: string): string {
  const swatch = SWATCHES.find((s) => s.value === hex.trim().toLowerCase());
  return swatch ? swatch.label.toLowerCase() : hex;
}
