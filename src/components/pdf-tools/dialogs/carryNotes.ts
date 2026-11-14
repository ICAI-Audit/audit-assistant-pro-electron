// What Merge, Split and Delete pages do not carry over from the chosen files, in the words the
// dialogs show before the run. Only what the files really have is mentioned (inspectPdf found it
// when they were added). Split and Delete pages carry the form fields of the pages kept.
import type { WorkingFile } from '@/lib/pdf-tools/types';

export interface CarryNotes {
  /** Merge only: a warning that filled-in form values may be lost. */
  forms: string | null;
  /** Sentences for the "What is not carried over" notice. */
  notes: string[];
}

export function carryNotes(tool: 'merge' | 'split' | 'delete-pages', files: readonly WorkingFile[]): CarryNotes {
  const merge = tool === 'merge';
  const withForms = files.filter((f) => f.hasFormFields);
  const forms =
    merge && withForms.length > 0
      ? `${withForms.length === 1 ? `${withForms[0].name} has` : `${withForms.length} of these files have`} form fields. ` +
        'Filled-in form fields are not carried into the merged file; the values may not be shown.'
      : null;
  const notes: string[] = [];
  if (files.some((f) => f.hasBookmarks)) notes.push(`Bookmarks are not carried into the ${merge ? 'merged file' : 'result'}.`);
  if (files.some((f) => f.hasPageLinks)) {
    notes.push(merge ? 'Links between pages do not work in the merged file.' : 'Links to pages that are left out are removed; other links between pages may not work.');
  }
  return { forms, notes };
}
