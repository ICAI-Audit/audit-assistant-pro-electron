// Make searchable, the shared shapes (T-064, OCR part A): the rule for ruling-line words, the errors part B's engine
// rejects with, and the constants the trial settled.
import { describe, expect, it } from 'vitest';
import {
  emptyLayerReport,
  isRulingMark,
  OCR_PAGE_TIME_LIMIT_MS,
  OCR_RENDER_DPI,
  OcrPageTimedOut,
  OcrStopped,
  SECONDS_PER_PAGE,
  type OcrEngine,
  type RecognisedPage,
} from './ocrTypes';

describe('isRulingMark', () => {
  it('takes ruled lines read as words, and keeps text, a lone dash and a lone em dash (nil)', () => {
    for (const t of ['|', '||', '¦', '_', '____', '——', '|—', '│', '─────', ' | ']) expect(isRulingMark(t), t).toBe(true);
    for (const t of ['—', '-', 'I', 'l', '1', '|1,234.00', 'a_b', '', ' ']) expect(isRulingMark(t), t).toBe(false);
  });
});

describe('the engine interface', () => {
  it('has a typed error for a page that ran out of time, and one for Stop', () => {
    const late = new OcrPageTimedOut(60_000);
    expect(late).toBeInstanceOf(Error);
    expect(late.name).toBe('OcrPageTimedOut');
    expect(late.limitMs).toBe(60_000);
    expect(late.message).toBe('The page was not recognised within 60 seconds.');
    expect(new OcrStopped()).toBeInstanceOf(Error);
    expect(new OcrStopped().name).toBe('OcrStopped');
  });

  it('can be met by a stand-in engine (the shape part B implements)', async () => {
    const page: RecognisedPage = { words: [{ text: 'Ledger', x0: 1, y0: 2, x1: 3, y1: 4, confidence: 96 }], angle: 0, widthPx: 10, heightPx: 10, seconds: 0.1 };
    let closed = 0;
    const engine: OcrEngine = {
      recognise: async (_image, opts) => {
        if (opts.signal?.aborted) throw new OcrStopped();
        if (opts.timeoutMs <= 0) throw new OcrPageTimedOut(opts.timeoutMs);
        return page;
      },
      close: async () => void closed++,
    };
    expect(await engine.recognise(new Uint8Array(4), { timeoutMs: OCR_PAGE_TIME_LIMIT_MS })).toBe(page);
    await expect(engine.recognise(new Uint8Array(4), { timeoutMs: 0 })).rejects.toBeInstanceOf(OcrPageTimedOut);
    const stop = new AbortController();
    stop.abort();
    await expect(engine.recognise(new Uint8Array(4), { signal: stop.signal, timeoutMs: 1 })).rejects.toBeInstanceOf(OcrStopped);
    await engine.close();
    expect(closed).toBe(1);
  });

  it('keeps the settings the trial measured', () => {
    expect(OCR_RENDER_DPI).toBe(300);
    expect(OCR_PAGE_TIME_LIMIT_MS).toBe(60_000);
    expect(SECONDS_PER_PAGE).toEqual({ low: 5, high: 20 });
    expect(emptyLayerReport()).toEqual({ wordsPlaced: 0, rulingMarks: 0, wordsUnprintable: 0, charactersDropped: 0, wordsBadBox: 0 });
  });
});
