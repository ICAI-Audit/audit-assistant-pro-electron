// Redact (design 5.9 "What is searched"): the kinds of personal data found in a page's text, the
// user's own words, the forms a redacted value takes, and the ONE normalisation and separator rule
// that the find (redactFind.ts) and the check (redactCheck.ts, strict pass) share. Pure functions over
// strings; no PDF work.
//
// Confidentiality: a matched value, a key or a typed term is never put into an error message, a log
// or any string this module builds, except the replacement text the user chose (maskValue) and the
// check forms (checkForms), which stay in memory for the run that asked for them.
import { calculateGstinCheckDigit } from '@/lib/gstinValidation';
import { PdfToolsError, PHASE_TWO_ERROR_MESSAGES } from './types';

/**
 * The kinds added on 14 November 2026 (T-052, owner-approved): the identifiers chartered accountants
 * meet in India and the personal data of the Digital Personal Data Protection Act. A father's, mother's
 * or spouse's name is found as the kind 'name' (same rules, its own reason).
 */
export type AddedKind =
  // personal identity
  | 'passport'
  | 'voter-id'
  | 'driving-licence'
  | 'aadhaar-vid'
  | 'aadhaar-eid'
  | 'ckyc'
  | 'dob'
  // payroll and labour
  | 'uan'
  | 'pf-member'
  | 'esic-ip'
  | 'esic-employer'
  | 'employee-id'
  // banking and investments
  | 'card'
  | 'upi'
  | 'cheque'
  | 'loan-account'
  | 'swift'
  | 'demat'
  | 'folio'
  | 'insurance-policy'
  | 'vehicle'
  // company and professional
  | 'director-din'
  | 'cin'
  | 'llpin'
  | 'icai-membership'
  | 'icai-frn'
  | 'udin'
  | 'udyam'
  | 'iec'
  | 'lei'
  // tax and GST documents
  | 'challan'
  | 'gst-arn'
  | 'eway-bill'
  | 'irn'
  | 'tds-certificate'
  // other
  | 'landline'
  | 'pin-code';

export type RedactKind =
  | 'pan'
  | 'aadhaar'
  | 'gstin'
  | 'tan'
  | 'tax-din'
  | 'email'
  | 'mobile'
  | 'bank-account'
  | 'ifsc'
  | 'micr'
  | 'itr-ack'
  | 'evc'
  | 'ip'
  | 'name'
  | 'address'
  | 'addressee'
  | AddedKind
  | 'typed'
  | 'drawn'
  | 'same-text'
  | 'marked';
export type RedactGroup = 'identity' | 'contact' | 'bank-tax' | 'network' | 'names' | 'employment' | 'investments' | 'business' | 'documents';
/** The kinds the patterns find (the others come from the user or from the file's own marks). */
export type FoundKind = Exclude<RedactKind, 'typed' | 'drawn' | 'same-text' | 'marked'>;

/** Every group, in the order a list shows them. 'business' (company and professional numbers) is ticked by no profile. */
export const REDACT_GROUPS: readonly RedactGroup[] = ['identity', 'contact', 'bank-tax', 'employment', 'investments', 'network', 'names', 'documents', 'business'];

export const KIND_GROUP: Readonly<Record<FoundKind, RedactGroup>> = {
  pan: 'identity',
  aadhaar: 'identity',
  gstin: 'identity',
  tan: 'identity',
  'tax-din': 'identity',
  email: 'contact',
  mobile: 'contact',
  'bank-account': 'bank-tax',
  ifsc: 'bank-tax',
  micr: 'bank-tax',
  'itr-ack': 'bank-tax',
  evc: 'bank-tax',
  ip: 'network',
  name: 'names',
  address: 'names',
  addressee: 'names',
  // T-052: kinds that plainly belong to an existing group join it (so the profiles that tick it tick them)
  passport: 'identity',
  'voter-id': 'identity',
  'driving-licence': 'identity',
  'aadhaar-vid': 'identity',
  'aadhaar-eid': 'identity',
  ckyc: 'identity',
  dob: 'identity',
  card: 'bank-tax',
  upi: 'bank-tax',
  cheque: 'bank-tax',
  'loan-account': 'bank-tax',
  swift: 'bank-tax',
  landline: 'contact',
  'pin-code': 'names',
  // the new groups
  uan: 'employment',
  'pf-member': 'employment',
  'esic-ip': 'employment',
  'employee-id': 'employment',
  demat: 'investments',
  folio: 'investments',
  'insurance-policy': 'investments',
  vehicle: 'investments',
  'director-din': 'business',
  cin: 'business',
  llpin: 'business',
  'icai-membership': 'business',
  'icai-frn': 'business',
  udin: 'business',
  udyam: 'business',
  iec: 'business',
  lei: 'business',
  'esic-employer': 'business',
  challan: 'documents',
  'gst-arn': 'documents',
  'eway-bill': 'documents',
  irn: 'documents',
  'tds-certificate': 'documents',
};

/** The list name of each added kind (for redactFind.ts KIND_NAMES). Fixed words only. */
export const ADDED_KIND_NAMES: Readonly<Record<AddedKind, string>> = {
  passport: 'Passport',
  'voter-id': 'Voter ID (EPIC)',
  'driving-licence': 'Driving licence',
  'aadhaar-vid': 'Aadhaar virtual ID',
  'aadhaar-eid': 'Aadhaar enrolment number',
  ckyc: 'CKYC number',
  dob: 'Date of birth',
  uan: 'UAN',
  'pf-member': 'PF member ID',
  'esic-ip': 'ESIC insurance number',
  'esic-employer': 'ESIC employer code',
  'employee-id': 'Employee code',
  card: 'Payment card',
  upi: 'UPI ID',
  cheque: 'Cheque number',
  'loan-account': 'Loan account',
  swift: 'SWIFT/BIC code',
  demat: 'Demat account',
  folio: 'Mutual fund folio',
  'insurance-policy': 'Insurance policy',
  vehicle: 'Vehicle registration',
  'director-din': "Director's DIN",
  cin: 'CIN',
  llpin: 'LLPIN',
  'icai-membership': 'ICAI membership number',
  'icai-frn': 'Firm registration number',
  udin: 'UDIN',
  udyam: 'Udyam registration',
  iec: 'Import-export code',
  lei: 'LEI',
  challan: 'Tax challan',
  'gst-arn': 'GST ARN',
  'eway-bill': 'E-way bill',
  irn: 'E-invoice IRN',
  'tds-certificate': 'TDS certificate number',
  landline: 'Landline',
  'pin-code': 'PIN code',
};

/** The words of each added kind in the record's and the summary's counts (for redactRecord.ts COUNT_NAMES). Fixed words only. */
export const ADDED_COUNT_NAMES: Readonly<Record<AddedKind, string>> = {
  passport: 'passport',
  'voter-id': 'voter ID',
  'driving-licence': 'licence',
  'aadhaar-vid': 'Aadhaar VID',
  'aadhaar-eid': 'Aadhaar EID',
  ckyc: 'CKYC',
  dob: 'birth date',
  uan: 'UAN',
  'pf-member': 'PF ID',
  'esic-ip': 'ESIC',
  'esic-employer': 'ESIC employer',
  'employee-id': 'employee code',
  card: 'card',
  upi: 'UPI',
  cheque: 'cheque',
  'loan-account': 'loan',
  swift: 'SWIFT',
  demat: 'demat',
  folio: 'folio',
  'insurance-policy': 'policy',
  vehicle: 'vehicle',
  'director-din': 'DIN',
  cin: 'CIN',
  llpin: 'LLPIN',
  'icai-membership': 'M. No.',
  'icai-frn': 'FRN',
  udin: 'UDIN',
  udyam: 'Udyam',
  iec: 'IEC',
  lei: 'LEI',
  challan: 'challan',
  'gst-arn': 'ARN',
  'eway-bill': 'e-way bill',
  irn: 'IRN',
  'tds-certificate': 'TDS cert',
  landline: 'landline',
  'pin-code': 'PIN code',
};
const isAddedKind = (kind: RedactKind): boolean => Object.prototype.hasOwnProperty.call(ADDED_KIND_NAMES, kind);

export interface PatternMatch {
  kind: RedactKind;
  /**
   * UTF-16 offsets in the searched text; `end` is exclusive. The place to cover: for an account or card number it
   * runs on over the digit groups right after the number itself (T-052 wave 5, ruling T: coveredEnd), so the place
   * may hold more digits than `key`.
   */
  start: number;
  end: number;
  /** The text as written, `text.slice(start, end)` (spaces, hyphens, invisible characters included). */
  value: string;
  /**
   * The normalised value (see keyOf): letters and digits only, upper case, for codes (PAN, GSTIN, TAN,
   * IFSC, tax document number, EVC); the digits for Aadhaar (12), mobile (10), account, MICR and
   * acknowledgement numbers (an account number without its leading zeros, nine digits always kept, and
   * when its end is not certain the shorter number: wave 5, ruling T); lower case for email; the dotted address for IP; trimmed,
   * whitespace-collapsed lower case for names, addresses and typed terms. Every kind added in T-052
   * is a code: its letters and digits, upper case (a UPI ID without its @, a date of birth as written
   * without its separators), except the Aadhaar enrolment number (its 14 digits, without the date and
   * time) and a landline (the 10 digits of STD code and number). Always from the folded text.
   */
  key: string;
  /** 'sure': ticked when its group is ticked; 'possible': never ticked by default, shown with `reason`. */
  confidence: 'sure' | 'possible';
  reason?: string;
}

export interface Term {
  text: string;
  /** The label shown for its matches; "Typed" when the user gave none. */
  reason: string;
}

export const TERM_LIMITS = { min: 3, max: 100, count: 20 } as const;

/**
 * The profiles. Strict is "every group", so it ticks the new groups too, except 'business' (company and
 * professional numbers, ticked by no profile). DPDP personal data (T-052) ticks every group about a person,
 * possible matches too, and leaves company numbers and tax and GST document numbers to the user.
 */
export const PROFILES: Readonly<Record<'balanced' | 'strict' | 'identity' | 'dpdp', { ticked: readonly RedactGroup[]; tickPossible: boolean }>> = {
  balanced: { ticked: ['identity', 'contact', 'bank-tax'], tickPossible: false },
  strict: { ticked: ['identity', 'contact', 'bank-tax', 'network', 'names', 'employment', 'investments', 'documents'], tickPossible: true },
  identity: { ticked: ['identity'], tickPossible: false },
  dpdp: { ticked: ['identity', 'contact', 'bank-tax', 'employment', 'investments', 'network', 'names'], tickPossible: true },
};

/** The replacement text of "Label by kind". */
export const KIND_LABELS: Readonly<Record<RedactKind, string>> = {
  pan: '[PAN redacted]',
  aadhaar: '[Aadhaar redacted]',
  gstin: '[GSTIN redacted]',
  tan: '[TAN redacted]',
  'tax-din': '[tax document number redacted]',
  email: '[email redacted]',
  mobile: '[mobile redacted]',
  'bank-account': '[account redacted]',
  ifsc: '[IFSC redacted]',
  micr: '[MICR redacted]',
  'itr-ack': '[acknowledgement redacted]',
  evc: '[EVC redacted]',
  ip: '[IP address redacted]',
  name: '[name redacted]',
  address: '[address redacted]',
  addressee: '[address redacted]',
  passport: '[passport redacted]',
  'voter-id': '[voter ID redacted]',
  'driving-licence': '[driving licence redacted]',
  'aadhaar-vid': '[Aadhaar VID redacted]',
  'aadhaar-eid': '[Aadhaar enrolment redacted]',
  ckyc: '[CKYC number redacted]',
  dob: '[date of birth redacted]',
  uan: '[UAN redacted]',
  'pf-member': '[PF member ID redacted]',
  'esic-ip': '[ESIC number redacted]',
  'esic-employer': '[ESIC employer code redacted]',
  'employee-id': '[employee code redacted]',
  card: '[card number redacted]',
  upi: '[UPI ID redacted]',
  cheque: '[cheque number redacted]',
  'loan-account': '[loan account redacted]',
  swift: '[SWIFT code redacted]',
  demat: '[demat account redacted]',
  folio: '[folio redacted]',
  'insurance-policy': '[policy number redacted]',
  vehicle: '[vehicle number redacted]',
  'director-din': '[DIN redacted]',
  cin: '[CIN redacted]',
  llpin: '[LLPIN redacted]',
  'icai-membership': '[membership number redacted]',
  'icai-frn': '[FRN redacted]',
  udin: '[UDIN redacted]',
  udyam: '[Udyam number redacted]',
  iec: '[IEC redacted]',
  lei: '[LEI redacted]',
  challan: '[challan redacted]',
  'gst-arn': '[ARN redacted]',
  'eway-bill': '[e-way bill redacted]',
  irn: '[IRN redacted]',
  'tds-certificate': '[TDS certificate redacted]',
  landline: '[phone redacted]',
  'pin-code': '[PIN code redacted]',
  typed: '[REDACTED]',
  drawn: '[REDACTED]',
  'same-text': '[REDACTED]',
  marked: '[REDACTED]',
};

/**
 * The reasons shown for possible matches. Fixed words; they never hold a value. Plain words for an accountant
 * (T-052 wave 4, owner's sample run): no "holder type", "check digit" or "handle".
 */
export const REASONS = {
  panType: 'does not look like a valid PAN',
  spaced: 'a space or hyphen splits it; it may be two words',
  spacedOut: 'written with a space between every character, with no label near it',
  joined: 'joined to the characters after it',
  smallLetters: 'written in small letters',
  gstinCheck: 'does not look like a valid GSTIN: one character may be mistyped',
  gstinState: 'state code not recognised',
  aadhaarCheck: 'does not look like a valid Aadhaar number: one digit may be mistyped',
  aadhaarUnlabelled: 'twelve digits with no Aadhaar label nearby',
  mobile: 'no mobile prefix or label nearby',
  accountNearIfsc: 'a number next to an IFSC, with no account label',
  ifsc: 'a bank branch code with no account number or label',
  tan: 'shaped like a TAN, with no TAN label',
  name: 'words after a "Name" label',
  address: 'lines after an "Address" label',
  addressee: 'the lines after "To,"',
  // T-052
  relativeName: "words after S/o, D/o, W/o or a father's, mother's or spouse's name label",
  labelOnly: 'found only by the label before it',
  checkDigit: 'does not look like a valid number of this kind: one digit may be mistyped',
  dlUnlabelled: 'shaped like a driving licence, with no licence label',
  vehicleUnlabelled: 'shaped like a vehicle number, with no vehicle label',
  vidUnlabelled: 'sixteen digits shaped like an Aadhaar virtual ID, with no VID label',
  udinUnlabelled: 'shaped like a UDIN, with no UDIN label',
  upiUnknown: 'the part after @ is not a bank or payment app this tool knows',
  landlineLabelled: 'a phone number with an STD code',
  landlineUnlabelled: 'shaped like a phone number with an STD code, with no phone label',
  // T-052 wave 4 (an ITR acknowledgement and a notice)
  addresseeName: 'the first line after "To,"',
  addressBeside: 'a line with a PIN code next to an "Address" label',
  nameBeforePan: 'the name before "having PAN"',
  // T-052 wave 5 (ruling U: forms and tables)
  underHeading: 'under a column heading that names it',
  nameBelow: 'the line under a "Name" label',
  sameRow: 'in the same row as a value with a label',
  indianLabel: 'a number after a label in an Indian language',
} as const;

/**
 * Possible matches that no profile ticks by default (fix round 1, lead ruling): TAN-like and
 * IFSC-like codes, account numbers that only sit next to an IFSC, unlabelled twelve-digit numbers
 * that pass the Aadhaar check, and (fix round 2) PAN-shaped runs with a space between every character
 * and no label. Part numbers, branch codes, bank references and spaced headings dominate them, so even
 * Strict leaves them unticked; the find holds them compactly (redactFind.ts) until the user ticks one.
 */
export function neverTickedByDefault(kind: RedactKind, confidence: 'sure' | 'possible', reason?: string): boolean {
  if (confidence !== 'possible') return false;
  return (
    kind === 'tan' ||
    kind === 'ifsc' ||
    (kind === 'bank-account' && reason === REASONS.accountNearIfsc) ||
    (kind === 'aadhaar' && reason === REASONS.aadhaarUnlabelled) ||
    // fix round 2: a heading written with a space between every letter reads as a PAN as often as not
    (kind === 'pan' && reason === REASONS.spacedOut) ||
    // T-052: new kinds found by their shape alone, with no label (part and reference codes share them)
    (kind === 'driving-licence' && reason === REASONS.dlUnlabelled) ||
    (kind === 'vehicle' && reason === REASONS.vehicleUnlabelled) ||
    (kind === 'landline' && reason === REASONS.landlineUnlabelled) ||
    (kind === 'aadhaar-vid' && reason === REASONS.vidUnlabelled) ||
    (kind === 'udin' && reason === REASONS.udinUnlabelled)
  );
}

// ---- Verhoeff (Aadhaar check digit) ---------------------------------------------------------------

const VD = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const VP = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];
const VINV = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9];

export function verhoeffValid(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;
  let c = 0;
  for (let i = 0; i < digits.length; i++) c = VD[c][VP[i % 8][Number(digits[digits.length - 1 - i])]];
  return c === 0;
}

/** The check digit to append to `first11` (any length of digits). Throws a RangeError for other text. */
export function verhoeffDigit(first11: string): string {
  if (!/^\d+$/.test(first11)) throw new RangeError('Only digits have a Verhoeff check digit.');
  let c = 0;
  for (let i = 0; i < first11.length; i++) c = VD[c][VP[(i + 1) % 8][Number(first11[first11.length - 1 - i])]];
  return String(VINV[c]);
}

// ---- the shared normalisation (find and check) ------------------------------------------------------

/** Unicode format characters: soft hyphen, zero-width spaces and joiners, direction marks, byte-order mark. */
const FORMAT_CHAR = /\p{Cf}/u;
const ASCII_ONLY = {
  test(text: string): boolean {
    for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) > 0x7f) return false;
    return true;
  },
};

/** A folded text and, for each of its UTF-16 units, the [start, end) of the original character it came from. */
export interface FoldedText {
  text: string;
  starts: readonly number[];
  ends: readonly number[];
}

/**
 * THE normalisation Redact's find and check share (fix round 1, F3): each character folded by Unicode
 * compatibility (NFKC: full-width letters and digits to ASCII, ligatures split, no-break space to a
 * space) and every format character removed (soft hyphen, zero-width characters, direction marks).
 * Case is not changed. Character by character, so every unit maps back to the text.
 */
export function foldWithMap(text: string): FoldedText {
  if (ASCII_ONLY.test(text)) {
    const index = Array.from({ length: text.length }, (_, i) => i);
    return { text, starts: index, ends: index.map((i) => i + 1) };
  }
  const out: string[] = [];
  const starts: number[] = [];
  const ends: number[] = [];
  for (let i = 0; i < text.length; ) {
    const cp = text.codePointAt(i) ?? 0;
    const ch = String.fromCodePoint(cp);
    if (!FORMAT_CHAR.test(ch)) {
      const folded = cp < 0x80 ? ch : ch.normalize('NFKC');
      for (let k = 0; k < folded.length; k++) {
        out.push(folded[k]);
        starts.push(i);
        ends.push(i + ch.length);
      }
    }
    i += ch.length;
  }
  return { text: out.join(''), starts, ends };
}

/** foldWithMap's text alone: what the check compares strings with. */
export function foldText(text: string): string {
  return ASCII_ONLY.test(text) ? text : foldWithMap(text).text;
}

// A page text is searched many times in a row (every value on it): its fold is kept, but only until
// the task that searched it ends (fix round 2, MF3). The first fold kept queues a microtask that drops
// them all, so no page text outlives the search that read it, whether or not anyone calls
// clearRedactCaches.
const foldCache = new Map<string, FoldedText>();
function folded(text: string): FoldedText {
  let f = foldCache.get(text);
  if (!f) {
    f = foldWithMap(text);
    if (foldCache.size === 0) queueMicrotask(clearRedactCaches);
    if (foldCache.size >= 8) foldCache.delete(foldCache.keys().next().value as string);
    foldCache.set(text, f);
  }
  return f;
}

/**
 * Drops every page text this module holds, and what the JavaScript engine itself keeps of the last
 * string a regular expression matched (RegExp.input, lastMatch, leftContext, rightContext, $1-$9: V8
 * keeps them, process-wide, until the next successful match anywhere). Runs by itself when the task
 * that searched ends; reviewState's disposeReview calls it too.
 */
export function clearRedactCaches(): void {
  foldCache.clear();
  /(?:)/.exec('');
}

/** How many page texts this module holds right now: none once the searching task has ended (for tests). */
export function cachedTextCount(): number {
  return foldCache.size;
}

/** [start, end) of the folded text, back in the original text. */
function back(f: FoldedText, start: number, end: number): { start: number; end: number } {
  if (end <= start) {
    const at = start < f.starts.length ? f.starts[start] : (f.ends[f.ends.length - 1] ?? 0);
    return { start: at, end: at };
  }
  return { start: f.starts[start], end: f.ends[end - 1] };
}

/**
 * A RegExp built from a term or a key. Its source holds the term, and a SyntaxError's message would
 * repeat it, so a failure (none is expected: every character is escaped) becomes the fixed
 * 'redact-find-failed' error: never a silent "nothing found", never a message naming the term.
 */
export function safeRegExp(source: string, flags: string): RegExp {
  try {
    return new RegExp(source, flags);
  } catch {
    throw new PdfToolsError('redact-find-failed', PHASE_TWO_ERROR_MESSAGES['redact-find-failed'] ?? 'The file could not be searched.');
  }
}

const escapeRe = (s: string) => s.replace(/[\^$\\.*+?()[\]{}|/]/g, '\\$&');

/** Trimmed, whitespace-collapsed lower case of the folded text: the key of names, addresses and typed terms. */
export const wordsKey = (s: string): string => foldText(s).trim().replace(/\s+/g, ' ').toLowerCase();

/** The key the find gives a value written as `written` (see PatternMatch.key). */
export function keyOf(kind: RedactKind, written: string): string {
  const f = foldText(written);
  switch (kind) {
    case 'email':
      return f.replace(/\s+/g, '').toLowerCase();
    case 'ip':
      return f.replace(/\s+/g, '');
    case 'name':
    case 'address':
    case 'addressee':
    case 'typed':
    case 'same-text':
      return wordsKey(f);
    case 'drawn':
    case 'marked':
      return '';
    case 'mobile': {
      const digits = f.replace(/\D/g, '');
      return digits.length > 10 && /^(?:91|0)[6-9]/.test(digits) ? digits.slice(-10) : digits;
    }
    case 'aadhaar-eid': {
      // the 14-digit enrolment number, without the date and time printed after it
      const digits = f.replace(/\D/g, '');
      return digits.length > 14 ? digits.slice(0, 14) : digits;
    }
    case 'landline': {
      // the ten digits of the STD code and number, without +91 or the trunk 0
      let digits = f.replace(/\D/g, '');
      if (digits.length > 10 && digits.startsWith('91')) digits = digits.slice(2);
      if (digits.length > 10 && digits.startsWith('0')) digits = digits.slice(1);
      return digits;
    }
    case 'bank-account':
      return accountKey(f.replace(/[^A-Za-z0-9]/g, '').toUpperCase());
    default:
      return f.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  }
}

/**
 * T-052 wave 5 (ruling T): account numbers are compared with leading zeros removed (a statement's header prints
 * "00000030012345678", its narrations "30012345678"). Nine digits are always kept, the fewest an account number has:
 * a shorter key would be found inside every other number.
 */
const accountKey = (digits: string): string => digits.replace(/^0+(?=\d{9})/, '');

/** The most digits a place of the kind holds (18 for an account number, 19 for a card); 0 for the kinds whose places end with their key. */
const coverMax = (kind: RedactKind): number => (kind === 'bank-account' ? 18 : kind === 'card' ? 19 : 0);
/** A digit group right after a place: one space or one hyphen before it, or a line break (the number wrapped in its cell). */
const TAIL_GROUP = /^(?: |-|[ \t]*\n[ \t]*)(\d{1,19})(?![A-Za-z0-9])/;
/** What is not a group of the number's own digits: an amount, a time, a rate, a fraction, "5000/-", "1 of 4", "12 October". */
const TAIL_NOT_OWN = /^(?:[.,:/]\d|\/-|[ \t]?%|[ \t]+(?:of|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*(?![A-Za-z]))/i;
/** A date in figures starting here ("01-07-2026" after a hyphen, "2026-07-01"). */
const TAIL_DATE = /^(?:\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{4}[/.-]\d{1,2}[/.-]\d{1,2})(?!\d)/;

/**
 * T-052 wave 5 (ruling T, "key short, cover long"): where the covered place of an account or card number ends. The key
 * stays the number itself (when unsure, the shorter number: ruling H), but at every place the cover runs on over the
 * digit groups that directly follow, on the same line or on the wrapped next line, one space or hyphen apart, until
 * something that is not a group of digits, so that no tail of a longer number stays visible ("9012" after 3-3-3,
 * "78" after 4-4-4-4, "89" wrapped in its cell). Not covered: an amount, a date, a time, a rate, "1 of 4", a list
 * number at the start of the next line ("1." or "1)"), a group after a tab or two spaces (another cell), and whatever
 * would make more digits than the kind can have (`max`), which is another number. `digits` are those of the place
 * so far; nothing at or after `limit` is covered (what another kind holds).
 */
function coveredEnd(text: string, end: number, digits: number, max: number, limit: number = text.length): number {
  let at = end;
  let n = digits;
  for (;;) {
    const m = TAIL_GROUP.exec(text.slice(at, at + 48));
    if (!m) break;
    const stop = at + m[0].length;
    const start = stop - m[1].length;
    if (stop > limit || n + m[1].length > max) break;
    const after = text.slice(stop, stop + 14);
    if (TAIL_NOT_OWN.test(after) || TAIL_DATE.test(text.slice(start, start + 12))) break;
    if (m[0].includes('\n') && /^[ \t]*[.)]/.test(after)) break;
    at = stop;
    n += m[1].length;
  }
  return at;
}

/** An IP address has no digit joined to it, nor a dot that leads to one (a full stop after it is fine). */
const IP_BEFORE = '(?<!\\d|\\d\\.)';
const IP_AFTER = '(?!\\d|\\.\\d)';

/** At most this many characters that are not letters or digits may stand between two characters of a code or number. */
export const MAX_SEPARATORS = 3;

/**
 * Every place a value stands in `text`, by the ONE rule the find and the check's strict pass share
 * (fix round 1, F3). Always on the folded text (foldWithMap), places returned in `text`'s offsets.
 * - Codes and numbers (PAN, GSTIN, TAN, IFSC, tax document number, EVC, Aadhaar, mobile, account,
 *   MICR, acknowledgement, and every kind added in T-052): the key's characters in order, ignoring case,
 *   with up to MAX_SEPARATORS characters that are not ASCII letters or digits (line breaks included)
 *   between any two; found inside longer runs too (a PAN inside a GSTIN is a place of the PAN), except
 *   that an added kind whose key is 8 digits or fewer (PIN code, cheque, membership number, director's
 *   DIN, a date of birth, a challan serial) is a place only where no digit is joined to it: such short
 *   numbers sit inside amounts and references far too often. An account number is compared without its leading
 *   zeros (wave 5, ruling T). A place is the key's own characters and no more: the check and the run's reading of
 *   each drawing share this rule on texts joined from separate drawings, where what follows a number is not its
 *   tail. What the find covers at a place is coveredPlacesOfValue.
 * - Email: ignoring case; up to two white-space characters (a line break) before or after '.', '@', '-'.
 * - IP address: as written, with no digit or dot joined to it.
 * - Names, addresses, typed terms, the same text: whole words (findTerm).
 * - Drawn boxes and marks: nothing.
 */
export function placesOfValue(text: string, kind: RedactKind, key: string): { start: number; end: number }[] {
  return valuePlaces(text, kind, key, false);
}

/**
 * The places of a value as the find covers them (T-052 wave 5, ruling T, "key short, cover long"): placesOfValue's
 * places, each of an account or card number run on to the end of its digits: the zeros written before an account
 * number, the digits joined to the key (the key may be the shorter number: ruling H), and the digit groups right
 * after it (coveredEnd). Every place of placesOfValue lies inside one of these. For every other kind the same places.
 * Only for a page's own text (the find): never for text joined from separate drawings.
 */
export function coveredPlacesOfValue(text: string, kind: RedactKind, key: string): { start: number; end: number }[] {
  return valuePlaces(text, kind, key, true);
}

function valuePlaces(text: string, kind: RedactKind, key: string, cover: boolean): { start: number; end: number }[] {
  if (key === '') return [];
  let source: string;
  let flags = 'gi';
  switch (kind) {
    case 'name':
    case 'address':
    case 'addressee':
    case 'typed':
    case 'same-text':
      return findTerm(text, key);
    case 'drawn':
    case 'marked':
      return [];
    case 'email':
      source = Array.from(key, (c) => ('.@-'.includes(c) ? `\\s{0,2}${escapeRe(c)}\\s{0,2}` : escapeRe(c))).join('');
      break;
    case 'ip':
      source = IP_BEFORE + escapeRe(key) + IP_AFTER;
      flags = 'g';
      break;
    default:
      if (!/^[A-Za-z0-9]+$/.test(key)) return [];
      if (kind === 'bank-account') {
        // wave 5, ruling T: compared without leading zeros; the zeros written before it are covered with it
        source = `${cover ? '(?:(?<![\\d.,])0(?:[ -]?0)*[ -]?)?' : ''}${accountKey(key).split('').join(`[^A-Za-z0-9]{0,${MAX_SEPARATORS}}`)}`;
        break;
      }
      source = key.split('').join(`[^A-Za-z0-9]{0,${MAX_SEPARATORS}}`);
      if (isAddedKind(kind) && /^\d{1,8}$/.test(key)) source = `(?<!\\d)${source}(?!\\d)`;
  }
  const f = folded(text);
  const max = cover ? coverMax(kind) : 0;
  if (max === 0) return [...f.text.matchAll(safeRegExp(source, flags))].filter((m) => m[0].length > 0).map((m) => back(f, m.index, m.index + m[0].length));
  // An account or card number as the find covers it: the key may be the shorter number, so each place runs on to the
  // end of the digits it stands in and over the digit groups right after them (coveredEnd).
  const places: { start: number; end: number }[] = [];
  let covered = 0;
  for (const m of f.text.matchAll(safeRegExp(source, flags))) {
    if (m[0].length === 0 || m.index < covered) continue;
    let end = m.index + m[0].length;
    while (end < f.text.length && f.text.charCodeAt(end) >= 48 && f.text.charCodeAt(end) <= 57) end++;
    covered = coveredEnd(f.text, end, digitsOf(f.text.slice(m.index, end)).length, max);
    places.push(back(f, m.index, covered));
  }
  return places;
}

/** True when `text` holds the value written as `form`, by placesOfValue's rule: the check's strict pass. */
export function valueIn(text: string, kind: RedactKind, form: string): boolean {
  return placesOfValue(text, kind, keyOf(kind, form)).length > 0;
}

// ---- the patterns (design 5.9; the trial's detector with the rules below) --------------------------

const NOT_ALNUM_BEFORE = '(?<![A-Za-z0-9])';
const NOT_ALNUM_AFTER = '(?![A-Za-z0-9])';
const L = '[A-Z]';
const D = '\\d';
const times = (cls: string, n: number) => Array.from({ length: n }, () => cls);
/**
 * A code (case ignored) whose characters may each be followed by one space or hyphen: pdf.js turns a
 * kerning gap inside a value into a space (`BN ZPM2501F`), and codes are often written in hyphenated
 * groups. A match holding more than one space is refused afterwards: in normally set text two gaps, a
 * tab, two spaces or a line break are real word breaks (a space between EVERY character is the
 * spaced-out form, found by its own pass).
 */
const code = (classes: string[], sep: string, after: string) => new RegExp(`${NOT_ALNUM_BEFORE}(${classes.join(`${sep}?`)})${after}`, 'gi');

const PAN = code([...times(L, 5), ...times(D, 4), L], '[ -]', '(?![A-Za-z])');
const PAN_HOLDER_TYPES = 'ABCFGHJLPT';
// A GSTIN keeps its check character, so it may be split at any gap and glued to what follows it.
const GSTIN = code([D, D, ...times(L, 5), ...times(D, 4), L, '[1-9A-Z]', L, '[0-9A-Z]'], '[ \\n-]', '');
const GSTIN_STATES = new Set<number>([...Array.from({ length: 38 }, (_, i) => i + 1), 96, 97, 99]);
const IFSC = code([...times(L, 4), '0', ...times('[A-Z0-9]', 6)], '[ -]', NOT_ALNUM_AFTER);
const TAN = code([...times(L, 4), ...times(D, 5), L], '[ -]', NOT_ALNUM_AFTER);
const TAX_DIN = new RegExp(`${NOT_ALNUM_BEFORE}ITBA\\/\\s?[A-Z]+\\/\\s?[A-Z0-9()/]+\\/\\s?[0-9-]+\\/\\s?[0-9()]+`, 'gi');
const EMAIL = /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+\n?@\n?[A-Za-z0-9-]+(?:\.\n?[A-Za-z0-9-]+)*\.\n?[A-Za-z]{2,}(?![A-Za-z0-9])/g;
const AADHAAR = /(?<![\d+])([2-9]\d{3})([ \n-]{0,2})(\d{4})([ \n-]{0,2})(\d{4})(?!\d)/g;
const MOBILE_PREFIX = '(\\(?\\+91\\)?[\\s-]{0,2}|(?<!\\d)91[\\s-]|(?<!\\d)91(?=[6-9]\\d{9}(?!\\d))|0)?';
const MOBILE = new RegExp(`(?<!\\d)${MOBILE_PREFIX}([6-9]\\d{4}[\\s-]{0,2}\\d{5}|[6-9]\\d{2}[\\s-]\\d{3}[\\s-]\\d{4}|[6-9]\\d{3}[\\s-]\\d{3}[\\s-]\\d{3}|[6-9]\\d(?:[\\s-]\\d{2}){4})(?!\\d)`, 'g');
/** With a prefix or a label, ten digits split anywhere (a line break included). */
const MOBILE_LOOSE = new RegExp(`(?<!\\d)${MOBILE_PREFIX}([6-9](?:[ \\n-]?\\d){9})(?!\\d)`, 'g');
/**
 * A run of digit groups (T-052 wave 4, ruling H): digits, hyphens inside a group (5010-0123-4567-89,
 * 073-123456-001), one space or one line break between groups. Which groups are one account number is
 * decided afterwards (accountEnd): a balance, a date, "1 of 4" or the next line after it are not its digits.
 */
const DIGIT_RUN = /(?<![A-Za-z0-9])\d+(?:-\d+)*(?:[ \n]\d+(?:-\d+)*)*(?![A-Za-z0-9])/g;
const MICR_NUMBER = /(?<![A-Za-z0-9])\d{3}[ -]?\d{3}[ -]?\d{3}(?![A-Za-z0-9])/g;
const ACK_NUMBER = /(?<![A-Za-z0-9])\d(?:[ -]?\d){14}(?![A-Za-z0-9])/g;
const EVC_CODE = /(?<![A-Za-z0-9])(?=[A-Za-z0-9]*\d)[A-Za-z0-9]{6,12}(?![A-Za-z0-9])/g;
/** A group of an IP address, 0 to 255, perhaps zero-padded (an e-filing acknowledgement prints "067"). */
const OCTET = '(?:25[0-5]|2[0-4]\\d|[01]?\\d?\\d)';
const IPV4 = new RegExp(`${IP_BEFORE}(${OCTET}(?:\\.${OCTET}){3})${IP_AFTER}`, 'g');

// Labels. "Before" is the text just before a match (40 characters; 30 for mobile, 20 for IFSC), read
// case-insensitively. Each label starts at a word boundary, so "tel" in "Hotel" is not a label; a label
// may end in up to two of ':', '.', '-' (":-" is common on Indian forms).
const AADHAAR_HINDI = String.fromCharCode(0x0906, 0x0927, 0x093e, 0x0930);
const PAN_WORDS = /\b(?:PAN|permanent account number)\b[^\n]{0,25}$/i;
const TAN_WORDS = /\b(?:TAN|tax deduction (?:and collection )?account(?: number)?)\b[^\n]{0,25}$/i;
const AADHAAR_WORDS = new RegExp(`(?:\\b(?:aadhaa?r|uid(?:ai)?)\\b|${AADHAAR_HINDI})[^\\n]{0,25}$`, 'i');
const MOBILE_WORDS = /(?:\b(?:mobile|mob\.?|cell|phone|ph\.?|tel\.?|contact|whats ?app)\s*(?:\(m\))?|\bm[:.]|\(m\))\s*(?:no\.?|number|#)?\s*[:.-]{0,2}\s*$/i;
/**
 * T-052 wave 4 (K6): a phone word in a sentence, then at most six ordinary filler words and no digit, before the
 * number ("the mobile number on record is", "or call", "call me on", "registered with the bank is").
 */
const MOBILE_PROSE =
  /\b(?:mobile|cell(?:phone)?|phone|telephone|contact|whats ?app|call|sms|reach)(?![A-Za-z])(?:[ \t,]+(?:no\.?|number|registered|linked|updated|given|provided|on|at|is|was|with|of|the|my|our|his|her|their|your|me|us|him|them|record|bank|aadhaar|account|holder|customer|applicant|assessee|client|as|per|below|primary|alternate|personal)(?![A-Za-z])){0,6}[ \t]*[:.-]{0,2}[ \t]*$/i;
const ACCOUNT_WORDS = /\b(?:a\/c|acct\.?|account|acc\.?|sb|ca|od|cc|savings|current)\s*(?:no\.?|number|#)?\s*[:.#-]{0,2}\s*$/i;
const IFSC_WORDS = /\bifsc?\s*(?:code)?\s*[:.-]{0,2}\s*$/i;
const MICR_LINE = /\bMICR\b/i;
const ACK_LINE = /\bACK(?:NOWLEDGE?MENT)?\b/i;
/** T-052 wave 4 (K6): an acknowledgement label right before the number, its words perhaps wrapped over the lines of its cell. */
const ACK_BEFORE = /\bACK(?:NOWLEDGE?MENT)?\.?(?:\s*(?:NO\.?|NUMBER|#))?\s*[:.#-]{0,2}\s*$/i;
const EVC_WORD = /\b(?:EVC|VERIFICATION CODE)\b/i;
const IP_WORD = /\bIP\b/i;
/** The end of a Name or Address label: a colon (":-" too), or a hyphen that is not inside a word ("e-filing" is not one). */
const LABEL_END = '(?::-?|(?<![A-Za-z])-|-(?![A-Za-z]))';
const NAME_LABEL = new RegExp(`\\b(?:name|naam)\\b[^:\\-\\n\\d]{0,25}${LABEL_END}[ \\t]*([^\\n,;]{2,60})`, 'gi');
const ADDRESS_LABEL = new RegExp(`\\baddress\\b[^:\\-\\n\\d]{0,25}${LABEL_END}[ \\t]*(.+)$`, 'i');
const LABEL_LINE = /^[^:\n]{1,30}:/;
const TO_LINE = /^\s*to,?\s*$/i;
const LETTER_START = /^\s*(?:sub(?:ject)?|re|dear|ref)\b/i;

// The same labels in joined-up text (a spaced-out run with its spaces taken out): words are glued, so
// a label need only start at a word edge.
const START = '(?:^|[^A-Za-z])';
const PAN_WORDS_JOINED = new RegExp(`${START}(?:PAN|PERMANENT ?ACCOUNT ?NUMBER)[^\\n]{0,25}$`, 'i');
const TAN_WORDS_JOINED = new RegExp(`${START}(?:TAN|TAX ?DEDUCTION ?(?:AND ?COLLECTION ?)?ACCOUNT)[^\\n]{0,25}$`, 'i');
const AADHAAR_WORDS_JOINED = new RegExp(`(?:${START}(?:AADHAA?R|UID(?:AI)?)|${AADHAAR_HINDI})[^\\n]{0,25}$`, 'i');
const MOBILE_WORDS_JOINED = new RegExp(`${START}(?:MOBILE|MOB|CELL|PHONE|PH|TEL|CONTACT|WHATS ?APP)(?:\\(M\\))?(?:NO|NUMBER)?[^A-Za-z0-9]{0,4}$`, 'i');
const ACCOUNT_WORDS_JOINED = new RegExp(`${START}(?:A\\/C|ACCT|ACCOUNT|ACC|SB|CA|OD|CC|SAVINGS|CURRENT)(?:NO|NUMBER)?[^A-Za-z0-9]{0,4}$`, 'i');
const IFSC_WORDS_JOINED = new RegExp(`${START}IFSC?(?:CODE)?[^A-Za-z0-9]{0,4}$`, 'i');
const MOBILE_PREFIX_BEFORE = /(?:\+\s?91|\(\s?\+\s?91\s?\))[\s-]{0,2}$/;

const compactCode = (s: string) => s.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
const digitsOf = (s: string) => s.replace(/\D/g, '');
const spaceCount = (s: string) => s.split(' ').length - 1;
const hasSmallLetters = (s: string) => /[a-z]/.test(s);

interface Line {
  start: number;
  text: string;
}

class Finder {
  readonly lines: Line[] = [];
  private readonly claims: PatternMatch[] = [];

  constructor(readonly text: string) {
    let at = 0;
    for (const l of text.split('\n')) {
      this.lines.push({ start: at, text: l });
      at += l.length + 1;
    }
  }

  lineIndex(offset: number): number {
    let lo = 0;
    let hi = this.lines.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.lines[mid].start <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  before(offset: number, n: number): string {
    return this.text.slice(Math.max(0, offset - n), offset);
  }

  overlaps(start: number, end: number): boolean {
    return this.claims.some((c) => start < c.end && c.start < end);
  }

  /** Adds the match unless an earlier kind holds any of its text (the design's order decides). */
  add(m: Omit<PatternMatch, 'value'>): boolean {
    if (m.end <= m.start || this.overlaps(m.start, m.end)) return false;
    this.claims.push({ ...m, value: this.text.slice(m.start, m.end) });
    return true;
  }

  /**
   * For the label-led kinds (name, address, addressee): adds the parts of [start, end) that no
   * earlier kind holds, each trimmed, so a number inside an address does not drop the address.
   */
  addAround(kind: RedactKind, start: number, end: number, reason: string): void {
    const taken = this.claims.filter((c) => start < c.end && c.start < end).sort((a, b) => a.start - b.start);
    const parts: [number, number][] = [];
    let at = start;
    for (const c of taken) {
      if (c.start > at) parts.push([at, c.start]);
      at = Math.max(at, c.end);
    }
    if (at < end) parts.push([at, end]);
    for (let [s, e] of parts) {
      while (s < e && /\s/.test(this.text[s])) s++;
      while (e > s && /\s/.test(this.text[e - 1])) e--;
      const piece = this.text.slice(s, e);
      if (piece.replace(/[^\p{L}\p{N}]/gu, '').length < 2) continue;
      this.add({ kind, start: s, end: e, key: wordsKey(piece), confidence: 'possible', reason });
    }
  }

  /**
   * Wave 5 (ruling T): each account or card place runs on over the digit groups right after it (coveredEnd), up to
   * the next place of any kind. Done once every kind is found, so that no tail takes what another kind holds.
   */
  coverTails(): void {
    const sorted = this.result();
    sorted.forEach((c, k) => {
      const max = coverMax(c.kind);
      if (max === 0) return;
      const end = coveredEnd(this.text, c.end, digitsOf(c.value).length, max, sorted[k + 1]?.start ?? this.text.length);
      if (end === c.end) return;
      c.end = end;
      c.value = this.text.slice(c.start, end);
    });
  }

  result(): PatternMatch[] {
    return [...this.claims].sort((a, b) => a.start - b.start);
  }
}

function findEmails(f: Finder): void {
  for (const m of f.text.matchAll(EMAIL)) {
    f.add({ kind: 'email', start: m.index, end: m.index + m[0].length, key: keyOf('email', m[0]), confidence: 'sure' });
  }
}

function gstinConfidence(key: string, written: string): { confidence: 'sure' | 'possible'; reason?: string } | null {
  let check: string;
  try {
    check = calculateGstinCheckDigit(key.slice(0, 14));
  } catch {
    // The pattern lets only letters and digits through; a refusal here means "not a GSTIN". Its
    // message (which names a character) is never passed on.
    return null;
  }
  const stateOk = GSTIN_STATES.has(Number(key.slice(0, 2)));
  const checkOk = check === key[14];
  if (stateOk && checkOk && !hasSmallLetters(written)) return { confidence: 'sure' };
  return { confidence: 'possible', reason: !stateOk ? REASONS.gstinState : !checkOk ? REASONS.gstinCheck : REASONS.smallLetters };
}

function findGstins(f: Finder): void {
  for (const m of f.text.matchAll(GSTIN)) {
    const key = compactCode(m[0]);
    const c = gstinConfidence(key, m[0]);
    if (!c) continue;
    // Glued to what follows it, only a GSTIN whose check character holds counts.
    const glued = /[A-Za-z0-9]/.test(f.text[m.index + m[0].length] ?? '');
    if (glued && c.reason !== undefined && c.reason !== REASONS.smallLetters) continue;
    f.add({ kind: 'gstin', start: m.index, end: m.index + m[0].length, key, ...c });
  }
}

function findPans(f: Finder): void {
  for (const m of f.text.matchAll(PAN)) {
    const spaces = spaceCount(m[0]);
    if (spaces > 1) continue;
    const key = compactCode(m[0]);
    const holder = PAN_HOLDER_TYPES.includes(key[3]);
    const separated = /[ -]/.test(m[0]);
    const joined = /\d/.test(f.text[m.index + m[0].length] ?? '');
    const labelled = PAN_WORDS.test(f.before(m.index, 40));
    const small = hasSmallLetters(m[0]);
    const sure = holder && !small && ((!separated && !joined) || labelled);
    f.add({
      kind: 'pan',
      start: m.index,
      end: m.index + m[0].length,
      key,
      confidence: sure ? 'sure' : 'possible',
      reason: sure ? undefined : !holder ? REASONS.panType : small ? REASONS.smallLetters : separated ? REASONS.spaced : REASONS.joined,
    });
  }
}

/** MICR, ITR acknowledgement and EVC: numbers anchored by a keyword on their line. */
function findKeywordNumbers(f: Finder): void {
  for (const line of f.lines) {
    if (MICR_LINE.test(line.text)) {
      for (const m of line.text.matchAll(MICR_NUMBER)) {
        const s = line.start + m.index;
        f.add({ kind: 'micr', start: s, end: s + m[0].length, key: digitsOf(m[0]), confidence: 'sure' });
      }
    }
  }
  // The label on the number's line, or (wave 4, K6) right before it with its words wrapped over the lines of its cell.
  // Or (wave 5, ruling U) in the cell above it: the number alone in its cell, in the row under its heading.
  if (/ack/i.test(f.text)) {
    f.lines.forEach((line, i) => {
      const onLine = ACK_LINE.test(line.text);
      for (const m of line.text.matchAll(ACK_NUMBER)) {
        const s = line.start + m.index;
        const cell = /(?:^|\t)[ ]*$/.test(line.text.slice(0, m.index)) && /^[ ]*(?:\t|$)/.test(line.text.slice(m.index + m[0].length));
        if (onLine || ACK_BEFORE.test(f.before(s, 40)) || (cell && ACK_LINE.test(cellAbove(f, i, m.index)))) f.add({ kind: 'itr-ack', start: s, end: s + m[0].length, key: digitsOf(m[0]), confidence: 'sure' });
      }
    });
  }
  for (const line of f.lines) {
    const word = EVC_WORD.exec(line.text);
    if (!word) continue;
    const from = word.index + word[0].length;
    for (const m of line.text.slice(from).matchAll(EVC_CODE)) {
      const s = line.start + from + m.index;
      if (f.add({ kind: 'evc', start: s, end: s + m[0].length, key: m[0].toUpperCase(), confidence: 'sure' })) break;
    }
  }
}

interface AccountCandidate {
  start: number;
  end: number;
  key: string;
}

/**
 * The account numbers of the text, 9 to 18 digits each (T-052 wave 4, ruling H: a number ends where its own digits
 * end, so the value looked for everywhere else is the number itself). Each run of digit groups is read group by
 * group (accountEnd); a run may hold several numbers, or a serial number and then an account number.
 */
function accountCandidates(f: Finder): AccountCandidate[] {
  const out: AccountCandidate[] = [];
  for (const m of f.text.matchAll(DIGIT_RUN)) {
    const g = digitGroups(m[0], m.index);
    for (let i = 0; i < g.length; ) {
      let j = accountEnd(f, g, i);
      // Right after an account label, a group too short to be the number and the groups after it on the line are one
      // number written in uneven groups ("A/c No. 50100 123456789"; wave 5, ruling T: 4-4-6, 3-4-4, 2-4-4-4, as
      // letters and confirmations type it); with no label, such a group is a serial or a code.
      if (j < 0 && i + 1 < g.length && g[i].digits < ACCOUNT_LENGTH.min && ACCOUNT_WORDS.test(f.before(g[i].start, 40))) j = unevenEnd(f, g, i);
      if (j < 0) {
        i++;
        continue;
      }
      // Leading zeros are not the number (wave 5, ruling T): while fewer than nine digits stand after them, the next
      // group on the line is still its own ("012 345 678 9012", "0000 0030 0123 45678").
      for (let n = g.slice(i, j + 1).reduce((sum, x) => sum + x.digits, 0); j + 1 < g.length; j++) {
        const next = g[j + 1];
        const significant = digitsOf(f.text.slice(g[i].start, g[j].end)).replace(/^0+/, '').length;
        if (significant >= ACCOUNT_LENGTH.min || next.sep !== ' ' || n + next.digits > ACCOUNT_LENGTH.max || !ownGroup(f, next)) break;
        n += next.digits;
      }
      out.push({ start: g[i].start, end: g[j].end, key: accountKey(digitsOf(f.text.slice(g[i].start, g[j].end))) });
      i = j + 1;
    }
  }
  return out;
}

function findLabelledAccounts(f: Finder, candidates: AccountCandidate[]): void {
  candidates.forEach((c, k) => {
    if (!ACCOUNT_WORDS.test(f.before(c.start, 40)) || !f.add({ kind: 'bank-account', start: c.start, end: c.end, key: c.key, confidence: 'sure' })) return;
    // Wave 5 (ruling U): a label on the left and one person in each column: the numbers in the next cells of the row.
    for (let n = k + 1, prev = c; n < candidates.length; prev = candidates[n], n++) {
      const next = candidates[n];
      if (!/^\t+$/.test(f.text.slice(prev.end, next.start)) || !/^(?:\t|\n|$)/.test(f.text.slice(next.end, next.end + 1))) break;
      f.add({ kind: 'bank-account', start: next.start, end: next.end, key: next.key, confidence: 'possible', reason: REASONS.sameRow });
    }
  });
}

/** The cells of a line: its text between tabs (the page text writes a wide gap, a table cell's edge, as a tab). */
function cellsOf(line: Line): { start: number; text: string }[] {
  const cells: { start: number; text: string }[] = [];
  let at = 0;
  for (const text of line.text.split('\t')) {
    cells.push({ start: line.start + at, text });
    at += text.length + 1;
  }
  return cells;
}

/** The cell of the line above that stands over `offset` of line `i` (the same number of cells before it), trimmed; '' when there is none. */
function cellAbove(f: Finder, i: number, offset: number): string {
  if (i === 0) return '';
  const k = f.lines[i].text.slice(0, offset).split('\t').length - 1;
  return f.lines[i - 1].text.split('\t')[k]?.trim() ?? '';
}

function findAadhaars(f: Finder): void {
  for (const m of f.text.matchAll(AADHAAR)) {
    const key = m[1] + m[3] + m[5];
    const grouped = m[2] !== '' && m[4] !== '';
    const valid = verhoeffValid(key);
    if (!valid && !grouped) continue;
    const before = f.before(m.index, 40);
    const labelled = AADHAAR_WORDS.test(before);
    // "Mobile: 919845012345": a mobile number with its country code, not an Aadhaar.
    if (!grouped && !labelled && /^91[6-9]/.test(key) && MOBILE_WORDS.test(f.before(m.index, 30))) continue;
    const sure = valid && (grouped || labelled);
    f.add({ kind: 'aadhaar', start: m.index, end: m.index + m[0].length, key, confidence: sure ? 'sure' : 'possible', reason: sure ? undefined : valid ? REASONS.aadhaarUnlabelled : REASONS.aadhaarCheck });
  }
}

function findMobiles(f: Finder): void {
  for (const pattern of [MOBILE, MOBILE_LOOSE]) {
    for (const m of f.text.matchAll(pattern)) {
      const prefix = m[1] ?? '';
      const labelled = MOBILE_WORDS.test(f.before(m.index, 30)) || MOBILE_PROSE.test(lineBefore(f, m.index, 80));
      // "91" glued to the number counts as a prefix only with a label: it is too often a reference.
      const prefixed = prefix !== '' && (prefix !== '91' || labelled);
      const sure = prefixed || labelled;
      if (pattern === MOBILE_LOOSE && !sure) continue;
      const grouped = /[\s-]/.test(m[2]);
      // A bare run of ten digits with nothing around it is too often a bill or document number.
      if (!sure && !grouped) continue;
      const start = prefix === '91' && !prefixed ? m.index + 2 : m.index;
      f.add({ kind: 'mobile', start, end: m.index + m[0].length, key: digitsOf(m[2]), confidence: sure ? 'sure' : 'possible', reason: sure ? undefined : REASONS.mobile });
    }
  }
}

function findTans(f: Finder): void {
  for (const m of f.text.matchAll(TAN)) {
    if (spaceCount(m[0]) > 1) continue;
    const small = hasSmallLetters(m[0]);
    const sure = !small && TAN_WORDS.test(f.before(m.index, 40));
    f.add({ kind: 'tan', start: m.index, end: m.index + m[0].length, key: compactCode(m[0]), confidence: sure ? 'sure' : 'possible', reason: sure ? undefined : small ? REASONS.smallLetters : REASONS.tan });
  }
}

function findTaxDins(f: Finder): void {
  for (const m of f.text.matchAll(TAX_DIN)) {
    const small = hasSmallLetters(m[0]);
    f.add({ kind: 'tax-din', start: m.index, end: m.index + m[0].length, key: compactCode(m[0]), confidence: small ? 'possible' : 'sure', reason: small ? REASONS.smallLetters : undefined });
  }
}

function findIps(f: Finder): void {
  f.lines.forEach((line, i) => {
    for (const m of line.text.matchAll(IPV4)) {
      const labelled = IP_WORD.test(line.text.slice(Math.max(0, m.index - 40), m.index)) || (i > 0 && IP_WORD.test(f.lines[i - 1].text));
      // Without a label a dotted number is a version or a note reference far more often.
      if (!labelled) continue;
      const s = line.start + m.index;
      f.add({ kind: 'ip', start: s, end: s + m[0].length, key: m[0], confidence: 'sure' });
    }
  });
}

/** A cell that is an account heading and nothing else ("A/c No.", "Bank Account Number"). */
const ACCOUNT_HEADING = /^(?:bank\s+)?(?:a\/c(?:\s*(?:no\.?|number))?|(?:account|acct\.?)\s*(?:no\.?|number))[.:]?$/i;

/**
 * Account numbers next to an IFSC (possible), then the IFSCs themselves. Wave 5 (ruling U): under a heading cell
 * that names the account (a register whose "A/c No." and "IFSC" stand in a second heading row) the number is
 * offered like any value under its heading, not held back.
 */
function findIfscs(f: Finder, candidates: AccountCandidate[]): void {
  const codes = [...f.text.matchAll(IFSC)].filter((m) => spaceCount(m[0]) <= 1);
  const heading = codes.length === 0 ? -1 : f.lines.findIndex((l) => l.text.includes('\t') && l.text.split('\t').some((cell) => ACCOUNT_HEADING.test(cell.trim())));
  for (const m of codes) {
    const start = m.index;
    const end = start + m[0].length;
    if (f.overlaps(start, end)) continue;
    const line = f.lineIndex(start);
    const near = candidates
      .map((c) => ({ c, d: Math.abs(f.lineIndex(c.start) - line) }))
      .filter(({ c, d }) => d <= 1 && !f.overlaps(c.start, c.end))
      .sort((a, b) => a.d - b.d || Math.abs(a.c.start - start) - Math.abs(b.c.start - start))[0];
    if (near) f.add({ kind: 'bank-account', start: near.c.start, end: near.c.end, key: near.c.key, confidence: 'possible', reason: heading >= 0 && heading < f.lineIndex(near.c.start) ? REASONS.underHeading : REASONS.accountNearIfsc });
    const labelled = IFSC_WORDS.test(f.before(start, 20));
    const paired = f.result().some((x) => x.kind === 'bank-account' && x.confidence === 'sure' && Math.abs(f.lineIndex(x.start) - line) <= 1);
    const sure = (labelled || paired) && !hasSmallLetters(m[0]);
    f.add({ kind: 'ifsc', start, end, key: compactCode(m[0]), confidence: sure ? 'sure' : 'possible', reason: sure ? undefined : REASONS.ifsc });
  }
}

function findNamesAndAddresses(f: Finder): void {
  const { lines } = f;
  lines.forEach((line, i) => {
    for (const m of line.text.matchAll(NAME_LABEL)) {
      const s = line.start + m.index + m[0].length - m[1].length;
      f.addAround('name', s, s + m[1].trimEnd().length, REASONS.name);
    }
    const addr = ADDRESS_LABEL.exec(line.text);
    if (addr) {
      let end = line.start + line.text.length;
      for (let j = i + 1; j < Math.min(lines.length, i + 4) && lines[j].text.trim() !== '' && !LABEL_LINE.test(lines[j].text); j++) end = lines[j].start + lines[j].text.length;
      f.addAround('address', line.start + addr.index + addr[0].length - addr[1].length, end, REASONS.address);
    }
    if (TO_LINE.test(line.text) && i + 1 < lines.length) {
      // Up to six lines, ending (T-052 wave 4) at the line with the PIN code or before a letterhead line: a
      // notice may write its letterhead ("Government of India ...") after the address.
      let end = -1;
      let last = i;
      for (let j = i + 1; j < Math.min(lines.length, i + 7); j++) {
        if (lines[j].text.trim() === '' || LETTER_START.test(lines[j].text) || LETTERHEAD.test(lines[j].text)) break;
        end = lines[j].start + lines[j].text.length;
        last = j;
        if (PIN_IN.test(lines[j].text)) break;
      }
      const first = lines[i + 1];
      // The first line is the addressee's name, unless it is a designation ("The Assessing Officer"): offered as a
      // name of its own, so that the find also looks for it on every other page (a notice's later page headers).
      // Wave 5 (ruling U): after a designation, the next line is the name when a title stands before it ("The
      // Proprietor, / Shri Ramesh Kumar Gupta,"); the title is covered with the name but is not part of its key,
      // so that the name is found where a header writes it without the title.
      const designation = /^\s*the\b/i.test(first.text);
      const person = end > 0 ? titledName(designation ? (last >= i + 2 ? lines[i + 2] : undefined) : first) : null;
      if (person && f.add({ kind: 'name', start: person.start, end: person.end, key: person.key, confidence: 'possible', reason: REASONS.addresseeName })) {
        const from = designation ? first : lines[i + 2];
        if (from && from.start < end) f.addAround('addressee', from.start, end, REASONS.addressee);
      } else if (end > 0 && !designation) {
        f.addAround('name', first.start, first.start + first.text.length, REASONS.addresseeName);
        if (last > i + 1) f.addAround('addressee', lines[i + 2].start, end, REASONS.addressee);
      } else if (end > 0) f.addAround('addressee', first.start, end, REASONS.addressee);
    }
  });
}

// ---- the wider identifier set (T-052, lane RX-PAT) -------------------------------------------------
//
// Three kinds of rule (the R1 design: keyword-anchored values before shape-only guesses):
// - Shapes: values with a check digit or a strict shape (IRN, LEI, CIN, UDIN, Udyam, PF member ID, NSDL
//   demat, an Indian SWIFT code, a grouped payment card, a driving licence, a vehicle number, a UPI ID),
//   found anywhere. Sure, except the shapes that need their label to be sure (licence, vehicle, UDIN).
// - Labelled values: a value right after its label on the same line (passport, voter ID, the digit runs
//   of payroll, banking, company and tax documents, a date of birth, a PIN code). A plain run of digits
//   is "possible" (REASONS.labelOnly) unless a check digit confirms it. The nearest label before a value
//   is its label: a value after another kind's label (also the old kinds': Aadhaar, PAN, mobile, account)
//   is left to that kind.
// - A landline after the mobile rules, and a father's, mother's or spouse's name after the names.

type Judged = { confidence: 'sure' | 'possible'; reason?: string } | null;
const SURE: Judged = { confidence: 'sure' };
const possibleFor = (reason: string): Judged => ({ confidence: 'possible', reason });
const sureUnlessSmall = (written: string): Judged => (hasSmallLetters(written) ? possibleFor(REASONS.smallLetters) : SURE);
const labelOnly = (): Judged => possibleFor(REASONS.labelOnly);
const hindi = (...codes: number[]) => String.fromCharCode(...codes);
const HI = {
  passport: hindi(0x92a, 0x93e, 0x938, 0x92a, 0x94b, 0x930, 0x94d, 0x91f),
  voter: hindi(0x92e, 0x924, 0x926, 0x93e, 0x924, 0x93e),
  licence: hindi(0x932, 0x93e, 0x907, 0x938, 0x947, 0x902, 0x938),
  birth: hindi(0x91c, 0x928, 0x94d, 0x92e),
  date: hindi(0x924, 0x93f, 0x925, 0x93f),
  enrolment: hindi(0x928, 0x93e, 0x92e, 0x93e, 0x902, 0x915, 0x928),
  uan: hindi(0x92f, 0x942, 0x90f, 0x90f, 0x928),
  employee: hindi(0x915, 0x930, 0x94d, 0x92e, 0x91a, 0x93e, 0x930, 0x940),
  card: hindi(0x915, 0x93e, 0x930, 0x94d, 0x921),
  cheque: hindi(0x91a, 0x947, 0x915),
  loan: hindi(0x90b, 0x923),
  policy: hindi(0x92a, 0x949, 0x932, 0x93f, 0x938, 0x940),
  insurance: hindi(0x92c, 0x940, 0x92e, 0x93e),
  vehicle: hindi(0x935, 0x93e, 0x939, 0x928),
  pin: hindi(0x92a, 0x93f, 0x928),
  code: hindi(0x915, 0x94b, 0x921),
  phone: hindi(0x92b, 0x94b, 0x928),
  telephone: hindi(0x926, 0x942, 0x930, 0x92d, 0x93e, 0x937),
  father: hindi(0x92a, 0x93f, 0x924, 0x93e),
  mother: hindi(0x92e, 0x93e, 0x924, 0x93e),
  husband: hindi(0x92a, 0x924, 0x93f),
  wife: hindi(0x92a, 0x924, 0x94d, 0x928, 0x940),
  ka: hindi(0x915, 0x93e),
  naam: hindi(0x928, 0x93e, 0x92e),
};

/** Luhn (payment cards). */
function luhnValid(digits: string): boolean {
  if (!/^\d{2,}$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

/** ISO 7064 MOD 97-10, the LEI's check (ISO 17442): letters count 10-35, the whole code mod 97 is 1. */
function leiValid(code: string): boolean {
  if (!/^[A-Z0-9]{18}\d{2}$/.test(code)) return false;
  let r = 0;
  for (const ch of code) {
    const v = ch <= '9' ? ch : String(ch.charCodeAt(0) - 55);
    for (const d of v) r = (r * 10 + Number(d)) % 97;
  }
  return r === 1;
}

const MONTHS = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';
const DATE =
  `\\d{1,2}(?:st|nd|rd|th)?[ \\t/.-]{0,2}(?:${MONTHS})\\.?[ \\t,/.-]{0,3}\\d{4}` +
  `|(?:${MONTHS})\\.?[ \\t]+\\d{1,2}(?:st|nd|rd|th)?,?[ \\t]*\\d{4}` +
  '|\\d{1,2}[/.-]\\d{1,2}[/.-](?:\\d{4}|\\d{2})|\\d{4}[/.-]\\d{1,2}[/.-]\\d{1,2}';
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const monthOf = (word: string) => 1 + ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(word.slice(0, 3));

/** A calendar date (any of DATE's forms, or eight digits ddmmyyyy), year 1900-2099 or two digits. */
function validDate(written: string): boolean {
  const s = written.toLowerCase().replace(/\s+/g, ' ').trim();
  let r: RegExpExecArray | null;
  let d = 0;
  let m = 0;
  let y = 0;
  if ((r = /^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})$/.exec(s))) [y, m, d] = [Number(r[1]), Number(r[2]), Number(r[3])];
  else if ((r = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})$/.exec(s))) [d, m, y] = [Number(r[1]), Number(r[2]), r[3].length === 2 ? 1900 + Number(r[3]) : Number(r[3])];
  else if ((r = /^(\d{2})(\d{2})(\d{4})$/.exec(s))) [d, m, y] = [Number(r[1]), Number(r[2]), Number(r[3])];
  else if ((r = /^(\d{1,2})(?:st|nd|rd|th)?[ /.-]*([a-z]+)\.?[ ,/.-]*(\d{4})$/.exec(s))) [d, m, y] = [Number(r[1]), monthOf(r[2]), Number(r[3])];
  else if ((r = /^([a-z]+)\.? (\d{1,2})(?:st|nd|rd|th)?,? ?(\d{4})$/.exec(s))) [m, d, y] = [monthOf(r[1]), Number(r[2]), Number(r[3])];
  return m >= 1 && m <= 12 && d >= 1 && d <= DAYS_IN_MONTH[m - 1] && y >= 1900 && y <= 2099;
}

// ---- T-052 wave 4 (lane RX-PAT2), ruling H: a number ends where its own digits end ------------------------
//
// Page text joins table cells with one space, so a statement prints an account number followed by a balance,
// a date, "1 of 4", a branch code or the next line's first figure with nothing more than a space or a line
// break between them. Those digits are not the account's: when unsure, the shorter number is kept, because a
// number cut short is still found inside every longer place it stands, while a number read too long is found
// nowhere else at all.

/** One group of a digit run: digits, perhaps joined by hyphens; `sep` is what stands before it in the run. */
interface DigitGroup {
  start: number;
  end: number;
  digits: number;
  /** Digits only, no hyphen. */
  plain: boolean;
  sep: string;
}

/** The groups of a DIGIT_RUN match found at `at`. */
function digitGroups(run: string, at: number): DigitGroup[] {
  return [...run.matchAll(/\d+(?:-\d+)*/g)].map((m) => ({
    start: at + m.index,
    end: at + m.index + m[0].length,
    digits: digitsOf(m[0]).length,
    plain: !m[0].includes('-'),
    sep: m.index === 0 ? '' : run[m.index - 1],
  }));
}

/** Right after a group: what makes it the start of something else (an amount, a date, a time, a rate, "1 of 4", "12 October"). */
const NOT_ITS_OWN = new RegExp(`^(?:[.,:/]\\d|[ \\t]?%|[ \\t]+(?:of|${MONTHS})(?![A-Za-z]))`, 'i');
/** Nothing else on the line after a group, one closing mark at most. */
const ALONE_ON_LINE = /^[ \t]*(?:[.,;)][ \t]*)?(?:\n|$)/;
const ACCOUNT_LENGTH = { min: 9, max: 18 } as const;
/** A shorter last group joins equal groups up to this many digits (4-4-4-2, 4-4-4-3): "4-4-4-4 12" is a number and a count. */
const SHORT_LAST_MAX = 16;

const ownGroup = (f: Finder, g: DigitGroup): boolean => !NOT_ITS_OWN.test(f.text.slice(g.end, g.end + 12));

/** True when `digits` stands in `text` with no digit joined to it, anywhere but at `notAt`. */
function standsAlone(text: string, digits: string, notAt: number): boolean {
  for (let i = text.indexOf(digits); i >= 0; i = text.indexOf(digits, i + 1)) {
    if (i !== notAt && !/\d/.test(text[i - 1] ?? '') && !/\d/.test(text[i + digits.length] ?? '')) return true;
  }
  return false;
}

/**
 * The index of the last group of the account number that starts at group `i`, or -1 when none starts there:
 * - single digits one space apart (a letter-spaced number): all of them;
 * - equal groups of 3 to 6 digits and perhaps a shorter last one of 2 or more (5010 0123 4567 89), each one its
 *   own (NOT_ITS_OWN), across a line break only while the digits so far are too few for an account number;
 * - otherwise one group of 9 to 18 digits (hyphens inside it allowed), joined to the next line only when that
 *   line holds nothing but 3 or more further digits (a number wrapped in a narrow cell, fix round 1 F8) and the
 *   page does not show the shorter number standing alone elsewhere while never showing the longer one.
 */
function accountEnd(f: Finder, g: readonly DigitGroup[], i: number): number {
  const first = g[i];
  if (first.digits === 1) {
    // written with a space between every digit (letter-spaced): one number of all the run's single digits
    let j = i;
    while (j + 1 < g.length && g[j + 1].digits === 1 && g[j + 1].sep === ' ') j++;
    const n = j - i + 1;
    return n >= ACCOUNT_LENGTH.min && n <= ACCOUNT_LENGTH.max ? j : -1;
  }
  if (first.plain && first.digits >= 3 && first.digits <= 6) {
    const s = first.digits;
    let total = s;
    let j = i;
    while (j + 1 < g.length) {
      const next = g[j + 1];
      if (!next.plain || (next.sep === '\n' && total >= ACCOUNT_LENGTH.min) || !ownGroup(f, next)) break;
      if (next.digits === s && total + s <= ACCOUNT_LENGTH.max) {
        j++;
        total += s;
        continue;
      }
      if (next.digits >= 2 && next.digits < s && total + next.digits <= SHORT_LAST_MAX) {
        j++;
        total += next.digits;
      }
      break;
    }
    if (j > i && total >= ACCOUNT_LENGTH.min) return j;
  }
  if (first.digits < ACCOUNT_LENGTH.min || first.digits > ACCOUNT_LENGTH.max) return -1;
  const next = g[i + 1];
  if (next && next.sep === '\n' && next.plain && next.digits >= 3 && first.digits + next.digits <= ACCOUNT_LENGTH.max && ALONE_ON_LINE.test(f.text.slice(next.end, next.end + 8))) {
    const head = f.text.slice(first.start, first.end);
    const whole = digitsOf(head) + f.text.slice(next.start, next.end);
    if (!(standsAlone(f.text, head, first.start) && !standsAlone(f.text, whole, -1))) return i + 1;
  }
  return i;
}

/**
 * Wave 5 (ruling T): the last group of an account number written in uneven groups right after its label, starting at
 * group `i` (which is too short to be the number), or -1. The groups on the same line, one space apart, each its own
 * (NOT_ITS_OWN) and of three digits or more: one or two digits after the number are a count ("12 EMIs"), not its end.
 */
function unevenEnd(f: Finder, g: readonly DigitGroup[], i: number): number {
  let total = g[i].digits;
  let j = i;
  while (j + 1 < g.length) {
    const next = g[j + 1];
    if (next.sep !== ' ' || next.digits < 3 || total + next.digits > ACCOUNT_LENGTH.max || !ownGroup(f, next)) break;
    j++;
    total += next.digits;
  }
  return j > i && total >= ACCOUNT_LENGTH.min ? j : -1;
}

/**
 * The card number in what the card rule read (ruling H): a card written with a gap between every digit is read
 * whole (the spaced-out form); a first part of 13 to 19 digits is the card; a card
 * printed 4-4-4-4 ends there, unless a fifth group of three makes a 19-digit card and only all 19 digits pass the
 * check; 4-6-5 and 4-6-4 as printed; otherwise (a gap inside the number) the shortest run of its parts with 13 or
 * more digits that passes the check, or else the shortest with 13 or more.
 */
function cardWritten(written: string): string {
  const parts = [...written.matchAll(/\d+/g)].map((m) => ({ size: m[0].length, end: m.index + m[0].length }));
  const upTo = (n: number) => written.slice(0, parts[n - 1].end);
  const sizes = parts.map((p) => p.size);
  // written with a space or hyphen between every digit (letter-spaced): one number
  if (sizes.every((s) => s === 1)) return written;
  if (sizes.length === 1 || sizes[0] >= 13) return upTo(1);
  if (sizes.length >= 4 && sizes.slice(0, 4).every((s) => s === 4)) {
    return sizes[4] === 3 && !luhnValid(digitsOf(upTo(4))) && luhnValid(digitsOf(upTo(5))) ? upTo(5) : upTo(4);
  }
  if (sizes[0] === 4 && sizes[1] === 6 && (sizes[2] === 5 || sizes[2] === 4)) return upTo(3);
  let total = 0;
  let shortest = 0;
  for (let n = 1; n <= sizes.length; n++) {
    total += sizes[n - 1];
    if (total < 13) continue;
    if (shortest === 0) shortest = n;
    if (luhnValid(digitsOf(upTo(n)))) return upTo(n);
  }
  return shortest > 0 ? upTo(shortest) : written;
}

/** One group, or equal groups of 2 to 6 digits and perhaps a shorter last one: one number as printed, not two side by side. */
function evenlyGrouped(written: string): boolean {
  const sizes = written.split(/[ \n]+/).map((p) => digitsOf(p).length);
  if (sizes.length === 1) return true;
  const [s] = sizes;
  return s >= 2 && s <= 6 && sizes.slice(1, -1).every((n) => n === s) && sizes[sizes.length - 1] <= s;
}

// Names and addresses in table cells with no colon after the label, the name in an e-filing acknowledgement's
// verification sentence, and the "To," block's end (T-052 wave 4: the owner's ITR acknowledgement and notice).
// Page text shows a table cell's edge as one space, so a value must also look like one: a name in capitals, an
// address with its PIN code or two commas; a tab or two spaces (a wide gap) are read as a cell's edge.

/** A "Name" label at the start of a line, with no colon after it. */
const NAME_WHOSE = "(?:full|assessee'?s?|taxpayer'?s?|employee'?s?|deductee'?s?|applicant'?s?|customer'?s?|client'?s?|(?:account\\s+)?holder'?s?|member'?s?|partner'?s?|director'?s?|nominee'?s?|payee'?s?|beneficiary'?s?)";
const NAME_OF_WHOM = '(?:assessee|taxpayer|deductee|employee|applicant|account\\s+holder|customer|client|partner|director|proprietor|member|nominee|payee|beneficiary)';
/** Wave 5 (ruling U): also "Applicant's full name" and Form 16's "Name and address of the Employee"; the label may end its line. */
const NAME_CELL = new RegExp(`^[ \\t]*(?:${NAME_WHOSE}\\s+){0,2}name(\\s+(?:and|&)\\s+address)?(?:\\s+of\\s+(?:the\\s+)?${NAME_OF_WHOM})?(?=[ \\t:]|$)`, 'i');
/** A cell that is a "Name" heading and nothing else (wave 5, ruling U: the names are in the rows under it). */
const NAME_HEADING = new RegExp(`^(?:${NAME_WHOSE}\\s+){0,2}name(?:\\s+of\\s+(?:the\\s+)?${NAME_OF_WHOM})?$`, 'i');
const CAPS_WORD = "(?:M\\/S\\.?|[A-Z][A-Z.'&-]*)(?![A-Za-z])";
const TITLE_WORD = "(?:M\\/[Ss]\\.?|[A-Z][A-Za-z.'&-]*)(?![A-Za-z])";
/** After a wide gap: one to six capitalised words, up to the cell's edge. After one space: two to six in capitals. */
const NAME_AFTER_GAP = new RegExp(`^(?:\\t+| {2,})(${TITLE_WORD}(?: ${TITLE_WORD}){0,5})(?=$|\\t| {2})`);
const NAME_AFTER_SPACE = new RegExp(`^ (${CAPS_WORD}(?: ${CAPS_WORD}){1,5})(?=$|\\t| {2}| [A-Z][a-z])`);
/** Words of headings and column titles, never of a person's name (a fixed string, like the code lists above: no module-level collection). */
const NOT_IN_A_NAME = ' AND OF THE FOR TO IN BY AS ON AT WITH FROM ADDRESS NUMBER NO DATE PAN AADHAAR TAN GSTIN BANK ACCOUNT DETAILS CODE STATUS YEAR FORM TYPE ID SIGNATURE PLACE ';
const nameWords = (value: string) => !value.split(/\s+/).some((w) => NOT_IN_A_NAME.includes(` ${w.replace(/\.$/, '').toUpperCase()} `));
/** A whole cell or line that reads as a person's name: two to six words, each starting with a capital. */
const NAME_ALONE = new RegExp(`^${TITLE_WORD}(?: ${TITLE_WORD}){1,5}$`);
/** Words of headings, labels and totals: a cell or line holding one is not a person's name (wave 5: names under a heading or a label). */
const HEADING_WORD =
  /(?<![A-Za-z])(?:no|number|name|date|amount|total|tax|pan|tan|gstin|mobile|phone|email|e-mail|address|account|a\/c|bank|branch|ifsc|code|id|details|particulars|remarks|status|type|year|period|birth|d\.?o\.?b|emp|employee|employer|designation|department|salary|pay|net|gross|basic|balance|debit|credit|opening|closing|paid|deducted|deposited|grand|sub|sl|sr|serial|ref|reference|description|narration|form|section|rate|qty|quantity|value|assessment|father|mother|spouse|husband|signature|place|gender|male|female|individual|resident|nationality|occupation|category|applicant|nil|none|page|continued|location|city|state|grade|age|dept|role|shares|capital|ratio|din|uan|esic?|pf|aadhaar|passport|kyc|joining|relation|relationship|group|contact|manager)(?![A-Za-z])/i;
const nameAlone = (value: string) => NAME_ALONE.test(value) && nameWords(value) && !HEADING_WORD.test(value);
/** A further cell of a row of names: after a tab, two to six capitalised words, up to the cell's edge. */
const NAME_NEXT_CELL = new RegExp(`^\\t+(${TITLE_WORD}(?: ${TITLE_WORD}){1,5})(?=$|\\t)`);
/** A title before a person's name in an address block. */
const NAME_TITLE = /^\s*(?:shri|smt|sri|mr|mrs|ms|miss|dr|kum|kumari|prof|adv|ca)\.?[ \t]+/i;
const NAME_AFTER_TITLE = new RegExp(`^(${TITLE_WORD}(?:[ \\t]+${TITLE_WORD}){0,5})[,.]?\\s*$`);

/** Wave 5 (ruling U): the person a line of an address block names after a title ("Shri Ramesh Kumar Gupta,"): the place with its title, the key without. */
function titledName(line: Line | undefined): { start: number; end: number; key: string } | null {
  const title = line ? NAME_TITLE.exec(line.text) : null;
  const name = line && title ? NAME_AFTER_TITLE.exec(line.text.slice(title[0].length)) : null;
  if (!line || !title || !name || !nameWords(name[1])) return null;
  const lead = title[0].length - title[0].trimStart().length;
  return { start: line.start + lead, end: line.start + title[0].length + name[1].replace(/[.']+$/, '').length, key: wordsKey(name[1]) };
}

/** The name before "having PAN" (an e-filing acknowledgement: "verified by ... having PAN ..."). */
const NAME_BEFORE_PAN = new RegExp(`\\bby\\s+(${TITLE_WORD}(?:\\s+${TITLE_WORD}){0,5})\\s+(?:having|holding|bearing)\\s+(?:PAN|Aadhaar|AADHAAR)(?![A-Za-z])`, 'g');
/** An "Address" label at the start of a line, with no colon after it. */
const ADDRESS_CELL =
  /^[ \t]*(?:(?:residential|permanent|present|communication|correspondence|registered|office|postal|mailing)\s+)?address(?:\s+of\s+(?:the\s+)?(?:assessee|taxpayer|employee|applicant|deductee|premises|residence))?(?![A-Za-z])/i;
/** The same label at the end of a line, after its value (a value set a little higher than its label is written first). */
const ADDRESS_AT_END =
  /[ \t]+(?:(?:residential|permanent|present|communication|correspondence|registered|office|postal|mailing)[ \t]+)?address[ \t]*$/i;
const PIN_IN = /(?<!\d)[1-9]\d{2} ?\d{3}(?!\d)/;
const commas = (s: string) => s.split(',').length - 1;
/** An address as written in a cell: it starts with a capital or a digit, and holds its PIN code or two commas (or sits after a wide gap with a comma or digit). */
const addressLike = (value: string, wide: boolean) => /^[A-Z0-9]/.test(value) && (PIN_IN.test(value) || commas(value) >= 2 || (wide && /[\d,]/.test(value)));
/** A letterhead line, which ends a "To," block (a notice may write its letterhead after the address). */
const LETTERHEAD = new RegExp(
  `^\\s*(?:government\\s+of\\b|ministry\\s+of\\b|department\\s+of\\b|office\\s+of\\s+the\\b|income[\\s-]*tax\\s+department\\b|${hindi(0x92d, 0x93e, 0x930, 0x924)}\\s*${hindi(0x938, 0x930, 0x915, 0x93e, 0x930)}|${hindi(0x906, 0x92f, 0x915, 0x930)}\\s*${hindi(0x935, 0x93f, 0x92d, 0x93e, 0x917)}|${hindi(0x935, 0x93f, 0x924, 0x94d, 0x924)}\\s*${hindi(0x92e, 0x902, 0x924, 0x94d, 0x930, 0x93e, 0x932, 0x92f)})`,
  'i',
);

/** A name and an address in table cells with no colon, and the name before "having PAN". */
function findCellNamesAndAddresses(f: Finder): void {
  const { lines } = f;
  // Most pages hold neither label: the line-by-line pass is skipped then.
  const names = /name/i.test(f.text);
  const addresses = /address/i.test(f.text);
  if (names || addresses) lines.forEach((line, i) => {
    const label = names ? NAME_CELL.exec(line.text) : null;
    if (label) {
      const rest = line.text.slice(label[0].length);
      const m = NAME_AFTER_GAP.exec(rest) ?? NAME_AFTER_SPACE.exec(rest);
      if (m && nameWords(m[1])) {
        const s = line.start + label[0].length + m[0].length - m[1].length;
        f.addAround('name', s, s + m[1].length, REASONS.name);
        // Wave 5 (ruling U): a label on the left and one person in each column: the names in the next cells of the row.
        for (let at = label[0].length + m[0].length; ; ) {
          const more = NAME_NEXT_CELL.exec(line.text.slice(at));
          if (!more || !nameAlone(more[1])) break;
          f.addAround('name', line.start + at + more[0].length - more[1].length, line.start + at + more[0].length, REASONS.name);
          at += more[0].length;
        }
        // Form 16's "Name and address of the Employee": the lines under the name, down to the one with the PIN code.
        if (label[1] && s + m[1].length === line.start + line.text.length) {
          for (let j = i + 1; j < Math.min(lines.length, i + 5) && lines[j].text.trim() !== '' && !lines[j].text.includes('\t') && !LABEL_LINE.test(lines[j].text); j++) {
            if (!PIN_IN.test(lines[j].text)) continue;
            f.addAround('address', lines[i + 1].start, lines[j].start + lines[j].text.length, REASONS.address);
            break;
          }
        }
      } else if (/^[ \t]*:?[ \t]*$/.test(rest) && i + 1 < lines.length) {
        // Wave 5 (ruling U): the label alone on its line (a KYC form): the name is the line under it.
        const below = lines[i + 1];
        const value = below.text.trim();
        if (nameAlone(value)) {
          const s = below.start + below.text.indexOf(value);
          f.addAround('name', s, s + value.length, REASONS.nameBelow);
        }
      }
    }
    // Wave 5 (ruling U): a "Name" heading in a row of headings ("Name of the Deductee", "Employee's Name"): the names
    // in the same cell of the rows under it. Every other cell of the row must read as a heading too (a row that
    // holds a value is a label and its values), and the rows end after three lines without a name there.
    if (names && line.text.includes('\t') && /name/i.test(line.text)) {
      const cells = cellsOf(line);
      cells.forEach((cell, k) => {
        if (!NAME_HEADING.test(cell.text.trim()) || !cells.every((c, n) => n === k || HEADING_WORD.test(c.text))) return;
        for (let j = i + 1, miss = 0; j < lines.length && miss < 3; j++) {
          const under = cellsOf(lines[j]);
          const value = under[k]?.text.trim() ?? '';
          if (under.length < 2 || !nameAlone(value)) {
            miss++;
            continue;
          }
          miss = 0;
          const s = under[k].start + under[k].text.indexOf(value);
          f.addAround('name', s, s + value.length, REASONS.underHeading);
        }
      });
    }
    const address = addresses ? ADDRESS_CELL.exec(line.text) : null;
    if (address) {
      const rest = line.text.slice(address[0].length);
      if (/^[ \t]*$/.test(rest)) {
        // the label alone on its line: the value is the line below it, or above it, that holds a PIN code
        const beside = [lines[i + 1], lines[i - 1]].find((l) => l !== undefined && PIN_IN.test(l.text) && /^\s*[A-Z0-9]/.test(l.text) && !LABEL_LINE.test(l.text));
        if (beside) f.addAround('address', beside.start, beside.start + beside.text.length, REASONS.addressBeside);
      } else {
        const gap = /^(?:\t+| {2,}| )/.exec(rest);
        const cell = gap ? /^[^\t]*?(?=\t| {2}|$)/.exec(rest.slice(gap[0].length)) : null;
        const value = cell?.[0] ?? '';
        if (gap && addressLike(value, gap[0] !== ' ')) {
          const s = line.start + address[0].length + gap[0].length;
          let end = s + value.length;
          // wrapped in its cell: the lines below, down to the one with the PIN code (three at most)
          if (!PIN_IN.test(value) && s + value.length === line.start + line.text.length) {
            for (let j = i + 1; j < Math.min(lines.length, i + 4) && lines[j].text.trim() !== '' && !LABEL_LINE.test(lines[j].text); j++) {
              if (!PIN_IN.test(lines[j].text)) continue;
              end = lines[j].start + lines[j].text.length;
              break;
            }
          }
          f.addAround('address', s, end, REASONS.address);
        }
      }
    }
    const atEnd = addresses ? ADDRESS_AT_END.exec(line.text) : null;
    if (atEnd && !address) {
      const value = line.text.slice(0, atEnd.index).trim();
      const s = line.start + line.text.indexOf(value);
      if (/^[A-Z0-9]/.test(value) && PIN_IN.test(value)) f.addAround('address', s, s + value.length, REASONS.addressBeside);
    }
  });
  if (!/having|holding|bearing/i.test(f.text)) return;
  for (const m of f.text.matchAll(NAME_BEFORE_PAN)) {
    if (!nameWords(m[1])) continue;
    const s = m.index + m[0].indexOf(m[1], 2);
    f.addAround('name', s, s + m[1].length, REASONS.nameBeforePan);
  }
}

/** Vehicle and driving-licence state codes (Motor Vehicles Act registration marks, old and new). */
const STATES = 'AN|AP|AR|AS|BR|CG|CH|DD|DL|DN|GA|GJ|HP|HR|JH|JK|KA|KL|LA|LD|MH|ML|MN|MP|MZ|NL|OD|OR|PB|PY|RJ|SK|TG|TN|TR|TS|UA|UK|UP|WB';
/** ISO 3166-1 alpha-2 country codes (letters 5-6 of a SWIFT/BIC code), and XK which SWIFT uses. */
const COUNTRIES =
  ' ' +
  (
    'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI ' +
    'CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ ' +
    'GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS ' +
    'LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG ' +
    'PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK ' +
    'TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW'
  ) +
  ' ';
const isCountry = (code: string) => /^[A-Z]{2}$/.test(code) && COUNTRIES.includes(` ${code} `);
/**
 * Known UPI handles (the part after @) of the banks and payment apps in use. A UPI ID with one of them is
 * sure; any other handle with no dot is possible (an email address has a dot after @ and is found first).
 */
const UPI_HANDLES =
  ' ' +
  (
    'ybl ibl axl paytm ptyes ptaxis pthdfc ptsbi okhdfcbank okicici okaxis oksbi okbizaxis upi apl yapl rapl axisbank axisb axisbiz icici ' +
    'myicici hdfcbank hdfcbankjd sbi kotak kotak811 kmbl idfcbank idfcfirst idbi indus federal fbl kbl kvb pnb boi barodampay unionbank ' +
    'unionbankofindia uboi ubi cnrb canarabank centralbank cbin iob indianbank allbank andb psb mahb yesbank yesbankltd yesg ikwik ' +
    'freecharge airtel jio jupiteraxis sliceaxis waicici wahdfcbank waaxis wasbi dbs rbl aubank equitas hsbc sc citi citigold dlb tjsb cub ' +
    'csbpay jkb abfspay timecosmos postbank fam niyoicici superyes pingpay ezeepay nsdl'
  ) +
  ' ';
const isUpiHandle = (handle: string) => /^[a-z0-9]+$/.test(handle) && UPI_HANDLES.includes(` ${handle} `);

/** The same line's text before `offset`, at most `n` characters. */
function lineBefore(f: Finder, offset: number, n: number): string {
  const before = f.before(offset, n);
  return before.slice(before.lastIndexOf('\n') + 1);
}

const NB = '(?<![A-Za-z0-9])';
const NA = '(?![A-Za-z0-9])';
/** Inside spaced-out runs (joined up), only digits bound a value: word gaps are lost there. */
const joinedRe = (source: string, upper = false) => new RegExp(`(?<![0-9])(?:${source})(?![0-9])`, upper ? 'g' : 'gi');
/** A label right before a value in joined-up text: only filler between them. */
const joinedLabel = (source: string) => new RegExp(`(?:^|[^\\p{L}])(?:${source})(?:no|number|num|id|code|[^\\p{L}\\p{N}]){0,6}$`, 'iu');
/** A label within 25 characters before a value on its line (as PAN's), in ordinary text. */
const nearLabel = (source: string) => new RegExp(`(?<![\\p{L}\\p{M}\\p{N}])(?:${source})(?![\\p{L}\\p{M}])[^\\n]{0,25}$`, 'iu');

interface ShapeRule {
  kind: FoundKind;
  written: RegExp;
  /** The shape with its separators taken out, for spaced-out runs (null: not looked for there). */
  joined: RegExp | null;
  label: { near: RegExp; joined: RegExp } | null;
  judge: (written: string, key: string, labelled: boolean) => Judged;
}

const shapeLabel = (source: string) => ({ near: nearLabel(source), joined: joinedLabel(source) });
const DL_LABEL = `driving\\s*licen[cs]e(?:\\s*(?:no\\.?|number))?|d\\.?\\s*l\\.?\\s*(?:no\\.?|number)|licen[cs]e\\s*(?:no\\.?|number)|${HI.licence}`;
const VEHICLE_LABEL = `vehicle(?:\\s*(?:regn?\\.?|registration))?(?:\\s*(?:no\\.?|number))?|regn?\\.?\\s*no\\.?|registration\\s*(?:no\\.?|number)|r\\.?\\s*c\\.?\\s*(?:no\\.?|number)|${HI.vehicle}`;

const SHAPES: ShapeRule[] = [
  {
    // e-invoice reference number: a SHA-256 hash, 64 hexadecimal characters
    kind: 'irn',
    written: new RegExp(`${NB}[0-9a-f]{64}${NA}`, 'gi'),
    joined: null,
    label: null,
    judge: (w) => (/\d/.test(w) && /[a-f]/i.test(w) ? SURE : null),
  },
  {
    kind: 'lei',
    written: new RegExp(`${NB}[A-Z0-9]{18}\\d{2}${NA}`, 'gi'),
    joined: joinedRe('[A-Z0-9]{18}\\d{2}'),
    label: null,
    // the entity part (characters 7-18) is random letters and digits: bank references with letters only
    // in front (UTR numbers) are not LEIs even when the check happens to pass
    judge: (w, k) => (/[A-Z][^A-Z]*[A-Z]/.test(k.slice(6, 18)) && leiValid(k) ? sureUnlessSmall(w) : null),
  },
  {
    kind: 'cin',
    written: new RegExp(`${NB}[LU][ -]?\\d{5}[ -]?[A-Z]{2}[ -]?\\d{4}[ -]?[A-Z]{3}[ -]?\\d{6}${NA}`, 'gi'),
    joined: joinedRe('[LU]\\d{5}[A-Z]{2}\\d{4}[A-Z]{3}\\d{6}'),
    label: null,
    judge: (w, k) => {
      const year = Number(k.slice(8, 12));
      return year >= 1850 && year <= 2099 ? sureUnlessSmall(w) : null;
    },
  },
  {
    kind: 'udin',
    written: new RegExp(`${NB}\\d{8}[A-Z0-9]{10}${NA}`, 'gi'),
    joined: joinedRe('\\d{8}[A-Z0-9]{10}'),
    label: shapeLabel('UDIN'),
    judge: (w, k, labelled) => {
      if (labelled) return sureUnlessSmall(w);
      const year = Number(k.slice(0, 2));
      return year >= 19 && year <= 39 && /[A-Z]/.test(k.slice(8)) && !hasSmallLetters(w) ? possibleFor(REASONS.udinUnlabelled) : null;
    },
  },
  {
    kind: 'udyam',
    written: new RegExp(`${NB}UDYAM[ -]?[A-Z]{2}[ -]?\\d{2}[ -]?\\d{7}${NA}`, 'gi'),
    joined: joinedRe('UDYAM[A-Z]{2}\\d{9}'),
    label: null,
    judge: (w) => sureUnlessSmall(w),
  },
  {
    // EPFO member ID: region (2 letters), office (3), establishment (7 digits), extension (3), member (7)
    kind: 'pf-member',
    written: new RegExp(`${NB}[A-Z]{2}[ /-]?[A-Z]{3}[ /-]?\\d{7}[ /-]?\\d{3}[ /-]?\\d{7}${NA}`, 'gi'),
    joined: joinedRe('[A-Z]{5}\\d{17}'),
    label: null,
    judge: (w) => sureUnlessSmall(w),
  },
  {
    // NSDL: the depository participant's ID (IN and 6 digits) and the client ID (8 digits)
    kind: 'demat',
    written: new RegExp(`${NB}IN\\d{6}[ -]?\\d{8}${NA}`, 'g'),
    joined: joinedRe('IN\\d{14}', true),
    label: null,
    judge: () => SURE,
  },
  {
    // an Indian bank's SWIFT/BIC code: location BB (Mumbai), BX or one with a digit
    kind: 'swift',
    written: new RegExp(`${NB}[A-Z]{4}IN(?:BB|BX|[A-Z0-9]\\d|\\d[A-Z0-9])(?:[A-Z0-9]{3})?${NA}`, 'g'),
    joined: null,
    label: null,
    judge: () => SURE,
  },
  {
    // state code, RTO code, year of issue, serial number
    kind: 'driving-licence',
    written: new RegExp(`${NB}(?:${STATES})[ -]?\\d{2}[ -]?(?:19|20)\\d{2}[ -]?\\d{7}${NA}`, 'gi'),
    joined: joinedRe(`(?:${STATES})\\d{2}(?:19|20)\\d{9}`),
    label: shapeLabel(DL_LABEL),
    judge: (w, _k, labelled) => (labelled ? sureUnlessSmall(w) : hasSmallLetters(w) ? null : possibleFor(REASONS.dlUnlabelled)),
  },
  {
    // state code, district, series, number; and the Bharat series (year, BH, number, series)
    kind: 'vehicle',
    written: new RegExp(`${NB}(?:(?:${STATES})[ -]?\\d{1,2}[ -]?[A-Z]{1,3}(?:[ -]?[A-Z]{1,2})?[ -]?\\d{4}|\\d{2}[ -]?BH[ -]?\\d{4}[ -]?[A-Z]{1,2})${NA}`, 'gi'),
    joined: joinedRe(`(?:${STATES})\\d{1,2}[A-Z]{1,3}\\d{4}|\\d{2}BH\\d{4}[A-Z]{1,2}`),
    label: shapeLabel(VEHICLE_LABEL),
    judge: (w, _k, labelled) => (labelled ? sureUnlessSmall(w) : hasSmallLetters(w) ? null : possibleFor(REASONS.vehicleUnlabelled)),
  },
];

/** A UPI ID: a name or number, @, a handle with no dot (bank narrations put a hyphen or a slash after it). */
const UPI = /(?<![A-Za-z0-9._%+@-])([A-Za-z0-9][A-Za-z0-9._-]{0,99})@([A-Za-z][A-Za-z0-9]{1,30})(?![A-Za-z0-9@_]|\.[A-Za-z0-9])/g;

function findUpis(f: Finder): void {
  if (!f.text.includes('@')) return;
  for (const m of f.text.matchAll(UPI)) {
    // Bank narrations join their fields with hyphens ("UPI-RAMESH-9845012345@YBL-..."): with two or more
    // hyphens before the @, the UPI ID is the last field. With one, the whole run is kept (a hyphen may
    // be the ID's own; covering a field too many is the safe side).
    const name = m[1];
    const hyphens = name.split('-').length - 1;
    const start = m.index + (hyphens >= 2 ? name.lastIndexOf('-') + 1 : 0);
    if (m.index + name.length - start < 2) continue;
    const written = f.text.slice(start, m.index + m[0].length);
    const known = isUpiHandle(m[2].toLowerCase());
    f.add({ kind: 'upi', start, end: m.index + m[0].length, key: keyOf('upi', written), ...(known ? SURE : possibleFor(REASONS.upiUnknown)) });
  }
}

/**
 * Payment cards grouped 4-4-4-4 (or 4-4-4-4-3, 19 digits) or 4-6-5, first digit 2-6 or 8. Wave 4 (ruling H): a
 * fifth group of one or two digits is an EMI count or a day, not the card's ("4111 1111 1111 1111 12 Oct").
 */
const CARD_GROUPED = /(?<![A-Za-z0-9.,])(?:[2-68]\d{3}([ -])\d{4}\1\d{4}\1\d{4}(?:\1\d{3})?|3\d{3}([ -])\d{6}\2\d{4,5})(?![A-Za-z0-9]|[.,]\d)/g;

/** Cards and sixteen-digit groups with no other kind's label before them (that label decides them). */
function findGroupedCards(f: Finder): void {
  for (const m of f.text.matchAll(CARD_GROUPED)) {
    // 4-4-4-4-3: the fifth group is the card's own only when the sixteen digits alone fail the check
    const written = digitsOf(m[0]).length === 19 && luhnValid(digitsOf(m[0]).slice(0, 16)) ? m[0].slice(0, -4) : m[0];
    const key = digitsOf(written);
    const end = m.index + written.length;
    const labels = [...lineBefore(f, m.index, 40).matchAll(LABEL_RE)].map(labelRules);
    const last = labels[labels.length - 1];
    if (last && !last.includes('card')) continue;
    if (luhnValid(key)) f.add({ kind: 'card', start: m.index, end, key, ...SURE });
    else if (!last && key.length === 16 && verhoeffValid(key)) f.add({ kind: 'aadhaar-vid', start: m.index, end, key, ...possibleFor(REASONS.vidUnlabelled) });
  }
}

function findShapes(f: Finder): void {
  findUpis(f);
  for (const rule of SHAPES) {
    for (const m of f.text.matchAll(rule.written)) {
      const key = keyOf(rule.kind, m[0]);
      const labelled = rule.label !== null && rule.label.near.test(lineBefore(f, m.index, 40));
      const judged = rule.judge(m[0], key, labelled);
      if (judged) f.add({ kind: rule.kind, start: m.index, end: m.index + m[0].length, key, ...judged });
    }
  }
  findGroupedCards(f);
}

// Labelled values -------------------------------------------------------------------------------------

interface LabelRule {
  kind: FoundKind;
  /** The value right after its label (regex source), with no letter or digit joined to it. */
  value: string;
  /** Matched in capitals only (values of letters alone: a word in small letters is not one). */
  upper?: boolean;
  /** The value with its separators taken out, for spaced-out runs ('' = not looked for there). */
  joined: string;
  /** The value must be the first word after its label (only filler words between): for loose shapes. */
  first?: boolean;
  /** The line must also hold this. */
  lineNeeds?: RegExp;
  /** Wave 4 (ruling H): the value's own part of what `value` read, when the rule may read on into the next figure. */
  trim?: (written: string) => string;
  judge: (written: string, key: string) => Judged;
}

/** A reference (loan, policy, employee code): letters, digits, / and -, with a digit. */
const REF = '(?=[A-Z0-9/-]*\\d)[A-Z0-9][A-Z0-9/-]{4,28}[A-Z0-9]';
const REF_SHORT = '(?=[A-Z0-9/-]*\\d)[A-Z0-9][A-Z0-9/-]{1,18}[A-Z0-9]';
const sixDigits = (_w: string, key: string): Judged => (key.replace(/\D/g, '').length >= 6 ? labelOnly() : null);

const LABEL_RULES = {
  passport: { kind: 'passport', value: '[A-Z][ -]?\\d{7}|[A-Z]\\d{3}[ -]\\d{4}', joined: '[A-Z]\\d{7}', judge: sureUnlessSmall },
  voter: { kind: 'voter-id', value: '[A-Z]{3}[ -]?\\d{7}', joined: '[A-Z]{3}\\d{7}', judge: sureUnlessSmall },
  vid: { kind: 'aadhaar-vid', value: '\\d{4}(?:[ -]?\\d{4}){3}', joined: '\\d{16}', judge: (_w, k) => (verhoeffValid(k) ? SURE : possibleFor(REASONS.checkDigit)) },
  eid: {
    kind: 'aadhaar-eid',
    value: '\\d{4}[/ -]?\\d{5}[/ -]?\\d{5}(?:[ \\t,]{1,3}\\d{2}[/.-]\\d{2}[/.-]\\d{4}(?:[ \\t,]{1,3}\\d{2}:\\d{2}(?::\\d{2})?)?)?',
    joined: '\\d{14}',
    judge: labelOnly,
  },
  ckyc: { kind: 'ckyc', value: '\\d(?:[ -]?\\d){13}', joined: '\\d{14}', judge: labelOnly },
  dob: { kind: 'dob', value: DATE, joined: '\\d{2}[/.-]?\\d{2}[/.-]?\\d{4}', judge: (w) => (validDate(w) ? SURE : null) },
  uan: { kind: 'uan', value: '\\d(?:[ -]?\\d){11}', joined: '\\d{12}', judge: labelOnly },
  esicIp: { kind: 'esic-ip', value: '\\d(?:[ -]?\\d){9}', joined: '\\d{10}', judge: labelOnly },
  esicEmployer: { kind: 'esic-employer', value: '\\d(?:[ -]?\\d){16}', joined: '\\d{17}', judge: labelOnly },
  employee: { kind: 'employee-id', value: REF_SHORT, joined: '', first: true, judge: labelOnly },
  card: { kind: 'card', value: '\\d(?:[ -]?\\d){12,18}', joined: '\\d{13,19}', trim: cardWritten, judge: (_w, k) => (luhnValid(k) ? SURE : possibleFor(REASONS.checkDigit)) },
  cheque: { kind: 'cheque', value: '\\d{6}', joined: '\\d{6}', judge: labelOnly },
  loan: { kind: 'loan-account', value: REF, joined: '', first: true, judge: sixDigits },
  swift: { kind: 'swift', value: '[A-Z]{6}[A-Z0-9]{2}(?:[A-Z0-9]{3})?', upper: true, joined: '', first: true, judge: (w) => (isCountry(w.slice(4, 6)) ? SURE : null) },
  demat: { kind: 'demat', value: '\\d{4}(?:[ -]?\\d{4}){3}|\\d{8}[ -]\\d{8}', joined: '\\d{16}', judge: labelOnly },
  folio: { kind: 'folio', value: '\\d{6,15}(?:[ \\t]?\\/[ \\t]?\\d{1,4})?|[A-Z]{1,4}[/-]?\\d{6,15}(?:\\/\\d{1,4})?', joined: '', first: true, judge: labelOnly },
  policy: { kind: 'insurance-policy', value: REF, joined: '', first: true, judge: sixDigits },
  din: { kind: 'director-din', value: '\\d{8}', joined: '\\d{8}', judge: labelOnly },
  llpin: { kind: 'llpin', value: '[A-Z]{3}[ -]?\\d{4}', joined: '[A-Z]{3}\\d{4}', judge: sureUnlessSmall },
  membership: { kind: 'icai-membership', value: '\\d{6}', joined: '\\d{6}', judge: labelOnly },
  frn: { kind: 'icai-frn', value: '\\d{6}[WENSC](?:[ \\t]?\\/[ \\t]?[WENSC]?-?\\d{6})?', joined: '\\d{6}[WENSC]', judge: sureUnlessSmall },
  iec: { kind: 'iec', value: '\\d{10}', joined: '\\d{10}', judge: labelOnly },
  arn: { kind: 'gst-arn', value: '[A-Z]{2}\\d{12}[A-Z0-9]', joined: '[A-Z]{2}\\d{12}[A-Z0-9]', judge: labelOnly },
  eway: { kind: 'eway-bill', value: '\\d{4}[ -]?\\d{4}[ -]?\\d{4}', joined: '\\d{12}', judge: labelOnly },
  challan: {
    // BSR code (7 digits), date of deposit, challan serial (5 digits): separate, or joined into one number
    kind: 'challan',
    value: '\\d{7}[ \\t,/-]{1,3}\\d{2}[/.-]\\d{2}[/.-](?:\\d{4}|\\d{2})[ \\t,/-]{1,3}\\d{5}|\\d{7}(?:\\d{8}|\\d{6})\\d{5}',
    joined: '',
    judge: (w: string, k: string) => {
      const date = /\d{2}[/.-]\d{2}[/.-]\d{2,4}/.exec(w)?.[0] ?? (k.length === 20 ? k.slice(7, 15) : `${k.slice(7, 11)}20${k.slice(11, 13)}`);
      return validDate(date) ? labelOnly() : null;
    },
  },
  challanSerial: { kind: 'challan', value: '\\d{5}', joined: '', judge: labelOnly },
  tdsCert: { kind: 'tds-certificate', value: '[A-Z]{7}|(?=[A-Z0-9]*\\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{6,12}', upper: true, joined: '', first: true, lineNeeds: /\b(?:TDS|TCS|form\s*(?:16A?|27D))\b/i, judge: labelOnly },
  pin: { kind: 'pin-code', value: '[1-9]\\d{2} ?\\d{3}', joined: '[1-9]\\d{5}', judge: labelOnly },
} satisfies Record<string, LabelRule>;
type LabelRuleId = keyof typeof LABEL_RULES;

/**
 * The labels (regex sources; words joined by \s* so that joined-up text matches too) and the rules they
 * lead to. The last entry is the old kinds' labels: a value after one of them is left to that kind. Where
 * two labels start at the same place the first listed wins.
 */
const LABELS: { source: string; rules: LabelRuleId[] }[] = [
  { source: `passport(?:\\s*(?:no\\.?|number))?|${HI.passport}`, rules: ['passport'] },
  {
    source: `EPIC(?:\\s*no\\.?)?|voter(?:'?s)?(?:\\s*(?:id(?:entity)?|photo))?(?:\\s*card)?(?:\\s*(?:no\\.?|number))?|election\\s*(?:card|id)(?:\\s*no\\.?)?|elector'?s?\\s*photo\\s*identity\\s*card|${HI.voter}`,
    rules: ['voter'],
  },
  { source: 'VID|virtual\\s*id(?:entity)?(?:\\s*(?:no\\.?|number))?', rules: ['vid'] },
  { source: `enrol(?:l)?ment\\s*(?:no\\.?|number|id)|EID|${HI.enrolment}`, rules: ['eid'] },
  { source: 'c[\\s-]*kyc(?:\\s*(?:no\\.?|number|id))?|KIN|central\\s*kyc(?:\\s*(?:no\\.?|number))?|kyc\\s*(?:identification\\s*)?(?:no\\.?|number|id)', rules: ['ckyc'] },
  { source: `d\\.?\\s*o\\.?\\s*b\\.?|date\\s*of\\s*birth|birth\\s*date|born\\s*on|${HI.birth}(?:\\s*${HI.date})?`, rules: ['dob'] },
  { source: `UAN(?:\\s*no\\.?)?|universal\\s*account\\s*(?:no\\.?|number)?|${HI.uan}`, rules: ['uan'] },
  { source: 'ESIC?(?:\\s*(?:IP|insurance|employer|code|regn?\\.?|registration))*(?:\\s*(?:no\\.?|number))?|I\\.?\\s*P\\.?\\s*(?:no\\.?|number)|insured\\s*person(?:\\s*(?:no\\.?|number))?', rules: ['esicIp', 'esicEmployer'] },
  { source: "employer'?s?\\s*code(?:\\s*no\\.?)?", rules: ['esicEmployer'] },
  { source: `emp(?:loyee)?\\.?\\s*(?:code|id|no\\.?|number)|staff\\s*(?:code|id|no\\.?)|${HI.employee}(?:\\s*(?:code|id|no\\.?))?`, rules: ['employee'] },
  { source: `(?:credit|debit|atm|prepaid|forex)\\s*card(?:\\s*(?:no\\.?|number))?|card\\s*(?:no\\.?|number)|${HI.card}(?:\\s*(?:no\\.?|number))?`, rules: ['card'] },
  { source: `che(?:que|ck)\\s*(?:no\\.?|number|#)|chq\\.?(?:\\s*(?:no\\.?|#))?|${HI.cheque}`, rules: ['cheque'] },
  { source: `loan\\s*(?:a\\/c|account|acct\\.?)(?:\\s*(?:no\\.?|number|id))?|loan\\s*(?:no\\.?|number|id)|${HI.loan}`, rules: ['loan'] },
  { source: 'SWIFT(?:\\s*\\/?\\s*(?:BIC|code))*|BIC(?:\\s*\\/?\\s*(?:SWIFT|code))*', rules: ['swift'] },
  {
    source: 'demat(?:\\s*(?:a\\/c|account|acct\\.?))?(?:\\s*(?:no\\.?|number|id))?|BO\\s*ID|beneficiary(?:\\s*owner)?(?:\\s*(?:id|a\\/c|account))?(?:\\s*no\\.?)?|DP\\s*ID(?:\\s*\\/\\s*client\\s*ID)?|client\\s*ID|CDSL|NSDL',
    rules: ['demat'],
  },
  { source: '(?<!ledger\\s{0,3})folio(?:\\s*(?:no\\.?|number))?', rules: ['folio'] },
  { source: `(?:insurance\\s*)?policy\\s*(?:no\\.?|number)|insurance\\s*policy|${HI.policy}(?:\\s*(?:no\\.?|number))?|${HI.insurance}`, rules: ['policy'] },
  { source: 'DIN(?:\\s*no\\.?)?|director\\s*identification\\s*(?:no\\.?|number)?', rules: ['din'] },
  { source: 'LLPIN|LLP\\s*(?:identification|regn?\\.?|registration)\\s*(?:no\\.?|number)?', rules: ['llpin'] },
  { source: 'M\\.?\\s*No\\.?|membership\\s*(?:no\\.?|number)|MRN', rules: ['membership'] },
  { source: 'FRN|firm\\s*reg(?:istration|n)?\\.?\\s*(?:no\\.?|number)?|ICAI\\s*firm\\s*(?:reg(?:istration|n)?\\.?)?\\s*(?:no\\.?|number)?', rules: ['frn'] },
  { source: 'IEC(?:\\s*(?:no\\.?|code|number))?|import\\s*(?:-|and|&)?\\s*export\\s*code|IE\\s*code', rules: ['iec'] },
  { source: 'ARN|application\\s*ref(?:erence)?\\.?\\s*(?:no\\.?|number)', rules: ['arn'] },
  { source: 'e[\\s-]*way\\s*bill(?:\\s*(?:no\\.?|number))?|EWB(?:\\s*no\\.?)?', rules: ['eway'] },
  { source: 'challan\\s*(?:serial|sl\\.?)\\s*(?:no\\.?|number)?', rules: ['challanSerial'] },
  { source: 'CIN\\s*of\\s*challan|challan\\s*identification\\s*(?:no\\.?|number)?|challan(?:\\s*no\\.?)?|BSR(?:\\s*code)?', rules: ['challan'] },
  { source: '(?:TDS|TCS)?\\s*cert(?:ificate)?\\.?\\s*(?:no\\.?|number)', rules: ['tdsCert'] },
  { source: `pin\\s*(?:code)?(?:\\s*no\\.?)?|pincode|postal\\s*code|${HI.pin}(?:\\s*(?:code|${HI.code}))?`, rules: ['pin'] },
  {
    source: `PAN|permanent\\s*account\\s*(?:no\\.?|number)|TAN|aadhaa?r|UIDAI|UID|${AADHAAR_HINDI}|mobile|mob\\.?|phone|tel\\.?|whats\\s*app|a\\/c|acct\\.?|account|IFSC|MICR|ack(?:nowledge?ment)?|EVC|GSTIN|GST\\s*no\\.?`,
    rules: [],
  },
];
// The word-edge guards stand outside the alternation (measured: the same matches, two to three times
// faster than a guard inside every alternative); every label starts with a Latin or Devanagari letter.
const LABEL_RE = new RegExp(`(?=[A-Za-z\\u0900-\\u097F])(?<![\\p{L}\\p{M}\\p{N}])(?:${LABELS.map((l) => `(${l.source})`).join('|')})(?![\\p{L}\\p{M}])`, 'giu');
/** The rules a match of LABEL_RE leads to ([] for an old kind's label). */
const labelRules = (m: RegExpMatchArray): LabelRuleId[] => LABELS[m.findIndex((g, i) => i > 0 && g !== undefined) - 1]?.rules ?? [];

const RULE_VALUE = Object.fromEntries(
  (Object.entries(LABEL_RULES) as [LabelRuleId, LabelRule][]).map(([id, r]) => {
    const flags = r.upper ? '' : 'i';
    return [id, { at: new RegExp(`${NB}(?:${r.value})${NA}`, `g${flags}`), whole: new RegExp(`^(?:${r.value})$`, flags) }];
  }),
) as Record<LabelRuleId, { at: RegExp; whole: RegExp }>;
/** What may stand between a label and a value that must be the first word after it. */
const FILLER = /^(?:[^A-Za-z0-9]|(?:no|nos|number|num|id|code|ref|is)(?![A-Za-z]))*$/i;
/** How far after its label a value may start. */
const LABEL_REACH = 40;

/** Values right after their labels on the same line; the nearest label before a value is its label. */
function findLabelled(f: Finder): void {
  const hits = [...f.text.matchAll(LABEL_RE)].map((m) => ({ start: m.index, end: m.index + m[0].length, rules: labelRules(m) }));
  hits.forEach((hit, h) => {
    if (hit.rules.length === 0) return;
    const line = f.lines[f.lineIndex(hit.start)];
    const lineText = line.text;
    const from = hit.end - 1;
    const window = f.text.slice(from, Math.min(line.start + lineText.length, hit.end + LABEL_REACH + 80));
    let best: { id: LabelRuleId; start: number; end: number; written: string } | null = null;
    for (const id of hit.rules) {
      const rule: LabelRule = LABEL_RULES[id];
      if (rule.lineNeeds && !rule.lineNeeds.test(lineText)) continue;
      const re = RULE_VALUE[id].at;
      re.lastIndex = 1;
      const m = re.exec(window);
      if (!m) continue;
      const gap = window.slice(1, m.index);
      if (gap.length > LABEL_REACH || /\d/.test(gap) || (rule.first && !FILLER.test(gap))) continue;
      const start = from + m.index;
      const written = rule.trim ? rule.trim(m[0]) : m[0];
      // The nearer value; at the same place (wave 4, ruling H) one number as printed before two read together
      // ("ESIC No. 3100123456 1234567" is a 10-digit insurance number, not a 17-digit employer code), then the longer.
      const even = evenlyGrouped(written);
      const better = !best || start < best.start || (start === best.start && (even !== evenlyGrouped(best.written) ? even : written.length > best.written.length));
      if (better) best = { id, start, end: start + written.length, written };
    }
    if (!best) {
      if (hit.rules.includes('dob')) findBirthDatesBelow(f, hit.start, hit.end);
      return;
    }
    const found = best;
    // A nearer label that could lead to this value is its label.
    const nearer = hits.some((o, k) => k !== h && o.start >= hit.end && o.end <= found.start && (o.rules.length === 0 || o.rules.some((r) => RULE_VALUE[r].whole.test(found.written))));
    if (nearer) return;
    const rule: LabelRule = LABEL_RULES[found.id];
    const key = keyOf(rule.kind, found.written);
    const judged = rule.judge(found.written, key);
    if (!judged || !f.add({ kind: rule.kind, start: found.start, end: found.end, key, ...judged })) return;
    // Wave 5 (ruling U): a label on the left and one person in each column: the dates in the next cells of the row.
    if (rule.kind === 'dob') {
      for (let at = found.end; ; ) {
        const more = DATE_NEXT_CELL.exec(f.text.slice(at, line.start + lineText.length));
        if (!more || !validDate(more[1])) break;
        f.add({ kind: 'dob', start: at + 1, end: at + more[0].length, key: keyOf('dob', more[1]), ...possibleFor(REASONS.sameRow) });
        at += more[0].length;
      }
    }
  });
}

const DATE_NEXT_CELL = new RegExp(`^\\t(${DATE})(?=\\t|$)`, 'i');
const DATE_BELOW = new RegExp(`^[ \\t]*(${DATE})(?=$|[ \\t])`, 'i');
const DATE_ALONE = new RegExp(`^(?:${DATE})$`, 'i');

/**
 * Wave 5 (ruling U): a "Date of birth" label with no date after it on its line, the label perhaps wrapped over two
 * lines of its cell, and at most a format hint or a colon after it.
 * - A form with the label above its value: the date that starts the next line (sure).
 * - A column heading: the dates that stand alone in a cell of the rows below, one in each row (possible). When any
 *   row holds two such dates, which column is the birth date is not known and none is offered.
 */
function findBirthDatesBelow(f: Finder, labelStart: number, labelEnd: number): void {
  const li = f.lineIndex(labelEnd - 1);
  const line = f.lines[li];
  if (!/^[ \t]*(?:\([^)\n]*\))?[ \t]*[:.-]{0,2}[ \t]*$/.test(f.text.slice(labelEnd, line.start + line.text.length)) || li + 1 >= f.lines.length) return;
  const next = f.lines[li + 1];
  const below = DATE_BELOW.exec(next.text);
  if (below) {
    if (validDate(below[1])) f.add({ kind: 'dob', start: next.start + below[0].length - below[1].length, end: next.start + below[0].length, key: keyOf('dob', below[1]), confidence: 'sure' });
    return;
  }
  // a heading is a cell of its own
  const first = f.lines[f.lineIndex(labelStart)];
  if (!/(?:^|\t)[ ]*$/.test(f.text.slice(first.start, labelStart))) return;
  const dates: { start: number; text: string }[] = [];
  for (let j = li + 1; j < Math.min(f.lines.length, li + 200); j++) {
    if (!f.lines[j].text.includes('\t')) continue;
    const inRow = cellsOf(f.lines[j]).filter((c) => DATE_ALONE.test(c.text.trim()) && validDate(c.text.trim()));
    if (inRow.length > 1) return;
    if (inRow.length === 1) dates.push(inRow[0]);
  }
  for (const cell of dates) {
    const value = cell.text.trim();
    const s = cell.start + cell.text.indexOf(value);
    f.add({ kind: 'dob', start: s, end: s + value.length, key: keyOf('dob', value), ...possibleFor(REASONS.underHeading) });
  }
}

// A number after a label in an Indian script (wave 5, ruling U) -----------------------------------------------

/** Devanagari to Malayalam: the scripts of the Indian languages forms are printed in. */
const INDIAN_LETTER = /[\u0900-\u0D7F]/;
const INDIAN_LABEL = /^[^A-Za-z0-9\t]*[\u0900-\u0D7F][^A-Za-z0-9\t]*$/;
const LABELLED_IN_CELL = /^([^A-Za-z0-9\t]*[\u0900-\u0D7F][^A-Za-z0-9\t]*?)[ ]*[:.-]{1,2}[ ]*(\d{9,18})[ ]*$/;

/**
 * This module reads the labels of English and Hindi forms only. A number of 9 to 18 Latin digits that stands alone
 * in its cell right after a cell (or, with a colon, after words) in an Indian script is still some identifier of
 * the person: offered as possible, a mobile number when it has that shape, an account number otherwise.
 */
function findAfterIndianLabels(f: Finder): void {
  if (!INDIAN_LETTER.test(f.text)) return;
  const offer = (start: number, digits: string) => {
    const kind: RedactKind = /^[6-9]\d{9}$/.test(digits) ? 'mobile' : 'bank-account';
    f.add({ kind, start, end: start + digits.length, key: keyOf(kind, digits), ...possibleFor(REASONS.indianLabel) });
  };
  for (const line of f.lines) {
    if (!INDIAN_LETTER.test(line.text)) continue;
    const cells = cellsOf(line);
    cells.forEach((cell, k) => {
      const value = cell.text.trim();
      if (/^\d{9,18}$/.test(value) && k > 0 && INDIAN_LABEL.test(cells[k - 1].text)) offer(cell.start + cell.text.indexOf(value), value);
      const inCell = LABELLED_IN_CELL.exec(cell.text);
      if (inCell) offer(cell.start + cell.text.lastIndexOf(inCell[2]), inCell[2]);
    });
  }
}

// Landlines and relatives' names -------------------------------------------------------------------------

/** An STD code and number: 0 and code with a separator, (0code), or +91 and code (national number 10 digits). */
const LANDLINE = /(?<![\d+(])(?:0([1-9]\d{1,3})[ -]|\(0([1-9]\d{1,3})\)[ -]?|\+91[ -]?(?:\(0\)[ -]?)?([1-9]\d{1,3})[ -])(\d{2,4}[ -]?\d{2,4})(?![\d]|[.,]\d)/g;
const LANDLINE_WORDS = new RegExp(
  `(?:(?<![\\p{L}\\p{N}])(?:tel(?:ephone)?|phone|ph|landline|office|off|resi(?:dence)?|fax|std|board)\\.?(?:\\s*\\((?:o|r|off|res)\\))?|${HI.phone}|${HI.telephone})\\s*(?:no\\.?|number)?\\s*[:.-]{0,2}\\s*$`,
  'iu',
);

function findLandlines(f: Finder): void {
  for (const m of f.text.matchAll(LANDLINE)) {
    const code = m[1] ?? m[2] ?? m[3] ?? '';
    if (code.length + digitsOf(m[4]).length !== 10) continue;
    const labelled = LANDLINE_WORDS.test(lineBefore(f, m.index, 30));
    f.add({ kind: 'landline', start: m.index, end: m.index + m[0].length, key: keyOf('landline', m[0]), ...possibleFor(labelled ? REASONS.landlineLabelled : REASONS.landlineUnlabelled) });
  }
}

const NAME_WORD = "\\p{L}[\\p{L}\\p{M}.']*";
const NAME_STOP = "(?:aged?|resident|residing|having|who|at|by|years?)(?![\\p{L}])|\\p{L}\\s?\\/";
/**
 * A relative's name: after S/o, D/o, W/o, C/o, "son of", "wife of", a father's, mother's, husband's,
 * wife's, spouse's or guardian's name label (with a colon, or the word "name"), or the Hindi labels;
 * up to six words, stopping at a comma, a digit, "aged" or "R/o".
 */
const RELATIVE = new RegExp(
  `(?<![\\p{L}\\p{N}])(?:[SDWC]\\s?\\/\\s?O|(?:son|daughter|wife|husband)\\s+of|(?:father|mother|husband|wife|spouse|guardian)(?:'?s)?(?:\\s+name(?![\\p{L}])[ \\t]*[:.-]{0,2}|[ \\t]*[:-])|(?:${HI.father}|${HI.mother}|${HI.husband}|${HI.wife})(?:\\s*${HI.ka}\\s*${HI.naam})?(?![\\p{L}\\p{M}])[ \\t]*[:.-]{0,2})[ \\t]*(${NAME_WORD}(?:[ \\t]+(?!${NAME_STOP})${NAME_WORD}){0,5})`,
  'giu',
);

function findRelativeNames(f: Finder): void {
  for (const m of f.text.matchAll(RELATIVE)) {
    // "w/o" in small letters is "without" as often as "wife of"
    if (m[0].startsWith('w')) continue;
    const s = m.index + m[0].length - m[1].length;
    const value = m[1].replace(/[.' ]+$/, '');
    f.addAround('name', s, s + value.length, REASONS.relativeName);
  }
}

// ---- spaced-out values (fix round 1, F1) -------------------------------------------------------------

/** A run of single characters with one separator between each (pdf.js's letter-spaced text, boxed forms), joined up. */
export interface SpacedRun {
  /** [start, end) in the searched text. */
  start: number;
  end: number;
  /** The characters without their separators. */
  joined: string;
  /** For each character of `joined`, its offset in the searched text. */
  at: number[];
}

/** At least six single characters, each pair separated by exactly one space, or by one '-', '.' or '/' used throughout. */
const SPACED = /(?<!\S)\S(?: \S){5,}(?!\S)|(?<![A-Za-z0-9])[A-Za-z0-9](?:([-./])[A-Za-z0-9])(?:\1[A-Za-z0-9]){4,}(?![A-Za-z0-9])/g;

/** The spaced-out runs of a text. */
export function spacedRuns(text: string): SpacedRun[] {
  const runs: SpacedRun[] = [];
  for (const m of text.matchAll(SPACED)) {
    const at: number[] = [];
    for (let k = 0; k < m[0].length; k += 2) at.push(m.index + k);
    runs.push({ start: m.index, end: m.index + m[0].length, joined: at.map((i) => text[i]).join(''), at });
  }
  return runs;
}

/**
 * Codes, numbers and emails inside spaced-out runs, by the usual label rules. Word gaps are often lost
 * in such runs ("P A N B N Z P M …"), so a code is found inside the joined characters without word
 * edges; its digits fix where it stands. Labels are read from the text before the run and from the
 * joined characters before the match. Every place covers the whole spaced-out value as written.
 */
function findSpacedOut(f: Finder): void {
  for (const run of spacedRuns(f.text)) {
    const J = run.joined;
    const line = f.lines[f.lineIndex(run.start)];
    const lineText = line.text;
    const before = (js: number) => (f.text.slice(Math.max(line.start, run.start - 40), run.start) + J.slice(0, js)).slice(-60);
    const add = (kind: RedactKind, js: number, je: number, key: string, sure: boolean, reason?: string) =>
      f.add({ kind, start: run.at[js], end: run.at[je - 1] + 1, key, confidence: sure ? 'sure' : 'possible', reason: sure ? undefined : reason });
    const addJudged = (kind: RedactKind, js: number, je: number, key: string, judged: Judged) => {
      if (judged) f.add({ kind, start: run.at[js], end: run.at[je - 1] + 1, key, ...judged });
    };
    // T-052: a value of an added kind right after its label (that label wins over the old kinds' guesses below)
    for (const rule of SPACED_LABELLED) {
      for (const m of J.matchAll(rule.value)) {
        if (!rule.label.test(before(m.index))) continue;
        const key = keyOf(rule.kind, m[0]);
        addJudged(rule.kind, m.index, m.index + m[0].length, key, rule.judge(m[0], key));
      }
    }
    // T-052: the added kinds found by their shape (strict shapes: before the old kinds' guesses)
    for (const rule of SHAPES) {
      if (!rule.joined) continue;
      for (const m of J.matchAll(rule.joined)) {
        const key = keyOf(rule.kind, m[0]);
        const labelled = rule.label !== null && rule.label.joined.test(before(m.index));
        addJudged(rule.kind, m.index, m.index + m[0].length, key, rule.judge(m[0], key, labelled));
      }
    }
    for (const m of J.matchAll(EMAIL)) add('email', m.index, m.index + m[0].length, keyOf('email', m[0]), true);
    for (const m of J.matchAll(/\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z][A-Z][0-9A-Z]/gi)) {
      const key = m[0].toUpperCase();
      const c = gstinConfidence(key, m[0]);
      if (c) add('gstin', m.index, m.index + 15, key, c.confidence === 'sure', c.reason);
    }
    for (const m of J.matchAll(/[A-Z]{5}\d{4}[A-Z]/gi)) {
      const key = m[0].toUpperCase();
      const holder = PAN_HOLDER_TYPES.includes(key[3]);
      const small = hasSmallLetters(m[0]);
      const labelled = PAN_WORDS_JOINED.test(before(m.index));
      add('pan', m.index, m.index + 10, key, holder && !small && labelled, !holder ? REASONS.panType : small ? REASONS.smallLetters : REASONS.spacedOut);
    }
    for (const m of J.matchAll(/\d+/g)) {
      const digits = m[0];
      const s = m.index;
      const e = s + digits.length;
      const b = before(s);
      if (digits.length === 9 && (MICR_LINE.test(lineText) || /MICR/i.test(J))) add('micr', s, e, digits, true);
      else if (digits.length === 15 && (ACK_LINE.test(lineText) || /ACK/i.test(J.slice(0, s)))) add('itr-ack', s, e, digits, true);
      else if (digits.length >= 9 && digits.length <= 18 && ACCOUNT_WORDS_JOINED.test(b)) add('bank-account', s, e, accountKey(digits), true);
      else if (digits.length === 12 && /^[2-9]/.test(digits) && verhoeffValid(digits) && !/^91[6-9]/.test(digits)) add('aadhaar', s, e, digits, AADHAAR_WORDS_JOINED.test(b), REASONS.aadhaarUnlabelled);
      else {
        // Ten digits starting 6-9, perhaps after 0 or a glued 91; sure with a label or a prefix ("91"
        // glued counts only with a label), and otherwise not a mobile (a bare run of digits).
        const body = digits.length === 12 && digits.startsWith('91') ? 2 : digits.length === 11 && digits.startsWith('0') ? 1 : 0;
        if (digits.length - body !== 10 || !/^[6-9]/.test(digits.slice(body))) continue;
        const labelled = MOBILE_WORDS_JOINED.test(b);
        const prefixed = MOBILE_PREFIX_BEFORE.test(b) || body === 1 || (body === 2 && labelled);
        if (labelled || prefixed) add('mobile', s, e, digits.slice(body), true);
      }
    }
    for (const m of J.matchAll(/[A-Z]{4}\d{5}[A-Z]/gi)) add('tan', m.index, m.index + 10, m[0].toUpperCase(), !hasSmallLetters(m[0]) && TAN_WORDS_JOINED.test(before(m.index)), REASONS.tan);
    for (const m of J.matchAll(/[A-Z]{4}0[A-Z0-9]{6}/gi)) add('ifsc', m.index, m.index + 11, m[0].toUpperCase(), !hasSmallLetters(m[0]) && IFSC_WORDS_JOINED.test(before(m.index)), REASONS.ifsc);
  }
}

/** For spaced-out runs: each labelled rule's value joined up, and its labels right before it. */
const SPACED_LABELLED = (Object.keys(LABEL_RULES) as LabelRuleId[])
  .map((id) => {
    const rule: LabelRule = LABEL_RULES[id];
    const sources = LABELS.filter((l) => l.rules.includes(id)).map((l) => l.source);
    return { kind: rule.kind, judge: rule.judge, joined: rule.joined, upper: rule.upper === true, sources };
  })
  .filter((r) => r.joined !== '' && r.sources.length > 0)
  .map((r) => ({ kind: r.kind, judge: r.judge, value: joinedRe(r.joined, r.upper), label: joinedLabel(r.sources.join('|')) }));

/**
 * Every kind of design 5.9 in `text`, sorted by start, never overlapping, with offsets in `text`.
 * The text is searched folded (foldWithMap: full-width forms, invisible characters), as written and,
 * for spaced-out runs, joined up. Where kinds overlap, the first in the design's order keeps the text:
 * email, (T-052) UPI ID and the added shapes (IRN, LEI, CIN, UDIN, Udyam, PF member ID, NSDL demat,
 * Indian SWIFT code, driving licence, vehicle, grouped card), GSTIN, PAN, MICR, ITR acknowledgement,
 * EVC, account number after an account word, (T-052) the added kinds after their labels, Aadhaar,
 * mobile, (T-052) landline, TAN, tax document number, IP address, spaced-out values, account number
 * next to an IFSC, IFSC, (wave 5) a number after a label in an Indian script, names and addresses, then (T-052)
 * relatives' names; last, each account or card place is run on over the digit groups after it. Every kind is looked for
 * whatever `groups` holds, so a value is classified the same way however the search is narrowed; only
 * the matches of kinds in `groups` are returned.
 */
export function findPatterns(text: string, groups: ReadonlySet<RedactGroup>): PatternMatch[] {
  const fold = folded(text);
  const f = new Finder(fold.text);
  const accounts = accountCandidates(f);
  findEmails(f);
  findShapes(f);
  findGstins(f);
  findPans(f);
  findKeywordNumbers(f);
  findLabelledAccounts(f, accounts);
  findLabelled(f);
  findAadhaars(f);
  findMobiles(f);
  findLandlines(f);
  findTans(f);
  findTaxDins(f);
  findIps(f);
  findSpacedOut(f);
  findIfscs(f, accounts);
  findAfterIndianLabels(f);
  findNamesAndAddresses(f);
  findCellNamesAndAddresses(f);
  findRelativeNames(f);
  f.coverTails();
  return f
    .result()
    .filter((m) => groups.has(KIND_GROUP[m.kind as FoundKind]))
    .map((m) => {
      const r = back(fold, m.start, m.end);
      return { ...m, start: r.start, end: r.end, value: text.slice(r.start, r.end) };
    });
}

// ---- the user's own words --------------------------------------------------------------------------

const WORD_CHAR = '[\\p{L}\\p{M}\\p{N}]';
const escapeForUnicode = (ch: string) => (/[\^$\\.*+?()[\]{}|/]/.test(ch) ? `\\${ch}` : ch);

/** null when `text` can be a term; otherwise the reason, which never repeats the term. */
export function termError(text: string): string | null {
  const t = text.trim().replace(/\s+/g, ' ');
  const length = Array.from(t).length;
  if (length < TERM_LIMITS.min || length > TERM_LIMITS.max) return `A term needs ${TERM_LIMITS.min} to ${TERM_LIMITS.max} characters.`;
  if (!/[\p{L}\p{N}]/u.test(t)) return 'A term needs at least one letter or digit.';
  if (/\p{Cc}/u.test(t)) return 'A term cannot hold control characters.';
  return null;
}

/**
 * The rule for typed words, for the dialog: two short plain sentences (owner's instruction, wave 2). It is
 * the one loose rule of redactCheck.ts loosePlacesOf (ruling 4), which findTerm below follows too.
 */
export const TERM_RULE = 'Found as whole words, whatever is between them: spaces, punctuation, a line break or nothing, and across a word broken by a hyphen at a line end. Also looked for in the file name.';

/** Between two words of a typed term, or two characters of a typed code or number: anything but letters and digits, or nothing. */
const ANY_GAP = '[^\\p{L}\\p{M}\\p{N}]*';

/**
 * Every place `term` is in `text` (design 5.9 "Your own words"; fix wave 2, ruling 4: the same rule as
 * redactCheck.ts loosePlacesOf, rx2-contract.md (a)), both folded (foldWithMap), ignoring case. The term's
 * words are its runs of letters and digits (marks typed between them are a gap):
 * - two or more words: the words in order, with any run of characters that are not letters or digits
 *   between them, or nothing at all (Ramesh-Kumar-Gupta, Ramesh/Kumar, RameshKumarGupta);
 * - one word of letters and digits (a code), or of digits (a number): its characters in order, with any
 *   such run between (kerning gaps, spaced-out, wrapped and grouped forms);
 * - one word of letters: the word.
 * No letter or digit may be joined to a place at either end ("Gupta" is not found in "Dasgupta"; a number
 * may stand next to letters, as in INV12345). The term is also looked for inside spaced-out runs
 * ("S h a r m a"), joined up, by the same rule.
 */
export function findTerm(text: string, term: string): { start: number; end: number }[] {
  const words = foldText(term).match(/[\p{L}\p{M}\p{N}]+/gu) ?? [];
  if (words.length === 0) return [];
  const [only] = words;
  const number = words.length === 1 && /^\p{N}+$/u.test(only);
  const code = words.length === 1 && /\p{L}/u.test(only) && /\p{N}/u.test(only);
  const parts = words.length > 1 ? words : number || code ? Array.from(only) : [only];
  const body = parts.map((p) => Array.from(p).map(escapeForUnicode).join('')).join(ANY_GAP);
  const edge = number ? '\\p{N}' : WORD_CHAR;
  const rule = safeRegExp(`(?<!${edge})${body}(?!${edge})`, 'giu');
  const f = folded(text);
  const out: { start: number; end: number }[] = [];
  for (const m of f.text.matchAll(rule)) {
    if (m[0].length > 0) out.push(back(f, m.index, m.index + m[0].length));
  }
  // Inside spaced-out runs: the same rule over the joined characters.
  if (Array.from(words.join('')).length >= 2) {
    for (const run of spacedRuns(f.text)) {
      for (const m of run.joined.matchAll(rule)) {
        const r = back(f, run.at[m.index], run.at[m.index + m[0].length - 1] + 1);
        if (!out.some((o) => r.start < o.end && o.start < r.end)) out.push(r);
      }
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

// ---- replacement and check forms ------------------------------------------------------------------

/**
 * The "Masked value" replacement: every letter and digit as X except the last four (Aadhaar keeps its
 * groups; email keeps the name's first letter and the domain; a card and an Aadhaar VID keep their
 * last group of four; a UPI ID keeps only its handle; a date of birth is masked whole). Typed terms,
 * drawn boxes, text under boxes, marks and names and addresses (whose last four letters say too much)
 * use their label.
 */
export function maskValue(kind: RedactKind, key: string): string {
  switch (kind) {
    case 'typed':
    case 'drawn':
    case 'same-text':
    case 'marked':
    case 'name':
    case 'address':
    case 'addressee':
      return KIND_LABELS[kind];
    case 'email': {
      const at = key.indexOf('@');
      return at > 0 ? `${key[0]}*****${key.slice(at)}` : KIND_LABELS.email;
    }
    case 'aadhaar':
      return key.length === 12 ? `XXXX XXXX ${key.slice(8)}` : KIND_LABELS.aadhaar;
    // T-052
    case 'card': {
      const digits = key.replace(/\D/g, '');
      return digits.length >= 8 ? `XXXX XXXX XXXX ${digits.slice(-4)}` : 'XXXX';
    }
    case 'aadhaar-vid':
      return key.length === 16 ? `XXXX XXXX XXXX ${key.slice(12)}` : KIND_LABELS['aadhaar-vid'];
    case 'dob':
      // the year alone says how old the person is
      return 'XX/XX/XXXX';
    case 'upi': {
      // the handle only (the name is often a mobile number); the key has no @, so the handle is a known one at its end
      const k = key.toLowerCase();
      for (let n = Math.min(k.length - 1, 31); n >= 2; n--) {
        if (isUpiHandle(k.slice(-n))) return `${'X'.repeat(k.length - n)}@${k.slice(-n)}`;
      }
      return 'XXXX@XXXX';
    }
    default: {
      const chars = key.replace(/[^A-Za-z0-9]/g, '');
      if (chars.length <= 4) return 'X'.repeat(4);
      return 'X'.repeat(chars.length - 4) + chars.slice(-4);
    }
  }
}

/**
 * The forms of one redacted value that the check looks for in the result (design 5.9 "The check"):
 * the value as written (folded, whitespace collapsed); the key (codes without spaces and hyphens in
 * capitals, email in lower case); Aadhaar plain and grouped 4-4-4 with a space and with a hyphen;
 * mobile plain and grouped 5-5 with a space and with a hyphen; a card or an Aadhaar VID of 16 digits
 * grouped 4-4-4-4 with a space and with a hyphen; a UPI ID in lower case. Names, addresses, typed terms and the
 * same text are compared as whole words ignoring case. Drawn boxes and marks have no text to look for.
 * The list lives in memory only and is never logged or recorded.
 */
export function checkForms(kind: RedactKind, key: string, asWritten: string): string[] {
  if (kind === 'drawn' || kind === 'marked') return [];
  const forms = new Set<string>();
  const written = foldText(asWritten).trim().replace(/\s+/g, ' ');
  forms.add(key);
  forms.add(written);
  if (asWritten.trim() !== written) forms.add(asWritten.trim().replace(/\s+/g, ' '));
  if (kind === 'aadhaar' && key.length === 12) {
    const g = [key.slice(0, 4), key.slice(4, 8), key.slice(8)];
    forms.add(g.join(' '));
    forms.add(g.join('-'));
  }
  if (kind === 'mobile' && key.length === 10) {
    forms.add(`${key.slice(0, 5)} ${key.slice(5)}`);
    forms.add(`${key.slice(0, 5)}-${key.slice(5)}`);
  }
  if (kind === 'email' || kind === 'upi') forms.add(written.toLowerCase());
  if ((kind === 'card' || kind === 'aadhaar-vid') && /^\d{16}$/.test(key)) {
    const g = [key.slice(0, 4), key.slice(4, 8), key.slice(8, 12), key.slice(12)];
    forms.add(g.join(' '));
    forms.add(g.join('-'));
  }
  forms.delete('');
  return [...forms];
}
