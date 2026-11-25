import { describe, expect, it, vi } from 'vitest';
import { createWorkingListStore } from '@/lib/pdf-tools/workingList';
import { PdfToolsError, type WorkingFile } from '@/lib/pdf-tools/types';
import type { IntakeResult, IntakeSource } from './intake';
import { IntakeRunner, type FileLike, type IntakeEnvironment } from './intakeRunner';

const file = (name: string, size = 10): FileLike => ({ name, size, arrayBuffer: async () => new ArrayBuffer(size) });

/**
 * Waits until `ready()` holds, checking after every timer turn (by then every pending promise step has run),
 * instead of a fixed sleep (INT3: WRAP's list of load-sensitive waits). The bound is a hang guard only.
 */
async function until(ready: () => boolean, what: string): Promise<void> {
  for (let turn = 0; turn < 10_000; turn++) {
    if (ready()) return;
    await new Promise((r) => setTimeout(r, 0));
  }
  throw new Error(`never reached: ${what}`);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const ready = (source: IntakeSource): IntakeResult => ({
  status: 'ready',
  file: {
    id: source.name,
    name: source.name,
    kind: 'pdf',
    mimeType: 'application/pdf',
    origin: source.origin,
    bytes: source.bytes,
    size: source.bytes.byteLength,
    pageCount: 1,
    wasProtected: false,
    hasRestrictions: false,
    hasSignature: false,
    sentTo: [],
  } as WorkingFile,
});

function setup(prepare?: IntakeEnvironment['prepare'], limits = { maxBytes: 1000, warnBytes: 800 }) {
  const store = createWorkingListStore(limits);
  store.setContext('u1:A');
  const report = {
    notAdded: vi.fn(),
    notice: vi.fn(),
    listLarge: vi.fn(),
    finished: vi.fn(),
    stoppedOnLeave: vi.fn(),
  };
  const env: IntakeEnvironment = {
    store,
    prepare: prepare ?? (async (source) => ready(source)),
    askPassword: async () => null,
    cancelPassword: vi.fn(),
    nextPaint: async () => undefined,
    onProgress: vi.fn(),
    report,
    ...limits,
  };
  const runner = new IntakeRunner(env);
  const idle = () => new Promise<void>((resolve) => {
    const poll = () => (runner.running ? setTimeout(poll, 1) : resolve());
    poll();
  });
  return { store, report, env, runner, idle, names: () => store.getState().files.map((f) => f.name) };
}

describe('IntakeRunner', () => {
  it('adds files in order and announces a summary at the end', async () => {
    const { runner, idle, names, report } = setup();
    runner.enqueue([file('a.pdf'), file('b.pdf')]);
    await idle();
    expect(names()).toEqual(['a.pdf', 'b.pdf']);
    expect(report.finished).toHaveBeenCalledWith({ added: 2, notAdded: 0 });
  });

  it('keeps the order of files added while a run is going', async () => {
    const gate = deferred<void>();
    const { runner, idle, names } = setup(async (source) => {
      if (source.name === 'a.pdf') await gate.promise;
      return ready(source);
    });
    runner.enqueue([file('a.pdf')]);
    runner.enqueue([file('b.pdf'), file('c.pdf')]);
    gate.resolve();
    await idle();
    expect(names()).toEqual(['a.pdf', 'b.pdf', 'c.pdf']);
  });

  it('goes on after one file fails, and names it', async () => {
    const { runner, idle, names, report } = setup(async (source) => {
      if (source.name === 'b.pdf') throw new PdfToolsError('not-a-pdf', 'This file is not a PDF.');
      return ready(source);
    });
    runner.enqueue([file('a.pdf'), file('b.pdf'), file('c.pdf')]);
    await idle();
    expect(names()).toEqual(['a.pdf', 'c.pdf']);
    expect(report.notAdded).toHaveBeenCalledWith('b.pdf', 'This file is not a PDF.');
    expect(report.finished).toHaveBeenCalledWith({ added: 2, notAdded: 1 });
  });

  it('adds nothing and stays silent when the engagement changes during a file', async () => {
    const gate = deferred<void>();
    const preparing: string[] = [];
    const { runner, idle, store, report } = setup(async (source) => {
      preparing.push(source.name);
      await gate.promise;
      return ready(source);
    });
    runner.enqueue([file('a.pdf'), file('b.pdf')]);
    await until(() => preparing.includes('a.pdf'), 'a.pdf being prepared');
    store.setContext('u1:B');
    gate.resolve();
    await idle();
    expect(store.getState().files).toEqual([]);
    expect(report.notAdded).not.toHaveBeenCalled();
    expect(report.finished).not.toHaveBeenCalled();
    expect(report.stoppedOnLeave).not.toHaveBeenCalled();
  });

  it('is silent when the list refuses a file because its session moved on', async () => {
    const gate = deferred<void>();
    const preparing: string[] = [];
    const { runner, idle, store, report } = setup(async (source) => {
      preparing.push(source.name);
      await gate.promise;
      return ready(source);
    });
    runner.enqueue([file('a.pdf')]);
    await until(() => preparing.includes('a.pdf'), 'a.pdf being prepared');
    store.setContext(null);
    store.setContext('u1:A'); // same engagement again, but a new session
    gate.resolve();
    await idle();
    expect(store.getState().files).toEqual([]);
    expect(report.notAdded).not.toHaveBeenCalled();
    expect(report.finished).not.toHaveBeenCalled();
  });

  it('reports how many files were not added when the screen is left', async () => {
    const gate = deferred<void>();
    const preparing: string[] = [];
    const { runner, idle, store, report, env } = setup(async (source) => {
      preparing.push(source.name);
      await gate.promise;
      return ready(source);
    });
    runner.enqueue([file('a.pdf'), file('b.pdf'), file('c.pdf')]);
    await until(() => preparing.includes('a.pdf'), 'a.pdf being prepared');
    runner.abandon('left-screen');
    expect(report.stoppedOnLeave).toHaveBeenCalledWith(3);
    expect(env.cancelPassword).toHaveBeenCalled();
    gate.resolve();
    await idle();
    expect(store.getState().files).toEqual([]);
  });

  it("never names a file of the old engagement when it changes while the screen paints", async () => {
    const paint = deferred<void>();
    const { runner, idle, store, report, env } = setup(undefined, { maxBytes: 100, warnBytes: 80 });
    let painting = false;
    env.nextPaint = () => {
      painting = true;
      return paint.promise;
    };
    runner.enqueue([file('A secret.pdf', 101)]); // too large: would be reported as not added
    await until(() => painting, 'the run waiting for the screen to paint');
    store.setContext('u1:B');
    paint.resolve();
    await idle();
    expect(report.notAdded).not.toHaveBeenCalled();
    expect(report.finished).not.toHaveBeenCalled();
  });

  it('keeps each run to its own current file, so an old run finishing cannot hide a new one', async () => {
    const firstPaint = deferred<void>();
    const gate = deferred<void>();
    let oldWoke = false;
    const paints = [firstPaint.promise.then(() => void (oldWoke = true))];
    let paintsAsked = 0;
    const preparing: string[] = [];
    const { runner, report, env } = setup(
      async (source) => {
        preparing.push(source.name);
        await gate.promise;
        return ready(source);
      },
      { maxBytes: 100, warnBytes: 80 },
    );
    env.nextPaint = () => {
      paintsAsked += 1;
      return paints.shift() ?? Promise.resolve();
    };
    runner.enqueue([file('old.pdf', 101)]); // refused for its size without another await
    await until(() => paintsAsked === 1, 'the old run waiting for its paint');
    runner.abandon('context-changed'); // the old run is waiting for its paint
    runner.enqueue([file('new.pdf')]); // a new run starts and waits in prepare
    await until(() => preparing.includes('new.pdf'), 'the new run waiting in prepare');
    firstPaint.resolve(); // the old run wakes up after the new one has started
    await until(() => oldWoke, 'the old run waking up');
    await new Promise((r) => setTimeout(r, 0)); // and running on to its end (promise steps only)
    runner.abandon('left-screen');
    expect(report.stoppedOnLeave).toHaveBeenCalledWith(1); // new.pdf is still counted
    gate.resolve();
  });

  it('does not report leaving when nothing was waiting', () => {
    const { runner, report } = setup();
    runner.abandon('left-screen');
    expect(report.stoppedOnLeave).not.toHaveBeenCalled();
  });

  it('adds an Evidence Vault file with its origin and evidence id, reading it only when its turn comes', async () => {
    const order: string[] = [];
    const prepared: IntakeSource[] = [];
    const { runner, idle, store } = setup(async (source) => {
      prepared.push(source);
      order.push(`prepare ${source.name}`);
      return ready(source);
    });
    const vault: FileLike = {
      name: 'Bank statement.pdf',
      size: 4,
      origin: 'vault',
      evidenceId: 'ev-7',
      arrayBuffer: async () => {
        order.push('read vault');
        return new Uint8Array([1, 2, 3, 4]).buffer;
      },
    };
    runner.enqueue([file('a.pdf'), vault]);
    await idle();
    expect(order).toEqual(['prepare a.pdf', 'read vault', 'prepare Bank statement.pdf']);
    expect(prepared[0]).toMatchObject({ origin: 'computer' });
    expect(prepared[0]).not.toHaveProperty('evidenceId');
    expect(prepared[1]).toMatchObject({ name: 'Bank statement.pdf', origin: 'vault', evidenceId: 'ev-7' });
    expect(Array.from(prepared[1].bytes)).toEqual([1, 2, 3, 4]);
    expect(store.getState().files.map((f) => [f.name, f.origin])).toEqual([
      ['a.pdf', 'computer'],
      ['Bank statement.pdf', 'vault'],
    ]);
  });

  it('names a vault file that cannot be read and still adds the others', async () => {
    const { runner, idle, names, report } = setup();
    const missing: FileLike = {
      name: 'Gone.pdf',
      size: 10,
      origin: 'vault',
      evidenceId: 'ev-1',
      arrayBuffer: async () => {
        throw new PdfToolsError('vault-missing', 'This file is missing from the Evidence Vault folder on this computer.');
      },
    };
    runner.enqueue([missing, file('b.pdf')]);
    await idle();
    expect(names()).toEqual(['b.pdf']);
    expect(report.notAdded).toHaveBeenCalledWith('Gone.pdf', 'This file is missing from the Evidence Vault folder on this computer.');
    expect(report.finished).toHaveBeenCalledWith({ added: 1, notAdded: 1 });
  });

  it('refuses a vault file by its recorded size before reading it', async () => {
    const read = vi.fn(async () => new ArrayBuffer(10));
    const { runner, idle, report } = setup(undefined, { maxBytes: 100, warnBytes: 80 });
    runner.enqueue([{ name: 'Huge scan.pdf', size: 500, origin: 'vault', evidenceId: 'ev-2', arrayBuffer: read }]);
    await idle();
    expect(read).not.toHaveBeenCalled();
    expect(report.notAdded.mock.calls[0][1]).toMatch(/^This file is larger than/);
  });

  it('refuses a vault file by its real length when its recorded size was wrong, before anything reads its content', async () => {
    // A row with no recorded size counts as 0; a file replaced outside VERA can be far larger than its record.
    const prepare = vi.fn(async (source: IntakeSource) => ready(source));
    const { runner, idle, report, names } = setup(prepare, { maxBytes: 1000, warnBytes: 800 });
    const wrongRecord = (name: string, size: number, real: number): FileLike => ({ name, size, origin: 'vault', evidenceId: name, arrayBuffer: async () => new ArrayBuffer(real) });
    runner.enqueue([wrongRecord('Scan recorded small.pdf', 10, 50_000), wrongRecord('Scan with no size.pdf', 0, 50_000), file('b.pdf')]);
    await idle();
    expect(prepare.mock.calls.map(([source]) => source.name)).toEqual(['b.pdf']);
    expect(report.notAdded.mock.calls).toEqual([
      ['Scan recorded small.pdf', 'This file is larger than 1000 B, the most PDF Tools can hold at once.'],
      ['Scan with no size.pdf', 'This file is larger than 1000 B, the most PDF Tools can hold at once.'],
    ]);
    expect(names()).toEqual(['b.pdf']);
    expect(report.finished).toHaveBeenCalledWith({ added: 1, notAdded: 2 });
  });

  it('refuses a vault file by its real length when the list would go over the limit, before anything reads its content', async () => {
    const prepare = vi.fn(async (source: IntakeSource) => ready(source));
    const { runner, idle, report, names } = setup(prepare, { maxBytes: 100, warnBytes: 80 });
    runner.enqueue([file('a.pdf', 60), { name: 'Statement.pdf', size: 0, origin: 'vault', evidenceId: 'ev-3', arrayBuffer: async () => new ArrayBuffer(60) }]);
    await idle();
    expect(prepare.mock.calls.map(([source]) => source.name)).toEqual(['a.pdf']);
    expect(report.notAdded).toHaveBeenCalledWith('Statement.pdf', expect.stringMatching(/^The files in the list would come to more than .*Remove some files first\.$/));
    expect(names()).toEqual(['a.pdf']);
  });

  it('says nothing of an oversized vault file when the list moved on while it was read', async () => {
    const prepare = vi.fn(async (source: IntakeSource) => ready(source));
    const { runner, idle, report, store } = setup(prepare, { maxBytes: 1000, warnBytes: 800 });
    runner.enqueue([
      {
        name: 'A secret scan.pdf',
        size: 10,
        origin: 'vault',
        evidenceId: 'ev-4',
        arrayBuffer: async () => {
          store.setContext('u1:B');
          return new ArrayBuffer(50_000);
        },
      },
    ]);
    await idle();
    expect(prepare).not.toHaveBeenCalled();
    expect(report.notAdded).not.toHaveBeenCalled();
    expect(report.finished).not.toHaveBeenCalled();
  });

  it('gives a file larger than the whole limit its own message', async () => {
    const { runner, idle, report } = setup(undefined, { maxBytes: 100, warnBytes: 80 });
    runner.enqueue([file('huge.pdf', 101)]);
    await idle();
    expect(report.notAdded.mock.calls[0][1]).toMatch(/^This file is larger than/);
  });

  it('asks to remove files when the list would go over the limit', async () => {
    const { runner, idle, report, names } = setup(undefined, { maxBytes: 100, warnBytes: 80 });
    runner.enqueue([file('a.pdf', 60), file('b.pdf', 60)]);
    await idle();
    expect(names()).toEqual(['a.pdf']);
    expect(report.notAdded.mock.calls[0][1]).toMatch(/Remove some files first/);
  });

  it('passes notices on and warns once when the list grows past the warning size', async () => {
    const { runner, idle, report } = setup(
      async (source) => ({ ...(ready(source) as Extract<IntakeResult, { status: 'ready' }>), notice: 'first-frame' }),
      { maxBytes: 100, warnBytes: 50 },
    );
    runner.enqueue([file('a.gif', 40), file('b.gif', 20), file('c.gif', 20)]);
    await idle();
    expect(report.notice).toHaveBeenCalledWith('a.gif', 'first-frame');
    expect(report.listLarge).toHaveBeenCalledTimes(1);
  });

  it('a TIFF conversion: its pauses say the page once each, and the result is added', async () => {
    const yields = vi.fn(async () => undefined);
    const { runner, idle, env, names } = setup(async (source, hooks) => {
      for (let page = 1; page <= 3; page++) for (let slice = 0; slice < 4; slice++) await hooks.pause!({ page, pages: 3 });
      return ready(source);
    });
    env.yieldNow = yields;
    runner.enqueue([file('statement.tif')]);
    await idle();
    const shown = vi.mocked(env.onProgress).mock.calls.map(([p]) => p?.current).filter((c) => c?.includes('page'));
    expect(shown).toEqual(['statement.tif (page 1 of 3)', 'statement.tif (page 2 of 3)', 'statement.tif (page 3 of 3)']);
    expect(yields).toHaveBeenCalledTimes(12);
    expect(names()).toEqual(['statement.tif']);
  });

  it('a TIFF conversion stops at the pause during which the list moved on, doing no more work', async () => {
    let workAfter = 0;
    const { runner, idle, env, store, names } = setup(async (source, hooks) => {
      await hooks.pause!({ page: 1, pages: 2 });
      workAfter += 1; // the rest of the conversion
      return ready(source);
    });
    env.yieldNow = async () => store.setContext('u1:B'); // another engagement while the screen had the turn
    runner.enqueue([file('statement.tif')]);
    await idle();
    expect(workAfter).toBe(0);
    expect(names()).toEqual([]);
  });

  it('a TIFF conversion stops at its next pause, silently, when the list moves on, and adds nothing', async () => {
    let reached = 0;
    const { runner, idle, report, names, store } = setup(async (source, hooks) => {
      for (let page = 1; page <= 5; page++) {
        await hooks.pause!({ page, pages: 5 });
        reached = page;
        if (page === 2) store.setContext('u1:B');
      }
      return ready(source);
    });
    runner.enqueue([file('statement.tif'), file('next.pdf')]);
    await idle();
    expect(reached).toBe(2);
    expect(names()).toEqual([]);
    expect(report.notAdded).not.toHaveBeenCalled();
    expect(report.finished).not.toHaveBeenCalled();
  });
});
