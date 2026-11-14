import type { ReactNode } from 'react';
import type { WorkingFile } from '@/lib/pdf-tools/types';

/** Classes that mark an input whose value is not valid (it carries aria-invalid). */
export const INVALID_INPUT = 'aria-[invalid=true]:border-destructive aria-[invalid=true]:focus-visible:ring-destructive';

/** Props an input inside a Field needs so that its hint or error is read out with it. */
export function describedBy(id: string, error?: string | null, hint?: ReactNode) {
  return { id, 'aria-invalid': error ? true : undefined, 'aria-describedby': error || hint ? `${id}-message` : undefined } as const;
}

/** The general warning before a tool runs on signed files (spec 5.1). */
export function signedWarningText(files: WorkingFile[]): string {
  const signed = files.filter((f) => f.hasSignature);
  const who =
    files.length === 1
      ? 'This file carries a digital signature.'
      : signed.length === 1
        ? `${signed[0].name} carries a digital signature.`
        : `${signed.length} of these files carry digital signatures.`;
  return `${who} The result will not carry a valid signature.`;
}
