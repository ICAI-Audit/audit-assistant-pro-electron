// The width measure PDF to Word fits replacement fonts with (textMeasure.ts), on a stand-in for a canvas.
import { describe, expect, it, vi } from 'vitest';
import { createTextMeasure, MEASURE_PX } from './textMeasure';

/** A canvas whose letters are 0.5 of the font size wide, bold ones 0.6, and which records the fonts it was set to. */
function standIn() {
  const fonts: string[] = [];
  let font = '';
  const measureText = vi.fn((text: string) => ({ width: text.length * MEASURE_PX * (font.includes('bold') ? 0.6 : 0.5) }));
  return {
    fonts,
    measureText,
    context: {
      get font() {
        return font;
      },
      set font(value: string) {
        font = value;
        fonts.push(value);
      },
      measureText,
    },
  };
}

describe('the text measure', () => {
  it('gives the width of a text at size 1 in the run\'s own font, letter by letter', () => {
    const canvas = standIn();
    const measure = createTextMeasure(() => canvas.context);
    expect(measure('abc', { family: 'Arial' })).toBeCloseTo(1.5, 6);
    expect(measure('abc', { family: 'Arial', bold: true })).toBeCloseTo(1.8, 6);
    expect(canvas.fonts[0]).toBe(`${MEASURE_PX}px "Arial"`);
    expect(canvas.fonts.some((f) => f === `bold ${MEASURE_PX}px "Arial"`)).toBe(true);
    expect(measure('ab', { family: 'Times New Roman', italic: true, bold: true })).toBeCloseTo(1.2, 6);
    expect(canvas.fonts[canvas.fonts.length - 1]).toBe(`italic bold ${MEASURE_PX}px "Times New Roman"`);
  });

  it('measures each letter of a font once, however long the document', () => {
    const canvas = standIn();
    const measure = createTextMeasure(() => canvas.context);
    measure('banana', { family: 'Arial' });
    measure('a banana band', { family: 'Arial' });
    expect(canvas.measureText).toHaveBeenCalledTimes(5); // b, a, n, the space, d
  });

  it('uses the document\'s own font for a run that names none, and gives 0 where no canvas can be had', () => {
    const canvas = standIn();
    expect(createTextMeasure(() => canvas.context)('ab', {})).toBeCloseTo(1, 6);
    expect(canvas.fonts[0]).toBe(`${MEASURE_PX}px "Calibri"`);
    expect(createTextMeasure(() => null)('ab', { family: 'Arial' })).toBe(0);
  });
});
