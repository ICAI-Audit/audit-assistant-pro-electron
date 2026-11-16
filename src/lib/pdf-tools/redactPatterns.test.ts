import { describe, expect, it, vi } from 'vitest';
import { calculateGstinCheckDigit } from '@/lib/gstinValidation';
import { loosePlacesOf } from './redactCheck';
import {
  cachedTextCount,
  checkForms,
  clearRedactCaches,
  coveredPlacesOfValue,
  findPatterns,
  findTerm,
  foldText,
  foldWithMap,
  keyOf,
  ADDED_COUNT_NAMES,
  ADDED_KIND_NAMES,
  KIND_GROUP,
  KIND_LABELS,
  maskValue,
  neverTickedByDefault,
  placesOfValue,
  PROFILES,
  REASONS,
  REDACT_GROUPS,
  TERM_LIMITS,
  TERM_RULE,
  valueIn,
  termError,
  verhoeffDigit,
  verhoeffValid,
  type FoundKind,
  type PatternMatch,
  type RedactGroup,
  type RedactKind,
} from './redactPatterns';
import {
  extraKindCases,
  luhnCheckDigit,
  luhnOk,
  nearMissCases,
  newKindCases,
  newKindValues,
  newNearMisses,
  oneLineCases,
  ordinaryLines,
  overlapCases,
  statementLines,
  validCases,
  writtenForms,
} from './testRedactCorpus';

// Several tests search thousands of lines; on a busy machine the default 5 s per test is not enough (T-048
// round 2: one took 6.4 s with every CPU busy). No test here depends on how fast the machine is.
vi.setConfig({ testTimeout: 120_000 });

const ALL: ReadonlySet<RedactGroup> = new Set<RedactGroup>(['identity', 'contact', 'bank-tax', 'network', 'names']);
const find = (text: string) => findPatterns(text, ALL);
const of = (found: PatternMatch[], kind: RedactKind) => found.filter((m) => m.kind === kind);
// The 5,000 ordinary lines are generated once, here, so that the test name can show the possible counts.
const lines = ordinaryLines();

/** The most calibration loops one find on a 60-line page may take (see "Speed" below). */
const FIND_LOOPS = 4;
const CALIBRATION = [/\d+/g, /[A-Za-z]+/g, /\S+/g, /\s+/g, /[A-Z]{2,}\d*/g, /\d[\d,.]*\d/g, /(?<![A-Za-z0-9])[A-Za-z0-9]{6,}(?![A-Za-z0-9])/g];
/** The find on `page` and a calibration loop over it, interleaved, warmed up, best of 30 each (ms). */
function findSpeed(page: string): { find: number; loop: number; ratio: number } {
  let sink = 0;
  const loop = () => {
    for (let r = 0; r < 3; r++) for (const re of CALIBRATION) for (const m of page.matchAll(re)) sink += m[0].length;
  };
  const time = (work: () => unknown) => {
    const t0 = performance.now();
    work();
    return performance.now() - t0;
  };
  for (let i = 0; i < 5; i++) {
    find(page);
    loop();
  }
  let best = Infinity;
  let bestLoop = Infinity;
  for (let i = 0; i < 30; i++) {
    best = Math.min(best, time(() => find(page)));
    bestLoop = Math.min(bestLoop, time(loop));
  }
  if (sink === 0) throw new Error('the calibration loop did no work');
  return { find: best, loop: bestLoop, ratio: best / bestLoop };
}

describe('findPatterns: the trial corpus', () => {
  it('finds every valid example once, with its kind and key, as sure', () => {
    const failed: Record<string, number> = {};
    const counts: Record<string, number> = {};
    for (const c of validCases()) {
      counts[c.group] = (counts[c.group] ?? 0) + 1;
      const hits = of(find(c.text), c.kind).filter((m) => m.key === c.key);
      if (hits.length !== 1 || hits[0].confidence !== 'sure') failed[c.group] = (failed[c.group] ?? 0) + 1;
    }
    expect(counts).toEqual({ pan: 200, 'pan with a kerning space': 100, aadhaar: 200, gstin: 200, mobile: 200, email: 100, 'bank account': 100 });
    expect(failed).toEqual({});
  });

  it('handles the near-misses: possible with a reason, or nothing', () => {
    // T-048 wave 4: three reasons were reworded in plain words; the corpus (testRedactCorpus.ts, not this lane's
    // file) still holds the old texts, so they are read through this table until it takes REASONS itself.
    const reworded: Record<string, string> = {
      'fourth letter is not a holder type': REASONS.panType,
      'check digit does not match': REASONS.aadhaarCheck,
      'check character does not match': REASONS.gstinCheck,
    };
    const failed: Record<string, number> = {};
    for (const c of nearMissCases()) {
      const found = find(c.text);
      const reason = c.expect?.reason === undefined ? undefined : (reworded[c.expect.reason] ?? c.expect.reason);
      const ok =
        c.expect === null
          ? found.length === 0
          : of(found, c.expect.kind).some((m) => m.key === c.expect!.key && m.confidence === c.expect!.confidence && m.reason === reason);
      if (!ok) failed[c.group] = (failed[c.group] ?? 0) + 1;
    }
    expect(failed).toEqual({});
  });

  it('keeps the kinds on one line apart', () => {
    for (const c of oneLineCases()) {
      const found = find(c.text);
      expect(of(found, 'email').map((m) => m.key)).toEqual(['r.kumar@example.in']);
      expect(of(found, 'mobile').map((m) => [m.key, m.confidence])).toEqual([[c.mobile, 'sure']]);
      expect(of(found, 'bank-account').map((m) => [m.key, m.confidence])).toEqual([[c.account, 'sure']]);
      expect(of(found, 'ifsc').map((m) => [m.key, m.confidence])).toEqual([[c.ifsc, 'sure']]);
    }
  });

  it('finds the extra kinds', () => {
    const failed: string[] = [];
    for (const c of extraKindCases()) {
      const hit = of(find(c.text), c.kind).find((m) => m.value === c.value);
      if (!hit || hit.confidence !== 'sure') failed.push(c.kind);
    }
    expect(failed).toEqual([]);
    expect(find('Batch BXWP32188Z received in stores').map((m) => [m.kind, m.key, m.confidence])).toEqual([['tan', 'BXWP32188Z', 'possible']]);
    expect(find('Version 2.10.4.1 of the software')).toEqual([]);
    const name = find('Name of the bank: State Bank of India');
    expect(name.map((m) => [m.kind, m.value, m.key, m.confidence])).toEqual([['name', 'State Bank of India', 'state bank of india', 'possible']]);
    const to = find('To,\nThe Assessing Officer\nWard 12(3), Mumbai\n\nSubject: Reply');
    expect(to.map((m) => [m.kind, m.value, m.confidence])).toEqual([['addressee', 'The Assessing Officer\nWard 12(3), Mumbai', 'possible']]);
  });

  // The possible counts are shown in the test's name only, not asserted.
  const sure: Record<string, number> = {};
  const possible: Record<string, number> = {};
  for (const line of lines) {
    for (const m of find(line)) {
      const into = m.confidence === 'sure' ? sure : possible;
      into[m.kind] = (into[m.kind] ?? 0) + 1;
    }
  }
  it(`finds no sure match in 5,000 lines of ordinary audit text (possible: ${JSON.stringify(possible)})`, () => {
    expect(lines).toHaveLength(5000);
    expect(sure).toEqual({});
    for (const kind of ['ip', 'mobile', 'email', 'pan', 'gstin']) expect(possible[kind] ?? 0).toBe(0);
  });

  it('finds an Aadhaar written across a line break as one match', () => {
    const found = find('linked Aadhaar 2345 6789\n0124 for KYC');
    expect(found.map((m) => [m.kind, m.key, m.value, m.confidence])).toEqual([['aadhaar', '234567890124', '2345 6789\n0124', 'sure']]);
  });

  // Speed (T-048 round 2: a wall-clock limit failed whenever the machine was busy). The find is timed against a
  // calibration loop of plain regular expressions over the same page, interleaved, best of 30 each: load slows
  // both alike, and the best run is the least disturbed. The bound, 4 loops, is the old 5 ms budget on the machine
  // where it was set (one loop took about 1.1 ms there; the find about 1.4 ms, 0.6 ms before T-048; the ratio
  // stayed 1.1-1.6 with every CPU busy). Measured on a scratch copy: a find doing four times its work fails it,
  // one doing three times its work passes; machine load does not move the ratio.
  const page = lines.slice(0, 60).join('\n');
  const speed = findSpeed(page);
  it(`finds a 60-line page within ${FIND_LOOPS} calibration loops (best of 30: find ${speed.find.toFixed(2)} ms, loop ${speed.loop.toFixed(2)} ms, ratio ${speed.ratio.toFixed(2)})`, () => {
    expect(speed.ratio).toBeLessThan(FIND_LOOPS);
  });
});

describe('findPatterns: rules', () => {
  it('tolerates one kerning space but never joins across a real word break', () => {
    expect(find('PAN BN ZPM2501F as per return').map((m) => [m.kind, m.key, m.value, m.confidence])).toEqual([['pan', 'BNZPM2501F', 'BN ZPM2501F', 'sure']]);
    // In normally set text, two spaces, a tab, a line break, or a space at more than one place are
    // separate words. (A space between EVERY character is the spaced-out form: see "spaced-out values".)
    for (const text of ['PAN BNZPM  2501F', 'PAN BNZPM\t2501F', 'PAN BNZPM\n2501F', 'PAN BN ZP M2501F', 'PAN: BNZPM 2501 F']) {
      expect(of(find(text), 'pan')).toEqual([]);
    }
    // One space is a kerning gap or a real word break ("BATCH 1234A", "TO ABC1234E"): the text cannot
    // tell them apart, so it is only possibly a PAN, unless a PAN label is near.
    for (const [text, key] of [['BATCH 1234A received', 'BATCH1234A'], ['SENT TO ABC1234E TODAY', 'TOABC1234E']]) {
      expect(find(text).map((m) => [m.kind, m.key, m.confidence, m.reason])).toEqual([['pan', key, 'possible', 'a space or hyphen splits it; it may be two words']]);
    }
    expect(find('PAN: BNZPM 2501F').map((m) => [m.kind, m.confidence])).toEqual([['pan', 'sure']]);
    expect(find('Permanent Account Number BN ZPM2501F').map((m) => [m.kind, m.confidence])).toEqual([['pan', 'sure']]);
  });

  it('treats GSTIN state codes 38, 96, 97 and 99 as sure, unlike the application validator', () => {
    for (const state of ['01', '37', '38', '96', '97', '99']) {
      const first = `${state}QZXCV0000W1Z`;
      const v = first + calculateGstinCheckDigit(first);
      expect(find(`GSTIN ${v}`).map((m) => [m.kind, m.key, m.confidence])).toEqual([['gstin', v, 'sure']]);
    }
    for (const state of ['00', '39', '95']) {
      const first = `${state}QZXCV0000W1Z`;
      const v = first + calculateGstinCheckDigit(first);
      expect(find(`GSTIN ${v}`).map((m) => [m.kind, m.confidence, m.reason])).toEqual([['gstin', 'possible', 'state code not recognised']]);
    }
    // A 14th character other than Z is still a GSTIN shape: the check character decides.
    const first = '27QZXCV0000W1Y';
    const v = first + calculateGstinCheckDigit(first);
    expect(find(`GSTIN ${v}`).map((m) => [m.kind, m.confidence])).toEqual([['gstin', 'sure']]);
  });

  it('classifies the same way whichever groups are searched, and returns only those groups', () => {
    const text = 'Savings A/c 2345 6789 0124 and mobile +91 98450 12345';
    expect(find(text).map((m) => m.kind)).toEqual(['bank-account', 'mobile']);
    expect(findPatterns(text, new Set<RedactGroup>(['identity', 'contact'])).map((m) => m.kind)).toEqual(['mobile']);
  });

  it('returns matches sorted by start and never overlapping', () => {
    const text = lines.slice(0, 200).join('\n') + '\nContact r.kumar@example.in, mobile +91 98450 12345; A/c 50100123456789 IFSC HDFC0001234';
    const found = find(text);
    for (let i = 1; i < found.length; i++) expect(found[i].start).toBeGreaterThanOrEqual(found[i - 1].end);
    for (const m of found) expect(text.slice(m.start, m.end)).toBe(m.value);
  });

  it('needs a whole label word before a mobile number', () => {
    expect(find('Hotel 98450 12345').map((m) => [m.kind, m.confidence])).toEqual([['mobile', 'possible']]);
    expect(find('Tel. 98450 12345').map((m) => [m.kind, m.confidence])).toEqual([['mobile', 'sure']]);
  });

  it('keeps the parts of an address that a number does not take', () => {
    const found = find('Address: Flat 2, PAN BNZPM2501F, MG Road\nMumbai 400001\n\nSubject: Reply');
    expect(found.map((m) => m.kind)).toEqual(['address', 'pan', 'address']);
    expect(found.filter((m) => m.kind === 'address').every((m) => m.confidence === 'possible')).toBe(true);
    expect(found[2].value).toBe(', MG Road\nMumbai 400001');
  });

  it('takes the first code after EVC that no other kind holds', () => {
    expect(find('EVC sent to ab12cd@example.in: XY12ZW34').map((m) => [m.kind, m.value])).toEqual([
      ['email', 'ab12cd@example.in'],
      ['evc', 'XY12ZW34'],
    ]);
  });
});

describe('Verhoeff', () => {
  it('makes a valid number and catches every single-digit change', () => {
    const v = `23456789012${verhoeffDigit('23456789012')}`;
    expect(verhoeffValid(v)).toBe(true);
    for (let i = 0; i < 12; i++) {
      const flipped = v.slice(0, i) + String((Number(v[i]) + 1) % 10) + v.slice(i + 1);
      expect(verhoeffValid(flipped)).toBe(false);
    }
    expect(verhoeffValid('2345678901x4')).toBe(false);
  });
});

describe('labels, masks and check forms', () => {
  it('groups kinds and defines the three profiles', () => {
    expect(KIND_GROUP.pan).toBe('identity');
    expect(KIND_GROUP.mobile).toBe('contact');
    expect(KIND_GROUP.micr).toBe('bank-tax');
    expect(KIND_GROUP.ip).toBe('network');
    expect(KIND_GROUP.addressee).toBe('names');
    expect(PROFILES.balanced).toEqual({ ticked: ['identity', 'contact', 'bank-tax'], tickPossible: false });
    expect(PROFILES.strict).toEqual({ ticked: ['identity', 'contact', 'bank-tax', 'network', 'names', 'employment', 'investments', 'documents'], tickPossible: true });
    expect(PROFILES.identity).toEqual({ ticked: ['identity'], tickPossible: false });
    expect(KIND_LABELS.pan).toBe('[PAN redacted]');
    expect(KIND_LABELS['tax-din']).toBe('[tax document number redacted]');
    expect(KIND_LABELS.typed).toBe('[REDACTED]');
    expect(KIND_LABELS.drawn).toBe('[REDACTED]');
  });

  it('masks all but the last four characters', () => {
    expect(maskValue('pan', 'BNZPM2501F')).toBe('XXXXXX501F');
    expect(maskValue('aadhaar', '234567890124')).toBe('XXXX XXXX 0124');
    expect(maskValue('mobile', '9845012345')).toBe('XXXXXX2345');
    expect(maskValue('email', 'r.kumar@example.in')).toBe('r*****@example.in');
    expect(maskValue('typed', 'sharma')).toBe('[REDACTED]');
    expect(maskValue('evc', 'AB12')).toBe('XXXX');
  });

  it('lists the forms the check looks for', () => {
    const aadhaar = checkForms('aadhaar', '234567890124', '2345 6789 0124');
    expect(aadhaar).toEqual(expect.arrayContaining(['234567890124', '2345 6789 0124', '2345-6789-0124']));
    expect(checkForms('mobile', '9845012345', '+91 98450 12345')).toEqual(expect.arrayContaining(['9845012345', '98450 12345', '98450-12345', '+91 98450 12345']));
    expect(checkForms('pan', 'BNZPM2501F', 'BN ZPM2501F')).toEqual(expect.arrayContaining(['BNZPM2501F', 'BN ZPM2501F']));
    expect(checkForms('email', 'r.kumar@example.in', 'R.Kumar@Example.in')).toEqual(expect.arrayContaining(['r.kumar@example.in', 'R.Kumar@Example.in']));
    expect(checkForms('typed', 'sharma & co', 'Sharma &\nCo')).toEqual(expect.arrayContaining(['sharma & co', 'Sharma & Co']));
    expect(checkForms('drawn', '', '')).toEqual([]);
  });
});

describe('typed terms', () => {
  it('matches whole words, ignoring case, with digit separators ignored', () => {
    expect(findTerm('Paid to Sharma & Co; SHARMA signed', 'sharma')).toHaveLength(2);
    expect(findTerm('Pharmacy', 'harm')).toHaveLength(0);
    expect(findTerm('A/c 5010 0123', '50100123')).toHaveLength(1);
    expect(findTerm('A/c 5010-0123', '5010 0123')).toEqual([{ start: 4, end: 13 }]);
    expect(findTerm('Paid to Sharma &\nCo today', 'sharma & co')).toEqual([{ start: 8, end: 19 }]);
    expect(findTerm('\u0915\u0930\u0926\u093e\u0924\u093e \u0915\u093e \u092a\u0948\u0928', '\u0915\u093e')).toHaveLength(1);
  });

  it('lets a code-like term through one kerning space, but not a plain word', () => {
    expect(findTerm('Client ABC 123XYZ listed', 'ABC123XYZ')).toEqual([{ start: 7, end: 17 }]);
    expect(findTerm('went in to the room', 'into')).toHaveLength(0);
  });

  it('takes every character of a term literally and never throws', () => {
    // Wave 2 (ruling 4): what is typed between the term's words is a gap, so the place runs from the first
    // word to the last; no character is read as a regular-expression operator.
    const term = 'a+b(c)[d]{e}|f/g\\h^$.*?-';
    expect(findTerm(`x ${term} y`, term)).toEqual([{ start: 2, end: 2 + term.indexOf('h') + 1 }]);
    expect(findTerm('x a.b y', 'a+b')).toEqual([{ start: 2, end: 5 }]);
    expect(() => findTerm('text \ud800abc', '\ud800abc')).not.toThrow();
    expect(() => findTerm('text', '\\u{zz}')).not.toThrow();
  });

  it('refuses a term that is too short or too long, without repeating it', () => {
    expect(termError('ab')).toMatch(/3 to 100/);
    expect(termError('ab')).not.toContain('ab');
    expect(termError('x'.repeat(101))).toMatch(/3 to 100/);
    expect(termError('   -  ')).not.toBeNull();
    expect(termError('Sharma')).toBeNull();
    expect(TERM_LIMITS).toEqual({ min: 3, max: 100, count: 20 });
  });
});

// ---- fix round 1 ------------------------------------------------------------------------------------

const C = (code: number) => String.fromCharCode(code);
const kv = (found: PatternMatch[]) => found.map((m) => [m.kind, m.key, m.confidence, m.value]);
const GSTIN_OK = `27QZXCV0000W1Z${calculateGstinCheckDigit('27QZXCV0000W1Z')}`;

describe('fix round 1, F1: values written with a space between every character', () => {
  it('finds them, sure by the same label rules, the box covering the whole spaced-out value', () => {
    expect(kv(find('PAN: B N Z P M 2 5 0 1 F'))).toEqual([['pan', 'BNZPM2501F', 'sure', 'B N Z P M 2 5 0 1 F']]);
    expect(find('Holder B N Z P M 2 5 0 1 F').map((m) => [m.kind, m.confidence])).toEqual([['pan', 'possible']]);
    // pdf.js's own reading of "PAN of the assessee: BNZPM2501F, dated 01-04-2025" at 1.2 pt letter-spacing
    const tc = 'P A N o f t h e a s s e s s e e : B N Z P M 2 5 0 1 F , d a t e d 0 1 - 0 4 - 2 0 2 5';
    expect(kv(find(tc))).toEqual([['pan', 'BNZPM2501F', 'sure', 'B N Z P M 2 5 0 1 F']]);
    // a heading where the gap between the label and the value is lost too
    expect(kv(find('P A N B N Z P M 2 5 0 1 F'))).toEqual([['pan', 'BNZPM2501F', 'sure', 'B N Z P M 2 5 0 1 F']]);
    expect(kv(find('Aadhaar: 2 3 4 5 6 7 8 9 0 1 2 4'))).toEqual([['aadhaar', '234567890124', 'sure', '2 3 4 5 6 7 8 9 0 1 2 4']]);
    expect(find('Ref 2 3 4 5 6 7 8 9 0 1 2 4').map((m) => [m.kind, m.confidence])).toEqual([['aadhaar', 'possible']]);
    expect(kv(find(`GSTIN ${GSTIN_OK.split('').join(' ')}`))).toEqual([['gstin', GSTIN_OK, 'sure', GSTIN_OK.split('').join(' ')]]);
    expect(find('Mobile: 9 8 4 5 0 1 2 3 4 5').map((m) => [m.kind, m.key, m.confidence])).toEqual([['mobile', '9845012345', 'sure']]);
    expect(find('r . k u m a r @ e x a m p l e . i n').map((m) => [m.kind, m.key])).toEqual([['email', 'r.kumar@example.in']]);
    expect(kv(find('PAN: B-N-Z-P-M-2-5-0-1-F'))).toEqual([['pan', 'BNZPM2501F', 'sure', 'B-N-Z-P-M-2-5-0-1-F']]);
  });

  it('invents nothing in letter-spaced ordinary words', () => {
    expect(find('S T A T E M E N T O F A C C O U N T S F O R T H E Y E A R')).toEqual([]);
    expect(find('T o t a l 1 2 3 4 5 . 0 0 C r')).toEqual([]);
  });
});

describe('fix round 1, F8: other common written forms', () => {
  it('finds hyphenated codes, labelled forms and grouped numbers', () => {
    expect(find('PAN: BNZPM-2501-F').map((m) => [m.kind, m.key, m.confidence])).toEqual([['pan', 'BNZPM2501F', 'sure']]);
    expect(find('Code BNZPM-2501-F').map((m) => [m.kind, m.confidence, m.reason])).toEqual([['pan', 'possible', 'a space or hyphen splits it; it may be two words']]);
    expect(find('Mobile: 919845012345').map((m) => [m.kind, m.key, m.confidence])).toEqual([['mobile', '9845012345', 'sure']]);
    for (const text of ['+91 98 45 01 23 45', 'Phone (M): 9845012345', 'Mobile: 98450  12345', 'Mobile: +91-\n9845012345', 'Mobile: 9845012\n345']) {
      expect(find(text).map((m) => [m.kind, m.key, m.confidence]), JSON.stringify(text)).toEqual([['mobile', '9845012345', 'sure']]);
    }
    expect(find('Account No :- 50100123456789').map((m) => [m.kind, m.key, m.confidence])).toEqual([['bank-account', '50100123456789', 'sure']]);
    expect(find('MICR Code 400 240 002').map((m) => [m.kind, m.key, m.confidence])).toEqual([['micr', '400240002', 'sure']]);
    expect(find('Acknowledgement No. 1234 5678 9012 345').map((m) => [m.kind, m.key, m.confidence])).toEqual([['itr-ack', '123456789012345', 'sure']]);
    expect(find('DIN ITBA/AST/S/143(1)/2024-25/\n1012345678(1)').map((m) => [m.kind, m.confidence])).toEqual([['tax-din', 'sure']]);
  });

  it('finds a value in small letters as possible', () => {
    expect(find('pan: bnzpm2501f').map((m) => [m.kind, m.key, m.confidence, m.reason])).toEqual([['pan', 'BNZPM2501F', 'possible', 'written in small letters']]);
    expect(find('PAN: Bnzpm2501f').map((m) => [m.kind, m.confidence])).toEqual([['pan', 'possible']]);
    expect(find(`gstin: ${GSTIN_OK.toLowerCase()}`).map((m) => [m.kind, m.key, m.confidence])).toEqual([['gstin', GSTIN_OK, 'possible']]);
    expect(find('din itba/ast/s/143(1)/2024-25/1012345678(1)').map((m) => [m.kind, m.confidence])).toEqual([['tax-din', 'possible']]);
  });

  it('boxes the whole of a spaced or wrapped GSTIN and a wrapped account number', () => {
    const spaced = `GSTIN: 27 QZXCV0000W 1Z${GSTIN_OK[14]}`;
    expect(kv(find(spaced))).toEqual([['gstin', GSTIN_OK, 'sure', `27 QZXCV0000W 1Z${GSTIN_OK[14]}`]]);
    expect(kv(find(`GSTIN: ${GSTIN_OK.slice(0, 12)}\n${GSTIN_OK.slice(12)}`))).toEqual([['gstin', GSTIN_OK, 'sure', `${GSTIN_OK.slice(0, 12)}\n${GSTIN_OK.slice(12)}`]]);
    expect(find(`GSTIN:${GSTIN_OK}Date`).map((m) => [m.kind, m.confidence])).toEqual([['gstin', 'sure']]);
    expect(kv(find('A/c No. 5010012345\n6789'))).toEqual([['bank-account', '50100123456789', 'sure', '5010012345\n6789']]);
  });

  it('finds a PAN that touches the next table cell, sure only with a label', () => {
    expect(find('PAN BNZPM2501F1,234.00').map((m) => [m.kind, m.key, m.confidence])).toEqual([['pan', 'BNZPM2501F', 'sure']]);
    expect(find('Ref BNZPM2501F1,234.00').map((m) => [m.kind, m.confidence, m.reason])).toEqual([['pan', 'possible', 'joined to the characters after it']]);
  });

  it('finds wrapped and upper-case emails, and values with invisible or full-width characters', () => {
    expect(find('r.kumar@example.\nin').map((m) => [m.kind, m.key])).toEqual([['email', 'r.kumar@example.in']]);
    expect(find('R.KUMAR@EXAMPLE.IN').map((m) => [m.kind, m.key])).toEqual([['email', 'r.kumar@example.in']]);
    const soft = `PAN: BNZPM${C(0xad)}2501F`;
    expect(kv(find(soft))).toEqual([['pan', 'BNZPM2501F', 'sure', `BNZPM${C(0xad)}2501F`]]);
    expect(find(`PAN: BNZPM${C(0x200b)}2501F`).map((m) => [m.kind, m.confidence])).toEqual([['pan', 'sure']]);
    const wide = Array.from('BNZPM2501F', (c) => C(c.charCodeAt(0) + 0xfee0)).join('');
    expect(kv(find(`PAN: ${wide}`))).toEqual([['pan', 'BNZPM2501F', 'sure', wide]]);
    const wideAadhaar = Array.from('234567890124', (c) => C(c.charCodeAt(0) + 0xfee0)).join('');
    expect(find(`Aadhaar: ${wideAadhaar}`).map((m) => [m.kind, m.key, m.confidence])).toEqual([['aadhaar', '234567890124', 'sure']]);
  });

  it('keeps an Aadhaar written with double spaces between its groups (mutation M17)', () => {
    expect(find('Aadhaar 2345  6789  0124').map((m) => [m.kind, m.confidence])).toEqual([['aadhaar', 'sure']]);
    expect(find('2345  6789  0124').map((m) => [m.kind, m.confidence])).toEqual([['aadhaar', 'sure']]);
  });
});

describe('fix round 1, F3: the shared normalisation and separator rule', () => {
  it('folds full-width forms and removes invisible characters, keeping a map back to the text', () => {
    const text = `a${C(0xad)}b ${C(0xff22)}${C(0x200b)}c`;
    const f = foldWithMap(text);
    expect(f.text).toBe('ab Bc');
    expect(foldText(text)).toBe('ab Bc');
    expect(f.starts).toEqual([0, 2, 3, 4, 6]);
    expect(f.ends).toEqual([1, 3, 4, 5, 7]);
  });

  const values: [RedactKind, string][] = [
    ['pan', 'BNZPM2501F'],
    ['gstin', GSTIN_OK],
    ['aadhaar', '234567890124'],
    ['mobile', '9845012345'],
    ['bank-account', '50100123456789'],
    ['tan', 'MUMR12345B'],
    ['email', 'r.kumar@example.in'],
    // T-048: every new kind, by its key
    ['passport', 'M5830271'],
    ['voter-id', 'ABC1234567'],
    ['driving-licence', 'MH1420110012345'],
    ['aadhaar-vid', '9123456789012345'],
    ['aadhaar-eid', '12341234512345'],
    ['ckyc', '30012345678901'],
    ['dob', '12031985'],
    ['dob', '12MAR1985'],
    ['uan', '100123456789'],
    ['pf-member', 'MHBAN00123450000012345'],
    ['esic-ip', '3112345678'],
    ['esic-employer', '31000123450000999'],
    ['employee-id', 'E123456'],
    ['card', '4012888812345678'],
    ['upi', '9845012345YBL'],
    ['cheque', '123456'],
    ['loan-account', 'HL20240012345'],
    ['swift', 'QWXYINBB'],
    ['demat', 'IN30987612345678'],
    ['folio', '123456789'],
    ['insurance-policy', '123456789012'],
    ['vehicle', 'MH12AB1234'],
    ['director-din', '01234567'],
    ['cin', 'U72900KA2019PTC123456'],
    ['llpin', 'AAB1234'],
    ['icai-membership', '123456'],
    ['icai-frn', '123456W'],
    ['udin', '25123456ABCDEF1234'],
    ['udyam', 'UDYAMMH260012345'],
    ['iec', '0388012345'],
    ['lei', '5493001234ABCDEF5678'],
    ['challan', '05103081203202512345'],
    ['gst-arn', 'AA270319012345Z'],
    ['eway-bill', '341234567890'],
    ['irn', 'AB12'.repeat(16)],
    ['tds-certificate', 'QWERTYU'],
    ['landline', '2224567890'],
    ['pin-code', '400001'],
  ];
  it('finds every written form of the shared list, and maps it back to the whole of it', () => {
    const missed: string[] = [];
    for (const [kind, key] of values) {
      for (const form of writtenForms(kind, key)) {
        const text = `holds ${form.text} here`;
        const places = placesOfValue(text, kind, key);
        const ok = places.length === 1 && places[0].start === 6 && places[0].end === 6 + form.text.length;
        if (!ok || !valueIn(text, kind, form.text)) missed.push(`${kind}: ${form.name}`);
      }
    }
    expect(missed).toEqual([]);
  });

  it('takes the key of a written form as the find does', () => {
    expect(keyOf('pan', 'bn zpm-2501f')).toBe('BNZPM2501F');
    expect(keyOf('mobile', '+91 98450 12345')).toBe('9845012345');
    expect(keyOf('mobile', '098450 12345')).toBe('9845012345');
    expect(keyOf('email', 'R.Kumar@Example.\nin')).toBe('r.kumar@example.in');
    expect(keyOf('ip', '10.0.0.1')).toBe('10.0.0.1');
    expect(keyOf('typed', '  Sharma &\nCo ')).toBe('sharma & co');
  });

  it('keeps an IP address whole: no digit or dot joined to it', () => {
    expect(placesOfValue('server 110.0.0.12 and 10.0.0.1.', 'ip', '10.0.0.1')).toEqual([{ start: 22, end: 30 }]);
  });
});

describe('fix round 1: typed terms on spaced-out and wrapped text', () => {
  it('finds a term written with spaces between its characters, or wrapped at a hyphen', () => {
    expect(findTerm('Holder B N Z P M 2 5 0 1 F listed', 'BNZPM2501F')).toEqual([{ start: 7, end: 26 }]);
    expect(findTerm('S h a r m a & C o', 'sharma')).toEqual([{ start: 0, end: 11 }]);
    expect(findTerm('P h a r m a c y', 'harm')).toEqual([]);
    expect(findTerm(`Sha${C(0xad)}rma signed`, 'sharma')).toEqual([{ start: 0, end: 7 }]);
    expect(findTerm('BNZPM-\n2501F', 'BNZPM2501F')).toEqual([{ start: 0, end: 12 }]);
    expect(findTerm('Ravi-\nKumar', 'ravi kumar')).toEqual([{ start: 0, end: 11 }]);
  });
});

describe('fix round 1: default ticks', () => {
  it('names the possible kinds no profile ticks by default', () => {
    expect(neverTickedByDefault('tan', 'possible', REASONS.tan)).toBe(true);
    expect(neverTickedByDefault('ifsc', 'possible', REASONS.ifsc)).toBe(true);
    expect(neverTickedByDefault('bank-account', 'possible', REASONS.accountNearIfsc)).toBe(true);
    expect(neverTickedByDefault('aadhaar', 'possible', REASONS.aadhaarUnlabelled)).toBe(true);
    expect(neverTickedByDefault('aadhaar', 'possible', REASONS.aadhaarCheck)).toBe(false);
    expect(neverTickedByDefault('pan', 'possible', REASONS.panType)).toBe(false);
    expect(neverTickedByDefault('tan', 'sure')).toBe(false);
  });

  it('leaves a PAN written with a space between every character, with no label, unticked: a spaced heading reads as one (fix round 2)', () => {
    const [m] = find('Holder B N Z P M 2 5 0 1 F');
    expect([m.kind, m.confidence, m.reason]).toEqual(['pan', 'possible', REASONS.spacedOut]);
    expect(neverTickedByDefault(m.kind, m.confidence, m.reason)).toBe(true);
    const [labelled] = find('PAN: B N Z P M 2 5 0 1 F');
    expect(neverTickedByDefault(labelled.kind, labelled.confidence, labelled.reason)).toBe(false);
  });
});

describe('module memory (fix round 2, MF3)', () => {
  const page = 'Ledger folio 12: PAN BNZPM2501F of the assessee, mobile 98450 12345';
  /** What the engine itself keeps of the last string a regular expression matched (V8's legacy RegExp statics). */
  const regExpStatics = () => {
    const statics = RegExp as unknown as Record<string, unknown>;
    return ['input', 'lastMatch', 'leftContext', 'rightContext', '$1'].map((k) => String(statics[k] ?? '')).join('|');
  };

  it('keeps no page text once the task that searched it ends', async () => {
    expect(placesOfValue(page, 'pan', 'BNZPM2501F')).toHaveLength(1);
    expect(find(page).length).toBeGreaterThan(0);
    expect(findTerm(page, 'the assessee')).toHaveLength(1);
    expect(cachedTextCount()).toBeGreaterThan(0);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(cachedTextCount()).toBe(0);
  });

  it('drops every page text, and what the engine keeps of the last match, on clearRedactCaches', () => {
    placesOfValue(page, 'pan', 'BNZPM2501F');
    find(page);
    expect(cachedTextCount()).toBeGreaterThan(0);
    expect(regExpStatics()).toMatch(/BNZPM|98450|folio/);
    clearRedactCaches();
    expect(cachedTextCount()).toBe(0);
    expect(regExpStatics()).not.toMatch(/BNZPM|98450|folio/);
  });
});

// ---- T-048 (lane RX-PAT): the wider identifier set ---------------------------------------------------------

const NEW_KINDS: FoundKind[] = [
  'passport',
  'voter-id',
  'driving-licence',
  'aadhaar-vid',
  'aadhaar-eid',
  'ckyc',
  'dob',
  'uan',
  'pf-member',
  'esic-ip',
  'esic-employer',
  'employee-id',
  'card',
  'upi',
  'cheque',
  'loan-account',
  'swift',
  'demat',
  'folio',
  'insurance-policy',
  'vehicle',
  'director-din',
  'cin',
  'llpin',
  'icai-membership',
  'icai-frn',
  'udin',
  'udyam',
  'iec',
  'lei',
  'challan',
  'gst-arn',
  'eway-bill',
  'irn',
  'tds-certificate',
  'landline',
  'pin-code',
];
const EVERY: ReadonlySet<RedactGroup> = new Set<RedactGroup>(REDACT_GROUPS);
const findAll = (text: string) => findPatterns(text, EVERY);
const triple = (found: PatternMatch[]) => found.map((m) => [m.kind, m.key, m.confidence]);

describe('T-048: the wider identifier set', () => {
  it('finds every true case of every new kind once, with its key, the whole value and its confidence', () => {
    const failed: string[] = [];
    for (const c of newKindCases()) {
      const hits = findAll(c.text).filter((m) => m.kind === c.kind);
      const ok = hits.length === 1 && hits[0].key === c.key && hits[0].value === c.value && hits[0].confidence === c.confidence;
      if (!ok) failed.push(`${c.name}: ${JSON.stringify(hits.map((h) => [h.key, h.value, h.confidence]))}`);
    }
    expect(failed).toEqual([]);
  });

  it('has a true case and a near miss for every new kind (the shared written-forms list above holds every one too)', () => {
    const cases = new Set(newKindCases().map((c) => c.kind));
    const misses = new Set(newNearMisses().map((c) => c.kind));
    expect(NEW_KINDS.filter((k) => !cases.has(k))).toEqual([]);
    expect(NEW_KINDS.filter((k) => !misses.has(k))).toEqual([]);
  });

  it('finds no match of the kind in its near misses (wrong check digit, wrong length, no keyword, look-alike words)', () => {
    const failed = newNearMisses()
      .filter((c) => findAll(c.text).some((m) => m.kind === c.kind))
      .map((c) => c.name);
    expect(failed).toEqual([]);
  });

  it('gives one place one kind: the precedence between kinds', () => {
    const failed: string[] = [];
    for (const c of overlapCases()) {
      const got = triple(findAll(c.text));
      if (JSON.stringify(got) !== JSON.stringify(c.expect)) failed.push(`${c.name}: ${JSON.stringify(got)}`);
    }
    expect(failed).toEqual([]);
  });

  it('builds its check-digit cases on purpose (the corpus oracle)', () => {
    const v = newKindValues(77);
    expect(luhnOk(v.card())).toBe(true);
    expect(luhnOk(v.cardBad())).toBe(false);
    expect(verhoeffValid(v.vid())).toBe(true);
    expect(verhoeffValid(v.vidBad())).toBe(false);
    const both = v.vidAndCard();
    expect(luhnOk(both) && verhoeffValid(both)).toBe(true);
  });

  it('gives every kind a group, a replacement label, a list name and a record word', () => {
    const groups = new Set(REDACT_GROUPS);
    for (const kind of Object.keys(KIND_GROUP) as FoundKind[]) {
      expect(groups.has(KIND_GROUP[kind]), kind).toBe(true);
      expect(KIND_LABELS[kind], kind).toMatch(/^\[.+ redacted\]$/);
    }
    for (const kind of NEW_KINDS) {
      expect(KIND_GROUP[kind], kind).toBeDefined();
      expect(ADDED_KIND_NAMES[kind as keyof typeof ADDED_KIND_NAMES], kind).toMatch(/\S/);
      expect(ADDED_COUNT_NAMES[kind as keyof typeof ADDED_COUNT_NAMES], kind).toMatch(/\S/);
    }
    expect(Object.keys(ADDED_KIND_NAMES).sort()).toEqual([...NEW_KINDS].sort());
    expect(KIND_GROUP.passport).toBe('identity');
    expect(KIND_GROUP.card).toBe('bank-tax');
    expect(KIND_GROUP.uan).toBe('employment');
    expect(KIND_GROUP.demat).toBe('investments');
    expect(KIND_GROUP.cin).toBe('business');
    expect(KIND_GROUP['director-din']).toBe('business');
    expect(KIND_GROUP['tax-din']).toBe('identity');
    expect(KIND_GROUP.irn).toBe('documents');
    expect(KIND_GROUP.landline).toBe('contact');
    expect(KIND_GROUP['pin-code']).toBe('names');
  });

  it('adds the DPDP profile: every group about a person ticked, possibles too; business and documents off', () => {
    expect(REDACT_GROUPS).toEqual(['identity', 'contact', 'bank-tax', 'employment', 'investments', 'network', 'names', 'documents', 'business']);
    expect(PROFILES.dpdp).toEqual({ ticked: ['identity', 'contact', 'bank-tax', 'employment', 'investments', 'network', 'names'], tickPossible: true });
    for (const p of Object.values(PROFILES)) expect(p.ticked).not.toContain('business');
    expect(PROFILES.balanced.ticked).toEqual(['identity', 'contact', 'bank-tax']);
    expect(PROFILES.identity.ticked).toEqual(['identity']);
  });

  it('never ticks by default the new possibles that are too loose (shape alone, no label)', () => {
    expect(neverTickedByDefault('driving-licence', 'possible', REASONS.dlUnlabelled)).toBe(true);
    expect(neverTickedByDefault('vehicle', 'possible', REASONS.vehicleUnlabelled)).toBe(true);
    expect(neverTickedByDefault('landline', 'possible', REASONS.landlineUnlabelled)).toBe(true);
    expect(neverTickedByDefault('aadhaar-vid', 'possible', REASONS.vidUnlabelled)).toBe(true);
    expect(neverTickedByDefault('udin', 'possible', REASONS.udinUnlabelled)).toBe(true);
    expect(neverTickedByDefault('uan', 'possible', REASONS.labelOnly)).toBe(false);
    expect(neverTickedByDefault('landline', 'possible', REASONS.landlineLabelled)).toBe(false);
    expect(neverTickedByDefault('card', 'sure')).toBe(false);
    const [unlabelled] = findAll('parked MH 12 AB 1234 outside');
    expect(neverTickedByDefault(unlabelled.kind, unlabelled.confidence, unlabelled.reason)).toBe(true);
    const [labelled] = findAll('UAN: 100123456789');
    expect([labelled.kind, labelled.reason]).toEqual(['uan', REASONS.labelOnly]);
  });

  it('gives the reasons of the new possibles', () => {
    const reason = (text: string) => findAll(text).map((m) => [m.kind, m.confidence, m.reason]);
    expect(luhnOk('4012888812345672') && !luhnOk('4012888812345670')).toBe(true);
    expect(reason('Card No: 4012888812345670')).toEqual([['card', 'possible', REASONS.checkDigit]]);
    expect(reason('Card No: 4012888812345672')).toEqual([['card', 'sure', undefined]]);
    expect(reason('Collect from asha99@zetapay')).toEqual([['upi', 'possible', REASONS.upiUnknown]]);
    expect(reason('Holder MH1420110012345 renewed')).toEqual([['driving-licence', 'possible', REASONS.dlUnlabelled]]);
    expect(reason('Tel: 022-24567890')).toEqual([['landline', 'possible', REASONS.landlineLabelled]]);
    expect(reason('Reach us at +91 22 2456 7890')).toEqual([['landline', 'possible', REASONS.landlineUnlabelled]]);
    expect(reason('Ramesh Kumar S/o Suresh Kumar')).toEqual([['name', 'possible', REASONS.relativeName]]);
    expect(reason("Father's Name: Suresh Kumar")).toEqual([['name', 'possible', REASONS.name]]);
  });

  it('takes the key of a written form of the new kinds as the find does', () => {
    expect(keyOf('upi', 'Ramesh.K@OKHDFCBANK')).toBe('RAMESHKOKHDFCBANK');
    expect(keyOf('aadhaar-eid', '1234/12345/12345 12/03/2019 10:20:30')).toBe('12341234512345');
    expect(keyOf('landline', '+91 22 2456 7890')).toBe('2224567890');
    expect(keyOf('landline', '022-24567890')).toBe('2224567890');
    expect(keyOf('landline', '(080) 4123 4567')).toBe('8041234567');
    expect(keyOf('dob', '12-Mar-1985')).toBe('12MAR1985');
    expect(keyOf('card', '4012 8888 1234 5678')).toBe('4012888812345678');
    expect(keyOf('cin', 'u72900ka2019ptc123456')).toBe('U72900KA2019PTC123456');
  });

  it('finds every place of a new value by the shared rule, UPI with its @ and the enrolment number with its date', () => {
    expect(placesOfValue('Paid 9845012345@ybl and 9845012345 @ ybl', 'upi', '9845012345YBL')).toHaveLength(2);
    expect(valueIn('to RAMESH.K@OKHDFCBANK', 'upi', 'ramesh.k@okhdfcbank')).toBe(true);
    expect(valueIn('EID 1234/12345/12345', 'aadhaar-eid', '1234/12345/12345 12/03/2019 10:20:30')).toBe(true);
    expect(valueIn('Call 022 2456 7890', 'landline', '+91 22 2456 7890')).toBe(true);
    expect(valueIn('C I N U 7 2 9 0 0 K A 2 0 1 9 P T C 1 2 3 4 5 6', 'cin', 'U72900KA2019PTC123456')).toBe(true);
  });

  it('takes short numbers (6 to 8 digits) only where no digit is joined to them', () => {
    expect(placesOfValue('PIN 400001; ref 14000012; 4000011', 'pin-code', '400001')).toEqual([{ start: 4, end: 10 }]);
    expect(placesOfValue('Chq 123456 and 9123456', 'cheque', '123456')).toEqual([{ start: 4, end: 10 }]);
    expect(placesOfValue('DOB 12/03/1985, ref 112031985', 'dob', '12031985')).toEqual([{ start: 4, end: 14 }]);
    expect(placesOfValue('DIN 01234567 and 9012345678', 'director-din', '01234567')).toEqual([{ start: 4, end: 12 }]);
    // longer keys keep the old rule: found inside longer runs too
    expect(placesOfValue('x 91001234567890', 'uan', '100123456789')).toHaveLength(1);
  });

  it('masks the new kinds without showing the whole value', () => {
    expect(maskValue('card', '4012888812345678')).toBe('XXXX XXXX XXXX 5678');
    expect(maskValue('aadhaar-vid', '9123456789012345')).toBe('XXXX XXXX XXXX 2345');
    expect(maskValue('dob', '12031985')).toBe('XX/XX/XXXX');
    expect(maskValue('upi', '9845012345YBL')).toBe('XXXXXXXXXX@ybl');
    expect(maskValue('upi', 'ASHA99ZETAPAY')).toBe('XXXX@XXXX');
    expect(maskValue('uan', '100123456789')).toBe('XXXXXXXX6789');
    expect(maskValue('cin', 'U72900KA2019PTC123456')).toBe('XXXXXXXXXXXXXXXXX3456');
    for (const kind of NEW_KINDS) {
      const key = 'AB12CD34EF56GH78';
      expect(maskValue(kind, key), kind).not.toBe(key);
    }
  });

  it('lists the forms the check looks for, grouped forms included for cards and virtual IDs', () => {
    expect(checkForms('card', '4012888812345678', '4012 8888 1234 5678')).toEqual(expect.arrayContaining(['4012888812345678', '4012 8888 1234 5678', '4012-8888-1234-5678']));
    expect(checkForms('aadhaar-vid', '9123456789012345', '9123456789012345')).toEqual(expect.arrayContaining(['9123 4567 8901 2345', '9123-4567-8901-2345']));
    expect(checkForms('upi', '9845012345YBL', '9845012345@YBL')).toEqual(expect.arrayContaining(['9845012345YBL', '9845012345@YBL', '9845012345@ybl']));
    expect(checkForms('dob', '12031985', '12/03/1985')).toEqual(expect.arrayContaining(['12031985', '12/03/1985']));
  });

  // The hits the new kinds add to the old synthetic documents, shown in the test names.
  const ordinary = ordinaryLines();
  const statement = statementLines(9000);
  const count = (texts: string[], groups: ReadonlySet<RedactGroup>) => {
    const out: Record<string, number> = {};
    for (const t of texts) for (const m of findPatterns(t, groups)) if ((NEW_KINDS as string[]).includes(m.kind)) out[`${m.kind} ${m.confidence}`] = (out[`${m.kind} ${m.confidence}`] ?? 0) + 1;
    return out;
  };
  const onOrdinary = count(ordinary, EVERY);
  const onOrdinaryOldGroups = count(ordinary, ALL);
  const onStatement = count(statement, EVERY);
  it(`adds no sure match of a new kind to ordinary text, except the labelled CIN, UDIN and vehicle numbers it holds (5,000 lines: ${JSON.stringify(onOrdinary)})`, () => {
    const sure = Object.keys(onOrdinary).filter((k) => k.endsWith(' sure'));
    expect(sure.sort()).toEqual(['cin sure', 'udin sure', 'vehicle sure']);
    // the old five groups see no new sure match there at all
    expect(Object.keys(onOrdinaryOldGroups).filter((k) => k.endsWith(' sure'))).toEqual([]);
  });
  it(`adds nothing to bank-statement narrations (9,000 lines: ${JSON.stringify(onStatement)})`, () => {
    expect(onStatement).toEqual({});
  });
});

describe('T-048 wave 2: typed words by the one loose rule (ruling 4; redact-retest-1.md R7, rx2-contract.md (a))', () => {
  // The re-tester's eleven separators (R7: en dash, em dash, middle dot, bullet, slash, semicolon, colon, four
  // dots, ampersand, apostrophe, brackets), a mixed one, and none at all.
  const SEPARATORS = [C(0x2013), C(0x2014), C(0xb7), C(0x2022), '/', ';', ':', '....', ' & ', "'", ') (', ' .  ,_ - \n', ''];

  it("finds a typed phrase whatever stands between its words, at the same places as the check's loose rule", () => {
    for (const sep of SEPARATORS) {
      const written = `Ramesh${sep}Kumar${sep}Gupta`;
      const text = `Contact: ${written} end`;
      const expected = [{ start: 9, end: 9 + written.length }];
      expect(findTerm(text, 'Ramesh Kumar Gupta'), JSON.stringify(sep)).toEqual(expected);
      expect(placesOfValue(text, 'typed', 'ramesh kumar gupta'), JSON.stringify(sep)).toEqual(expected);
      expect(loosePlacesOf(text, 'typed', 'Ramesh Kumar Gupta'), JSON.stringify(sep)).toEqual(expected);
      expect(valueIn(text, 'typed', 'Ramesh Kumar Gupta'), JSON.stringify(sep)).toBe(true);
      expect(placesOfValue(text, 'name', 'ramesh kumar gupta'), JSON.stringify(sep)).toEqual(expected);
    }
    // marks typed between the words are a gap too
    expect(findTerm('Paid RAMESH KUMAR GUPTA', 'Ramesh/Kumar-Gupta')).toEqual([{ start: 5, end: 23 }]);
  });

  it('never finds a word inside a longer word, and agrees with the check there too', () => {
    for (const text of ['Shri Ramesh Dasgupta', 'ShriRameshKumarGupta', 'RameshKumarGuptaji', 'Ramesh Kumari Gupta']) {
      expect(findTerm(text, 'Ramesh Kumar Gupta'), text).toEqual([]);
      expect(loosePlacesOf(text, 'typed', 'Ramesh Kumar Gupta'), text).toEqual([]);
    }
    expect(findTerm('Mr Dasgupta signed', 'Gupta')).toEqual([]);
    expect(findTerm('Pharmacy', 'harm')).toEqual([]);
  });

  it('keeps codes, numbers and letter-spaced words', () => {
    expect(findTerm('Client ABC 123XYZ listed', 'ABC123XYZ')).toEqual([{ start: 7, end: 17 }]);
    expect(findTerm('Ref ABC-123 listed', 'ABC-123')).toEqual([{ start: 4, end: 11 }]);
    expect(findTerm('A/c 5010/0123 and 950100123', '50100123')).toEqual([{ start: 4, end: 13 }]);
    expect(findTerm('Holder S h a r m a listed', 'Sharma')).toEqual([{ start: 7, end: 18 }]);
  });

  it('states the rule in two plain sentences, line breaks and a word broken at a line end included (wave 3b)', () => {
    const sentences = TERM_RULE.split(/(?<=\.)\s+/).filter(Boolean);
    expect(sentences.length).toBeLessThanOrEqual(2);
    expect(TERM_RULE).toMatch(/whole words/);
    expect(TERM_RULE).toMatch(/spaces, punctuation, a line break or nothing/);
    expect(TERM_RULE).toMatch(/word broken by a hyphen at a line end/);
    expect(TERM_RULE).toMatch(/file name/);
    expect(TERM_RULE.length).toBeLessThan(200);
  });
});

// ---- T-048 wave 4 (lane RX-PAT2): a number ends where its own digits end (ruling H; ruling K6) ---------------

/** The one match of `kind` in `text` as [value, key, confidence]; null when there is none; every match when more. */
const one = (text: string, kind: RedactKind) => {
  const hits = findAll(text).filter((m) => m.kind === kind);
  if (hits.length === 0) return null;
  return hits.length === 1 ? [hits[0].value, hits[0].key, hits[0].confidence] : hits.map((m) => [m.value, m.key, m.confidence]);
};
/**
 * The phrases whose one match of `kind` does not have the key of `value` (the number itself, as keyOf gives it) and
 * `confidence`, or does not start with `value` (null value: no match at all). Wave 5 (ruling T): the key is the number
 * itself; the covered place may run on over the digit groups after it (tested on its own below).
 */
const misread = (cases: readonly (readonly [string, string | null])[], kind: RedactKind, confidence: 'sure' | 'possible' = 'sure') =>
  cases
    .filter(([text, value]) => {
      const got = one(text, kind);
      if (value === null || got === null) return got !== null || value !== null;
      const [written, key, sureness] = got;
      return !(typeof written === 'string' && written.startsWith(value) && key === keyOf(kind, value) && sureness === confidence);
    })
    .map(([text]) => `${JSON.stringify(text)} -> ${JSON.stringify(one(text, kind))}`);

/** Re-test 3, lane T3-B (finding 2): the 34 ordinary phrasings of a labelled account from its three rule-level lists. */
const ACCOUNT_34: readonly (readonly [string, string])[] = [
  ['A/c 50100123456789\n01/10/2026 UPI/DR', '50100123456789'],
  ['Account No. 50100123456789 12,400.00 Cr', '50100123456789'],
  ['Account No: 50100123456789\n411045 Pune', '50100123456789'],
  ['Bank A/c No. 50100123456789 IFSC ZETA0123456', '50100123456789'],
  ['A/c 50100123456789 01/10/2026', '50100123456789'],
  ['Savings account 50100123456789\n2 November 2026', '50100123456789'],
  ['Account Number : 50100123456789\nCustomer ID : 40021877', '50100123456789'],
  ['A/c No 50100123456789 Branch 0417', '50100123456789'],
  ['Account No. 50100123456789\t\t1,24,000.00', '50100123456789'],
  ['Bank account no. 50100200300400 100900000000 01/01/1970', '50100200300400'],
  ['Account no. 50100123456789/01', '50100123456789'],
  ['A/c 50100123456789, 12 Oct 2026', '50100123456789'],
  ['A/c No.50100123456789 Rs. 1,000', '50100123456789'],
  ['A/c No. 50100123456789 (2)', '50100123456789'],
  ['Loan account no. 1234567890 12 EMI', '1234567890'],
  ['Demat a/c 1203450000123456 12', '1203450000123456'],
  ['Customer ID 40021877 Account No 50100123456789 1 of 4', '50100123456789'],
  ['Account No 50100123456789 Page 1', '50100123456789'],
  ['Account Number 50100123456789 3 October 2026', '50100123456789'],
  ['A/c 5010 0123 4567 89 1,200.00', '5010 0123 4567 89'],
  ['Bank A/c 50100123456789  412,345.50', '50100123456789'],
  ['Account No.: 50100123456789\n1. Opening balance', '50100123456789'],
  ['SB A/c 50100123456789 @ 3.5%', '50100123456789'],
  ['Account 50100123456789 - 2 joint holders', '50100123456789'],
  ['Loan A/c No. 1234567890 12 EMIs', '1234567890'],
  ['Demat account no. 1203450000123456 100 shares', '1203450000123456'],
  ['Savings 50100123456789\n12 October 2026', '50100123456789'],
  ['Current account 50200987654321 2 signatories', '50200987654321'],
  ['Account no. 50100123456789 24x7 helpline', '50100123456789'],
  ['OD A/c 50100123456789 10,00,000 limit', '50100123456789'],
  ['SB 50100123456789 3.5%', '50100123456789'],
  ['Account No. 501001234567 89 days', '501001234567'],
  ['Account Number\n50100123456789\n12,400.00', '50100123456789'],
  ['IFSC ZETA0123456 Account 50100123456789 MICR 411002003', '50100123456789'],
];

/** My own variations, as statements, forms and tables print an account number (null: no account number there). */
const ACCOUNT_VARIATIONS: readonly (readonly [string, string | null])[] = [
  // on the same line after it: a balance, a date, a time, a rate, a count, a page, an IFSC, a branch code, a cheque number
  ['A/C NO.: 50100123456789 12,400.00', '50100123456789'],
  ['Acct. No. 50100123456789 | 12,400.00 Dr', '50100123456789'],
  ['Account No :- 50100123456789 31.10.2026', '50100123456789'],
  ['A/c No. 50100123456789 01-10-2026 12,400.00', '50100123456789'],
  ['A/c No. 50100123456789 12:30 PM', '50100123456789'],
  ['A/c No. 50100123456789 3.5% p.a.', '50100123456789'],
  ['A/c No. 50100123456789 12 EMIs of 10,000', '50100123456789'],
  ['Account No. 50100123456789 Page 1 of 4', '50100123456789'],
  ['SB A/c 50100123456789 IFSC ZETA0123456 Branch Code 0417', '50100123456789'],
  ['SB A/c No. 50100123456789 0417', '50100123456789'],
  ['A/c No. 50100123456789 200417', '50100123456789'],
  ['A/c No. 50100123456789 Chq No. 200417', '50100123456789'],
  // a line break after it
  ['Account Number: 50100123456789\n12/10/2026 NEFT', '50100123456789'],
  ['Account Number\n50100123456789\n2 of 6', '50100123456789'],
  ['Beneficiary A/c No. 50100123456789\n1 Opening Balance', '50100123456789'],
  ['Account No. 501001234567\n89 days overdue', '501001234567'],
  ['A/c 50100123456789\n7', '50100123456789'],
  // 9 to 18 digits
  ['A/c 123456789 1 of 2', '123456789'],
  ['A/c No. 30123456789 31/10/2026 1,24,000.00 Cr', '30123456789'],
  ['A/c No. 0731234567001 2 Nov 2026', '0731234567001'],
  ['A/c 123456789012345678 2 of 4', '123456789012345678'],
  // printed in groups
  ['A/c 5010-0123-4567-89 12,400.00', '5010-0123-4567-89'],
  ['A/c No.: 073-123456-001 3 cheques', '073-123456-001'],
  ['A/c No. 5010 0123 4567 89 3 EMI', '5010 0123 4567 89'],
  ['A/c 5010 0123 4567 8912 12 Oct 2026', '5010 0123 4567 8912'],
  ['A/c 5010 0123 4567 89\n12 October 2026', '5010 0123 4567 89'],
  ['A/c 5010 0123 4567 12/10/2026', '5010 0123 4567'],
  ['A/c 5010 0123 4567 12 Oct 2026', '5010 0123 4567'],
  ['Loan A/c 5010 0123 4567 8912 12 EMIs', '5010 0123 4567 8912'],
  ['Savings A/c 2345 6789 0124 and mobile +91 98450 12345', '2345 6789 0124'],
  // right after its label, a number broken by a gap is still one number (as before wave 4)
  ['A/c No. 50100 123456789', '50100 123456789'],
  // a space or a hyphen between every digit (letter-spaced): one number
  ['A/c No. 5 0 1 0 0 1 2 3 4 5 6 7 8 9 dated 01/10/2026', '5 0 1 0 0 1 2 3 4 5 6 7 8 9'],
  ['Account No: 5-0-1-0-0-1-2-3-4-5-6-7-8-9', '5-0-1-0-0-1-2-3-4-5-6-7-8-9'],
  // a table row read across
  ['A/c No.\t50100123456789\t01/10/2026', '50100123456789'],
  ['Account No. 50100123456789 ZETA0123456 Pune Main 12,400.00 Cr', '50100123456789'],
  // masked: no account number to find
  ['A/c No. XXXXXXXX6789 12,400.00', null],
  ['A/c No. XXXX XXXX 6789', null],
  ['A/c No. ******6789 dated 01/10/2026', null],
];

/** Payment cards followed by an expiry, an EMI count, a page count or another group. */
const CARD_CASES: readonly (readonly [string, string])[] = [
  ['Credit card 4111111111111111 12/28', '4111111111111111'],
  ['Card No. 4111 1111 1111 1111 3 EMI', '4111 1111 1111 1111'],
  ['Card no 4111111111111111 3 EMI', '4111111111111111'],
  ['Card No. 4111 1111 1111 1111\n12/28', '4111 1111 1111 1111'],
  ['Debit card 4111111111111111\n2 add-on cards', '4111111111111111'],
  ['Card No. 4111 1111 1111 1111 12/28', '4111 1111 1111 1111'],
  ['Card No: 4111-1111-1111-1111 Exp 12/28', '4111-1111-1111-1111'],
  ['Credit card no. 4111111111111111 1 of 2', '4111111111111111'],
  ['Debit Card 4111 1111 1111 1111 123 EMIs', '4111 1111 1111 1111'],
  ['Paid by 4111 1111 1111 1111 3 EMIs', '4111 1111 1111 1111'],
  ['Paid by 4111 1111 1111 1111 12 Oct', '4111 1111 1111 1111'],
];

describe('T-048 wave 4 (ruling H): an account or card number ends where its own digits end', () => {
  it('reads the 34 ordinary phrasings of a labelled account as the account number alone (re-test 3, T3-B finding 2)', () => {
    expect(ACCOUNT_34).toHaveLength(34);
    expect(misread(ACCOUNT_34, 'bank-account')).toEqual([]);
  });

  it('reads the account number alone as statements, forms and tables print it, and nothing in a masked one', () => {
    expect(ACCOUNT_VARIATIONS.length).toBeGreaterThanOrEqual(20);
    expect(misread(ACCOUNT_VARIATIONS, 'bank-account')).toEqual([]);
  });

  it('looks for the account number itself everywhere else on the page (recipe H42)', () => {
    const page = [
      'Statement of account',
      'Account No. 50100123456789 12,400.00 Cr',
      'A/c 50100123456789  01/10/2026 to 31/10/2026',
      '01/10/2026 TRF TO 50100123456789 SWEEP 1,200.00 11,200.00',
      '02/10/2026 NEFT-ZETA0123456-ORCHARD TRADERS-50100123456789 500.00 10,700.00',
      '03/10/2026 INT.PD:50100123456789:01-07-2026 12.00 10,712.00',
      'The closing balance of 50100123456789 is credited to 50100123456789.',
    ].join('\n');
    const accounts = findAll(page).filter((m) => m.kind === 'bank-account' && m.confidence === 'sure');
    expect(accounts.map((m) => m.key)).toEqual(['50100123456789', '50100123456789']);
    expect(placesOfValue(page, 'bank-account', accounts[0].key)).toHaveLength(7);
  });

  it('joins a number wrapped onto the next line only when that line holds its digits alone, and not when the page shows the shorter number alone', () => {
    // fix round 1, F8: a number wrapped in a narrow cell is boxed in both parts
    expect(one('A/c No. 5010012345\n6789', 'bank-account')).toEqual(['5010012345\n6789', '50100123456789', 'sure']);
    expect(one('A/c No. 5010012345\n6789\nTRF TO 50100123456789 SWEEP', 'bank-account')).toEqual(['5010012345\n6789', '50100123456789', 'sure']);
    // the page shows the account alone elsewhere: the next line is something else, not part of the number looked for
    // (wave 5, ruling T: it is covered with the number all the same, as a tail it may be)
    expect(one('A/c 50100123456789\n1234\nTRF TO 50100123456789 SWEEP', 'bank-account')).toEqual(['50100123456789\n1234', '50100123456789', 'sure']);
    // groups across a line break only while the number is still too short to be one
    expect(one('A/c No. 5010 0123\n4567 89', 'bank-account')).toEqual(['5010 0123\n4567 89', '50100123456789', 'sure']);
    expect(one('A/c 5010 0123 4567\n12 EMIs paid', 'bank-account')).toEqual(['5010 0123 4567\n12', '501001234567', 'sure']);
    // a serial number before an account next to an IFSC is not part of it
    expect(one('1 50100123456789 ZETA0123456', 'bank-account')).toEqual(['50100123456789', '50100123456789', 'possible']);
  });

  it('reads a card number without its expiry, an EMI count or the next group, sure when its check digit holds (K6)', () => {
    expect(misread(CARD_CASES, 'card')).toEqual([]);
    expect(findAll('Paid by 4111 1111 1111 1111 12 Oct').map((m) => m.kind)).toEqual(['card']);
    // a 19-digit card printed 4-4-4-4-3 keeps its last group when only all 19 digits pass the check
    let long = '';
    for (let n = 0; long === ''; n++) {
      const body = `62${String(n).padStart(16, '0')}`;
      const full = body + luhnCheckDigit(body);
      if (!luhnOk(full.slice(0, 16))) long = full;
    }
    const written = `${long.slice(0, 4)} ${long.slice(4, 8)} ${long.slice(8, 12)} ${long.slice(12, 16)} ${long.slice(16)}`;
    expect(one(`Card No. ${written} valid till 12/30`, 'card')).toEqual([written, long, 'sure']);
    expect(one(`Paid by ${written} on 12 March`, 'card')).toEqual([written, long, 'sure']);
  });

  it('reads the other numeric kinds without the digits after them', () => {
    const cases: [string, RedactKind, (string | null)[] | null][] = [
      ['Aadhaar 2345 6789 0124 12,400.00', 'aadhaar', ['2345 6789 0124', '234567890124', 'sure']],
      ['Aadhaar No. 2345 6789 0124\n1 of 4', 'aadhaar', ['2345 6789 0124', '234567890124', 'sure']],
      ['Mobile 9876501234 12,400.00', 'mobile', ['9876501234', '9876501234', 'sure']],
      ['Mobile: +91 98765 01234\n12/10/2026', 'mobile', ['+91 98765 01234', '9876501234', 'sure']],
      ['UAN 1009 8765 4321 3 months', 'uan', ['1009 8765 4321', '100987654321', 'possible']],
      ['IFSC ZETA0123456 0417', 'ifsc', ['ZETA0123456', 'ZETA0123456', 'sure']],
      ['MICR Code 411 002 003 1 of 2', 'micr', ['411 002 003', '411002003', 'sure']],
      ['Acknowledgement No. 1234 5678 9012 345 6 copies', 'itr-ack', ['1234 5678 9012 345', '123456789012345', 'sure']],
      ['CKYC No. 1234 5678 9012 34 5 docs', 'ckyc', ['1234 5678 9012 34', '12345678901234', 'possible']],
      ['E-way bill no. 3412 3456 7890 12 Oct', 'eway-bill', ['3412 3456 7890', '341234567890', 'possible']],
      ['Cheque No. 200417 12,400.00', 'cheque', ['200417', '200417', 'possible']],
      ['PIN code 411045 1 of 2', 'pin-code', ['411045', '411045', 'possible']],
      ['Tel: 022-24567890 2 lines', 'landline', ['022-24567890', '2224567890', 'possible']],
      // an ESIC insurance number (10 digits) is not an employer code (17) with the next number read into it
      ['ESIC No. 3100123456 1234567', 'esic-ip', ['3100123456', '3100123456', 'possible']],
      ['ESIC No. 3100123456 1234567', 'esic-employer', null],
    ];
    expect(cases.map(([text, kind]) => one(text, kind))).toEqual(cases.map(([, , expected]) => expected));
  });
});

describe('T-048 wave 4 (ruling K6): labelled values that were missed or only possible', () => {
  it('finds a mobile number after a phone word in a sentence as sure, and leaves other numbers in sentences possible', () => {
    for (const text of ['the mobile number on record is 98765 01234 and', 'or call 98765 01234 for details', 'please call me on 98765 01234', 'Mobile number registered with the bank is 98765 01234.']) {
      expect(one(text, 'mobile'), text).toEqual(['98765 01234', '9876501234', 'sure']);
    }
    expect(one('called on 12.03.2025 about 98765 01234', 'mobile')).toEqual(['98765 01234', '9876501234', 'possible']);
    expect(one('the invoice number on record is 98765 01234', 'mobile')).toEqual(['98765 01234', '9876501234', 'possible']);
  });

  it('finds an acknowledgement number whose label wraps over the lines of its cell', () => {
    for (const text of ['Acknowledgement\nNumber\n628812340151126', 'Acknowledgement\nNo.\n628812340151126', 'Ack.\nNumber 628812340151126', 'e-Filing Acknowledgement\nNumber : 628812340151126']) {
      expect(one(text, 'itr-ack'), text).toEqual(['628812340151126', '628812340151126', 'sure']);
    }
    expect(one('We acknowledge\n628812340151126', 'itr-ack')).toBeNull();
    expect(one('Acknowledgement received\nRef 628812340151126', 'itr-ack')).toBeNull();
  });
});

// Invented look-alikes of the owner's two samples (SAMPLE-report.md): no value comes from those files.
const ITR_V = [
  'INDIAN INCOME TAX RETURN ACKNOWLEDGEMENT',
  'Assessment Year 2026-27',
  'PAN QZXCV0000W',
  'Name RAMESH KUMAR GUPTA',
  'Address FLAT 12, ORCHARD RESIDENCY, BANER ROAD, PUNE, MAHARASHTRA, 411045',
  'Status Individual Form Number ITR-1',
  'e-Filing Acknowledgement Number 628812340151126 Date of e-Filing 31-Jul-2026',
  'This return has been digitally verified by RAMESH KUMAR GUPTA having PAN QZXCV0000W from IP address 103.25.067.14 on 31-07-2026 at PUNE.',
].join('\n');
const NOTICE_PAGE_1 = [
  'To,',
  'M/S ORCHARD TRADERS PVT LTD',
  'PLOT 7, KESTREL INDUSTRIAL ESTATE',
  'PUNE, MAHARASHTRA - 411045',
  'Government of India',
  'Ministry of Finance',
  'Income Tax Department',
  'Notice under section 142(1) of the Income-tax Act, 1961',
  'The website address of the e-filing portal has been changed.',
].join('\n');
const values = (text: string, kind: RedactKind) => findAll(text).filter((m) => m.kind === kind).map((m) => [m.value, m.confidence]);

describe('T-048 wave 4 (coordinator, SAMPLE-report.md): what an ITR acknowledgement and a notice carry', () => {
  it('finds a name and an address in a table cell with no colon after the label, and the name before "having PAN"', () => {
    expect(values(ITR_V, 'name')).toEqual([
      ['RAMESH KUMAR GUPTA', 'possible'],
      ['RAMESH KUMAR GUPTA', 'possible'],
    ]);
    expect(values(ITR_V, 'address')).toEqual([['FLAT 12, ORCHARD RESIDENCY, BANER ROAD, PUNE, MAHARASHTRA, 411045', 'possible']]);
    // a cell gap, a longer label, a value cut by the next cell, Title case after a cell gap
    expect(values('Name\tRamesh Kumar Gupta', 'name')).toEqual([['Ramesh Kumar Gupta', 'possible']]);
    expect(values('Name of the Assessee RAMESH KUMAR GUPTA', 'name')).toEqual([['RAMESH KUMAR GUPTA', 'possible']]);
    expect(values('Name RAMESH KUMAR GUPTA Status Individual', 'name')).toEqual([['RAMESH KUMAR GUPTA', 'possible']]);
    expect(values('verified by Devi Rao having PAN QZXCV0000W', 'name')).toEqual([['Devi Rao', 'possible']]);
    // the address after, before, above or below its label, and wrapped in its cell down to its PIN code
    const address = 'FLAT 12, ORCHARD RESIDENCY, PUNE 411045';
    for (const text of [`${address} Address`, `${address}\nAddress\nStatus Individual`, `Address\n${address}`, `Address\t${address}`]) {
      expect(values(text, 'address'), text).toEqual([[address, 'possible']]);
    }
    expect(values('Residential Address FLAT 12, ORCHARD RESIDENCY, BANER\nROAD, PUNE, MAHARASHTRA, 411045\nStatus Individual', 'address')).toEqual([
      ['FLAT 12, ORCHARD RESIDENCY, BANER\nROAD, PUNE, MAHARASHTRA, 411045', 'possible'],
    ]);
  });

  it('takes no heading, sentence or column title for a name or an address', () => {
    for (const text of [
      'NAME AND ADDRESS OF THE EMPLOYER',
      'Name the documents you rely on.',
      'EMPLOYEE NAME PAN AADHAAR NO.',
      'Name of the Bank STATE BANK OF INDIA',
      'Name of the e-filing portal user',
      'Address the points raised in the notice, Pune office',
      'Address the points on tax, interest, penalty and fees',
      'Email address r.kumar@example.com',
      'The website address of the e-filing portal has been changed.',
    ]) {
      expect(findAll(text).filter((m) => m.kind === 'name' || m.kind === 'address').map((m) => m.value), text).toEqual([]);
    }
  });

  it('finds an IP address with a zero-padded group, and still no version number', () => {
    expect(one('from IP address 103.25.067.14 on 31-07-2026', 'ip')).toEqual(['103.25.067.14', '103.25.067.14', 'sure']);
    expect(one('IP: 010.001.002.003', 'ip')).toEqual(['010.001.002.003', '010.001.002.003', 'sure']);
    expect(findAll('Version 1.02.003.04 of the software')).toEqual([]);
  });

  it('ends the "To," block at its PIN code or at a letterhead line, and offers its first line as a name to look for everywhere', () => {
    const found = findAll(NOTICE_PAGE_1).filter((m) => m.kind === 'name' || m.kind === 'addressee' || m.kind === 'address');
    expect(found.map((m) => [m.kind, m.value, m.reason])).toEqual([
      ['name', 'M/S ORCHARD TRADERS PVT LTD', REASONS.addresseeName],
      ['addressee', 'PLOT 7, KESTREL INDUSTRIAL ESTATE\nPUNE, MAHARASHTRA - 411045', REASONS.addressee],
    ]);
    // the find looks for every value on every page: the name in a later page's header is a place of it
    expect(placesOfValue('PAN: QZXCV0000W M/S ORCHARD TRADERS PVT LTD Page 2 of 2', 'name', found[0].key)).toHaveLength(1);
    // no PIN code: the letterhead still ends the block; a PIN code ends it before any other line
    expect(values('To,\nRAMESH KUMAR GUPTA\nFLAT 12, ORCHARD RESIDENCY\nGovernment of India\nMinistry of Finance', 'addressee')).toEqual([['FLAT 12, ORCHARD RESIDENCY', 'possible']]);
    expect(values('To,\nRAMESH KUMAR GUPTA\nFLAT 12, PUNE 411045\nFaceless Assessment Centre\nDelhi', 'addressee')).toEqual([['FLAT 12, PUNE 411045', 'possible']]);
    // a designation is not a name: the block stays whole
    expect(values('To,\nThe Assessing Officer\nWard 12(3), Mumbai\n\nSubject: Reply', 'addressee')).toEqual([['The Assessing Officer\nWard 12(3), Mumbai', 'possible']]);
  });

  it('words every reason in plain words', () => {
    expect(REASONS.panType).toBe('does not look like a valid PAN');
    for (const reason of Object.values(REASONS)) expect(reason).not.toMatch(/holder type|check digit|check character|handle/i);
    expect(findAll('PAN QZXDV0000W entered').map((m) => [m.kind, m.confidence, m.reason])).toEqual([['pan', 'possible', 'does not look like a valid PAN']]);
  });
});

// ---- T-048 wave 5 (lane RX-PAT3): rulings T and U after re-test 4 (lane T4-B) ----------------------------------

const digitCount = (s: string) => s.replace(/\D/g, '').length;
/** The matches of an account or card number in `text`, the sure one first. */
const numbersIn = (text: string) =>
  findAll(text)
    .filter((m) => m.kind === 'bank-account' || m.kind === 'card' || m.kind === 'loan-account')
    .sort((a, b) => Number(b.confidence === 'sure') - Number(a.confidence === 'sure'));
/** What the find covers of `text` for a key (coveredPlacesOfValue), as written. */
const covers = (text: string, kind: RedactKind, key: string) => coveredPlacesOfValue(text, kind, key).map((p) => text.slice(p.start, p.end));
/** Where the key itself stands in `text` (placesOfValue: the rule the check and the reading of each drawing share), as written. */
const stands = (text: string, kind: RedactKind, key: string) => placesOfValue(text, kind, key).map((p) => text.slice(p.start, p.end));
/** Four other ways a statement writes the number `n` (re-test 4, lane T4-B's rule-level check). */
const otherWritings = (n: string) => [`TRF TO ${n} SWEEP`, `NEFT-ZETAN26288-ORCHARD-${n}-ZETA0123456`, `credited to ${n.replace(/(\d{4})(?=\d)/g, '$1 ')}.`, `INT.PD:${n}:01-07-2026`];

/** Re-test 4, lane T4-B: its 30 phrasings, each with the full number a person reads in it. */
const PHRASINGS_30: readonly (readonly [string, string])[] = [
  ['Account Number 1234 5678 9012 3456 78', '123456789012345678'],
  ['Account No. 5010 0123 4567 8901 23', '501001234567890123'],
  ['Account No. 5010 0123 456789', '50100123456789'],
  ['A/c No. 012 345 678 9012', '0123456789012'],
  ['A/c No. 501 0012 3456', '50100123456'],
  ['A/c No. 501001 23456789', '50100123456789'],
  ['A/c No. 0123-456789-012', '0123456789012'],
  ['A/c No. 50 1001 2345 6789', '50100123456789'],
  ['A/c No. 50100 12345 6789', '50100123456789'],
  ['A/c No. 5010012 3456789', '50100123456789'],
  ['A/c No.\n5010 0123 4567\n89 (Savings)', '50100123456789'],
  ['A/c No. 5010 0123\n4567 89', '50100123456789'],
  ['Account Number : 00000030012345678', '00000030012345678'],
  ['Account No. 123456789 012345', '123456789012345'],
  ['A/c 50100123456789 10:42 AM', '50100123456789'],
  ['Account No. 50100123456789 (0417)', '50100123456789'],
  ['Account: 50100123456789 1/4', '50100123456789'],
  ['Account No.\n50100123456789\n12,400.00', '50100123456789'],
  ['SB A/c 50100123456789 INR', '50100123456789'],
  ['Beneficiary A/c 50100123456789, IFSC ZETA0123456', '50100123456789'],
  ['Account No. 5010 0123 4567 89 Cr 12,400.00', '50100123456789'],
  ['A/c No. 5010 0123 4567 89 1 of 4', '50100123456789'],
  ['Loan account no. 1234567890', '1234567890'],
  ['A/c No. 30012345678 dated 01/04/2026', '30012345678'],
  ['Account No 0012 3456 7890 1 (Current)', '0012345678901'],
  ['A/c No. 9150 1001 2345 678', '915010012345678'],
  ['Card No. 4111 1111 1111 1111 111', '4111111111111111111'],
  ['Card 3782 822463 10005 12/28', '378282246310005'],
  ['Card Number: 4111 1111 1111 1111', '4111111111111111'],
  ['Card No. 4111111111111111 Exp 12/28', '4111111111111111'],
];

describe('T-048 wave 5 (ruling T): the key is the number itself, the covered place runs to the end of its digits', () => {
  it('compares account numbers with leading zeros removed (re-test 4, N14)', () => {
    expect(one('Account Number : 00000030012345678', 'bank-account')).toEqual(['00000030012345678', '30012345678', 'sure']);
    expect(keyOf('bank-account', '00000030012345678')).toBe('30012345678');
    expect(keyOf('bank-account', '0000 0030 0123 45678')).toBe('30012345678');
    // nine digits are always kept: a short number is not looked for inside every other number
    expect(keyOf('bank-account', '000000000123')).toBe('000000123');
    expect(keyOf('bank-account', '012345678')).toBe('012345678');
    expect(keyOf('bank-account', '50100123456789')).toBe('50100123456789');
    // other kinds keep their zeros
    expect(keyOf('micr', '000240002')).toBe('000240002');
    expect(keyOf('itr-ack', '012345678901234')).toBe('012345678901234');
    const page = [
      'ZETA STATE BANK',
      'Account Number : 00000030012345678',
      '01/10/2026\tTRF TO 30012345678 SWEEP\t1,200.00',
      '02/10/2026\tNEFT-ZETAN26281001-ORCHARD TRADERS-30012345678\t1,237.00',
      '03/10/2026\tINT.PD:30012345678:01-07-2026\t12.00',
      'credited to 3001 2345 678.',
      'A/c 030012345678 and A/c 0000 0030 0123 45678',
    ].join('\n');
    const [header] = numbersIn(page);
    expect(header.key).toBe('30012345678');
    expect(covers(page, 'bank-account', header.key)).toEqual(['00000030012345678', '30012345678', '30012345678', '30012345678', '3001 2345 678', '030012345678', '0000 0030 0123 45678']);
    // every labelled writing of it has the one key
    expect(new Set(numbersIn(page).map((m) => m.key))).toEqual(new Set(['30012345678']));
    // the key as the header writes it finds the same places, and the check sees the number written without its zeros
    expect(placesOfValue(page, 'bank-account', '00000030012345678')).toHaveLength(7);
    expect(valueIn('TRF TO 30012345678 SWEEP', 'bank-account', '00000030012345678')).toBe(true);
    expect(valueIn('TRF TO 30012345679 SWEEP', 'bank-account', '00000030012345678')).toBe(false);
    // zeros that belong to another figure are not taken with it
    expect(covers('Balance 100 30012345678', 'bank-account', '30012345678')).toEqual(['30012345678']);
    expect(covers('Balance 0.00 30012345678', 'bank-account', '30012345678')).toEqual(['30012345678']);
    expect(covers('Sl 10\t30012345678', 'bank-account', '30012345678')).toEqual(['30012345678']);
  });

  it('covers the digit groups that follow the key at the labelled place, on its line and on the wrapped next line (N10, N13)', () => {
    const cases: [string, RedactKind, string, string][] = [
      ['Account Number\t1234 5678 9012 3456 78', 'bank-account', '1234567890123456', '1234 5678 9012 3456 78'],
      ['Account No. 5010 0123 4567 8901 23', 'bank-account', '5010012345678901', '5010 0123 4567 8901 23'],
      // leading zeros are not the number: nine digits after them belong to the key
      ['A/c No. 012 345 678 9012', 'bank-account', '123456789012', '012 345 678 9012'],
      ['A/c No. 0000 0030 0123 45678', 'bank-account', '30012345678', '0000 0030 0123 45678'],
      ['A/c No. 123 456 789 0123', 'bank-account', '123456789', '123 456 789 0123'],
      ['Account No. 123456789 012345', 'bank-account', '123456789', '123456789 012345'],
      ['Account No 0012 3456 7890 1 (Current)', 'bank-account', '1234567890', '0012 3456 7890 1'],
      ['A/c No.\t5010 0123 4567\n89 (Savings)', 'bank-account', '501001234567', '5010 0123 4567\n89'],
      ['A/c No. 5010 0123 4567\n  89', 'bank-account', '501001234567', '5010 0123 4567\n  89'],
      ['A/c No. 501001234567-89 (Savings)', 'bank-account', '50100123456789', '501001234567-89'],
      ['Account No. 501001234567 89 days', 'bank-account', '501001234567', '501001234567 89'],
      ['Card No. 4111 1111 1111 1111 111', 'card', '4111111111111111', '4111 1111 1111 1111 111'],
      ['Paid by 4111 1111 1111 1111 111', 'card', '4111111111111111', '4111 1111 1111 1111 111'],
      // a place written with a space between every digit is covered whole, as before
      ['A/c No. 5 0 1 0 0 1 2 3 4 5 6 7 8 9 dated 01/10/2026', 'bank-account', '50100123456789', '5 0 1 0 0 1 2 3 4 5 6 7 8 9'],
    ];
    expect(cases.map(([text, kind]) => one(text, kind))).toEqual(cases.map(([, , key, value]) => [value, key, 'sure']));
  });

  it('covers the tail at every other place of the key, however the number is written there', () => {
    // [kind, key, text, what is covered]
    const cases: [RedactKind, string, string, string[]][] = [
      ['bank-account', '1234567890123456', 'TRF TO 123456789012345678 SWEEP', ['123456789012345678']],
      ['bank-account', '1234567890123456', 'NEFT-ZETAN26281001-ORCHARD TRADERS-123456789012345678\t1,237.00', ['123456789012345678']],
      ['bank-account', '1234567890123456', 'credited to 1234 5678 9012 3456 78.', ['1234 5678 9012 3456 78']],
      ['bank-account', '1234567890123456', 'credited to 1234-5678-9012-3456-78 today', ['1234-5678-9012-3456-78']],
      ['bank-account', '501001234567', 'TRF TO 50100123456789 SWEEP\t1,200.00', ['50100123456789']],
      ['bank-account', '501001234567', 'A/c 5010 0123 4567\n89 (Savings)', ['5010 0123 4567\n89']],
      ['bank-account', '012345678', 'Balances confirmed for 0123456789012, 50100123456 and 0123-456789-012.', ['0123456789012', '0123-456789-012']],
      ['bank-account', '123456789', 'INT.PD:123456789012345:01-07-2026', ['123456789012345']],
      ['card', '4111111111111111', 'Card 4111 1111 1111 1111 111 was used', ['4111 1111 1111 1111 111']],
      ['card', '4111111111111111', 'Card 4111111111111111111 was used', ['4111111111111111111']],
      // two places side by side are two places, neither inside the other
      ['bank-account', '50100123456789', '50100123456789 50100123456789', ['50100123456789', '50100123456789']],
      // a place that is covered as the tail of the one before it is not a second place
      ['bank-account', '123456789', '123456789 123456789', ['123456789 123456789']],
    ];
    expect(cases.map(([kind, key, text]) => covers(text, kind, key))).toEqual(cases.map(([, , , covered]) => covered));
  });

  it('does not cover an amount, a date, a time, a rate, a count of pages or a number too long to be the tail', () => {
    // [text, what the one account or card place covers]
    const cases: [string, string][] = [
      ['Account No. 50100123456789 12,400.00 Cr', '50100123456789'],
      ['A/c 50100123456789 01/10/2026', '50100123456789'],
      ['A/c 50100123456789 01-10-2026 12,400.00', '50100123456789'],
      ['A/c 50100123456789 10:42 AM', '50100123456789'],
      ['SB 50100123456789 3.5%', '50100123456789'],
      ['A/c 50100123456789 5 % p.a.', '50100123456789'],
      ['Account No 50100123456789 1 of 4', '50100123456789'],
      ['Account: 50100123456789 1/4', '50100123456789'],
      ['Account Number 50100123456789 3 October 2026', '50100123456789'],
      ['Savings account 50100123456789\n2 November 2026', '50100123456789'],
      ['A/c 50100123456789 5000/-', '50100123456789'],
      ['Account No. 50100123456789 (0417)', '50100123456789'],
      ['Account no. 50100123456789 24x7 helpline', '50100123456789'],
      ['Account No. 50100123456789\t\t1,24,000.00', '50100123456789'],
      ['Account No. 50100123456789\t0417', '50100123456789'],
      ['A/c 50100123456789  0417', '50100123456789'],
      ['Account No.: 50100123456789\n1. Opening balance', '50100123456789'],
      ['Account No.: 50100123456789\n1) Opening balance', '50100123456789'],
      // more digits than an account number has (18) or a card has (19): another number
      ['Bank account no. 50100200300400 100900000000 01/01/1970', '50100200300400'],
      ['Account No: 50100123456789\n411045 Pune', '50100123456789'],
      ['A/c No. 50100123456789 200417', '50100123456789'],
      ['Demat account no. 1203450000123456 100 shares', '1203450000123456'],
      ['A/c 123456789012345678 2 files', '123456789012345678'],
      ['Card No. 4111 1111 1111 1111 1234', '4111 1111 1111 1111'],
      ['Card No. 4111 1111 1111 1111\n12/28', '4111 1111 1111 1111'],
      ['Paid by 4111 1111 1111 1111 12 Oct', '4111 1111 1111 1111'],
    ];
    expect(cases.map(([text]) => numbersIn(text).map((m) => m.value))).toEqual(cases.map(([, value]) => [value]));
    // the same at the other places of a key
    expect(covers('TRF-50100123456789-01-10-2026 and 50100123456789-2026-10-01', 'bank-account', '50100123456789')).toEqual(['50100123456789', '50100123456789']);
    expect(covers('TRF TO 50100123456789 SWEEP\t1,200.00\n02/10/2026\tINT.PD:50100123456789:01-07-2026 12.00 10,712.00', 'bank-account', '50100123456789')).toEqual(['50100123456789', '50100123456789']);
    expect(covers('50100123456789 12,400.00 and 50100123456789 01/10/2026 and 50100123456789 100900000000', 'bank-account', '50100123456789')).toEqual(['50100123456789', '50100123456789', '50100123456789']);
    // what another kind holds is not covered as a tail, and other kinds of number get no tail
    expect(findAll('A/c No. 123456789 98450 12345 (Mobile)').map((m) => [m.kind, m.value])).toEqual([
      ['bank-account', '123456789'],
      ['mobile', '98450 12345'],
    ]);
    expect(covers('Aadhaar 2345 6789 0124 12', 'aadhaar', '234567890124')).toEqual(['2345 6789 0124']);
    expect(covers('MICR 411002003 12', 'micr', '411002003')).toEqual(['411002003']);
  });

  it('keeps placesOfValue to the key itself, inside what the find covers: text joined from separate drawings gives no tail', () => {
    // the run reads each drawing's pieces joined with nothing or a space between them: the figure after a number
    // there is another cell's, so the shared rule never runs on past the key
    expect(stands('TRF TO 501001234567891,200.00', 'bank-account', '50100123456789')).toEqual(['50100123456789']);
    expect(stands('50100123456789 0417 1 5000', 'bank-account', '50100123456789')).toEqual(['50100123456789']);
    expect(stands('TRF TO 123456789012345678 SWEEP', 'bank-account', '1234567890123456')).toEqual(['1234567890123456']);
    expect(stands('A/c 5010 0123 4567\n89 (Savings)', 'bank-account', '501001234567')).toEqual(['5010 0123 4567']);
    expect(stands('Card 4111 1111 1111 1111 111', 'card', '4111111111111111')).toEqual(['4111 1111 1111 1111']);
    // leading zeros are not compared, and are not part of the place
    expect(stands('Account Number : 00000030012345678', 'bank-account', '30012345678')).toEqual(['30012345678']);
    expect(stands('Account Number : 00000030012345678', 'bank-account', '00000030012345678')).toEqual(['30012345678']);
    // every place of the key lies inside a place the find covers
    const texts = ['TRF TO 123456789012345678 SWEEP', 'A/c 5010 0123 4567\n89 (Savings) and 501001234567-89', 'Account Number : 00000030012345678\nTRF TO 30012345678 SWEEP', '50100123456789 50100123456789'];
    for (const text of texts) {
      for (const key of ['1234567890123456', '501001234567', '30012345678', '50100123456789']) {
        const wide = coveredPlacesOfValue(text, 'bank-account', key);
        for (const p of placesOfValue(text, 'bank-account', key)) expect(wide.some((w) => w.start <= p.start && p.end <= w.end), `${text} / ${key}`).toBe(true);
      }
    }
    // for every other kind the two are the same
    for (const [kind, key, text] of [['aadhaar', '234567890124', 'Aadhaar 2345 6789 0124 12'], ['micr', '411002003', 'MICR 411002003 12'], ['pan', 'QZXCV0000W', '27QZXCV0000W1Z5 12']] as const) {
      expect(coveredPlacesOfValue(text, kind, key)).toEqual(placesOfValue(text, kind, key));
    }
  });

  it('finds the groupings 4-4-6, 3-4-4 and 2-4-4-4 after an account label again (N11, N12)', () => {
    const cases: [string, string, string][] = [
      ['Account No. 5010 0123 456789\tIFSC ZETA0123456', '5010 0123 456789', '50100123456789'],
      ['Kestrel Bank A/c No.\t501 0012 3456', '501 0012 3456', '50100123456'],
      ['A/c No. 50 1001 2345 6789', '50 1001 2345 6789', '50100123456789'],
      ['A/c No. 50100 12345 6789', '50100 12345 6789', '50100123456789'],
      ['A/c No. 5010 0123 456789 12,400.00', '5010 0123 456789', '50100123456789'],
      ['A/c No. 501 0012 3456 124,000.00', '501 0012 3456', '50100123456'],
      // a count after it is not part of the number itself (it is covered with it)
      ['A/c No. 5010 0123 456789 12 EMIs', '5010 0123 456789 12', '50100123456789'],
    ];
    expect(cases.map(([text]) => one(text, 'bank-account'))).toEqual(cases.map(([, value, key]) => [value, key, 'sure']));
    // without a label, uneven groups are no account number; nor are eight digits after one
    expect(one('Ref 5010 0123 456789', 'bank-account')).toBeNull();
    expect(one('A/c No. 50100 123 12 EMIs', 'bank-account')).toBeNull();
    expect(one('A/c No. 5010 0123', 'bank-account')).toBeNull();
  });

  it('reads the 30 phrasings of re-test 4: the number found, every digit covered there and in four other writings', () => {
    expect(PHRASINGS_30).toHaveLength(30);
    const wrong: string[] = [];
    let wholeKey = 0;
    for (const [text, full] of PHRASINGS_30) {
      const [best] = numbersIn(text);
      if (!best) {
        wrong.push(`${JSON.stringify(text)}: nothing`);
        continue;
      }
      const number = full.replace(/^0+(?=\d{9})/, '');
      if (best.key === number) wholeKey++;
      // the key is the number, or its first digits (when unsure the shorter number is the key)
      if (!(best.confidence === 'sure' && (full.startsWith(best.key) || number.startsWith(best.key)))) wrong.push(`${JSON.stringify(text)}: key of ${best.key.length} digits, ${best.confidence}`);
      if (digitCount(best.value) !== full.length) wrong.push(`${JSON.stringify(text)}: ${digitCount(best.value)} of ${full.length} digits covered at the label`);
      for (const other of otherWritings(full)) {
        // the date after the number in "INT.PD:...:01-07-2026" is never covered
        const covered = covers(other, best.kind, best.key).join('');
        if (digitCount(covered) !== full.length) wrong.push(`${JSON.stringify(text)} in ${JSON.stringify(other)}: ${digitCount(covered)} of ${full.length} digits covered`);
      }
    }
    expect(wrong).toEqual([]);
    // the number itself is the key wherever its end is certain (20 of 30 before this wave)
    expect(wholeKey).toBeGreaterThanOrEqual(23);
  });

  it('keeps the masked value and the check forms of an account on its key', () => {
    expect(maskValue('bank-account', keyOf('bank-account', '00000030012345678'))).toBe('XXXXXXX5678');
    expect(checkForms('bank-account', '30012345678', '00000030012345678')).toEqual(['30012345678', '00000030012345678']);
  });
});

/** Re-test 4, N25: a Form 16 Part B as its page text reads (cells apart by a tab). */
const FORM_16 = [
  'FORM NO. 16 PART B',
  'Name and address of the Employee\tRamesh Kumar Gupta',
  'Flat 12, Orchard Residency, Baner Road, Pune',
  '411045',
  'PAN of the Employee\tQZXCV0000W',
  'Name of the Deductee\tPAN of the Deductee\tAmount paid\tTax deducted',
  'Ramesh Kumar Gupta\tQZXCV0000W\t12,40,000\t1,18,400',
  'Devi Rao\tBNZPM2501F\t2,40,000\t18,400',
  'Total\t\t14,80,000\t1,36,800',
].join('\n');

describe('T-048 wave 5 (ruling U): labels in forms and tables', () => {
  it('finds the name and the address after "Name and address of the Employee", and the names under a "Name of the Deductee" heading (N25)', () => {
    expect(values(FORM_16, 'name')).toEqual([
      ['Ramesh Kumar Gupta', 'possible'],
      ['Ramesh Kumar Gupta', 'possible'],
      ['Devi Rao', 'possible'],
    ]);
    expect(values(FORM_16, 'address')).toEqual([['Flat 12, Orchard Residency, Baner Road, Pune\n411045', 'possible']]);
    expect(findAll(FORM_16).filter((m) => m.kind === 'name').map((m) => m.reason)).toEqual([REASONS.name, REASONS.underHeading, REASONS.underHeading]);
    // an "Employee's Name" heading beside other headings, the rows below it (N20), and a heading row of two or three (N23)
    const register =
      "Sl\tEmployee's Name\tBank details\tEmp. Mobile\nA/c No.\tIFSC\n1\tRamesh Kumar Gupta\t50100123456789\tZETA0123456\t98450 12345\n2\tDevika Anand Rao\t50100123450011\tZETA0123456\t98450 12399";
    expect(values(register, 'name')).toEqual([
      ['Ramesh Kumar Gupta', 'possible'],
      ['Devika Anand Rao', 'possible'],
    ]);
    expect(values('PAN\tName\tAssessment Year\nQZXCV0000W\tRAMESH KUMAR GUPTA\t2026-27', 'name')).toEqual([['RAMESH KUMAR GUPTA', 'possible']]);
  });

  it('takes no heading, total or other column for a name under a heading', () => {
    for (const text of [
      'NAME AND ADDRESS OF THE EMPLOYER',
      'Name and address of the Employer\tOrchard Traders Pvt Ltd',
      'Name of the Bank\tBranch\nZeta Bank\tPune Main',
      'Name of the Deductee\tPAN of the Deductee\nGrand Total\t12,40,000',
      'Sl\tName of the Employee\tDesignation\n1\t12,400.00\tSenior Manager',
      'Particulars\tName of the Deductee\nAmount paid\tTax Deducted',
      'Sl\tFirm Name\tDate\n1\tOrchard Traders\t01/04/2026',
    ]) {
      expect(
        findAll(text)
          .filter((m) => m.kind === 'name' || m.kind === 'address')
          .map((m) => m.value),
        text,
      ).toEqual([]);
    }
  });

  it('ends the rows under a heading after three lines without a name there', () => {
    const table = 'Name of the Deductee\tAmount paid\nDevi Rao\t2,40,000\nTotal\t2,40,000\nNotes\nPrepared by the firm\nPlace\tPune\nOrchard Residency\tBaner Road';
    expect(values(table, 'name')).toEqual([['Devi Rao', 'possible']]);
  });

  it('reads a label with its value beside it, and more labels under it, as no row of headings', () => {
    // only the value beside the label is a name: the labels under it are not names under a heading
    expect(values('Name\tRAMESH\nBlood Group\tO Positive\nReporting Officer\tDevi', 'name')).toEqual([['RAMESH', 'possible']]);
    expect(values('Employee Name\tR. Gupta\nNext Of Kin\tDevi Rao\nHome Town\tPune', 'name')).toEqual([['R. Gupta', 'possible']]);
  });

  it('finds a name and a date of birth on the line under their label, as a KYC form prints them (N28)', () => {
    const form = "Know your customer form\nApplicant's full name\nRAMESH KUMAR GUPTA\nDate of Birth (DD/MM/YYYY)\n14/07/1982\nPAN\nQZXCV0000W\nMobile number\n+91 98450 12345";
    expect(values(form, 'name')).toEqual([['RAMESH KUMAR GUPTA', 'possible']]);
    expect(findAll(form).find((m) => m.kind === 'name')?.reason).toBe(REASONS.nameBelow);
    expect(one(form, 'dob')).toEqual(['14/07/1982', '14071982', 'sure']);
    expect(values('Name of the Applicant:\nRamesh Kumar Gupta\nStatus\nIndividual', 'name')).toEqual([['Ramesh Kumar Gupta', 'possible']]);
    expect(one('Date of Birth\n14 July 1982', 'dob')).toEqual(['14 July 1982', '14JULY1982', 'sure']);
    // a label with nothing under it that looks like its value
    expect(values('Name\nDate of Birth\nPAN', 'name')).toEqual([]);
    expect(values('Full name\nSignature of the Applicant', 'name')).toEqual([]);
    expect(one('Date of Birth\nPlace of Birth\n15/11/2026 Pune', 'dob')).toBeNull();
    expect(one('Date of Birth (DD/MM/YYYY)\n32/13/1982', 'dob')).toBeNull();
  });

  it('finds the dates under a "Date of / Birth" column heading wrapped in its cell, as possible (N19)', () => {
    const register =
      'Sl\tEmployee\nName\nDate of\nBirth\nNet pay\n1\tRamesh Kumar\nGupta\n50100123456789\t100987654321\t14/07/1982\t84,200.00\n2\tDevika Anand Rao\t50100123450011\t100987650022\t02/02/1990\t84,200.00';
    expect(
      findAll(register)
        .filter((m) => m.kind === 'dob')
        .map((m) => [m.value, m.confidence, m.reason]),
    ).toEqual([
      ['14/07/1982', 'possible', REASONS.underHeading],
      ['02/02/1990', 'possible', REASONS.underHeading],
    ]);
    // two date columns: which one is the birth date is not known, so none is offered
    expect(one('Date of\nBirth\nDate of\njoining\n1\tRamesh Kumar Gupta\t14/07/1982\t01/04/2015\n2\tDevika Rao\t02/02/1990\t01/06/2019', 'dob')).toBeNull();
    // a date inside a sentence or beside a word is not a cell of the column
    expect(one('Date of\nBirth\nSigned on 15/11/2026 at Pune\nDate: 15/11/2026', 'dob')).toBeNull();
    expect(one('Date of\nBirth\n1\t15/11/2026 Pune\tSigned', 'dob')).toBeNull();
    // one row with two dates is enough for none to be offered
    expect(one('Date of\nBirth\n1\tRamesh Kumar Gupta\t14/07/1982\n2\tDevika Rao\t02/02/1990\t01/06/2019', 'dob')).toBeNull();
    // words after the label on its line: it is no heading and no label above its value
    expect(one('Date of Birth certificate enclosed\n14/07/1982', 'dob')).toBeNull();
  });

  it('finds an acknowledgement number in the row under its heading (N23)', () => {
    expect(one('e-Filing Acknowledgement Number\tDate of filing\tForm\n628812340151126\t15-Nov-2026\tITR-1', 'itr-ack')).toEqual(['628812340151126', '628812340151126', 'sure']);
    expect(one('Form\tAcknowledgement No.\nITR-1\t628812340151126', 'itr-ack')).toEqual(['628812340151126', '628812340151126', 'sure']);
    // under another heading of that row, or with no heading above it
    expect(one('Acknowledgement Number\tReference\n15-Nov-2026\t628812340151126', 'itr-ack')).toBeNull();
    expect(one('We acknowledge your letter\n628812340151126', 'itr-ack')).toBeNull();
  });

  it('finds the people in the columns beside a label on the left (N21)', () => {
    const table =
      'Particulars\tPartner 1\tPartner 2\tPartner 3\nName\tRamesh Kumar Gupta\tDevika Anand Rao\tSuresh Mohan Pillai\nBank account\t50100123456789\t50100123450011\t50100123450033\nDate of birth\t14/07/1982\t02/02/1990\t23/11/1985';
    expect(values(table, 'name')).toEqual([
      ['Ramesh Kumar Gupta', 'possible'],
      ['Devika Anand Rao', 'possible'],
      ['Suresh Mohan Pillai', 'possible'],
    ]);
    const of = (kind: RedactKind, text = table) =>
      findAll(text)
        .filter((m) => m.kind === kind)
        .map((m) => [m.value, m.confidence, m.reason]);
    expect(of('bank-account')).toEqual([
      ['50100123456789', 'sure', undefined],
      ['50100123450011', 'possible', REASONS.sameRow],
      ['50100123450033', 'possible', REASONS.sameRow],
    ]);
    expect(of('dob')).toEqual([
      ['14/07/1982', 'sure', undefined],
      ['02/02/1990', 'possible', REASONS.sameRow],
      ['23/11/1985', 'possible', REASONS.sameRow],
    ]);
    // the next cell of the row is something else: a branch code, an amount, a place
    expect(of('bank-account', 'Bank account\t50100123456789\t0417\t12,400.00').map(([value]) => value)).toEqual(['50100123456789']);
    expect(of('bank-account', 'Bank account 50100123456789 50100123450011').map(([value]) => value)).toEqual(['50100123456789']);
    expect(of('dob', 'Date of birth\t14/07/1982\tPune\t12,400.00').map(([value]) => value)).toEqual(['14/07/1982']);
    expect(values('Name\tRamesh Kumar Gupta\tPartner\t12,400.00', 'name')).toEqual([['Ramesh Kumar Gupta', 'possible']]);
  });

  it('does not hold back the account numbers next to an IFSC when a heading cell above them names the account (N20)', () => {
    const register =
      "Sl\tEmployee's Name\tBank details\tEmp. Mobile\nA/c No.\tIFSC\n1\tRamesh Kumar Gupta\t50100123456789\tZETA0123456\t98450 12345\n2\tDevika Anand Rao\t50100123450011\tZETA0123456\t98450 12399";
    const accounts = (text: string) =>
      findAll(text)
        .filter((m) => m.kind === 'bank-account')
        .map((m) => [m.value, m.confidence, m.reason]);
    expect(accounts(register)).toEqual([
      ['50100123456789', 'possible', REASONS.underHeading],
      ['50100123450011', 'possible', REASONS.underHeading],
    ]);
    expect(neverTickedByDefault('bank-account', 'possible', REASONS.underHeading)).toBe(false);
    expect(accounts('Sl\tBank Account Number\tIFSC Code\n1\t50100123456789\tZETA0123456')).toEqual([['50100123456789', 'possible', REASONS.underHeading]]);
    // no heading cell, a heading after the row, or the words in a sentence: held back as before
    for (const text of [
      '1\t50100123456789\tZETA0123456',
      '1\t50100123456789\tZETA0123456\nA/c No.\tIFSC',
      'The A/c No. and the IFSC are given below\n1\t50100123456789\tZETA0123456',
      'Ledger account\tIFSC\n1\t50100123456789\tZETA0123456',
    ]) {
      expect(accounts(text), text).toEqual([['50100123456789', 'possible', REASONS.accountNearIfsc]]);
    }
  });

  it('offers the addressee named after a designation, without the title before the name, to look for on every page (N34)', () => {
    const letter = 'To,\nThe Proprietor,\nShri Ramesh Kumar Gupta,\nOrchard Traders, Baner Road,\nPune 411045\nThe firm examined the books of account.';
    const found = findAll(letter).filter((m) => m.kind === 'name' || m.kind === 'addressee');
    expect(found.map((m) => [m.kind, m.value, m.reason])).toEqual([
      ['addressee', 'The Proprietor,', REASONS.addressee],
      ['name', 'Shri Ramesh Kumar Gupta', REASONS.addresseeName],
      ['addressee', ',\nOrchard Traders, Baner Road,\nPune 411045', REASONS.addressee],
    ]);
    const name = found[1];
    expect(name.key).toBe('ramesh kumar gupta');
    expect(placesOfValue('Notice to Ramesh Kumar Gupta\tpage 2', 'name', name.key)).toHaveLength(1);
    // the first line itself with a title: the key is the name alone
    expect(
      findAll('To,\nSmt. Devi Rao\nFlat 12, Pune 411045')
        .filter((m) => m.kind === 'name')
        .map((m) => [m.value, m.key]),
    ).toEqual([['Smt. Devi Rao', 'devi rao']]);
    // after a designation, a line with no title before it is not taken for a person (a bank, a department)
    expect(values('To,\nThe Manager,\nZeta Bank Ltd,\nPune 411045', 'name')).toEqual([]);
    expect(values('To,\nThe Proprietor,\nOrchard Traders,\nPune 411045', 'name')).toEqual([]);
    expect(values('To,\nThe Assessing Officer\nWard 12(3), Mumbai\n\nSubject: Reply', 'name')).toEqual([]);
  });

  it('offers a number after a label in an Indian script as possible (H15, N31)', () => {
    const kannada = String.fromCharCode(0x0c96, 0x0cbe, 0x0ca4, 0x0cc6);
    const gujarati = String.fromCharCode(0x0aac, 0x0ac7, 0x0a82, 0x0a95, 0x20, 0x0a96, 0x0abe, 0x0aa4, 0x0abe, 0x20, 0x0aa8, 0x0a82, 0x0aac, 0x0ab0);
    const telugu = String.fromCharCode(0x0c2e, 0x0c4a, 0x0c2c, 0x0c48, 0x0c32, 0x0c4d);
    expect(findAll(`${gujarati}\t50100123456789`).map((m) => [m.kind, m.value, m.confidence, m.reason])).toEqual([['bank-account', '50100123456789', 'possible', REASONS.indianLabel]]);
    expect(findAll(`${kannada}\t${kannada}  \t50100123456789`).map((m) => [m.kind, m.value, m.confidence])).toEqual([['bank-account', '50100123456789', 'possible']]);
    expect(findAll(`${telugu}: 9845012345`).map((m) => [m.kind, m.value, m.confidence, m.reason])).toEqual([['mobile', '9845012345', 'possible', REASONS.indianLabel]]);
    // ticked by the profiles that tick possibles; not held back like the loose shapes
    expect(neverTickedByDefault('bank-account', 'possible', REASONS.indianLabel)).toBe(false);
    // not in a sentence, not after Latin words, not an amount or a short number
    expect(findAll(`${gujarati} 50100123456789 ${gujarati}`)).toEqual([]);
    expect(findAll(`${gujarati}\tRef 50100123456789`)).toEqual([]);
    expect(findAll(`${gujarati}\t12,40,000.00`)).toEqual([]);
    expect(findAll(`${gujarati}\t12345678`)).toEqual([]);
    expect(findAll('Total\t50100123456789')).toEqual([]);
    expect(findAll(`Total\t50100123456789\t${gujarati}`)).toEqual([]);
  });

  it('words the new reasons in plain words', () => {
    expect(REASONS.underHeading).toBe('under a column heading that names it');
    expect(REASONS.nameBelow).toBe('the line under a "Name" label');
    expect(REASONS.sameRow).toBe('in the same row as a value with a label');
    expect(REASONS.indianLabel).toBe('a number after a label in an Indian language');
    for (const reason of Object.values(REASONS)) expect(reason.length).toBeLessThanOrEqual(90);
  });
});
