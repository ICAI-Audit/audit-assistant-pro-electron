// The question before an engagement change throws away unsaved PDF Tools results (owner, 15 November 2026),
// asked in the application (EngagementContext's own dialog) rather than in a native window.confirm box: after
// a native box, Windows gave no typing back to the window until it lost and regained focus (FIX-C real-window
// probe, 15 November 2026). The dialog itself is checked in the running application; its words and the order
// "ask, then change only after OK" are checked here.
import { describe, expect, it, vi } from 'vitest';
import { changeAfterAsking, leaveQuestionFor, registerEngagementLeaveGuard, type LeaveQuestion } from '@/contexts/EngagementContext';
import type { WorkingFile } from '@/lib/pdf-tools/types';
import { engagementLeaveGuard, leaveQuestion } from './leaveGuard';

vi.mock('@/integrations/sqlite/client', () => ({ getSQLiteClient: () => ({}), auth: {} }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: null }) }));

// A guard text that ends with a question of its own (PDF Tools' did until INT3; the dialog's title asks now).
const GUARD_TEXT = '2 results in PDF Tools are not saved and will be removed. Change engagement anyway?';

describe('the words of the question', () => {
  it('asks nothing when no guard has anything to lose', () => {
    expect(leaveQuestionFor([], 'change')).toBeNull();
    expect(leaveQuestionFor([null, null], 'sign-out')).toBeNull();
  });

  it('changing engagement: what would be lost, then "Change engagement anyway?"', () => {
    expect(leaveQuestionFor([GUARD_TEXT], 'change')).toEqual({
      title: 'Change engagement anyway?',
      description: '2 results in PDF Tools are not saved and will be removed.',
      action: 'Change engagement',
    });
  });

  it('Log Out asks "Log out anyway?" and never speaks of changing engagement', () => {
    const question = leaveQuestionFor([GUARD_TEXT], 'sign-out');
    expect(question).toEqual({
      title: 'Log out anyway?',
      description: '2 results in PDF Tools are not saved and will be removed.',
      action: 'Log out',
    });
    expect(JSON.stringify(question)).not.toMatch(/change engagement/i);
  });

  it('PDF Tools says what would be lost and leaves the question to the dialog (INT3)', () => {
    const unsaved = [result(), result()];
    expect(leaveQuestion(unsaved)).toBe('2 results in PDF Tools are not saved and will be removed.');
    expect(leaveQuestionFor([leaveQuestion(unsaved)], 'change')).toEqual({
      title: 'Change engagement anyway?',
      description: '2 results in PDF Tools are not saved and will be removed.',
      action: 'Change engagement',
    });
  });

  it('keeps a guard text that has no closing question as it is, and joins several', () => {
    expect(leaveQuestionFor(['Three notes are not saved.'], 'change')?.description).toBe('Three notes are not saved.');
    expect(leaveQuestionFor([GUARD_TEXT, null, 'Three notes are not saved.'], 'change')?.description).toBe(
      '2 results in PDF Tools are not saved and will be removed. Three notes are not saved.',
    );
  });
});

describe('ask first, change only after OK', () => {
  it('changes at once, without asking, when nothing would be lost', async () => {
    const apply = vi.fn();
    const ask = vi.fn(async () => true);
    const done = changeAfterAsking('change', apply, ask);
    expect(apply).toHaveBeenCalledTimes(1); // before anything awaits: as immediate as before the question existed
    await expect(done).resolves.toBe(true);
    expect(ask).not.toHaveBeenCalled();
  });

  it('with something to lose, asks once and changes only after OK, before the caller goes on', async () => {
    const stop = registerEngagementLeaveGuard(() => GUARD_TEXT);
    try {
      const order: string[] = [];
      let answer!: (ok: boolean) => void;
      const ask = vi.fn((question: LeaveQuestion) => {
        order.push(`asked: ${question.title}`);
        return new Promise<boolean>((resolve) => {
          answer = resolve;
        });
      });
      const done = changeAfterAsking('sign-out', () => order.push('changed'), ask).then((ok) => order.push(`went on: ${ok}`));
      await Promise.resolve();
      expect(order).toEqual(['asked: Log out anyway?']);
      answer(true);
      await done;
      expect(order).toEqual(['asked: Log out anyway?', 'changed', 'went on: true']);
      expect(ask).toHaveBeenCalledTimes(1);
    } finally {
      stop();
    }
  });

  it('Stay (or Escape) changes nothing and tells the caller to stop', async () => {
    const stop = registerEngagementLeaveGuard(() => GUARD_TEXT);
    try {
      const apply = vi.fn();
      await expect(changeAfterAsking('change', apply, async () => false)).resolves.toBe(false);
      expect(apply).not.toHaveBeenCalled();
    } finally {
      stop();
    }
  });

  it('reads the guards when it asks, not when they were registered; a removed guard asks nothing', async () => {
    let text: string | null = null;
    const stop = registerEngagementLeaveGuard(() => text);
    const ask = vi.fn(async () => true);
    await changeAfterAsking('change', vi.fn(), ask);
    expect(ask).not.toHaveBeenCalled();
    text = GUARD_TEXT;
    await changeAfterAsking('change', vi.fn(), ask);
    expect(ask).toHaveBeenCalledTimes(1);
    stop();
    await changeAfterAsking('change', vi.fn(), ask);
    expect(ask).toHaveBeenCalledTimes(1);
  });
});

let seq = 0;
/** A result of PDF Tools saved nowhere yet (invented). */
function result(): WorkingFile {
  seq += 1;
  return {
    id: `r-${seq}`,
    name: `Result ${seq}.pdf`,
    kind: 'pdf',
    mimeType: 'application/pdf',
    origin: 'result',
    bytes: new Uint8Array(1),
    size: 1,
    pageCount: 1,
    wasProtected: false,
    hasRestrictions: false,
    hasSignature: false,
    sentTo: [],
  };
}

// REV-C M2 (INT3): after "Change engagement" the list is cleared by the screen's effect or by the watch within
// a second; a second change in that time asked again about results that were already going.
describe('asked once: a change already answered is not asked about again while the list clears (REV-C M2)', () => {
  it('a second change before the list has cleared asks nothing; once the list is the engagement\u2019s again, it asks', async () => {
    const list = { contextKey: 'u1:A' as string | null, files: [result(), result()] };
    let stored: string | null = JSON.stringify({ id: 'A' });
    const stop = registerEngagementLeaveGuard(engagementLeaveGuard(() => list, () => stored));
    try {
      const ask = vi.fn(async () => true);
      // A to B: asked, answered "Change engagement"; the context saves B at once, the list clears later.
      await expect(changeAfterAsking('change', () => void (stored = JSON.stringify({ id: 'B' })), ask)).resolves.toBe(true);
      expect(ask).toHaveBeenCalledTimes(1);
      // B to C within that second: A's results go anyway, so nothing is asked and the change is made.
      const toC = vi.fn(() => void (stored = JSON.stringify({ id: 'C' })));
      await expect(changeAfterAsking('change', toC, ask)).resolves.toBe(true);
      expect(toC).toHaveBeenCalledTimes(1);
      expect(ask).toHaveBeenCalledTimes(1);
      // Log Out in that time: the same.
      await expect(changeAfterAsking('sign-out', vi.fn(), ask)).resolves.toBe(true);
      expect(ask).toHaveBeenCalledTimes(1);
      // Control: the list now belongs to C and holds results saved nowhere: asked again.
      list.contextKey = 'u1:C';
      await changeAfterAsking('change', vi.fn(), ask);
      expect(ask).toHaveBeenCalledTimes(2);
    } finally {
      stop();
    }
  });

  it('a Stay changes nothing, so the next change asks again', async () => {
    const list = { contextKey: 'u1:A', files: [result()] };
    const stored = JSON.stringify({ id: 'A' });
    const stop = registerEngagementLeaveGuard(engagementLeaveGuard(() => list, () => stored));
    try {
      const ask = vi.fn(async () => false);
      await expect(changeAfterAsking('change', vi.fn(), ask)).resolves.toBe(false);
      await expect(changeAfterAsking('change', vi.fn(), ask)).resolves.toBe(false);
      expect(ask).toHaveBeenCalledTimes(2);
    } finally {
      stop();
    }
  });
});
