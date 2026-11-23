// The keys of the Form No. 26 workspace (src/lib/taxAuditForm26Workspace.ts decides; this only listens):
// F8 / Shift+F8 next / previous unfilled, Alt+PageDown / Alt+PageUp next / previous clause, "/" to the
// search when no field has the keyboard. Y / N, Enter and Esc in rows are handled inside the controls and
// tables (they stop the event there), and the application's own shortcuts all need Ctrl: nothing clashes.
import * as React from 'react';

import { form26KeyCommand, isTypingElement, type Form26KeyCommand } from '@/lib/taxAuditForm26Workspace';

export function useForm26Keyboard(onCommand: (command: Form26KeyCommand) => void, enabled = true): void {
  const latest = React.useRef(onCommand);
  latest.current = onCommand;

  React.useEffect(() => {
    if (!enabled) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      // A dialog above the workspace keeps its keys.
      if (typeof document !== 'undefined' && document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      const command = form26KeyCommand(event, isTypingElement(document.activeElement as HTMLElement | null));
      if (!command) return;
      event.preventDefault();
      latest.current(command);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled]);
}
