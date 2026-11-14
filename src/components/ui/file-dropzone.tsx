import * as React from "react";
import { FileText, UploadCloud, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { formatFileSize } from "@/lib/formatFileSize";
import { Button } from "@/components/ui/button";

interface FileDropzoneProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "onChange" | "className"> {
  file: File | null;
  onFileChange: (file: File | null) => void;
  /** Returns an error message for an unacceptable file, or null. */
  validate?: (file: File) => string | null;
  /** Shows an indeterminate progress bar and locks the control. */
  uploading?: boolean;
  hint?: React.ReactNode;
  className?: string;
}

/**
 * Click-or-drop file picker. A real <input type="file"> stays underneath (visually
 * hidden but focusable), so keyboard and screen-reader behaviour is the native one.
 */
function FileDropzone({ file, onFileChange, validate, uploading = false, hint, className, id, disabled, ...inputProps }: FileDropzoneProps) {
  const [dragging, setDragging] = React.useState(false);
  const [error, setError] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement>(null);
  const hadFile = React.useRef(false);

  // After "Remove", put focus back on the picker so keyboard users are not stranded.
  React.useEffect(() => {
    if (file) hadFile.current = true;
    else if (hadFile.current) {
      hadFile.current = false;
      inputRef.current?.focus();
    }
  }, [file]);

  function accept(candidate: File | undefined) {
    if (!candidate) return;
    const problem = validate?.(candidate) ?? null;
    if (problem) {
      setError(problem);
      onFileChange(null);
      return;
    }
    setError("");
    onFileChange(candidate);
  }

  if (file) {
    return (
      <div className={cn("space-y-3 rounded-lg border bg-muted/40 p-3", className)}>
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-info-soft text-info-ink">
            <FileText aria-hidden="true" className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-foreground">{file.name}</p>
            <p className="text-xs text-subtle">{formatFileSize(file.size)}</p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            aria-label={`Remove ${file.name}`}
            disabled={uploading}
            onClick={() => {
              setError("");
              onFileChange(null);
            }}
          >
            <X aria-hidden="true" />
          </Button>
        </div>
        {uploading && (
          <div role="progressbar" aria-label="Uploading" aria-busy="true" className="relative h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div className="absolute inset-y-0 left-0 w-2/5 rounded-full bg-primary animate-progress-indeterminate motion-reduce:animate-none" />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={className}>
      <label
        htmlFor={id}
        onDragEnter={(event) => {
          event.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          if (!disabled) accept(event.dataTransfer.files[0]);
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-6 py-8 text-center ring-offset-background transition-colors duration-150 focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 motion-reduce:transition-none",
          dragging ? "border-primary bg-info-soft" : "border-input bg-info-soft/40 hover:bg-info-soft/70",
          error && "border-destructive",
          disabled && "cursor-not-allowed opacity-50",
        )}
      >
        <input
          {...inputProps}
          ref={inputRef}
          id={id}
          type="file"
          disabled={disabled}
          className="sr-only"
          onChange={(event) => accept(event.target.files?.[0])}
        />
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-info-soft text-primary">
          <UploadCloud aria-hidden="true" className="h-5 w-5" />
        </span>
        <span className="text-sm text-foreground">
          <span className="font-medium text-primary">Click to upload</span> or drag and drop
        </span>
        {hint && <span className="text-xs text-subtle">{hint}</span>}
      </label>
      {error && (
        <p role="alert" className="mt-1.5 text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

export { FileDropzone };
