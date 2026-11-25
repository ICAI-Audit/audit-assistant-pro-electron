// How wide text is in the fonts Word will use (PDF to Word, T-064 quality round 2; design 5.11).
//
// A PDF's own font is often not on the computer: the document then names a similar one (pdfFontLook.ts), whose
// letters are a little wider or narrower. So that the lines still end where they end on the page, wordLook.ts
// scales each run to its width on the page, and asks here how wide the run is in the font it names. The width
// is the sum of the letters' own widths (Word sets body text without kerning), measured once per letter and
// font on a canvas of the window; nothing measured is kept after the run, and no text is stored: only widths
// by letter.
import type { TextMeasure } from '@/lib/pdf-tools/wordLook';

/** The size letters are measured at, in pixels (large, so that the canvas's rounding does not show). */
export const MEASURE_PX = 200;
/** The font of a run that names none (wordBuild.ts writes the document's default so). */
const DEFAULT_FAMILY = 'Calibri';

/** The part of a canvas's drawing context the measure uses. */
export interface MeasureContext {
  font: string;
  measureText(text: string): { width: number };
}

function windowContext(): MeasureContext | null {
  try {
    if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(8, 8).getContext('2d') as unknown as MeasureContext | null;
    if (typeof document !== 'undefined') return document.createElement('canvas').getContext('2d');
  } catch {
    // No canvas: the measure gives 0, and runs are then left at their own width.
  }
  return null;
}

/**
 * A measure over a canvas context (the window's own when none is given). A text's width at size 1; 0 when no
 * canvas can be had (the caller then leaves the run as it is).
 */
export function createTextMeasure(context: () => MeasureContext | null = windowContext): TextMeasure {
  let ctx: MeasureContext | null | undefined;
  // Per family, its four faces (plain, bold, italic, both): each letter's width by its code, measured when first met.
  const families = new Map<string, (Map<number, number> | undefined)[]>();
  let current = '';
  return (text, look) => {
    if (ctx === undefined) ctx = context();
    if (!ctx) return 0;
    const family = look.family ?? DEFAULT_FAMILY;
    let faces = families.get(family);
    if (!faces) families.set(family, (faces = []));
    const face = (look.bold ? 1 : 0) | (look.italic ? 2 : 0);
    const widths = (faces[face] ??= new Map<number, number>());
    let total = 0;
    for (let i = 0; i < text.length; i++) {
      let code = text.charCodeAt(i);
      // A letter outside the basic plane is two units: measured as one letter.
      const pair = code >= 0xd800 && code <= 0xdbff && i + 1 < text.length;
      if (pair) code = text.codePointAt(i)!;
      let width = widths.get(code);
      if (width === undefined) {
        const font = `${look.italic ? 'italic ' : ''}${look.bold ? 'bold ' : ''}${MEASURE_PX}px "${family.replace(/"/g, '')}"`;
        if (current !== font) {
          ctx.font = font;
          current = font;
        }
        width = ctx.measureText(String.fromCodePoint(code)).width / MEASURE_PX;
        widths.set(code, width);
      }
      total += width;
      if (pair) i++;
    }
    return total;
  };
}
