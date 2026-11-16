// Redact (design 5.9 "What is searched", "Every occurrence", "Boxes"): proposals of what to redact on
// each page, from the page's text model and the texts of its comments, fields and links.
//
// COORDINATES. Proposal.rects are Rects of pageText.ts: PDF user space of the page (points, y up,
// before /Rotate, independent of the crop box), axis-aligned, padded by BOX_PAD_PT for text matches;
// for comments, fields, links and marks, the annotation's own rectangle. `page` is a 0-based page index.
//
// Confidentiality: proposals and held places hold values in memory for the review only. Ids never
// contain a value, and no message built here names one.
import { pageReadings, pageSeamPlaces, placesInReadings, rangePieces, rangeRects, wordRanges, wordRect, type MeasureChar, type PageTextModel, type Rect } from './pageText';
import { loosePlacesOf } from './redactCheck';
import { ADDED_KIND_NAMES, coveredPlacesOfValue, findPatterns, foldText, KIND_GROUP, keyOf, neverTickedByDefault, termError, wordsKey, type FoundKind, type RedactGroup, type RedactKind, type Term } from './redactPatterns';
import { PdfToolsError } from './types';

/** An annotation as the renderer reads it (pdf.js getAnnotations): its subtype, rectangle, flags and every text it holds. */
export interface AnnotationText {
  subtype: string;
  /** [x1, y1, x2, y2] in user space, as pdf.js reports it. */
  rect: readonly number[];
  /** Contents, author, FreeText appearance text, field value(s), link address. */
  texts: readonly string[];
  /** The annotation flags (/F, pdf.js `annotationFlags`): Hidden (2) and NoView (32) mean it is not shown. */
  flags?: number;
}

export type ProposalSource = 'text' | 'comment' | 'field' | 'link' | 'marked';

export interface Proposal {
  /** Unique in a file's proposals and stable between finds of the same file; never holds a value. */
  id: string;
  kind: RedactKind;
  key: string;
  /** The text as written at this place. */
  value: string;
  /** 0-based page index. */
  page: number;
  /** User-space boxes (see the comment at the top): one per line for text, the annotation's rectangle otherwise. */
  rects: Rect[];
  confidence: 'sure' | 'possible';
  reason?: string;
  source: ProposalSource;
  /** True when no part of the place lies inside the page's visible box (text found only through the enlarged-view copy). */
  outsideView: boolean;
  /** [start, end) offsets in the page text model's `text`; empty for comments, fields, links and marks. */
  ranges: [number, number][];
  /** The kind as the list shows it (PAN, Aadhaar, …, the term's reason for a typed term). */
  label: string;
  /** Direction of the text, degrees counter-clockwise from user-space +x (0 for annotations): the replacement is drawn along it. */
  angle?: number;
  /**
   * The place is not painted on the page, so it is removed without a box (its page is still rebuilt):
   * text wholly outside the visible box, link addresses, and the texts of hidden or no-view
   * annotations (fix round 1, F6, F9; fix wave B3: any other annotation is boxed). The run may also set
   * it for text it can prove is not painted (render mode 3); never from the pixels alone.
   */
  hidden?: boolean;
  /** For 'same-text' places: the drawn box whose "Redact this text everywhere" made it (fix round 1, F5). */
  fromBox?: string;
  /**
   * A comment, field or link whose rectangle covers almost the whole page (over AUTO_BOX_MAX_SHARE): the
   * page shows it, but no automatic box is drawn over a whole page (the owner's rule), so `hidden` is set
   * and the run must place what it shows or stop. Not "removed without a box": show PAGE_SIZED_NOTE
   * instead (fix wave round 2). Set by dropPageSizedBoxes.
   */
  pageSized?: boolean;
}

/** What the list says of a `pageSized` place, in place of "not shown on the page: removed without a box". */
export const PAGE_SIZED_NOTE = 'drawn over the whole page: placed during the run, or the run stops';

export interface FindOptions {
  groups: ReadonlySet<RedactGroup>;
  terms: readonly Term[];
  measure: MeasureChar;
}

export interface ValueGroup {
  key: string;
  kind: RedactKind;
  places: Proposal[];
}

/** The most places one run redacts. Counted on TICKED places, in the review (fix round 1, F4, lead ruling). */
export const MAX_PLACES = 5_000;
/** An automatic box covering more than this share of its page is dropped (the owner's safety rule). */
export const AUTO_BOX_MAX_SHARE = 0.95;

/** The list label of each kind. A typed term's label is its reason ("Typed" when none was given). */
export const KIND_NAMES: Readonly<Record<RedactKind, string>> = {
  pan: 'PAN',
  aadhaar: 'Aadhaar',
  gstin: 'GSTIN',
  tan: 'TAN',
  'tax-din': 'Tax document number',
  email: 'Email',
  mobile: 'Mobile',
  'bank-account': 'Bank account',
  ifsc: 'IFSC',
  micr: 'MICR',
  'itr-ack': 'ITR acknowledgement',
  evc: 'EVC',
  ip: 'IP address',
  name: 'Name',
  address: 'Address',
  addressee: 'Addressee',
  // The kinds lane RX-PAT added in T-048 (redactPatterns.ts), named there.
  ...ADDED_KIND_NAMES,
  typed: 'Typed',
  drawn: 'Drawn',
  'same-text': 'Same text',
  marked: 'Marked for redaction in the file',
};

/**
 * PdfToolsError 'redact-too-many' when more than MAX_PLACES places are ticked. The message says how many
 * are ticked and what narrows the run; it holds a count, never a value.
 */
export function tooManyPlaces(ticked: number): PdfToolsError {
  const n = Math.max(0, Math.round(ticked)).toLocaleString('en-IN');
  return new PdfToolsError(
    'redact-too-many',
    `${n} places are ticked. Redact can remove at most ${MAX_PLACES.toLocaleString('en-IN')} in one run: untick a kind of data, or the places on some pages, and redact the rest in a second run.`,
  );
}

// ---- building proposals ------------------------------------------------------------------------------

const intersects = (a: Rect, b: Rect) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
const viewRect = (model: PageTextModel): Rect => ({ x0: model.view[0], y0: model.view[1], x1: model.view[2], y1: model.view[3] });

function sourceOf(subtype: string): ProposalSource {
  if (subtype === 'Widget') return 'field';
  if (subtype === 'Link') return 'link';
  if (subtype === 'Redact') return 'marked';
  return 'comment';
}

/**
 * Annotations whose texts are never drawn by themselves: a link's address (a link has no appearance of
 * its own text) and a popup (its parent holds the same text and is boxed). Every other annotation may
 * draw what it holds: a free-text comment, a field, a stamp, and also a square, line, circle or note
 * whose appearance writes its contents (fix wave, redact-e2e-review B3). Their rectangle is boxed.
 */
const neverDrawsItsText = (subtype: string) => subtype === 'Link' || subtype === 'Popup';
const HIDDEN_FLAGS = 2 | 32;

function annotationRect(rect: readonly number[]): Rect | null {
  if (rect.length < 4 || !rect.slice(0, 4).every(Number.isFinite)) return null;
  const r = { x0: Math.min(rect[0], rect[2]), y0: Math.min(rect[1], rect[3]), x1: Math.max(rect[0], rect[2]), y1: Math.max(rect[1], rect[3]) };
  return r.x1 > r.x0 && r.y1 > r.y0 ? r : null;
}

interface Place {
  kind: RedactKind;
  key: string;
  confidence: 'sure' | 'possible';
  reason?: string;
  label: string;
  /** Ruling R: the value to show and check for a place whose text holds unreadable glyphs: the typed words. */
  shown?: string;
}

/**
 * A text place as a proposal: one range of the model's text, or (fix wave 3, Ruling C) one range per piece
 * of a place read by position or across a broken word, each piece boxed on its own line. `value` is the
 * place as it reads (the reading's text); by default the model's text of its ranges.
 */
function textProposal(model: PageTextModel, place: Place, ranges: readonly (readonly [number, number])[], measure: MeasureChar, value?: string): Proposal | null {
  const tight = ranges.flatMap(([s, e]) => rangeRects(model, s, e, measure, 0));
  if (tight.length === 0) return null;
  const [first] = rangePieces(model, ranges[0][0], ranges[0][1], measure);
  const angle = first ? (((Math.round((Math.atan2(first.direction[1], first.direction[0]) * 180) / Math.PI * 100) / 100) % 360) + 360) % 360 : 0;
  const outsideView = !tight.some((r) => intersects(r, viewRect(model)));
  return {
    id: `t${model.pageIndex}-${ranges.map(([s, e]) => `${s}-${e}`).join('_')}-${place.kind}`,
    kind: place.kind,
    key: place.key,
    value: value ?? ranges.map(([s, e]) => model.text.slice(s, e)).join(' '),
    page: model.pageIndex,
    // Padded by rangeRects itself (BOX_PAD_PT), so one padding serves every box.
    rects: ranges.flatMap(([s, e]) => rangeRects(model, s, e, measure)),
    confidence: place.confidence,
    ...(place.reason ? { reason: place.reason } : {}),
    source: 'text',
    outsideView,
    ranges: ranges.map(([s, e]): [number, number] => [s, e]),
    label: place.label,
    angle,
    hidden: outsideView,
  };
}

function annotationProposal(model: PageTextModel, place: Place, annotation: AnnotationText, a: number, t: number, start: number, end: number, value: string): Proposal | null {
  const rect = annotationRect(annotation.rect);
  if (!rect) return null;
  const outsideView = !intersects(rect, viewRect(model));
  // Every annotation that is shown (not Hidden, not NoView) gets a box over its rectangle, whatever its
  // subtype: its appearance may draw the text, and the page picture is drawn with it (fix wave B3).
  // Covering a note's icon is harmless. A link's address and anything in a hidden annotation are not
  // drawn: they leave with the annotation, no box.
  const shown = !neverDrawsItsText(annotation.subtype) && ((annotation.flags ?? 0) & HIDDEN_FLAGS) === 0;
  return {
    id: `a${model.pageIndex}-${a}-${t}-${start}-${end}-${place.kind}`,
    kind: place.kind,
    key: place.key,
    value,
    page: model.pageIndex,
    rects: [rect],
    confidence: place.confidence,
    ...(place.reason ? { reason: place.reason } : {}),
    source: sourceOf(annotation.subtype),
    outsideView,
    ranges: [],
    label: place.label,
    angle: 0,
    hidden: !shown || outsideView,
  };
}

/** The user's terms that can be searched, one per key, with their labels. */
function usableTerms(terms: readonly Term[]): { key: string; text: string; label: string }[] {
  const seen = new Set<string>();
  const out: { key: string; text: string; label: string }[] = [];
  for (const term of terms) {
    if (termError(term.text) !== null) continue;
    const key = wordsKey(term.text);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ key, text: term.text, label: term.reason?.trim() || KIND_NAMES.typed });
  }
  return out;
}

/** Everything the patterns and the typed terms find in one string. */
function matchesIn(text: string, options: FindOptions): { place: Place; start: number; end: number }[] {
  const out: { place: Place; start: number; end: number }[] = [];
  for (const m of findPatterns(text, options.groups)) {
    out.push({ place: { kind: m.kind, key: m.key, confidence: m.confidence, reason: m.reason, label: KIND_NAMES[m.kind] }, start: m.start, end: m.end });
  }
  const typedRanges = new Set<string>();
  for (const term of usableTerms(options.terms)) {
    // Typed words by THE loose rule (fix wave 2, ruling 4: any punctuation between the words, or none).
    if (cannotHoldWords(text, term.text)) continue;
    for (const r of loosePlacesOf(text, 'typed', term.text)) {
      // Two terms matching the same text are one place.
      const at = `${r.start}:${r.end}`;
      if (typedRanges.has(at)) continue;
      typedRanges.add(at);
      out.push({ place: { kind: 'typed', key: term.key, confidence: 'sure', label: term.label }, start: r.start, end: r.end });
    }
    // Ruling R: where the text holds glyphs it cannot read, each standing for some letters of the term.
    for (const r of wildcardPlaces(text, term.text)) {
      const at = `${r.start}:${r.end}`;
      if (typedRanges.has(at)) continue;
      typedRanges.add(at);
      out.push({ place: { kind: 'typed', key: term.key, confidence: 'sure', label: term.label, shown: term.text.trim().replace(/\s+/g, ' ') }, start: r.start, end: r.end });
    }
  }
  return out;
}

/** A place on a page's text held without its proposal: a possible match no profile ticks (neverTickedByDefault). */
export interface HeldHit {
  kind: RedactKind;
  key: string;
  start: number;
  end: number;
  reason?: string;
}

/** What one page gives: proposals to show and tick, and the places held compactly. */
export interface PageFind {
  proposals: Proposal[];
  held: HeldHit[];
}

/**
 * The find of one page, as the run uses it (fix round 1, F4): the pattern kinds of `options.groups`
 * and the typed terms in the page's text (one box per line) and in the texts of its annotations
 * (one place per annotation and value; a box over its rectangle unless it is a link or is hidden;
 * popups skipped, as their parent holds the same text), and the area of each /Redact mark. Text
 * matches that no profile ticks by default (TAN-like and IFSC-like codes, account numbers next to an
 * IFSC, unlabelled twelve-digit numbers) are returned in `held`, without boxes, to be held compactly
 * (holdPlaces) and built only when the user asks (materializeHeld). Nothing here limits the count.
 */
export function findOnPage(model: PageTextModel, annotations: readonly AnnotationText[], options: FindOptions): PageFind {
  const proposals: Proposal[] = [];
  const held: HeldHit[] = [];
  // Every reading of the page (fix wave 3, Ruling C): drawing order, words broken at a line end joined
  // again, and each block (column, table cell) read by position.
  const byId = new Map<string, Proposal>();
  const readings = pageReadings(model);
  // From a block read by position, only typed words and sure values: a table's column of numbers read top
  // to bottom is not one number (the re-tester's GST invoice: four "possible Aadhaar" made of stacked cells).
  const found = [
    ...placesInReadings(model, (t) => matchesIn(t, options), readings.filter((r) => !r.byPosition)),
    ...placesInReadings(model, (t) => matchesIn(t, options).filter((m) => m.place.kind === 'typed' || m.place.confidence === 'sure'), readings.filter((r) => r.byPosition)),
  ];
  for (const { place: { place }, ranges, text } of found) {
    if (neverTickedByDefault(place.kind, place.confidence, place.reason)) {
      // Held places are packed one range each: a place in pieces (read by position) is built at once instead.
      if (ranges.length === 1) {
        held.push({ kind: place.kind, key: place.key, start: ranges[0][0], end: ranges[0][1], ...(place.reason ? { reason: place.reason } : {}) });
        continue;
      }
    }
    const p = textProposal(model, place, ranges, options.measure, place.shown ?? text);
    if (!p) continue;
    // The same place read two ways (a label beside it in one reading only) is one proposal, as sure as its surest reading.
    const known = byId.get(p.id);
    if (!known) {
      proposals.push(p);
      byId.set(p.id, p);
    } else if (p.confidence === 'sure' && known.confidence !== 'sure') {
      known.confidence = 'sure';
      delete known.reason;
    }
  }
  annotations.forEach((annotation, a) => {
    if (annotation.subtype === 'Popup') return;
    if (annotation.subtype === 'Redact') {
      const rect = annotationRect(annotation.rect);
      if (rect) {
        const outsideView = !intersects(rect, viewRect(model));
        proposals.push({
          id: `m${model.pageIndex}-${a}`,
          kind: 'marked',
          key: '',
          value: '',
          page: model.pageIndex,
          rects: [rect],
          confidence: 'sure',
          source: 'marked',
          outsideView,
          ranges: [],
          label: KIND_NAMES.marked,
          angle: 0,
          hidden: outsideView,
        });
      }
    }
    const seen = new Map<RedactKind, Set<string>>();
    annotation.texts.forEach((text, t) => {
      for (const { place, start, end } of matchesIn(text, options)) {
        let keys = seen.get(place.kind);
        if (!keys) seen.set(place.kind, (keys = new Set()));
        if (keys.has(place.key)) continue;
        keys.add(place.key);
        const p = annotationProposal(model, place, annotation, a, t, start, end, text.slice(start, end));
        if (p) proposals.push(p);
      }
    });
  });
  // Fix wave 4, K5: the cells of a table column whose heading names a kind, as possible places of it.
  for (const p of columnPlaces(model, options)) {
    if (byId.has(p.id) || proposals.some((q) => q.kind === p.kind && q.ranges.some(([s, e]) => p.ranges.some(([ps, pe]) => ps < e && s < pe)))) continue;
    byId.set(p.id, p);
    proposals.push(p);
  }
  return { proposals, held };
}

// ---- values under a column heading (fix wave 4, K5) ----------------------------------------------------

/** Column headings that name a kind, in lower case with a closing colon or full stop dropped. */
const HEADING_KINDS: readonly (readonly [RegExp, FoundKind])[] = [
  [/^(?:(?:employee|staff|member|holder|account holder|customer|client|payee|beneficiary|depositor|lender|borrower|director|partner|nominee|applicant|tenant|landlord)\s+)?name(?:\s+of\s+(?:the\s+)?(?:employee|holder|member|payee|beneficiary|depositor|lender|borrower|director|partner|nominee|applicant|tenant|landlord))?$/, 'name'],
  [/^(?:mobile|mob|cell|phone|telephone|contact)(?:\s*(?:no|number|num))?$/, 'mobile'],
  [/^(?:bank\s+)?(?:a\/c|account)(?:\s*(?:no|number|num))?$/, 'bank-account'],
  [/^uan(?:\s*(?:no|number))?$/, 'uan'],
  [/^(?:date of birth|dob|d\.o\.b|birth date)$/, 'dob'],
];

/** What a cell must look like to be offered as a place of the kind its heading names. */
const CELL_SHAPES: Readonly<Partial<Record<FoundKind, (value: string) => boolean>>> = {
  // Two to five words, each starting with a capital, none of them a word of a label ("Date of birth", "Tax deducted").
  name: (v) => v.length <= 60 && /^\p{Lu}[\p{L}.'-]*(?:\s+\p{Lu}[\p{L}.'-]*){1,4}$/u.test(v) && !v.split(/\s+/).some((w) => LABEL_WORD.test(w.toLowerCase().replace(/[.']/g, ''))),
  mobile: (v) => /^(?:\+?91[\s-]?|0)?[6-9]\d{4}[\s-]?\d{5}$/.test(v),
  'bank-account': (v) => /^\d(?:[\s-]?\d){8,17}$/.test(v),
  uan: (v) => /^\d(?:\s?\d){11}$/.test(v),
  dob: (v) => /^\d{1,2}[/.-]\d{1,2}[/.-](?:\d{2}|\d{4})$/.test(v) || /^\d{1,2}[\s-][A-Za-z]{3,9}[\s,-]+\d{4}$/.test(v),
};

/** Words of row labels, never of a person's name: a cell holding one is a label, not a name. */
const LABEL_WORD = /^(?:of|the|and|for|to|in|on|by|date|year|tax|allowance|total|pay|salary|amount|no|number|account|deducted|assessment|employee|employer|address|pan|gross|net|basic|birth|period|name|income|deduction|deductions|rent|special|loan|bank|branch|code|grand|sub|balance|opening|closing|remarks)$/;

/** The reason a column's cell is offered: fixed words, never the file's own. */
const UNDER_HEADING = 'under a column heading that names it';

/**
 * Fix wave 4, K5 (redact-retest-3 T3-B, should fix 4): in a table whose heading row names a kind ("Employee name",
 * "Mobile", "Bank account no.", "UAN", "Date of birth"), each cell of that column that has the kind's shape is a
 * possible place of it (a register gives no label beside each value). The heading must be one item of a row of at
 * least three; a cell is the item of each row below that overlaps the heading most, down to the first gap of more
 * than five sizes. Only kinds of the chosen groups. Possible: never ticked without the user.
 */
function columnPlaces(model: PageTextModel, options: FindOptions): Proposal[] {
  const spans = new Map<number, [number, number]>();
  model.map.forEach((at, k) => {
    if (!at) return;
    const span = spans.get(at[0]);
    if (span) span[1] = k + 1;
    else spans.set(at[0], [k, k + 1]);
  });
  const cells = model.items
    .map((item, i) => {
      const [a, b, c, d, e, f] = item.transform;
      return { i, text: (typeof item.str === 'string' ? item.str : '').trim(), x0: e, x1: e + (Number.isFinite(item.width) ? item.width : 0), y: f, size: Math.hypot(c, d) || item.height || 10, upright: a > 0 && Math.abs(b) < 1e-6 };
    })
    .filter((c) => c.text !== '' && c.upright && spans.has(c.i));
  const sameRow = (p: { y: number; size: number }, q: { y: number; size: number }) => Math.abs(p.y - q.y) <= 0.5 * Math.min(p.size, q.size);
  const out: Proposal[] = [];
  for (const heading of cells) {
    const normal = heading.text.toLowerCase().replace(/[:.]+$/, '').replace(/\s+/g, ' ').trim();
    const kind = HEADING_KINDS.find(([re]) => re.test(normal))?.[1];
    const shape = kind ? CELL_SHAPES[kind] : undefined;
    if (!kind || !shape || !options.groups.has(KIND_GROUP[kind])) continue;
    if (cells.filter((c) => sameRow(c, heading)).length < 3) continue;
    const mid = (heading.x0 + heading.x1) / 2;
    const reach = (heading.x1 - heading.x0) / 2 + heading.size;
    const below = cells.filter((c) => c.y < heading.y - 0.5 * heading.size && Math.min(c.x1, mid + reach) - Math.max(c.x0, mid - reach) > 0).sort((p, q) => q.y - p.y);
    let lastY = heading.y;
    for (let k = 0; k < below.length; ) {
      const row = below.filter((c) => sameRow(c, below[k]));
      if (lastY - below[k].y > 5 * heading.size) break;
      const cell = row.reduce((best, c) => (Math.abs((c.x0 + c.x1) / 2 - mid) < Math.abs((best.x0 + best.x1) / 2 - mid) ? c : best));
      lastY = below[k].y;
      k += row.length;
      if (!shape(cell.text)) continue;
      const key = keyOf(kind, cell.text);
      if (key === '') continue;
      const [s0, s1] = spans.get(cell.i)!;
      let a = s0;
      let b = s1;
      while (a < b && /\s/.test(model.text[a])) a++;
      while (b > a && /\s/.test(model.text[b - 1])) b--;
      const p = textProposal(model, { kind, key, confidence: 'possible', reason: UNDER_HEADING, label: KIND_NAMES[kind] }, [[a, b]], options.measure);
      if (p) out.push(p);
    }
  }
  return out;
}

/**
 * Every proposal of one page (design 5.9): findOnPage's proposals and its held places, all built.
 * The run uses findOnPage and holdPlaces instead, so that thousands of unticked possibles cost little.
 */
export function proposalsForPage(model: PageTextModel, annotations: readonly AnnotationText[], options: FindOptions): Proposal[] {
  const { proposals, held } = findOnPage(model, annotations, options);
  const built = held
    .map((h) => textProposal(model, { kind: h.kind, key: h.key, confidence: 'possible', reason: h.reason, label: KIND_NAMES[h.kind] }, [[h.start, h.end]], options.measure))
    .filter((p): p is Proposal => p !== null);
  return [...proposals, ...built].sort((x, y) => Number(x.source !== 'text') - Number(y.source !== 'text') || (x.ranges[0]?.[0] ?? 0) - (y.ranges[0]?.[0] ?? 0));
}

// ---- a typed value the page text cannot show (fix wave 5, ruling R) --------------------------------------

/** What the page text holds for a glyph the file gives no character for (a browser writes the joined letters of an Indian-script cluster so). */
const UNREADABLE = '\u0000';
/** The most letters of a value one unreadable glyph may stand for (a joined consonant of three letters). */
const WILD_LETTERS = 3;
/** The most steps one text is compared in for one value: a long page of unreadable glyphs cannot hold the find. */
const WILD_STEPS = 200_000;
const LETTER_OR_DIGIT = /^[\p{L}\p{N}]$/u;
const MARK_OR_FORMAT = /^[\p{M}\p{Cf}]$/u;
/** The scripts a value and the text around an unreadable glyph are told apart by. */
const SCRIPT_TESTS = 'Latin Devanagari Bengali Gurmukhi Gujarati Oriya Tamil Telugu Kannada Malayalam Sinhala Arabic Hebrew Thai Cyrillic Greek'.split(' ').map((name) => new RegExp(`^\\p{Script=${name}}$`, 'u'));
/** The script of a letter or sign, as a number from 1; 0 when it has none of SCRIPT_TESTS (a digit, punctuation). */
function scriptOf(ch: string): number {
  for (let k = 0; k < SCRIPT_TESTS.length; k++) if (SCRIPT_TESTS[k].test(ch)) return k + 1;
  return 0;
}
/** A letter as the loose rule compares it: decomposed, its signs dropped, in lower case (one letter, sometimes more). */
function plainLetters(ch: string): string[] {
  const plain = ch.charCodeAt(0) < 0x80 ? ch : ch.normalize('NFKD');
  return Array.from(plain.toLowerCase()).filter((part) => LETTER_OR_DIGIT.test(part));
}

/** A typed value for the comparison of ruling R: its letters and digits as the loose rule compares them, the word each is in, and its scripts. */
interface WildValue {
  letters: string[];
  word: number[];
  scripts: Set<number>;
}

function wildValue(form: string): WildValue | null {
  const letters: string[] = [];
  const word: number[] = [];
  const scripts = new Set<number>();
  let words = 0;
  let inWord = false;
  for (const ch of foldText(form)) {
    if (MARK_OR_FORMAT.test(ch)) {
      const script = scriptOf(ch);
      if (script > 0) scripts.add(script);
    } else if (LETTER_OR_DIGIT.test(ch)) {
      const script = scriptOf(ch);
      if (script > 0) scripts.add(script);
      for (const part of plainLetters(ch)) {
        letters.push(part);
        word.push(words);
      }
      inWord = true;
    } else if (inWord) {
      words++;
      inWord = false;
    }
  }
  return letters.length >= 2 && scripts.size > 0 ? { letters, word, scripts } : null;
}

/** Whether the unreadable glyph at `at` stands in text of one of `scripts`: the nearest character on either side (other unreadable glyphs skipped) is a letter or sign of it. */
function inScript(text: string, at: number, scripts: ReadonlySet<number>): boolean {
  let k = at - 1;
  while (k >= 0 && text[k] === UNREADABLE) k--;
  if (k >= 0) {
    const low = text.charCodeAt(k);
    const ch = low >= 0xdc00 && low <= 0xdfff && k > 0 ? text.slice(k - 1, k + 1) : text[k];
    if (scripts.has(scriptOf(ch))) return true;
  }
  k = at + 1;
  while (k < text.length && text[k] === UNREADABLE) k++;
  return k < text.length && scripts.has(scriptOf(String.fromCodePoint(text.codePointAt(k) ?? 0)));
}

/**
 * Ruling R (fix wave 5; redact-retest-4 T4-B, blocking 2): the places of a typed value (or a name) in a text that
 * holds unreadable glyphs. A browser writes an Indian-script joined consonant as a glyph the file maps to no
 * character (U+0000), so the page text holds the name with that glyph in place of two letters and never equals the
 * typed name. Here the value is compared as the loose rule compares words (letters and digits, signs and case
 * ignored, anything else between two words), and each unreadable glyph that stands in text of the value's script
 * may stand for none to WILD_LETTERS letters of one word of the value: those at its place, or (a letter drawn above
 * the next one and written after it) those before the letter it follows. A place needs at least one such glyph (the
 * loose rule finds the others), no letter joined at either end, and a third of the value's letters readable in it;
 * it takes in the signs and unreadable glyphs that end its last word. Bounded: only text within reach of such a
 * glyph is looked at, and at most WILD_STEPS steps a text. Offsets in `text`.
 */
function wildcardPlaces(text: string, form: string): { start: number; end: number }[] {
  let glyph = text.indexOf(UNREADABLE);
  if (glyph < 0) return [];
  const value = wildValue(form);
  if (!value) return [];
  const { letters, word } = value;
  const n = letters.length;
  const needed = Math.max(1, Math.ceil(n / 3));
  const reach = Math.min(400, 3 * form.length + 16);
  // The stretches of the text within reach of an unreadable glyph of the value's script, each widened to white space.
  const windows: [number, number][] = [];
  for (; glyph >= 0; glyph = text.indexOf(UNREADABLE, glyph + 1)) {
    if (!inScript(text, glyph, value.scripts)) continue;
    let a = Math.max(0, glyph - reach);
    let b = Math.min(text.length, glyph + reach + 1);
    for (let k = 0; k < 64 && a > 0 && !/\s/.test(text[a - 1]); k++) a--;
    for (let k = 0; k < 64 && b < text.length && !/\s/.test(text[b]); k++) b++;
    const last = windows[windows.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else windows.push([a, b]);
  }
  const out: { start: number; end: number }[] = [];
  let steps = 0;
  for (const [from, to] of windows) {
    // The stretch as letters (as the loose rule compares them), unreadable glyphs, and '' for each run of anything else; signs go with what is before them.
    const ch: string[] = [];
    const starts: number[] = [];
    const ends: number[] = [];
    for (let i = from; i < to; ) {
      const cp = text.codePointAt(i) ?? 0;
      const raw = String.fromCodePoint(cp);
      const next = i + raw.length;
      const last = ch.length - 1;
      if (raw === UNREADABLE) {
        ch.push(UNREADABLE);
        starts.push(i);
        ends.push(next);
      } else if (LETTER_OR_DIGIT.test(raw)) {
        for (const part of plainLetters(raw)) {
          ch.push(part);
          starts.push(i);
          ends.push(next);
        }
      } else if (MARK_OR_FORMAT.test(raw)) {
        if (last >= 0 && ch[last] !== '') ends[last] = next;
      } else if (last >= 0 && ch[last] === '') ends[last] = next;
      else {
        ch.push('');
        starts.push(i);
        ends.push(next);
      }
      i = next;
    }
    const m = ch.length;
    const isLetter = (j: number) => j >= 0 && j < m && ch[j] !== '' && ch[j] !== UNREADABLE;
    const seen = new Set<number>();
    /** Where a place that starts at token `j0` ends (the token after its last), or -1. */
    const matchFrom = (j0: number): number => {
      seen.clear();
      const stack: number[] = [0, j0];
      while (stack.length > 0) {
        const j = stack.pop() as number;
        const i = stack.pop() as number;
        const state = i * (m + 1) + j;
        if (seen.has(state)) continue;
        seen.add(state);
        if (++steps > WILD_STEPS) return -1;
        if (i === n) {
          if (isLetter(j)) continue;
          // The unreadable glyphs that end the last word belong to it, unless a letter follows them.
          let end = j;
          while (end < m && ch[end] === UNREADABLE) end++;
          return isLetter(end) ? j : end;
        }
        if (j >= m) continue;
        const t = ch[j];
        if (t === '') {
          // Anything but letters and digits: only between two words of the value.
          if (i > 0 && word[i] !== word[i - 1]) stack.push(i, j + 1);
        } else if (t === UNREADABLE) {
          // Pushed most letters first, so that standing for none is tried first.
          for (let c = Math.min(WILD_LETTERS, n - i); c >= 0; c--) if (c === 0 || word[i + c - 1] === word[i]) stack.push(i + c, j + 1);
        } else {
          // A letter followed by an unreadable glyph that stands for the letters written before it.
          if (j + 1 < m && ch[j + 1] === UNREADABLE) for (let c = WILD_LETTERS - 1; c >= 1; c--) if (i + c < n && letters[i + c] === t && word[i + c] === word[i]) stack.push(i + c + 1, j + 2);
          if (letters[i] === t) stack.push(i + 1, j + 1);
        }
      }
      return -1;
    };
    for (let j0 = 0; j0 < m && steps <= WILD_STEPS; j0++) {
      if (ch[j0] === '') continue;
      // No letter joined before it (in this stretch, or just before the stretch).
      if (j0 > 0 ? isLetter(j0 - 1) : from > 0 && LETTER_OR_DIGIT.test(text[from - 1])) continue;
      const j1 = matchFrom(j0);
      if (j1 < 0) continue;
      let readable = 0;
      let unreadable = 0;
      for (let j = j0; j < j1; j++) {
        if (ch[j] === UNREADABLE) unreadable++;
        else if (ch[j] !== '') readable++;
      }
      if (unreadable === 0 || readable < needed) continue;
      // A sign written before the first letter (a vowel sign drawn to its left) at the start of a word goes with it.
      let start = starts[j0];
      let before = start;
      while (before > 0 && MARK_OR_FORMAT.test(text[before - 1])) before--;
      if (before < start && (before === 0 || !(LETTER_OR_DIGIT.test(text[before - 1]) || text[before - 1] === UNREADABLE))) start = before;
      out.push({ start, end: ends[j1 - 1] });
      j0 = j1 - 1;
    }
  }
  return out;
}

// ---- held places (fix round 1, F4) -------------------------------------------------------------------

/**
 * Held possibles of a file, packed: values (kind, key, reason) in order of first appearance, and their
 * places as [page, start, end] triples in one Int32Array, `offsets[v]` to `offsets[v + 1]` for value v.
 * Treat as opaque: read it with heldSummary, heldValues, materializeHeld. Lives in memory only.
 */
export interface HeldStore {
  readonly places: number;
  readonly kinds: readonly RedactKind[];
  readonly keys: readonly string[];
  readonly reasons: readonly (string | undefined)[];
  readonly offsets: Uint32Array;
  readonly data: Int32Array;
}

export const NO_HELD: HeldStore = { places: 0, kinds: [], keys: [], reasons: [], offsets: new Uint32Array([0]), data: new Int32Array(0) };

/** Packs the held places of every page (`byPage[i]` = page i's `held`). */
export function holdPlaces(byPage: readonly (readonly HeldHit[])[]): HeldStore {
  const index = new Map<RedactKind, Map<string, number>>();
  const kinds: RedactKind[] = [];
  const keys: string[] = [];
  const reasons: (string | undefined)[] = [];
  const lists: number[][] = [];
  byPage.forEach((hits, page) => {
    for (const h of hits) {
      let byKey = index.get(h.kind);
      if (!byKey) index.set(h.kind, (byKey = new Map()));
      let v = byKey.get(h.key);
      if (v === undefined) {
        v = keys.length;
        byKey.set(h.key, v);
        kinds.push(h.kind);
        keys.push(h.key);
        reasons.push(h.reason);
        lists.push([]);
      }
      lists[v].push(page, h.start, h.end);
    }
  });
  const offsets = new Uint32Array(keys.length + 1);
  let total = 0;
  lists.forEach((l, v) => {
    offsets[v] = total;
    total += l.length / 3;
  });
  offsets[keys.length] = total;
  const data = new Int32Array(total * 3);
  lists.forEach((l, v) => data.set(l, offsets[v] * 3));
  return { places: total, kinds, keys, reasons, offsets, data };
}

export interface HeldKindCount {
  kind: RedactKind;
  label: string;
  values: number;
  places: number;
}

/** The held places grouped by kind, with counts, in order of first appearance: what the list shows for them. */
export function heldSummary(store: HeldStore): HeldKindCount[] {
  const byKind = new Map<RedactKind, HeldKindCount>();
  for (let v = 0; v < store.keys.length; v++) {
    const kind = store.kinds[v];
    let c = byKind.get(kind);
    if (!c) byKind.set(kind, (c = { kind, label: KIND_NAMES[kind], values: 0, places: 0 }));
    c.values += 1;
    c.places += store.offsets[v + 1] - store.offsets[v];
  }
  return [...byKind.values()];
}

export interface HeldValueRow {
  /** The value's index in the store: pass it to materializeHeld. */
  index: number;
  kind: RedactKind;
  key: string;
  label: string;
  reason?: string;
  places: number;
  /** 0-based pages it is on, ascending. */
  pages: number[];
}

/**
 * `count` held values of `kind` from the `from`-th, for a list that shows them a page of rows at a
 * time; values whose index is in `skip` (already built into the review) are left out.
 */
export function heldValues(store: HeldStore, kind: RedactKind, from: number, count: number, skip?: ReadonlySet<number>): HeldValueRow[] {
  const rows: HeldValueRow[] = [];
  let seen = 0;
  for (let v = 0; v < store.keys.length && rows.length < count; v++) {
    if (store.kinds[v] !== kind || skip?.has(v)) continue;
    if (seen++ < from) continue;
    const pages = new Set<number>();
    for (let p = store.offsets[v]; p < store.offsets[v + 1]; p++) pages.add(store.data[p * 3]);
    rows.push({
      index: v,
      kind,
      key: store.keys[v],
      label: KIND_NAMES[kind],
      ...(store.reasons[v] ? { reason: store.reasons[v] } : {}),
      places: store.offsets[v + 1] - store.offsets[v],
      pages: [...pages].sort((a, b) => a - b),
    });
  }
  return rows;
}

/** The proposals of one held value (`index` from heldValues), built now: as proposalsForPage gives them. */
export function materializeHeld(store: HeldStore, index: number, pages: readonly PageTextModel[], measure: MeasureChar): Proposal[] {
  if (index < 0 || index >= store.keys.length) return [];
  const place: Place = { kind: store.kinds[index], key: store.keys[index], confidence: 'possible', reason: store.reasons[index], label: KIND_NAMES[store.kinds[index]] };
  const out: Proposal[] = [];
  for (let p = store.offsets[index]; p < store.offsets[index + 1]; p++) {
    const model = pages.find((m) => m.pageIndex === store.data[p * 3]) ?? pages[store.data[p * 3]];
    if (!model) continue;
    const built = textProposal(model, place, [[store.data[p * 3 + 1], store.data[p * 3 + 2]]], measure);
    if (built) out.push(built);
  }
  return out;
}

// ---- every occurrence ----------------------------------------------------------------------------------

interface ValueInfo {
  kind: RedactKind;
  key: string;
  place: Place;
  fromBox?: string;
  /** The value as one of its places gives it without an unreadable glyph (ruling R): what a place that holds one shows. */
  shown?: string;
}

/** The distinct values of `found` (kind and key), each with the best confidence of its places. */
function valuesOf(found: readonly Proposal[]): ValueInfo[] {
  const byKind = new Map<RedactKind, Map<string, ValueInfo>>();
  const order: ValueInfo[] = [];
  for (const p of found) {
    if (p.kind === 'drawn' || p.kind === 'marked' || p.key === '') continue;
    let byKey = byKind.get(p.kind);
    if (!byKey) byKind.set(p.kind, (byKey = new Map()));
    const known = byKey.get(p.key);
    if (!known) {
      const info: ValueInfo = { kind: p.kind, key: p.key, place: { kind: p.kind, key: p.key, confidence: p.confidence, reason: p.reason, label: p.label }, ...(p.fromBox ? { fromBox: p.fromBox } : {}) };
      if (p.value !== '' && !p.value.includes(UNREADABLE)) info.shown = p.value;
      byKey.set(p.key, info);
      order.push(info);
    } else {
      if (p.confidence === 'sure' && known.place.confidence !== 'sure') known.place = { ...known.place, confidence: 'sure', reason: undefined };
      if (known.shown === undefined && p.value !== '' && !p.value.includes(UNREADABLE)) known.shown = p.value;
    }
  }
  return order;
}

const annotationTextId = (a: number, t: number) => a * 10_000 + t;

/** Names, addresses, typed words and the same text: words, placed by THE loose rule (fix wave 2, ruling 4). */
const isWordKind = (kind: RedactKind) => kind === 'typed' || kind === 'same-text' || kind === 'name' || kind === 'address' || kind === 'addressee';
/** Every place of a value in a text: words by the loose rule (redactCheck.ts loosePlacesOf), codes and numbers by the find's own (placesOfValue). */
const placesOf = (text: string, kind: RedactKind, key: string) => (isWordKind(kind) ? wordPlaces(text, kind, key) : coveredPlacesOfValue(text, kind, key));
/** Words by the loose rule, and (ruling R) where the text holds unreadable glyphs that may stand for some of their letters. */
function wordPlaces(text: string, kind: RedactKind, form: string): { start: number; end: number }[] {
  if (cannotHoldWords(text, form)) return [];
  const loose = loosePlacesOf(text, kind, form);
  const wild = wildcardPlaces(text, form);
  return wild.length === 0 ? loose : [...loose, ...wild.filter((w) => !loose.some((l) => l.start === w.start && l.end === w.end))];
}
/** Anything but printable Latin text and its white space: a text with none of it needs no decomposing. */
const NOT_PLAIN = /[^\t\n\r -~]/;
/**
 * A cheap test that words in plain Latin letters and digits cannot be in a text by either rule (speed only; a page
 * is searched for every value): both rules need the words' letters and digits in order with nothing but other
 * characters between them, so without them all joined up in the text's own letters and digits (decomposed as the
 * loose rule reads them) there is no place. Says nothing (false) of other words, or of a text with unreadable glyphs.
 */
function cannotHoldWords(text: string, form: string): boolean {
  if (NOT_PLAIN.test(form) || text.includes(UNREADABLE)) return false;
  const wanted = form.replace(/[^A-Za-z0-9]+/g, '').toLowerCase();
  if (wanted === '') return false;
  const plain = NOT_PLAIN.test(text) ? text.normalize('NFKD') : text;
  return !plain.replace(/[^A-Za-z0-9]+/g, '').toLowerCase().includes(wanted);
}
/** What a place found by a value's words shows: the words as read, or (ruling R) the value itself when they hold an unreadable glyph. */
const shownAs = (text: string, value: ValueInfo) => (text.includes(UNREADABLE) ? value.shown ?? text.split(UNREADABLE).join('') : text);

/** The places already proposed, by page, kind and key: text ranges, and annotation texts (by annotationTextId). */
class PlaceIndex {
  private readonly pages = new Map<number, Map<RedactKind, Map<string, { ranges: [number, number][]; annotations: Set<number> }>>>();

  of(page: number, kind: RedactKind, key: string): { ranges: [number, number][]; annotations: Set<number> } {
    let byKind = this.pages.get(page);
    if (!byKind) this.pages.set(page, (byKind = new Map()));
    let byKey = byKind.get(kind);
    if (!byKey) byKind.set(kind, (byKey = new Map()));
    let entry = byKey.get(key);
    if (!entry) byKey.set(key, (entry = { ranges: [], annotations: new Set() }));
    return entry;
  }

  note(p: Proposal): void {
    const entry = this.of(p.page, p.kind, p.key);
    if (p.source === 'text') entry.ranges.push(...p.ranges);
    const annotation = /^a\d+-(\d+)-/.exec(p.id);
    if (annotation) entry.annotations.add(Number(annotation[1]));
  }
}

/**
 * `found` plus every other place of each of its values on every page (design 5.9 "Every occurrence"),
 * by the rule the check's strict pass shares (redactPatterns.ts placesOfValue: folded text, codes and
 * numbers with up to three separators between characters, inside longer runs too), in the page text
 * and, when `annotationsByPage` is given (indexed by page), in the comments, fields and links (one
 * place per annotation and value). An added place takes its value's kind, label, best confidence and
 * drawn box (fromBox). Places already in `found` are not repeated. Nothing here limits the count:
 * pass only the places to show and tick, not the held ones (findOnPage); the review limits ticked places.
 */
export function everyOccurrence(pages: readonly PageTextModel[], found: readonly Proposal[], measure: MeasureChar, annotationsByPage?: readonly (readonly AnnotationText[])[]): Proposal[] {
  const out = [...found];
  const ids = new Set(out.map((p) => p.id));
  const index = new PlaceIndex();
  for (const p of out) index.note(p);
  const push = (p: Proposal | null, fromBox?: string) => {
    if (!p || ids.has(p.id)) return;
    const placed = fromBox ? { ...p, fromBox } : p;
    ids.add(placed.id);
    out.push(placed);
    index.note(placed);
  };
  // Each page's readings (fix wave 3, Ruling C): made once per page and kept with it (pageReadings).
  const readingsOf = (model: PageTextModel) => pageReadings(model);
  for (const value of valuesOf(found)) {
    for (const model of pages) {
      // The places this value already has on this page, so an overlapping find is not added twice.
      const taken = index.of(model.pageIndex, value.kind, value.key);
      for (const { ranges, text } of placesInReadings(model, (t) => placesOf(t, value.kind, value.key), readingsOf(model))) {
        if (taken.ranges.some(([s, e]) => ranges.some(([rs, re]) => rs < e && s < re))) continue;
        push(textProposal(model, value.place, ranges, measure, shownAs(text, value)), value.fromBox);
      }
      const annotations = annotationsByPage?.[model.pageIndex] ?? [];
      annotations.forEach((annotation, a) => {
        if (annotation.subtype === 'Popup' || taken.annotations.has(a)) return;
        for (const [t, text] of annotation.texts.entries()) {
          const [r] = placesOf(text, value.kind, value.key);
          if (!r) continue;
          push(annotationProposal(model, value.place, annotation, a, t, r.start, r.end, text.slice(r.start, r.end)), value.fromBox);
          break;
        }
      });
    }
    // A place that runs on from the foot of one page to the top of the next (fix wave 3, Ruling C: a name
    // hyphenated at the end of a column that continues overleaf): each page's piece is a place of its own.
    const ordered = [...pages].sort((a, b) => a.pageIndex - b.pageIndex);
    for (let k = 0; k + 1 < ordered.length; k++) {
      const [prev, next] = [ordered[k], ordered[k + 1]];
      if (next.pageIndex !== prev.pageIndex + 1) continue;
      for (const seam of pageSeamPlaces(prev, next, (t) => placesOf(t, value.kind, value.key))) {
        for (const [model, ranges] of [[prev, seam.prev], [next, seam.next]] as const) {
          const taken = index.of(model.pageIndex, value.kind, value.key);
          if (taken.ranges.some(([s, e]) => ranges.some(([rs, re]) => rs < e && s < re))) continue;
          push(textProposal(model, value.place, ranges, measure, shownAs(seam.text, value)), value.fromBox);
        }
      }
    }
  }
  // A cell offered from under its column heading (K5) is as sure as its value is elsewhere.
  const sure = new Set(out.filter((p) => p.confidence === 'sure').map((p) => `${p.kind}:${p.key}`));
  return out.map((p) => {
    if (p.reason !== UNDER_HEADING || !sure.has(`${p.kind}:${p.key}`)) return p;
    const upgraded: Proposal = { ...p, confidence: 'sure' };
    delete upgraded.reason;
    return upgraded;
  });
}

/**
 * Fix wave 5, ruling Q: the typed words that run on from the foot of `prev` to the top of `next` (the page after
 * it), as sure typed places, one for each page's piece (pageSeamPlaces: every way the turn is read). For the run to
 * call for each pair of consecutive pages beside findOnPage: a typed value that stands nowhere whole (a narration
 * broken by the page end, its only mention) has no place for everyOccurrence to start from, and would be found by
 * nothing. A piece that a place of the term on its own page already covers is not given, and a value everyOccurrence
 * also finds across the turn is one place (the same id).
 */
export function typedAcrossTurn(prev: PageTextModel, next: PageTextModel, terms: readonly Term[], measure: MeasureChar): Proposal[] {
  if (next.pageIndex !== prev.pageIndex + 1 || prev.text === '' || next.text === '') return [];
  const out: Proposal[] = [];
  for (const term of usableTerms(terms)) {
    const place: Place = { kind: 'typed', key: term.key, confidence: 'sure', label: term.label };
    const shown = term.text.trim().replace(/\s+/g, ' ');
    const find = (text: string) => wordPlaces(text, 'typed', term.text);
    const taken: [PageTextModel, [number, number]][] = [];
    // A piece the term's own places on that page already cover is no new place (looked up only when the turn gives one).
    const known = new Set<PageTextModel>();
    for (const seam of pageSeamPlaces(prev, next, find)) {
      for (const [model, ranges] of [[prev, seam.prev], [next, seam.next]] as const) {
        if (!known.has(model)) {
          known.add(model);
          for (const own of placesInReadings(model, find)) for (const range of own.ranges) taken.push([model, range]);
        }
        if (taken.some(([m, [s, e]]) => m === model && ranges.some(([rs, re]) => rs < e && s < re))) continue;
        const p = textProposal(model, place, ranges, measure, seam.text.includes(UNREADABLE) ? shown : seam.text);
        if (!p) continue;
        for (const range of ranges) taken.push([model, range]);
        out.push(p);
      }
    }
  }
  return out;
}

/**
 * The places of the word under a drawn box (tokenUnderBox), on every page, as kind 'same-text', ticked,
 * each marked with the box (`fromBox`): made only when the user chooses "Redact this text everywhere"
 * on that box, and removed with the box (fix round 1, F5, lead ruling).
 */
export function sameTextProposals(pages: readonly PageTextModel[], token: string, boxId: string, measure: MeasureChar, annotationsByPage?: readonly (readonly AnnotationText[])[]): Proposal[] {
  const key = wordsKey(token);
  if (key === '') return [];
  // A seed that is not itself a place: everyOccurrence searches for it everywhere.
  const seed: Proposal = { id: 'seed', kind: 'same-text', key, value: '', page: -1, rects: [], confidence: 'sure', source: 'text', outsideView: false, ranges: [], label: KIND_NAMES['same-text'], fromBox: boxId };
  return everyOccurrence(pages, [seed], measure, annotationsByPage).filter((p) => p.page >= 0);
}

/** Proposals grouped by value (kind and key), each group's places and the groups in page order. */
export function groupByValue(proposals: readonly Proposal[]): ValueGroup[] {
  const sorted = [...proposals].sort((a, b) => a.page - b.page || Number(a.source !== 'text') - Number(b.source !== 'text') || (a.ranges[0]?.[0] ?? 0) - (b.ranges[0]?.[0] ?? 0));
  const byKind = new Map<RedactKind, Map<string, ValueGroup>>();
  const groups: ValueGroup[] = [];
  for (const p of sorted) {
    let byKey = byKind.get(p.kind);
    if (!byKey) byKind.set(p.kind, (byKey = new Map()));
    let group = byKey.get(p.key);
    if (!group) {
      group = { key: p.key, kind: p.kind, places: [] };
      byKey.set(p.key, group);
      groups.push(group);
    }
    group.places.push(p);
  }
  return groups;
}

/**
 * Leaves out each automatic box covering more than AUTO_BOX_MAX_SHARE of its page; `dropped` counts
 * them. A text place with such a box is dropped. A comment's, field's or link's place keeps its place
 * without the box (hidden: its page is rebuilt and the annotation leaves with it, as before fix wave B3
 * boxed shown annotations), so a value in a note on a rectangle drawn around the page is still removed;
 * it is marked `pageSized`, because the page does show it (fix wave round 2).
 * A place that gets no box (hidden) is never dropped: it draws nothing.
 */
export function dropPageSizedBoxes(proposals: readonly Proposal[], pageArea: (page: number) => number): { kept: Proposal[]; dropped: number } {
  const kept: Proposal[] = [];
  let dropped = 0;
  for (const p of proposals) {
    const area = pageArea(p.page);
    if (!p.hidden && area > 0 && p.rects.some((r) => (r.x1 - r.x0) * (r.y1 - r.y0) > AUTO_BOX_MAX_SHARE * area)) {
      dropped++;
      if (p.source !== 'text') kept.push({ ...p, hidden: true, pageSized: true });
    } else kept.push(p);
  }
  return { kept, dropped };
}

/**
 * The text under a drawn box, when it can be redacted everywhere (fix round 1, F5, lead ruling): the one
 * whole word the box touches, its leading and trailing punctuation trimmed, when it is value-like (no
 * white space; at least 4 characters with a digit, or at least 6 characters). null when the box touches
 * no word, more than one word, or a word that is not value-like: a drawn box then removes its area only.
 */
export function tokenUnderBox(model: PageTextModel, box: Rect, measure: MeasureChar): string | null {
  const touched: string[] = [];
  for (const range of wordRanges(model)) {
    if (!intersects(wordRect(model, range, measure), box)) continue;
    touched.push(model.text.slice(range[0], range[1]));
    if (touched.length > 1) return null;
  }
  if (touched.length !== 1) return null;
  const word = touched[0].replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
  const length = Array.from(word).length;
  return /\s/.test(word) || !((length >= 4 && /\p{N}/u.test(word)) || length >= 6) ? null : word;
}
