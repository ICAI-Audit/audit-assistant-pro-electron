import type { LucideIcon } from 'lucide-react';
import { Bookmark, Columns2, Crop, EyeOff, FileImage, FileLock2, FileMinus2, FileSearch, FileSpreadsheet, FileText, Hash, Images, LayoutGrid, Merge, ScanText, Scissors, Shrink, Stamp } from 'lucide-react';
import type { ToolId } from '@/lib/pdf-tools/types';

/** One icon per tool, shared by the toolbar and the tool dialogs (a "Soon" phase 2 tool keeps its icon). */
export const TOOL_ICONS: Record<ToolId, LucideIcon> = {
  merge: Merge,
  split: Scissors,
  'delete-pages': FileMinus2,
  'organise-pages': LayoutGrid,
  'resize-crop': Crop,
  compress: Shrink,
  'page-numbers': Hash,
  watermark: Stamp,
  redact: EyeOff,
  bookmarks: Bookmark,
  protect: FileLock2,
  'images-to-pdf': Images,
  'pdf-to-images': FileImage,
  'pdf-to-excel': FileSpreadsheet,
  'pdf-to-word': FileText,
  'document-check': FileSearch,
  compare: Columns2,
  ocr: ScanText,
};
