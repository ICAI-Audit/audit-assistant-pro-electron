import * as React from "react";

import { cn } from "@/lib/utils";

// The global stylesheet forces every table cell to nowrap, a tiny font and `!important`
// padding (src/index.css). The `!` modifiers below are deliberate: they scope the
// override to this component instead of changing the rule for every screen.

interface DataTableProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Accessible name of the scrollable region. */
  label: string;
  /** Narrowest width in px before the table scrolls sideways. */
  minWidth?: number;
}

/** Bordered scroll container with a sticky header; scrolls sideways instead of squeezing columns. */
function DataTable({ label, minWidth = 0, className, children, ...props }: DataTableProps) {
  return (
    <div
      role="region"
      aria-label={label}
      tabIndex={0}
      className={cn(
        "relative max-h-[70vh] overflow-auto rounded-lg border bg-card ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        className,
      )}
      {...props}
    >
      <table className="w-full border-separate border-spacing-0 text-body-sm" style={{ minWidth }}>
        {children}
      </table>
    </div>
  );
}

const Th = React.forwardRef<HTMLTableCellElement, React.ThHTMLAttributes<HTMLTableCellElement>>(
  ({ className, scope = "col", ...props }, ref) => (
    <th
      ref={ref}
      scope={scope}
      className={cn(
        "sticky top-0 z-10 border-b bg-muted text-left align-middle font-semibold uppercase tracking-wider text-subtle !whitespace-nowrap !px-3 !py-2.5 !text-[11px]",
        className,
      )}
      {...props}
    />
  ),
);
Th.displayName = "Th";

const Td = React.forwardRef<HTMLTableCellElement, React.TdHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...props }, ref) => (
    <td
      ref={ref}
      className={cn(
        "border-b align-middle text-foreground !max-w-none !overflow-visible !whitespace-normal !px-3 !py-3 !text-[13px] !leading-5",
        className,
      )}
      {...props}
    />
  ),
);
Td.displayName = "Td";

const Tr = React.forwardRef<HTMLTableRowElement, React.HTMLAttributes<HTMLTableRowElement>>(
  ({ className, ...props }, ref) => (
    <tr
      ref={ref}
      className={cn(
        "transition-colors duration-150 hover:bg-muted/50 motion-reduce:transition-none [&:last-child>td]:border-b-0",
        className,
      )}
      {...props}
    />
  ),
);
Tr.displayName = "Tr";

export { DataTable, Th, Td, Tr };
