// The clause editor of the Form No. 26 workspace as data: for one clause unit, the blocks to draw in the
// form's order (question rows, the tables and schedules under them, the prose of Parts A and B, the
// signature and notes), with what is on screen decided here. Also the small decisions every control
// needs: its accessible name, its id on screen, the keys Y and N, the line shown when someone else
// changed an answer, where a value came from, and the sentence of the save state.
import { FORM26_CLAUSE_UNITS, type Form26ClauseUnit } from '@/data/taxAuditForm26Clauses';
import type { Form26Definition, Form26Field, Form26Node, Form26QuestionRow } from '@/data/taxAuditForm26Types';
import { comparisonPlacement, type Form26ComparisonLine } from '@/lib/taxAuditForm26Compare';
import { isScheduleShown, isTableShown, isYes, type Form26ViewOptions } from '@/lib/taxAuditForm26Reveal';
import type { Form26SaveState } from '@/lib/taxAuditForm26SaveQueue';
import { FORM26_PREFILL_KEYS, parseClausePayload } from '@/lib/taxAuditForm26Storage';
import type { Form26ClauseRow } from '@/lib/taxAuditForm26Store';
import type { Form26Values } from '@/lib/taxAuditForm26Values';
import type { TaxAuditReviewStatus } from '@/types/taxAudit';

export type Form26EditorBlock =
  /** Text of the form with answers inside it (Parts A and B, the category). `exported`: false for the file's on-screen hints. */
  | { kind: 'prose'; nodes: Form26Node[]; exported: boolean }
  /** A question row: number | wording | answer. `answer` is the row's answer as on screen (items of a "No" left out). */
  /** `comparison`: the lines "Was Form 3CD clause … · …" placed under this row (task 25); [] when off or none. */
  | { kind: 'question'; row: Form26QuestionRow; shown: boolean; comparison: Form26ComparisonLine[]; answer: Form26Node[] }
  | { kind: 'table'; tableId: string; shown: boolean; title?: string }
  /** A schedule under the question that opens it. `body`: its content after the heading, in the file's order. */
  | { kind: 'schedule'; scheduleId: string; shown: boolean; title: string; tables: string[]; notes: Form26Node[]; body: Form26Node[] }
  | { kind: 'signature'; prefix: 'A' | 'B' | 'D' }
  | { kind: 'notes'; nodes: Form26Node[] };

export type Form26Provenance = 'client-master' | 'brought-from-3cd';

export const FORM26_REVIEW_LABEL: Record<TaxAuditReviewStatus, string> = {
  draft: 'Draft',
  prepared: 'Prepared',
  reviewed: 'Reviewed',
  approved: 'Approved',
  locked: 'Locked',
};
export const FORM26_PROVENANCE_LABEL: Record<Form26Provenance, string> = {
  'client-master': 'From client master',
  'brought-from-3cd': 'Brought from the 3CD draft',
};
export const FORM26_CONFLICT_ACTION_LABEL = { mine: 'Keep mine', theirs: 'Use theirs' } as const;

// ---------------------------------------------------------------------------------------------------
// Nodes of the definition

type Element = Extract<Form26Node, { t: string }>;

const isElement = (node: Form26Node): node is Element => typeof node !== 'string' && 't' in node;
const isWhitespace = (node: Form26Node) => typeof node === 'string' && node.trim() === '';
const classesOf = (node: Element) => (node.c ?? '').split(/\s+/).filter(Boolean);
const hasClass = (node: Element, name: string) => classesOf(node).includes(name);
const showIfOf = (node: Form26Node): string | null => (isElement(node) ? node.a?.['data-showif'] ?? null : null);

const INLINE = new Set(['em', 'strong', 'span', 'a', 'label', 'b', 'i', 'u', 'sub', 'sup']);

/** The plain text of nodes: strings joined as they are; answers contribute nothing. */
export function form26NodeText(nodes: Form26Node[] | undefined): string {
  let text = '';
  for (const node of nodes ?? []) {
    if (typeof node === 'string') text += node;
    else if ('t' in node) text += node.t === 'br' ? '' : form26NodeText(node.k);
  }
  return text;
}

function tablesIn(nodes: Form26Node[]): string[] {
  const found: string[] = [];
  for (const node of nodes) {
    if (typeof node === 'string') continue;
    if ('tbl' in node) found.push(node.tbl);
    else if ('t' in node) found.push(...tablesIn(node.k ?? []));
  }
  return found;
}

/** Nodes as on screen: an item tied to an answer is left out unless that answer is exactly "Yes". */
function visibleNodes(nodes: Form26Node[], values: Form26Values): Form26Node[] {
  const out: Form26Node[] = [];
  for (const node of nodes) {
    const key = showIfOf(node);
    if (key !== null && !isYes(values, key)) continue;
    if (isElement(node) && node.k) out.push({ ...node, k: visibleNodes(node.k, values) });
    else out.push(node);
  }
  return out;
}

/**
 * The options of a group of radio buttons sit in the file as separate labels, each holding `{ f, rv }`.
 * On screen the group is one control: the first option becomes `{ f }`, the others are left out.
 */
function collapseRadioOptions(nodes: Form26Node[], seen: Set<string> = new Set()): Form26Node[] {
  const out: Form26Node[] = [];
  for (const node of nodes) {
    if (isElement(node) && node.t === 'label') {
      const option = (node.k ?? []).find((child): child is { f: string; rv: string } => typeof child !== 'string' && 'f' in child && child.rv !== undefined);
      if (option) {
        if (!seen.has(option.f)) out.push({ f: option.f });
        seen.add(option.f);
        continue;
      }
    }
    if (isElement(node) && node.k) out.push({ ...node, k: collapseRadioOptions(node.k, seen) });
    else out.push(node);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// The blocks of a clause

const UNIT_BY_KEY = new Map(FORM26_CLAUSE_UNITS.map((unit) => [unit.key, unit]));

function unitOf(clauseKey: string): Form26ClauseUnit {
  const unit = UNIT_BY_KEY.get(clauseKey);
  if (!unit) throw new Error(`Form 26 has no clause "${clauseKey}"`);
  return unit;
}

function panelOf(def: Form26Definition, panelId: string): Element {
  const panel = def.tree.main.find((node): node is Element => isElement(node) && node.a?.['data-panel'] === panelId);
  if (!panel) throw new Error(`Form 26 has no panel "${panelId}"`);
  return panel;
}

function sectionOf(def: Form26Definition, sectionId: string): Element {
  const section = (panelOf(def, 'D').k ?? []).find((node): node is Element => isElement(node) && node.a?.['data-dsec'] === sectionId);
  if (!section) throw new Error(`Form 26 has no Part D section "${sectionId}"`);
  return section;
}

/** The prose of a panel in order, with its tables, its signature block and its notes. */
function panelBlocks(def: Form26Definition, panel: Element, prefix: 'A' | 'B' | null, values: Form26Values, view: Form26ViewOptions): Form26EditorBlock[] {
  const blocks: Form26EditorBlock[] = [];
  let prose: Form26Node[] = [];
  let proseExported = true;
  const flush = () => {
    if (prose.length > 0) blocks.push({ kind: 'prose', nodes: collapseRadioOptions(prose), exported: proseExported });
    prose = [];
  };
  const addProse = (node: Form26Node, exported: boolean) => {
    if (prose.length > 0 && exported !== proseExported) flush();
    proseExported = exported;
    prose.push(node);
  };
  const table = (tableId: string) => {
    flush();
    blocks.push({ kind: 'table', tableId, shown: isTableShown(def, tableId, values, view) });
  };
  const walk = (nodes: Form26Node[]) => {
    for (const node of nodes) {
      if (isWhitespace(node)) continue;
      if (typeof node === 'string' || 'f' in node) {
        addProse(node, true);
        continue;
      }
      if ('tbl' in node) {
        table(node.tbl);
        continue;
      }
      const showIf = showIfOf(node);
      if (showIf !== null) {
        if (isYes(values, showIf)) walk(node.k ?? []);
        else for (const tableId of tablesIn(node.k ?? [])) table(tableId);
        continue;
      }
      if (node.t === 'table' && hasClass(node, 'sg') && prefix !== null) {
        flush();
        blocks.push({ kind: 'signature', prefix });
        continue;
      }
      if (node.t === 'div' && hasClass(node, 'note')) {
        flush();
        blocks.push({ kind: 'notes', nodes: (node.k ?? []).filter((child) => !isWhitespace(child)) });
        continue;
      }
      // The file's "Tip" (category screen) speaks of the file's own tabs and "Export to Word" button, which the
      // workspace does not have: it is instruction about the file, not part of the form, and is not shown.
      if (node.t === 'div' && hasClass(node, 'toc')) {
        flush();
        continue;
      }
      addProse(node, !hasClass(node, 'noexport'));
    }
  };
  walk(panel.k ?? []);
  flush();
  return blocks;
}

function scheduleBlock(def: Form26Definition, scheduleId: string, values: Form26Values, view: Form26ViewOptions): Form26EditorBlock {
  const schedule = def.schedules.find((entry) => entry.id === scheduleId);
  if (!schedule) throw new Error(`Form 26 has no schedule "${scheduleId}"`);
  const body = schedule.body.filter((node) => !isWhitespace(node) && !(isElement(node) && node.t === 'h4'));
  return {
    kind: 'schedule',
    scheduleId,
    shown: isScheduleShown(def, scheduleId, values, view),
    title: schedule.title,
    tables: schedule.tables,
    notes: body.filter((node) => typeof node === 'string' || !('tbl' in node)),
    body,
  };
}

/** The schedules a question row opens: those its yes/no answer reveals, or (always open) the one it links to. */
function schedulesUnder(def: Form26Definition, unit: Form26ClauseUnit, row: Form26QuestionRow): string[] {
  return unit.schedules.filter((scheduleId) => {
    const schedule = def.schedules.find((entry) => entry.id === scheduleId);
    if (!schedule) return false;
    if (schedule.showIf !== null) return row.fields.includes(schedule.showIf);
    return row.links.some((link) => link.schedule === scheduleId);
  });
}

/**
 * The blocks of one clause unit. Part C and Part D: the question rows in order, a full-width row as a table
 * under the row before it, after a question the schedules it opens (shown or not). Parts A and B: their
 * prose with tables, signature and notes. The category: its heading and the two options as one answer, with
 * the file's hint on the categories (not its "Tip" about its own tabs). The signature unit: the signature
 * block of Part D and the Notes.
 * `opts.comparison`: the comparison with Form 3CD is on: each question row gets the lines placed under it
 * (`comparisonPlacement`, task 25); off, every row's list is empty.
 */
export function buildEditorModel(
  def: Form26Definition,
  clauseKey: string,
  values: Form26Values,
  view: Form26ViewOptions,
  opts: { comparison: boolean },
): Form26EditorBlock[] {
  const unit = unitOf(clauseKey);
  if (unit.key === 'f26_category') return panelBlocks(def, panelOf(def, 'cat'), null, values, view);
  if (unit.key === 'f26_part_a') return panelBlocks(def, panelOf(def, 'A'), 'A', values, view);
  if (unit.key === 'f26_part_b') return panelBlocks(def, panelOf(def, 'B'), 'B', values, view);
  if (unit.key === 'f26_sign') {
    const notes = (sectionOf(def, 'Z').k ?? []).find((node): node is Element => isElement(node) && node.t === 'div' && hasClass(node, 'note'));
    return [
      { kind: 'signature', prefix: 'D' },
      { kind: 'notes', nodes: (notes?.k ?? []).filter((child) => !isWhitespace(child)) },
    ];
  }

  const blocks: Form26EditorBlock[] = [];
  const lines = opts.comparison ? comparisonPlacement(unit.questionRows.map((index) => def.questionRows[index]).filter(Boolean)) : null;
  for (const rowIndex of unit.questionRows) {
    const row = def.questionRows[rowIndex];
    if (!row) throw new Error(`Form 26 has no question row ${rowIndex}`);
    if (row.fullWidth) {
      for (const tableId of row.tables) blocks.push({ kind: 'table', tableId, shown: isTableShown(def, tableId, values, view) });
      continue;
    }
    // Every question row of Parts C and D is on screen; only items inside its answer depend on answers.
    blocks.push({ kind: 'question', row, shown: true, comparison: lines?.get(row.index) ?? [], answer: collapseRadioOptions(visibleNodes(row.answer, values)) });
    for (const scheduleId of schedulesUnder(def, unit, row)) blocks.push(scheduleBlock(def, scheduleId, values, view));
  }
  return blocks;
}

/** The answers of a signature block (Place, Date, Name of the Accountant, …) in the form's order. */
export function signatureFields(def: Form26Definition, prefix: 'A' | 'B' | 'D'): Form26Field[] {
  return def.fields.filter((field) => field.signature && field.key.startsWith(`${prefix}.`));
}

/** The word printed under a signature block, right-aligned in italics: taken from the form itself. */
export function signatureClosing(def: Form26Definition, prefix: 'A' | 'B' | 'D'): string {
  const holder = prefix === 'D' ? sectionOf(def, 'Z') : panelOf(def, prefix);
  const block = (holder.k ?? []).find((node): node is Element => isElement(node) && node.t === 'table' && hasClass(node, 'sg'));
  const rows = (block?.k ?? []).flatMap((node) => (isElement(node) ? node.k ?? [] : [])).filter(isElement);
  const last = rows[rows.length - 1];
  return form26NodeText(last?.k).trim();
}

/** In the text of Parts A and B an answer sits in its sentence; a long text box and a group of options stand on their own. */
export function proseFieldInline(field: Form26Field): boolean {
  return field.kind !== 'longtext' && field.kind !== 'radio';
}

/** The heading of the editor: "Clause 14", "Item 1", "Part B", or the unit's name alone. */
export function editorTitle(unit: Form26ClauseUnit): { prefix: string | null; label: string } {
  if (unit.key === 'f26_category' || unit.key === 'f26_sign') return { prefix: null, label: unit.label };
  if (unit.no.startsWith('Part ')) return { prefix: unit.no, label: unit.label };
  if (unit.group === 'particulars') return { prefix: `Item ${unit.no}`, label: unit.label };
  return { prefix: `Clause ${unit.no}`, label: unit.label };
}

// ---------------------------------------------------------------------------------------------------
// Wording: a small allow-list renderer (em, strong, br, a) for the question rows' wording

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: ' ' };
const decode = (text: string) => text.replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (_, name: string) => ENTITIES[name]);

/** The wording's HTML as nodes. Only em, strong, br and a (with its href) are kept; any other tag keeps its text only. */
export function parseWordingHtml(html: string): Form26Node[] {
  const root: Form26Node[] = [];
  const stack: { tag: string | null; nodes: Form26Node[]; href?: string }[] = [{ tag: null, nodes: root }];
  const top = () => stack[stack.length - 1];
  const pushText = (text: string) => {
    if (text === '') return;
    const nodes = top().nodes;
    const last = nodes[nodes.length - 1];
    if (typeof last === 'string') nodes[nodes.length - 1] = last + text;
    else nodes.push(text);
  };
  const pattern = /<(\/?)([a-zA-Z0-9]+)([^>]*)>/g;
  let at = 0;
  for (let match = pattern.exec(html); match !== null; match = pattern.exec(html)) {
    pushText(decode(html.slice(at, match.index)));
    at = match.index + match[0].length;
    const closing = match[1] === '/';
    const tag = match[2].toLowerCase();
    if (tag === 'br') {
      if (!closing) top().nodes.push({ t: 'br' });
      continue;
    }
    if (tag !== 'em' && tag !== 'strong' && tag !== 'a') continue;
    if (closing) {
      if (stack.length > 1 && top().tag === tag) {
        const done = stack.pop()!;
        const element: Element = done.href !== undefined ? { t: tag, a: { href: done.href }, k: done.nodes } : { t: tag, k: done.nodes };
        top().nodes.push(element);
      }
      continue;
    }
    const href = tag === 'a' ? /href="([^"]*)"/.exec(match[3])?.[1] : undefined;
    stack.push({ tag, nodes: [], ...(href !== undefined ? { href: decode(href) } : {}) });
  }
  pushText(decode(html.slice(at)));
  // An element left open keeps its text in place.
  while (stack.length > 1) {
    const open = stack.pop()!;
    for (const node of open.nodes) {
      if (typeof node === 'string') pushText(node);
      else top().nodes.push(node);
    }
  }
  return root;
}

// ---------------------------------------------------------------------------------------------------
// Names of answers: the words beside each control on screen

type Frame = { list: Form26Node[]; index: number };

const cleanLabel = (text: string) => text.replace(/\s+/g, ' ').trim().replace(/\s*:$/, '');
const wordCount = (text: string) => (text.trim() === '' ? 0 : text.trim().split(/\s+/).length);

/** The inline text beside position `index` of a list, back to (or on to) a field, a line break or a block. */
function run(list: Form26Node[], index: number, step: -1 | 1): { text: string; stoppedBy: 'field' | 'edge' | 'break' } {
  let text = '';
  for (let i = index + step; i >= 0 && i < list.length; i += step) {
    const node = list[i];
    if (typeof node === 'string') {
      text = step === -1 ? node + text : text + node;
      continue;
    }
    if ('f' in node || 'tbl' in node) return { text, stoppedBy: 'field' };
    if (node.t === 'br' || !INLINE.has(node.t) || tablesIn(node.k ?? []).length > 0) return { text, stoppedBy: 'break' };
    if ((node.k ?? []).some((child) => typeof child !== 'string' && 'f' in child)) return { text, stoppedBy: 'field' };
    const inner = form26NodeText(node.k);
    text = step === -1 ? inner + text : text + inner;
  }
  return { text, stoppedBy: 'edge' };
}

/** The text of the nearest element before a position that has words, climbing out of the containers. */
function nearestBefore(frames: Frame[]): string {
  for (let level = frames.length - 1; level >= 0; level -= 1) {
    const { list, index } = frames[level];
    for (let i = index - 1; i >= 0; i -= 1) {
      const node = list[i];
      if (isWhitespace(node)) continue;
      if (typeof node === 'string') return node;
      if ('f' in node || 'tbl' in node) return '';
      const text = form26NodeText(node.k);
      if (text.trim() !== '') return text;
    }
  }
  return '';
}

/** The local label of every answer in some nodes: the words beside it, as a reader of the form sees them. */
function localLabelsIn(nodes: Form26Node[], into: Map<string, string>, skip: (key: string) => boolean): void {
  const visit = (list: Form26Node[], frames: Frame[]) => {
    list.forEach((node, index) => {
      if (typeof node === 'string') return;
      const here = [...frames, { list, index }];
      if ('f' in node) {
        if (into.has(node.f) || skip(node.f)) return;
        let label = '';
        if (node.rv === undefined) {
          const before = run(list, index, -1);
          const after = run(list, index, 1);
          label = before.text;
          if (wordCount(before.text) < 3 && after.stoppedBy !== 'field' && after.text.trim() !== '') label = `${before.text} ${after.text}`;
        }
        if (label.trim() === '') label = nearestBefore(here);
        into.set(node.f, cleanLabel(label));
        return;
      }
      if ('t' in node && node.k) visit(node.k, here);
    });
  };
  visit(nodes, []);
}

const LABELS = new WeakMap<Form26Definition, Map<string, string>>();

function localLabels(def: Form26Definition): Map<string, string> {
  let labels = LABELS.get(def);
  if (!labels) {
    labels = new Map();
    for (const row of def.questionRows) {
      const rowLabels = new Map<string, string>();
      // Inside a question row the wording names the row; the label is only what sits beside the control.
      const visit = (list: Form26Node[], frames: Frame[]) => {
        list.forEach((node, index) => {
          if (typeof node === 'string') return;
          const here = [...frames, { list, index }];
          if ('f' in node) {
            if (rowLabels.has(node.f)) return;
            if (node.rv !== undefined) {
              rowLabels.set(node.f, '');
              return;
            }
            const before = run(list, index, -1);
            const after = run(list, index, 1);
            let label = before.text;
            if (wordCount(before.text) < 3 && after.stoppedBy !== 'field' && after.text.trim() !== '') label = `${before.text} ${after.text}`;
            if (label.trim() === '' && frames.length > 0) label = nearestBefore(here);
            rowLabels.set(node.f, cleanLabel(label));
            return;
          }
          if ('t' in node && node.k) visit(node.k, here);
        });
      };
      visit(row.answer, []);
      for (const [key, label] of rowLabels) labels.set(key, label);
    }
    const inRows = new Set(def.fields.filter((field) => field.questionRow !== null).map((field) => field.key));
    localLabelsIn(def.tree.main, labels, (key) => inRows.has(key));
    LABELS.set(def, labels);
  }
  return labels;
}

function fieldOf(def: Form26Definition, key: string): Form26Field {
  const field = def.fields.find((entry) => entry.key === key);
  if (!field) throw new Error(`Form 26 has no answer key "${key}"`);
  return field;
}

/** The words beside an answer's control ('' when its question's wording alone names it). */
export function form26FieldLocalLabel(def: Form26Definition, key: string): string {
  fieldOf(def, key);
  return localLabels(def).get(key) ?? '';
}

/** The full accessible name of an answer: its question's wording and the words beside it. */
export function form26FieldAccessibleName(def: Form26Definition, key: string): string {
  const field = fieldOf(def, key);
  const local = form26FieldLocalLabel(def, key);
  const wording = field.questionRow !== null ? def.questionRows[field.questionRow]?.wording ?? '' : '';
  const name = [wording, local].filter((part) => part.trim() !== '').join(' ');
  return name !== '' ? name : cleanLabel(field.label.replace(/\[[^\]]*\]/g, ' '));
}

// ---------------------------------------------------------------------------------------------------
// Ids on screen (fixed, so "Next unfilled" and labels can find a control)

const safe = (text: string) => text.replace(/[^A-Za-z0-9_-]/g, '-');
export const form26FieldDomId = (key: string) => `f26-f-${safe(key)}`;
export const form26FieldLabelId = (key: string) => `${form26FieldDomId(key)}-label`;
export const form26WordingId = (rowIndex: number) => `f26-q${rowIndex}-wording`;
export const form26CellDomId = (tableId: string, row: number, column: string) => `f26-t-${safe(tableId)}-${row}-${safe(column)}`;
export const form26TableDomId = (tableId: string) => `f26-t-${safe(tableId)}`;
export const form26ScheduleDomId = (scheduleId: string) => `f26-s-${safe(scheduleId)}`;

// ---------------------------------------------------------------------------------------------------
// Keys, conflicts, provenance, save state

/** Y chooses Yes and N chooses No on a focused yes/no; any other key does nothing here. */
export function yesNoForKey(key: string): 'Yes' | 'No' | null {
  if (key === 'y' || key === 'Y') return 'Yes';
  if (key === 'n' || key === 'N') return 'No';
  return null;
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * A stored time as the user's clock shows it ("16:42"). The database writes UTC as "YYYY-MM-DD HH:MM:SS";
 * a time with its own zone is read as it is. '' when the text is not a time.
 */
export function form26ClockTime(at: string): string {
  const text = (at ?? '').trim();
  let ms = Number.NaN;
  if (/(Z|[+-]\d{2}:?\d{2})$/.test(text)) ms = Date.parse(text);
  else {
    const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(text);
    if (m) ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] ?? '0'));
  }
  if (!Number.isFinite(ms)) return '';
  const date = new Date(ms);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * Leaving a text box: save only what the user changed since the box took the keyboard. A box entered and left
 * without typing shows the answer as stored now (someone else's value may have arrived while it had the keyboard;
 * a box with the keyboard is never repainted), and nothing is saved, so no clash is raised for a box not touched.
 */
export function form26LeaveAction(input: { atFocus: string; draft: string; value: string }): 'commit' | 'show-stored' | 'none' {
  if (input.draft === input.value) return 'none';
  return input.draft === input.atFocus ? 'show-stored' : 'commit';
}

/** A clause approved by someone else while the user typed in it: the entry was not saved, "Use theirs" is the only choice. */
const APPROVED_WHILE_TYPING = 'This clause was approved while you were typing. Your entry was not saved.';

/** The line under an answer that met someone else's change, and the answers it offers. */
export function fieldConflictLine(conflict: { theirs: string; at: string }, locked: boolean): { text: string; actions: ('mine' | 'theirs')[] } {
  if (locked) return { text: APPROVED_WHILE_TYPING, actions: ['theirs'] };
  const time = form26ClockTime(conflict.at);
  return { text: time ? `Changed by someone else at ${time}.` : 'Changed by someone else.', actions: ['mine', 'theirs'] };
}

const PREFILL_KEYS = new Set<string>(Object.values(FORM26_PREFILL_KEYS));

/**
 * Where the answers of a clause came from: 'client-master' (filled when the audit was created),
 * 'brought-from-3cd' (not yet confirmed), null for an answer that can carry such a mark but has none now
 * (its line is kept so nothing moves), undefined for an answer that never carries one.
 */
export function clauseProvenance(row: Form26ClauseRow | undefined, keys: string[]): Record<string, Form26Provenance | null | undefined> {
  const out: Record<string, Form26Provenance | null | undefined> = {};
  if (!row) {
    for (const key of keys) out[key] = undefined;
    return out;
  }
  const payload = parseClausePayload(row.response_json);
  const anyBrought = payload.brought !== undefined && Object.keys(payload.brought).length > 0;
  for (const key of keys) {
    if (payload.brought?.[key]) out[key] = 'brought-from-3cd';
    else if (PREFILL_KEYS.has(key)) out[key] = row.prefill_status === 'auto_filled' ? 'client-master' : null;
    else out[key] = anyBrought ? null : undefined;
  }
  return out;
}

export function fieldProvenance(row: Form26ClauseRow | undefined, key: string): Form26Provenance | null | undefined {
  return clauseProvenance(row, [key])[key];
}

/**
 * What the save state says in the header (and announces): plain sentences, a retry only after a failure.
 * `locked`: the clause of the clash was approved meanwhile, so there is no entry to choose (only "Use theirs").
 */
export function form26SaveStatus(
  state: Form26SaveState,
  clock: (ms: number) => string,
  opts?: { locked?: boolean },
): { text: string; tone: 'quiet' | 'warning' | 'error'; retry: boolean } {
  switch (state.kind) {
    case 'idle':
      return { text: '', tone: 'quiet', retry: false };
    case 'saving':
      return { text: 'Saving…', tone: 'quiet', retry: false };
    case 'saved':
      return { text: `Saved ${clock(state.at)}`, tone: 'quiet', retry: false };
    case 'failed':
      return { text: 'Could not save. Your entry is still on screen. Try again.', tone: 'error', retry: true };
    case 'changed-elsewhere':
      if (opts?.locked) return { text: APPROVED_WHILE_TYPING, tone: 'warning', retry: false };
      return { text: 'Someone else changed this clause. Choose which entry to keep.', tone: 'warning', retry: false };
  }
}
