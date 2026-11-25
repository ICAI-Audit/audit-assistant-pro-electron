import { PROTECTED_OUTPUT_REASON, type ToolId, type WorkingFile } from '@/lib/pdf-tools/types';
import { isOfficeFile, OFFICE_INPUT_REASON } from './officeFiles';

export type ToolGroup = 'Organise' | 'Prepare' | 'Convert' | 'Review';

export interface ToolInfo {
  id: ToolId;
  group: ToolGroup;
  label: string;
  description: string;
}

/** A tool shown on the toolbar but not built yet. */
export interface ComingSoonTool {
  key: string;
  group: ToolGroup;
  label: string;
  description: string;
}

/**
 * Every tool, in the toolbar's order (design section 4: Organise: Merge, Split, Delete pages, Organise
 * pages, Resize or crop pages, Compress; Prepare: Page numbers, Watermark, Redact, Bookmarks, Protect;
 * Convert: Images to PDF, PDF to images, PDF to Excel, PDF to Word; Review: Document check, Compare). A phase 2 or 3 tool whose run module is still a stub (toolModules.ts) is shown in its place
 * as "Soon".
 */
export const TOOLS: ToolInfo[] = [
  { id: 'merge', group: 'Organise', label: 'Merge', description: 'Combine the selected files, in list order, into one PDF.' },
  { id: 'split', group: 'Organise', label: 'Split', description: 'Take pages out of one PDF: a range, equal parts, chosen pages, a file for each range, or a file at each bookmark.' },
  { id: 'delete-pages', group: 'Organise', label: 'Delete pages', description: 'Remove chosen pages from one PDF.' },
  { id: 'organise-pages', group: 'Organise', label: 'Organise pages', description: 'Reorder, rotate and remove the pages of one PDF.' },
  { id: 'resize-crop', group: 'Organise', label: 'Resize or crop pages', description: 'Make every page one size, such as A4, trim the edges or add a margin.' },
  { id: 'compress', group: 'Organise', label: 'Compress', description: 'Make PDFs smaller by reducing the images inside them.' },
  { id: 'page-numbers', group: 'Prepare', label: 'Page numbers', description: 'Add page numbers, headers and footers.' },
  { id: 'watermark', group: 'Prepare', label: 'Watermark', description: 'Add a watermark such as "Draft", a stamp or your logo to the pages.' },
  { id: 'redact', group: 'Prepare', label: 'Redact', description: 'Find and remove personal data such as PAN and Aadhaar numbers, or areas you mark.' },
  { id: 'bookmarks', group: 'Prepare', label: 'Bookmarks', description: 'Add, rename, arrange and remove the bookmarks of one PDF.' },
  { id: 'protect', group: 'Prepare', label: 'Protect', description: 'Make a copy of one PDF that opens only with a password.' },
  { id: 'images-to-pdf', group: 'Convert', label: 'Images to PDF', description: 'Turn the selected images into one PDF, one image per page.' },
  { id: 'pdf-to-images', group: 'Convert', label: 'PDF to images', description: 'Save pages of one PDF as PNG or JPG images.' },
  { id: 'pdf-to-excel', group: 'Convert', label: 'PDF to Excel', description: 'Turn tables in a PDF into a workbook.' },
  { id: 'pdf-to-word', group: 'Convert', label: 'PDF to Word', description: 'Turn a PDF into an editable document.' },
  { id: 'ocr', group: 'Convert', label: 'Make searchable', description: 'Recognise the text of scanned pages (OCR).' },
  { id: 'document-check', group: 'Review', label: 'Document check', description: 'See what a PDF holds: pages, signatures, protection and text.' },
  { id: 'compare', group: 'Review', label: 'Compare', description: 'Find the differences in text between two versions of a PDF.' },
];

/** Tools of a later phase: always "Soon" (owner decision T-022: no visible placeholder is removed). */
export const COMING_SOON: ComingSoonTool[] = [];

export const TOOL_GROUPS: ToolGroup[] = ['Organise', 'Prepare', 'Convert', 'Review'];

/** Where the arrow keys, Home and End take focus in the toolbar (an item index), or null for any other key (UX audit C11). */
export function toolbarMove(key: string, at: number, count: number): number | null {
  if (count === 0) return null;
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return Math.min(count - 1, at + 1);
    case 'ArrowLeft':
    case 'ArrowUp':
      return Math.max(0, at - 1);
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}

/** "PDF to Excel · soon": how a tool that is not built yet is named on the toolbar (UX audit C2.2). */
export const soonLabel = (label: string) => `${label} · soon`;

export function toolInfo(id: ToolId): ToolInfo {
  return TOOLS.find((tool) => tool.id === id)!;
}

/** `reason` is set exactly when the tool is not available. */
export interface ToolAvailability {
  enabled: boolean;
  reason?: string;
}

const isPdf = (file: WorkingFile) => file.kind === 'pdf';

function exactlyOnePdf(selected: WorkingFile[], action: string): ToolAvailability {
  if (selected.length === 1 && isPdf(selected[0])) return { enabled: true };
  if (selected.length === 1) return { enabled: false, reason: `Select a PDF, not an image, to ${action}.` };
  return { enabled: false, reason: `Select exactly one PDF to ${action}.` };
}

/** Whether a tool can run on the current selection and, if not, what the user must change. */
export function toolAvailability(tool: ToolId, selected: WorkingFile[]): ToolAvailability {
  // An Excel workbook or a Word document is a result to save, never an input (T-064, decision 9): Merge too,
  // which otherwise takes any two files.
  if (selected.some(isOfficeFile)) return { enabled: false, reason: OFFICE_INPUT_REASON };
  // A result of Protect is never an input (design 5.18): its password is not kept to open it again.
  if (selected.some((f) => f.protectedOutput)) return { enabled: false, reason: PROTECTED_OUTPUT_REASON };
  switch (tool) {
    case 'merge':
      return selected.length >= 2 ? { enabled: true } : { enabled: false, reason: 'Select at least two files to merge. Images are added as pages.' };
    case 'split':
      return exactlyOnePdf(selected, 'split');
    case 'delete-pages':
      return exactlyOnePdf(selected, 'delete pages from');
    case 'organise-pages':
      return exactlyOnePdf(selected, 'organise its pages');
    case 'resize-crop':
      return exactlyOnePdf(selected, 'resize or crop its pages');
    case 'page-numbers':
      return exactlyOnePdf(selected, 'add page numbers, headers or footers to');
    case 'watermark':
      return exactlyOnePdf(selected, 'add a watermark, stamp or logo to');
    case 'redact':
      return exactlyOnePdf(selected, 'redact');
    case 'bookmarks':
      return exactlyOnePdf(selected, 'edit its bookmarks');
    case 'protect':
      return exactlyOnePdf(selected, 'protect it with a password');
    case 'pdf-to-images':
      return exactlyOnePdf(selected, 'turn into images');
    case 'pdf-to-excel':
      return exactlyOnePdf(selected, 'turn into a workbook');
    case 'pdf-to-word':
      return exactlyOnePdf(selected, 'turn into a Word document');
    case 'ocr':
      return exactlyOnePdf(selected, 'make searchable');
    case 'document-check':
      return exactlyOnePdf(selected, 'check');
    case 'compare':
      return selected.length === 2 && selected.every(isPdf) ? { enabled: true } : { enabled: false, reason: 'Select exactly two PDFs to compare.' };
    case 'compress':
      if (selected.length === 0) return { enabled: false, reason: 'Select one or more PDFs to compress.' };
      return selected.every(isPdf) ? { enabled: true } : { enabled: false, reason: 'Only PDFs can be compressed. Untick the images.' };
    case 'images-to-pdf':
      if (selected.length === 0) return { enabled: false, reason: 'Select one or more images to turn into a PDF.' };
      return selected.every((f) => f.kind === 'image') ? { enabled: true } : { enabled: false, reason: 'Only images can be turned into a PDF. Untick the PDFs.' };
  }
}
