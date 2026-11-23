// The Word (.docx) export of Form No. 26, written from the export model (taxAuditForm26ExportModel.ts) with the
// look of the office's fillable file's own Word export (its style sheet): two sections, A4 portrait for the form
// (margins 54 pt top and bottom, 46 pt at the sides) and A4 landscape for the schedules (40 pt and 36 pt); Times
// New Roman 11 pt; tables 10 pt with single borders and their headings shaded EEEEEE; headings 15 pt (the form's
// name), 14 pt (Parts), 13 pt (Part D sections; schedule groups underlined), 11 pt; notes 9.5 pt. The draft
// notice is the first paragraph, 9 pt, as the Form 3CD Word export prints it.
import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  LevelFormat,
  LineRuleType,
  Packer,
  PageOrientation,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  WidthType,
  type IBorderOptions,
  type ParagraphChild,
} from 'docx';
import {
  form26ExportColumnShares,
  form26HeadColumns,
  type Form26ExportBlock,
  type Form26ExportModel,
  type Form26ExportTable,
  type Form26Run,
} from '@/lib/taxAuditForm26ExportModel';

export const FORM26_DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

// Sizes in half-points; lengths in twentieths of a point (twips).
const FONT = 'Times New Roman';
const SIZE = { body: 22, table: 20, note: 19, h1: 30, h2: 28, h3: 26, h4: 22 } as const;
const A4 = { width: 11906, height: 16838 };
const MARGIN = { portrait: { top: 1080, bottom: 1080, left: 920, right: 920 }, landscape: { top: 800, bottom: 800, left: 720, right: 720 } };
const ROOM = { portrait: A4.width - 920 * 2, landscape: A4.height - 720 * 2 };
const INDENT = 330; // 22 px
const NOTES = 'form26-notes';
const LINE: IBorderOptions = { style: BorderStyle.SINGLE, size: 4, color: '000000', space: 0 };
const NO_LINE: IBorderOptions = { style: BorderStyle.NONE, size: 0, color: 'auto', space: 0 };
const BORDERS = { top: LINE, bottom: LINE, left: LINE, right: LINE, insideHorizontal: LINE, insideVertical: LINE };
const NO_BORDERS = { top: NO_LINE, bottom: NO_LINE, left: NO_LINE, right: NO_LINE, insideHorizontal: NO_LINE, insideVertical: NO_LINE };
const CELL_MARGINS = { top: 60, bottom: 60, left: 80, right: 80 };
const QUESTION_SHARES = [0.07, 0.55, 0.38];
const SIGNATURE_SHARES = [0.14, 0.26, 0.3, 0.3];

type Page = 'portrait' | 'landscape';
/**
 * How a paragraph's text looks. `style`: the paragraph style giving the size ('cell' 10 pt in tables, 'note'
 * 9.5 pt; none: the body's 11 pt); `size` only where a paragraph differs from its style (headings, the notice).
 * Sizes are set once on the style, not on every run, so a long table stays a small file and is quick to write.
 */
type Look = { style?: 'cell' | 'note'; size?: number; bold?: boolean; italic?: boolean; underline?: boolean };
const STYLE_ID = { cell: 'Form26Cell', note: 'Form26Note' } as const;
const STYLE_SIZE = { cell: SIZE.table, note: SIZE.note } as const;

/** Runs of text: a line break inside a text (long text) or after a run (`breakAfter`) becomes a Word line break. */
function textRuns(runs: Form26Run[], look: Look): ParagraphChild[] {
  const base = look.style ? STYLE_SIZE[look.style] : SIZE.body;
  const out: ParagraphChild[] = [];
  for (const run of runs) {
    const size = run.small ? SIZE.note : look.size ?? base;
    const options = {
      size: look.size !== undefined || size !== base ? size : undefined,
      bold: run.bold || look.bold || undefined,
      italics: run.italic || look.italic || undefined,
      underline: run.underline || look.underline ? {} : undefined,
    };
    run.text.split('\n').forEach((line, i) => out.push(new TextRun({ ...options, text: line, break: i > 0 ? 1 : undefined })));
    if (run.breakAfter) out.push(new TextRun({ ...options, break: 1 }));
  }
  return out;
}

const plainRuns = (text: string): Form26Run[] => [{ text }];

/** A thin empty line after a table: two tables never touch (Word would join them into one). */
const spacer = () => new Paragraph({ children: [], spacing: { before: 0, after: 0, line: 120, lineRule: LineRuleType.EXACT } });

function paragraph(runs: Form26Run[], look: Look, extra: { centred?: boolean; right?: boolean; indent?: boolean; after?: number; before?: number } = {}) {
  return new Paragraph({
    children: textRuns(runs, look),
    style: look.style ? STYLE_ID[look.style] : undefined,
    alignment: extra.centred ? AlignmentType.CENTER : extra.right ? AlignmentType.RIGHT : undefined,
    indent: extra.indent ? { left: INDENT } : undefined,
    spacing: look.style === 'cell' && extra.before === undefined && extra.after === undefined ? undefined : { before: extra.before ?? 0, after: extra.after ?? 0 },
  });
}

function cell(children: Paragraph[] | Table[], width: number, extra: { shaded?: boolean; columnSpan?: number; rowSpan?: number } = {}) {
  return new TableCell({
    children,
    width: { size: Math.round(width), type: WidthType.DXA },
    shading: extra.shaded ? { fill: 'EEEEEE', color: 'auto', type: ShadingType.CLEAR } : undefined,
    columnSpan: extra.columnSpan && extra.columnSpan > 1 ? extra.columnSpan : undefined,
    rowSpan: extra.rowSpan && extra.rowSpan > 1 ? extra.rowSpan : undefined,
  });
}

function grid(shares: number[], room: number) {
  const widths = shares.map((share) => Math.max(200, Math.round(share * room)));
  const span = (from: number, count: number) => widths.slice(from, from + count).reduce((a, b) => a + b, 0);
  return { widths, span };
}

function tableOf(rows: TableRow[], widths: number[], borders = BORDERS) {
  return new Table({
    rows,
    width: { size: widths.reduce((a, b) => a + b, 0), type: WidthType.DXA },
    columnWidths: widths,
    layout: TableLayoutType.FIXED,
    margins: CELL_MARGINS,
    borders,
  });
}

/** One of the form's tables: header rows (repeated on each page), body, Total line. */
function formTable(block: Form26ExportTable, room: number): Table {
  const shares = form26ExportColumnShares(block);
  const { widths, span } = grid(shares, block.id === '' ? room * 0.75 : room);
  const starts = form26HeadColumns(block.head);
  const rows: TableRow[] = block.head.map(
    (head, r) =>
      new TableRow({
        tableHeader: true,
        cantSplit: true,
        children: head.map((headCell, i) =>
          cell([paragraph(plainRuns(headCell.text), { style: 'cell', bold: headCell.tag === 'th' })], span(starts[r][i], headCell.colspan ?? 1), {
            shaded: headCell.tag === 'th',
            columnSpan: headCell.colspan,
            rowSpan: headCell.rowspan,
          }),
        ),
      }),
  );
  for (const body of block.body) {
    rows.push(new TableRow({ cantSplit: true, children: body.map((text, c) => cell([paragraph(plainRuns(text), { style: 'cell' })], widths[c])) }));
  }
  if (block.total) {
    const labelSpan = block.totalSpan ?? 1;
    const children = block.total.map((text, i) =>
      i === 0
        ? cell([paragraph(plainRuns(text), { style: 'cell' }, { right: true })], span(0, labelSpan), { columnSpan: labelSpan })
        : cell([paragraph(plainRuns(text), { style: 'cell' }, { right: true })], widths[labelSpan + i - 1]),
    );
    rows.push(new TableRow({ cantSplit: true, children }));
  }
  return tableOf(rows, widths);
}

/** The question rows of Part C or a Part D section: number | wording | answer; a table across a row stands on its own. */
function questions(block: Extract<Form26ExportBlock, { kind: 'questions' }>, room: number, writing: Writing): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [];
  const { widths } = grid(QUESTION_SHARES, room);
  let rows: TableRow[] = [];
  const close = () => {
    if (rows.length > 0) out.push(tableOf(rows, widths), spacer());
    rows = [];
  };
  for (const row of block.rows) {
    if (row.fullWidth) {
      close();
      out.push(...blocks(row.fullWidth, room, writing));
      continue;
    }
    rows.push(
      new TableRow({
        children: [
          cell([paragraph(plainRuns(row.no), { style: 'cell' })], widths[0]),
          cell([paragraph(row.wording, { style: 'cell' })], widths[1]),
          cell([paragraph(row.answer, { style: 'cell' })], widths[2]),
        ],
      }),
    );
  }
  close();
  return out;
}

/** Place, Date on the left; the accountant's particulars on the right; "Signature" under them, as in the form. */
function signature(block: Extract<Form26ExportBlock, { kind: 'signature' }>, room: number): Table {
  const { widths, span } = grid(SIGNATURE_SHARES, room);
  const empty = (width: number, columnSpan?: number) => cell([new Paragraph({ children: [] })], width, { columnSpan });
  const rows = block.lines.map((line) => {
    const label = cell([paragraph(plainRuns(line.label), { bold: true })], line.side === 'left' ? widths[0] : widths[2]);
    const value = cell([paragraph(plainRuns(line.value), {})], line.side === 'left' ? widths[1] : widths[3]);
    return new TableRow({ children: line.side === 'left' ? [label, value, empty(widths[2]), empty(widths[3])] : [empty(span(0, 2), 2), label, value] });
  });
  if (block.closing !== '') {
    rows.push(
      new TableRow({
        children: [empty(span(0, 2), 2), cell([paragraph(plainRuns(block.closing), { italic: true }, { right: true, before: 360 })], span(2, 2), { columnSpan: 2 })],
      }),
    );
  }
  return tableOf(rows, widths, NO_BORDERS);
}

const HEADING = {
  1: { style: HeadingLevel.HEADING_1, size: SIZE.h1, before: 0, after: 60 },
  2: { style: HeadingLevel.HEADING_2, size: SIZE.h2, before: 360, after: 120 },
  3: { style: HeadingLevel.HEADING_3, size: SIZE.h3, before: 280, after: 120 },
  4: { style: HeadingLevel.HEADING_4, size: SIZE.h4, before: 200, after: 80 },
} as const;

/** Each list of notes numbers from 1 (a numbering instance of its own). */
type Writing = { lists: number };

function blocks(list: Form26ExportBlock[], room: number, writing: Writing, inNotes = false): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [];
  for (const block of list) {
    switch (block.kind) {
      case 'heading': {
        const look = HEADING[block.level];
        out.push(
          new Paragraph({
            heading: look.style,
            alignment: block.centred ? AlignmentType.CENTER : undefined,
            spacing: { before: look.before, after: look.after },
            keepNext: true,
            children: textRuns(plainRuns(block.text), { size: look.size, bold: true, underline: block.underlined }),
          }),
        );
        break;
      }
      case 'para': {
        const look: Look = inNotes || block.small ? { style: 'note' } : {};
        out.push(paragraph(block.runs, look, { centred: block.centred, indent: block.indent, after: 120 }));
        break;
      }
      case 'questions':
        out.push(...questions(block, room, writing));
        break;
      case 'table':
        out.push(formTable(block, room), spacer());
        break;
      case 'signature':
        out.push(signature(block, room), spacer());
        break;
      case 'notes': {
        writing.lists += 1;
        const instance = writing.lists;
        out.push(paragraph(plainRuns(block.title), { style: 'note', bold: true }, { before: 120, after: 60 }));
        for (const item of block.items) {
          item.forEach((inner, i) => {
            if (inner.kind === 'para' && i === 0) {
              out.push(
                new Paragraph({
                  children: textRuns(inner.runs, { style: 'note' }),
                  style: STYLE_ID.note,
                  numbering: { reference: NOTES, level: 0, instance },
                  spacing: { before: 0, after: 40 },
                }),
              );
            } else out.push(...blocks([inner], room * 0.9, writing, true));
          });
        }
        break;
      }
    }
  }
  return out;
}

const headingStyle = (size: number) => ({ run: { font: FONT, size, bold: true, color: '000000' }, paragraph: { spacing: { before: 0, after: 0 } } });

/** The document styles of the Form No. 26 Word files (also the working-paper pack's, so its tables look the same). */
export function form26WordStyles() {
  return {
    default: {
      document: { run: { font: FONT, size: SIZE.body } },
      heading1: headingStyle(SIZE.h1),
      heading2: headingStyle(SIZE.h2),
      heading3: headingStyle(SIZE.h3),
      heading4: headingStyle(SIZE.h4),
    },
    paragraphStyles: [
      { id: STYLE_ID.cell, name: 'Form 26 table text', basedOn: 'Normal', run: { size: SIZE.table }, paragraph: { spacing: { before: 0, after: 0 } } },
      { id: STYLE_ID.note, name: 'Form 26 note', basedOn: 'Normal', run: { size: SIZE.note } },
    ],
  };
}

/** A4 portrait as the Word export sets it, and the width it leaves for text (twips). */
export const FORM26_WORD_PORTRAIT = { size: { width: A4.width, height: A4.height, orientation: PageOrientation.PORTRAIT }, margin: MARGIN.portrait, room: ROOM.portrait };

/** One of the form's tables as the Word export draws it (headings repeated on each page, Total line); needs `form26WordStyles`. */
export function form26WordTable(block: Form26ExportTable, room: number): Table {
  return formTable(block, room);
}

/** The .docx of the model. */
export async function buildForm26Docx(model: Form26ExportModel): Promise<Blob> {
  const writing: Writing = { lists: 0 };
  const section = (page: Page, children: (Paragraph | Table)[]) => ({
    properties: {
      page: {
        size: { width: A4.width, height: A4.height, orientation: page === 'portrait' ? PageOrientation.PORTRAIT : PageOrientation.LANDSCAPE },
        margin: MARGIN[page],
      },
    },
    children,
  });
  const sections = [section('portrait', blocks(model.portrait, ROOM.portrait, writing))];
  if (model.landscape.length > 0) sections.push(section('landscape', blocks(model.landscape, ROOM.landscape, writing)));
  const document = new Document({
    title: 'Form No. 26',
    creator: '',
    styles: form26WordStyles(),
    numbering: {
      config: [
        {
          reference: NOTES,
          levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360, hanging: 360 } }, run: { size: SIZE.note } } }],
        },
      ],
    },
    sections,
  });
  const blob = await Packer.toBlob(document);
  return blob.type === FORM26_DOCX_MIME ? blob : new Blob([blob], { type: FORM26_DOCX_MIME });
}

export const form26DocxFileName = (model: Form26ExportModel) => `${model.fileStem}.docx`;

