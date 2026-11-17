// Redact's choices, record and words (design 5.9 "Remove or Replace", "Output", "Result and record",
// "The check"). Pure functions: the run and the dialog use the same wording.
//
// CONFIDENTIALITY. Nothing here takes a value, a typed term, a custom token or a masked text: the record
// is built from counts and fixed choices only (activity.ts keeps exactly these twelve keys for Redact),
// and every sentence is made of numbers, page numbers and fixed words.
import { formatPageList } from '@/lib/pdf-tools/pageList';
import { ADDED_COUNT_NAMES, type RedactKind } from '@/lib/pdf-tools/redactPatterns';
import { PdfToolsError } from '@/lib/pdf-tools/types';
import { plural } from '../format';

export type RedactMode = 'remove' | 'replace';
export type ReplacementStyle = 'token' | 'label' | 'masked';
export type RedactOutput = 'searchable' | 'picture';
export type RedactDpi = 150 | 200 | 300;

export const DEFAULT_TOKEN = '[REDACTED]';
export const TOKEN_MAX = 30;
/** Letters, digits, spaces and [ ] ( ) - / . (design 5.9). */
const TOKEN_CHARS = /^[A-Za-z0-9 [\]()\-/.]+$/;
export const DPI_CHOICES: readonly RedactDpi[] = [150, 200, 300];
export const DEFAULT_DPI: RedactDpi = 200;

/** Why a custom token cannot be used, or null. Never repeats the token. */
export function tokenError(token: string): string | null {
  const t = token.trim();
  if (t.length < 1 || t.length > TOKEN_MAX) return `The replacement needs 1 to ${TOKEN_MAX} characters.`;
  if (!TOKEN_CHARS.test(t)) return 'The replacement can hold letters, digits, spaces and [ ] ( ) - / . only.';
  return null;
}

/** How the record names the replacement: a custom token is never recorded (it could hold a value). */
export function replacementRecord(mode: RedactMode, style: ReplacementStyle, token: string): 'token-default' | 'token-custom' | 'label' | 'masked' {
  if (mode === 'replace' && style === 'label') return 'label';
  if (mode === 'replace' && style === 'masked') return 'masked';
  return token.trim() === DEFAULT_TOKEN ? 'token-default' : 'token-custom';
}

/** The kinds' names in the record's and the summary's counts, in the order they are listed. Fixed words only. */
export const COUNT_NAMES: Readonly<Record<RedactKind, string>> = {
  pan: 'PAN',
  aadhaar: 'Aadhaar',
  gstin: 'GSTIN',
  tan: 'TAN',
  'tax-din': 'tax document',
  email: 'email',
  mobile: 'mobile',
  'bank-account': 'account',
  ifsc: 'IFSC',
  micr: 'MICR',
  'itr-ack': 'ITR ack',
  evc: 'EVC',
  ip: 'IP',
  // The kinds RX-PAT added (T-052), in their own words for the counts.
  ...ADDED_COUNT_NAMES,
  name: 'name',
  address: 'address',
  addressee: 'addressee',
  typed: 'typed',
  'same-text': 'same text',
  marked: 'marked',
  drawn: 'drawn',
};

const COUNT_ORDER = Object.keys(COUNT_NAMES) as RedactKind[];
/** The activity record keeps option texts of at most 200 characters. */
const COUNTS_MAX = 200;

/**
 * "PAN 6, Aadhaar 2, typed 3, drawn 3": the kinds with a count above 0, in a fixed order. Empty when
 * none. When the list would be longer than the record keeps, its last kinds are summed as "others N".
 */
export function countsText(counts: Partial<Record<RedactKind, number>>): string {
  const parts = COUNT_ORDER.filter((kind) => Number.isInteger(counts[kind]) && (counts[kind] ?? 0) > 0).map((kind) => ({ name: COUNT_NAMES[kind], n: counts[kind] ?? 0 }));
  const text = (list: { name: string; n: number }[]) => list.map((p) => `${p.name} ${p.n}`).join(', ');
  for (let keep = parts.length; keep > 0; keep--) {
    const rest = parts.slice(keep).reduce((sum, p) => sum + p.n, 0);
    const shown = text(parts.slice(0, keep)) + (rest > 0 ? `, others ${rest}` : '');
    if (shown.length <= COUNTS_MAX) return shown;
  }
  return parts.length > 0 ? `areas ${parts.reduce((sum, p) => sum + p.n, 0)}` : '';
}

/** What a finished run did, in counts and choices. */
export interface RedactOutcome {
  /** Ticked places plus drawn boxes. */
  areas: number;
  /** Pages with the user's areas (the summary's "on N pages"). */
  pagesWithAreas: number;
  /** Every page made a picture. */
  pagesRebuilt: number;
  /** Pages the check added because they held a chosen value where it could not be seen. */
  pagesRebuiltHidden: number;
  /** Pages made a picture without a box on the user's confirmation. */
  pagesFlattened: number;
  counts: Partial<Record<RedactKind, number>>;
  mode: RedactMode;
  replacement: 'token-default' | 'token-custom' | 'label' | 'masked';
  output: RedactOutput;
  dpi: RedactDpi;
  valuesLeftVisible: number;
  textLayerCharsOmitted: number;
  autoBoxesDropped: number;
  bookmarksRemoved: number;
}

/**
 * The record of a Redact result: the summary line of design 5.9 ("Redacted 14 areas on 3 pages (PAN 6,
 * Aadhaar 2, typed 3, drawn 3); searchable, 200 dpi") and exactly the twelve allowed options. The
 * flags' notes are added by the run (pdfResult).
 */
export function redactRecord(o: RedactOutcome): { summary: string; options: Record<string, string | number> } {
  const counts = countsText(o.counts);
  let summary = `Redacted ${plural(o.areas, 'area')} on ${plural(o.pagesWithAreas, 'page')}${counts ? ` (${counts})` : ''}; ${o.output === 'searchable' ? 'searchable' : 'picture only'}, ${o.dpi} dpi`;
  if (o.pagesFlattened > 0) summary += `; ${plural(o.pagesFlattened, 'page')} flattened on the user's confirmation`;
  const options: Record<string, string | number> = {
    areas: o.areas,
    pagesRebuilt: o.pagesRebuilt,
    pagesRebuiltHidden: o.pagesRebuiltHidden,
    mode: o.mode,
    replacement: o.replacement,
    output: o.output,
    dpi: o.dpi,
    valuesLeftVisible: o.valuesLeftVisible,
    textLayerCharsOmitted: o.textLayerCharsOmitted,
    autoBoxesDropped: o.autoBoxesDropped,
    bookmarksRemoved: o.bookmarksRemoved,
  };
  if (counts) options.counts = counts;
  return { summary, options };
}

// ---- words ------------------------------------------------------------------------------------------------

/** "page 4" / "pages 2, 5-7" from 0-based page indices. */
export function pagesInWords(pages: readonly number[]): string {
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  return `${sorted.length === 1 ? 'page' : 'pages'} ${formatPageList(sorted)}`;
}

/** "Page 4" / "Pages 2, 5-7". */
const PagesInWords = (pages: readonly number[]) => {
  const text = pagesInWords(pages);
  return text.charAt(0).toUpperCase() + text.slice(1);
};

const NOTHING_ADDED = 'Nothing was added.';

/**
 * What the user can do about a result that could not be verified (non-blocking 6 of the end-to-end
 * review: the next step must be one that can help):
 * - 'box': the text is drawn on a page where Redact could not place it, in text the find reads: a box
 *   over it helps (the page is then rebuilt and every drawing on it proved);
 * - 'elsewhere': it is outside the pages (document properties, bookmarks, the form, other), or drawn
 *   where no box can place it (a font's name or map, a stream that paints nothing there or cannot be
 *   measured): only unticking it, or a copy printed to a new PDF, helps. A box drawn anywhere else on
 *   the page is never offered as a way through (wave 2, ruling 3, R4).
 */
export type NotVerifiedHint = 'box' | 'elsewhere';

const NEXT_STEP: Readonly<Record<NotVerifiedHint, string>> = {
  box: 'Draw a box over that text, or untick that value, and run Redact again.',
  elsewhere: 'Untick that value, or print the file to a new PDF and redact that copy.',
};

/**
 * The run could not prove the result clean (design 5.9 "The check"): where, in words (pages and fixed
 * place names), never what, and a next step that fits. Nothing is added.
 */
export function notVerified(places: { pages: readonly number[]; elsewhere: readonly string[] }, hint: NotVerifiedHint = 'box'): PdfToolsError {
  const where = [...(places.pages.length > 0 ? [pagesInWords(places.pages)] : []), ...places.elsewhere].join(', ');
  return new PdfToolsError('redact-check-failed', `The redacted file could not be verified: redacted text was still found in it${where ? ` (${where})` : ''}. ${NOTHING_ADDED} ${NEXT_STEP[hint]}`);
}

/** The user chose not to go on with the pages the question named (flattened, or made a picture as they are). */
export function flattenDeclined(pages: readonly number[]): PdfToolsError {
  const one = pages.length === 1;
  return new PdfToolsError(
    'redact-check-failed',
    `${PagesInWords(pages)} still ${one ? 'holds' : 'hold'} redacted text where no box can cover it, and ${one ? 'it was' : 'they were'} not flattened. ${NOTHING_ADDED} If the text can be seen on ${one ? 'the page' : 'a page'}, draw a box over it and run Redact again.`,
  );
}

/**
 * The question asked before pages are flattened or made pictures with redacted text the run cannot
 * place (design: never silent, never a dead end; end-to-end review B5). `mayShow`: pages whose
 * alternative text says they show a chosen value in a form Redact cannot read (a picture, a drawing,
 * an unusual font). It never says that nothing visible changes: the run cannot know that.
 */
export function flattenQuestion(pages: readonly number[], mayShow: readonly number[] = []): { title: string; body: string } {
  const one = pages.length === 1;
  const shows = pages.filter((p) => mayShow.includes(p));
  const stored = `${PagesInWords(pages)} ${one ? 'holds' : 'hold'} redacted text that is stored in the page rather than drawn as text Redact can read (for example alternative text or a layer's name), so no box can be placed for it. Flattening makes ${one ? 'the page' : 'each page'} a picture of what it shows now, which removes that stored text.`;
  const title = `Flatten ${one ? 'this page' : `these ${pages.length} pages`}?`;
  if (shows.length === 0) return { title, body: `${stored} Look at the page first: anything you can see on it stays visible.` };
  const subject = one ? 'This page' : PagesInWords(shows);
  const verb = shows.length > 1 ? 'may each show' : 'may show';
  return { title, body: `${stored} ${subject} ${verb} it in a form Redact cannot read. Look at the page: if you can see it, choose Do not flatten, draw a box over it and run Redact again.` };
}

// ---- limits and names ---------------------------------------------------------------------------------------

/**
 * What Redact cannot see (end-to-end review, "Limits the design document and the dialog must state";
 * design 5.9, lead ruling on the sentence near the Redact button): one plain sentence in the ruling's
 * words, its middle part and the other limits folded.
 */
export const REDACT_LIMITS = {
  short: 'Redact removes the text it can read: look at every page of the result before you share it, and draw a box over anything still showing.',
  more:
    'It cannot read text inside pictures, barcodes, QR codes or scanned pages, letters drawn as shapes, or a stamp set to print but not to show on screen. A value split between two table cells or two columns, or a word broken at a line end without a hyphen, may not be found. Text in a font that hides its letters (it shows one letter and gives another when copied) may not be found. Symbols it cannot read, such as some bullets, are covered with small boxes on the pages it redacts, to be safe. Your own words are found as the line under the word field says. Boxes may cover a few characters, or a whole line, more than the value.',
} as const;

/**
 * K1 (wave 4), said in the confirmation before the run: the pages where text Redact cannot read (letters a font's
 * map gives no letter for, or private-use and control characters) will be covered (redactRounds.ts pagesLosingText).
 * Null when there are none.
 */
export function textCoveredSentence(pages: readonly number[]): string | null {
  return pages.length > 0 ? `On ${pagesInWords(pages)}, some text Redact cannot read will be covered too.` : null;
}

/** The result's name when the usual one would show a chosen value (end-to-end review B6). */
export const REDACTED_NAME = 'Redacted document.pdf';
/** How the record names a source whose file name holds a chosen value: the record never holds a value (lead's ruling). */
export const WITHHELD_NAME = 'Original file (name withheld)';

/** `name`, or "Redacted document.pdf" when `holds` finds a chosen value in it. */
export function safeResultName(name: string, holds: (text: string) => boolean): string {
  return holds(name) ? REDACTED_NAME : name;
}

export interface RunNotes {
  pagesRebuiltHidden: readonly number[];
  pagesFlattened: readonly number[];
  replacementsNotFitted: number;
  boxesWidened: number;
  textLayerCharsOmitted: number;
  autoBoxesDropped: number;
  valuesLeftVisible: number;
  bookmarksRemoved: number;
  output: RedactOutput;
  /** Pages where the proof boxed more of a chosen value than the places found: a stamp, form or drawing, or text reaching past its box (wave 2). */
  pagesCoveredMore?: readonly number[];
  /** Pages where the proof covered whole a drawing whose text could not be read. */
  pagesCoveredWhole?: readonly number[];
  /** Pages made pictures only because they could not be copied safely (wave 4, ruling M), with nothing covered on them. */
  pagesMadePictures?: readonly number[];
  /** K4 (wave 4): redacted pages whose only text is an invisible layer (a scan's OCR text). */
  pagesHiddenTextOnly?: readonly number[];
  /** Ruling R (wave 5): pages where only glyphs with no letter of their own were covered, one by one (K1), not whole runs. */
  pagesCoveredLetters?: readonly number[];
  /** Ruling R (wave 5): the redacted pages' text has Devanagari, so the searchable note may name Hindi. */
  omittedHindi?: boolean;
}

/** The sentences the result message adds (design 5.9), only those that apply. */
export function resultNotes(n: RunNotes): string[] {
  const notes: string[] = [];
  if (n.pagesRebuiltHidden.length > 0) {
    const one = n.pagesRebuiltHidden.length === 1;
    notes.push(`${PagesInWords(n.pagesRebuiltHidden)} also held redacted text the review did not list. It was covered there too, and ${one ? 'the page was' : 'the pages were'} made ${one ? 'a picture' : 'pictures'}.`);
  }
  if (n.pagesFlattened.length > 0) notes.push(`${PagesInWords(n.pagesFlattened)} ${n.pagesFlattened.length === 1 ? 'was' : 'were'} flattened, as you confirmed.`);
  const pictures = n.pagesMadePictures ?? [];
  if (pictures.length > 0) notes.push(`${PagesInWords(pictures)} ${pictures.length === 1 ? 'was also made a picture' : 'were also made pictures'}, to be safe.`);
  // At most one plain sentence when something was covered more widely than asked (lead ruling 7).
  const whole = n.pagesCoveredWhole ?? [];
  const more = n.pagesCoveredMore ?? [];
  if (whole.length > 0) notes.push(`On ${pagesInWords([...new Set([...whole, ...more])])}, text or a drawing that could not be read was covered whole, to be safe.`);
  else if (more.length > 0) notes.push(`On ${pagesInWords(more)}, a chosen value also showed outside the places found; it was covered there too.`);
  // Ruling R (wave 5): letters covered one by one are never said to be "covered whole".
  const letters = (n.pagesCoveredLetters ?? []).filter((p) => !whole.includes(p));
  if (letters.length > 0) notes.push(`On ${pagesInWords(letters)}, some letters that could not be read were covered, to be safe.`);
  const scans = n.pagesHiddenTextOnly ?? [];
  if (scans.length > 0) {
    const one = scans.length === 1;
    notes.push(`${PagesInWords(scans)} ${one ? 'is a scan' : 'are scans'} with hidden text: where that text misread a value, the ${one ? 'scan' : 'scans'} may still show it, so look at the ${one ? 'page' : 'pages'}.`);
  }
  if (n.replacementsNotFitted > 0) {
    notes.push(`${plural(n.replacementsNotFitted, 'replacement')} did not fit and ${n.replacementsNotFitted === 1 ? 'was' : 'were'} left as plain black ${n.replacementsNotFitted === 1 ? 'box' : 'boxes'}.`);
  }
  if (n.boxesWidened > 0) notes.push(`${plural(n.boxesWidened, 'box', 'boxes')} ${n.boxesWidened === 1 ? 'was' : 'were'} widened to the whole line, to be sure nothing of the text shows.`);
  // "Still visible" only when nothing of it was covered (K1: then it is true of every such page). Ruling R: Hindi is
  // named only where the redacted pages have Devanagari (not on Arabic, Urdu or Hebrew pages).
  if (n.output === 'searchable' && n.textLayerCharsOmitted > 0) {
    const visible = whole.length === 0 && letters.length === 0;
    notes.push(n.omittedHindi ? `Some text on the redacted pages cannot be made searchable (for example Hindi and ₹).${visible ? ' It is still visible.' : ''}` : `Some scripts and symbols on the redacted pages cannot be made searchable.${visible ? ' They are still visible.' : ''}`);
  }
  if (n.autoBoxesDropped > 0) {
    notes.push(`${plural(n.autoBoxesDropped, 'automatic box', 'automatic boxes')} covered almost the whole page and ${n.autoBoxesDropped === 1 ? 'was' : 'were'} left out.`);
  }
  if (n.valuesLeftVisible > 0) notes.push(`${plural(n.valuesLeftVisible, 'chosen value')} ${n.valuesLeftVisible === 1 ? 'stays' : 'stay'} visible where you unticked ${n.valuesLeftVisible === 1 ? 'it' : 'them'}.`);
  if (n.bookmarksRemoved > 0) notes.push(`${plural(n.bookmarksRemoved, 'bookmark')} holding redacted text ${n.bookmarksRemoved === 1 ? 'was' : 'were'} removed.`);
  return notes;
}

/**
 * The estimate of design 5.9: bytes of the rebuilt pages, before the work. Wave 4 (T3-C should-fix 3: 35 KB a page
 * was four times too small for a statement): a text page costs about 20 KB and 80 bytes for each character on it
 * (`chars`: all the text pages' characters, white space aside; a page of ordinary text, 1,200, when not given), a
 * page without text 800 KB, at 200 dpi; 0.6 and 2.3 times that at 150 and 300 dpi. Pages in colour cost more.
 */
export function estimateBytes(textPages: number, pagesWithoutText: number, dpi: RedactDpi, chars = textPages * 1200): number {
  const factor = dpi === 150 ? 0.6 : dpi === 300 ? 2.3 : 1;
  return Math.round((textPages * 20_000 + chars * 80 + pagesWithoutText * 800_000) * factor);
}
