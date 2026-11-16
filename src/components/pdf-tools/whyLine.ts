// "Say why on click" (UX audit C1.2, C4.2, principle 8): an unavailable tool or destination that is
// clicked tells the screen its reason, which shows it in one polite status line under the toolbar for a
// few seconds (and the control's own tooltip opens where it is). The line is a live region, so a screen
// reader hears the reason too.
import { createContext } from 'react';

/** Given by the PDF Tools screen; null outside it (the control then only opens its tooltip). */
export const WhyContext = createContext<((reason: string) => void) | null>(null);

/** How long a reason stays in the line after a click. */
export const WHY_LINE_MS = 6000;

/** The line's text: the reason just given, else what to do when files are listed but none is ticked. */
export function whyLineText(reason: string | null, fileCount: number, selectedCount: number): string {
  if (reason) return reason;
  if (fileCount > 0 && selectedCount === 0) return 'Tick files in the list to use a tool.';
  return '';
}
