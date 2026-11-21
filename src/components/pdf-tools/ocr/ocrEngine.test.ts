// The recognition engine's adapter (ocrEngine.ts) over a stand-in for the library: every mandatory setting of the
// OCR trial is passed, the words come back in reading order with their line, a page that runs out of time ends its
// worker and gets a fresh one, Stop ends the worker at once, and a failed start leaves no worker behind. The real
// library is proven in the application (OCR-B report); nothing here loads it. Every word below is invented.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OcrPageTimedOut, OcrStopped } from '@/lib/pdf-tools/ocrTypes';
import { createOcrEngine, lineTextSize, OcrEngineFailed, pageFromEngine, type EngineData, type EngineLibrary, type EngineWorker, type EngineWorkerOptions } from './ocrEngine';

/** A PNG's first bytes: enough for its size to be read (signature, IHDR length, "IHDR", width, height). */
function pngOf(width: number, height: number): Uint8Array {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, width);
  new DataView(b.buffer).setUint32(20, height);
  return b;
}

const box = (x0: number, y0: number, x1: number, y1: number) => ({ x0, y0, x1, y1 });
const word = (text: string, bbox: ReturnType<typeof box>, confidence = 93) => ({ text, bbox, confidence });

/** Two blocks: a heading line, then a line that slopes down by 10 px over 1,000 px. */
const DATA: EngineData = {
  rotateRadians: -0.0349,
  blocks: [
    { paragraphs: [{ lines: [{ bbox: box(100, 100, 900, 150), baseline: box(100, 140, 900, 140), words: [word('Nirvexa', box(100, 104, 300, 140)), word('Traders', box(320, 104, 520, 150), 71)] }] }] },
    {
      paragraphs: [
        { lines: [{ bbox: box(100, 300, 1100, 350), baseline: box(100, 340, 1100, 350), words: [word('Amount', box(100, 305, 300, 342)), word('|', box(500, 300, 504, 350)), word('1,23,456.78', box(700, 310, 1100, 350), 64)] }] },
      ],
    },
  ],
};

interface FakeWorker extends EngineWorker {
  options: EngineWorkerOptions;
  parameters: Record<string, string>[];
  pages: { image: Uint8Array; options: unknown; output: unknown }[];
  terminated: number;
  /** Settles the page in progress. */
  answer(data?: EngineData): void;
  fail(reason: string): void;
}

function fakeLibrary(behaviour: { start?: 'ok' | 'never' | 'reject'; recognise?: 'manual' | 'at-once' } = {}) {
  const workers: FakeWorker[] = [];
  const calls: { lang: string; oem: number }[] = [];
  const library: EngineLibrary = {
    createWorker(lang, oem, options) {
      calls.push({ lang, oem });
      let settle: { resolve(value: { data: EngineData }): void; reject(error: unknown): void } | null = null;
      const worker: FakeWorker = {
        options,
        parameters: [],
        pages: [],
        terminated: 0,
        async setParameters(parameters) {
          worker.parameters.push(parameters);
        },
        recognize(image, pageOptions, output) {
          worker.pages.push({ image, options: pageOptions, output });
          if (behaviour.recognise === 'at-once') return Promise.resolve({ data: DATA });
          return new Promise((resolve, reject) => {
            settle = { resolve, reject };
          });
        },
        async terminate() {
          worker.terminated += 1;
        },
        answer: (data = DATA) => settle?.resolve({ data }),
        fail: (reason) => {
          options.errorHandler(reason);
          settle?.reject(reason);
        },
      };
      workers.push(worker);
      if (behaviour.start === 'never') return new Promise<EngineWorker>(() => undefined);
      if (behaviour.start === 'reject') return Promise.reject(new Error('no engine file'));
      return Promise.resolve(worker);
    },
  };
  return { library, workers, calls, load: vi.fn(async () => library) };
}

const BASE = 'file:///C:/app/dist/index.html';
const engineOf = (fake: ReturnType<typeof fakeLibrary>, extra: Partial<Parameters<typeof createOcrEngine>[0]> = {}) => createOcrEngine({ load: fake.load, baseUrl: BASE, ...extra });
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('starting the engine', () => {
  it('passes every mandatory setting: local files only, no cache, one English LSTM worker, automatic layout, Sauvola threshold, the page resolution', async () => {
    const fake = fakeLibrary();
    const engine = engineOf(fake);
    await engine.start();
    expect(fake.calls).toEqual([{ lang: 'eng', oem: 1 }]);
    const { options, parameters } = fake.workers[0];
    expect(options.workerPath).toBe('file:///C:/app/dist/pdf-tools/ocr/worker.min.js');
    expect(options.corePath).toBe('file:///C:/app/dist/pdf-tools/ocr/core');
    expect(options.langPath).toBe('file:///C:/app/dist/pdf-tools/ocr/eng');
    expect(options.gzip).toBe(true);
    expect(options.cacheMethod).toBe('none');
    expect(options.workerBlobURL).toBe(false);
    expect(typeof options.errorHandler).toBe('function');
    expect(typeof options.logger).toBe('function');
    expect(parameters).toEqual([{ tessedit_pageseg_mode: '3', thresholding_method: '2', user_defined_dpi: '300' }]);
    await engine.close();
  });

  it('starts once however often it is asked, and serves every page of a run with the one worker', async () => {
    const fake = fakeLibrary({ recognise: 'at-once' });
    const engine = engineOf(fake);
    await Promise.all([engine.start(), engine.start()]);
    for (let i = 0; i < 3; i++) await engine.recognise(pngOf(2480, 3508), { timeoutMs: 1000 });
    expect(fake.load).toHaveBeenCalledTimes(1);
    expect(fake.workers).toHaveLength(1);
    expect(fake.workers[0].pages).toHaveLength(3);
    await engine.close();
  });

  it('fails plainly when the library says start-up failed, and ends the worker it had started (the library never answers then)', async () => {
    const made: { terminated: number }[] = [];
    class StubWorker {
      terminated = 0;
      constructor() {
        made.push(this);
      }
      addEventListener() {}
      terminate() {
        this.terminated += 1;
      }
    }
    vi.stubGlobal('Worker', StubWorker);
    const fake = fakeLibrary({ start: 'never' });
    // The library makes its worker inside createWorker, before it first waits: stand in for that.
    const create = fake.library.createWorker;
    fake.library.createWorker = (lang, oem, options) => {
      new (globalThis as unknown as { Worker: new (url: string) => unknown }).Worker(options.workerPath);
      return create(lang, oem, options);
    };
    const engine = engineOf(fake);
    const starting = engine.start();
    await tick();
    fake.workers[0].options.errorHandler('TypeError: Failed to fetch');
    await expect(starting).rejects.toBeInstanceOf(OcrEngineFailed);
    expect(made).toHaveLength(1);
    expect(made[0].terminated).toBe(1);
    // The global is put back the moment the worker is made.
    expect((globalThis as unknown as { Worker: unknown }).Worker).toBe(StubWorker);
    await engine.close();
  });

  it('gives up a start that does not answer within its time limit', async () => {
    const fake = fakeLibrary({ start: 'never' });
    const engine = engineOf(fake, { startLimitMs: 20 });
    await expect(engine.start()).rejects.toBeInstanceOf(OcrEngineFailed);
    await engine.close();
  });

  it('fails when the library cannot be loaded or refuses to start, and may be tried again', async () => {
    const refusing = fakeLibrary({ start: 'reject' });
    await expect(engineOf(refusing).start()).rejects.toBeInstanceOf(OcrEngineFailed);
    const fake = fakeLibrary();
    let first = true;
    const engine = createOcrEngine({
      baseUrl: BASE,
      load: async () => {
        if (first) {
          first = false;
          throw new Error('chunk missing');
        }
        return fake.library;
      },
    });
    await expect(engine.start()).rejects.toBeInstanceOf(OcrEngineFailed);
    await engine.start();
    expect(fake.workers).toHaveLength(1);
    await engine.close();
  });

  it('ends a worker whose start finishes after Stop', async () => {
    const fake = fakeLibrary();
    const engine = engineOf(fake);
    const controller = new AbortController();
    const starting = engine.start({ signal: controller.signal });
    controller.abort();
    await expect(starting).rejects.toBeInstanceOf(OcrStopped);
    await tick();
    await tick();
    expect(fake.workers.every((w) => w.terminated >= 1)).toBe(true);
    await engine.close();
  });
});

describe('recognising a page', () => {
  it('hands the picture over with straightening on, and maps blocks, paragraphs, lines and words in reading order', async () => {
    const fake = fakeLibrary();
    const engine = engineOf(fake);
    const picture = pngOf(2480, 3508);
    const reading = engine.recognise(picture, { timeoutMs: 1000 });
    await tick();
    await tick();
    const [worker] = fake.workers;
    expect(worker.pages).toHaveLength(1);
    expect(worker.pages[0].image).toBe(picture);
    expect(worker.pages[0].options).toEqual({ rotateAuto: true });
    // `debug` has the engine keep its own notes ("Detected 12 diacritics") with the page's result, which is not read, instead of
    // writing them to the console as errors.
    expect(worker.pages[0].output).toEqual({ text: true, blocks: true, debug: true });
    worker.answer();
    const page = await reading;
    expect(page.words.map((w) => w.text)).toEqual(['Nirvexa', 'Traders', 'Amount', '|', '1,23,456.78']);
    expect(page.words[1]).toEqual({ text: 'Traders', x0: 320, y0: 104, x1: 520, y1: 150, confidence: 71, line: { y0: 100, y1: 150, baseline: 140, index: 0, size: 48 } });
    // Each word carries its line's number, and the text size measured on the line: here both words stand 36 px above the baseline.
    // The sloping line's baseline is taken under each word's centre: x 200 gives 341, x 900 gives 348.
    expect(page.words[2].line).toEqual({ y0: 300, y1: 350, baseline: 341, index: 1, size: expect.closeTo(37 / 0.75, 6) });
    expect(page.words[4].line).toEqual({ y0: 300, y1: 350, baseline: 348, index: 1, size: expect.closeTo(37 / 0.75, 6) });
    expect(page.angle).toBe(-0.0349);
    expect(page.widthPx).toBe(2480);
    expect(page.heightPx).toBe(3508);
    expect(page.seconds).toBeGreaterThanOrEqual(0);
    await engine.close();
  });

  it('reports no turn when the engine did not straighten, and no words for a blank page', async () => {
    const fake = fakeLibrary();
    const engine = engineOf(fake);
    const reading = engine.recognise(pngOf(100, 200), { timeoutMs: 1000 });
    await tick();
    await tick();
    fake.workers[0].answer({ blocks: null, rotateRadians: null });
    expect(await reading).toMatchObject({ words: [], angle: 0, widthPx: 100, heightPx: 200 });
    await engine.close();
  });

  it('uses the word own box when the line gives no usable box or baseline', async () => {
    const fake = fakeLibrary();
    const engine = engineOf(fake);
    const reading = engine.recognise(pngOf(100, 200), { timeoutMs: 1000 });
    await tick();
    await tick();
    fake.workers[0].answer({
      rotateRadians: 0,
      blocks: [{ paragraphs: [{ lines: [{ bbox: box(0, 0, 0, 0), baseline: box(0, 0, 0, 0), words: [word('Freight', box(10, 20, 60, 40))] }, { bbox: box(10, 50, 90, 70), baseline: box(40, 66, 40, 66), words: [word('paid', box(10, 52, 40, 68))] }] }] }],
    });
    const page = await reading;
    expect(page.words[0].line).toBeUndefined();
    // A baseline with no length: the word's own bottom stands in.
    expect(page.words[1].line).toEqual({ y0: 50, y1: 70, baseline: 68, index: 1, size: expect.closeTo(16 / 0.75, 6) });
    await engine.close();
  });

  it('tells the engine when a very large page had to be drawn at a lower resolution', async () => {
    const fake = fakeLibrary({ recognise: 'at-once' });
    const engine = engineOf(fake);
    await engine.recognise(pngOf(8192, 4000), { timeoutMs: 1000, dpi: 180 });
    await engine.recognise(pngOf(2480, 3508), { timeoutMs: 1000 });
    expect(fake.workers[0].parameters.map((p) => p.user_defined_dpi)).toEqual(['300', '180', '300']);
    await engine.close();
  });

  it('passes on how far through the page the engine is', async () => {
    const fake = fakeLibrary();
    const engine = engineOf(fake);
    const seen: number[] = [];
    const reading = engine.recognise(pngOf(100, 200), { timeoutMs: 1000, onProgress: (share) => seen.push(share) });
    await tick();
    await tick();
    const { logger } = fake.workers[0].options;
    logger({ status: 'recognizing text', progress: 0.25 });
    logger({ status: 'loading language traineddata', progress: 1 });
    logger({ status: 'recognizing text', progress: 0.75 });
    fake.workers[0].answer();
    await reading;
    logger({ status: 'recognizing text', progress: 0.9 }); // after the page: not passed on
    expect(seen).toEqual([0.25, 0.75]);
    await engine.close();
  });

  it('encodes pixels as a PNG before handing them over', async () => {
    const fake = fakeLibrary({ recognise: 'at-once' });
    const encoded = pngOf(40, 30);
    const encodePng = vi.fn(async () => encoded);
    const engine = engineOf(fake, { encodePng });
    const pixels = { width: 40, height: 30, data: new Uint8ClampedArray(40 * 30 * 4) } as unknown as ImageData;
    const page = await engine.recognise(pixels, { timeoutMs: 1000 });
    expect(encodePng).toHaveBeenCalledWith(pixels);
    expect(fake.workers[0].pages[0].image).toBe(encoded);
    expect([page.widthPx, page.heightPx]).toEqual([40, 30]);
    await engine.close();
  });

  it('refuses a picture whose size cannot be read', async () => {
    const fake = fakeLibrary();
    const engine = engineOf(fake);
    await expect(engine.recognise(new Uint8Array([1, 2, 3]), { timeoutMs: 1000 })).rejects.toBeInstanceOf(OcrEngineFailed);
    expect(fake.workers.flatMap((w) => w.pages)).toHaveLength(0);
    await engine.close();
  });
});

describe('the text size of a line', () => {
  it('is the smaller of what the engine row height and the confident words above the baseline say', () => {
    // Row height is 0.96 of the font size, the height above the baseline 0.75 of it (medians of 1,179 measured lines).
    expect(lineTextSize(38, [30, 30, 22, 31])).toBeCloseTo(38 / 0.96, 6); // the words say 40
    expect(lineTextSize(40, [29, 29, 30])).toBeCloseTo(29 / 0.75, 6); // the row says 41.7
  });

  it('is not swollen by a row height that took in the neighbouring line, nor by words joined to a mark above them', () => {
    expect(lineTextSize(95, [30, 29, 31])).toBeCloseTo(40, 6);
    expect(lineTextSize(38, [69, 70, 30])).toBeCloseTo(38 / 0.96, 6);
  });

  it('uses whichever measure there is, and none when there is none', () => {
    expect(lineTextSize(undefined, [30])).toBeCloseTo(40, 6);
    expect(lineTextSize(48, [])).toBeCloseTo(50, 6);
    expect(lineTextSize(0, [0, -4, Number.NaN])).toBeUndefined();
    expect(lineTextSize(null, [])).toBeUndefined();
  });

  it('is measured on the confident words of the line, never on ruling marks; on every word when none is confident', () => {
    const line = (rowHeight: number | undefined, words: ReturnType<typeof word>[]) => ({
      bbox: box(100, 380, 2000, 480), // swollen: the line box is 100 px tall
      baseline: box(100, 440, 2000, 440),
      ...(rowHeight === undefined ? {} : { rowAttributes: { rowHeight, ascenders: 9, descenders: 8 } }),
      words,
    });
    const sizes = (data: EngineData) => pageFromEngine(data, { width: 2480, height: 3508 }, 1).words.map((w) => w.line?.size);
    const page = (...lines: ReturnType<typeof line>[]): EngineData => ({ rotateRadians: 0, blocks: [{ paragraphs: [{ lines }] }] });
    // Two confident words 30 px above the baseline, a nonsense word 70 px above it (it took in a mark of the line above), a ruled line.
    const mixed = line(undefined, [word('Halvick', box(100, 410, 300, 440)), word('zqk', box(320, 370, 400, 440), 12), word('|', box(410, 380, 414, 480), 90), word('Castings', box(430, 410, 700, 448))]);
    expect(sizes(page(mixed))).toEqual([40, 40, 40, 40]);
    // The engine's row height, when it is the smaller.
    expect(sizes(page(line(36, mixed.words)))[0]).toBeCloseTo(36 / 0.96, 6);
    // No confident word: every word is measured.
    expect(sizes(page(line(undefined, [word('vuh', box(100, 410, 200, 440), 20), word('ivo', box(220, 404, 300, 440), 31), word('Plo', box(320, 410, 400, 440), 44)])))[0]).toBeCloseTo(40, 6);
  });
});

describe('a word that does not stand on its line', () => {
  // On a ruled page scanned askew the engine can give two rows as one line, with one baseline: half the words
  // then hang below it. Such a word is placed on its own bottom, and the line's text is measured from there.
  const twoRows: EngineData = {
    rotateRadians: 0,
    blocks: [
      {
        paragraphs: [
          {
            lines: [
              {
                bbox: box(100, 400, 2000, 500),
                baseline: box(100, 440, 2000, 440),
                words: [word('Opening', box(100, 410, 300, 440)), word('-', box(304, 424, 316, 428)), word('carry', box(320, 418, 480, 448)), word('balance', box(500, 455, 700, 486)), word('4,52,310.00', box(720, 456, 1000, 486)), word('Dr', box(1020, 456, 1070, 486))],
              },
            ],
          },
        ],
      },
    ],
  };

  it('is given its own bottom as baseline when the line baseline misses its box, and keeps the line baseline when it has a descender', () => {
    const page = pageFromEngine(twoRows, { width: 2480, height: 3508 }, 1);
    // A hyphen floats above the baseline by nature: only words with a letter or a digit are moved.
    expect(page.words.map((w) => w.line?.baseline)).toEqual([440, 440, 440, 486, 486, 486]);
    // All six still belong to the engine's one line.
    expect(page.words.map((w) => w.line?.index)).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it('measures the text from where each word stands: 30 px above the baseline, not 46 px below it', () => {
    const page = pageFromEngine(twoRows, { width: 2480, height: 3508 }, 1);
    // Heights above the baseline: 30, 22, 31, 30, 30 (the hyphen is not measured); the middle one is 30.
    expect(page.words[0].line?.size).toBeCloseTo(30 / 0.75, 6);
  });
});

describe('the per-page time limit', () => {
  it('ends the worker, says the page ran out of time, and reads the next page with a fresh worker', async () => {
    const fake = fakeLibrary();
    const engine = engineOf(fake);
    const slow = engine.recognise(pngOf(2480, 3508), { timeoutMs: 30 });
    const error = await slow.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(OcrPageTimedOut);
    expect((error as OcrPageTimedOut).limitMs).toBe(30);
    expect(fake.workers[0].terminated).toBe(1);

    const next = engine.recognise(pngOf(2480, 3508), { timeoutMs: 1000 });
    await tick();
    await tick();
    expect(fake.workers).toHaveLength(2);
    expect(fake.workers[1].parameters).toEqual([{ tessedit_pageseg_mode: '3', thresholding_method: '2', user_defined_dpi: '300' }]);
    expect(fake.workers[1].pages).toHaveLength(1);
    fake.workers[1].answer();
    expect((await next).words).toHaveLength(5);
    // The first page's answer arriving late changes nothing.
    fake.workers[0].answer();
    expect(fake.workers[1].terminated).toBe(0);
    await engine.close();
    expect(fake.workers[1].terminated).toBe(1);
  });
});

describe('Stop', () => {
  it('ends the worker at once, without waiting for the page, and says it was stopped', async () => {
    const fake = fakeLibrary();
    const engine = engineOf(fake);
    const controller = new AbortController();
    const reading = engine.recognise(pngOf(2480, 3508), { timeoutMs: 60_000, signal: controller.signal });
    await tick();
    await tick();
    expect(fake.workers[0].pages).toHaveLength(1);
    controller.abort();
    await expect(reading).rejects.toBeInstanceOf(OcrStopped);
    expect(fake.workers[0].terminated).toBe(1);
    // No fresh worker is started after a Stop.
    await tick();
    expect(fake.workers).toHaveLength(1);
    await engine.close();
  });

  it('does nothing at all when Stop was pressed before the page', async () => {
    const fake = fakeLibrary();
    const engine = engineOf(fake);
    await engine.start();
    const controller = new AbortController();
    controller.abort();
    await expect(engine.recognise(pngOf(100, 100), { timeoutMs: 1000, signal: controller.signal })).rejects.toBeInstanceOf(OcrStopped);
    expect(fake.workers[0].pages).toHaveLength(0);
    await engine.close();
  });
});

describe('failures and the end', () => {
  it('says the engine failed when a page is rejected, and ends that worker', async () => {
    const fake = fakeLibrary();
    const engine = engineOf(fake);
    const reading = engine.recognise(pngOf(100, 100), { timeoutMs: 1000 });
    await tick();
    await tick();
    fake.workers[0].fail('RuntimeError: memory access out of bounds');
    await expect(reading).rejects.toBeInstanceOf(OcrEngineFailed);
    expect(fake.workers[0].terminated).toBe(1);
    await engine.close();
  });

  it('close ends the worker, is safe to call twice, and ends a page in progress as stopped', async () => {
    const fake = fakeLibrary();
    const engine = engineOf(fake);
    const reading = engine.recognise(pngOf(100, 100), { timeoutMs: 60_000 });
    await tick();
    await tick();
    await engine.close();
    await engine.close();
    await expect(reading).rejects.toBeInstanceOf(OcrStopped);
    expect(fake.workers[0].terminated).toBe(1);
    await expect(engine.recognise(pngOf(100, 100), { timeoutMs: 1000 })).rejects.toBeInstanceOf(OcrEngineFailed);
    expect(fake.workers).toHaveLength(1);
  });

  it('never lets an error of the library escape as its own text', async () => {
    const fake = fakeLibrary({ start: 'reject' });
    const error = await engineOf(fake).start().catch((e: unknown) => e);
    expect((error as Error).message).not.toMatch(/no engine file/);
  });
});
