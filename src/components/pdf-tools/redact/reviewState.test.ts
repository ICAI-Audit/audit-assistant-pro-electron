import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Rect } from '@/lib/pdf-tools/pageText';
import { holdPlaces, type HeldHit, type Proposal } from '@/lib/pdf-tools/redactFind';
import { cachedTextCount, findPatterns, placesOfValue, type RedactKind } from '@/lib/pdf-tools/redactPatterns';
import {
  areasToRedact,
  checkTargets,
  confirmSummary,
  disposeReview,
  heldGroups,
  heldRows,
  initialReview,
  limitError,
  tickedCount,
  PROFILE_STORAGE_KEY,
  profileFrom,
  REVIEW_HISTORY,
  reviewReducer,
  shownPlaces,
  termsNotFound,
  type ReviewAction,
  type ReviewState,
} from './reviewState';

const rect = (x: number, y: number, w = 60, h = 12): Rect => ({ x0: x, y0: y, x1: x + w, y1: y + h });
let serial = 0;
function place(kind: RedactKind, key: string, page: number, opts: Partial<Proposal> = {}): Proposal {
  serial += 1;
  const start = serial * 20;
  return {
    id: `t${page}-${start}-${start + 10}-${kind}`,
    kind,
    key,
    value: key,
    page,
    rects: [rect(50, 700 - serial * 14)],
    confidence: 'sure',
    source: 'text',
    outsideView: false,
    ranges: [[start, start + 10]],
    label: kind,
    angle: 0,
    ...opts,
  };
}

const run = (state: ReviewState, ...actions: ReviewAction[]) => actions.reduce(reviewReducer, state);
const tickedIds = (s: ReviewState) => s.proposals.filter((p) => s.ticked[p.id]).map((p) => p.id);

// One file's proposals: a PAN on pages 0, 1 and 3; a possible TAN; a mobile; an account; an IP; a name.
const PAN = 'BNZPM2501F';
function proposals() {
  serial = 0;
  return {
    pan0: place('pan', PAN, 0),
    pan1: place('pan', PAN, 1),
    pan3: place('pan', PAN, 3),
    tan: place('tan', 'BXWP32188Z', 0, { confidence: 'possible', reason: 'TAN-shaped code with no TAN label' }),
    mobile: place('mobile', '9845012345', 1),
    account: place('bank-account', '50100123456789', 2),
    ip: place('ip', '10.0.0.1', 2),
    name: place('name', 'state bank of india', 2, { confidence: 'possible' }),
    aadhaarPossible: place('aadhaar', '234567890124', 4, { confidence: 'possible' }),
    aadhaarSure: place('aadhaar', '234567890124', 5),
  };
}
const loaded = (profile: ReviewState['profile'] = 'balanced') => {
  const p = proposals();
  return { p, state: reviewReducer(initialReview(profile), { type: 'loaded', proposals: Object.values(p) }) };
};

describe('profiles', () => {
  it('Balanced ticks the sure matches of identity, contact and bank-tax only', () => {
    const { p, state } = loaded('balanced');
    expect(state.groups).toEqual(new Set(['identity', 'contact', 'bank-tax']));
    expect(tickedIds(state).sort()).toEqual([p.pan0, p.pan1, p.pan3, p.mobile, p.account, p.aadhaarPossible, p.aadhaarSure].map((x) => x.id).sort());
    // The possible Aadhaar place is ticked because its value is sure elsewhere: a value's places share a tick.
    expect(state.ticked[p.tan.id]).toBe(false);
    expect(state.ticked[p.ip.id]).toBe(false);
    expect(state.ticked[p.name.id]).toBe(false);
  });

  it('Strict ticks every group and the possible matches too, except the kinds no profile ticks (fix round 1)', () => {
    const { p, state } = loaded('strict');
    expect(tickedIds(state)).toHaveLength(9);
    // a TAN-shaped code with no label stays unticked: part and batch codes look the same
    expect(state.ticked[p.tan.id]).toBe(false);
    expect(state.ticked[p.name.id]).toBe(true);
    serial = 100;
    const others = [
      place('ifsc', 'HDFC0001234', 0, { confidence: 'possible', reason: 'a bank branch code with no account number or label' }),
      place('bank-account', '123456789012', 0, { confidence: 'possible', reason: 'a number next to an IFSC, with no account label' }),
      place('aadhaar', '345678901234', 0, { confidence: 'possible', reason: 'twelve digits with no Aadhaar label nearby' }),
      place('aadhaar', '345678901230', 0, { confidence: 'possible', reason: 'check digit does not match' }),
      place('mobile', '9845012399', 0, { confidence: 'possible', reason: 'no mobile prefix or label nearby' }),
    ];
    const s = reviewReducer(initialReview('strict'), { type: 'loaded', proposals: others });
    expect(others.map((x) => s.ticked[x.id])).toEqual([false, false, false, true, true]);
  });

  it('Identity numbers only ticks that group, and a change of profile recomputes the ticks', () => {
    const { p, state } = loaded('identity');
    expect(tickedIds(state).sort()).toEqual([p.pan0, p.pan1, p.pan3, p.aadhaarPossible, p.aadhaarSure].map((x) => x.id).sort());
    const strict = reviewReducer(state, { type: 'profile', profile: 'strict' });
    expect(tickedIds(strict)).toHaveLength(9);
    expect(reviewReducer(strict, { type: 'undo' }).profile).toBe('identity');
  });

  it('keeps the remembered profile to a known name', () => {
    expect(PROFILE_STORAGE_KEY).toBe('pdfTools.redact.profile');
    expect(profileFrom('strict')).toBe('strict');
    expect(profileFrom('BNZPM2501F')).toBe('balanced');
    expect(profileFrom(null)).toBe('balanced');
  });
});

describe('ticking', () => {
  it('ticks every place of the values of a group, and unticks them all', () => {
    const { p, state } = loaded('balanced');
    const off = reviewReducer(state, { type: 'tick-group', group: 'identity', on: false });
    expect([p.pan0, p.pan1, p.pan3, p.tan, p.aadhaarSure].some((x) => off.ticked[x.id])).toBe(false);
    expect(off.groups.has('identity')).toBe(false);
    const on = reviewReducer(off, { type: 'tick-group', group: 'identity', on: true });
    expect([p.pan0, p.pan1, p.pan3, p.aadhaarPossible, p.aadhaarSure].every((x) => on.ticked[x.id])).toBe(true);
    expect(on.ticked[p.tan.id]).toBe(false);
    const network = reviewReducer(state, { type: 'tick-group', group: 'network', on: true });
    expect(network.ticked[p.ip.id]).toBe(true);
  });

  it('a group ticked by hand ticks its possible matches too, whatever the profile, but never the kinds no profile ticks (T-048, owner, 16 November 2026)', () => {
    const { p, state } = loaded('balanced');
    expect(state.ticked[p.name.id]).toBe(false);
    const names = reviewReducer(state, { type: 'tick-group', group: 'names', on: true });
    expect(names.ticked[p.name.id]).toBe(true);
    expect(reviewReducer(names, { type: 'undo' }).ticked[p.name.id]).toBe(false);
    // a TAN-shaped code with no label stays unticked, as it does in Strict
    const identity = run(state, { type: 'tick-group', group: 'identity', on: false }, { type: 'tick-group', group: 'identity', on: true });
    expect(identity.ticked[p.tan.id]).toBe(false);
    // the profile's own starting ticks do not change: Balanced still opens with the name unticked
    expect(loaded('balanced').state.ticked[p.name.id]).toBe(false);
  });

  it('keeps what the user ticked by hand when a group is ticked: on adds the default ticks, off removes all (fix round 1, F7)', () => {
    const { p, state } = loaded('balanced');
    const byHand = reviewReducer(state, { type: 'tick', ids: [p.tan.id], on: true });
    // ticking the group again (it is already on) adds its default ticks and takes none away
    const again = reviewReducer(byHand, { type: 'tick-group', group: 'identity', on: true });
    expect(again.ticked[p.tan.id]).toBe(true);
    expect([p.pan0, p.pan1, p.pan3].every((x) => again.ticked[x.id])).toBe(true);
    // unticking the group unticks every place in it, hand-ticked ones too: that is what the user asked
    expect(reviewReducer(again, { type: 'tick-group', group: 'identity', on: false }).ticked[p.tan.id]).toBe(false);
  });

  it('names a value that stays visible where one of its places was unticked', () => {
    const { p, state } = loaded('balanced');
    const s = reviewReducer(state, { type: 'tick', ids: [p.pan3.id], on: false });
    expect(confirmSummary(s).leftVisible).toEqual([{ kind: 'pan', key: PAN, pages: [3] }]);
    // A value unticked everywhere was not chosen for redaction: it is not "left visible".
    const none = reviewReducer(state, { type: 'tick', ids: [p.pan0.id, p.pan1.id, p.pan3.id], on: false });
    expect(confirmSummary(none).leftVisible).toEqual([]);
  });

  it('does not call a place visible when a ticked box covers it', () => {
    const { p, state } = loaded('balanced');
    const typed = place('typed', 'bnzpm2501f', 3, { id: 'typed-cover', rects: p.pan3.rects, ranges: p.pan3.ranges });
    const s = run(state, { type: 'loaded', proposals: [...state.proposals, typed] }, { type: 'tick', ids: [p.pan3.id], on: false });
    expect(s.ticked['typed-cover']).toBe(true);
    expect(confirmSummary(s).leftVisible).toEqual([]);
    const drawnOver = run(state, { type: 'tick', ids: [p.pan3.id], on: false }, { type: 'draw', box: { id: 'd1', page: 3, rect: { x0: 0, y0: 0, x1: 600, y1: 800 } } });
    expect(confirmSummary(drawnOver).leftVisible).toEqual([]);
  });

  it('keeps the ticks of places found again, and gives a new place its value\'s tick', () => {
    const { p, state } = loaded('balanced');
    const s = reviewReducer(state, { type: 'tick', ids: [p.pan0.id, p.pan1.id, p.pan3.id, p.mobile.id], on: false });
    const newPan = place('pan', PAN, 6);
    const typed = place('typed', 'assessee', 6);
    const again = reviewReducer(s, { type: 'loaded', proposals: [...s.proposals, newPan, typed] });
    expect(again.ticked[p.mobile.id]).toBe(false);
    expect(again.ticked[newPan.id]).toBe(false);
    expect(again.ticked[typed.id]).toBe(true);
    expect(again.past).toEqual(s.past);
  });

  it('ticks and unticks everything', () => {
    const { state } = loaded('balanced');
    expect(tickedIds(reviewReducer(state, { type: 'tick-all', on: true }))).toHaveLength(10);
    expect(tickedIds(reviewReducer(state, { type: 'tick-all', on: false }))).toHaveLength(0);
  });
});

describe('what is shown', () => {
  it('filters by kind, value or page number and hides unticked rows, changing nothing else and adding no undo step', () => {
    const { p, state } = loaded('balanced');
    // "4" is page 4 (index 3) or a value holding a 4.
    const byPage = reviewReducer(state, { type: 'filter', text: '4' });
    const shown = shownPlaces(byPage).places.map((x) => x.id);
    expect(shown).toContain(p.pan3.id);
    expect(shown).toContain(p.mobile.id);
    expect(shown).not.toContain(p.pan0.id);
    expect(shown).not.toContain(p.ip.id);
    expect(shownPlaces(reviewReducer(state, { type: 'filter', text: 'mobile' })).places.map((x) => x.id)).toEqual([p.mobile.id]);
    expect(shownPlaces(reviewReducer(state, { type: 'filter', text: 'bnzpm' })).places).toHaveLength(3);
    const hidden = reviewReducer(state, { type: 'show-unticked', on: false });
    expect(shownPlaces(hidden).places.every((x) => hidden.ticked[x.id])).toBe(true);
    expect(shownPlaces(state).places).toHaveLength(10);
    const selected = reviewReducer(state, { type: 'select', id: p.mobile.id });
    for (const s of [byPage, hidden, selected]) {
      expect(s.proposals).toBe(state.proposals);
      expect(s.ticked).toBe(state.ticked);
      expect(s.past).toBe(state.past);
    }
    expect(selected.selected).toBe(p.mobile.id);
  });
});

describe('drawn boxes and undo', () => {
  const box = (id: string, page = 0) => ({ id, page, rect: { x0: 100, y0: 100, x1: 160, y1: 120 } });

  it('undoes and redoes a drawn box, and ignores a box under 2 x 2 pt', () => {
    const { state } = loaded('balanced');
    const drawn = reviewReducer(state, { type: 'draw', box: box('d1') });
    expect(drawn.drawn).toHaveLength(1);
    const undone = reviewReducer(drawn, { type: 'undo' });
    expect(undone.drawn).toEqual([]);
    expect(reviewReducer(undone, { type: 'redo' }).drawn).toHaveLength(1);
    const tiny = reviewReducer(state, { type: 'draw', box: { id: 'd2', page: 0, rect: { x0: 10, y0: 10, x1: 11.5, y1: 30 } } });
    expect(tiny).toBe(state);
  });

  it('deletes drawn boxes one by one, by page, or all, each an undo step', () => {
    const { state } = loaded('balanced');
    const three = run(state, { type: 'draw', box: box('a', 0) }, { type: 'draw', box: box('b', 1) }, { type: 'draw', box: box('c', 1) });
    expect(reviewReducer(three, { type: 'delete-drawn', ids: ['a'] }).drawn.map((d) => d.id)).toEqual(['b', 'c']);
    expect(reviewReducer(three, { type: 'clear-page', page: 1 }).drawn.map((d) => d.id)).toEqual(['a']);
    const cleared = reviewReducer(three, { type: 'clear-drawn' });
    expect(cleared.drawn).toEqual([]);
    expect(reviewReducer(cleared, { type: 'undo' }).drawn).toHaveLength(3);
  });

  it(`keeps ${REVIEW_HISTORY} steps of history`, () => {
    const { p, state } = loaded('balanced');
    let s = state;
    for (let i = 0; i < 101; i++) s = reviewReducer(s, { type: 'tick', ids: [p.tan.id], on: i % 2 === 0 });
    expect(s.past).toHaveLength(100);
    expect(REVIEW_HISTORY).toBe(100);
    let back = s;
    for (let i = 0; i < 100; i++) back = reviewReducer(back, { type: 'undo' });
    expect(back.past).toHaveLength(0);
    expect(back.future).toHaveLength(100);
    expect(reviewReducer(back, { type: 'undo' })).toBe(back);
  });

  it('clears the redo steps on a new change, and keeps filter and selection out of history', () => {
    const { state } = loaded('balanced');
    const s = run(state, { type: 'draw', box: box('a') }, { type: 'undo' }, { type: 'filter', text: 'x' }, { type: 'select', id: null });
    expect(s.future).toHaveLength(1);
    expect(reviewReducer(s, { type: 'draw', box: box('b') }).future).toEqual([]);
  });

  it('forgets the selection of a drawn box that is deleted (mutation M36)', () => {
    const { state } = loaded('balanced');
    const s = run(state, { type: 'draw', box: box('a') }, { type: 'draw', box: box('b') }, { type: 'select', id: 'a' });
    expect(s.selected).toBe('a');
    expect(reviewReducer(s, { type: 'delete-drawn', ids: ['a'] }).selected).toBeNull();
    expect(reviewReducer(s, { type: 'clear-page', page: 0 }).selected).toBeNull();
    expect(reviewReducer(s, { type: 'delete-drawn', ids: ['b'] }).selected).toBe('a');
  });
});

describe('a drawn box redacts its area only (fix round 1, F5, lead ruling)', () => {
  const box = (id: string, page = 0) => ({ id, page, rect: { x0: 100, y0: 100, x1: 160, y1: 120 } });
  const sameText = (id: string, boxId: string, page: number) => place('same-text', 'iijpl1111j', page, { id, fromBox: boxId, value: 'IIJPL1111J', label: 'Same text' });

  it('adds the places of its word only when the user asks, and they go with the box', () => {
    const { state } = loaded('balanced');
    const drawn = reviewReducer(state, { type: 'draw', box: box('d1') });
    // a box alone: its area only, nothing to look for in the check
    expect(checkTargets(drawn).some((t) => t.kind === 'same-text')).toBe(false);
    const places = [sameText('s1', 'd1', 2), sameText('s2', 'd1', 5)];
    const everywhere = reviewReducer(drawn, { type: 'box-everywhere', id: 'd1', on: true, proposals: places });
    expect(everywhere.drawn[0].everywhere).toBe(true);
    expect(tickedIds(everywhere)).toEqual(expect.arrayContaining(['s1', 's2']));
    expect(checkTargets(everywhere).find((t) => t.kind === 'same-text')).toEqual({ kind: 'same-text', forms: expect.arrayContaining(['iijpl1111j', 'IIJPL1111J']), wholeWord: true });
    // deleting the box removes the places it made, and undo brings both back
    const deleted = reviewReducer(everywhere, { type: 'delete-drawn', ids: ['d1'] });
    expect(deleted.proposals.some((x) => x.kind === 'same-text')).toBe(false);
    expect(deleted.ticked.s1).toBeUndefined();
    expect(checkTargets(deleted).some((t) => t.kind === 'same-text')).toBe(false);
    expect(reviewReducer(deleted, { type: 'undo' }).proposals.filter((x) => x.kind === 'same-text')).toHaveLength(2);
    // switching it off, clearing the page or clearing every box removes them too
    for (const action of [{ type: 'box-everywhere', id: 'd1', on: false }, { type: 'clear-page', page: 0 }, { type: 'clear-drawn' }] as ReviewAction[]) {
      expect(reviewReducer(everywhere, action).proposals.some((x) => x.kind === 'same-text')).toBe(false);
    }
    // undoing the choice removes them as well
    expect(reviewReducer(everywhere, { type: 'undo' }).proposals.some((x) => x.kind === 'same-text')).toBe(false);
  });

  it('gives the check no same-text value from a box that is gone or not chosen, whatever the state holds', () => {
    const base = initialReview('balanced');
    const orphan: ReviewState = { ...base, proposals: [sameText('s1', 'd1', 2)], ticked: { s1: true } };
    expect(checkTargets(orphan)).toEqual([]);
    const notChosen: ReviewState = { ...orphan, drawn: [{ ...box('d1'), everywhere: false }] };
    expect(checkTargets(notChosen)).toEqual([]);
    const chosen: ReviewState = { ...orphan, drawn: [{ ...box('d1'), everywhere: true }] };
    expect(checkTargets(chosen).map((t) => t.kind)).toEqual(['same-text']);
  });

  it('never keeps same-text places whose box is gone or not chosen, even from a new find', () => {
    const { state } = loaded('balanced');
    const drawn = reviewReducer(state, { type: 'draw', box: box('d1') });
    const stale = reviewReducer(drawn, { type: 'loaded', proposals: [...drawn.proposals, sameText('s1', 'd1', 2), sameText('s2', 'gone', 3)] });
    expect(stale.proposals.some((x) => x.kind === 'same-text')).toBe(false);
    const asked = reviewReducer(drawn, { type: 'box-everywhere', id: 'd1', on: true, proposals: [sameText('s1', 'd1', 2), sameText('x', 'other', 1)] });
    expect(asked.proposals.filter((x) => x.kind === 'same-text').map((x) => x.id)).toEqual(['s1']);
    expect(reviewReducer(asked, { type: 'loaded', proposals: [...asked.proposals, sameText('s3', 'd1', 4)] }).proposals.filter((x) => x.kind === 'same-text')).toHaveLength(2);
  });
});

describe('the limit on ticked places, and held possibles (fix round 1, F4, lead ruling)', () => {
  const heldOf = (n: number) =>
    holdPlaces([
      Array.from({ length: n }, (_, k): HeldHit => ({ kind: k % 2 ? 'ifsc' : 'tan', key: `K${k % 500}`, start: k * 12, end: k * 12 + 11, reason: k % 2 ? 'a bank branch code with no account number or label' : 'TAN-shaped code with no TAN label' })),
    ]);

  it('shows held possibles grouped by kind with counts, ticks a value of them when asked, and undoes it', () => {
    const { state } = loaded('balanced');
    const s = reviewReducer(state, { type: 'loaded', proposals: [...state.proposals], held: heldOf(1000) });
    expect(heldGroups(s)).toEqual([
      { kind: 'tan', label: 'TAN', values: 250, places: 500 },
      { kind: 'ifsc', label: 'IFSC', values: 250, places: 500 },
    ]);
    const [row] = heldRows(s, 'tan', 0, 1);
    expect(row).toMatchObject({ key: 'K0', places: 2 });
    const built = [place('tan', 'K0', 0, { id: 'h1', confidence: 'possible', reason: 'TAN-shaped code with no TAN label' }), place('tan', 'K0', 0, { id: 'h2', confidence: 'possible', reason: 'TAN-shaped code with no TAN label' })];
    const promoted = reviewReducer(s, { type: 'promote', index: row.index, proposals: built, on: true });
    expect(promoted.ticked.h1 && promoted.ticked.h2).toBe(true);
    expect(heldGroups(promoted)[0]).toEqual({ kind: 'tan', label: 'TAN', values: 249, places: 498 });
    expect(heldRows(promoted, 'tan', 0, 1)[0].key).toBe('K2');
    const undone = reviewReducer(promoted, { type: 'undo' });
    expect(undone.proposals.some((x) => x.id === 'h1')).toBe(false);
    expect(heldGroups(undone)[0].values).toBe(250);
  });

  it('does not list as held a value already in the review (sure somewhere else)', () => {
    const { p, state } = loaded('balanced');
    // the possible TAN of the fixture is a proposal; the same value is also held on another page
    const held = holdPlaces([[{ kind: 'tan', key: p.tan.key, start: 0, end: 10, reason: 'TAN-shaped code with no TAN label' }], [{ kind: 'tan', key: 'OTHR12345Z', start: 0, end: 10 }]]);
    const s = reviewReducer(state, { type: 'loaded', proposals: [...state.proposals], held });
    expect(heldGroups(s)).toEqual([{ kind: 'tan', label: 'TAN', values: 1, places: 1 }]);
    expect(heldRows(s, 'tan', 0, 5).map((r) => r.key)).toEqual(['OTHR12345Z']);
  });

  it('counts only ticked places against the limit, and says how many are ticked', () => {
    serial = 1000;
    const many = Array.from({ length: 5003 }, (_, i) => place('pan', `K${i}`, i % 50));
    const s = reviewReducer(initialReview('balanced'), { type: 'loaded', proposals: many, held: heldOf(50_000) });
    expect(tickedCount(s)).toBe(5003);
    expect(limitError(s)).toMatchObject({ code: 'redact-too-many', message: expect.stringContaining('5,003 places are ticked') });
    const fewer = reviewReducer(s, { type: 'tick', ids: many.slice(0, 3).map((x) => x.id), on: false });
    expect(tickedCount(fewer)).toBe(5000);
    expect(limitError(fewer)).toBeNull();
  });

  it('holds 50,000 possibles in the review without cost', () => {
    const held = heldOf(50_000);
    const { state } = loaded('balanced');
    const t0 = performance.now();
    let s = reviewReducer(state, { type: 'loaded', proposals: [...state.proposals], held });
    for (let i = 0; i < 20; i++) s = reviewReducer(s, { type: 'tick', ids: [state.proposals[0].id], on: i % 2 === 0 });
    const groups = heldGroups(s);
    const ms = performance.now() - t0;
    expect(groups.reduce((n, g) => n + g.places, 0)).toBe(50_000);
    expect(s.proposals).toHaveLength(10);
    expect(ms).toBeLessThan(500);
  });
});

describe('typed terms', () => {
  it('adds a valid term once, refuses one too short or past twenty, and removes its places with it', () => {
    const { state } = loaded('balanced');
    const added = reviewReducer(state, { type: 'add-term', term: { text: '  Sharma & Co ', reason: '' } });
    expect(added.terms).toEqual([{ text: 'Sharma & Co', reason: 'Typed' }]);
    expect(reviewReducer(added, { type: 'add-term', term: { text: 'sharma  &  co', reason: 'Again' } })).toBe(added);
    expect(reviewReducer(added, { type: 'add-term', term: { text: 'ab', reason: '' } })).toBe(added);
    let many = state;
    for (let i = 0; i < 21; i++) many = reviewReducer(many, { type: 'add-term', term: { text: `term ${i}`, reason: '' } });
    expect(many.terms).toHaveLength(20);
    const typed = place('typed', 'sharma & co', 0);
    const withPlaces = reviewReducer(added, { type: 'loaded', proposals: [...added.proposals, typed] });
    expect(withPlaces.ticked[typed.id]).toBe(true);
    const removed = reviewReducer(withPlaces, { type: 'remove-term', text: 'SHARMA & CO' });
    expect(removed.terms).toEqual([]);
    expect(removed.proposals.some((x) => x.id === typed.id)).toBe(false);
    expect(removed.ticked[typed.id]).toBeUndefined();
    expect(reviewReducer(removed, { type: 'undo' }).proposals.some((x) => x.id === typed.id)).toBe(true);
  });
});

describe('the confirmation and the areas to redact', () => {
  it('counts the areas and pages that will be redacted, by kind', () => {
    const { state } = loaded('balanced');
    const s = reviewReducer(state, { type: 'draw', box: { id: 'd1', page: 7, rect: { x0: 0, y0: 0, x1: 50, y1: 50 } } });
    const summary = confirmSummary(s);
    expect(summary.areas).toBe(8);
    expect(summary.pages).toEqual([0, 1, 2, 3, 4, 5, 7]);
    expect(summary.countsByKind).toEqual({ pan: 3, mobile: 1, 'bank-account': 1, aadhaar: 2, drawn: 1 });
  });

  it('wave 4, K3: text made bold by printing it three times is counted once (what a person sees); places apart count apart', () => {
    serial = 0;
    const at = rect(50, 600);
    const strikes = [0, 0.3, 0.6].map((d, i) => place('pan', PAN, 0, { id: `strike-${i}`, rects: [{ x0: at.x0 + d, y0: at.y0, x1: at.x1 + d, y1: at.y1 }] }));
    const elsewhere = place('pan', PAN, 0, { id: 'elsewhere', rects: [rect(50, 400)] });
    const s = reviewReducer(initialReview('balanced'), { type: 'loaded', proposals: [...strikes, elsewhere] });
    const summary = confirmSummary(s);
    expect(summary.areas).toBe(2);
    expect(summary.countsByKind).toEqual({ pan: 2 });
  });

  it("joins a value's places per page, marks hidden ones, and keeps drawn boxes as they are", () => {
    serial = 0;
    const a = place('pan', PAN, 0);
    const b = place('pan', PAN, 0, { ranges: [[500, 510]], id: 'second' });
    const hidden = place('pan', PAN, 0, { hidden: true, id: 'hidden' });
    const other = place('pan', PAN, 2);
    const upward = place('pan', 'QZXCV0000W', 0, { angle: 90 });
    let s = reviewReducer(initialReview('balanced'), { type: 'loaded', proposals: [a, b, hidden, other, upward] });
    s = reviewReducer(s, { type: 'draw', box: { id: 'd1', page: 1, rect: { x0: 10, y0: 10, x1: 40, y1: 40 }, angle: 90 } });
    const areas = areasToRedact(s);
    const page0 = areas.filter((x) => x.page === 0 && x.key === PAN);
    expect(page0.map((x) => [x.hidden, x.rects.length, x.ranges.length])).toEqual([
      [false, 2, 2],
      [true, 1, 1],
    ]);
    expect(areas.find((x) => x.key === 'QZXCV0000W')).toMatchObject({ angle: 90, kind: 'pan' });
    expect(areas.find((x) => x.page === 2)).toMatchObject({ kind: 'pan', rects: other.rects });
    expect(areas.find((x) => x.kind === 'drawn')).toEqual({ page: 1, rects: [{ x0: 10, y0: 10, x1: 40, y1: 40 }], kind: 'drawn', hidden: false, angle: 90, ranges: [] });
    const unticked = reviewReducer(s, { type: 'tick', ids: [other.id], on: false });
    expect(areasToRedact(unticked).some((x) => x.page === 2)).toBe(false);
  });

  it('gives the check every value redacted everywhere, in all its written forms, and none left visible', () => {
    const { p, state } = loaded('balanced');
    const kerned = place('pan', PAN, 6, { value: 'BN ZPM2501F' });
    const typed = place('typed', 'sharma & co', 6, { value: 'Sharma &\nCo' });
    const s = reviewReducer(state, { type: 'loaded', proposals: [...state.proposals, kerned, typed] });
    const targets = checkTargets(s);
    const pan = targets.find((t) => t.kind === 'pan')!;
    expect(pan.wholeWord).toBe(false);
    expect(pan.forms).toEqual(expect.arrayContaining([PAN, 'BN ZPM2501F']));
    expect(targets.find((t) => t.kind === 'aadhaar')!.forms).toEqual(expect.arrayContaining(['234567890124', '2345 6789 0124', '2345-6789-0124']));
    expect(targets.find((t) => t.kind === 'typed')).toEqual({ kind: 'typed', forms: expect.arrayContaining(['sharma & co', 'Sharma & Co']), wholeWord: true });
    expect(targets.map((t) => t.kind).sort()).toEqual(['aadhaar', 'bank-account', 'mobile', 'pan', 'typed']);
    // Unticked in one place: it stays visible there, so the check must not look for it.
    const kept = reviewReducer(s, { type: 'tick', ids: [p.pan3.id], on: false });
    expect(checkTargets(kept).some((t) => t.kind === 'pan')).toBe(false);
    // Names are compared as whole words; marks and drawn boxes have nothing to look for.
    const strict = run(s, { type: 'profile', profile: 'strict' }, { type: 'draw', box: { id: 'd', page: 0, rect: { x0: 0, y0: 0, x1: 9, y1: 9 } } });
    expect(checkTargets(strict).find((t) => t.kind === 'name')).toMatchObject({ wholeWord: true });
    expect(checkTargets(strict).some((t) => t.kind === 'drawn' || t.kind === 'marked')).toBe(false);
  });

  it('wave 5, ruling R: a typed word the find placed nowhere is marked for the run and named before it; a typed word with a place is not', () => {
    const { state } = loaded('balanced');
    const typed = place('typed', 'sharma & co', 6, { value: 'Sharma & Co' });
    const s = run(
      reviewReducer(state, { type: 'loaded', proposals: [...state.proposals, typed] }),
      { type: 'add-term', term: { text: 'Sharma & Co', reason: 'Typed' } },
      { type: 'add-term', term: { text: 'Orchard Lane', reason: 'Typed' } },
    );
    const words = checkTargets(s).filter((t) => t.kind === 'typed');
    expect(words.map((t) => t.placedNowhere === true)).toEqual([false, true]);
    expect(termsNotFound(s)).toEqual([1]);
    expect(termsNotFound(run(s, { type: 'remove-term', text: 'Orchard Lane' }))).toEqual([]);
  });

  it('formats no value into a string anywhere in the module', () => {
    const source = readFileSync(new URL('./reviewState.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/\$\{[^}]*\b(key|value|text)\b[^}]*\}/);
    expect(source).not.toMatch(/\b(key|value)\s*\+\s*['"`]|['"`]\s*\+\s*\w*\.?(key|value)\b/);
    expect(source).not.toMatch(/console\./);
  });
});

describe('nothing of the document left in module memory (fix round 2, MF3)', () => {
  it('holds no page text once the review is disposed', () => {
    const page = `Ledger folio 12: PAN ${PAN} of the assessee`;
    expect(placesOfValue(page, 'pan', PAN)).toHaveLength(1);
    expect(findPatterns(page, new Set(['identity'])).length).toBeGreaterThan(0);
    expect(cachedTextCount()).toBeGreaterThan(0);
    disposeReview();
    expect(cachedTextCount()).toBe(0);
    const statics = RegExp as unknown as Record<string, unknown>;
    for (const k of ['input', 'lastMatch', 'leftContext', 'rightContext', '$1']) expect(String(statics[k] ?? '')).not.toMatch(/BNZPM|folio/);
  });

  it('keeps module-level state in the four Redact modules only where it cannot outlive the document', () => {
    // Every module-level collection that could be filled at run time must be a WeakMap keyed by the
    // document's own objects, or the fold cache that empties itself when the task ends; the rest are
    // fixed sets of kinds and codes. No module-level variable at all.
    const allowed = new Set(['layoutCache', 'fontClassCache', 'idSets', 'foldCache', 'GSTIN_STATES', 'DRAWN_SUBTYPES', 'WHOLE_WORD_KINDS']);
    const found: string[] = [];
    for (const file of ['../../../lib/pdf-tools/redactPatterns.ts', '../../../lib/pdf-tools/pageText.ts', '../../../lib/pdf-tools/redactFind.ts', './reviewState.ts']) {
      const source = readFileSync(new URL(file, import.meta.url), 'utf8');
      for (const m of source.matchAll(/^(?:export )?(?:const|let|var) (\w+)\b[^=\n]*=\s*(?:new (?:Map|Set|WeakMap|WeakSet|Array)\b|\[\s*\])/gm)) found.push(m[1]);
      expect(source).not.toMatch(/^(?:export )?(?:let|var) /m);
    }
    expect(found.filter((name) => !allowed.has(name))).toEqual([]);
  });
});
