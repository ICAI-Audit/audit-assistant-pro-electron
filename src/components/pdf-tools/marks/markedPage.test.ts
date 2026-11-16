import { describe, expect, it } from 'vitest';
import { emptyMarkReport } from '@/lib/pdf-tools/watermark';
import { PdfToolsError } from '@/lib/pdf-tools/types';
import { isAbortError } from '../renderQueue';
import { drawMarkedPage, overlayDpi, previewProblem, type MarkedPageDeps } from './markedPage';

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

function deps(log: string[] = []): MarkedPageDeps {
  return {
    extract: async (_file, pageIndex) => {
      log.push(`extract ${pageIndex}`);
      return new Uint8Array([pageIndex]);
    },
    render: async (file, dpi) => {
      log.push(`render ${file[0]} at ${dpi}`);
      return { bytes: png, width: 827, height: 1169, dpi };
    },
  };
}

describe('drawMarkedPage', () => {
  it('copies the page out, marks the copy and draws it, giving the pixels per point', async () => {
    const log: string[] = [];
    const report = { ...emptyMarkReport(), clipped: [1] };
    const page = await drawMarkedPage(deps(log), new Uint8Array([9]), 4, async (one) => ({ bytes: new Uint8Array([one[0] + 100]), report }), 100, new AbortController().signal);
    expect(log).toEqual(['extract 4', 'render 104 at 100']);
    expect(page).toEqual({ png, width: 827, height: 1169, pxPerPt: 100 / 72, report });
  });

  it('stops after any step once the signal fires', async () => {
    const controller = new AbortController();
    const log: string[] = [];
    const run = drawMarkedPage(deps(log), new Uint8Array([1]), 0, async (one) => {
      controller.abort();
      return { bytes: one };
    }, 150, controller.signal);
    await expect(run).rejects.toSatisfy(isAbortError);
    expect(log).toEqual(['extract 0']);
  });

  it('reports the resolution actually drawn when the page was too large for the one asked', async () => {
    const d = deps();
    d.render = async () => ({ bytes: png, width: 100, height: 100, dpi: 120 });
    const page = await drawMarkedPage(d, new Uint8Array([1]), 0, async (one) => ({ bytes: one }), 300, new AbortController().signal);
    expect(page.pxPerPt).toBeCloseTo(120 / 72, 6);
  });
});

describe('previewProblem', () => {
  it('blocks Run for the options the library refuses, naming the real page', () => {
    expect(previewProblem(new PdfToolsError('invalid-watermark-options', 'The stamp does not fit on page 1. Use shorter text.'), 7)).toEqual({
      message: 'The stamp does not fit on page 7. Use shorter text.',
      blocking: true,
      code: 'invalid-watermark-options',
    });
    expect(previewProblem(new PdfToolsError('unsupported-characters', 'The stamp text contains characters that cannot be printed: ₹.'), 2)).toMatchObject({ blocking: true, code: 'unsupported-characters' });
    expect(previewProblem(new PdfToolsError('invalid-number-options', 'The page number does not fit on page 1. Use a smaller font size.'), 3).message).toBe(
      'The page number does not fit on page 3. Use a smaller font size.',
    );
    expect(previewProblem(new PdfToolsError('invalid-number-options', 'The text at the top of page 1 runs into the text next to it.'), 12).message).toBe(
      'The text at the top of page 12 runs into the text next to it.',
    );
  });

  it('does not block Run when only the drawing failed, and never shows the library text then', () => {
    expect(previewProblem(new Error('worker crashed: /secret/path'), 1)).toEqual({ message: 'The preview could not be drawn. The marks can still be added.', blocking: false });
    expect(previewProblem(new PdfToolsError('render-failed', 'Page 1 could not be drawn.'), 1)).toMatchObject({ blocking: false });
  });
});

describe('overlayDpi', () => {
  it('draws the large view at the resolution the screen needs: 100, 150 or 300 dpi', () => {
    expect(overlayDpi(1, 1)).toBe(100);
    expect(overlayDpi(2, 1)).toBe(150);
    expect(overlayDpi(2, 1.5)).toBe(300);
    expect(overlayDpi(4, 2)).toBe(300);
  });
});
