import { describe, expect, it } from 'vitest';
import { colourName, letterMm, MARGINS, mmText, NUMBER_SIZES, ptForLetter, ptForMm, readMm, sizeChoiceOf, STAMP_SIZES, SWATCHES, WATERMARK_SIZES } from './units';

describe('millimetres for the auditor, points for the library', () => {
  it('writes small sizes to half a millimetre and larger ones whole', () => {
    expect(mmText(letterMm(10))).toBe('2.5 mm');
    expect(mmText(letterMm(8))).toBe('2 mm');
    expect(mmText(28 * (25.4 / 72))).toBe('10 mm');
    expect(mmText(letterMm(72))).toBe('18 mm');
  });

  it('labels every preset with its size in mm, never in pt', () => {
    expect(WATERMARK_SIZES.map((s) => `${s.label} ${mmText(letterMm(s.pt))}`)).toEqual(['Small 9 mm', 'Medium 18 mm', 'Large 30 mm']);
    expect(STAMP_SIZES.map((s) => `${s.label} ${mmText(letterMm(s.pt))}`)).toEqual(['Small 3.5 mm', 'Medium 5 mm', 'Large 8 mm']);
    expect(NUMBER_SIZES.map((s) => `${s.label} ${mmText(letterMm(s.pt))}`)).toEqual(['Small 2 mm', 'Normal 2.5 mm', 'Large 3.5 mm']);
    expect(MARGINS.map((m) => `${m.label} ${mmText(m.pt * (25.4 / 72))}`)).toEqual(['Narrow 5 mm', 'Normal 10 mm', 'Wide 20 mm']);
  });

  it('keeps the phase 1 defaults exactly: a 10 pt number 28 pt from the edge, a 20 pt stamp', () => {
    expect(NUMBER_SIZES.find((s) => s.recommended)?.pt).toBe(10);
    expect(MARGINS.find((m) => m.recommended)?.pt).toBe(28);
    expect(STAMP_SIZES.find((s) => s.recommended)?.pt).toBe(20);
  });

  it('turns a typed letter height or margin into points within the library limits', () => {
    expect(ptForLetter(18, { min: 12, max: 200 })).toBeCloseTo(71.1, 1);
    expect(letterMm(ptForLetter(18, { min: 12, max: 200 }))).toBeCloseTo(18, 2);
    expect(ptForLetter(3, { min: 12, max: 200 })).toBe(12); // 11.8 pt rounds up to the limit
    expect(ptForLetter(1.5, { min: 6, max: 36 })).toBe(6);
    expect(ptForMm(10, { min: 8, max: 144 })).toBeCloseTo(28.35, 2);
    expect(ptForMm(50, { min: 8, max: 144 })).toBeCloseTo(141.73, 2);
  });

  it('reads a typed millimetre value, or NaN outside its limits', () => {
    expect(readMm('12.5', { min: 3, max: 50 })).toBe(12.5);
    expect(readMm(' 3 ', { min: 3, max: 50 })).toBe(3);
    expect(readMm('2.9', { min: 3, max: 50 })).toBeNaN();
    expect(readMm('ten', { min: 3, max: 50 })).toBeNaN();
    expect(readMm('', { min: 3, max: 50 })).toBeNaN();
  });

  it('finds the preset a size in points matches, or "other"', () => {
    expect(sizeChoiceOf(10, NUMBER_SIZES)).toBe('normal');
    expect(sizeChoiceOf(28, MARGINS)).toBe('normal');
    expect(sizeChoiceOf(11, NUMBER_SIZES)).toBe('other');
  });
});

describe('colours', () => {
  it('offers black, grey, dark red and dark blue, and names them', () => {
    expect(SWATCHES.map((s) => s.label)).toEqual(['Black', 'Grey', 'Dark red', 'Dark blue']);
    expect(colourName('#808080')).toBe('grey');
    expect(colourName('#A00000')).toBe('dark red');
    expect(colourName('#123456')).toBe('#123456');
  });
});
