// The number rules of PDF to Excel (design 5.11; contract decision 12, "Number rules"; T-064).
//
// A cell becomes a number only when the WHOLE cell parses; anything doubtful stays text, because a wrong
// amount in an auditor's workbook is worse than an amount left as text. A number may have:
// - one currency mark before it (₹, Rs, Rs., INR, in any letter case), before or after a leading minus or
//   an opening bracket;
// - a leading minus (also the true minus sign U+2212), a trailing minus, or brackets, for a negative;
// - digits ungrouped, or grouped validly as Indian (1,23,456.78) or western (123,456.78);
// - a trailing Dr or Cr (any letter case), only on a value with no other negative mark: it is kept as a
//   literal suffix of the format and the value is never turned negative (its sign depends on context).
// Text, always: dates in any form, a leading zero, more than 15 digits, a percentage, a lone dash,
// 1.234,56, digits split by a plain space (12 345), a plus sign, a currency mark after the number, and a
// bare whole number of more than 8 digits (no grouping, point, sign, mark or suffix): that reads as an
// account, mobile or customer number, not an amount (lane XLS ruling). A space is dropped only next to a
// comma, point, bracket, sign or currency mark (1,23, 456.78 and ( 500.00 )), never between two digits.
//
// The Excel format reproduces what the page showed: the decimals, the grouping, brackets or a minus at
// either end, Dr/Cr. Indian grouping is written with literal commas placed for the cell's own number of
// digits, with no conditional sections (readers differ in how they sign a negative inside a condition).
// The currency mark is not kept in the format (the value and its grouping are what matter).

export interface ParsedNumber {
  value: number;
  decimals: number;
  grouping: 'indian' | 'western' | 'none';
  negative: 'minus' | 'brackets' | 'trailing-minus' | null;
  suffix: 'Dr' | 'Cr' | null;
}

/** Excel keeps 15 significant digits; a longer number would change. */
export const MAX_DIGITS = 15;
/** A bare whole number longer than this is an identifier, not an amount. */
export const MAX_BARE_DIGITS = 8;

const SPACES = /[\s\u00a0\u2007\u2009\u202f]+/g;
/** A space next to one of these is dropped. */
const JOINERS = '-,.()\u2212₹';
const CURRENCY = '(₹|rs\\.?|inr)';
const SHAPE = new RegExp(
  `^${CURRENCY}?\\s*([-\\u2212])?\\s*${CURRENCY}?\\s*(\\()?\\s*${CURRENCY}?\\s*([0-9][0-9,]*(?:\\.[0-9]+)?)\\s*(\\))?\\s*(-)?\\s*(dr|cr)?$`,
  'i',
);
const WESTERN = /^[0-9]{1,3}(?:,[0-9]{3})+$/;
const INDIAN = /^[0-9]{1,2}(?:,[0-9]{2})*,[0-9]{3}$/;
const PLAIN = /^[0-9]+$/;

function joinSpaces(text: string): string {
  let out = '';
  const chars = Array.from(text.replace(SPACES, ' ').trim());
  chars.forEach((ch, i) => {
    if (ch === ' ' && (JOINERS.includes(chars[i - 1]) || JOINERS.includes(chars[i + 1]))) return;
    out += ch;
  });
  return out;
}

/** The number a whole cell holds, or null when the cell is text (see the rules above). */
export function parseAmount(text: string): ParsedNumber | null {
  if (typeof text !== 'string' || text.includes('%')) return null;
  const cell = joinSpaces(text);
  if (cell === '') return null;
  const m = SHAPE.exec(cell);
  if (!m) return null;
  const [, cur1, lead, cur2, open, cur3, body, close, trail, drcr] = m;
  if ([cur1, cur2, cur3].filter(Boolean).length > 1) return null;
  if (Boolean(open) !== Boolean(close)) return null;
  const marks = [lead, open, trail].filter(Boolean).length;
  if (marks > 1) return null;
  if (drcr && marks > 0) return null;

  const [whole, fraction = ''] = body.split('.');
  let grouping: ParsedNumber['grouping'];
  if (PLAIN.test(whole)) grouping = 'none';
  else if (WESTERN.test(whole)) grouping = 'western'; // below a lakh both read the same: western
  else if (INDIAN.test(whole)) grouping = 'indian';
  else return null;
  const intDigits = whole.replace(/,/g, '');
  if (intDigits.length > 1 && intDigits.startsWith('0')) return null;
  if (intDigits.length + fraction.length > MAX_DIGITS) return null;
  const bare = grouping === 'none' && fraction === '' && !cur1 && !cur2 && !cur3 && marks === 0 && !drcr;
  if (bare && intDigits.length > MAX_BARE_DIGITS) return null;

  const negative: ParsedNumber['negative'] = lead ? 'minus' : open ? 'brackets' : trail ? 'trailing-minus' : null;
  const size = Number(fraction ? `${intDigits}.${fraction}` : intDigits);
  if (!Number.isFinite(size)) return null;
  const value = negative && size !== 0 ? -size : size;
  const suffix = drcr ? (drcr.toLowerCase() === 'dr' ? 'Dr' : 'Cr') : null;
  return { value, decimals: fraction.length, grouping, negative, suffix };
}

/** |value| as written with its decimals, split at the point (no exponent: at most 15 digits get here). */
function digitsOf(n: ParsedNumber): { whole: string; fraction: string } {
  const [whole, fraction = ''] = Math.abs(n.value).toFixed(n.decimals).split('.');
  return { whole, fraction };
}

/** Indian grouping as digit placeholders with literal commas, for exactly this many whole digits. */
function indianPattern(digits: number): string {
  if (digits <= 3) return '0';
  const groups = ['##0'];
  let left = digits - 3;
  while (left > 0) {
    const take = Math.min(2, left);
    groups.unshift('#'.repeat(take));
    left -= take;
  }
  // A quoted comma is a literal comma (a bare one between placeholders would mean western grouping).
  return groups.join('","');
}

/** The cell's Excel number format: shows the cell as the page showed it. */
export function numberFormat(n: ParsedNumber): string {
  const whole = n.grouping === 'western' ? '#,##0' : n.grouping === 'indian' ? indianPattern(digitsOf(n).whole.length) : '0';
  const body = n.decimals > 0 ? `${whole}.${'0'.repeat(n.decimals)}` : whole;
  if (n.suffix) return `${body}" ${n.suffix}"`;
  if (!n.negative) return body;
  const shown = n.negative === 'minus' ? `-${body}` : n.negative === 'brackets' ? `(${body})` : `${body}-`;
  // A zero shown with a negative mark keeps the mark (Excel's third section is for zero).
  return n.value === 0 ? `${body};${shown};${shown}` : `${body};${shown}`;
}

/** The cell as Excel shows it with numberFormat: for the dialog's preview. */
export function displayNumber(n: ParsedNumber): string {
  const { whole: digits, fraction } = digitsOf(n);
  let whole = digits;
  if (n.grouping === 'western') whole = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  else if (n.grouping === 'indian' && digits.length > 3) whole = `${digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${digits.slice(-3)}`;
  const body = n.decimals > 0 ? `${whole}.${fraction}` : whole;
  if (n.suffix) return `${body} ${n.suffix}`;
  if (!n.negative) return body;
  return n.negative === 'minus' ? `-${body}` : n.negative === 'brackets' ? `(${body})` : `${body}-`;
}
