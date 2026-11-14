import { useId, type ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface FieldControlProps {
  id: string;
  "aria-describedby"?: string;
  "aria-invalid"?: true;
  "aria-required"?: true;
}

interface FieldProps {
  label: ReactNode;
  required?: boolean;
  optional?: boolean;
  hint?: ReactNode;
  error?: ReactNode;
  className?: string;
  /** Receives the id and aria attributes to spread onto the control. */
  children: (control: FieldControlProps) => ReactNode;
}

/** Label above a control, with required/optional marker and hint or error text wired by id. */
export function Field({ label, required, optional, hint, error, className, children }: FieldProps) {
  const id = useId();
  const messageId = error || hint ? `${id}-message` : undefined;

  return (
    <div className={cn("min-w-0 space-y-1.5", className)}>
      <label htmlFor={id} className="block text-body-sm font-medium text-foreground">
        {label}
        {required && (
          <span aria-hidden="true" className="ml-0.5 text-destructive">
            *
          </span>
        )}
        {optional && <span className="ml-1 font-normal text-subtle">(optional)</span>}
      </label>
      {children({
        id,
        "aria-describedby": messageId,
        "aria-invalid": error ? true : undefined,
        "aria-required": required ? true : undefined,
      })}
      {error ? (
        <p id={messageId} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : (
        hint && (
          <p id={messageId} className="text-xs text-subtle">
            {hint}
          </p>
        )
      )}
    </div>
  );
}
