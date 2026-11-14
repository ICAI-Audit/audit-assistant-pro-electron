import { describe, expect, it } from 'vitest';
import { FOLDER_NOT_CHOSEN, planSaveResult, renamedNames, SAVE_WINDOW_OPEN, watchSave, type SaveReport } from './savePlan';

const files = [
  { id: 'a', intendedName: 'Bank.pdf', wasProtected: false },
  { id: 'b', intendedName: 'Ledger.pdf', wasProtected: false },
  { id: 'c', intendedName: 'Notes.pdf', wasProtected: true },
];

const report = (over: Partial<SaveReport>): SaveReport => ({
  mode: 'folder',
  outcome: 'saved',
  files,
  written: [],
  sameSession: true,
  ...over,
});

describe('renamedNames', () => {
  it('lists only names that were numbered, compared with the cleaned names', () => {
    expect(renamedNames(['Bank.pdf', 'Ledger.pdf'], ['Bank (2).pdf', 'Ledger.pdf'])).toEqual(['Bank (2).pdf']);
  });

  it('ignores case, as Windows does', () => {
    expect(renamedNames(['bank.pdf'], ['Bank.pdf'])).toEqual([]);
  });

  it('does not count cleaning as renaming', () => {
    // The raw name was "Bank:final.PDF"; the intended name is already the cleaned one.
    expect(renamedNames(['Bank_final.pdf'], ['Bank_final.pdf'])).toEqual([]);
  });
});

describe('planSaveResult', () => {
  it('marks nothing and says nothing when a Save As or a zip save is cancelled', () => {
    expect(planSaveResult(report({ mode: 'one', outcome: 'cancelled' }))).toEqual({ markIds: [], toast: null });
    expect(planSaveResult(report({ mode: 'zip', outcome: 'cancelled' }))).toEqual({ markIds: [], toast: null });
  });

  it('a folder window that ends without a folder marks nothing; its quiet note comes from watchSave', () => {
    expect(planSaveResult(report({ outcome: 'cancelled' }))).toEqual({ markIds: [], toast: null });
    expect(FOLDER_NOT_CHOSEN).toMatchObject({ tone: 'info', title: 'Nothing was saved' });
    expect(FOLDER_NOT_CHOSEN.description).toMatch(/No folder was chosen/);
    expect(FOLDER_NOT_CHOSEN.description).toMatch(/choose another folder/);
  });

  it('a save window that is already open: a plain message, nothing marked, no file named', () => {
    for (const mode of ['one', 'folder', 'zip'] as const) {
      for (const sameSession of [true, false]) {
        expect(planSaveResult(report({ mode, outcome: 'busy', sameSession }))).toEqual({ markIds: [], toast: SAVE_WINDOW_OPEN });
      }
    }
    expect(SAVE_WINDOW_OPEN).toMatchObject({ tone: 'info', title: 'A save window is already open' });
    expect(SAVE_WINDOW_OPEN.description).toMatch(/Finish or close it/);
  });

  it('marks every file when a folder save completed', () => {
    const plan = planSaveResult(report({ written: ['Bank.pdf', 'Ledger (2).pdf', 'Notes.pdf'] }));
    expect(plan.markIds).toEqual(['a', 'b', 'c']);
    expect(plan.toast).toMatchObject({ tone: 'success', title: 'Saved 3 files' });
    expect(plan.toast!.description).toContain('"Ledger (2).pdf"');
    expect(plan.toast!.description).toContain('saved without a password');
  });

  it('names the one saved file', () => {
    const plan = planSaveResult(report({ mode: 'one', files: [files[0]], written: [] }));
    expect(plan).toEqual({ markIds: ['a'], toast: { tone: 'success', title: 'Saved to your computer', description: 'Bank.pdf' } });
  });

  it('marks every file of a download, as for a save: the fallback counts as sent', () => {
    const plan = planSaveResult(report({ outcome: 'downloaded', written: ['Bank.pdf', 'Ledger.pdf', 'Notes.pdf'] }));
    expect(plan.markIds).toEqual(['a', 'b', 'c']);
    expect(plan.toast).toMatchObject({ tone: 'info', title: 'Download started' });
    expect(plan.toast!.description).not.toMatch(/not marked/);
    // The app cannot see the download finish (Electron may show its own Save As): it must not say "saved".
    expect(plan.toast!.description).toMatch(/cannot confirm that the download finished/);
    expect(`${plan.toast!.title} ${plan.toast!.description}`).not.toMatch(/\bsaved to\b|Downloads folder/i);
    expect(plan.toast!.description).toContain('saved without a password');
    const one = planSaveResult(report({ mode: 'one', outcome: 'downloaded', files: [files[0]] }));
    expect(one.markIds).toEqual(['a']);
    expect(one.toast!.description).toContain('Bank.pdf');
  });

  it('marks only the files written before a failure and lists the rest', () => {
    const plan = planSaveResult(report({ outcome: 'partial', written: ['Bank.pdf'], errorMessage: '"Ledger.pdf" could not be saved.' }));
    expect(plan.markIds).toEqual(['a']);
    expect(plan.toast).toMatchObject({ tone: 'error', title: 'Some files were not saved' });
    expect(plan.toast!.description).toContain('Saved: Bank.pdf');
    expect(plan.toast!.description).toContain('Not saved: Ledger.pdf, Notes.pdf');
  });

  it('reports a failure with its message', () => {
    const plan = planSaveResult(report({ mode: 'one', outcome: 'failed', files: [files[0]], errorMessage: '"Bank.pdf" could not be saved.' }));
    expect(plan).toEqual({ markIds: [], toast: { tone: 'error', title: 'Not saved', description: '"Bank.pdf" could not be saved.' } });
  });

  it('after the engagement changed: marks nothing and names no file', () => {
    for (const outcome of ['saved', 'partial', 'failed', 'downloaded'] as const) {
      const plan = planSaveResult(report({ outcome, written: ['Bank.pdf'], sameSession: false, errorMessage: '"Bank.pdf" broke' }));
      expect(plan.markIds).toEqual([]);
      const text = `${plan.toast?.title ?? ''} ${plan.toast?.description ?? ''}`;
      for (const f of files) expect(text).not.toContain(f.intendedName.replace('.pdf', ''));
    }
    expect(planSaveResult(report({ sameSession: false })).toast).toEqual({ tone: 'success', title: 'Saved' });
  });

  it('describes a zip save', () => {
    const plan = planSaveResult(report({ mode: 'zip' }));
    expect(plan.markIds).toEqual(['a', 'b', 'c']);
    expect(plan.toast).toMatchObject({ tone: 'success', title: 'Saved as one zip' });
  });
});

describe('watchSave: the Save button and the folder note while a save window is open', () => {
  /**
   * A fake clock and window focus; `trace` records every call the watch makes. The application
   * window starts without the focus (the save or folder window has it).
   */
  function harness(folder = true) {
    let now = 0;
    let next = 1;
    let focused = false;
    const timers: { at: number; fn: () => void; id: number }[] = [];
    const focusListeners = new Set<() => void>();
    const trace: string[] = [];
    const watch = watchSave({
      folder,
      stallMs: 10_000,
      graceMs: 1_500,
      hold: (saving) => void trace.push(saving ? 'hold' : 'release'),
      notChosen: () => void trace.push('note'),
      withdrawNote: () => void trace.push('withdraw'),
      hasFocus: () => focused,
      setTimer: (fn, ms) => {
        timers.push({ at: now + ms, fn, id: next });
        return next++;
      },
      clearTimer: (id) => {
        const i = timers.findIndex((t) => t.id === id);
        if (i >= 0) timers.splice(i, 1);
      },
      onWindowFocus: (listener) => {
        focusListeners.add(listener);
        return () => void focusListeners.delete(listener);
      },
    });
    const advance = (ms: number) => {
      now += ms;
      for (const t of timers.filter((x) => x.at <= now).sort((a, b) => a.at - b.at)) {
        timers.splice(timers.indexOf(t), 1);
        t.fn();
      }
    };
    // A real 'focus' event reaches only the listeners registered at that moment.
    const focus = () => {
      focused = true;
      [...focusListeners].forEach((listener) => listener());
    };
    const blur = () => void (focused = false);
    return { watch, trace, advance, focus, blur, listening: () => focusListeners.size };
  }

  it('a folder window that ends without a folder: one quiet note when it ends, and the button is free', () => {
    const h = harness();
    h.advance(3_000);
    h.watch.settled('cancelled');
    expect(h.trace).toEqual(['hold', 'release', 'note']);
    h.advance(60_000);
    h.focus();
    expect(h.trace).toEqual(['hold', 'release', 'note']);
  });

  it('after 10 s without an answer only the button is freed; no note while the window may still be open', () => {
    const h = harness();
    h.advance(10_000);
    expect(h.trace).toEqual(['hold', 'release']);
    h.advance(120_000);
    expect(h.trace).toEqual(['hold', 'release']);
  });

  it('the note comes when the application window has the focus again and nothing has answered a moment later', () => {
    const h = harness();
    h.advance(10_000);
    h.focus();
    h.advance(1_499);
    expect(h.trace).toEqual(['hold', 'release']);
    h.advance(1);
    expect(h.trace).toEqual(['hold', 'release', 'note']);
    expect(h.listening()).toBe(0);
    // the window ends without a folder later: no second note
    h.watch.settled('cancelled');
    expect(h.trace).toEqual(['hold', 'release', 'note', 'release']);
    expect(h.listening()).toBe(0);
  });

  it('the application window already has the focus when the button is freed: the note comes a moment later, once', () => {
    // Desktop chosen at 3 s; the folder window closes and never answers.
    const h = harness();
    h.advance(3_000);
    h.focus();
    h.advance(7_000);
    expect(h.trace).toEqual(['hold', 'release']);
    h.advance(1_500);
    expect(h.trace).toEqual(['hold', 'release', 'note']);
    expect(h.listening()).toBe(0);
    // ten minutes later the user switches to another application and back: nothing more
    h.blur();
    h.advance(600_000);
    h.focus();
    h.advance(2_000);
    expect(h.trace).toEqual(['hold', 'release', 'note']);
  });

  it('a folder whose answer comes after the note: the note is withdrawn, and nothing is said twice', () => {
    const h = harness();
    h.advance(25_000);
    h.focus();
    h.advance(1_500);
    expect(h.trace).toEqual(['hold', 'release', 'note']);
    h.advance(500);
    h.watch.picked();
    h.advance(2_000);
    h.watch.settled('saved');
    h.blur();
    h.focus();
    h.advance(5_000);
    expect(h.trace).toEqual(['hold', 'release', 'note', 'withdraw', 'hold', 'release']);
    expect(h.listening()).toBe(0);
  });

  it('no note after a save that worked, whatever the focus does later', () => {
    const h = harness();
    h.advance(12_000);
    h.watch.picked();
    h.watch.settled('saved');
    h.focus();
    h.advance(10_000);
    expect(h.trace).toEqual(['hold', 'release', 'hold', 'release']);
    expect(h.listening()).toBe(0);
  });

  it('a folder chosen just after the focus returns: no note, and "Saving…" shows again while writing', () => {
    const h = harness();
    h.advance(12_000);
    h.focus();
    h.advance(500);
    h.watch.picked();
    h.advance(10_000);
    h.watch.settled('saved');
    expect(h.trace).toEqual(['hold', 'release', 'hold', 'release']);
  });

  it('a folder window that ends without a folder long after the button was freed still gives the note', () => {
    const h = harness();
    h.advance(10_000);
    h.advance(50_000);
    h.watch.settled('cancelled');
    expect(h.trace).toEqual(['hold', 'release', 'release', 'note']);
  });

  it('a location chosen in time: the button stays held through the writing, nothing else happens', () => {
    const h = harness();
    h.advance(4_000);
    h.watch.picked();
    h.advance(30_000);
    h.focus();
    h.watch.settled('saved');
    expect(h.trace).toEqual(['hold', 'hold', 'release']);
  });

  it('Save As and zip saves never give the folder note', () => {
    const h = harness(false);
    h.advance(10_000);
    h.focus();
    h.advance(5_000);
    h.watch.settled('cancelled');
    expect(h.trace).toEqual(['hold', 'release', 'release']);
    expect(h.listening()).toBe(0);
  });

  it('a save window already open (busy) gives no folder note: its own message says what happened', () => {
    const h = harness();
    h.watch.settled('busy');
    expect(h.trace).toEqual(['hold', 'release']);
  });
});
