// What the Organise pages dialog says before a run about what the result keeps (design 5.15, with
// 5.3 and 5.10, and pageOrder.ts as of review fix round 1), in at most two sentences: what happens,
// then what to do (ux-audit E6).
//
// - A rotate-only run is made in the file itself and keeps everything.
// - A move or removal goes through the page copy of Split and Delete pages: form fields, comments,
//   links and bookmarks follow their pages; the document language, attachments, named destinations of
//   kept pages and page labels are carried (each page keeps its own label). Not carried: bookmarks and
//   links of removed pages, and document parts a new file does not take (XMP metadata, accessibility
//   tags, document scripts, viewer settings).
//
// As carryNotes does for Split and Delete pages, bookmarks and links are named only when the file has
// them (inspectPdf found them when it was added). The document parts are not detected before the run,
// so that part is general ("if the file has any"); after the run the library's own notes
// (pageOrder.ts organiseNotes) say exactly what was not kept.
import type { WorkingFile } from '@/lib/pdf-tools/types';
import type { OrganiseCounts } from './organiseSummary';

export interface CarryNotesBeforeRun {
  /** 'kept': a rotate-only run; 'not-carried': a move or removal. */
  kind: 'kept' | 'not-carried';
  title: string;
  text: string;
  /** A move or removal on a file with attachments: they are kept (the library carries the document's list). */
  kept?: string;
}

/** Said when the file has attachments and a run moves or removes pages (coordinator, from the review). */
export const ATTACHMENTS_KEPT = "Attachments in the document's list are kept when pages are removed.";

const DOCUMENT_PARTS = 'XMP metadata, accessibility tags, document scripts and viewer settings, if the file has any,';

/**
 * `hasAttachments` is not reported by inspectPdf yet (needed in shared files); when a file carries it as
 * true the attachments line is shown, otherwise nothing is said about attachments.
 */
export function carryNotesBeforeRun(
  file: Pick<WorkingFile, 'hasBookmarks' | 'hasPageLinks' | 'hasFormFields'> & { hasAttachments?: boolean },
  counts: OrganiseCounts,
): CarryNotesBeforeRun | null {
  if (counts.moved === 0 && counts.removed === 0) {
    if (counts.turned === 0) return null;
    return {
      kind: 'kept',
      title: 'Only rotating pages',
      text: 'The pages are rotated in the file itself, so its bookmarks, links, form fields, page labels and attachments are all kept.',
    };
  }
  const ofRemoved = [
    counts.removed > 0 && file.hasBookmarks ? 'Bookmarks of removed pages' : null,
    counts.removed > 0 && file.hasPageLinks ? 'links to removed pages' : null,
  ].filter((part): part is string => part !== null);
  const what = ofRemoved.length > 0 ? `${ofRemoved.join(', ')}, and ${DOCUMENT_PARTS}` : DOCUMENT_PARTS;
  return {
    kind: 'not-carried',
    title: 'What is not carried over',
    text: `${what.charAt(0).toUpperCase()}${what.slice(1)} are not carried into the new file. Page labels stay with their pages; keep the original if you need anything not carried.`,
    ...(file.hasAttachments === true ? { kept: ATTACHMENTS_KEPT } : {}),
  };
}
