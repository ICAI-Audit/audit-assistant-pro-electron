// Excel workbooks and Word documents in the list (T-064, contract decision 9): results of PDF to Excel and
// PDF to Word. They are rows like any other result (ticked, moved, removed, saved, added to the Evidence Vault,
// attached to a working paper), told apart by their type. They have no pages: no page count, no page panel
// and no viewer; and no tool takes one as its input.
import type { WorkingFile } from '@/lib/pdf-tools/types';

// The Word type, written out here so that the list does not load the Word writer (wordBuild.ts DOCX_MIME is
// the same text; officeFiles.test.ts holds the two together).
const WORD_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** Why no tool is available while such a row is ticked, and what a run says if one reaches it. */
export const OFFICE_INPUT_REASON = 'Excel and Word results cannot be used by a tool.';

export interface OfficeInfo {
  type: 'excel' | 'word';
  /** What the row says in place of a page count. */
  label: 'Excel workbook' | 'Word document';
  /** The letters on the row's tile. */
  short: 'XLSX' | 'DOCX';
  extension: 'xlsx' | 'docx';
  /** The tip of the row's tile: there is nothing to preview here. */
  tip: string;
}

const EXCEL: OfficeInfo = { type: 'excel', label: 'Excel workbook', short: 'XLSX', extension: 'xlsx', tip: 'Save it, then open it in Excel.' };
const WORD: OfficeInfo = { type: 'word', label: 'Word document', short: 'DOCX', extension: 'docx', tip: 'Save it, then open it in Word.' };

export const isOfficeFile = (file: Pick<WorkingFile, 'kind'>): boolean => file.kind === 'office';

/** What an office row is, from its type. */
export function officeInfo(file: Pick<WorkingFile, 'mimeType'>): OfficeInfo {
  return file.mimeType === WORD_MIME ? WORD : EXCEL;
}
