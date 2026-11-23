// The PDF export of Form No. 26: the same export model as the Word export (taxAuditForm26ExportModel.ts), in the
// same order, planned as a list of drawing steps (pure, tested) and drawn with jsPDF + jspdf-autotable as the
// Form 3CD PDF is. Portrait A4 pages for the form, landscape A4 pages for the schedules (the margins of the Word
// export); no draft notice (owner's ruling of 22 Nov 2026): the first text is the form's own heading. A wide
// table keeps every column: its font steps 9 → 8 → 7 → 6 pt by its number of columns (6 or fewer, 9, 12, more),
// headings and values wrap and are never cut; a row is never split between two pages, and the table's headings
// are repeated on every page it runs onto.
// The PDF's own fonts (Times) hold the Windows Latin set only. The form's tick boxes "☑" and "☐" are drawn as small
// squares standing on the baseline of their line (the chosen one with a tick of two strokes), in the room the text
// keeps for them (FORM26_PDF_BOX); "₹" is printed as "Rs." (FORM26_PDF_SUBSTITUTES: no font with that sign and a
// free licence is in the repository or its packages); everything else is printed as the form has it.
import { jsPDF } from 'jspdf';
import autoTable, { type CellDef, type RowInput } from 'jspdf-autotable';
import {
  form26ExportColumnShares,
  form26RunsText,
  type Form26ExportBlock,
  type Form26ExportModel,
  type Form26Run,
} from '@/lib/taxAuditForm26ExportModel';

/** `boxes`: the tick boxes drawn in the rooms (FORM26_PDF_BOX) the text keeps for them, in order (true = chosen). */
export type Form26PdfCell = string | { content: string; colSpan?: number; rowSpan?: number; bold?: boolean; italic?: boolean; fill?: boolean; align?: 'left' | 'center' | 'right'; boxes?: boolean[] };
export type Form26PdfOp =
  | { op: 'page'; orientation: 'portrait' | 'landscape' }
  /** `heading`: kept on one page with what follows it (a heading never ends a page). `boxes`: as for a cell. */
  | { op: 'text'; text: string; size: number; bold?: boolean; italic?: boolean; underline?: boolean; align?: 'left' | 'center' | 'right'; indent?: number; heading?: true; boxes?: boolean[] }
  | { op: 'table'; head: Form26PdfCell[][]; body: Form26PdfCell[][]; foot?: Form26PdfCell[]; fontSize: number; columnShare: number[]; theme: 'grid' | 'plain'; widthShare?: number }
  | { op: 'space'; pt: number };

// ---------------------------------------------------------------------------------------------------
// Characters

/** What the PDF prints for the form's characters its standard font does not hold (the tick boxes are drawn). */
export const FORM26_PDF_SUBSTITUTES: Readonly<Record<string, string>> = { '₹': 'Rs.', '\u00A0': ' ' };
/**
 * The room a tick box takes in a line: three non-breaking spaces (3 x 0.25 em of Times). Every other non-breaking
 * space is printed as a space, so these are the only ones left in the printed text; and a line is never broken
 * inside the room (the PDF's line breaking splits at spaces only).
 */
export const FORM26_PDF_BOX = '\u00A0\u00A0\u00A0';
const BOX_CHOSEN = '☑';
const BOX_NOT_CHOSEN = '☐';
// Windows Latin (WinAnsi): printable ASCII, U+00A0-U+00FF, and these 27 of 0x80-0x9F.
const WIN_ANSI_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');

/** Can the PDF's standard font print this character as it is? (Line breaks and tabs count: they are layout.) */
export function isForm26PdfPrintable(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  if (char === '\n' || char === '\t') return true;
  if (code >= 0x20 && code <= 0x7e) return true;
  if (code > 0xa0 && code <= 0xff) return true;
  return WIN_ANSI_EXTRA.has(char);
}

/**
 * The text as the PDF prints it, and its tick boxes: each "☑" / "☐" becomes the room of a box (FORM26_PDF_BOX) and
 * one entry of `boxes` (true = chosen); the substitutes are put in; any other character outside the font is "?".
 */
export function form26PdfMarks(text: string): { text: string; boxes: boolean[] } {
  let out = '';
  const boxes: boolean[] = [];
  for (const char of text) {
    if (char === BOX_CHOSEN || char === BOX_NOT_CHOSEN) {
      out += FORM26_PDF_BOX;
      boxes.push(char === BOX_CHOSEN);
      continue;
    }
    out += FORM26_PDF_SUBSTITUTES[char] ?? (isForm26PdfPrintable(char) ? char : '?');
  }
  return { text: out, boxes };
}

/** The text as the PDF prints it (form26PdfMarks without the boxes, which are drawn). */
export function form26PdfText(text: string): string {
  return form26PdfMarks(text).text;
}

// A cell: the printed text, with its tick boxes when it has any.
function markedCell(raw: string): Form26PdfCell {
  const marked = form26PdfMarks(raw);
  return marked.boxes.length > 0 ? { content: marked.text, boxes: marked.boxes } : marked.text;
}

// ---------------------------------------------------------------------------------------------------
// The plan

/** The font size of a table by its number of columns: 9 pt up to 6 columns, 8 up to 9, 7 up to 12, 6 beyond. */
export function form26PdfFontSize(columns: number): number {
  if (columns <= 6) return 9;
  if (columns <= 9) return 8;
  if (columns <= 12) return 7;
  return 6;
}

const SIZE = { body: 11, small: 9.5, table: 10, h1: 15, h2: 14, h3: 13, h4: 11 } as const;
const HEADING_SIZE = { 1: SIZE.h1, 2: SIZE.h2, 3: SIZE.h3, 4: SIZE.h4 } as const;
const HEADING_BEFORE = { 1: 0, 2: 14, 3: 10, 4: 6 } as const;
const QUESTION_SHARES = [0.07, 0.55, 0.38];
const SIGNATURE_SHARES = [0.14, 0.26, 0.3, 0.3];
const INDENT = 16.5; // 22 px

const text = (runs: Form26Run[]) => form26PdfText(form26RunsText(runs));
const every = (runs: Form26Run[], test: (run: Form26Run) => boolean) => runs.some((run) => run.text.trim() !== '') && runs.filter((run) => run.text.trim() !== '').every(test);

function tableOps(block: Extract<Form26ExportBlock, { kind: 'table' }>, widthShare?: number): Form26PdfOp {
  const columnShare = form26ExportColumnShares(block);
  const head: Form26PdfCell[][] = block.head.map((row) =>
    row.map((cell) => ({
      content: form26PdfText(cell.text),
      ...(cell.colspan && cell.colspan > 1 ? { colSpan: cell.colspan } : {}),
      ...(cell.rowspan && cell.rowspan > 1 ? { rowSpan: cell.rowspan } : {}),
      ...(cell.tag === 'th' ? { fill: true, bold: true } : {}),
    })),
  );
  const body: Form26PdfCell[][] = block.body.map((row) => row.map((cell) => markedCell(cell)));
  const op: Form26PdfOp = { op: 'table', head, body, fontSize: form26PdfFontSize(columnShare.length), columnShare, theme: 'grid' };
  if (block.total) {
    const span = block.totalSpan ?? 1;
    op.foot = block.total.map((cell, i) => (i === 0 && span > 1 ? { content: form26PdfText(cell), colSpan: span, align: 'right' as const } : { content: form26PdfText(cell), align: 'right' as const }));
  }
  if (widthShare !== undefined) op.widthShare = widthShare;
  return op;
}

function blockOps(block: Form26ExportBlock, out: Form26PdfOp[], inNotes: { number: number } | null = null) {
  switch (block.kind) {
    case 'heading':
      if (HEADING_BEFORE[block.level] > 0) out.push({ op: 'space', pt: HEADING_BEFORE[block.level] });
      out.push({
        op: 'text',
        text: form26PdfText(block.text),
        size: HEADING_SIZE[block.level],
        bold: true,
        heading: true,
        ...(block.underlined ? { underline: true } : {}),
        ...(block.centred ? { align: 'center' as const } : {}),
      });
      out.push({ op: 'space', pt: 4 });
      return;
    case 'para': {
      const raw = form26RunsText(block.runs);
      const marked = form26PdfMarks(inNotes && inNotes.number > 0 ? `${inNotes.number}. ${raw}` : raw);
      const op: Form26PdfOp = { op: 'text', text: marked.text, size: inNotes || block.small ? SIZE.small : SIZE.body };
      if (marked.boxes.length > 0) op.boxes = marked.boxes;
      if (every(block.runs, (run) => !!run.bold)) op.bold = true;
      if (every(block.runs, (run) => !!run.italic)) op.italic = true;
      if (block.centred) op.align = 'center';
      if (block.indent) op.indent = INDENT;
      if (inNotes) op.indent = INDENT;
      out.push(op, { op: 'space', pt: inNotes ? 2 : 4 });
      return;
    }
    case 'questions': {
      let body: Form26PdfCell[][] = [];
      const close = () => {
        if (body.length > 0) out.push({ op: 'table', head: [], body, fontSize: form26PdfFontSize(3), columnShare: QUESTION_SHARES, theme: 'grid' }, { op: 'space', pt: 4 });
        body = [];
      };
      for (const row of block.rows) {
        if (row.fullWidth) {
          close();
          row.fullWidth.forEach((inner) => blockOps(inner, out));
          continue;
        }
        body.push([markedCell(row.no), markedCell(form26RunsText(row.wording)), markedCell(form26RunsText(row.answer))]);
      }
      close();
      return;
    }
    case 'table':
      out.push(tableOps(block, inNotes ? 0.7 : undefined), { op: 'space', pt: 6 });
      return;
    case 'signature': {
      const body: Form26PdfCell[][] = block.lines.map((line) => {
        const label: Form26PdfCell = { content: form26PdfText(line.label), bold: true };
        const value = markedCell(line.value);
        return line.side === 'left' ? [label, value, '', ''] : [{ content: '', colSpan: 2 }, label, value];
      });
      if (block.closing !== '') body.push([{ content: '', colSpan: 2 }, { content: form26PdfText(block.closing), colSpan: 2, italic: true, align: 'right' }]);
      out.push({ op: 'table', head: [], body, fontSize: SIZE.table, columnShare: SIGNATURE_SHARES, theme: 'plain' }, { op: 'space', pt: 6 });
      return;
    }
    case 'notes':
      out.push({ op: 'text', text: form26PdfText(block.title), size: SIZE.small, bold: true }, { op: 'space', pt: 2 });
      block.items.forEach((item, i) => item.forEach((inner, at) => blockOps(inner, out, at === 0 && inner.kind === 'para' ? { number: i + 1 } : { number: 0 })));
      out.push({ op: 'space', pt: 4 });
      return;
  }
}

/** The drawing steps of the model: a portrait page and the form, then a landscape page and the schedules. */
export function planForm26Pdf(model: Form26ExportModel): Form26PdfOp[] {
  const ops: Form26PdfOp[] = [{ op: 'page', orientation: 'portrait' }];
  model.portrait.forEach((block) => blockOps(block, ops));
  if (model.landscape.length > 0) {
    ops.push({ op: 'page', orientation: 'landscape' });
    model.landscape.forEach((block) => blockOps(block, ops));
  }
  // A space at the very top of a page draws nothing.
  return ops.filter((op, i) => !(op.op === 'space' && ops[i - 1]?.op === 'page'));
}

// ---------------------------------------------------------------------------------------------------
// Drawing

const MARGIN = { portrait: { top: 54, bottom: 54, left: 46, right: 46 }, landscape: { top: 40, bottom: 40, left: 36, right: 36 } };
const LINE_HEIGHT = 1.2;
/** Room kept under a heading for what follows it (points): a heading never ends a page. */
const KEEP_WITH_HEADING = 60;
const FILL: [number, number, number] = [238, 238, 238];

type Lasting = { lastAutoTable?: { finalY: number } };

function cellInput(cell: Form26PdfCell): CellDef | string {
  if (typeof cell === 'string') return cell;
  const styles: CellDef['styles'] = {};
  if (cell.bold && cell.italic) styles.fontStyle = 'bolditalic';
  else if (cell.bold) styles.fontStyle = 'bold';
  else if (cell.italic) styles.fontStyle = 'italic';
  if (cell.fill) styles.fillColor = FILL;
  if (cell.align) styles.halign = cell.align;
  const input: CellDef & { boxes?: boolean[] } = { content: cell.content, colSpan: cell.colSpan, rowSpan: cell.rowSpan, styles };
  if (cell.boxes) input.boxes = cell.boxes;
  return input;
}

/** One tick box as drawn (for tests): its square (left, top, side) and the baseline of the line it stands on. */
export type Form26PdfDrawnBox = { chosen: boolean; x: number; top: number; side: number; baseline: number; strokes: number };

const BOX_SIDE = 0.6;                      // of the font size: under the cap height of Times (0.66)
const BOX_INSET = 0.06;                    // from the start of its room

// The tick box in the room that starts at `roomX` on the line whose baseline is `baseline`: a square standing on
// the baseline; the chosen one with a tick drawn as two strokes.
function drawBox(doc: jsPDF, roomX: number, baseline: number, fontSize: number, chosen: boolean): Form26PdfDrawnBox {
  const side = fontSize * BOX_SIDE;
  const x = roomX + fontSize * BOX_INSET;
  const top = baseline - side;
  const lineWidth = doc.getLineWidth();
  doc.setDrawColor(0);
  doc.setLineWidth(Math.max(0.4, fontSize * 0.05));
  doc.rect(x, top, side, side, 'S');
  let strokes = 0;
  if (chosen) {
    doc.line(x + side * 0.2, top + side * 0.52, x + side * 0.42, top + side * 0.76);
    doc.line(x + side * 0.42, top + side * 0.76, x + side * 0.82, top + side * 0.22);
    strokes = 2;
  }
  doc.setLineWidth(lineWidth);
  return { chosen, x, top, side, baseline, strokes };
}

// The rooms of the boxes in one printed line: where each starts, measured in the line's own font.
function boxRooms(doc: jsPDF, line: string, lineX: number): number[] {
  const rooms: number[] = [];
  let from = line.indexOf(FORM26_PDF_BOX);
  while (from >= 0) {
    rooms.push(lineX + doc.getTextWidth(line.slice(0, from)));
    from = line.indexOf(FORM26_PDF_BOX, from + FORM26_PDF_BOX.length);
  }
  return rooms;
}

// jsPDF puts the baseline of text drawn with baseline 'top' (and jspdf-autotable that of a cell's first line)
// at this part of the font size under the given y.
const baselineBelowTop = (doc: jsPDF) => 2 - doc.getLineHeightFactor();

/** Draws the steps into a new document (jsPDF, points, A4). Make the file with `buildForm26PdfBlob(model)`. */
export function renderForm26Pdf(ops: Form26PdfOp[], opts: { onBox?(box: Form26PdfDrawnBox): void } = {}): jsPDF {
  const first = ops.find((op): op is Extract<Form26PdfOp, { op: 'page' }> => op.op === 'page');
  const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: first?.orientation ?? 'portrait' });
  doc.setProperties({ title: 'Form No. 26' });
  let orientation: 'portrait' | 'landscape' = first?.orientation ?? 'portrait';
  let started = false;
  let y = MARGIN[orientation].top;
  const margin = () => MARGIN[orientation];
  const pageWidth = () => doc.internal.pageSize.getWidth();
  const pageHeight = () => doc.internal.pageSize.getHeight();
  const room = () => pageWidth() - margin().left - margin().right;

  // Boxes of a table cell already drawn (a row taller than a page is drawn in parts).
  const cellBoxesDrawn = new WeakMap<object, number>();
  const box = (roomX: number, baseline: number, fontSize: number, chosen: boolean) => {
    const drawn = drawBox(doc, roomX, baseline, fontSize, chosen);
    opts.onBox?.(drawn);
  };

  ops.forEach((op, at) => {
    if (op.op === 'text' && op.heading && ops[at - 1]?.op !== 'text') {
      // A heading (or a heading with its sub-heading) and the first lines under it start on the same page.
      let needed = KEEP_WITH_HEADING;
      for (let next = at; next < ops.length; next += 1) {
        const ahead = ops[next];
        if (ahead.op === 'space') needed += ahead.pt;
        else if (ahead.op === 'text' && ahead.heading) needed += ahead.size * LINE_HEIGHT;
        else break;
      }
      if (y > margin().top && y + needed > pageHeight() - margin().bottom) {
        doc.addPage('a4', orientation);
        y = margin().top;
      }
    }
    draw(op);
  });
  return doc;

  function draw(op: Form26PdfOp) {
    if (op.op === 'page') {
      if (started) doc.addPage('a4', op.orientation);
      started = true;
      orientation = op.orientation;
      y = margin().top;
      return;
    }
    if (op.op === 'space') {
      y += op.pt;
      return;
    }
    if (op.op === 'text') {
      doc.setFont('times', op.bold && op.italic ? 'bolditalic' : op.bold ? 'bold' : op.italic ? 'italic' : 'normal');
      doc.setFontSize(op.size);
      const indent = op.indent ?? 0;
      const lines = doc.splitTextToSize(op.text, room() - indent) as string[];
      const height = op.size * LINE_HEIGHT;
      let boxAt = 0;
      for (const line of lines) {
        if (y + height > pageHeight() - margin().bottom) {
          doc.addPage('a4', orientation);
          y = margin().top;
        }
        const x = op.align === 'center' ? pageWidth() / 2 : op.align === 'right' ? pageWidth() - margin().right : margin().left + indent;
        doc.text(line, x, y, { baseline: 'top', align: op.align ?? 'left' });
        if (op.boxes) {
          const width = doc.getTextWidth(line);
          const lineX = op.align === 'center' ? x - width / 2 : op.align === 'right' ? x - width : x;
          for (const roomX of boxRooms(doc, line, lineX)) box(roomX, y + op.size * baselineBelowTop(doc), op.size, op.boxes[boxAt++] ?? false);
        }
        if (op.underline) {
          const width = doc.getTextWidth(line);
          const from = op.align === 'center' ? x - width / 2 : op.align === 'right' ? x - width : x;
          doc.setLineWidth(0.6);
          doc.line(from, y + op.size * 1.02, from + width, y + op.size * 1.02);
        }
        y += height;
      }
      return;
    }
    const width = room() * (op.widthShare ?? 1);
    const columnStyles: Record<string, { cellWidth: number }> = {};
    op.columnShare.forEach((share, c) => {
      columnStyles[c] = { cellWidth: share * width };
    });
    autoTable(doc, {
      startY: y,
      margin: { ...margin() },
      tableWidth: width,
      theme: op.theme,
      head: op.head.map((row) => row.map(cellInput)) as RowInput[],
      body: op.body.map((row) => row.map(cellInput)) as RowInput[],
      foot: op.foot ? ([op.foot.map(cellInput)] as RowInput[]) : undefined,
      showHead: 'everyPage',
      showFoot: 'lastPage',
      rowPageBreak: 'avoid',
      styles: { font: 'times', fontSize: op.fontSize, cellPadding: { top: 2, bottom: 2, left: 3, right: 3 }, overflow: 'linebreak', valign: 'top', textColor: 0, lineColor: 0, lineWidth: op.theme === 'grid' ? 0.5 : 0 },
      headStyles: { fillColor: false, textColor: 0, fontStyle: 'normal', halign: 'left' },
      bodyStyles: { fillColor: false },
      footStyles: { fillColor: false, textColor: 0, fontStyle: 'normal' },
      alternateRowStyles: { fillColor: false },
      columnStyles,
      // The tick boxes of a cell, in the rooms its text keeps (cells with boxes are left aligned, at the top).
      didDrawCell: (data) => {
        const raw = data.cell.raw as { boxes?: boolean[] } | null;
        if (!raw || typeof raw !== 'object' || !raw.boxes) return;
        const fontSize = data.cell.styles.fontSize;
        const start = data.cell.getTextPos();
        const lines = (data.cell.text ?? []) as string[];
        let boxAt = cellBoxesDrawn.get(raw) ?? 0;
        lines.forEach((line, n) => {
          const baseline = start.y + fontSize * (2 - 1.15) + n * fontSize * doc.getLineHeightFactor();
          for (const roomX of boxRooms(doc, line, start.x)) box(roomX, baseline, fontSize, raw.boxes?.[boxAt++] ?? false);
        });
        cellBoxesDrawn.set(raw, boxAt);
      },
    });
    y = ((doc as unknown as Lasting).lastAutoTable?.finalY ?? y) + 2;
  }
}

export const form26PdfFileName = (model: Form26ExportModel) => `${model.fileStem}.pdf`;

/** Plans and draws the PDF as a file for the save window (FIX-T29: never jsPDF's own download). */
export function buildForm26PdfBlob(model: Form26ExportModel): Blob {
  const bytes = renderForm26Pdf(planForm26Pdf(model)).output('arraybuffer');
  return new Blob([bytes], { type: 'application/pdf' });
}
