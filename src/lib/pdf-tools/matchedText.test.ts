import { describe, expect, it } from 'vitest';
import { forgetMatchedText } from './matchedText';
import { createWorkingListStore } from './workingList';

/** What the engine keeps, process-wide, of the last regular-expression match. */
function matchStatics(): string[] {
  const statics = RegExp as unknown as Record<string, unknown>;
  return ['input', 'lastMatch', 'leftContext', 'rightContext', '$1'].map((key) => String(statics[key] ?? ''));
}

describe('forgetMatchedText', () => {
  it('leaves nothing of the last match, not even after a failed one', () => {
    /Invoice (\d+)/.exec('Synthetic page text: Invoice 4471 for BNZPM');
    /no such words/.exec('Synthetic file name BNZPM.pdf');
    expect(matchStatics().join('|')).toContain('BNZPM');
    forgetMatchedText();
    expect((RegExp as unknown as { input: string }).input).toBe('');
    expect(matchStatics()).toEqual(['', '', '', '', '']);
  });

  it("is run when the list's context is cleared (another engagement, sign-out)", () => {
    const store = createWorkingListStore();
    store.setContext('u1:A');
    /Invoice (\d+)/.exec('Synthetic page text: Invoice 4471 for BNZPM');
    store.setContext('u1:B');
    expect((RegExp as unknown as { input: string }).input).toBe('');
    /Invoice (\d+)/.exec('Synthetic page text: Invoice 4471 for BNZPM');
    store.setContext(null);
    expect(matchStatics()).toEqual(['', '', '', '', '']);
  });
});
