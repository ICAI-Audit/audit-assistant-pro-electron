// A tooltip for a control that opens the page viewer. It opens on hover only, closes when the
// control is pressed, and never opens while a dialog is open: an open tooltip is a layer above the
// viewer and would take its Escape (phase 1 found the same on the toolbar). Not on focus: focus
// comes back to the control when the viewer closes, and a tooltip opened then would sit over the
// same control of the row above. The control's accessible name says the same thing.
import { useRef, useState, type ReactElement } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export default function QuietTip({ text, children }: { text: string; children: ReactElement }) {
  const [open, setOpen] = useState(false);
  const hovered = useRef(false);
  return (
    <Tooltip
      open={open}
      onOpenChange={(next) => {
        if (next && (!hovered.current || document.querySelector('[role="dialog"], [role="alertdialog"]'))) return;
        setOpen(next);
      }}
    >
      <TooltipTrigger
        asChild
        onPointerEnter={() => (hovered.current = true)}
        onPointerLeave={() => {
          hovered.current = false;
          setOpen(false);
        }}
        onPointerDown={() => setOpen(false)}
        onClick={() => setOpen(false)}
      >
        {children}
      </TooltipTrigger>
      <TooltipContent className="text-xs">{text}</TooltipContent>
    </Tooltip>
  );
}
