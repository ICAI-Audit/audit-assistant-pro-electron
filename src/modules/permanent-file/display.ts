import type { PermanentDocument } from './types';

export function displayReference(document: PermanentDocument): string {
  return `${document.category}-DOC-${String(document.documentNumber).padStart(3, '0')}-V${String(document.version).padStart(2, '0')}`;
}
