import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import type { HistoryChange, HistoryRecord } from './types';

function reportRows(records: HistoryRecord[], changes: HistoryChange[]) {
  return {
    current: records.map((row) => [row.kind, row.attributes.name, row.attributes.details ?? '', row.effectiveFrom, row.effectiveUntil ?? '']),
    changes: changes.map((row) => [row.kind, row.subjectId, row.change,
      row.before ? JSON.stringify(row.before) : '', row.after ? JSON.stringify(row.after) : '']),
  };
}

export function exportHistoryPdf(client: string, previous: string, current: string, records: HistoryRecord[], changes: HistoryChange[]) {
  const rows = reportRows(records, changes);
  const doc = new jsPDF();
  doc.setFontSize(15);
  doc.text('Ownership and management report — Draft', 14, 18);
  doc.setFontSize(10);
  const title = doc.splitTextToSize(`${client} | Comparison: ${previous} to ${current}`, 180);
  doc.text(title, 14, 26);
  autoTable(doc, {
    startY: 32 + Math.max(0, title.length - 1) * 5,
    head: [['Category', 'Name', 'Details', 'From', 'Until (exclusive)']],
    body: rows.current,
    showHead: 'everyPage',
  });
  doc.addPage();
  doc.text('Year-end changes', 14, 18);
  autoTable(doc, {
    startY: 23, head: [['Category', 'Subject ID', 'Change', 'Before', 'After']],
    body: rows.changes, styles: { overflow: 'linebreak' }, showHead: 'everyPage',
  });
  doc.save(`ownership-management-${current}.pdf`);
}

export function exportHistoryExcel(client: string, previous: string, current: string, records: HistoryRecord[], changes: HistoryChange[]) {
  const rows = reportRows(records, changes);
  const workbook = XLSX.utils.book_new();
  const currentSheet = XLSX.utils.aoa_to_sheet([
    ['Ownership and management report - Draft'], ['Client', client], ['Previous year end', previous], ['Current year end', current],
    [], ['Category', 'Name', 'Details', 'From', 'Until (exclusive)'], ...rows.current,
  ]);
  const changeSheet = XLSX.utils.aoa_to_sheet([
    ['Year-end changes - Draft'], ['Client', client], ['Previous year end', previous], ['Current year end', current],
    [], ['Category', 'Subject ID', 'Change', 'Before', 'After'], ...rows.changes,
  ]);
  XLSX.utils.book_append_sheet(workbook, currentSheet, 'Current');
  XLSX.utils.book_append_sheet(workbook, changeSheet, 'Changes');
  XLSX.writeFile(workbook, `ownership-management-${current}.xlsx`);
}
