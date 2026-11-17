// What the user is told about marks, in plain words: after a run (from the library's MarkReport),
// before it (scanned pages under a watermark behind the page, form fields over a mark in front), and
// about the page in the preview. The library reports pages; this file decides the sentences.
import type { MarkReport } from '@/lib/pdf-tools/watermark';
import { pagesInWords } from './markText';

const many = (pages: readonly number[]) => new Set(pages).size > 1;
const capital = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

/** A mark in front may sit in the wrong place: the page's content closes more than it opens, or could not be read. */
export function markMayBeMisplaced(report: MarkReport): boolean {
  return report.damaged.length > 0 || report.unverified.length > 0;
}

function misplaced(report: MarkReport, subject: string): string | null {
  const pages = [...report.damaged, ...report.unverified];
  if (pages.length === 0) return null;
  return `${subject} may be misplaced on ${pagesInWords(pages)}: the page's own drawing instructions are damaged or could not be read. Check ${many(pages) ? 'those pages' : 'that page'}.`;
}

/** Every warning of a Watermark run, one sentence each, in the order the user should read them. */
export function watermarkRunNotes(report: MarkReport): string[] {
  const notes: string[] = [];
  if (report.hiddenBehind.length > 0) {
    notes.push(`A watermark behind the page may not be visible on ${pagesInWords(report.hiddenBehind)}: a scan, a picture or a solid background covers it. Use In front to be sure it shows.`);
  }
  if (report.uncertain.length > 0) {
    const pages = report.uncertain;
    notes.push(`A watermark behind the page may be hidden on ${pagesInWords(pages)}, but this could not be checked. Look at ${many(pages) ? 'those pages' : 'that page'}, or use In front.`);
  }
  if (report.clipped.length > 0) {
    notes.push(`The watermark is larger than ${pagesInWords(report.clipped)} and is cut off. Choose Auto size or a smaller size.`);
  }
  const moved = misplaced(report, 'A mark');
  if (moved) notes.push(moved);
  if (report.underFields.length > 0) {
    const pages = report.underFields;
    notes.push(`On ${pagesInWords(pages)} the page's form fields are drawn over the marks and may cover part of them. Check ${many(pages) ? 'those pages' : 'that page'}, or place the marks away from the fields.`);
  }
  return notes;
}

/**
 * The warnings of a Page numbers run. Form fields are not mentioned: the library lists every page with a
 * field, and a number in the margin rarely meets one, so the note would be noise (M-review F14).
 */
export function pageNumberRunNotes(report: MarkReport): string[] {
  const moved = misplaced(report, 'A page number, header or footer');
  return moved ? [moved] : [];
}

/**
 * Before the run, with Behind chosen: how many of the chosen pages are scans (no text and a picture
 * over most of the page), where a watermark behind the page cannot be seen (design 5.16). Null for none.
 */
export function scanNote(scans: number, chosen: number): string | null {
  if (scans <= 0) return null;
  const end = 'a watermark behind the page cannot be seen. Put it in front to show it there.';
  if (chosen === 1) return `On the chosen page (a scan) ${end}`;
  if (scans === chosen) return `On all ${chosen} chosen pages (scans) ${end}`;
  return `On ${scans} of the chosen pages (${scans === 1 ? 'a scan' : 'scans'}) ${end}`;
}

/** Before the run: the chosen pages with form fields, which are painted over anything drawn in front. */
export function fieldsNote(pages: readonly number[], kind: 'mark' | 'number'): string | null {
  if (pages.length === 0) return null;
  const which = capital(pagesInWords(pages));
  const verb = many(pages) ? 'have' : 'has';
  return kind === 'mark'
    ? `${which} ${verb} form fields, which are drawn over marks in front and may cover part of them. Place the marks away from the fields if they must show in full.`
    : `${which} ${verb} form fields, which are drawn over page numbers, headers and footers and may cover part of them. Choose another place if they must show in full.`;
}

/** What the preview's one page shows that the user should know now (the run says the rest). */
export function previewNotes(report: MarkReport): string[] {
  const notes: string[] = [];
  if (report.clipped.length > 0) notes.push('The watermark is larger than this page and is cut off. Choose Auto size or a smaller size.');
  if (report.hiddenBehind.length > 0) notes.push('Behind the page, the watermark may not be visible on this page: a scan, a picture or a solid background covers it. Put it in front to show it.');
  else if (report.uncertain.length > 0) notes.push('Behind the page, the watermark may be hidden on this page; this could not be checked. Look at it in the large view, or put it in front.');
  if (markMayBeMisplaced(report)) notes.push("A mark may be misplaced on this page: the page's own drawing instructions are damaged or could not be read. Check this page in the result.");
  return notes;
}
