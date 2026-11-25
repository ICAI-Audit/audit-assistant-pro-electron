// The working-paper pack of a Form No. 26 audit (BUILD-PLAN task 24; a Word document by the lead's ruling, as
// chartered accountants open it in Word): a title block (title, client, tax year, when it was made; no draft
// notice, by the owner's ruling of 22 Nov 2026), an index of the 57 clauses with their state, then for every clause in the form's order: its number and
// label, its working-paper reference and state with who marked it and when, its answers as text with the form's
// wording (from the export model, so exactly what the Word and PDF exports print), the tables under it, the evidence
// linked to it with references, the review remarks and the qualification. The pack is a working paper: remarks and
// qualification belong here, and never in the Form No. 26 exports (L9). No comparison text is in it.
import { AlignmentType, Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableLayoutType, TableRow, TextRun, WidthType } from 'docx';
import { FORM26_CLAUSE_UNITS, form26ClauseKeyOfTable, type Form26ClauseUnit } from '@/data/taxAuditForm26Clauses';
import type { Form26Definition } from '@/data/taxAuditForm26Types';
import {
  buildForm26ExportModel,
  exportedValue,
  form26RunsText,
  type Form26ExportBlock,
  type Form26ExportTable,
} from '@/lib/taxAuditForm26ExportModel';
import { form26FieldAccessibleName, FORM26_REVIEW_LABEL } from '@/lib/taxAuditForm26EditorModel';
import { form26UnitTitle } from '@/lib/taxAuditForm26Import';
import { isUnitInReport } from '@/lib/taxAuditForm26Readiness';
import { categoryOf, isFieldShown } from '@/lib/taxAuditForm26Reveal';
import { form26PlainText } from '@/lib/taxAuditForm26Review';
import { fileStem } from '@/lib/taxAuditForm26SaveFile';
import type { Form26ClauseRow } from '@/lib/taxAuditForm26Store';
import { getField, type Form26Values } from '@/lib/taxAuditForm26Values';
import { FORM26_DOCX_MIME, FORM26_WORD_PORTRAIT, form26WordStyles, form26WordTable } from '@/lib/taxAuditForm26Word';
import type { TaxAuditClauseEvidence } from '@/types/taxAudit';

export type Form26PackInput = {
  def: Form26Definition;
  values: Form26Values;
  rowsByKey: Map<string, Form26ClauseRow>;
  evidence: TaxAuditClauseEvidence[];
  files: { id: string; name: string }[];
  /** Names of the users who marked clauses, by user id. */
  users: Record<string, string>;
  clientName: string;
  financialYear: string;
  generatedAt: string;
  showAllSchedules?: boolean;
};
export type Form26PackAnswer = { no: string; wording: string; answer: string };
export type Form26PackClause = {
  key: string;
  no: string;
  heading: string;
  reference: string;
  state: string;
  stamps: string[];
  /** Said instead of answers when the clause is not part of this report (the other category's Part). */
  note: string | null;
  answers: Form26PackAnswer[];
  tables: { title: string; table: Form26ExportTable }[];
  evidence: string[];
  remarks: string;
  qualification: string | null;
};
export type Form26PackModel = {
  title: string;
  fileStem: string;
  clientName: string;
  financialYear: string;
  generatedAt: string;
  index: { no: string; title: string; label: string; state: string }[];
  clauses: Form26PackClause[];
};

const NOT_FILLED = 'Not filled';
const pad = (n: number) => String(n).padStart(2, '0');

/** A time as the pack writes it: dd/mm/yyyy, hh:mm (this computer's time). */
export function form26StampTime(iso: string | null | undefined): string {
  const date = iso ? new Date(iso) : null;
  if (!date || Number.isNaN(date.getTime())) return '';
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}, ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// An answer as plain text: the blank of the export (non-breaking spaces) becomes "Not filled".
function answerText(text: string): string {
  const plain = text.replace(/\u00A0/g, ' ').replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').trim();
  return plain === '' ? NOT_FILLED : plain;
}

function walk(blocks: Form26ExportBlock[], onQuestion: (row: Extract<Form26ExportBlock, { kind: 'questions' }>['rows'][number]) => void, onTable: (table: Form26ExportTable) => void) {
  for (const block of blocks) {
    if (block.kind === 'questions') {
      for (const row of block.rows) {
        if (row.fullWidth) walk(row.fullWidth, onQuestion, onTable);
        else onQuestion(row);
      }
    } else if (block.kind === 'table' && block.id !== '') onTable(block);
    else if (block.kind === 'notes') for (const item of block.items) walk(item, onQuestion, onTable);
  }
}

function stampLine(verb: string, who: string | null | undefined, at: string | null | undefined, users: Record<string, string>): string | null {
  if (!who && !at) return null;
  const name = who ? users[who] ?? 'a user no longer listed' : 'a user no longer listed';
  const time = form26StampTime(at);
  return `${verb} by ${name}${time ? ` on ${time}` : ''}`;
}

export function buildForm26Pack(input: Form26PackInput): Form26PackModel {
  const { def, values, rowsByKey } = input;
  const view = { showAllSchedules: input.showAllSchedules ?? false };
  const model = buildForm26ExportModel(def, values, { showAllSchedules: view.showAllSchedules, generatedAt: input.generatedAt });

  // The export model's question rows and tables, under the clause they belong to.
  const unitOfRow = new Map<number, string>();
  for (const unit of FORM26_CLAUSE_UNITS) for (const index of unit.questionRows) unitOfRow.set(index, unit.key);
  const answersOf = new Map<string, Form26PackAnswer[]>();
  const tablesOf = new Map<string, Form26ExportTable[]>();
  const push = <T,>(map: Map<string, T[]>, key: string, item: T) => map.set(key, [...(map.get(key) ?? []), item]);
  walk(
    [...model.portrait, ...model.landscape],
    (row) => {
      const key = unitOfRow.get(row.index);
      if (key) push(answersOf, key, { no: row.no, wording: form26RunsText(row.wording).replace(/\u00A0/g, ' ').trim(), answer: answerText(form26RunsText(row.answer)) });
    },
    (table) => push(tablesOf, form26ClauseKeyOfTable(table.id), table),
  );

  const fileName = new Map(input.files.map((file) => [file.id, file.name]));
  const category = categoryOf(values);
  const fieldByKey = new Map(def.fields.map((field) => [field.key, field]));
  const tableTitle = (unit: Form26ClauseUnit, id: string): string => {
    const schedule = def.tables.find((table) => table.id === id)?.schedule;
    const title = schedule ? def.schedules.find((entry) => entry.id === schedule)?.title : undefined;
    return title ?? `The table of ${form26UnitTitle(unit).replace(/^Clause/, 'clause').replace(/^Item/, 'item')}`;
  };

  const clauses: Form26PackClause[] = FORM26_CLAUSE_UNITS.map((unit) => {
    const row = rowsByKey.get(unit.key);
    const title = form26UnitTitle(unit);
    const inReport = isUnitInReport(unit, values);
    let answers = answersOf.get(unit.key) ?? [];
    // A unit without question rows (the category, Parts A and B, the signature): each answer with the words that
    // name it on screen (the words beside it in the report's text), not the whole paragraph it sits in.
    if (unit.questionRows.length === 0 && inReport) {
      answers = unit.fields
        .filter((key) => isFieldShown(def, key, values, view))
        .map((key) => {
          const field = fieldByKey.get(key);
          const value = getField(values, key);
          const shown = field?.kind === 'radio' ? field.radioOptions?.find((option) => option.value === value)?.label ?? '' : exportedValue(field?.kind ?? 'text', value);
          return { no: '', wording: form26FieldAccessibleName(def, key) || field?.label || key, answer: answerText(shown) };
        });
    }
    const stamps = row
      ? [stampLine('Prepared', row.prepared_by, row.prepared_at, input.users), stampLine('Reviewed', row.reviewed_by, row.reviewed_at, input.users), stampLine('Approved', row.approved_by, row.approved_at, input.users)].filter((line): line is string => line !== null)
      : [];
    const evidence = input.evidence
      .filter((link) => link.clause_key === unit.key)
      .map((link) => `${fileName.get(link.evidence_file_id) ?? 'A file no longer in the Evidence Vault'}${link.workpaper_ref ? ` (${link.workpaper_ref})` : ''}`);
    return {
      key: unit.key,
      no: unit.no,
      heading: title === unit.label ? title : `${title} · ${unit.label}`,
      reference: row?.workpaper_ref || unit.workpaperRef,
      state: FORM26_REVIEW_LABEL[row?.review_status ?? 'draft'] ?? 'Draft',
      stamps,
      note: inReport ? null : `Not part of the report for category ${category === '1' ? '(i)' : '(ii)'}.`,
      answers: inReport ? answers : [],
      tables: inReport ? (tablesOf.get(unit.key) ?? []).map((table) => ({ title: tableTitle(unit, table.id), table })) : [],
      evidence,
      remarks: form26PlainText(row?.auditor_remarks_html),
      qualification: row?.qualification_required ? form26PlainText(row.qualification_text_html) || 'Marked for qualification; no text written.' : null,
    };
  });

  return {
    title: 'Form No. 26: working papers',
    fileStem: fileStem(values),
    clientName: input.clientName,
    financialYear: String(input.financialYear ?? '').trim(),
    generatedAt: form26StampTime(input.generatedAt),
    index: FORM26_CLAUSE_UNITS.map((unit, at) => {
      const title = form26UnitTitle(unit);
      return { no: unit.no, title, label: title === unit.label ? '' : unit.label, state: clauses[at].state };
    }),
    clauses,
  };
}

export const form26PackFileName = (pack: Pick<Form26PackModel, 'fileStem'>) => `${pack.fileStem}_working-papers.docx`;

/** The pack as lines of text, in the order of the document (tests; the cells of a table apart by a tab). */
export function form26PackLines(pack: Form26PackModel): string[] {
  const lines = [pack.title, `Client: ${pack.clientName}`, `Tax year: ${pack.financialYear}`, `Generated: ${pack.generatedAt}`, 'Index'];
  for (const entry of pack.index) lines.push(`${entry.title}\t${entry.label}\t${entry.state}`);
  for (const clause of pack.clauses) {
    lines.push(clause.heading, `Working paper ${clause.reference} · ${clause.state}`, ...clause.stamps);
    if (clause.note) lines.push(clause.note);
    for (const answer of clause.answers) lines.push([answer.no, answer.wording, answer.answer].filter((part) => part !== '').join('\t'));
    for (const { title, table } of clause.tables) {
      lines.push(title);
      for (const head of table.head) lines.push(head.map((cell) => cell.text).join('\t'));
      for (const body of table.body) lines.push(body.join('\t'));
      if (table.total) lines.push(table.total.join('\t'));
    }
    lines.push('Evidence', ...(clause.evidence.length > 0 ? clause.evidence : ['No evidence linked.']));
    lines.push('Review remarks', ...(clause.remarks !== '' ? clause.remarks.split('\n') : ['None.']));
    lines.push('Qualification', ...(clause.qualification !== null ? clause.qualification.split('\n') : ['Not marked for qualification.']));
  }
  return lines;
}

// ---------------------------------------------------------------------------------------------------
// The Word document

const ROOM = FORM26_WORD_PORTRAIT.room;
const text = (value: string, look: { bold?: boolean; size?: number; italics?: boolean } = {}) =>
  value.split('\n').map((line, i) => new TextRun({ text: line, bold: look.bold, size: look.size, italics: look.italics, break: i > 0 ? 1 : undefined }));
const para = (value: string, look: { bold?: boolean; size?: number; italics?: boolean; after?: number } = {}) =>
  new Paragraph({ children: text(value, look), spacing: { before: 0, after: look.after ?? 80 } });
const heading = (value: string, level: 1 | 2 | 3) =>
  new Paragraph({ children: text(value), heading: level === 1 ? HeadingLevel.HEADING_1 : level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3, spacing: { before: level === 2 ? 280 : 160, after: 80 }, keepNext: true });
const spacer = () => new Paragraph({ children: [], spacing: { before: 0, after: 80 } });

function plainTable(rows: string[][], shares: number[], headed: boolean): Table {
  const widths = shares.map((share) => Math.round(share * ROOM));
  return new Table({
    width: { size: widths.reduce((a, b) => a + b, 0), type: WidthType.DXA },
    columnWidths: widths,
    layout: TableLayoutType.FIXED,
    margins: { top: 40, bottom: 40, left: 80, right: 80 },
    rows: rows.map(
      (cells, r) =>
        new TableRow({
          tableHeader: headed && r === 0,
          cantSplit: true,
          children: cells.map(
            (value, c) =>
              new TableCell({
                width: { size: widths[c], type: WidthType.DXA },
                children: [new Paragraph({ children: text(value, { bold: headed && r === 0, size: 20 }), spacing: { before: 0, after: 0 }, alignment: AlignmentType.LEFT })],
              }),
          ),
        }),
    ),
  });
}

/** The pack as a Word document (A4 portrait, the Word export's styles; every clause a Heading 2). */
export async function buildForm26PackDocx(pack: Form26PackModel): Promise<Blob> {
  const children: (Paragraph | Table)[] = [
    heading(pack.title, 1),
    para(`Client: ${pack.clientName}`),
    para(`Tax year: ${pack.financialYear}`),
    para(`Generated: ${pack.generatedAt}`),
    heading('Index', 2),
    plainTable([['Clause', 'Subject', 'State'], ...pack.index.map((entry) => [entry.title, entry.label, entry.state])], [0.16, 0.66, 0.18], true),
  ];
  for (const clause of pack.clauses) {
    children.push(heading(clause.heading, 2), para(`Working paper ${clause.reference} · ${clause.state}`, { bold: true }));
    for (const stamp of clause.stamps) children.push(para(stamp, { after: 40 }));
    if (clause.note) children.push(para(clause.note, { italics: true }));
    if (clause.answers.length > 0) {
      children.push(heading('Answers', 3));
      const numbered = clause.answers.some((answer) => answer.no !== '');
      children.push(
        numbered
          ? plainTable(clause.answers.map((answer) => [answer.no, answer.wording, answer.answer]), [0.08, 0.52, 0.4], false)
          : plainTable(clause.answers.map((answer) => [answer.wording, answer.answer]), [0.5, 0.5], false),
        spacer(),
      );
    }
    for (const { title, table } of clause.tables) children.push(heading(title, 3), form26WordTable(table, ROOM), spacer());
    children.push(heading('Evidence', 3), ...(clause.evidence.length > 0 ? clause.evidence.map((line) => para(line, { after: 40 })) : [para('No evidence linked.')]));
    children.push(heading('Review remarks', 3), para(clause.remarks !== '' ? clause.remarks : 'None.'));
    children.push(heading('Qualification', 3), para(clause.qualification ?? 'Not marked for qualification.'));
  }
  const document = new Document({
    title: pack.title,
    creator: '',
    styles: form26WordStyles(),
    sections: [{ properties: { page: { size: FORM26_WORD_PORTRAIT.size, margin: FORM26_WORD_PORTRAIT.margin } }, children }],
  });
  const blob = await Packer.toBlob(document);
  return blob.type === FORM26_DOCX_MIME ? blob : new Blob([blob], { type: FORM26_DOCX_MIME });
}
