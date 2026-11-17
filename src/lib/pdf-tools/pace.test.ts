import { PDFDocument, StandardFonts } from 'pdf-lib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PARSE_OBJECTS_PER_TICK } from './inspect';
import { isStop, loadPaced, pacer, runAtOnce, runPaced, savePaced, TURN_AFTER_MS, withClockWaits, type Work } from './pace';

vi.setConfig({ testTimeout: 120_000 });
afterEach(() => vi.restoreAllMocks());

async function ledger(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage([595, 842]);
    for (let line = 0; line < 5; line++) page.drawText(`Line ${i}-${line} 12,345.00`, { x: 40, y: 800 - line * 24, size: 10, font });
  }
  return doc.save();
}

describe('pacer', () => {
  it('gives no turn before TURN_AFTER_MS have passed, then one, and runs the check after it', async () => {
    let clock = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    const checks: number[] = [];
    const pace = pacer(() => void checks.push(clock));
    expect(pace()).toBeUndefined();
    clock += TURN_AFTER_MS - 1;
    expect(pace()).toBeUndefined();
    clock += 1;
    const turn = pace();
    expect(turn).toBeInstanceOf(Promise);
    await turn;
    expect(checks).toEqual([1000 + TURN_AFTER_MS]);
    expect(pace()).toBeUndefined(); // the clock starts again after the turn
  });

  it('a turn given by someone else (the run between pages) counts: turns are not doubled', async () => {
    let clock = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    const pace = pacer();
    expect(pace()).toBeUndefined(); // notes the next turn of the event loop
    clock = 60;
    await new Promise((resolve) => setTimeout(resolve, 0)); // the run's own yield
    expect(pace()).toBeUndefined();
    clock = 120;
    expect(pace()).toBeInstanceOf(Promise);
  });

  it('a Stop in the check is thrown from the turn', async () => {
    let clock = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    const pace = pacer(() => {
      throw new Error('stopped');
    });
    clock = 100;
    await expect(pace()).rejects.toThrow('stopped');
  });

  it('runs the same work paced and at once, with the same result', async () => {
    function* sum(n: number): Work<number> {
      let total = 0;
      for (let i = 1; i <= n; i++) {
        total += i;
        yield;
      }
      return total;
    }
    expect(runAtOnce(sum(1000))).toBe(500500);
    expect(await runPaced(sum(1000), pacer())).toBe(500500);
  });
});

describe('loadPaced and savePaced (REV-A B6)', () => {
  it('read and write exactly what pdf-lib reads and writes, with and without object streams', async () => {
    const bytes = await ledger(120);
    for (const useObjectStreams of [true, false]) {
      const plain = await PDFDocument.load(bytes, { updateMetadata: false, parseSpeed: PARSE_OBJECTS_PER_TICK });
      const paced = await loadPaced(bytes, { updateMetadata: false });
      expect(paced.getPageCount()).toBe(plain.getPageCount());
      expect(paced.context.enumerateIndirectObjects().length).toBe(plain.context.enumerateIndirectObjects().length);
      const a = await plain.save({ useObjectStreams, objectsPerTick: PARSE_OBJECTS_PER_TICK });
      const b = await savePaced(paced, { useObjectStreams });
      expect(Buffer.from(b).equals(Buffer.from(a)), `object streams ${useObjectStreams}`).toBe(true);
    }
  });

  it('adds a page to a document with none, as pdf-lib’s save does', async () => {
    const empty = await PDFDocument.create();
    const reference = await PDFDocument.create();
    const a = await reference.save({ objectsPerTick: PARSE_OBJECTS_PER_TICK });
    const b = await savePaced(empty);
    expect((await PDFDocument.load(b)).getPageCount()).toBe(1);
    expect(b.length).toBe(a.length);
  });

  it('refuses what pdf-lib refuses', async () => {
    await expect(loadPaced(new Uint8Array([1, 2, 3]))).rejects.toThrow();
  });

  it('after a wait the clock starts again: a busy machine does not make it wait after every object', async () => {
    const bytes = await ledger(150);
    const objects = (await PDFDocument.load(bytes)).context.enumerateIndirectObjects().length;
    const real = globalThis.setTimeout;
    let waits = 0;
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, ms?: number) => {
      waits++;
      return real(fn, ms);
    }) as typeof setTimeout);
    // everyMs 0: every question is "due"; the first question after a wait is always "no".
    await loadPaced(bytes, { updateMetadata: false }, 0);
    expect(waits).toBeGreaterThan(0);
    // Before the fix it waited once for every object read (about `objects` times); now at most every other one.
    expect(waits).toBeLessThanOrEqual(Math.ceil(objects * 0.6) + 5);
  });
});

// FIX-A2 follow-up (INT3 concern 1): a Stop pressed while pdf-lib is still reading the file lands within the read.
describe('loadPaced: the caller’s Stop check while the file is read', () => {
  class Stopped extends Error {}

  it('runs the check after each wait; what it throws ends the load and is thrown as it is, marked as a Stop', async () => {
    const bytes = await ledger(150);
    for (const at of [1, 2, 3, 5, 8]) {
      // Stops at the at-th check: some fall while an object stream is read (pdf-lib catches errors there).
      let calls = 0;
      const stop = new Stopped(`stop at ${at}`);
      const error = await loadPaced(bytes, { updateMetadata: false, check: () => { if (++calls === at) throw stop; } }, 0).catch((e: unknown) => e);
      expect(error, `at ${at}`).toBe(stop);
      expect(isStop(error)).toBe(true);
      expect(calls, `no check after the Stop (at ${at})`).toBe(at);
    }
  });

  it('a check that never throws changes nothing: the same document, the same bytes', async () => {
    const bytes = await ledger(150);
    let calls = 0;
    const checked = await loadPaced(bytes, { updateMetadata: false, check: () => void calls++ }, 0);
    const plain = await loadPaced(bytes, { updateMetadata: false });
    expect(calls).toBeGreaterThan(10);
    expect(Buffer.from(await savePaced(checked)).equals(Buffer.from(await savePaced(plain)))).toBe(true);
  });

  it('a file that cannot be read is not a Stop; neither is an error thrown without a check', async () => {
    const error = await loadPaced(new Uint8Array([1, 2, 3]), { check: () => undefined }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(isStop(error)).toBe(false);
    expect(isStop(new Stopped('elsewhere'))).toBe(false);
    expect(isStop('a string')).toBe(false);
  });
});

// INT3: Protect and unlock use the second library (@cantoo/pdf-lib), whose load with a password and save
// rules cannot be rebuilt from outside; its own calls run with their waits taken by the clock.
describe('withClockWaits (the second library, INT3)', () => {
  const countWaits = () => {
    const real = globalThis.setTimeout;
    const seen = { waits: 0 };
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, ms?: number) => {
      seen.waits++;
      return real(fn, ms);
    }) as typeof setTimeout);
    return seen;
  };

  it('loads (with and without a password) and saves exactly what the library itself does', async () => {
    const lib = await import('@cantoo/pdf-lib');
    const bytes = await ledger(80);
    const own = await lib.PDFDocument.load(bytes, { updateMetadata: false, parseSpeed: PARSE_OBJECTS_PER_TICK });
    const paced = await withClockWaits(lib, bytes, () => lib.PDFDocument.load(bytes, { updateMetadata: false, parseSpeed: PARSE_OBJECTS_PER_TICK }));
    expect(paced.context.enumerateIndirectObjects().length).toBe(own.context.enumerateIndirectObjects().length);
    for (const useObjectStreams of [true, false]) {
      const a = await own.save({ useObjectStreams, objectsPerTick: PARSE_OBJECTS_PER_TICK });
      const b = await withClockWaits(lib, paced.context, () => paced.save({ useObjectStreams, objectsPerTick: PARSE_OBJECTS_PER_TICK }));
      expect(Buffer.from(b).equals(Buffer.from(a)), `object streams ${useObjectStreams}`).toBe(true);
    }
    const locking = await lib.PDFDocument.load(bytes, { updateMetadata: false });
    locking.encrypt({ userPassword: 'Invented-Pace-Pw-1', algorithm: 'AES-256' });
    const locked = await locking.save();
    const opened = await lib.PDFDocument.load(locked, { password: 'Invented-Pace-Pw-1', updateMetadata: false, parseSpeed: 1 });
    const openedPaced = await withClockWaits(lib, locked, () => lib.PDFDocument.load(locked, { password: 'Invented-Pace-Pw-1', updateMetadata: false, parseSpeed: 1 }), { keepCount: true });
    const plainA = await opened.save({ objectsPerTick: PARSE_OBJECTS_PER_TICK });
    const plainB = await withClockWaits(lib, openedPaced.context, () => openedPaced.save({ objectsPerTick: PARSE_OBJECTS_PER_TICK }));
    expect(Buffer.from(plainB).equals(Buffer.from(plainA))).toBe(true);
  });

  it('waits by the clock, not by the count: no waits while the clock stands still, waits once it runs', async () => {
    const lib = await import('@cantoo/pdf-lib');
    const bytes = await ledger(80);
    vi.spyOn(performance, 'now').mockReturnValue(5000);
    let seen = countWaits();
    // A count of 1 would wait after every object; with the clock standing still the call waits not at all.
    await withClockWaits(lib, bytes, () => lib.PDFDocument.load(bytes, { updateMetadata: false, parseSpeed: 1 }));
    expect(seen.waits).toBe(0);
    vi.restoreAllMocks();
    seen = countWaits();
    await withClockWaits(lib, bytes, () => lib.PDFDocument.load(bytes, { updateMetadata: false, parseSpeed: 100_000 }), { everyMs: 0 });
    expect(seen.waits).toBeGreaterThan(0); // every question due: about every other object waits
  });

  it('keepCount: the caller’s own count still makes it wait, besides the clock', async () => {
    const lib = await import('@cantoo/pdf-lib');
    const bytes = await ledger(40);
    const objects = (await lib.PDFDocument.load(bytes)).context.enumerateIndirectObjects().length;
    vi.spyOn(performance, 'now').mockReturnValue(5000);
    const seen = countWaits();
    await withClockWaits(lib, bytes, () => lib.PDFDocument.load(bytes, { updateMetadata: false, parseSpeed: 10 }), { keepCount: true });
    expect(seen.waits).toBeGreaterThanOrEqual(Math.floor(objects / 10) - 1);
  });

  it('leaves alone what the library makes for any other call, during the call and after it', async () => {
    const lib = await import('@cantoo/pdf-lib');
    const bytes = await ledger(40);
    const other = await ledger(41);
    vi.spyOn(performance, 'now').mockReturnValue(5000);
    const seen = countWaits();
    // During a paced call, another load (other bytes) keeps its own count of 10 objects a slice.
    let otherWaits = 0;
    await withClockWaits(lib, bytes, async () => {
      const before = seen.waits;
      await lib.PDFDocument.load(other, { updateMetadata: false, parseSpeed: 10 });
      otherWaits = seen.waits - before;
      return lib.PDFDocument.load(bytes, { updateMetadata: false, parseSpeed: 10 });
    });
    expect(otherWaits).toBeGreaterThan(5);
    // After the call, the same bytes wait by their own count again.
    const after = seen.waits;
    await lib.PDFDocument.load(bytes, { updateMetadata: false, parseSpeed: 10 });
    expect(seen.waits - after).toBeGreaterThan(5);
  });
});
