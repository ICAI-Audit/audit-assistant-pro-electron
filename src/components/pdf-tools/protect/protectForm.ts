// The Protect dialog's words and rules (design 5.18; plan Task B5; ux-audit E). Pure: what each password
// field says as the user types, why Run waits, the strength hint, the phases, the record and the
// result's message. The password rules are the library's (protect.ts): its messages are shown as they
// are, and nothing made here ever holds the password itself.
import {
  NO_LONGER_ARCHIVAL_NOTE,
  PASSWORD_LIMITS,
  PROTECT_MAX_BYTES,
  passwordError,
  passwordStrength,
  passwordWarnings,
  type ProtectPhase,
} from '@/lib/pdf-tools/protect';
import { PdfToolsError, PHASE_TWO_ERROR_MESSAGES, PROTECTED_OUTPUT_REASON, type WorkingFile } from '@/lib/pdf-tools/types';
import type { Description } from '../toolStep';

/** Design 5.18, word for word. */
export const FORGOTTEN_WARNING =
  'If the password is forgotten, nobody can open the protected file, including you. VERA does not keep the password. The unprotected file stays in the list.';

/** The signed-file notice before the run: what happens and what to do (ux-audit C6.9). */
export const SIGNED_WARNING = 'This file carries a digital signature. The protected copy will not carry a valid signature: keep the signed original as the evidence.';

/** For a file that came into the list with a password (opened at intake): the copy gets only the new one. */
export const WAS_PROTECTED_NOTE = 'This file had a password when it was added; the copy in the list has none. The protected copy opens only with the new password you set here.';

/** Record summary (design 5.18; resultNames.ts operationSummary('protect') says the same). */
export const PROTECT_SUMMARY = 'Protected with a password (AES-256)';

/** Above this the run's footer says that it can take a while (about 36-50 s for 52 MB, P-report fix round 1). */
export const LARGE_FILE_BYTES = 20 * 1024 * 1024;

/** One line per phase of protectPdf, shown with a moving bar (the phases cannot be measured inside). */
export const PHASE_LABELS: Readonly<Record<ProtectPhase, string>> = {
  preparing: 'Step 1 of 3: reading the file…',
  encrypting: 'Step 2 of 3: protecting it with the password…',
  checking: 'Step 3 of 3: checking that the copy opens with the password…',
};

const NOTHING_ADDED = 'Nothing was added.';
const TRY_AGAIN = 'Try again; if it fails again, restart the application.';
const FRESH_COPY = 'Open the file in a PDF reader, save a fresh copy and add that.';
const SPLIT_IT = 'Compress it or split it into parts, then protect the smaller files.';
const TOO_LARGE = PHASE_TWO_ERROR_MESSAGES['protect-too-large'] ?? 'This file is larger than 150 MB, too large to protect in PDF Tools.';

/** The library's refusal of a file over PROTECT_MAX_BYTES, with the way round it (the dialog's words). */
export const tooLargeMessage = () => `${TOO_LARGE} ${SPLIT_IT}`;

/** The same refusal from the run, which also says that nothing was added. */
export const tooLargeError = () => withNextStep(new PdfToolsError('protect-too-large', TOO_LARGE)) as PdfToolsError;

export interface PasswordFields {
  password: string;
  confirm: string;
  /** The field has been left at least once (a too-short password is then an error, not a hint). */
  passwordLeft: boolean;
  confirmLeft: boolean;
}

export interface FieldMessages {
  /** Shown under the password field as an alert (aria-invalid); null when there is none. */
  passwordError: string | null;
  /** Shown under the password field in the normal tone when there is no error. */
  passwordHint: string | null;
  confirmError: string | null;
  confirmHint: string | null;
  /** The password can be used and both fields agree: Run may be pressed. */
  ready: boolean;
}

const usable = (typed: string) => typed.normalize('NFC');
const tooShort = (typed: string) => Array.from(usable(typed)).length < PASSWORD_LIMITS.min;

/**
 * What each field says as the user types. The library's own messages are used: a password too long or
 * holding a character that cannot be typed again is an error at once; a short one is a hint while it
 * is being typed and an error once the field is left (never for an empty field). The confirmation says
 * that the two differ as soon as it stops being a beginning of the password, or when it is left.
 */
export function fieldMessages({ password, confirm, passwordLeft, confirmLeft }: PasswordFields): FieldMessages {
  const own = passwordError(password, password); // the password alone (its confirmation equal to it)
  let passwordErrorText: string | null = null;
  let passwordHint: string | null = null;
  if (password === '') passwordHint = `At least ${PASSWORD_LIMITS.min} characters.`;
  else if (own !== null && tooShort(password) && !passwordLeft) passwordHint = own;
  else passwordErrorText = own;

  let confirmError: string | null = null;
  let confirmHint: string | null = null;
  const both = own === null ? passwordError(password, confirm) : own;
  if (own === null && confirm !== '') {
    if (both === null) confirmHint = 'The two passwords match.';
    else if (confirmLeft || !usable(password).startsWith(usable(confirm))) confirmError = both;
  }
  return { passwordError: passwordErrorText, passwordHint, confirmError, confirmHint, ready: both === null };
}

/** Why Run cannot be pressed yet, in one line (ux-audit E8), or null when it can. */
export function blockedReason(file: Pick<WorkingFile, 'size'> & Partial<Pick<WorkingFile, 'protectedOutput'>>, fields: PasswordFields): string | null {
  if (file.protectedOutput) return PROTECTED_OUTPUT_REASON;
  if (file.size > PROTECT_MAX_BYTES) return tooLargeMessage();
  const { password, confirm } = fields;
  const own = passwordError(password, password);
  if (password === '' || (own !== null && tooShort(password))) return `Type a password of at least ${PASSWORD_LIMITS.min} characters, then type it again to confirm it.`;
  if (own !== null) return 'Change the password as the message under it says.';
  if (confirm === '') return 'Type the password again to confirm it.';
  if (passwordError(password, confirm) !== null) return 'The two passwords must be the same.';
  return null;
}

export interface StrengthHint {
  level: 'weak' | 'fair' | 'strong';
  /** Segments of the three-part meter to fill. */
  filled: 1 | 2 | 3;
  text: string;
}

const STRENGTH: Record<StrengthHint['level'], Omit<StrengthHint, 'level'>> = {
  weak: { filled: 1, text: 'Weak: use at least 12 characters and mix letters, digits and symbols.' },
  fair: { filled: 2, text: 'Fair: mixing in a third kind of character (letters, digits, symbols) makes it strong.' },
  strong: { filled: 3, text: 'Strong.' },
};

/** The plain strength hint of design 5.18 (the library's length-and-kinds rule), or null for an empty field. */
export function strengthHint(password: string): StrengthHint | null {
  if (password === '') return null;
  const level = passwordStrength(password);
  return { level, ...STRENGTH[level] };
}

/** The library's warnings while typing: a space at either end, then characters not on an English keyboard. */
export function liveWarnings(password: string): string[] {
  return password === '' ? [] : passwordWarnings(password);
}

/** Under the moving bar while a large file runs. */
export function busyNote(size: number): string | undefined {
  return size > LARGE_FILE_BYTES ? 'This can take a minute for large scans.' : undefined;
}

/** The record's options (activity.ts keeps only allowed keys for Protect): never a password, hint or length. */
export function protectRecordOptions(noLongerArchival: boolean): Record<string, string | boolean> {
  return noLongerArchival ? { protection: 'AES-256', noLongerArchival: true } : { protection: 'AES-256' };
}

/** What the result's message says: what was made (the tool's own verb, ux-audit C6.10), and what to keep in mind. */
export function resultDescription(name: string, notes: { signatureInvalid?: boolean; noLongerArchival?: boolean }): Description {
  const parts = ['It opens only with the password you set. VERA does not keep it. The unprotected original stays in the list.'];
  if (notes.signatureInvalid) parts.push('Signature no longer valid: keep the signed original as the evidence.');
  if (notes.noLongerArchival) parts.push(NO_LONGER_ARCHIVAL_NOTE);
  return { message: `Protected: ${name}`, detail: parts.join(' '), tone: notes.signatureInvalid || notes.noLongerArchival ? 'warning' : 'success' };
}

const PASSWORD_CODES = new Set(['password-too-short', 'password-too-long', 'password-invalid', 'password-mismatch']);

/**
 * A library refusal as the dialog shows it: it says that nothing was added and gives one next step
 * (ux-audit E9). A stop, the password messages (shown at the field already) and anything that is not a
 * PdfToolsError are returned as they are. The messages never hold the password (protect.ts).
 */
export function withNextStep(error: unknown): unknown {
  if (!(error instanceof PdfToolsError) || error.code === 'cancelled' || PASSWORD_CODES.has(error.code)) return error;
  const base = error.message.trim();
  const said = base.endsWith(NOTHING_ADDED) ? base : `${base} ${NOTHING_ADDED}`;
  let next = '';
  if (error.code === 'protect-failed') next = /damaged/.test(base) ? FRESH_COPY : TRY_AGAIN;
  else if (error.code === 'protect-unverified') next = TRY_AGAIN;
  else if (error.code === 'protect-too-large') next = SPLIT_IT;
  return new PdfToolsError(error.code, next ? `${said} ${next}` : said);
}
