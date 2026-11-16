// The Protect dialog's words and rules (design 5.18; plan Task B5; ux-audit E): what each password field
// says as the user types, why Run waits, the strength hint, the phases, the record and the result's
// message. The password itself is never part of any text made here.
import { describe, expect, it } from 'vitest';
import { NO_LONGER_ARCHIVAL_NOTE, NON_ENGLISH_PASSWORD_WARNING, PROTECT_MAX_BYTES, SPACES_PASSWORD_WARNING } from '@/lib/pdf-tools/protect';
import { PdfToolsError, PROTECTED_OUTPUT_REASON } from '@/lib/pdf-tools/types';
import {
  blockedReason,
  busyNote,
  fieldMessages,
  FORGOTTEN_WARNING,
  LARGE_FILE_BYTES,
  liveWarnings,
  PHASE_LABELS,
  PROTECT_SUMMARY,
  protectRecordOptions,
  resultDescription,
  SIGNED_WARNING,
  strengthHint,
  tooLargeMessage,
  withNextStep,
  type PasswordFields,
} from './protectForm';

const fields = (over: Partial<PasswordFields> = {}): PasswordFields => ({ password: '', confirm: '', passwordLeft: false, confirmLeft: false, ...over });
const GOOD = 'Ledger-2026!x';
const file = (over: { size?: number; protectedOutput?: boolean } = {}) => ({ size: 1000, protectedOutput: false, ...over });

describe('the password field', () => {
  it('shows a plain hint while empty, and no error even after the field is left', () => {
    expect(fieldMessages(fields())).toMatchObject({ passwordError: null, passwordHint: 'At least 8 characters.', ready: false });
    expect(fieldMessages(fields({ passwordLeft: true })).passwordError).toBeNull();
  });

  it('says it is too short as a hint while typing, and as an error once the field is left', () => {
    const typing = fieldMessages(fields({ password: 'abc' }));
    expect(typing.passwordError).toBeNull();
    expect(typing.passwordHint).toBe('The password is too short. Use at least 8 characters.');
    const left = fieldMessages(fields({ password: 'abc', passwordLeft: true }));
    expect(left.passwordError).toBe('The password is too short. Use at least 8 characters.');
    expect(left.passwordHint).toBeNull();
  });

  it("shows the library's refusal of a too long or untypable password at once, as typed", () => {
    const long = fieldMessages(fields({ password: 'a'.repeat(128) }));
    expect(long.passwordError).toMatch(/^The password is too long for PDF readers\. Use at most 127 /);
    expect(long.ready).toBe(false);
    const control = fieldMessages(fields({ password: 'abcdefgh\u0007' }));
    expect(control.passwordError).toMatch(/^The password contains a character that cannot be typed again reliably/);
    // About 42 Hindi letters fit: 43 are too many (three bytes each).
    expect(fieldMessages(fields({ password: 'क'.repeat(42) })).passwordError).toBeNull();
    expect(fieldMessages(fields({ password: 'क'.repeat(43) })).passwordError).toMatch(/too long/);
  });

  it('a usable password has no message', () => {
    expect(fieldMessages(fields({ password: GOOD, passwordLeft: true }))).toMatchObject({ passwordError: null, passwordHint: null });
  });
});

describe('the confirmation field', () => {
  it('waits quietly while the confirmation is a beginning of the password', () => {
    const m = fieldMessages(fields({ password: GOOD, confirm: GOOD.slice(0, 5) }));
    expect(m.confirmError).toBeNull();
    expect(m.ready).toBe(false);
  });

  it('says the two differ as soon as they do, and when the field is left short', () => {
    const MISMATCH = 'The two passwords are not the same. Type them again.';
    expect(fieldMessages(fields({ password: GOOD, confirm: 'Lx' })).confirmError).toBe(MISMATCH);
    expect(fieldMessages(fields({ password: GOOD, confirm: `${GOOD}y` })).confirmError).toBe(MISMATCH);
    expect(fieldMessages(fields({ password: GOOD, confirm: GOOD.slice(0, 5), confirmLeft: true })).confirmError).toBe(MISMATCH);
  });

  it('says nothing about the confirmation while the password itself cannot be used', () => {
    expect(fieldMessages(fields({ password: 'abc', confirm: 'xyz', confirmLeft: true })).confirmError).toBeNull();
  });

  it('confirms a match in words, and only then is Run ready', () => {
    const m = fieldMessages(fields({ password: GOOD, confirm: GOOD }));
    expect(m).toMatchObject({ confirmError: null, confirmHint: 'The two passwords match.', ready: true });
  });

  it('compares the passwords as they are used (NFC): a decomposed é matches a composed one', () => {
    const composed = 'Caf\u00e9-Ledger-1';
    const decomposed = 'Cafe\u0301-Ledger-1';
    expect(fieldMessages(fields({ password: composed, confirm: decomposed })).ready).toBe(true);
  });

  it('keeps spaces: a password with a trailing space does not match one without', () => {
    expect(fieldMessages(fields({ password: `${GOOD} `, confirm: GOOD, confirmLeft: true })).ready).toBe(false);
  });
});

describe('why Run waits (shown under the fields, ux-audit E8)', () => {
  it('names the next thing to do', () => {
    expect(blockedReason(file(), fields())).toBe('Type a password of at least 8 characters, then type it again to confirm it.');
    expect(blockedReason(file(), fields({ password: 'short' }))).toBe('Type a password of at least 8 characters, then type it again to confirm it.');
    expect(blockedReason(file(), fields({ password: 'a'.repeat(200) }))).toBe('Change the password as the message under it says.');
    expect(blockedReason(file(), fields({ password: GOOD }))).toBe('Type the password again to confirm it.');
    expect(blockedReason(file(), fields({ password: GOOD, confirm: 'nope' }))).toBe('The two passwords must be the same.');
    expect(blockedReason(file(), fields({ password: GOOD, confirm: GOOD }))).toBeNull();
  });

  it("refuses a file over the size cap with the library's words, whatever is typed", () => {
    const big = file({ size: PROTECT_MAX_BYTES + 1 });
    expect(blockedReason(big, fields({ password: GOOD, confirm: GOOD }))).toBe(tooLargeMessage());
    expect(tooLargeMessage()).toBe('This file is larger than 150 MB, too large to protect in PDF Tools. Compress it or split it into parts, then protect the smaller files.');
    expect(blockedReason(file({ size: PROTECT_MAX_BYTES }), fields({ password: GOOD, confirm: GOOD }))).toBeNull();
  });

  it('refuses a result of Protect as input, in the toolbar\'s words', () => {
    expect(blockedReason(file({ protectedOutput: true }), fields({ password: GOOD, confirm: GOOD }))).toBe(PROTECTED_OUTPUT_REASON);
  });
});

describe('the strength hint (a hint, never a block)', () => {
  it('follows the library: weak under 12 characters or of one kind; strong with three kinds', () => {
    expect(strengthHint('')).toBeNull();
    expect(strengthHint('abcdefgh')).toEqual({ level: 'weak', filled: 1, text: 'Weak: use at least 12 characters and mix letters, digits and symbols.' });
    expect(strengthHint('abcdefghijklmnop')?.level).toBe('weak');
    expect(strengthHint('abcdefghij12')).toEqual({ level: 'fair', filled: 2, text: 'Fair: mixing in a third kind of character (letters, digits, symbols) makes it strong.' });
    expect(strengthHint('Abcdefgh12!x')).toEqual({ level: 'strong', filled: 3, text: 'Strong.' });
  });

  it('never holds the password', () => {
    const secret = 'Unique-Secret-9876';
    expect(JSON.stringify(strengthHint(secret))).not.toContain(secret);
  });
});

describe('the warnings shown while typing', () => {
  it("are the library's: a space at either end, then characters not on an English keyboard", () => {
    expect(liveWarnings('Ledger2026')).toEqual([]);
    expect(liveWarnings(' Ledger2026')).toEqual([SPACES_PASSWORD_WARNING]);
    expect(liveWarnings('पासवर्ड₹2025')).toEqual([NON_ENGLISH_PASSWORD_WARNING]);
    expect(liveWarnings('\u00a0Ünïcødé ')).toEqual([SPACES_PASSWORD_WARNING, NON_ENGLISH_PASSWORD_WARNING]);
    expect(liveWarnings('')).toEqual([]);
  });

  it('the forgotten-password warning is the design text', () => {
    expect(FORGOTTEN_WARNING).toBe(
      'If the password is forgotten, nobody can open the protected file, including you. VERA does not keep the password. The unprotected file stays in the list.',
    );
  });

  it('the signed-file warning says what happens and what to do', () => {
    expect(SIGNED_WARNING).toBe('This file carries a digital signature. The protected copy will not carry a valid signature: keep the signed original as the evidence.');
  });
});

describe('progress', () => {
  it('names the three phases in order, as steps of three', () => {
    expect(PHASE_LABELS).toEqual({
      preparing: 'Step 1 of 3: reading the file…',
      encrypting: 'Step 2 of 3: protecting it with the password…',
      checking: 'Step 3 of 3: checking that the copy opens with the password…',
    });
  });

  it('says a large file takes a while, above about 20 MB', () => {
    expect(LARGE_FILE_BYTES).toBe(20 * 1024 * 1024);
    expect(busyNote(LARGE_FILE_BYTES)).toBeUndefined();
    expect(busyNote(LARGE_FILE_BYTES + 1)).toBe('This can take a minute for large scans.');
  });
});

describe('the record and the result', () => {
  it('records the protection only: never a password, hint or length', () => {
    expect(PROTECT_SUMMARY).toBe('Protected with a password (AES-256)');
    expect(protectRecordOptions(false)).toEqual({ protection: 'AES-256' });
    expect(protectRecordOptions(true)).toEqual({ protection: 'AES-256', noLongerArchival: true });
  });

  it('says what was made and that the original stays', () => {
    expect(resultDescription('Ledger_protected.pdf', {})).toEqual({
      message: 'Protected: Ledger_protected.pdf',
      detail: 'It opens only with the password you set. VERA does not keep it. The unprotected original stays in the list.',
      tone: 'success',
    });
  });

  it('adds "Signature no longer valid" and the PDF/A note when they apply, as a warning', () => {
    const said = resultDescription('Signed_protected.pdf', { signatureInvalid: true, noLongerArchival: true });
    expect(said.tone).toBe('warning');
    expect(said.detail).toBe(
      `It opens only with the password you set. VERA does not keep it. The unprotected original stays in the list. Signature no longer valid: keep the signed original as the evidence. ${NO_LONGER_ARCHIVAL_NOTE}`,
    );
  });
});

describe("errors from the run say that nothing was added and give one next step (ux-audit E9)", () => {
  const msg = (code: string, message: string) => (withNextStep(new PdfToolsError(code, message)) as PdfToolsError).message;

  it('protect-failed: try again, or a fresh copy when part of the file is damaged', () => {
    expect(msg('protect-failed', 'The file could not be protected.')).toBe('The file could not be protected. Nothing was added. Try again; if it fails again, restart the application.');
    expect(msg('protect-failed', 'The file could not be protected. Part of it is damaged, so it could not all be encrypted.')).toBe(
      'The file could not be protected. Part of it is damaged, so it could not all be encrypted. Nothing was added. Open the file in a PDF reader, save a fresh copy and add that.',
    );
  });

  it('protect-unverified already says so; it gains the next step', () => {
    expect(msg('protect-unverified', 'The protected file could not be verified. Nothing was added.')).toBe(
      'The protected file could not be verified. Nothing was added. Try again; if it fails again, restart the application.',
    );
  });

  it('a file over the cap gets the way round it; the password messages stay as they are', () => {
    expect(msg('protect-too-large', 'This file is larger than 150 MB, too large to protect in PDF Tools.')).toBe(`${tooLargeMessage().replace(' Compress', ' Nothing was added. Compress')}`);
    expect(msg('password-too-short', 'The password is too short. Use at least 8 characters.')).toBe('The password is too short. Use at least 8 characters.');
  });

  it('other refusals say nothing was added; anything that is not a PdfToolsError passes through', () => {
    expect(msg('not-a-pdf', 'This is not a PDF.')).toBe('This is not a PDF. Nothing was added.');
    const plain = new Error('x');
    expect(withNextStep(plain)).toBe(plain);
    const cancelled = new PdfToolsError('cancelled', 'Protecting was stopped. Nothing was added.');
    expect(withNextStep(cancelled)).toBe(cancelled);
  });
});
