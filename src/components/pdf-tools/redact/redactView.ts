// Redact's review list, as plain data (design 5.9 "The list and the review"): values grouped with their
// places, ticks of a value and of a page, the kinds of held possibles, and the notices the dialog shows.
// No React here, so it is tested in Node.
//
// Confidentiality: rows hold values in memory for the list, which shows them to the user (that is its
// purpose). Row ids are made of proposal ids (page, offsets and kind), never of a value.
import { formatPageList } from '@/lib/pdf-tools/pageList';
import { groupByValue, PAGE_SIZED_NOTE, type Proposal } from '@/lib/pdf-tools/redactFind';
import { REDACT_GROUPS, type RedactGroup, type RedactKind } from '@/lib/pdf-tools/redactPatterns';
import { shownPlaces, type ReviewProfile, type ReviewState } from './reviewState';

export const GROUP_NAMES: Readonly<Record<RedactGroup, string>> = {
  identity: 'Identity numbers',
  contact: 'Contact',
  'bank-tax': 'Bank and tax filing',
  employment: 'Employment and payroll',
  investments: 'Investments, insurance and vehicles',
  network: 'Network',
  names: 'Names and addresses',
  documents: 'Tax and GST documents',
  business: 'Company and professional numbers',
};
/** The patterns' own order (RX-PAT widened the groups, T-048). */
export const GROUP_ORDER: readonly RedactGroup[] = REDACT_GROUPS;
/** The group no profile ticks (company and professional numbers): the options show it apart, saying so. */
export const SEPARATE_GROUP: RedactGroup = 'business';

export const PROFILE_LABELS: Readonly<Record<ReviewProfile, { label: string; description: string }>> = {
  balanced: { label: 'Balanced', description: 'Identity numbers, contact details, bank and tax numbers ticked; addresses, IP addresses, payroll, investment, company and document numbers listed for you to tick.' },
  strict: { label: 'Strict', description: 'Everything found is ticked, except company and professional numbers and codes that are usually part or branch numbers.' },
  identity: { label: 'Identity numbers only', description: 'Identity numbers ticked: PAN, Aadhaar and its virtual ID, GSTIN, TAN, passport, voter ID, driving licence, date of birth and tax document numbers.' },
  dpdp: {
    label: 'DPDP personal data',
    description: 'Everything about a person ticked, possible matches too: identity, contact, bank, payroll, investment and vehicle numbers, names, addresses and IP addresses. Company numbers and tax and GST document numbers are listed for you to tick.',
  },
};

export type TickState = 'all' | 'some' | 'none';

export function tickState(ids: readonly string[], ticked: Readonly<Record<string, boolean>>): TickState {
  let on = 0;
  for (const id of ids) if (ticked[id]) on++;
  return on === 0 ? 'none' : on === ids.length ? 'all' : 'some';
}

export interface ValueRow {
  /** Unique, made of the first place's id: never a value. */
  id: string;
  kind: RedactKind;
  /** The kind as the list shows it (the term's reason for a typed term). */
  label: string;
  /** The value as written at its first place. */
  value: string;
  confidence: 'sure' | 'possible';
  reason?: string;
  /** Every place of the value (a value's tick is the tick of all of them). */
  places: Proposal[];
  /** The places the filter and "Show unticked" leave in view. */
  shown: Proposal[];
  /** 0-based pages of all its places, ascending. */
  pages: number[];
  tick: TickState;
  /** A place of it is in the dialog's drawn-box "everywhere" group, or a hidden place (removed without a box). */
  hiddenPlaces: number;
}

/** The list's value rows: every value with at least one place in view, in page order. */
export function valueRows(state: ReviewState): ValueRow[] {
  const { places } = shownPlaces(state);
  const inView = new Set(places.map((p) => p.id));
  const rows: ValueRow[] = [];
  for (const group of groupByValue(state.proposals)) {
    const shown = group.places.filter((p) => inView.has(p.id));
    if (shown.length === 0) continue;
    const first = group.places[0];
    const sure = group.places.some((p) => p.confidence === 'sure');
    rows.push({
      id: `v-${first.id}`,
      kind: group.kind,
      label: first.label,
      value: first.value,
      confidence: sure ? 'sure' : 'possible',
      ...(sure ? {} : first.reason ? { reason: first.reason } : {}),
      places: group.places,
      shown,
      pages: [...new Set(group.places.map((p) => p.page))].sort((a, b) => a - b),
      tick: tickState(
        group.places.map((p) => p.id),
        state.ticked,
      ),
      hiddenPlaces: group.places.filter((p) => p.hidden).length,
    });
  }
  return rows;
}

/** "page 4" / "pages 1, 4-7" (0-based in). Long lists are cut: "pages 1, 3, 5 and 12 more". */
export function pagesShort(pages: readonly number[], max = 6): string {
  if (pages.length === 0) return '';
  const head = formatPageList([...pages].slice(0, max));
  const more = pages.length > max ? ` and ${pages.length - max} more` : '';
  return `${pages.length === 1 ? 'page' : 'pages'} ${head}${more}`;
}

/** The ids of the places on a page (for "Tick all on this page"). */
export function placesOnPage(state: ReviewState, page: number): string[] {
  return state.proposals.filter((p) => p.page === page).map((p) => p.id);
}

/** The ids of the places of a kind (for "by kind"). */
export function placesOfKind(state: ReviewState, kind: RedactKind): string[] {
  return state.proposals.filter((p) => p.kind === kind).map((p) => p.id);
}

/**
 * The notice about pages without text (design 5.9 step 1), or null. Pages 0-based. It says plainly that
 * automatic finding cannot read them and only drawn boxes apply (lead, T-048). Wave 4, ruling P: a page whose
 * content pdf.js cannot draw is shown blank and has no text either, so the notice says what is true of both.
 */
export function noTextNotice(pagesWithoutText: readonly number[], pageCount: number): { title: string; body: string } | null {
  if (pagesWithoutText.length === 0) return null;
  if (pagesWithoutText.length >= pageCount) {
    return {
      title: 'No text was found in this file',
      body: 'Redact found no text it can read: the pages may be scans, or drawn in a way Redact cannot read. Only the boxes you draw remove anything. Draw a box over everything that must go.',
    };
  }
  const one = pagesWithoutText.length === 1;
  const list = formatPageList([...pagesWithoutText].sort((a, b) => a - b));
  return {
    title: `${one ? 'Page' : 'Pages'} ${list} ${one ? 'has' : 'have'} no text`,
    body: `Redact found no text it can read there: ${one ? 'it may be a scan' : 'they may be scans'}, or drawn in a way Redact cannot read. Only the boxes you draw remove anything there.`,
  };
}

/** The line over a page without text while it is shown (lead, T-048). */
export const PAGE_WITHOUT_TEXT = 'Automatic finding cannot read this page: only the boxes you draw remove anything on it.';

/**
 * What the list adds after a place's pages: a place drawn over the whole page (RX-LIB's `pageSized`) is
 * placed during the run or the run stops; any other hidden place is removed without a box.
 */
export function placeNote(p: Pick<Proposal, 'hidden' | 'pageSized'>): string {
  if (p.pageSized) return ` · ${PAGE_SIZED_NOTE}`;
  return p.hidden ? ' · not shown on the page: removed without a box' : '';
}

/** Characters of Windows Latin-1 outside Latin-1 itself (what the text layer's standard Helvetica can also write). */
const WIN_ANSI_EXTRA: ReadonlySet<number> = new Set([
  0x152, 0x153, 0x160, 0x161, 0x178, 0x17d, 0x17e, 0x192, 0x2c6, 0x2dc, 0x2013, 0x2014, 0x2018, 0x2019, 0x201a, 0x201c, 0x201d, 0x201e, 0x2020, 0x2021, 0x2022, 0x2026,
  0x2030, 0x2039, 0x203a, 0x20ac, 0x2122,
]);

/** Ruling R (wave 5): true when the texts have Devanagari letters, so that the note on text that cannot be searched may name Hindi. */
export function omitsHindi(texts: Iterable<string>): boolean {
  for (const text of texts) if (/\p{Script=Devanagari}/u.test(text)) return true;
  return false;
}

/** The confirmation's note on text the searchable layer cannot keep: Hindi only where the pages have it, else no script named (ruling R). */
export function searchableNote(hindi: boolean): string {
  return `${hindi ? 'Hindi and ₹' : 'Some scripts and symbols'} on the redacted pages stay visible in the picture but cannot be searched.`;
}

/** Ruling R (wave 5): the one line before the run that names how many typed words the find placed nowhere. */
export function notFoundLine(count: number): string {
  return `Not found: ${count} typed ${count === 1 ? 'word' : 'words'}.`;
}

/** True when a page's text holds characters the searchable layer cannot keep (Hindi, the rupee sign): the note of design 5.9 applies. */
export function textLayerWouldOmit(text: string): boolean {
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0;
    if (/\s/.test(ch) || (c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || WIN_ANSI_EXTRA.has(c)) continue;
    return true;
  }
  return false;
}
