import type { ToolId, WorkingFile } from '@/lib/pdf-tools/types';

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

export const TOOLS: ToolInfo[] = [
  { id: 'merge', group: 'Organise', label: 'Merge', description: 'Combine the selected files, in list order, into one PDF.' },
  { id: 'split', group: 'Organise', label: 'Split', description: 'Take a page range, every N pages, or chosen pages out of one PDF.' },
  { id: 'delete-pages', group: 'Organise', label: 'Delete pages', description: 'Remove chosen pages from one PDF.' },
  { id: 'compress', group: 'Organise', label: 'Compress', description: 'Make PDFs smaller by reducing the images inside them.' },
  { id: 'page-numbers', group: 'Prepare', label: 'Page numbers', description: 'Add page numbers or a working-paper reference to every page.' },
  { id: 'images-to-pdf', group: 'Convert', label: 'Images to PDF', description: 'Turn the selected images into one PDF, one image per page.' },
  { id: 'pdf-to-images', group: 'Convert', label: 'PDF to images', description: 'Save pages of one PDF as PNG or JPG images.' },
];

export const COMING_SOON: ComingSoonTool[] = [
  { key: 'redact', group: 'Prepare', label: 'Redact', description: 'Remove or mask personal data such as PAN and Aadhaar numbers.' },
  { key: 'bookmarks', group: 'Prepare', label: 'Bookmarks', description: 'Add and arrange bookmarks.' },
  { key: 'watermark', group: 'Prepare', label: 'Watermark', description: 'Stamp "Draft", "Confidential" or your own text on pages.' },
  { key: 'pdf-to-excel', group: 'Convert', label: 'PDF to Excel', description: 'Turn tables in a PDF into a workbook.' },
  { key: 'pdf-to-word', group: 'Convert', label: 'PDF to Word', description: 'Turn a PDF into an editable document.' },
  { key: 'ocr', group: 'Convert', label: 'Make searchable', description: 'Recognise the text of scanned pages (OCR).' },
  { key: 'word-to-pdf', group: 'Convert', label: 'Word to PDF', description: 'Convert Word documents to PDF.' },
  { key: 'excel-to-pdf', group: 'Convert', label: 'Excel to PDF', description: 'Convert Excel workbooks to PDF.' },
  { key: 'review', group: 'Review', label: 'Review', description: 'Document checks and version comparison, once their scope is agreed.' },
];

export const TOOL_GROUPS: ToolGroup[] = ['Organise', 'Prepare', 'Convert', 'Review'];

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
  switch (tool) {
    case 'merge':
      return selected.length >= 2 ? { enabled: true } : { enabled: false, reason: 'Select at least two files to merge. Images are added as pages.' };
    case 'split':
      return exactlyOnePdf(selected, 'split');
    case 'delete-pages':
      return exactlyOnePdf(selected, 'delete pages from');
    case 'page-numbers':
      return exactlyOnePdf(selected, 'add page numbers to');
    case 'pdf-to-images':
      return exactlyOnePdf(selected, 'turn into images');
    case 'compress':
      if (selected.length === 0) return { enabled: false, reason: 'Select one or more PDFs to compress.' };
      return selected.every(isPdf) ? { enabled: true } : { enabled: false, reason: 'Only PDFs can be compressed. Untick the images.' };
    case 'images-to-pdf':
      if (selected.length === 0) return { enabled: false, reason: 'Select one or more images to turn into a PDF.' };
      return selected.every((f) => f.kind === 'image') ? { enabled: true } : { enabled: false, reason: 'Only images can be turned into a PDF. Untick the PDFs.' };
  }
}
