import { describe, expect, it } from 'vitest';
import type { Destination, FileOrigin, WorkingFile } from '@/lib/pdf-tools/types';
import { engagementLeaveGuard, leaveQuestion } from './leaveGuard';

let seq = 0;
const file = (origin: FileOrigin, sentTo: Destination[] = []): WorkingFile => ({
  id: `f-${++seq}`,
  name: `F${seq}.pdf`,
  kind: 'pdf',
  mimeType: 'application/pdf',
  origin,
  bytes: new Uint8Array(1),
  size: 1,
  pageCount: 1,
  wasProtected: false,
  hasRestrictions: false,
  hasSignature: false,
  sentTo,
});

describe('the question before an engagement change (owner, 15 November 2026)', () => {
  it('asks only when results are not saved, in the owner\'s words, singular for one', () => {
    expect(leaveQuestion([])).toBeNull();
    expect(leaveQuestion([file('computer'), file('vault')])).toBeNull();
    expect(leaveQuestion([file('result', ['computer']), file('result', ['vault', 'working-paper'])])).toBeNull();
    expect(leaveQuestion([file('result')])).toBe('1 result in PDF Tools is not saved and will be removed.');
    expect(leaveQuestion([file('result'), file('computer'), file('result'), file('result', ['vault'])])).toBe(
      '2 results in PDF Tools are not saved and will be removed.',
    );
  });

  it('counts a result only handed to a download as not saved (its completion cannot be seen), as the Remove question does', () => {
    expect(leaveQuestion([file('result', ['download'])])).toBe('1 result in PDF Tools is not saved and will be removed.');
    expect(leaveQuestion([file('result', ['download', 'computer'])])).toBeNull();
  });

  it('reads the list at the moment it is asked, never a copy taken when it was registered', () => {
    let files: WorkingFile[] = [];
    const stored = JSON.stringify({ id: 'A' });
    const guard = engagementLeaveGuard(() => ({ contextKey: 'u1:A', files }), () => stored);
    expect(guard()).toBeNull();
    files = [file('result'), file('result'), file('result')];
    expect(guard()).toBe('3 results in PDF Tools are not saved and will be removed.');
    files = [{ ...files[0], sentTo: ['computer'] }];
    expect(guard()).toBeNull();
  });

  it('asks nothing for a list already on its way out: the saved engagement is no longer the list\u2019s (REV-C M2)', () => {
    const files = [file('result')];
    expect(engagementLeaveGuard(() => ({ contextKey: 'u1:A', files }), () => JSON.stringify({ id: 'B' }))()).toBeNull();
    // None saved, or unreadable: the watch drops the list too, so there is nothing left to keep.
    expect(engagementLeaveGuard(() => ({ contextKey: 'u1:A', files }), () => null)()).toBeNull();
    expect(
      engagementLeaveGuard(
        () => ({ contextKey: 'u1:A', files }),
        () => {
          throw new Error('storage unavailable');
        },
      )(),
    ).toBeNull();
    // The list still belongs to the saved engagement: asked.
    expect(engagementLeaveGuard(() => ({ contextKey: 'u1:A', files }), () => JSON.stringify({ id: 'A' }))()).toBe(
      '1 result in PDF Tools is not saved and will be removed.',
    );
  });
});
