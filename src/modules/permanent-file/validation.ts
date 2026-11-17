export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/** Same rule as the main process: a non-empty file of at most 25 MiB. */
export function validateUpload(file: Pick<File, 'size'>): string | null {
  return file.size === 0 || file.size > MAX_UPLOAD_BYTES ? 'Choose a non-empty document no larger than 25 MiB.' : null;
}

/** Why "Save document" is unavailable, or null when it can proceed. */
export function uploadBlocker(input: { file: File | null; existingDocumentId: string; name: string }): string | null {
  if (!input.file) return 'Choose a file to enable saving.';
  if (!input.existingDocumentId && !input.name.trim()) return 'Enter a document name to enable saving.';
  return null;
}

export type OwnershipDateErrors = { from?: string; until?: string };

/** Mirrors the main-process rules: neither date after today, and Until strictly after From. */
export function validateOwnershipDates(input: { from: string; until: string; today: string }): OwnershipDateErrors {
  const errors: OwnershipDateErrors = {};
  if (input.from && input.from > input.today) errors.from = 'Effective from cannot be in the future.';
  if (input.until && input.until > input.today) errors.until = 'Until cannot be in the future.';
  else if (input.from && input.until && input.until <= input.from) errors.until = 'Until must be after Effective from.';
  return errors;
}
