// Test helper only: seeded generators of the redaction-pattern trial's corpora (trial 2 of
// spike-report.md): valid values in their written forms, near-misses, and ordinary audit text with
// none of the kinds in it. Every value is synthetic. Not imported by production code.
import { calculateGstinCheckDigit } from '@/lib/gstinValidation';
import { REASONS, verhoeffDigit, verhoeffValid, type RedactKind } from './redactPatterns';

/** A seeded pseudo-random generator, so every run sees the same corpus. */
export function seeded(seed: number) {
  let s = seed;
  const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const pick = <T>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)];
  const digits = (n: number, first = '0123456789') => pick(first.split('')) + Array.from({ length: n - 1 }, () => String(Math.floor(rnd() * 10))).join('');
  const letters = (n: number) => Array.from({ length: n }, () => String.fromCharCode(65 + Math.floor(rnd() * 26))).join('');
  const pan = (type = pick('ABCFGHJLPT'.split(''))) => letters(3) + type + letters(1) + digits(4) + letters(1);
  const aadhaarValid = () => {
    const b = digits(11, '23456789');
    return b + verhoeffDigit(b);
  };
  const aadhaarInvalid = () => {
    for (;;) {
      const v = digits(12, '23456789');
      if (!verhoeffValid(v)) return v;
    }
  };
  const gstinValid = (state = String(1 + Math.floor(rnd() * 38)).padStart(2, '0')) => {
    const first = state + pan() + pick('123456789ABC'.split('')) + 'Z';
    return first + calculateGstinCheckDigit(first);
  };
  const mobile = () => digits(10, '6789');
  const ifsc = () => pick(['HDFC', 'ICIC', 'SBIN', 'UTIB', 'KKBK', 'PUNB', 'BARB', 'CNRB']) + '0' + digits(6);
  /** One space at a random place inside the value, as pdf.js writes a kerning gap. */
  const kern = (v: string) => {
    const at = 1 + Math.floor(rnd() * (v.length - 1));
    return `${v.slice(0, at)} ${v.slice(at)}`;
  };
  return { rnd, pick, digits, letters, pan, aadhaarValid, aadhaarInvalid, gstinValid, mobile, ifsc, kern };
}

export function group(s: string, sizes: readonly number[], sep: string): string {
  const parts: string[] = [];
  let i = 0;
  for (const n of sizes) {
    parts.push(s.slice(i, i + n));
    i += n;
  }
  return parts.join(sep);
}

export interface ValidCase {
  group: string;
  text: string;
  kind: RedactKind;
  key: string;
}

/** The trial's valid examples: each must be found once, with its kind and key, as sure. */
export function validCases(): ValidCase[] {
  const g = seeded(12345);
  const out: ValidCase[] = [];
  for (let i = 0; i < 200; i++) {
    const p = g.pan();
    const form = g.pick([`PAN: ${p}`, `PAN ${p}, dated 01-04-2024`, `(${p})`, `holder ${p}.`, `PAN No.${p}`]);
    out.push({ group: 'pan', text: `The assessee's ${form} is on record`, kind: 'pan', key: p });
  }
  for (let i = 0; i < 100; i++) {
    const p = g.pan();
    out.push({ group: 'pan with a kerning space', text: `PAN ${g.kern(p)} as per return`, kind: 'pan', key: p });
  }
  for (let i = 0; i < 200; i++) {
    const a = g.aadhaarValid();
    const form = g.pick([group(a, [4, 4, 4], ' '), group(a, [4, 4, 4], '-'), a]);
    const ctx = form === a ? g.pick(['Aadhaar No. ', 'UID ', 'Aadhaar: ']) : g.pick(['Aadhaar ', 'ID ', '', 'Partner ']);
    out.push({ group: 'aadhaar', text: `${ctx}${form} linked`, kind: 'aadhaar', key: a });
  }
  for (let i = 0; i < 200; i++) {
    const v = g.gstinValid(String(1 + (i % 38)).padStart(2, '0'));
    out.push({ group: 'gstin', text: g.pick([`GSTIN: ${v}`, `GST No. ${v} (Maharashtra)`, `Supplier GSTIN ${v},`]), kind: 'gstin', key: v });
  }
  for (let i = 0; i < 200; i++) {
    const m = g.mobile();
    const forms = [`+91 ${group(m, [5, 5], ' ')}`, `+91-${m}`, `0${m}`, `Mobile: ${m}`, `Mob. ${group(m, [5, 5], '-')}`, group(m, [5, 5], ' '), `Ph: ${group(m, [3, 3, 4], '-')}`, `(+91) ${m}`];
    out.push({ group: 'mobile', text: `Contact ${forms[i % forms.length]} for queries`, kind: 'mobile', key: m });
  }
  for (let i = 0; i < 100; i++) {
    const e = `${g.letters(5).toLowerCase()}.${g.letters(4).toLowerCase()}${g.digits(2)}@${g.pick(['example.com', 'example.in', 'firm.example.org', 'mail.example.net'])}`;
    out.push({ group: 'email', text: `Write to ${e} before 31 March`, kind: 'email', key: e });
  }
  for (let i = 0; i < 100; i++) {
    const acct = g.digits(9 + Math.floor(g.rnd() * 10), '123456789');
    const code = g.ifsc();
    const form = g.pick([`A/c No. ${acct} IFSC ${code}`, `Account number: ${acct}, IFSC: ${code}`, `Bank account ${acct}\nIFSC ${code}`, `SB A/c ${acct} with ${code}`]);
    out.push({ group: 'bank account', text: form, kind: 'bank-account', key: acct });
  }
  return out;
}

export interface NearMissCase {
  group: string;
  text: string;
  /** null: nothing may be found. */
  expect: { kind: RedactKind; key: string; confidence: 'sure' | 'possible'; reason?: string } | null;
}

/** The trial's near-misses: shapes that are not the kind, or are only possibly it. */
export function nearMissCases(): NearMissCase[] {
  const g = seeded(4242);
  const out: NearMissCase[] = [];
  for (let i = 0; i < 100; i++) {
    const p = g.pan(g.pick('DEIKMNOQRSUVWXYZ'.split('')));
    out.push({ group: 'pan, fourth letter not a holder type', text: `PAN ${p} entered`, expect: { kind: 'pan', key: p, confidence: 'possible', reason: REASONS.panType } });
  }
  for (let i = 0; i < 100; i++) {
    const p = g.pan();
    const bad = [p.slice(0, 9), `${p}X`, `${p.slice(0, 5)}A${p.slice(6)}`, `1${p.slice(1)}`][i % 4];
    out.push({ group: 'pan-like code', text: `Code ${bad} entered`, expect: null });
  }
  // Fix round 1 (lead ruling): a PAN in small letters is shown, unticked, as possible.
  for (let i = 0; i < 100; i++) {
    const p = g.pan();
    out.push({ group: 'pan in small letters', text: `Code ${p.toLowerCase()} entered`, expect: { kind: 'pan', key: p, confidence: 'possible', reason: 'written in small letters' } });
  }
  for (let i = 0; i < 100; i++) {
    const a = g.aadhaarInvalid();
    out.push({ group: 'aadhaar grouped, bad check digit', text: `Aadhaar ${group(a, [4, 4, 4], ' ')} entered`, expect: { kind: 'aadhaar', key: a, confidence: 'possible', reason: REASONS.aadhaarCheck } });
  }
  for (let i = 0; i < 100; i++) {
    out.push({ group: 'aadhaar ungrouped, bad check digit', text: `Number ${g.aadhaarInvalid()} entered`, expect: null });
  }
  for (let i = 0; i < 100; i++) {
    const a = g.aadhaarValid();
    const bad = [`0${a.slice(1)}`, `1${a.slice(1)}`, a.slice(0, 11), `${a}7`][i % 4];
    out.push({ group: 'aadhaar wrong length or first digit', text: `Number ${bad} entered`, expect: null });
  }
  for (let i = 0; i < 100; i++) {
    const v = g.gstinValid();
    const bad = g.pick('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').filter((c) => c !== v[14]));
    const wrong = v.slice(0, 14) + bad;
    out.push({ group: 'gstin, wrong check character', text: `GSTIN ${wrong} entered`, expect: { kind: 'gstin', key: wrong, confidence: 'possible', reason: REASONS.gstinCheck } });
  }
  for (let i = 0; i < 100; i++) {
    const m = g.mobile();
    const bad = [`5${m.slice(1)}`, m.slice(0, 9), `${m}3`][i % 3];
    out.push({ group: 'mobile-like number', text: `Mobile: ${bad} entered`, expect: null });
  }
  return out;
}

const ch = (code: number) => String.fromCharCode(code);
const SOFT_HYPHEN = ch(0xad);
const ZERO_WIDTH_SPACE = ch(0x200b);
const fullWidth = (s: string) => Array.from(s, (c) => (/[!-~]/.test(c) ? ch(c.charCodeAt(0) + 0xfee0) : c)).join('');
const joinWith = (s: string, sep: string) => Array.from(s).join(sep);
const split = (s: string, at: number, sep: string) => s.slice(0, at) + sep + s.slice(at);

/**
 * Written forms of one value that the check's strict pass flags and the find must therefore box
 * (fix round 1, F3): ONE list for both sides. Each form is the value as it may stand in a page's text
 * or in a string of the file. `key` is the value's key (redactPatterns.ts `keyOf`).
 */
export function writtenForms(kind: RedactKind, key: string): { name: string; text: string }[] {
  const forms: { name: string; text: string }[] = [];
  const add = (name: string, text: string) => forms.push({ name, text });
  if (kind === 'email') {
    add('as written', key);
    add('upper case', key.toUpperCase());
    const dot = key.lastIndexOf('.');
    const at = key.indexOf('@');
    add('wrapped after the last dot', split(key, dot + 1, '\n'));
    add('wrapped before the @', split(key, at, '\n'));
    add('wrapped after the @', split(key, at + 1, '\n'));
    add('a zero-width space inside', split(key, 3, ZERO_WIDTH_SPACE));
    add('full width', fullWidth(key));
    return forms;
  }
  const half = Math.floor(key.length / 2);
  add('as written', key);
  add('lower case', key.toLowerCase());
  add('one space', split(key, half, ' '));
  add('two spaces', split(key, half, '  '));
  add('three spaces', split(key, half, '   '));
  add('a hyphen', split(key, half, '-'));
  add('a hyphen at a line end', split(key, half, '-\n'));
  add('a line break', split(key, half, '\n'));
  add('a dot', split(key, half, '.'));
  add('a slash', split(key, half, '/'));
  add('a soft hyphen', split(key, half, SOFT_HYPHEN));
  add('a zero-width space', split(key, half, ZERO_WIDTH_SPACE));
  add('a space between every character', joinWith(key, ' '));
  add('a hyphen between every character', joinWith(key, '-'));
  add('full width', fullWidth(key));
  if (/^\d{12}$/.test(key)) {
    add('grouped 4-4-4 with spaces', `${key.slice(0, 4)} ${key.slice(4, 8)} ${key.slice(8)}`);
    add('grouped 4-4-4 with dots', `${key.slice(0, 4)}.${key.slice(4, 8)}.${key.slice(8)}`);
    add('grouped 4-4-4 with three spaces', `${key.slice(0, 4)}   ${key.slice(4, 8)}   ${key.slice(8)}`);
  }
  if (/^\d{10}$/.test(key)) add('grouped 2-2-2-2-2', key.replace(/(\d{2})(?=\d)/g, '$1 '));
  return forms;
}

/** Lines holding an email, a mobile, an account number and an IFSC, all on one line. */
export function oneLineCases(): { text: string; mobile: string; account: string; ifsc: string }[] {
  const g = seeded(99);
  return Array.from({ length: 50 }, () => {
    const mobile = g.mobile();
    const account = g.digits(14, '123456789');
    const ifsc = g.ifsc();
    return { text: `Contact r.kumar@example.in, mobile +91 ${group(mobile, [5, 5], ' ')}; A/c ${account} IFSC ${ifsc}`, mobile, account, ifsc };
  });
}

/** The owner's extra categories (trial 2b): each must be found as sure with its value. */
export function extraKindCases(): { text: string; kind: RedactKind; value: string }[] {
  const g = seeded(777);
  const out: { text: string; kind: RedactKind; value: string }[] = [];
  for (let i = 0; i < 100; i++) {
    const tan = `${g.letters(4)}${g.digits(5)}${g.letters(1)}`;
    out.push({ text: `TAN of the deductor: ${tan}`, kind: 'tan', value: tan });
    const din = `ITBA/AST/S/143(1)/2024-25/${g.digits(10, '1')}(1)`;
    out.push({ text: `Document Identification Number ${din} dated 12/10/2025`, kind: 'tax-din', value: din });
    const micr = g.digits(9, '45678');
    out.push({ text: `MICR code ${micr} IFSC HDFC0001234`, kind: 'micr', value: micr });
    const ack = g.digits(15, '12345678');
    out.push({ text: `Acknowledgement Number: ${ack} filed on 31-07-2025`, kind: 'itr-ack', value: ack });
    const evc = `${g.letters(4)}${g.digits(6)}`;
    out.push({ text: `Your EVC is ${evc} valid for 72 hours`, kind: 'evc', value: evc });
    const ip = `${1 + Math.floor(g.rnd() * 223)}.${Math.floor(g.rnd() * 256)}.${Math.floor(g.rnd() * 256)}.${Math.floor(g.rnd() * 256)}`;
    out.push({ text: `Logged in from IP address ${ip} at 10:42`, kind: 'ip', value: ip });
  }
  return out;
}

/**
 * Bank-statement narration lines (fix round 1, F4): NEFT, RTGS, UPI and IMPS narrations with branch
 * codes and references, and stores lines with part and batch codes. Nearly every line holds a possible
 * IFSC, account number next to an IFSC, twelve-digit reference or TAN-shaped code, and none a sure value.
 */
export function statementLines(n: number): string[] {
  const g = seeded(5955);
  const { digits, letters, pick, ifsc, rnd } = g;
  const gens: (() => string)[] = [
    () => `NEFT-${ifsc()}-REF ${digits(9 + Math.floor(rnd() * 4), '123456789')}-${letters(5)} ${letters(6)}`,
    () => `RTGS/${ifsc()}/UTR ${letters(4)}R${digits(15)} ${letters(5)}`,
    () => `UPI/${digits(12, '34')}/PAYMENT TO VENDOR/${letters(4)}`,
    () => `IMPS-${digits(12, '34')}-${letters(6)} SALARY`,
    () => `Batch ${letters(4)}${digits(5)}${letters(1)} received in stores`,
    () => `Part no. ${letters(4)}${digits(5)}${letters(1)} replaced`,
    () => `${pick(['01', '15', '28'])}-04-2025 Opening balance ${digits(6, '123456789')}.${digits(2)} Cr`,
  ];
  return Array.from({ length: n }, () => pick(gens)());
}

/**
 * Ordinary audit text with no value of any kind in it: the trial's 5,000-line generator (invoice and
 * voucher numbers, amounts, dates, phone and toll-free numbers, CIN, UDIN, HSN, SAP document numbers,
 * UPI, IMPS, NEFT and RTGS narrations) and the look-alikes of trial 2b (versions, note references,
 * "acknowledge", "Verification of", TAN-shaped batch and part codes). The trial's two lines that hold
 * a genuine labelled TAN or MICR code are left out: those are values, and are found as sure.
 */
export function ordinaryLines(n = 5000): string[] {
  const g = seeded(2025);
  const { digits, letters, pick, ifsc, rnd } = g;
  const gens: (() => string)[] = [
    () => `Invoice INV/${2020 + Math.floor(rnd() * 6)}-${digits(2)}/${digits(5)} dated ${digits(2, '0123')}/${digits(2, '01')}/2024 Rs. ${digits(1, '123456789')},${digits(2)},${digits(2)},${digits(3)}.${digits(2)}`,
    () => `Bill No. ${digits(10, '5679')} Amount ${digits(7, '123456789')}.${digits(2)}`,
    () => `SAP doc ${pick(['90', '51', '45', '70', '80'])}${digits(8)} posted on ${digits(4, '2')}-${digits(2, '01')}-${digits(2, '012')}`,
    () => `Amount ${digits(10, '6789')}.${digits(2)} carried forward`,
    () => `UPI/${digits(12, '34')}/PAYMENT TO VENDOR/${letters(4)}`,
    () => `IMPS-${digits(12, '34')}-${letters(6)} SALARY`,
    () => `Tel: 022-${digits(8, '2')}, Fax 022-${digits(8, '2')}`,
    () => `Toll free 1800-${digits(3)}-${digits(4)}`,
    () => `+91 ${digits(2, '2345')} ${digits(4)} ${digits(4)} (landline)`,
    () => `CIN ${pick(['U', 'L'])}${digits(5)}${pick(['MH', 'DL', 'KA', 'TN'])}${digits(4, '12')}${pick(['PTC', 'PLC', 'FTC'])}${digits(6)}`,
    () => `DIN ${digits(8)} director`,
    () => `UDIN ${digits(8)}${letters(6)}${digits(4)}`,
    () => `HSN ${digits(8)} SAC ${digits(6)}`,
    () => `Ledger balance as at 31.03.2025 is ${digits(2, '123456789')},${digits(2)},${digits(3)}.${digits(2)} Cr`,
    () => `Opening stock ${digits(3)} units @ ${digits(4)} = ${digits(7)}`,
    () => `PO ${digits(10, '4')} GRN ${digits(10, '5')} batch ${letters(2)}${digits(6)}`,
    () => `Ref ${letters(3)}${digits(9)} for ${letters(6)} ${letters(5)} Pvt Ltd`,
    () => `Share capital ${digits(8)} equity shares of Rs ${digits(2)} each`,
    () => `Policy No. ${digits(12, '123456789')} premium ${digits(5)}`,
    () => `Loan account LAN${digits(10)} EMI ${digits(5)}`,
    () => `Vehicle ${pick(['MH', 'KA', 'DL'])}${digits(2)}${letters(2)}${digits(4)} insured`,
    () => `Employee code E${digits(6)} UAN 10${digits(10)}`,
    () => `NEFT/SBIN${digits(12)}/RENT ${letters(6)}`,
    () => `Section 194${pick(['C', 'J', 'H', 'I'])} TDS ${digits(5)}.00 deposited via challan ${digits(7)}`,
    () => `Year ended 31 March 2025, figures in INR lakhs: ${digits(4)}.${digits(2)}, ${digits(4)}.${digits(2)}`,
    () => `NEFT-${ifsc()}-REF ${digits(9 + Math.floor(rnd() * 4), '123456789')}-${letters(5)} ${letters(6)}`,
    () => `RTGS/${ifsc()}/UTR ${letters(4)}R${digits(15)} ${letters(5)}`,
    () => `Version ${digits(1, '123456789')}.${digits(1)}.${digits(1)}.${digits(2, '123456789')} of the software was used`,
    () => `Refer note ${digits(1, '123456789')}.${digits(1, '123456789')}.${digits(1)}.${digits(1, '123456789')} to the accounts`,
    () => `Dates 12.03.2024 and ${digits(2, '12')}.${digits(2, '01')}.${digits(4, '2')}`,
    () => `We acknowledge receipt of your letter dated ${digits(2, '12')}/0${digits(1, '123456789')}/2025`,
    () => `Ack. of challan ${digits(7)} for ${digits(5)}.00`,
    () => `Verification of ${letters(5).toLowerCase()} balances completed in ${digits(3)} cases`,
    () => `Batch ${letters(4)}${digits(5)}${letters(1)} received in stores`,
    () => `Part no. ${letters(4)}${digits(5)}${letters(1)} replaced`,
  ];
  return Array.from({ length: n }, () => pick(gens)());
}

// ---- the wider identifier set (T-048, lane RX-PAT) -----------------------------------------------------
// Invented values only, built here to pass or fail their check digit on purpose. The two check-digit
// helpers below are this file's own (an oracle independent of redactPatterns.ts).

/** The Luhn check digit (payment cards) to append to `body`. */
export function luhnCheckDigit(body: string): string {
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    let d = Number(body[body.length - 1 - i]);
    if (i % 2 === 0) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return String((10 - (sum % 10)) % 10);
}

export const luhnOk = (n: string): boolean => n.length > 1 && luhnCheckDigit(n.slice(0, -1)) === n.slice(-1);

/** ISO 7064 MOD 97-10 (LEI, ISO 17442): the two check digits that follow the first 18 characters. */
export function leiCheckDigits(first18: string): string {
  let r = 0;
  for (const ch of `${first18.toUpperCase()}00`) {
    const v = /\d/.test(ch) ? ch : String(ch.charCodeAt(0) - 55);
    for (const d of v) r = (r * 10 + Number(d)) % 97;
  }
  return String(98 - r).padStart(2, '0');
}

const hi = (...codes: number[]) => String.fromCharCode(...codes);
/** Common Hindi labels, as escapes. */
export const HINDI = {
  passport: hi(0x92a, 0x93e, 0x938, 0x92a, 0x94b, 0x930, 0x94d, 0x91f),
  voter: hi(0x92e, 0x924, 0x926, 0x93e, 0x924, 0x93e),
  birth: hi(0x91c, 0x928, 0x94d, 0x92e),
  date: hi(0x924, 0x93f, 0x925, 0x93f),
  uan: hi(0x92f, 0x942, 0x90f, 0x90f, 0x928),
  employee: hi(0x915, 0x930, 0x94d, 0x92e, 0x91a, 0x93e, 0x930, 0x940),
  pin: hi(0x92a, 0x93f, 0x928),
  father: hi(0x92a, 0x93f, 0x924, 0x93e),
  ka: hi(0x915, 0x93e),
  naam: hi(0x928, 0x93e, 0x92e),
  /** An invented name in Devanagari ("Ramesh Kumar"). */
  someName: `${hi(0x930, 0x92e, 0x947, 0x936)} ${hi(0x915, 0x941, 0x92e, 0x93e, 0x930)}`,
};

const group4 = (s: string, sep: string) => s.replace(/(\d{4})(?=\d)/g, `$1${sep}`);

/** Values of the new kinds that need a check digit, made from a seeded generator. */
export function newKindValues(seed = 3401) {
  const g = seeded(seed);
  const card = (first = '4', length = 16) => {
    const body = first + g.digits(length - 1 - first.length);
    return body + luhnCheckDigit(body);
  };
  const cardBad = (first = '4', length = 16) => {
    const v = card(first, length);
    return v.slice(0, -1) + String((Number(v.slice(-1)) + 1) % 10);
  };
  const vid = () => {
    const b = g.digits(15, '123456789');
    return b + verhoeffDigit(b);
  };
  const vidBad = () => {
    const v = vid();
    return v.slice(0, -1) + String((Number(v.slice(-1)) + 1) % 10);
  };
  /** Sixteen digits that pass both Luhn and Verhoeff (VID versus card). */
  const vidAndCard = () => {
    for (;;) {
      const v = vid();
      if (luhnOk(v)) return v;
    }
  };
  /** Sixteen digits that pass Verhoeff and fail Luhn (an unlabelled VID that is not a card). */
  const vidNotCard = () => {
    for (;;) {
      const v = vid();
      if (!luhnOk(v)) return v;
    }
  };
  const lei = () => {
    const first = `${g.digits(4, '123456789')}00${g.letters(6)}${g.digits(6)}`;
    return first + leiCheckDigits(first);
  };
  const leiBad = () => {
    const v = lei();
    return v.slice(0, -1) + String((Number(v.slice(-1)) + 1) % 10);
  };
  const irn = () => Array.from({ length: 64 }, () => '0123456789abcdef'[Math.floor(g.rnd() * 16)]).join('');
  return { card, cardBad, vid, vidBad, vidAndCard, vidNotCard, lei, leiBad, irn, digits: g.digits, letters: g.letters };
}

export interface NewKindCase {
  name: string;
  text: string;
  kind: RedactKind;
  key: string;
  /** The text the match must cover, exactly. */
  value: string;
  confidence: 'sure' | 'possible';
}

/**
 * True cases of every new kind: plain, written with its usual separators, and letter-spaced where a
 * form puts each character in its own box. Each must give exactly one match of its kind, with this key,
 * value and confidence.
 */
export function newKindCases(): NewKindCase[] {
  const v = newKindValues();
  const out: NewKindCase[] = [];
  const add = (name: string, text: string, kind: RedactKind, value: string, key: string, confidence: 'sure' | 'possible') => out.push({ name, text, kind, key, value, confidence });
  const spaced = (s: string) => Array.from(s).join(' ');

  // Personal identity
  add('passport labelled', 'Passport No. M5830271 issued at Mumbai', 'passport', 'M5830271', 'M5830271', 'sure');
  add('passport with a space', 'Passport: M 5830271', 'passport', 'M 5830271', 'M5830271', 'sure');
  add('passport, Hindi label', `${HINDI.passport}: K4721936`, 'passport', 'K4721936', 'K4721936', 'sure');
  add('passport letter-spaced', 'Passport No: M 5 8 3 0 2 7 1', 'passport', 'M 5 8 3 0 2 7 1', 'M5830271', 'sure');
  add('passport in small letters', 'Passport No. m5830271', 'passport', 'm5830271', 'M5830271', 'possible');
  add('voter ID (EPIC)', 'EPIC No. ABC1234567', 'voter-id', 'ABC1234567', 'ABC1234567', 'sure');
  add('voter ID with a space, card label between', 'Voter ID Card No: XYZ 7654321', 'voter-id', 'XYZ 7654321', 'XYZ7654321', 'sure');
  add('voter ID, Hindi label', `${HINDI.voter}: QRS2468135`, 'voter-id', 'QRS2468135', 'QRS2468135', 'sure');
  add('voter ID letter-spaced', 'EPIC: A B C 1 2 3 4 5 6 7', 'voter-id', 'A B C 1 2 3 4 5 6 7', 'ABC1234567', 'sure');
  add('driving licence labelled', 'Driving Licence No. MH14 20110012345', 'driving-licence', 'MH14 20110012345', 'MH1420110012345', 'sure');
  add('driving licence with a hyphen', 'DL No: DL-0420110012345', 'driving-licence', 'DL-0420110012345', 'DL0420110012345', 'sure');
  add('driving licence, no label', 'Holder MH1420110012345 renewed', 'driving-licence', 'MH1420110012345', 'MH1420110012345', 'possible');
  add('driving licence letter-spaced', 'Licence No. M H 1 4 2 0 1 1 0 0 1 2 3 4 5', 'driving-licence', 'M H 1 4 2 0 1 1 0 0 1 2 3 4 5', 'MH1420110012345', 'sure');
  const vid = v.vid();
  const vidBad = v.vidBad();
  add('Aadhaar VID grouped', `VID: ${group4(vid, ' ')}`, 'aadhaar-vid', group4(vid, ' '), vid, 'sure');
  add('Aadhaar VID plain', `Virtual ID ${vid}`, 'aadhaar-vid', vid, vid, 'sure');
  add('Aadhaar VID, wrong check digit', `VID ${vidBad}`, 'aadhaar-vid', vidBad, vidBad, 'possible');
  add('Aadhaar VID letter-spaced', `VID: ${spaced(vid)}`, 'aadhaar-vid', spaced(vid), vid, 'sure');
  add('Aadhaar enrolment with date and time', 'Enrolment No.: 1234/12345/12345 12/03/2019 10:20:30', 'aadhaar-eid', '1234/12345/12345 12/03/2019 10:20:30', '12341234512345', 'possible');
  add('Aadhaar enrolment plain', 'EID 12341234512345', 'aadhaar-eid', '12341234512345', '12341234512345', 'possible');
  add('CKYC number', 'CKYC No. 30012345678901', 'ckyc', '30012345678901', '30012345678901', 'possible');
  add('CKYC number grouped', 'KYC Identification Number: 3001 2345 6789 01', 'ckyc', '3001 2345 6789 01', '30012345678901', 'possible');
  add('CKYC letter-spaced', `CKYC: ${spaced('30012345678901')}`, 'ckyc', spaced('30012345678901'), '30012345678901', 'possible');
  add('date of birth', 'Date of Birth: 12/03/1985', 'dob', '12/03/1985', '12031985', 'sure');
  add('date of birth, month name', 'DOB 12-Mar-1985', 'dob', '12-Mar-1985', '12MAR1985', 'sure');
  add('date of birth, year first', 'D.O.B.: 1985-03-12', 'dob', '1985-03-12', '19850312', 'sure');
  add('date of birth, Hindi label', `${HINDI.birth} ${HINDI.date}: 12.03.1985`, 'dob', '12.03.1985', '12031985', 'sure');
  add('date of birth, born on', 'Born on 12 March 1985 at Pune', 'dob', '12 March 1985', '12MARCH1985', 'sure');
  add('date of birth letter-spaced', 'DOB: 1 2 / 0 3 / 1 9 8 5', 'dob', '1 2 / 0 3 / 1 9 8 5', '12031985', 'sure');
  add("father's name after S/o", 'Ramesh Kumar Gupta S/o Suresh Kumar Gupta, aged 45 years', 'name', 'Suresh Kumar Gupta', 'suresh kumar gupta', 'possible');
  add("father's name without a colon", "Father's name Suresh Kumar", 'name', 'Suresh Kumar', 'suresh kumar', 'possible');
  add('husband after W/o', 'Asha Devi W/o Late Shri Mohan Lal, resident of Pune', 'name', 'Late Shri Mohan Lal', 'late shri mohan lal', 'possible');
  add("father's name, Hindi label", `${HINDI.father} ${HINDI.ka} ${HINDI.naam}: ${HINDI.someName}`, 'name', HINDI.someName, HINDI.someName, 'possible');

  // Payroll and labour
  add('UAN', 'UAN: 100123456789', 'uan', '100123456789', '100123456789', 'possible');
  add('UAN grouped', 'UAN 1001 2345 6789', 'uan', '1001 2345 6789', '100123456789', 'possible');
  add('UAN, Hindi label', `${HINDI.uan}: 100123456789`, 'uan', '100123456789', '100123456789', 'possible');
  add('UAN letter-spaced, label too', 'U A N 1 0 0 1 2 3 4 5 6 7 8 9', 'uan', '1 0 0 1 2 3 4 5 6 7 8 9', '100123456789', 'possible');
  add('PF member ID labelled', 'PF Member ID: MHBAN00123450000012345', 'pf-member', 'MHBAN00123450000012345', 'MHBAN00123450000012345', 'sure');
  add('PF member ID with slashes, no label', 'MH/BAN/0012345/000/0012345', 'pf-member', 'MH/BAN/0012345/000/0012345', 'MHBAN00123450000012345', 'sure');
  add('PF member ID letter-spaced', `Member ID ${spaced('MHBAN00123450000012345')}`, 'pf-member', spaced('MHBAN00123450000012345'), 'MHBAN00123450000012345', 'sure');
  add('ESIC insurance number', 'ESIC IP No. 3112345678', 'esic-ip', '3112345678', '3112345678', 'possible');
  add('ESIC employer code', 'ESIC Code No. 31000123450000999', 'esic-employer', '31000123450000999', '31000123450000999', 'possible');
  add('employee code', 'Employee Code: E123456', 'employee-id', 'E123456', 'E123456', 'possible');
  add('employee ID with a hyphen', 'Emp. ID EMP-00123 joined', 'employee-id', 'EMP-00123', 'EMP00123', 'possible');
  add('employee code, Hindi label', `${HINDI.employee} code: E123456`, 'employee-id', 'E123456', 'E123456', 'possible');

  // Banking and investments
  const card = v.card();
  const cardBad = v.cardBad();
  const amex = v.card('37', 15);
  add('card grouped, no label', `Paid by ${group4(card, ' ')} on 12 March`, 'card', group4(card, ' '), card, 'sure');
  add('card labelled, plain', `Card No: ${card}`, 'card', card, card, 'sure');
  add('card with hyphens', `Credit card ${group4(card, '-')}`, 'card', group4(card, '-'), card, 'sure');
  add('card labelled, wrong check digit', `Card No: ${cardBad}`, 'card', cardBad, cardBad, 'possible');
  add('card letter-spaced', `Card No: ${spaced(card)}`, 'card', spaced(card), card, 'sure');
  const amexWritten = `${amex.slice(0, 4)} ${amex.slice(4, 10)} ${amex.slice(10)}`;
  add('card 4-6-5', `Paid by ${amexWritten}`, 'card', amexWritten, amex, 'sure');
  add('UPI ID, known handle', 'UPI: 9845012345@ybl', 'upi', '9845012345@ybl', '9845012345YBL', 'sure');
  add('UPI ID with a dot in the name', 'Paid to ramesh.k@okhdfcbank today', 'upi', 'ramesh.k@okhdfcbank', 'RAMESHKOKHDFCBANK', 'sure');
  add('UPI ID, handle not known', 'Collect from asha99@zetapay', 'upi', 'asha99@zetapay', 'ASHA99ZETAPAY', 'possible');
  add('UPI ID in a bank narration joined by hyphens', 'UPI-RAMESH-9845012345@YBL-PAYMENT', 'upi', '9845012345@YBL', '9845012345YBL', 'sure');
  add('UPI ID in a bank narration joined by slashes', 'UPI/DR/RAMESH/9845012345@ybl/PAY', 'upi', '9845012345@ybl', '9845012345YBL', 'sure');
  add('UPI ID with a hyphen in the name', 'Pay ramesh-k@okicici', 'upi', 'ramesh-k@okicici', 'RAMESHKOKICICI', 'sure');
  add('cheque number', 'Cheque No. 123456 dated 01-04-2025', 'cheque', '123456', '123456', 'possible');
  add('cheque number, short label', 'By Chq 000123 clearing', 'cheque', '000123', '000123', 'possible');
  add('loan account', 'Loan Account No. HL/2024/0012345', 'loan-account', 'HL/2024/0012345', 'HL20240012345', 'possible');
  add('loan number', 'Loan No: LN0012345678', 'loan-account', 'LN0012345678', 'LN0012345678', 'possible');
  add('SWIFT labelled', 'SWIFT Code: QWXYINBB', 'swift', 'QWXYINBB', 'QWXYINBB', 'sure');
  add('BIC labelled, 11 characters', 'BIC PQRSINBBXXX', 'swift', 'PQRSINBBXXX', 'PQRSINBBXXX', 'sure');
  add('SWIFT of an Indian branch, no label', 'Remit via QWXYINBB104 only', 'swift', 'QWXYINBB104', 'QWXYINBB104', 'sure');
  add('SWIFT labelled, outside India', 'SWIFT: QWXYDEFF', 'swift', 'QWXYDEFF', 'QWXYDEFF', 'sure');
  add('demat NSDL', 'DP ID/Client ID: IN309876 12345678', 'demat', 'IN309876 12345678', 'IN30987612345678', 'sure');
  add('demat NSDL, no label', 'Holding IN30987612345678 pledged', 'demat', 'IN30987612345678', 'IN30987612345678', 'sure');
  add('demat CDSL', 'BO ID: 1299990012345678', 'demat', '1299990012345678', '1299990012345678', 'possible');
  add('mutual fund folio', 'Folio No. 1234567/89', 'folio', '1234567/89', '123456789', 'possible');
  add('insurance policy', 'Policy No. 123456789012', 'insurance-policy', '123456789012', '123456789012', 'possible');
  add('insurance policy with slashes', 'Insurance Policy: 0123/45678901/00/000', 'insurance-policy', '0123/45678901/00/000', '01234567890100000', 'possible');
  add('vehicle labelled', 'Vehicle No. MH12AB1234', 'vehicle', 'MH12AB1234', 'MH12AB1234', 'sure');
  add('vehicle with spaces, no label', 'parked MH 12 AB 1234 outside', 'vehicle', 'MH 12 AB 1234', 'MH12AB1234', 'possible');
  add('vehicle BH series', 'Regn. No. 22 BH 1234 AA', 'vehicle', '22 BH 1234 AA', '22BH1234AA', 'sure');
  add('vehicle, Delhi form', 'Vehicle: DL3CAB1234', 'vehicle', 'DL3CAB1234', 'DL3CAB1234', 'sure');
  add('vehicle letter-spaced', 'Vehicle No: M H 1 2 A B 1 2 3 4', 'vehicle', 'M H 1 2 A B 1 2 3 4', 'MH12AB1234', 'sure');

  // Company and professional
  add("director's DIN", 'DIN: 01234567', 'director-din', '01234567', '01234567', 'possible');
  add("director's DIN, long label", 'Director Identification Number 07654321', 'director-din', '07654321', '07654321', 'possible');
  add('CIN labelled', 'CIN: U72900KA2019PTC123456', 'cin', 'U72900KA2019PTC123456', 'U72900KA2019PTC123456', 'sure');
  add('CIN, no label', 'U72900KA2019PTC123456 is the company', 'cin', 'U72900KA2019PTC123456', 'U72900KA2019PTC123456', 'sure');
  add('CIN with spaces', 'CIN U 72900 KA 2019 PTC 123456', 'cin', 'U 72900 KA 2019 PTC 123456', 'U72900KA2019PTC123456', 'sure');
  add('CIN in small letters', 'cin: u72900ka2019ptc123456', 'cin', 'u72900ka2019ptc123456', 'U72900KA2019PTC123456', 'possible');
  add('CIN letter-spaced', `CIN: ${spaced('L24299MH2001PLC135791')}`, 'cin', spaced('L24299MH2001PLC135791'), 'L24299MH2001PLC135791', 'sure');
  add('LLPIN', 'LLPIN: AAB-1234', 'llpin', 'AAB-1234', 'AAB1234', 'sure');
  add('ICAI membership number', 'Membership No. 123456', 'icai-membership', '123456', '123456', 'possible');
  add('ICAI membership number, short label', '(Partner) M. No. 012345', 'icai-membership', '012345', '012345', 'possible');
  add('firm registration number', 'FRN: 123456W', 'icai-frn', '123456W', '123456W', 'sure');
  add('firm registration number, long label', 'Firm Reg. No. 012345S', 'icai-frn', '012345S', '012345S', 'sure');
  add('UDIN labelled', 'UDIN: 25123456ABCDEF1234', 'udin', '25123456ABCDEF1234', '25123456ABCDEF1234', 'sure');
  add('UDIN, no label', 'Signed 25123456ABCDEF1234 Pune', 'udin', '25123456ABCDEF1234', '25123456ABCDEF1234', 'possible');
  add('Udyam number', 'Registered as UDYAM-MH-26-0012345', 'udyam', 'UDYAM-MH-26-0012345', 'UDYAMMH260012345', 'sure');
  add('import-export code, digits', 'IEC: 0388012345', 'iec', '0388012345', '0388012345', 'possible');
  const lei = v.lei();
  add('LEI', `LEI ${lei}`, 'lei', lei, lei, 'sure');
  add('LEI, no label', `Entity ${lei} reports`, 'lei', lei, lei, 'sure');

  // Tax and GST documents
  add('challan, BSR code, date and serial', 'Challan: 0510308 12/03/2025 12345', 'challan', '0510308 12/03/2025 12345', '05103081203202512345', 'possible');
  add('challan identification number joined', 'CIN of challan 05103081203202512345', 'challan', '05103081203202512345', '05103081203202512345', 'possible');
  add('challan serial', 'Challan Serial No. 12345', 'challan', '12345', '12345', 'possible');
  add('GST ARN', 'ARN: AA270319012345Z', 'gst-arn', 'AA270319012345Z', 'AA270319012345Z', 'possible');
  add('e-way bill grouped', 'E-Way Bill No. 1234 5678 9012', 'eway-bill', '1234 5678 9012', '123456789012', 'possible');
  add('e-way bill, short label', 'EWB 341234567890', 'eway-bill', '341234567890', '341234567890', 'possible');
  const irn = v.irn();
  add('e-invoice IRN', `IRN: ${irn}`, 'irn', irn, irn.toUpperCase(), 'sure');
  add('e-invoice IRN, no label', `Ref ${irn}`, 'irn', irn, irn.toUpperCase(), 'sure');
  add('TDS certificate number', 'TDS Certificate No. QWERTYU', 'tds-certificate', 'QWERTYU', 'QWERTYU', 'possible');

  // Other
  add('landline labelled', 'Tel: 022-24567890', 'landline', '022-24567890', '2224567890', 'possible');
  add('landline, STD code in brackets', 'Office (080) 4123 4567', 'landline', '(080) 4123 4567', '8041234567', 'possible');
  add('landline with country code', 'Reach us at +91 22 2456 7890', 'landline', '+91 22 2456 7890', '2224567890', 'possible');
  add('landline after a phone label', 'Phone (O): 0124-4567890', 'landline', '0124-4567890', '1244567890', 'possible');
  add('PIN code', 'PIN Code: 400001', 'pin-code', '400001', '400001', 'possible');
  add('PIN code with a space', 'Pincode 560 001', 'pin-code', '560 001', '560001', 'possible');
  add('PIN code, Hindi label', `${HINDI.pin} code: 110001`, 'pin-code', '110001', '110001', 'possible');
  add('PIN code letter-spaced', 'PIN: 4 0 0 0 0 1', 'pin-code', '4 0 0 0 0 1', '400001', 'possible');
  // more boxed forms
  add('UDIN letter-spaced', `UDIN: ${spaced('25123456ABCDEF1234')}`, 'udin', spaced('25123456ABCDEF1234'), '25123456ABCDEF1234', 'sure');
  add('LEI letter-spaced', `LEI: ${spaced(lei)}`, 'lei', spaced(lei), lei, 'sure');
  add('e-way bill letter-spaced', `EWB No: ${spaced('341234567890')}`, 'eway-bill', spaced('341234567890'), '341234567890', 'possible');
  add('membership number letter-spaced', `Membership No. ${spaced('123456')}`, 'icai-membership', spaced('123456'), '123456', 'possible');
  add('Aadhaar enrolment letter-spaced', `Enrolment No: ${spaced('12341234512345')}`, 'aadhaar-eid', spaced('12341234512345'), '12341234512345', 'possible');
  add('ESIC number letter-spaced', `ESIC IP No: ${spaced('3112345678')}`, 'esic-ip', spaced('3112345678'), '3112345678', 'possible');
  add('IEC letter-spaced', `IEC: ${spaced('0388012345')}`, 'iec', spaced('0388012345'), '0388012345', 'possible');
  add('Udyam letter-spaced', `Udyam: ${spaced('UDYAMMH260012345')}`, 'udyam', spaced('UDYAMMH260012345'), 'UDYAMMH260012345', 'sure');
  add('NSDL demat letter-spaced', `DP ID: ${spaced('IN30987612345678')}`, 'demat', spaced('IN30987612345678'), 'IN30987612345678', 'sure');
  return out;
}

export interface NewNearMiss {
  name: string;
  text: string;
  /** No match of this kind may be found. */
  kind: RedactKind;
}

/** Near misses of the new kinds: wrong check digit, wrong length, no keyword, look-alike words. */
export function newNearMisses(): NewNearMiss[] {
  const v = newKindValues(9090);
  const out: NewNearMiss[] = [];
  const add = (name: string, text: string, kind: RedactKind) => out.push({ name, text, kind });
  add('passport shape, no label', 'Ref M5830271 received', 'passport');
  add('passport, 6 digits', 'Passport No. M583027', 'passport');
  add('passport, 8 digits', 'Passport No. M58302719', 'passport');
  add('passport label, a number of another shape', 'Passport photo attached; Ref 12345678', 'passport');
  add('invoice number shaped like an EPIC', 'Invoice INV2024001 dated 01-04-2025', 'voter-id');
  add('EPIC, two letters', 'EPIC No. AB1234567', 'voter-id');
  add('EPIC, four letters', 'EPIC No. ABCD1234567', 'voter-id');
  add('licence, year 1899', 'Licence No. MH14 18990012345', 'driving-licence');
  add('licence, state code not known', 'Licence No. ZZ1420110012345', 'driving-licence');
  add('licence, serial of 6 digits', 'Licence No. MH142011001234', 'driving-licence');
  add('VID shape, no label', `Ref ${v.vidNotCard()}`, 'aadhaar-vid');
  add('VID, 15 digits', 'VID 912345678901234', 'aadhaar-vid');
  add('enrolment, 13 digits', 'Enrolment No.: 1234/12345/1234', 'aadhaar-eid');
  add('CKYC, 13 digits', 'CKYC No. 3001234567890', 'ckyc');
  add('CKYC shape, no label', 'Ref 30012345678901', 'ckyc');
  add('date of birth, not a date', 'Date of Birth: 32/13/1985', 'dob');
  add('a date with no birth label', 'Date: 12/03/1985', 'dob');
  add('invoice date', 'Invoice date 12/03/1985', 'dob');
  add('UAN, 11 digits', 'UAN 10012345678', 'uan');
  add('UAN shape, no label', 'Ref 100123456789', 'uan');
  add('UAN label, a digit before the number', 'UAN of employee 2: 100123456789', 'uan');
  add('PF member ID, 21 characters', 'MHBAN0012345000001234', 'pf-member');
  add('ESIC, 9 digits', 'ESIC No. 311234567', 'esic-ip');
  add('ESIC employer code, 16 digits', 'ESIC Code No. 3100012345000099', 'esic-employer');
  add('a 17-digit number with no ESIC label', 'Ref 31000123450000999', 'esic-employer');
  add('employee code without a digit', 'Employee Code: ABCDEF', 'employee-id');
  add('card shape, no label, not grouped', `Ref ${v.card()}`, 'card');
  add('card label, 12 digits', 'Card No: 123456789012', 'card');
  add('card grouped, wrong check digit, no label', `Ref ${group4(v.cardBad(), ' ')}`, 'card');
  add('email is not a UPI ID', 'Write to ramesh@example.com', 'upi');
  add('a handle with no name before @', 'Follow @ICAIindia', 'upi');
  add('rate at', 'rate 10 units @ 250', 'upi');
  add('cheque, 5 digits', 'Cheque No. 12345', 'cheque');
  add('cheque shape, no label', 'Amount 123456', 'cheque');
  add('loan amount', 'Loan of Rs 500000 sanctioned', 'loan-account');
  add('loan label, a later number', 'Loan No: N/A, see 123456789', 'loan-account');
  add('policy label, a later number', 'Policy No. not given; premium 123456', 'insurance-policy');
  add('SWIFT label, no real country', 'SWIFT code: QWXYZZBB', 'swift');
  add('SWIFT label before a word', 'SWIFT TRANSFER RECEIVED', 'swift');
  add('heading word ORIGINAL', 'ORIGINAL FOR RECIPIENT', 'swift');
  add('heading word MARGINAL', 'MARGINAL NOTE', 'swift');
  add('heading word CRIMINAL', 'CRIMINAL PROCEDURE', 'swift');
  add('SWIFT outside India, no label', 'Remit via QWXYDEFF', 'swift');
  add('ISIN', 'ISIN INE123X01011', 'demat');
  add('BO ID, 15 digits', 'BO ID: 129999001234567', 'demat');
  add('ledger folio', 'Ledger folio 123456', 'folio');
  add('folio, 2 digits', 'Folio 12 of the register', 'folio');
  add('policy as a word', 'Policy on leave encashment 2024', 'insurance-policy');
  add('vehicle, state code not known', 'Vehicle ZZ12AB1234', 'vehicle');
  add('vehicle, 3 digits', 'Vehicle MH12AB123', 'vehicle');
  add('DIN, 7 digits', 'DIN 0123456', 'director-din');
  add('tax DIN is not a director DIN', 'DIN ITBA/AST/S/143(1)/2024-25/1012345678(1)', 'director-din');
  add('CIN, 5 last digits', 'CIN U72900KA2019PTC12345', 'cin');
  add('CIN, first letter wrong', 'CIN X72900KA2019PTC123456', 'cin');
  add('CIN, year 1019', 'CIN U72900KA1019PTC123456', 'cin');
  add('LLPIN shape, no label', 'Ref AAB-1234', 'llpin');
  add('membership, 5 digits', 'M. No. 12345', 'icai-membership');
  add('FRN, letter not a region', 'FRN: 123456X', 'icai-frn');
  add('UDIN, 17 characters', 'UDIN: 2512345ABCDEF1234', 'udin');
  add('Udyam, 6 last digits', 'UDYAM-MH-26-001234', 'udyam');
  add('IEC, 9 digits', 'IEC 038801234', 'iec');
  add('LEI, wrong check digits', `LEI ${v.leiBad()}`, 'lei');
  add('challan of 7 digits', 'Ack. of challan 1234567 for 12345.00', 'challan');
  add('deposited via challan', 'TDS 12345.00 deposited via challan 1234567', 'challan');
  add('distributor ARN', 'ARN-123456 distributor', 'gst-arn');
  add('e-way bill, 11 digits', 'E-way bill 12345678901', 'eway-bill');
  add('IRN, 63 characters', `IRN ${v.irn().slice(1)}`, 'irn');
  add('certificate with no TDS on the line', 'Certificate No. QWERTYU', 'tds-certificate');
  add('toll free', 'Toll free 1800-123-4567', 'landline');
  add('landline, 9 digits', 'Tel: 022-2456789', 'landline');
  add('a date is not a landline', 'dated 01-04-2024', 'landline');
  add('PIN of 4 digits', 'PIN: 1234', 'pin-code');
  add('PIN starting with 0', 'PIN 012345', 'pin-code');
  add('6 digits with no PIN label', 'Amount 400001', 'pin-code');
  add('w/o meaning without', 'Rs. 500 w/o tax', 'name');
  return out;
}

export interface OverlapCase {
  name: string;
  text: string;
  /** Every match, in order: kind, key, confidence. */
  expect: [RedactKind, string, 'sure' | 'possible'][];
}

/** One place gets one kind: the precedence between new kinds and between new and old kinds. */
export function overlapCases(): OverlapCase[] {
  const v = newKindValues(5151);
  const card = v.card();
  const both = v.vidAndCard();
  const bo = v.card('1299');
  const aadhaar = '234567890124'; // passes Verhoeff (R1's synthetic Aadhaar)
  const a444 = `${aadhaar.slice(0, 4)} ${aadhaar.slice(4, 8)} ${aadhaar.slice(8)}`;
  const leiLikePan = `QWXPE1234F7K3M9P2Q${leiCheckDigits('QWXPE1234F7K3M9P2Q')}`;
  return [
    { name: 'an LEI that begins like a PAN: LEI, not PAN', text: `LEI ${leiLikePan}`, expect: [['lei', leiLikePan, 'sure']] },
    { name: 'card after an account word: account', text: `A/c No. ${group4(card, ' ')}`, expect: [['bank-account', card, 'sure']] },
    { name: 'card after a card label: card', text: `Card No. ${group4(card, ' ')}`, expect: [['card', card, 'sure']] },
    { name: 'card grouped with no label: card, not Aadhaar', text: group4(card, ' '), expect: [['card', card, 'sure']] },
    { name: 'UAN label on a number that passes Verhoeff: UAN', text: `UAN ${aadhaar}`, expect: [['uan', aadhaar, 'possible']] },
    { name: 'Aadhaar label: Aadhaar', text: `Aadhaar ${aadhaar}`, expect: [['aadhaar', aadhaar, 'sure']] },
    { name: 'nearest label decides: Aadhaar', text: `UAN/Aadhaar: ${a444}`, expect: [['aadhaar', aadhaar, 'sure']] },
    { name: 'IEC written as a PAN: PAN', text: 'IEC: QWXCT4821K', expect: [['pan', 'QWXCT4821K', 'sure']] },
    { name: 'IEC of digits: IEC', text: 'IEC: 0388012345', expect: [['iec', '0388012345', 'possible']] },
    { name: 'PAN/IEC label: PAN', text: 'PAN/IEC: QWXCT4821K', expect: [['pan', 'QWXCT4821K', 'sure']] },
    {
      name: 'CIN whose digits look like a mobile, beside a mobile',
      text: 'CIN U98450MH2019PTC984501, Mobile 98450 12345',
      expect: [
        ['cin', 'U98450MH2019PTC984501', 'sure'],
        ['mobile', '9845012345', 'sure'],
      ],
    },
    { name: 'UPI with a known handle: UPI', text: 'ramesh@okhdfcbank', expect: [['upi', 'RAMESHOKHDFCBANK', 'sure']] },
    { name: 'email: email, not UPI', text: 'ramesh@example.com', expect: [['email', 'ramesh@example.com', 'sure']] },
    { name: 'domain after a known handle: email', text: 'ramesh@okhdfcbank.in', expect: [['email', 'ramesh@okhdfcbank.in', 'sure']] },
    { name: 'UPI made of a mobile: UPI', text: 'Mobile: 9845012345@ybl', expect: [['upi', '9845012345YBL', 'sure']] },
    { name: 'UDIN: no other kind in its digits', text: 'UDIN 25123456ABCDEF1234', expect: [['udin', '25123456ABCDEF1234', 'sure']] },
    {
      name: 'membership number and UDIN on one line',
      text: 'M. No. 123456, UDIN 25123456ABCDEF1234',
      expect: [
        ['icai-membership', '123456', 'possible'],
        ['udin', '25123456ABCDEF1234', 'sure'],
      ],
    },
    { name: 'e-way bill grouped like an Aadhaar: e-way bill', text: `E-Way Bill No. ${a444}`, expect: [['eway-bill', aadhaar, 'possible']] },
    {
      name: 'e-way bill and UAN on one line',
      text: 'EWB 341234567890 UAN 100123456789',
      expect: [
        ['eway-bill', '341234567890', 'possible'],
        ['uan', '100123456789', 'possible'],
      ],
    },
    { name: 'VID label on a number that also passes Luhn: VID', text: `VID ${group4(both, ' ')}`, expect: [['aadhaar-vid', both, 'sure']] },
    { name: 'BO ID label on a number that passes Luhn: demat', text: `BO ID ${group4(bo, ' ')}`, expect: [['demat', bo, 'possible']] },
    { name: "director's DIN", text: 'DIN: 01234567', expect: [['director-din', '01234567', 'possible']] },
    { name: 'income-tax DIN stays a tax document number', text: 'DIN ITBA/AST/S/143(1)/2024-25/1012345678(1)', expect: [['tax-din', 'ITBAASTS14312024251012345678(1)'.replace(/[^A-Z0-9]/g, ''), 'sure']] },
    { name: 'card label after a voter ID label: voter ID', text: 'Voter ID Card No: ABC1234567', expect: [['voter-id', 'ABC1234567', 'sure']] },
    { name: 'an account word first: Universal Account Number stays an account', text: 'Universal Account Number: 100123456789', expect: [['bank-account', '100123456789', 'sure']] },
    { name: 'an account word first: demat account number stays an account', text: 'Demat Account No: 1299990012345678', expect: [['bank-account', '1299990012345678', 'sure']] },
    { name: 'relative after S/o is a name', text: 'Ramesh Kumar S/o Suresh Kumar', expect: [['name', 'suresh kumar', 'possible']] },
    { name: "father's name with a colon keeps the Name rule", text: "Father's Name: Suresh Kumar", expect: [['name', 'suresh kumar', 'possible']] },
  ];
}
