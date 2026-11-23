// Form No. 26 beside Form No. 3CD, in its lightest form (BUILD-PLAN task 25): the quiet line under a clause,
// the "What changed" list with its filters and its one-page briefing, the years, and the one switch that
// shows or hides the comparison. Everything here is read from the mapping as SHOWN (the rows corrected from
// the official texts, owner's decision of 21 November 2026). No text of this file enters an exported form.
import {
  FORM26_MAPPING,
  shownEntry,
  shownNotInForm26,
  type Form26MappingEntry,
  type Form26MappingRow,
  type Form26NotInForm26Entry,
} from '@/data/taxAuditForm26Mapping';
import type { Form26QuestionRow } from '@/data/taxAuditForm26Types';
import { FORM26_FIRST_TAX_YEAR_START, parseEngagementYear } from '@/lib/taxAuditForm26Year';

const DOT = ' · ';
const DASH = '—';
const EN_DASH = '–';

// ---------------------------------------------------------------------------------------------------
// Clause numbers as text

/** The Form 3CD clauses of an entry: "13(a)–(c)", "20(a) and 21(e), (f), (g), (i)", a part marked "(part)". */
export function threeCdRefsText(refs: Form26MappingEntry['threeCd']): string {
  const items = refs.map((ref) => `${ref.clause}${ref.part ? ' (part)' : ''}`);
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function subsText(subs: string[]): string {
  if (subs.length === 0) return '';
  const codes = subs.map((sub) => sub.charCodeAt(0));
  const consecutive = subs.every((sub) => sub.length === 1) && codes.every((code, index) => index === 0 || code === codes[index - 1] + 1);
  if (consecutive && subs.length >= 3) return `(${subs[0]})${EN_DASH}(${subs[subs.length - 1]})`;
  return subs.map((sub) => `(${sub})`).join(', ');
}

/** The Form No. 26 clauses of a mapping row as the form numbers them: "13, 14(a)", "14(b)–(e)", "51(a), (c)". */
export function form26RefsText(row: Form26MappingRow): string {
  return row.form26.map((ref) => `${ref.clause}${subsText(ref.subs)}`).join(', ');
}

// ---------------------------------------------------------------------------------------------------
// The line under a clause

export type Form26ComparisonLine = { rowId: string; text: string; hasThreeCd: boolean };

/**
 * The quiet line of one mapping row: "Was Form 3CD clause 13(a)–(c) · No change in substance." for a same or
 * changed row; "New in Form No. 26." and the rest of the entry for a new one. Clause numbers only: the
 * sections are shown in "What changed" and in "Last year".
 */
export function comparisonLine(row: Form26MappingRow): string {
  const entry = shownEntry(row);
  if (entry.kind === 'new') {
    const rest = entry.whatChanged.replace(/^NEW\.\s*/, '').trim();
    return rest === '' ? 'New in Form No. 26.' : `New in Form No. 26. ${rest}`;
  }
  if (entry.threeCd.length === 0) return `No Form 3CD clause${DOT}${entry.whatChanged}`;
  return `Was Form 3CD clause${entry.threeCd.length > 1 ? 's' : ''} ${threeCdRefsText(entry.threeCd)}${DOT}${entry.whatChanged}`;
}

const covers = (ref: Form26MappingRow['form26'][number], clauseNo: string, sub: string | null) =>
  ref.clause === clauseNo && (ref.subs.length === 0 || (sub !== null && ref.subs.includes(sub)));

/** The line of the first mapping row that covers a question of the form ('13', null; '14', 'a'); null when none. */
export function comparisonLineForQuestion(clauseNo: string, sub: string | null): string | null {
  const row = FORM26_MAPPING.find((entry) => entry.form26.some((ref) => covers(ref, clauseNo, sub)));
  return row ? comparisonLine(row) : null;
}

/**
 * Where the lines of a clause go: each mapping row once, under the first question row it covers in that
 * clause; a row that names sub-clauses the form asks in one question (52(a), 52(b)) goes under that question.
 * Full-width rows (tables) never carry a line. Lines keep the mapping's order.
 */
export function comparisonPlacement(questionRows: Form26QuestionRow[]): Map<number, Form26ComparisonLine[]> {
  const placed = new Map<number, Form26ComparisonLine[]>();
  const rows = questionRows.filter((row) => !row.fullWidth);
  const clauses = new Set(rows.map((row) => row.clause));
  for (const mapping of FORM26_MAPPING) {
    for (const ref of mapping.form26) {
      if (!clauses.has(ref.clause)) continue;
      const inClause = rows.filter((row) => row.clause === ref.clause);
      const target = inClause.find((row) => covers(ref, row.clause, row.sub)) ?? inClause.find((row) => row.sub === null);
      if (!target) continue;
      const list = placed.get(target.index) ?? [];
      list.push({ rowId: mapping.id, text: comparisonLine(mapping), hasThreeCd: shownEntry(mapping).threeCd.length > 0 });
      placed.set(target.index, list);
    }
  }
  return placed;
}

// ---------------------------------------------------------------------------------------------------
// "What changed"

export type Form26ChangeFilter = 'all' | 'new' | 'changed' | 'same' | 'not-in-form26';
export const FORM26_CHANGE_FILTERS: { id: Form26ChangeFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'new', label: 'New' },
  { id: 'changed', label: 'Changed' },
  { id: 'same', label: 'Same' },
  { id: 'not-in-form26', label: 'Not in Form 26' },
];

/** The rows a filter lists and the count on every chip (the counts never change with the filter). */
export function whatChangedRows(filter: Form26ChangeFilter): {
  rows: Form26MappingRow[];
  notInForm26: Form26NotInForm26Entry[];
  counts: Record<Form26ChangeFilter, number>;
} {
  const notIn = shownNotInForm26();
  const kindOf = (row: Form26MappingRow) => shownEntry(row).kind;
  const counts: Record<Form26ChangeFilter, number> = {
    all: FORM26_MAPPING.length,
    new: FORM26_MAPPING.filter((row) => kindOf(row) === 'new').length,
    changed: FORM26_MAPPING.filter((row) => kindOf(row) === 'changed').length,
    same: FORM26_MAPPING.filter((row) => kindOf(row) === 'same').length,
    'not-in-form26': notIn.length,
  };
  if (filter === 'not-in-form26') return { rows: [], notInForm26: notIn, counts };
  const rows = filter === 'all' ? [...FORM26_MAPPING] : FORM26_MAPPING.filter((row) => kindOf(row) === filter);
  return { rows, notInForm26: [], counts };
}

export type Form26ChangeColumn = { key: string; label: string; share: number };

// The owner's "what to ask the client" sentences replace the last column on the New chip only once every new
// row has one (none is given yet).
const asksClient = () => FORM26_MAPPING.filter((row) => shownEntry(row).kind === 'new').every((row) => Boolean(shownEntry(row).askClient));

/** The columns of the list (and of the briefing); `share` is the column's part of the width in per cent. */
export function whatChangedColumns(filter: Form26ChangeFilter): Form26ChangeColumn[] {
  if (filter === 'not-in-form26') {
    return [
      { key: 'threeCd', label: 'Form 3CD clause', share: 14 },
      { key: 'subject', label: 'Subject', share: 38 },
      { key: 'position', label: 'Where it is now', share: 48 },
    ];
  }
  return [
    { key: 'clause', label: 'Form 26 clause', share: 9 },
    { key: 'subject', label: 'Subject', share: 19 },
    { key: 'section2025', label: 'Section (2025 Act)', share: 12 },
    { key: 'section1961', label: 'Section (1961 Act)', share: 13 },
    { key: 'threeCd', label: 'Form 3CD clause', share: 12 },
    { key: 'whatChanged', label: filter === 'new' && asksClient() ? 'What to ask the client' : 'What changed', share: 35 },
  ];
}

/** The cells of one mapping row, in the order of `whatChangedColumns`. */
export function whatChangedCells(row: Form26MappingRow, filter: Form26ChangeFilter = 'all'): string[] {
  const entry = shownEntry(row);
  const last = filter === 'new' && asksClient() && entry.askClient ? entry.askClient : entry.whatChanged;
  return [
    form26RefsText(row),
    entry.subject,
    entry.section2025 || DASH,
    entry.section1961 || DASH,
    entry.threeCd.length > 0 ? threeCdRefsText(entry.threeCd) : 'None',
    last,
  ];
}

/** The cells of a Form 3CD clause that has no clause of its own in Form No. 26. */
export function notInForm26Cells(entry: Form26NotInForm26Entry): string[] {
  return [entry.threeCd, entry.subject, entry.position];
}

// ---------------------------------------------------------------------------------------------------
// Years and the switch

/** The comparison line and the "Last year" tab are on at first for tax year 2026-27 only. */
export function comparisonOnByDefault(financialYear: string): boolean {
  return parseEngagementYear(financialYear)?.startYear === FORM26_FIRST_TAX_YEAR_START;
}

/** The ways last year's engagement may write its year: '2026-27' gives ['2025-26', '2025-2026']. */
export function previousYearCodes(financialYear: string): string[] {
  const year = parseEngagementYear(financialYear);
  if (!year) return [];
  const start = year.startYear - 1;
  return [`${start}-${String((start + 1) % 100).padStart(2, '0')}`, `${start}-${start + 1}`];
}

type SettingStorage = { getItem(key: string): string | null; setItem(key: string, value: string): void } | null | undefined;

// The application has no per-user preference store: the switch is remembered on this computer for the
// signed-in user and the engagement, as the other modules remember their view switches.
export function form26ComparisonStorageKey(userId: string | null | undefined, engagementId: string): string {
  return `vera.form26.comparison.${userId || 'signed-out'}.${engagementId}`;
}

export function readComparisonSetting(storage: SettingStorage, key: string, financialYear: string): boolean {
  try {
    const held = storage?.getItem(key);
    if (held === '1') return true;
    if (held === '0') return false;
  } catch {
    // Storage blocked: the year's default.
  }
  return comparisonOnByDefault(financialYear);
}

export function writeComparisonSetting(storage: SettingStorage, key: string, on: boolean): void {
  try {
    storage?.setItem(key, on ? '1' : '0');
  } catch {
    // Not remembered; the switch still works for this visit.
  }
}

// ---------------------------------------------------------------------------------------------------
// The briefing: the rows on screen as a Word file

export const FORM26_BRIEFING_TITLE = 'Form No. 26 and Form No. 3CD: what changed';
export const FORM26_DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export function briefingFileName(filter: Form26ChangeFilter): string {
  return `Form26_vs_Form3CD_what_changed_${filter.replace(/-/g, '_')}.docx`;
}

/** The line under the briefing's title: which chip and how many rows. */
export function briefingSubtitle(filter: Form26ChangeFilter): string {
  const result = whatChangedRows(filter);
  const count = result.counts[filter];
  const label = FORM26_CHANGE_FILTERS.find((chip) => chip.id === filter)?.label ?? '';
  return `Shown: ${label}${DOT}${count} ${count === 1 ? 'row' : 'rows'}`;
}

// A4 landscape with 1.27 cm margins: the width of the text in twentieths of a point.
const PAGE_TEXT_WIDTH = 16838 - 2 * 720;
const CELL_SIZE = 16;          // 8 pt

/** The rows on screen for a filter, as one landscape Word page (a long list runs on to the next page). */
export async function buildBriefingDocx(filter: Form26ChangeFilter): Promise<Blob> {
  // Loaded only when a briefing is made, so `docx` stays out of the workspace's chunk.
  const { AlignmentType, Document, Packer, PageOrientation, Paragraph, ShadingType, Table, TableCell, TableRow, TextRun, WidthType } = await import('docx');
  const cellParagraphs = (text: string, bold = false) =>
    text.split('\n').map((line) => new Paragraph({ spacing: { before: 0, after: 0 }, children: [new TextRun({ text: line, size: CELL_SIZE, bold })] }));
  const columns = whatChangedColumns(filter);
  const result = whatChangedRows(filter);
  const body = filter === 'not-in-form26' ? result.notInForm26.map(notInForm26Cells) : result.rows.map((row) => whatChangedCells(row, filter));
  const widths = columns.map((column) => Math.round((PAGE_TEXT_WIDTH * column.share) / 100));
  const cell = (text: string, index: number, header: boolean) =>
    new TableCell({
      width: { size: widths[index], type: WidthType.DXA },
      margins: { top: 40, bottom: 40, left: 80, right: 80 },
      shading: header ? { type: ShadingType.CLEAR, color: 'auto', fill: 'E7E9EE' } : undefined,
      children: cellParagraphs(text, header),
    });
  const table = new Table({
    width: { size: PAGE_TEXT_WIDTH, type: WidthType.DXA },
    columnWidths: widths,
    rows: [
      new TableRow({ tableHeader: true, children: columns.map((column, index) => cell(column.label, index, true)) }),
      ...body.map((cells) => new TableRow({ cantSplit: true, children: cells.map((text, index) => cell(text, index, false)) })),
    ],
  });
  const document = new Document({
    title: FORM26_BRIEFING_TITLE,
    creator: 'ICAI VERA',
    sections: [
      {
        properties: { page: { size: { orientation: PageOrientation.LANDSCAPE }, margin: { top: 720, bottom: 720, left: 720, right: 720 } } },
        children: [
          new Paragraph({ alignment: AlignmentType.LEFT, spacing: { after: 60 }, children: [new TextRun({ text: FORM26_BRIEFING_TITLE, bold: true, size: 28 })] }),
          new Paragraph({ spacing: { after: 160 }, children: [new TextRun({ text: briefingSubtitle(filter), size: 18 })] }),
          table,
        ],
      },
    ],
  });
  const blob = await Packer.toBlob(document);
  return blob.type === FORM26_DOCX_TYPE ? blob : new Blob([await blob.arrayBuffer()], { type: FORM26_DOCX_TYPE });
}
