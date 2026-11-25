import { describe, expect, it } from 'vitest';
import { elapsedText, nameEnds, shortDate, shortDateOfStored, unsavedLine, unsavedWarning } from './format';
import { soonLabel } from './toolRules';

describe('wording shared by the screen (UX audit C9, C3.2, C2.2)', () => {
  it('writes a date as the Evidence Vault does, "13 Nov 2026", whatever the locale', () => {
    expect(shortDate(new Date(2026, 10, 13))).toBe('13 Nov 2026');
    expect(shortDate(new Date(2026, 0, 3))).toBe('03 Jan 2026');
    expect(shortDate(new Date('not a date'))).toBe('');
  });

  it('reads a SQLite timestamp as UTC and gives the local date', () => {
    const local = shortDate(new Date(Date.UTC(2026, 10, 13, 10, 0, 0)));
    expect(shortDateOfStored('2026-11-13 10:00:00')).toBe(local);
    expect(shortDateOfStored('2026-11-13T10:00:00Z')).toBe(local);
    expect(shortDateOfStored('garbage')).toBe('');
  });

  it('counts the results not saved yet, and names a tool still to come', () => {
    expect(unsavedLine(1)).toBe('1 result not saved yet');
    expect(unsavedLine(3)).toBe('3 results not saved yet');
    expect(soonLabel('PDF to Excel')).toBe('PDF to Excel · soon');
  });
});

describe('nameEnds: a long name keeps its end in view (QA-FIX G)', () => {
  it('leaves a short name whole', () => {
    expect(nameEnds('Bank statement Q1.pdf')).toEqual({ head: 'Bank statement Q1.pdf', tail: '' });
  });
  it('splits a long name so its last words stay whole when the start is cut', () => {
    const name = 'Synthetic M-s Gamma Traders Private Limited - Tax Audit Report u-s 44AB - Form 3CA 3CD with Annexures for AY 2025-26 - final copy v3 revised.pdf';
    const { head, tail } = nameEnds(name);
    expect(head + tail).toBe(name);
    // With the space before it, which the cut start would lose on screen.
    expect(tail).toBe(' final copy v3 revised.pdf');
  });
  it('never splits a character pair', () => {
    // The end's first character would be the pair's second half.
    const name = `${'a'.repeat(40)}\u{1F600}${'b'.repeat(19)}.pdf`;
    const { head, tail } = nameEnds(name);
    expect(head + tail).toBe(name);
    expect(tail).not.toMatch(/^[\uDC00-\uDFFF]/);
  });
});

describe('elapsedText: how long a run has taken, shown while it runs (QA-FIX I)', () => {
  it('in seconds, then minutes and seconds', () => {
    expect(elapsedText(12)).toBe('12 s');
    expect(elapsedText(59)).toBe('59 s');
    expect(elapsedText(60)).toBe('1 min');
    expect(elapsedText(146)).toBe('2 min 26 s');
  });
});

describe('unsavedWarning: what happens to unsaved results, said before it happens (QA-FIX K)', () => {
  it('says they are cleared when the engagement changes or VERA closes, and how to keep them', () => {
    expect(unsavedWarning(1)).toBe('1 result is not saved. It is cleared when the engagement changes or VERA closes; click to save it.');
    expect(unsavedWarning(12)).toBe('12 results are not saved. They are cleared when the engagement changes or VERA closes; click to save them all.');
  });
});
