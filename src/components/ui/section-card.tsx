import * as React from "react";

import { cn } from "@/lib/utils";

const SectionCard = React.forwardRef<HTMLElement, React.HTMLAttributes<HTMLElement>>(({ className, ...props }, ref) => (
  <section ref={ref} className={cn("min-w-0 rounded-xl border bg-card text-card-foreground shadow-sm", className)} {...props} />
));
SectionCard.displayName = "SectionCard";

interface SectionCardHeaderProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Compact facts shown beside the title, e.g. chips. */
  meta?: React.ReactNode;
  /** Right-aligned actions. */
  actions?: React.ReactNode;
  /** Draw the divider under the header. */
  divider?: boolean;
  className?: string;
}

/** Title and description on the left, actions on the right. The title element is an h2. */
function SectionCardHeader({ title, description, meta, actions, divider = true, className }: SectionCardHeaderProps) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-start justify-between gap-x-4 gap-y-3 px-5 py-4",
        divider && "border-b",
        className,
      )}
    >
      <div className="min-w-0 flex-1 basis-[14rem] space-y-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h2 className="text-base font-semibold tracking-tight text-foreground">{title}</h2>
          {meta}
        </div>
        {description && <p className="text-xs text-subtle">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

const SectionCardBody = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("p-5", className)} {...props} />
));
SectionCardBody.displayName = "SectionCardBody";

export { SectionCard, SectionCardHeader, SectionCardBody };
