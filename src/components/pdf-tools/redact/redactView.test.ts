// The review list as data (design 5.9 "The list and the review"): values grouped with their places,
// ticks, held possibles by kind, notices; and that it stays quick at the sizes the find gives.
import { describe, expect, it } from 'vitest';
import { holdPlaces, type HeldHit, type Proposal } from '@/lib/pdf-tools/redactFind';
import { heldGroups, heldRows, initialReview, reviewReducer } from './reviewState';
import { PROFILES, REDACT_GROUPS } from '@/lib/pdf-tools/redactPatterns';
import { PAGE_SIZED_NOTE } from '@/lib/pdf-tools/redactFind';
import { GROUP_NAMES, GROUP_ORDER, notFoundLine, noTextNotice, omitsHindi, PAGE_WITHOUT_TEXT, pagesShort, placeNote, placesOnPage, PROFILE_LABELS, searchableNote, SEPARATE_GROUP, textLayerWouldOmit, tickState, valueRows } from './redactView';
import { profileFrom } from './reviewState';

let n = 0;
const place = (page: number, key: string, over: Partial<Proposal> = {}): Proposal => ({
  id: `t${page}-${n++}-pan`,
  kind: 'pan',
  key,
  value: key,
  page,
  rects: [{ x0: 10, y0: 10, x1: 60, y1: 22 }],
  confidence: 'sure',
  source: 'text',
  outsideView: false,
  ranges: [[0, 10]],
  label: 'PAN',
  ...over,
});

describe('value rows', () => {
  it('groups a value\'s places, in page order, with its tick state and pages', () => {
    const a1 = place(0, 'AAAPA1111A');
    const a2 = place(3, 'AAAPA1111A');
    const b = place(1, 'BBBPB2222B', { confidence: 'possible', reason: 'fourth letter is not a holder type' });
    let state = reviewReducer(initialReview('balanced'), { type: 'loaded', proposals: [a1, b, a2] });
    state = reviewReducer(state, { type: 'tick', ids: [a2.id], on: false });
    const rows = valueRows(state);
    expect(rows.map((r) => r.value)).toEqual(['AAAPA1111A', 'BBBPB2222B']);
    expect(rows[0].pages).toEqual([0, 3]);
    expect(rows[0].tick).toBe('some');
    expect(rows[1].tick).toBe('none');
    expect(rows[1].reason).toBe('fourth letter is not a holder type');
    expect(rows.every((r) => !r.id.includes(r.value))).toBe(true);
  });

  it('a filter keeps a value whose some place matches, and its tick still covers every place', () => {
    const a1 = place(0, 'AAAPA1111A');
    const a2 = place(5, 'AAAPA1111A');
    let state = reviewReducer(initialReview('balanced'), { type: 'loaded', proposals: [a1, a2, place(2, 'CCCPC3333C')] });
    state = reviewReducer(state, { type: 'filter', text: '6' });
    const rows = valueRows(state);
    expect(rows).toHaveLength(1);
    expect(rows[0].shown.map((p) => p.page)).toEqual([5]);
    expect(rows[0].places).toHaveLength(2);
  });

  it('ticks by page', () => {
    const state = reviewReducer(initialReview('balanced'), { type: 'loaded', proposals: [place(0, 'A1'), place(1, 'B1'), place(1, 'C1')] });
    expect(placesOnPage(state, 1)).toHaveLength(2);
    expect(tickState(placesOnPage(state, 1), state.ticked)).toBe('all');
  });

  it('5,000 places in view group in about a second, and 50,000 held possibles cost little: kinds with counts, rows a page at a time', () => {
    const proposals: Proposal[] = [];
    for (let i = 0; i < 5_000; i++) proposals.push(place(i % 200, `K${i % 1_700}`));
    const held: HeldHit[][] = Array.from({ length: 200 }, () => []);
    for (let i = 0; i < 50_000; i++) held[i % 200].push({ kind: i % 2 ? 'tan' : 'ifsc', key: `H${i}`, start: i, end: i + 10, reason: 'TAN-shaped code with no TAN label' });
    const heapBefore = process.memoryUsage().heapUsed;
    const t0 = performance.now();
    const store = holdPlaces(held);
    let state = reviewReducer(initialReview('balanced'), { type: 'loaded', proposals, held: store });
    const rows = valueRows(state);
    const kinds = heldGroups(state);
    const page = heldRows(state, 'tan', 0, 50);
    const elapsed = performance.now() - t0;
    const heapMb = (process.memoryUsage().heapUsed - heapBefore) / 1e6;
    expect(rows).toHaveLength(1_700);
    expect(kinds.map((k) => [k.kind, k.places])).toEqual([
      ['ifsc', 25_000],
      ['tan', 25_000],
    ]);
    expect(page).toHaveLength(50);
    // About 0.8 s alone on this machine (hold 0.32 s, review 0.39 s, rows 0.10 s); the bound allows for a busy machine.
    expect(elapsed).toBeLessThan(6_000);
    expect(heapMb).toBeLessThan(150);
    // A tick of one value stays quick with all of that loaded.
    const t1 = performance.now();
    state = reviewReducer(state, { type: 'tick', ids: [proposals[0].id], on: false });
    valueRows(state);
    expect(performance.now() - t1).toBeLessThan(1_000);
  });
});

describe('words', () => {
  it('every group of data has a name and a place in the list, in the patterns\' order (RX-PAT widened the groups)', () => {
    expect(GROUP_ORDER).toEqual(REDACT_GROUPS);
    for (const group of REDACT_GROUPS) expect(GROUP_NAMES[group], group).toMatch(/^[A-Z][A-Za-z ,]+$/);
    expect(GROUP_NAMES.investments).toBe('Investments, insurance and vehicles');
    // Business is ticked by no profile: the list shows it apart, with that said.
    expect(SEPARATE_GROUP).toBe('business');
    for (const profile of Object.keys(PROFILES) as (keyof typeof PROFILES)[]) expect(PROFILES[profile].ticked, profile).not.toContain(SEPARATE_GROUP);
  });

  it('every profile has its label and says what it ticks (DPDP added, Strict widened)', () => {
    expect(Object.keys(PROFILE_LABELS).sort()).toEqual(Object.keys(PROFILES).sort());
    expect(PROFILE_LABELS.dpdp).toEqual({
      label: 'DPDP personal data',
      description: 'Everything about a person ticked, possible matches too: identity, contact, bank, payroll, investment and vehicle numbers, names, addresses and IP addresses. Company numbers and tax and GST document numbers are listed for you to tick.',
    });
    expect(PROFILE_LABELS.balanced.description).toBe('Identity numbers, contact details, bank and tax numbers ticked; addresses, IP addresses, payroll, investment, company and document numbers listed for you to tick.');
    expect(PROFILE_LABELS.strict.description).toBe('Everything found is ticked, except company and professional numbers and codes that are usually part or branch numbers.');
    expect(PROFILE_LABELS.identity.description).toBe('Identity numbers ticked: PAN, Aadhaar and its virtual ID, GSTIN, TAN, passport, voter ID, driving licence, date of birth and tax document numbers.');
    expect(profileFrom('dpdp')).toBe('dpdp');
  });

  it('a place drawn over the whole page says so truthfully; a hidden place says it is removed without a box', () => {
    expect(placeNote({ hidden: true, pageSized: true })).toBe(` · ${PAGE_SIZED_NOTE}`);
    expect(placeNote({ hidden: true })).toBe(' · not shown on the page: removed without a box');
    expect(placeNote({ hidden: false })).toBe('');
  });

  it('cuts long page lists', () => {
    expect(pagesShort([0])).toBe('page 1');
    expect(pagesShort([0, 1, 2, 4])).toBe('pages 1-3, 5');
    expect(pagesShort(Array.from({ length: 10 }, (_, i) => i * 2))).toBe('pages 1, 3, 5, 7, 9, 11 and 4 more');
  });

  it('says when pages have no text, and when the whole file has none', () => {
    expect(noTextNotice([], 4)).toBeNull();
    // Wave 4, ruling P: a page pdf.js cannot draw is shown blank and has no text either; the notice says what is true
    // of both (never only "It may be a scan").
    expect(noTextNotice([3, 8], 10)).toEqual({ title: 'Pages 4, 9 have no text', body: 'Redact found no text it can read there: they may be scans, or drawn in a way Redact cannot read. Only the boxes you draw remove anything there.' });
    expect(noTextNotice([3], 10)?.body).toBe('Redact found no text it can read there: it may be a scan, or drawn in a way Redact cannot read. Only the boxes you draw remove anything there.');
    expect(noTextNotice([0, 1], 2)).toEqual({ title: 'No text was found in this file', body: 'Redact found no text it can read: the pages may be scans, or drawn in a way Redact cannot read. Only the boxes you draw remove anything. Draw a box over everything that must go.' });
    for (const n of [noTextNotice([3], 10), noTextNotice([0, 1], 2)]) expect(n?.body).not.toMatch(/^It may be a scan/);
    // The line over a page without text, while it is shown.
    expect(PAGE_WITHOUT_TEXT).toBe('Automatic finding cannot read this page: only the boxes you draw remove anything on it.');
  });

  it('knows when the searchable layer will leave characters out (Hindi, the rupee sign)', () => {
    expect(textLayerWouldOmit('Amount 1,25,000 paid – “net”')).toBe(false);
    expect(textLayerWouldOmit('Amount ₹ 1,25,000')).toBe(true);
    expect(textLayerWouldOmit('कर')).toBe(true);
  });

  it('wave 5, ruling R: the note on text that cannot be searched names Hindi only where the pages have Devanagari; typed words found nowhere are counted in one line', () => {
    expect(omitsHindi(['Amount ₹ 5,000', 'नाम'])).toBe(true);
    expect(omitsHindi(['שם החשבון', 'اسم ₹ 5,000'])).toBe(false);
    expect(searchableNote(true)).toBe('Hindi and ₹ on the redacted pages stay visible in the picture but cannot be searched.');
    expect(searchableNote(false)).toBe('Some scripts and symbols on the redacted pages stay visible in the picture but cannot be searched.');
    expect(notFoundLine(1)).toBe('Not found: 1 typed word.');
    expect(notFoundLine(3)).toBe('Not found: 3 typed words.');
  });
});
