import { describe, expect, it, vi } from 'vitest';
import { createWorkingListStore } from '@/lib/pdf-tools/workingList';
import { PdfToolsError, type WorkingFile } from '@/lib/pdf-tools/types';
import type { IntakeResult, IntakeSource } from './intake';
import { IntakeRunner, type FileLike, type IntakeEnvironment } from './intakeRunner';

const file = (name: string, size = 10): FileLike => ({ name, size, arrayBuffer: async () => new ArrayBuffer(size) });

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
    const { runner, idle, store, report } = setup(async (source) => {
      await gate.promise;
      return ready(source);
    });
    runner.enqueue([file('a.pdf'), file('b.pdf')]);
    await new Promise((r) => setTimeout(r, 5));
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
    const { runner, idle, store, report } = setup(async (source) => {
      await gate.promise;
      return ready(source);
    });
    runner.enqueue([file('a.pdf')]);
    await new Promise((r) => setTimeout(r, 5));
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
    const { runner, idle, store, report, env } = setup(async (source) => {
      await gate.promise;
      return ready(source);
    });
    runner.enqueue([file('a.pdf'), file('b.pdf'), file('c.pdf')]);
    await new Promise((r) => setTimeout(r, 5));
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
    env.nextPaint = () => paint.promise;
    runner.enqueue([file('A secret.pdf', 101)]); // too large: would be reported as not added
    await new Promise((r) => setTimeout(r, 5));
    store.setContext('u1:B');
    paint.resolve();
    await idle();
    expect(report.notAdded).not.toHaveBeenCalled();
    expect(report.finished).not.toHaveBeenCalled();
  });

  it('keeps each run to its own current file, so an old run finishing cannot hide a new one', async () => {
    const firstPaint = deferred<void>();
    const gate = deferred<void>();
    const paints = [firstPaint.promise];
    const { runner, report, env } = setup(
      async (source) => {
        await gate.promise;
        return ready(source);
      },
      { maxBytes: 100, warnBytes: 80 },
    );
    env.nextPaint = () => paints.shift() ?? Promise.resolve();
    runner.enqueue([file('old.pdf', 101)]); // refused for its size without another await
    await new Promise((r) => setTimeout(r, 5));
    runner.abandon('context-changed'); // the old run is waiting for its paint
    runner.enqueue([file('new.pdf')]); // a new run starts and waits in prepare
    await new Promise((r) => setTimeout(r, 5));
    firstPaint.resolve(); // the old run wakes up after the new one has started
    await new Promise((r) => setTimeout(r, 5));
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
});
