// Redact (design 5.9 "The list and the review", "Every occurrence", the confirmation step): the
// review list's state as a pure reducer with undo and redo. No React, no storage, no logging.
//
// Pages are 0-based page indices everywhere here (add 1 to show them). Rects are PDF user space, as in
// pageText.ts.
//
// Confidentiality: proposals, keys, values and terms live in this state, in memory, for the dialog only.
// Nothing here formats a value or key into a string; confirmSummary returns keys as data for the
// dialog's own warning ("… stays visible in 1 place you unticked").
import type { Rect } from '@/lib/pdf-tools/pageText';
import { heldSummary, heldValues, MAX_PLACES, NO_HELD, tooManyPlaces, type HeldKindCount, type HeldStore, type HeldValueRow, type Proposal } from '@/lib/pdf-tools/redactFind';
import { checkForms, clearRedactCaches, KIND_GROUP, neverTickedByDefault, PROFILES, termError, TERM_LIMITS, wordsKey, type FoundKind, type RedactGroup, type RedactKind, type Term } from '@/lib/pdf-tools/redactPatterns';
import type { PdfToolsError } from '@/lib/pdf-tools/types';

export type ReviewProfile = 'balanced' | 'strict' | 'identity' | 'dpdp';

export interface DrawnBox {
  id: string;
  /** 0-based page index. */
  page: number;
  /** User space, as pageText.ts's Rect. */
  rect: Rect;
  /**
   * Direction of a replacement drawn in this box, degrees counter-clockwise from user-space +x: the
   * page's /Rotate, so the text runs along the page as displayed (design 5.9). Set by the dialog; 0 when absent.
   */
  angle?: number;
  /**
   * The user chose "Redact this text everywhere" on this box (fix round 1, F5, lead ruling): its
   * same-text places (Proposal.fromBox = this id) are in the review and go with the box. A box alone
   * redacts its area only.
   */
  everywhere?: boolean;
}

/** What one undo step restores. */
export interface ReviewSnapshot {
  profile: ReviewProfile;
  groups: ReadonlySet<RedactGroup>;
  terms: readonly Term[];
  proposals: readonly Proposal[];
  ticked: Readonly<Record<string, boolean>>;
  drawn: readonly DrawnBox[];
  promoted: ReadonlySet<number>;
}

export interface ReviewState {
  profile: ReviewProfile;
  /** The groups whose tick box is on. */
  groups: ReadonlySet<RedactGroup>;
  terms: readonly Term[];
  proposals: readonly Proposal[];
  /** By proposal id. */
  ticked: Readonly<Record<string, boolean>>;
  drawn: readonly DrawnBox[];
  filter: string;
  showUnticked: boolean;
  /** A proposal id or a drawn box id. */
  selected: string | null;
  past: readonly ReviewSnapshot[];
  future: readonly ReviewSnapshot[];
  /**
   * Possibles no profile ticks, held compactly by the find (redactFind.ts holdPlaces; fix round 1, F4):
   * shown grouped by kind with counts (heldGroups, heldRows), never limited, built into proposals only
   * when the user ticks a value of them ('promote').
   */
  held: HeldStore;
  /** Indices of held values already built into `proposals`. */
  promoted: ReadonlySet<number>;
}

export type ReviewAction =
  | { type: 'loaded'; proposals: Proposal[]; held?: HeldStore }
  | { type: 'profile'; profile: ReviewState['profile'] }
  | { type: 'tick'; ids: string[]; on: boolean }
  | { type: 'tick-all'; on: boolean }
  | { type: 'tick-group'; group: RedactGroup; on: boolean }
  | { type: 'draw'; box: DrawnBox }
  | { type: 'delete-drawn'; ids: string[] }
  | { type: 'clear-page'; page: number }
  | { type: 'clear-drawn' }
  | { type: 'add-term'; term: Term }
  | { type: 'remove-term'; text: string }
  | { type: 'filter'; text: string }
  | { type: 'show-unticked'; on: boolean }
  | { type: 'select'; id: string | null }
  | { type: 'undo' }
  | { type: 'redo' }
  /**
   * "Redact this text everywhere" on a drawn box, offered only when tokenUnderBox gives a word: on adds
   * `proposals` (sameTextProposals for that box), ticked; off removes them. An undo step.
   */
  | { type: 'box-everywhere'; id: string; on: boolean; proposals?: Proposal[] }
  /** The user ticks (or opens) a held value: its places, built by materializeHeld (and everyOccurrence), join the review. An undo step. */
  | { type: 'promote'; index: number; proposals: Proposal[]; on: boolean };

export const REVIEW_HISTORY = 100;
/** localStorage key of the last profile used: the profile name only, never a value, term or file. */
export const PROFILE_STORAGE_KEY = 'pdfTools.redact.profile';
/** A drawn box smaller than this (pt) on either side is ignored. */
export const MIN_DRAWN_PT = 2;

const PROFILE_NAMES: readonly ReviewProfile[] = ['balanced', 'strict', 'identity', 'dpdp'];

/** The stored profile when it is one of the three names; otherwise Balanced. */
export function profileFrom(stored: unknown): ReviewProfile {
  return PROFILE_NAMES.find((p) => p === stored) ?? 'balanced';
}

/**
 * Call when the Redact dialog closes (fix round 2, MF3): drops every page text the find's modules
 * still hold (redactPatterns.ts clearRedactCaches; they also drop them by themselves when the searching
 * task ends). The review state itself goes with the dialog's React state; nothing of it is kept here.
 */
export function disposeReview(): void {
  clearRedactCaches();
}

export function initialReview(profile: ReviewState['profile']): ReviewState {
  return {
    profile,
    groups: new Set(PROFILES[profile].ticked),
    terms: [],
    proposals: [],
    ticked: {},
    drawn: [],
    filter: '',
    showUnticked: true,
    selected: null,
    past: [],
    future: [],
    held: NO_HELD,
    promoted: new Set(),
  };
}

// ---- values: a kind and a key, kept apart without joining them into a string ----------------------------

class ValueMap<T> {
  private readonly byKind = new Map<RedactKind, Map<string, T>>();

  get(kind: RedactKind, key: string): T | undefined {
    return this.byKind.get(kind)?.get(key);
  }

  set(kind: RedactKind, key: string, value: T): void {
    let byKey = this.byKind.get(kind);
    if (!byKey) this.byKind.set(kind, (byKey = new Map()));
    byKey.set(key, value);
  }
}

/** Typed terms, text under drawn boxes and the file's own marks are always ticked: the user asked for them. */
const alwaysTicked = (kind: RedactKind) => kind === 'typed' || kind === 'same-text' || kind === 'marked' || kind === 'drawn';
const groupOf = (kind: RedactKind): RedactGroup | null => (alwaysTicked(kind) ? null : KIND_GROUP[kind as FoundKind]);

/** For each value: 2 when some place of it is sure, 1 when some possible place of it is one Strict ticks, else 0. */
function valueStrength(proposals: readonly Proposal[]): ValueMap<number> {
  const strength = new ValueMap<number>();
  for (const p of proposals) {
    const s = p.confidence === 'sure' ? 2 : neverTickedByDefault(p.kind, p.confidence, p.reason) ? 0 : 1;
    strength.set(p.kind, p.key, Math.max(strength.get(p.kind, p.key) ?? 0, s));
  }
  return strength;
}

/**
 * The default tick of a place: always for typed terms, the same text and marks; otherwise its group
 * ticked and its value sure somewhere, or, in Strict, a possible value of a kind Strict ticks (not
 * TAN-like or IFSC-like codes, accounts that only sit next to an IFSC, or unlabelled Aadhaar-like numbers).
 */
function defaultTick(p: Proposal, groups: ReadonlySet<RedactGroup>, profile: ReviewProfile, strength: ValueMap<number>): boolean {
  const group = groupOf(p.kind);
  if (group === null) return true;
  const s = strength.get(p.kind, p.key) ?? 0;
  return groups.has(group) && (s === 2 || (PROFILES[profile].tickPossible && s === 1));
}

function defaultTicks(proposals: readonly Proposal[], groups: ReadonlySet<RedactGroup>, profile: ReviewProfile): Record<string, boolean> {
  const strength = valueStrength(proposals);
  const ticked: Record<string, boolean> = {};
  for (const p of proposals) ticked[p.id] = defaultTick(p, groups, profile, strength);
  return ticked;
}

/** Same-text places stay only while their box exists and is chosen "everywhere" (fix round 1, F5). */
function withLiveSameText(proposals: readonly Proposal[], drawn: readonly DrawnBox[]): Proposal[] {
  const live = new Set(drawn.filter((d) => d.everywhere).map((d) => d.id));
  return proposals.filter((p) => p.kind !== 'same-text' || (p.fromBox !== undefined && live.has(p.fromBox)));
}

/** The ticks of `proposals` only. */
function ticksOf(proposals: readonly Proposal[], ticked: Readonly<Record<string, boolean>>): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const p of proposals) if (p.id in ticked) out[p.id] = ticked[p.id];
  return out;
}

// The ids of a proposals array, made once per array (a tick of one place on 10,000 must not rebuild them).
const idSets = new WeakMap<readonly Proposal[], Set<string>>();
function idsOf(proposals: readonly Proposal[]): Set<string> {
  let ids = idSets.get(proposals);
  if (!ids) idSets.set(proposals, (ids = new Set(proposals.map((p) => p.id))));
  return ids;
}

// ---- history ------------------------------------------------------------------------------------------------

const snapshotOf = (s: ReviewState): ReviewSnapshot => ({ profile: s.profile, groups: s.groups, terms: s.terms, proposals: s.proposals, ticked: s.ticked, drawn: s.drawn, promoted: s.promoted });

/** A change the user can undo: the state before it goes on the history, the redo steps go. */
function change(state: ReviewState, next: Partial<ReviewSnapshot>): ReviewState {
  const past = [...state.past, snapshotOf(state)];
  return { ...state, ...next, past: past.length > REVIEW_HISTORY ? past.slice(past.length - REVIEW_HISTORY) : past, future: [] };
}

function exists(s: Pick<ReviewState, 'proposals' | 'drawn'>, id: string | null): boolean {
  return id !== null && (s.proposals.some((p) => p.id === id) || s.drawn.some((d) => d.id === id));
}

function restore(state: ReviewState, snapshot: ReviewSnapshot, past: readonly ReviewSnapshot[], future: readonly ReviewSnapshot[]): ReviewState {
  const next = { ...state, ...snapshot, past, future };
  return { ...next, selected: exists(next, state.selected) ? state.selected : null };
}

function setTicks(state: ReviewState, ids: readonly string[], on: boolean): ReviewState {
  const known = idsOf(state.proposals);
  const ticked = { ...state.ticked };
  let changed = false;
  for (const id of ids) {
    if (!known.has(id) || ticked[id] === on) continue;
    ticked[id] = on;
    changed = true;
  }
  return changed ? change(state, { ticked }) : state;
}

const normalised = (r: Rect): Rect => ({ x0: Math.min(r.x0, r.x1), y0: Math.min(r.y0, r.y1), x1: Math.max(r.x0, r.x1), y1: Math.max(r.y0, r.y1) });

export function reviewReducer(state: ReviewState, action: ReviewAction): ReviewState {
  switch (action.type) {
    case 'loaded': {
      // A new find of the same file (after a term): places found again keep their tick; a new place
      // takes its value's tick when the value had places before (ticked if any was), else the default.
      // Same-text places of a box that is gone or not chosen "everywhere" are dropped. A new held store
      // replaces the old one. Not an undo step.
      const proposals = withLiveSameText(action.proposals, state.drawn);
      const before = new ValueMap<boolean>();
      for (const p of state.proposals) before.set(p.kind, p.key, before.get(p.kind, p.key) === true || state.ticked[p.id] === true);
      const strength = valueStrength(proposals);
      const known = idsOf(state.proposals);
      const ticked: Record<string, boolean> = {};
      for (const p of proposals) {
        const kept = state.ticked[p.id];
        const valueTick = before.get(p.kind, p.key);
        ticked[p.id] = kept !== undefined && known.has(p.id) ? kept : alwaysTicked(p.kind) ? true : valueTick !== undefined ? valueTick : defaultTick(p, state.groups, state.profile, strength);
      }
      // A held value that is already in the review (sure on another page, say) is not listed as held.
      const inReview = new ValueMap<boolean>();
      for (const p of proposals) inReview.set(p.kind, p.key, true);
      const held = action.held
        ? { held: action.held, promoted: new Set(action.held.keys.map((_, v) => v).filter((v) => inReview.get(action.held!.kinds[v], action.held!.keys[v]))) }
        : {};
      const next = { ...state, proposals, ticked, ...held };
      return { ...next, selected: exists(next, state.selected) ? state.selected : null };
    }
    case 'profile': {
      if (!PROFILE_NAMES.includes(action.profile)) return state;
      const groups = new Set(PROFILES[action.profile].ticked);
      return change(state, { profile: action.profile, groups, ticked: defaultTicks(state.proposals, groups, action.profile) });
    }
    case 'tick':
      return setTicks(state, action.ids, action.on);
    case 'tick-all':
      return setTicks(
        state,
        state.proposals.map((p) => p.id),
        action.on,
      );
    case 'tick-group': {
      // On: the user asked for this group, so its sure and its possible values are ticked whatever the
      // profile (T-052, owner, 16 November 2026), except the kinds no profile ticks; every other tick stays
      // as it is. Off: untick every place of the group (fix round 1, F7).
      const groups = new Set(state.groups);
      if (action.on) groups.add(action.group);
      else groups.delete(action.group);
      const strength = valueStrength(state.proposals);
      const ticked = { ...state.ticked };
      for (const p of state.proposals) {
        if (groupOf(p.kind) !== action.group) continue;
        if (!action.on) ticked[p.id] = false;
        else if ((strength.get(p.kind, p.key) ?? 0) >= 1) ticked[p.id] = true;
      }
      return change(state, { groups, ticked });
    }
    case 'draw': {
      const rect = normalised(action.box.rect);
      if (!(rect.x1 - rect.x0 >= MIN_DRAWN_PT && rect.y1 - rect.y0 >= MIN_DRAWN_PT) || exists(state, action.box.id)) return state;
      const next = change(state, { drawn: [...state.drawn, { ...action.box, rect, everywhere: false }] });
      return { ...next, selected: action.box.id };
    }
    case 'delete-drawn':
    case 'clear-page':
    case 'clear-drawn': {
      const gone =
        action.type === 'delete-drawn' ? (d: DrawnBox) => action.ids.includes(d.id) : action.type === 'clear-page' ? (d: DrawnBox) => d.page === action.page : () => true;
      const drawn = state.drawn.filter((d) => !gone(d));
      if (drawn.length === state.drawn.length) return state;
      // The same-text places a removed box made go with it.
      const proposals = withLiveSameText(state.proposals, drawn);
      const next = change(state, { drawn, proposals, ticked: ticksOf(proposals, state.ticked) });
      return { ...next, selected: exists(next, state.selected) ? state.selected : null };
    }
    case 'box-everywhere': {
      const box = state.drawn.find((d) => d.id === action.id);
      if (!box || (box.everywhere === true) === action.on) return state;
      const drawn = state.drawn.map((d) => (d.id === action.id ? { ...d, everywhere: action.on } : d));
      const known = idsOf(state.proposals);
      const added = action.on ? (action.proposals ?? []).filter((p) => p.kind === 'same-text' && p.fromBox === action.id && !known.has(p.id)) : [];
      const proposals = withLiveSameText([...state.proposals, ...added], drawn);
      const ticked = ticksOf(proposals, state.ticked);
      for (const p of added) ticked[p.id] = true;
      const next = change(state, { drawn, proposals, ticked });
      return { ...next, selected: exists(next, state.selected) ? state.selected : null };
    }
    case 'promote': {
      if (action.index < 0 || action.index >= state.held.keys.length || state.promoted.has(action.index)) return state;
      const known = idsOf(state.proposals);
      const added = action.proposals.filter((p) => !known.has(p.id));
      const ticked = { ...state.ticked };
      for (const p of added) ticked[p.id] = action.on;
      return change(state, { proposals: [...state.proposals, ...added], ticked, promoted: new Set([...state.promoted, action.index]) });
    }
    case 'add-term': {
      const text = action.term.text.trim().replace(/\s+/g, ' ');
      if (termError(text) !== null || state.terms.length >= TERM_LIMITS.count) return state;
      const key = wordsKey(text);
      if (state.terms.some((t) => wordsKey(t.text) === key)) return state;
      return change(state, { terms: [...state.terms, { text, reason: action.term.reason.trim() || 'Typed' }] });
    }
    case 'remove-term': {
      const key = wordsKey(action.text);
      const terms = state.terms.filter((t) => wordsKey(t.text) !== key);
      if (terms.length === state.terms.length) return state;
      const proposals = state.proposals.filter((p) => !(p.kind === 'typed' && p.key === key));
      const ticked: Record<string, boolean> = {};
      for (const p of proposals) if (p.id in state.ticked) ticked[p.id] = state.ticked[p.id];
      const next = change(state, { terms, proposals, ticked });
      return { ...next, selected: exists(next, state.selected) ? state.selected : null };
    }
    case 'filter':
      return action.text === state.filter ? state : { ...state, filter: action.text };
    case 'show-unticked':
      return action.on === state.showUnticked ? state : { ...state, showUnticked: action.on };
    case 'select':
      return action.id === state.selected ? state : { ...state, selected: action.id };
    case 'undo': {
      if (state.past.length === 0) return state;
      const snapshot = state.past[state.past.length - 1];
      return restore(state, snapshot, state.past.slice(0, -1), [snapshotOf(state), ...state.future].slice(0, REVIEW_HISTORY));
    }
    case 'redo': {
      if (state.future.length === 0) return state;
      const [snapshot, ...rest] = state.future;
      return restore(state, snapshot, [...state.past, snapshotOf(state)].slice(-REVIEW_HISTORY), rest);
    }
    default:
      return state;
  }
}

// ---- what the list shows -------------------------------------------------------------------------------------

/**
 * The rows the list shows: places and drawn boxes matching the filter (kind label, value, or page number
 * as shown, ignoring case) and, unless "Show unticked" is on, only ticked places.
 */
export function shownPlaces(state: ReviewState): { places: Proposal[]; drawn: DrawnBox[] } {
  const filter = state.filter.trim().toLowerCase();
  const pageMatches = (page: number) => /^\d+$/.test(filter) && Number(filter) === page + 1;
  const places = state.proposals.filter((p) => {
    if (!state.showUnticked && !state.ticked[p.id]) return false;
    if (filter === '') return true;
    return p.label.toLowerCase().includes(filter) || p.value.toLowerCase().includes(filter) || pageMatches(p.page);
  });
  const drawn = state.drawn.filter((d) => filter === '' || 'drawn'.includes(filter) || pageMatches(d.page));
  return { places, drawn };
}

/** The held possibles not yet built into the review, grouped by kind with counts (fix round 1, F4). */
export function heldGroups(state: ReviewState): HeldKindCount[] {
  const groups = heldSummary(state.held).map((g) => ({ ...g }));
  for (const v of state.promoted) {
    const g = groups.find((x) => x.kind === state.held.kinds[v]);
    if (!g) continue;
    g.values -= 1;
    g.places -= state.held.offsets[v + 1] - state.held.offsets[v];
  }
  return groups.filter((g) => g.values > 0);
}

/** `count` held values of `kind` from the `from`-th, leaving out those already in the review: the list's rows, a page at a time. */
export function heldRows(state: ReviewState, kind: RedactKind, from: number, count: number): HeldValueRow[] {
  return heldValues(state.held, kind, from, count, state.promoted);
}

/** How many places are ticked: what the limit of MAX_PLACES counts (drawn boxes and held places are not places ticked). */
export function tickedCount(state: ReviewState): number {
  let n = 0;
  for (const p of state.proposals) if (state.ticked[p.id]) n++;
  return n;
}

/** The refusal to show and to stop the run with when more than MAX_PLACES places are ticked; null otherwise. */
export function limitError(state: ReviewState): PdfToolsError | null {
  const n = tickedCount(state);
  return n > MAX_PLACES ? tooManyPlaces(n) : null;
}

// ---- the confirmation and the run --------------------------------------------------------------------------

export interface ConfirmSummary {
  /** Ticked places plus drawn boxes. */
  areas: number;
  /** 0-based indices of the pages that will be rebuilt, ascending. */
  pages: number[];
  /** Values ticked in some places and left unticked (and uncovered) in others: they stay visible there. Keys are for the dialog's warning only. */
  leftVisible: { kind: RedactKind; key: string; pages: number[] }[];
  countsByKind: Partial<Record<RedactKind, number>>;
}

const inside = (a: Rect, b: Rect) => a.x0 >= b.x0 - 0.01 && a.y0 >= b.y0 - 0.01 && a.x1 <= b.x1 + 0.01 && a.y1 <= b.y1 + 0.01;

/**
 * The values ticked in some places and left visible in others (unticked, and not wholly under a
 * ticked box or a drawn box), in the order first met, with the pages where they stay visible.
 */
function leftVisibleValues(state: ReviewState): { list: ConfirmSummary['leftVisible']; visible: ValueMap<Set<number>> } {
  const ticked = state.proposals.filter((p) => state.ticked[p.id]);
  const boxesByPage = new Map<number, Rect[]>();
  const addBoxes = (page: number, rects: readonly Rect[]) => {
    const list = boxesByPage.get(page);
    if (list) list.push(...rects);
    else boxesByPage.set(page, [...rects]);
  };
  for (const q of ticked) addBoxes(q.page, q.rects);
  for (const d of state.drawn) addBoxes(d.page, [d.rect]);
  const covers = (p: Proposal) => {
    const boxes = boxesByPage.get(p.page) ?? [];
    return p.rects.length > 0 && p.rects.every((r) => boxes.some((b) => inside(r, b)));
  };
  const someTicked = new ValueMap<boolean>();
  for (const p of ticked) someTicked.set(p.kind, p.key, true);
  const visible = new ValueMap<Set<number>>();
  const list: ConfirmSummary['leftVisible'] = [];
  for (const p of state.proposals) {
    if (state.ticked[p.id] || p.kind === 'marked' || p.key === '' || !someTicked.get(p.kind, p.key) || covers(p)) continue;
    let pagesOf = visible.get(p.kind, p.key);
    if (!pagesOf) {
      pagesOf = new Set();
      visible.set(p.kind, p.key, pagesOf);
      list.push({ kind: p.kind, key: p.key, pages: [] });
    }
    pagesOf.add(p.page);
  }
  for (const entry of list) entry.pages = [...(visible.get(entry.kind, entry.key) ?? [])].sort((a, b) => a - b);
  return { list, visible };
}

/** The summary of the confirmation step. Keys stay in memory for the dialog only. */
export function confirmSummary(state: ReviewState): ConfirmSummary {
  const ticked = state.proposals.filter((p) => state.ticked[p.id]);
  // Wave 4, K3: places of one kind at the same spot (text made bold by printing it two or three times) are one area
  // to a person: counted once (to within 2 points).
  const spot = (p: Proposal) => `${p.page}|${p.kind}|${p.rects.map((r) => [r.x0, r.y0, r.x1, r.y1].map((v) => Math.round(v / 2)).join(',')).join(';')}`;
  const seen = new Set<string>();
  const shown = ticked.filter((p) => !seen.has(spot(p)) && Boolean(seen.add(spot(p))));
  const countsByKind: Partial<Record<RedactKind, number>> = {};
  for (const p of shown) countsByKind[p.kind] = (countsByKind[p.kind] ?? 0) + 1;
  if (state.drawn.length > 0) countsByKind.drawn = state.drawn.length;
  const pages = [...new Set([...ticked.map((p) => p.page), ...state.drawn.map((d) => d.page)])].sort((a, b) => a - b);
  return { areas: shown.length + state.drawn.length, pages, leftVisible: leftVisibleValues(state).list, countsByKind };
}

/** One redacted value for the check (the shape of redactCheck.ts's CheckTarget). Never logged; dropped with the dialog. */
export interface RedactTarget {
  kind: RedactKind;
  forms: readonly string[];
  wholeWord: boolean;
  /** Ruling R (wave 5): a typed word the find placed nowhere (its script's unreadable text is covered whole). */
  placedNowhere?: boolean;
}

/** Ruling R (wave 5): the indexes in `state.terms` of the typed words the find placed nowhere (named before the run). */
export function termsNotFound(state: Pick<ReviewState, 'terms' | 'proposals'>): number[] {
  const placed = new Set(state.proposals.filter((p) => p.kind === 'typed').map((p) => p.key));
  return state.terms.flatMap((t, i) => (placed.has(wordsKey(t.text)) ? [] : [i]));
}

/** Kinds compared as whole words ignoring case: the user's terms, text under boxes, names and addresses. */
const WHOLE_WORD_KINDS: ReadonlySet<RedactKind> = new Set<RedactKind>(['typed', 'same-text', 'name', 'address', 'addressee']);

/**
 * What the check must not find in the result: every value the user chose to redact everywhere (some
 * place ticked, none left visible), with the forms of checkForms for each place's written text. A
 * value left visible somewhere is not part of the guarantee (design 5.9) and is not looked for; drawn
 * boxes and the file's own marks have no text to look for (the words under a box are looked for as
 * 'same-text' places when the dialog adds them).
 */
export function checkTargets(state: ReviewState): RedactTarget[] {
  const { visible } = leftVisibleValues(state);
  const forms = new ValueMap<Set<string>>();
  const targets: { kind: RedactKind; key: string; nowhere?: true }[] = [];
  // Text under a drawn box is a target only through "Redact this text everywhere" on a box that still exists.
  const everywhere = new Set(state.drawn.filter((d) => d.everywhere).map((d) => d.id));
  for (const p of state.proposals) {
    if (!state.ticked[p.id] || p.kind === 'marked' || p.kind === 'drawn' || p.key === '' || visible.get(p.kind, p.key)) continue;
    if (p.kind === 'same-text' && !(p.fromBox !== undefined && everywhere.has(p.fromBox))) continue;
    if (!forms.get(p.kind, p.key)) {
      forms.set(p.kind, p.key, new Set());
      targets.push({ kind: p.kind, key: p.key });
    }
  }
  // Every place of a chosen value adds its written form, ticked or (covered and) unticked alike.
  for (const p of state.proposals) {
    const set = forms.get(p.kind, p.key);
    if (set) for (const form of checkForms(p.kind, p.key, p.value)) set.add(form);
  }
  // Wave 3b (T-052, RX-RUN on the lead's instruction): a phrase the user typed that the find placed nowhere (only in
  // a stamp, or read in an order the find does not follow) is still looked for in the result by every reading; seen
  // there, it is covered where it paints, or the run stops. A typed phrase with places, all unticked, stays out.
  for (const term of state.terms) {
    const key = wordsKey(term.text);
    if (key === '' || forms.get('typed', key) || state.proposals.some((p) => p.kind === 'typed' && p.key === key)) continue;
    forms.set('typed', key, new Set(checkForms('typed', key, term.text)));
    targets.push({ kind: 'typed', key, nowhere: true });
  }
  return targets.map((t) => ({ kind: t.kind, forms: [...(forms.get(t.kind, t.key) ?? [])], wholeWord: WHOLE_WORD_KINDS.has(t.kind), ...(t.nowhere ? { placedNowhere: true } : {}) }));
}

export interface RedactArea {
  /** 0-based page index. */
  page: number;
  /** User-space boxes to fill (see pageText.ts). */
  rects: Rect[];
  kind: RedactKind;
  key?: string;
  /** The area shows nothing on the page (hidden text): the page is rebuilt without drawing a box. */
  hidden: boolean;
  /** Direction of a replacement, degrees counter-clockwise from user-space +x. */
  angle: number;
  /** Ranges of the page text model's `text` that are redacted (their words leave the text layer). */
  ranges: [number, number][];
}

/**
 * What the run redacts: each ticked value's places on one page joined into one area (kept apart when
 * hidden or running another way), then each drawn box as its own area.
 */
export function areasToRedact(state: ReviewState): RedactArea[] {
  const areas: RedactArea[] = [];
  // Joined by page, kind, hidden and angle (numbers and flags), then by key, without joining the key into a string.
  const joined = new Map<string, Map<string, RedactArea>>();
  for (const p of state.proposals) {
    if (!state.ticked[p.id]) continue;
    const hidden = p.hidden === true;
    const angle = p.angle ?? 0;
    const slot = [p.page, p.kind, hidden ? 1 : 0, angle].join('|');
    let byKey = joined.get(slot);
    if (!byKey) joined.set(slot, (byKey = new Map()));
    const area = byKey.get(p.key);
    if (area) {
      area.rects.push(...p.rects);
      area.ranges.push(...p.ranges);
      continue;
    }
    const created: RedactArea = { page: p.page, rects: [...p.rects], kind: p.kind, ...(p.key !== '' ? { key: p.key } : {}), hidden, angle, ranges: [...p.ranges] };
    byKey.set(p.key, created);
    areas.push(created);
  }
  for (const d of state.drawn) areas.push({ page: d.page, rects: [d.rect], kind: 'drawn', hidden: false, angle: d.angle ?? 0, ranges: [] });
  return areas;
}
