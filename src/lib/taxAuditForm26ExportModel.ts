// One export model of Form No. 26: what the office's fillable file exports to Word ("Export to Word"),
// as data, for the Word (.docx) and PDF downloads. It walks the form's own document (`def.tree`) as the
// file's exportWord() walks its page:
// - portrait = the form (category, the Part of the category, Part C, Part D with "Signature and Notes");
//   landscape = the schedules that are shown;
// - everything not shown is left out (an item tied to an answer that is not "Yes", the other category's
//   Part, a schedule not opened, a schedule group with no schedule exported), and everything the file marks
//   as not exported (the "Tip", the category hint, the depreciation hint; its buttons are not in the data);
// - each answer becomes its value: a radio option "☑" or "☐" before its label, a choice its text, long text
//   with its line breaks, a date dd/mm/yyyy, anything else as typed, a blank four non-breaking spaces;
//   the answers inside the report paragraphs of Parts A and B are underlined; totals as the screen shows them.
// "Show all schedules" does not change the export (decision A3: FORM26_QUIRKS.showAllSchedulesAffectsExport).
// No draft notice is added (owner's ruling of 22 Nov 2026): the outputs are the form as the owner's file exports
// it, block for block. Nothing else is added: the model reads only the definition, the answers and the view, so no review remark,
// qualification text or comparison line can reach an exported form.
import type {
  Form26ColumnType,
  Form26Definition,
  Form26Field,
  Form26FieldKind,
  Form26HeaderCell,
  Form26Node,
  Form26Table,
} from '@/data/taxAuditForm26Types';
import { tableTotals } from '@/lib/taxAuditForm26Calc';
import { FORM26_QUIRKS, type Form26Quirks } from '@/lib/taxAuditForm26Quirks';
import { isScheduleShown, isTableShown, isYes } from '@/lib/taxAuditForm26Reveal';
import { fileStem } from '@/lib/taxAuditForm26SaveFile';
import { getField, type Form26Values } from '@/lib/taxAuditForm26Values';

/** What the file exports for a blank answer or cell. */
export const FORM26_BLANK_VALUE = '\u00A0\u00A0\u00A0\u00A0';
export const FORM26_RADIO_CHOSEN = '☑';
export const FORM26_RADIO_NOT_CHOSEN = '☐';

/** A piece of text with one look. `breakAfter`: a line break follows. `small`: the file's small labels (9.5 pt). */
export type Form26Run = { text: string; bold?: boolean; italic?: boolean; underline?: boolean; small?: boolean; breakAfter?: boolean };
export type Form26QuestionExportRow = {
  /** The row's index in `def.questionRows` (for the working-paper pack: the clause unit holding it). */
  index: number;
  no: string;
  wording: Form26Run[];
  answer: Form26Run[];
  /** A row that holds a table across the row (11(a), 12(d), 14(a), 49): its blocks; no, wording and answer are empty. */
  fullWidth?: Form26ExportBlock[];
};
export type Form26SignatureLine = { label: string; value: string; side: 'left' | 'right' };
export type Form26ExportBlock =
  | { kind: 'heading'; level: 1 | 2 | 3 | 4; text: string; centred: boolean; underlined?: boolean }
  | { kind: 'para'; runs: Form26Run[]; centred?: boolean; indent?: boolean; small?: boolean }
  | { kind: 'questions'; rows: Form26QuestionExportRow[] }
  /**
   * A table: `id` is the form's table id ('' for the code list in the notes); `head` the header rows as the file
   * has them (a row of letters has `td` cells only); `body` one text per column; `total` the Total line, the
   * label first (spanning `totalSpan` columns), then one text per remaining column ('' where there is no total).
   */
  | { kind: 'table'; id: string; head: Form26HeaderCell[][]; body: string[][]; total: string[] | null; totalSpan?: number; depreciation?: boolean }
  | { kind: 'signature'; lines: Form26SignatureLine[]; closing: string }
  | { kind: 'notes'; title: string; items: Form26ExportBlock[][] };
export type Form26ExportModel = { fileStem: string; generatedAt: string; portrait: Form26ExportBlock[]; landscape: Form26ExportBlock[] };
export type Form26ExportTable = Extract<Form26ExportBlock, { kind: 'table' }>;

// ---------------------------------------------------------------------------------------------------
// Values

/**
 * The text the file exports for a value. A date (yyyy-mm-dd) becomes dd/mm/yyyy; a blank becomes four
 * non-breaking spaces; long text keeps its line breaks; anything else is exported as typed. For a radio option
 * pass the group's value when this option is the chosen one and '' when it is not: "☑" / "☐".
 */
export function exportedValue(kind: Form26FieldKind | Form26ColumnType, value: string): string {
  if (kind === 'radio') return value === '' ? FORM26_RADIO_NOT_CHOSEN : FORM26_RADIO_CHOSEN;
  if (value === '') return FORM26_BLANK_VALUE;
  if (kind === 'date') {
    const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (ymd) return `${ymd[3]}/${ymd[2]}/${ymd[1]}`;
  }
  if (kind === 'longtext' || kind === 'ta') return value.replace(/\r\n?/g, '\n');
  return value;
}

// ---------------------------------------------------------------------------------------------------
// The walk over the form's document

type Element = Extract<Form26Node, { t: string }>;
type Style = { bold?: boolean; italic?: boolean; underline?: boolean; small?: boolean };
type ParaLook = { centred?: boolean; indent?: boolean; small?: boolean };
type Walk = {
  def: Form26Definition;
  values: Form26Values;
  showAllSchedules: boolean;
  fields: Map<string, Form26Field>;
  tables: Map<string, Form26Table>;
  /** The next question row's index in `def.questionRows` (rows come in the document's order). */
  question: { next: number };
  /** Runs holding an answer's value: never trimmed or squeezed. */
  valueRuns: WeakSet<Form26Run>;
};

const isElement = (node: Form26Node): node is Element => typeof node !== 'string' && 't' in node;
const classesOf = (node: Element) => (node.c ?? '').split(/\s+/).filter(Boolean);
const hasClass = (node: Element, name: string) => classesOf(node).includes(name);
const indented = (node: Element) => /margin-left/.test(node.a?.style ?? '');
const INLINE = new Set(['em', 'strong', 'span', 'a', 'label', 'b', 'i', 'u', 'sub', 'sup', 'br']);
const isBlockElement = (node: Element) => !INLINE.has(node.t) || (node.t === 'label' && hasClass(node, 'opt'));
const squeeze = (text: string) => text.replace(/[ \t\r\n]+/g, ' ');

function need<T>(found: T | undefined, what: string, id: string): T {
  if (found === undefined) throw new Error(`Form 26 has no ${what} "${id}"`);
  return found;
}

/** Is this element in the export? (Shown on screen and not marked "not exported".) */
function exported(node: Element, walk: Walk): boolean {
  if (hasClass(node, 'noexport')) return false;
  const category = node.a?.['data-cat'];
  if (category !== undefined) {
    const chosen = getField(walk.values, 'cat');
    if (chosen !== '' && chosen !== category) return false;
  }
  if (node.t === 'div' && hasClass(node, 'sched') && node.a?.id) {
    return isScheduleShown(walk.def, node.a.id, walk.values, { showAllSchedules: walk.showAllSchedules });
  }
  if (node.t === 'div' && hasClass(node, 'sgroup')) {
    return (node.k ?? []).some((child) => isElement(child) && hasClass(child, 'sched') && exported(child, walk));
  }
  const showIf = node.a?.['data-showif'];
  if (showIf !== undefined) return isYes(walk.values, showIf);
  return true;
}

/** The plain text of some nodes (headings, numbers, labels), white space squeezed. */
function plainText(nodes: Form26Node[] | undefined, walk: Walk): string {
  const runs: Form26Run[] = [];
  inlineRuns(nodes ?? [], walk, {}, runs, 'prose');
  return squeeze(runs.map((run) => run.text + (run.breakAfter ? ' ' : '')).join('')).trim();
}

/**
 * Two lines of Part B, 3(c), start in the owner's file (and in its Word export) with three non-breaking spaces
 * ("&nbsp;&nbsp;&nbsp;(i) …", "… (ii) …"); the definition holds that text with its white space squeezed to one
 * space. The export puts the three spaces back, so it says what the file's export says.
 */
export const FORM26_FILE_INDENTED_LINES = [
  '(i) in the case of the balance sheet, of the state of the affairs of the assessee as at 31st March; and',
  '(ii) in the case of the profit and loss account/income and expenditure account of the',
];
const FILE_INDENT = '\u00A0\u00A0\u00A0';

function pushRun(runs: Form26Run[], run: Form26Run, walk: Walk, isValue: boolean) {
  if (isValue) {
    walk.valueRuns.add(run);
    runs.push(run);
    return;
  }
  const last = runs[runs.length - 1];
  let text = squeeze(run.text);
  if (last?.breakAfter && FORM26_FILE_INDENTED_LINES.some((line) => text.trim().startsWith(line))) text = FILE_INDENT + text.trimStart();
  // White space between two pieces counts once, as on a page.
  if (last && !walk.valueRuns.has(last) && (last.breakAfter || /\s$/.test(last.text)) && text.startsWith(' ')) text = text.slice(1);
  if (text === '') return;
  if (
    last &&
    !walk.valueRuns.has(last) &&
    !last.breakAfter &&
    !!last.bold === !!run.bold &&
    !!last.italic === !!run.italic &&
    !!last.underline === !!run.underline &&
    !!last.small === !!run.small
  ) {
    last.text += text;
    return;
  }
  runs.push({ ...run, text });
}

function lineBreak(runs: Form26Run[]) {
  const last = runs[runs.length - 1];
  if (last) last.breakAfter = true;
}

/**
 * Inline content as runs. `answer`: inside the answer column of a question row, where each option of a group,
 * each "If yes, …" line and each labelled part of an address stands on its own line.
 */
function inlineRuns(nodes: Form26Node[], walk: Walk, style: Style, runs: Form26Run[], mode: 'prose' | 'answer') {
  for (const node of nodes) {
    if (typeof node === 'string') {
      pushRun(runs, { text: node, ...style }, walk, false);
      continue;
    }
    if ('f' in node) {
      const field = need(walk.fields.get(node.f), 'answer key', node.f);
      const value = getField(walk.values, node.f);
      if (node.rv !== undefined) {
        pushRun(runs, { text: exportedValue('radio', value === node.rv ? value : ''), ...style }, walk, true);
        continue;
      }
      const run: Form26Run = { text: exportedValue(field.kind, value), ...style };
      if (field.wordUnderline) run.underline = true;
      pushRun(runs, run, walk, true);
      continue;
    }
    if ('tbl' in node) continue; // tables stand as blocks; none sits inside a line of text
    if (!exported(node, walk)) continue;
    if (node.t === 'br') {
      if (runs.length === 0) runs.push({ text: '' });
      lineBreak(runs);
      continue;
    }
    const inner: Style = { ...style };
    if (node.t === 'strong' || node.t === 'b') inner.bold = true;
    if (node.t === 'em' || node.t === 'i') inner.italic = true;
    if (node.t === 'u') inner.underline = true;
    if (node.t === 'span' && hasClass(node, 'note')) inner.small = true;
    const ownLine = mode === 'answer' && (isBlockElement(node) || (node.t === 'span' && hasClass(node, 'note')));
    if (ownLine && runs.length > 0) lineBreak(runs);
    inlineRuns(node.k ?? [], walk, inner, runs, mode);
    if (mode === 'answer' && node.t === 'span' && hasClass(node, 'note')) pushRun(runs, { text: ' ', ...style }, walk, true);
    if (mode === 'answer' && node.t === 'label' && runs.length > 0) lineBreak(runs);
  }
}

/** The runs of a paragraph: outer white space taken off; null when nothing is left. */
function finishRuns(runs: Form26Run[], walk: Walk): Form26Run[] | null {
  const out = runs.filter((run) => run.text !== '' || run.breakAfter);
  while (out.length > 0 && !walk.valueRuns.has(out[0]) && out[0].text.trim() === '' && !out[0].breakAfter) out.shift();
  if (out.length > 0 && !walk.valueRuns.has(out[0])) out[0] = { ...out[0], text: out[0].text.replace(/^ +/, '') };
  const lastAt = out.length - 1;
  if (lastAt >= 0) {
    const last = { ...out[lastAt] };
    delete last.breakAfter;
    if (!walk.valueRuns.has(out[lastAt])) last.text = last.text.replace(/ +$/, '');
    out[lastAt] = last;
  }
  const kept = out.filter((run, i) => run.text !== '' || (run.breakAfter && i < out.length - 1));
  return kept.some((run) => run.text.trim() !== '' || run.text.includes('\u00A0')) ? kept : null;
}

function flowBlocks(nodes: Form26Node[], walk: Walk, look: ParaLook, out: Form26ExportBlock[]) {
  let runs: Form26Run[] = [];
  const flush = () => {
    const done = finishRuns(runs, walk);
    if (done) out.push(paraBlock(done, look));
    runs = [];
  };
  for (const node of nodes) {
    if (typeof node === 'string' || 'f' in node) {
      inlineRuns([node], walk, {}, runs, 'prose');
      continue;
    }
    if ('tbl' in node) {
      flush();
      const block = tableBlock(node.tbl, walk);
      if (block) out.push(block);
      continue;
    }
    if (!exported(node, walk)) continue;
    if (!isBlockElement(node)) {
      inlineRuns([node], walk, {}, runs, 'prose');
      continue;
    }
    flush();
    elementBlocks(node, walk, look, out);
  }
  flush();
}

function paraBlock(runs: Form26Run[], look: ParaLook): Form26ExportBlock {
  const block: Form26ExportBlock = { kind: 'para', runs };
  if (look.centred) block.centred = true;
  if (look.indent) block.indent = true;
  if (look.small) block.small = true;
  return block;
}

const HEADING_LEVEL: Record<string, 1 | 2 | 3 | 4> = { h1: 1, h2: 2, h3: 3, h4: 4 };

function elementBlocks(node: Element, walk: Walk, look: ParaLook, out: Form26ExportBlock[]) {
  const indent = !!look.indent || indented(node);
  const level = HEADING_LEVEL[node.t];
  if (level) {
    const underlined = node.t === 'h3' && hasClass(node, 'sch');
    const block: Form26ExportBlock = { kind: 'heading', level, text: plainText(node.k, walk), centred: level === 1 || hasClass(node, 'part') || underlined };
    if (underlined) block.underlined = true;
    out.push(block);
    return;
  }
  if (node.t === 'table' && hasClass(node, 'q')) {
    out.push(questionsBlock(node, walk));
    return;
  }
  if (node.t === 'table' && hasClass(node, 'sg')) {
    out.push(signatureBlock(node, walk));
    return;
  }
  if (node.t === 'table') {
    out.push(staticTableBlock(node, walk));
    return;
  }
  if (node.t === 'div' && hasClass(node, 'note') && (node.k ?? []).some((child) => isElement(child) && child.t === 'ol')) {
    out.push(notesBlock(node, walk));
    return;
  }
  const children = node.k ?? [];
  const holdsBlocks = children.some((child) => typeof child !== 'string' && ('tbl' in child || (isElement(child) && isBlockElement(child) && exported(child, walk))));
  if (holdsBlocks) {
    flowBlocks(children, walk, { indent }, out);
    return;
  }
  const runs: Form26Run[] = [];
  inlineRuns(children, walk, {}, runs, 'prose');
  const done = finishRuns(runs, walk);
  if (done) out.push(paraBlock(done, { centred: hasClass(node, 'c') || hasClass(node, 'sub'), indent, small: hasClass(node, 'note') }));
}

const childElements = (node: Element | undefined, tag?: string): Element[] =>
  (node?.k ?? []).filter(isElement).filter((child) => tag === undefined || child.t === tag);

function questionsBlock(node: Element, walk: Walk): Form26ExportBlock {
  const rows: Form26QuestionExportRow[] = [];
  for (const body of childElements(node, 'tbody')) {
    for (const tr of childElements(body, 'tr')) {
      const index = walk.question.next;
      walk.question.next += 1;
      const tds = childElements(tr, 'td');
      if (tds.length === 2 && tds[1].a?.colspan === '2') {
        const blocks: Form26ExportBlock[] = [];
        flowBlocks(tds[1].k ?? [], walk, {}, blocks);
        rows.push({ index, no: '', wording: [], answer: [], fullWidth: blocks });
        continue;
      }
      const wording: Form26Run[] = [];
      inlineRuns(tds[1]?.k ?? [], walk, {}, wording, 'prose');
      const answer: Form26Run[] = [];
      inlineRuns(tds[2]?.k ?? [], walk, {}, answer, 'answer');
      rows.push({ index, no: plainText(tds[0]?.k, walk), wording: finishRuns(wording, walk) ?? [], answer: finishRuns(answer, walk) ?? [] });
    }
  }
  return { kind: 'questions', rows };
}

function signatureBlock(node: Element, walk: Walk): Form26ExportBlock {
  const lines: Form26SignatureLine[] = [];
  let closing = '';
  for (const body of childElements(node, 'tbody')) {
    for (const tr of childElements(body, 'tr')) {
      const filled = childElements(tr, 'td')
        .map((td, at) => ({ td, at }))
        .filter(({ td }) => (td.k ?? []).some((child) => !(typeof child === 'string' && child.trim() === '')));
      if (filled.length === 2) {
        const runs: Form26Run[] = [];
        inlineRuns(filled[1].td.k ?? [], walk, {}, runs, 'prose');
        const value = runs.map((run) => run.text + (run.breakAfter ? '\n' : '')).join('');
        lines.push({ label: plainText(filled[0].td.k, walk), value, side: filled[0].at === 0 ? 'left' : 'right' });
      } else if (filled.length === 1) closing = plainText(filled[0].td.k, walk);
    }
  }
  return { kind: 'signature', lines, closing };
}

function notesBlock(node: Element, walk: Walk): Form26ExportBlock {
  const title = plainText(childElements(node).filter((child) => child.t === 'strong').flatMap((child) => child.k ?? []), walk);
  const items: Form26ExportBlock[][] = [];
  for (const list of childElements(node, 'ol')) {
    for (const li of childElements(list, 'li')) {
      const blocks: Form26ExportBlock[] = [];
      flowBlocks(li.k ?? [], walk, {}, blocks);
      items.push(blocks);
    }
  }
  return { kind: 'notes', title, items };
}

/** A table written into the form's text itself (the code list in the notes of Part D). */
function staticTableBlock(node: Element, walk: Walk): Form26ExportBlock {
  const head: Form26HeaderCell[][] = [];
  const body: string[][] = [];
  for (const part of childElements(node)) {
    for (const tr of childElements(part, 'tr')) {
      const cells = childElements(tr).filter((cell) => cell.t === 'td' || cell.t === 'th');
      if (part.t === 'thead') head.push(cells.map((cell) => ({ tag: cell.t as 'td' | 'th', text: plainText(cell.k, walk) })));
      else body.push(cells.map((cell) => plainText(cell.k, walk)));
    }
  }
  return { kind: 'table', id: '', head, body, total: null };
}

/** One of the form's tables with its rows, as the file exports it. */
function tableBlock(tableId: string, walk: Walk): Form26ExportBlock | null {
  const table = need(walk.tables.get(tableId), 'table', tableId);
  if (!isTableShown(walk.def, tableId, walk.values, { showAllSchedules: walk.showAllSchedules })) return null;
  const rows = walk.values.t[tableId] ?? [];
  const head = table.headerRows.map((row) => row.cells.map((cell) => ({ ...cell })));
  const body: string[][] = [];
  if (table.dep) {
    table.dep.rows.forEach((depRow, at) => {
      body.push([String(depRow.no), depRow.label, ...depRow.cells.map((key) => exportedValue('num', rows[at]?.[key] ?? ''))]);
    });
    return { kind: 'table', id: tableId, head, body, total: null, depreciation: true };
  }
  // A fixed table has its rows; a table that takes rows shows at least one (the file never has none).
  const count = table.kind === 'fixed' ? table.fixedRows?.length ?? table.startRows : Math.max(1, rows.length);
  for (let at = 0; at < count; at += 1) {
    let fixedAt = 0;
    body.push(
      table.columns.map((column) => {
        if (column.type === 'sl') return String(at + 1);
        if (column.type === 's') {
          const text = table.fixedRows?.[at]?.[fixedAt] ?? '';
          fixedAt += 1;
          return text;
        }
        return exportedValue(column.type, rows[at]?.[column.c] ?? '');
      }),
    );
  }
  if (!table.total) return { kind: 'table', id: tableId, head, body, total: null };
  const totals = tableTotals(table, rows);
  const wanted = new Set(table.total.columns);
  const total = [table.total.label, ...table.columns.slice(table.total.labelColspan).map((column) => (wanted.has(column.c) ? totals[column.c] ?? '' : ''))];
  return { kind: 'table', id: tableId, head, body, total, totalSpan: table.total.labelColspan };
}

// ---------------------------------------------------------------------------------------------------
// The model

const INDEX = new WeakMap<Form26Definition, { fields: Map<string, Form26Field>; tables: Map<string, Form26Table> }>();

function indexOf(def: Form26Definition) {
  let index = INDEX.get(def);
  if (!index) {
    index = { fields: new Map(def.fields.map((field) => [field.key, field])), tables: new Map(def.tables.map((table) => [table.id, table])) };
    INDEX.set(def, index);
  }
  return index;
}

/**
 * The export of one Form No. 26. `opts.showAllSchedules` is the screen's switch: it changes the export only when
 * `FORM26_QUIRKS.showAllSchedulesAffectsExport` is on (it is off: decision A3). `opts.quirks` is for tests.
 */
export function buildForm26ExportModel(
  def: Form26Definition,
  values: Form26Values,
  opts: { showAllSchedules: boolean; generatedAt: string; quirks?: Form26Quirks },
): Form26ExportModel {
  const quirks = opts.quirks ?? FORM26_QUIRKS;
  const { fields, tables } = indexOf(def);
  const walk: Walk = {
    def,
    values,
    showAllSchedules: quirks.showAllSchedulesAffectsExport ? opts.showAllSchedules : false,
    fields,
    tables,
    question: { next: 0 },
    valueRuns: new WeakSet(),
  };
  const portrait: Form26ExportBlock[] = [];
  flowBlocks(def.tree.main, walk, {}, portrait);
  const landscape: Form26ExportBlock[] = [];
  flowBlocks(def.tree.sched, walk, {}, landscape);
  return { fileStem: fileStem(values), generatedAt: opts.generatedAt, portrait, landscape };
}

// ---------------------------------------------------------------------------------------------------
// Text of the model (tests, the PDF check, the working-paper pack)

export const form26RunsText = (runs: Form26Run[]) => runs.map((run) => run.text + (run.breakAfter ? '\n' : '')).join('');

function blockLines(block: Form26ExportBlock, out: string[]) {
  switch (block.kind) {
    case 'heading':
      out.push(block.text);
      return;
    case 'para':
      out.push(form26RunsText(block.runs));
      return;
    case 'questions':
      for (const row of block.rows) {
        if (row.fullWidth) row.fullWidth.forEach((inner) => blockLines(inner, out));
        else out.push([row.no, form26RunsText(row.wording), form26RunsText(row.answer)].join('\t'));
      }
      return;
    case 'table':
      for (const head of block.head) out.push(head.map((cell) => cell.text).join('\t'));
      for (const row of block.body) out.push(row.join('\t'));
      if (block.total) out.push(block.total.join('\t'));
      return;
    case 'signature':
      for (const line of block.lines) out.push(`${line.label}\t${line.value}`);
      if (block.closing !== '') out.push(block.closing);
      return;
    case 'notes':
      out.push(block.title);
      for (const item of block.items) item.forEach((inner) => blockLines(inner, out));
      return;
  }
}

/** The model as lines in order: one per heading, paragraph, question row, table row, signature line, note. */
export function exportModelLines(model: Form26ExportModel): { portrait: string[]; landscape: string[] } {
  const portrait: string[] = [];
  const landscape: string[] = [];
  model.portrait.forEach((block) => blockLines(block, portrait));
  model.landscape.forEach((block) => blockLines(block, landscape));
  return { portrait, landscape };
}

/** Plain text of the model in order (cells apart by a tab, lines by a line break). */
export function exportModelText(model: Form26ExportModel): { portrait: string; landscape: string } {
  const lines = exportModelLines(model);
  return { portrait: lines.portrait.join('\n'), landscape: lines.landscape.join('\n') };
}

// ---------------------------------------------------------------------------------------------------
// Widths

const longestWord = (text: string) => text.split(/\s+/).reduce((most, word) => Math.max(most, word.length), 0);

/** The first column of every header cell, the row and column spans placed as a table lays them out. */
export function form26HeadColumns(head: Form26HeaderCell[][]): number[][] {
  const taken: Set<number>[] = head.map(() => new Set());
  return head.map((row, r) => {
    let column = 0;
    return row.map((cell) => {
      while (taken[r].has(column)) column += 1;
      const start = column;
      const span = cell.colspan ?? 1;
      for (let down = 0; down < (cell.rowspan ?? 1) && r + down < head.length; down += 1) for (let c = start; c < start + span; c += 1) taken[r + down].add(c);
      column += span;
      return start;
    });
  });
}

/**
 * The share of the page width for each column of a table (they sum to 1), from what the column holds: the
 * longest word of its heading and the longest of its texts, within 5 to 30 characters.
 */
export function form26ExportColumnShares(block: Form26ExportTable): number[] {
  const columns = block.body[0]?.length ?? Math.max(0, ...block.head.map((row) => row.reduce((n, cell) => n + (cell.colspan ?? 1), 0)));
  if (columns === 0) return [];
  const weight = new Array<number>(columns).fill(5);
  // Headings: a cell over one column counts its longest word there.
  const starts = form26HeadColumns(block.head);
  block.head.forEach((row, r) =>
    row.forEach((cell, i) => {
      const column = starts[r][i];
      if ((cell.colspan ?? 1) === 1 && column < columns) weight[column] = Math.max(weight[column], Math.min(30, longestWord(cell.text)));
    }),
  );
  for (const row of block.body) {
    row.forEach((text, c) => {
      if (c < columns) weight[c] = Math.max(weight[c], Math.min(30, text.replace(/\u00A0/g, '').trim().length));
    });
  }
  const sum = weight.reduce((a, b) => a + b, 0);
  return weight.map((w) => w / sum);
}
