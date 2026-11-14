import type { LucideIcon } from 'lucide-react';
import { FileImage, FileMinus2, Hash, Images, Merge, Scissors, Shrink } from 'lucide-react';
import type { ToolId } from '@/lib/pdf-tools/types';

/** One icon per tool, shared by the toolbar and the tool dialogs. */
export const TOOL_ICONS: Record<ToolId, LucideIcon> = {
  merge: Merge,
  split: Scissors,
  'delete-pages': FileMinus2,
  compress: Shrink,
  'page-numbers': Hash,
  'images-to-pdf': Images,
  'pdf-to-images': FileImage,
};
