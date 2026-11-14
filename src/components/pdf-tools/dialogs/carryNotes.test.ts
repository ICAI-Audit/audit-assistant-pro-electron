import { describe, expect, it } from 'vitest';
import type { WorkingFile } from '@/lib/pdf-tools/types';
import { carryNotes } from './carryNotes';

function file(name: string, over: Partial<WorkingFile> = {}): WorkingFile {
  return {
    id: name,
    name,
    kind: 'pdf',
    mimeType: 'application/pdf',
    origin: 'computer',
    bytes: new Uint8Array(1),
    size: 1,
    pageCount: 2,
    wasProtected: false,
    hasRestrictions: false,
    hasSignature: false,
    sentTo: [],
    ...over,
  };
}

describe('carryNotes', () => {
  it('says nothing when there is nothing to lose', () => {
    expect(carryNotes('merge', [file('a.pdf'), file('b.pdf')])).toEqual({ forms: null, notes: [] });
    expect(carryNotes('split', [file('a.pdf')])).toEqual({ forms: null, notes: [] });
    expect(carryNotes('delete-pages', [file('a.pdf', { hasFormFields: true })])).toEqual({ forms: null, notes: [] });
  });

  it('warns before a merge of files with form fields, naming one or counting several', () => {
    expect(carryNotes('merge', [file('Confirmation.pdf', { hasFormFields: true }), file('b.pdf')]).forms).toBe(
      'Confirmation.pdf has form fields. Filled-in form fields are not carried into the merged file; the values may not be shown.',
    );
    expect(carryNotes('merge', [file('a.pdf', { hasFormFields: true }), file('b.pdf', { hasFormFields: true }), file('c.pdf')]).forms).toBe(
      '2 of these files have form fields. Filled-in form fields are not carried into the merged file; the values may not be shown.',
    );
  });

  it('says bookmarks and links are not carried, only when a file has them', () => {
    expect(carryNotes('merge', [file('a.pdf', { hasBookmarks: true }), file('b.pdf', { hasPageLinks: true })]).notes).toEqual([
      'Bookmarks are not carried into the merged file.',
      'Links between pages do not work in the merged file.',
    ]);
    expect(carryNotes('split', [file('a.pdf', { hasBookmarks: true, hasPageLinks: true })]).notes).toEqual([
      'Bookmarks are not carried into the result.',
      'Links to pages that are left out are removed; other links between pages may not work.',
    ]);
    expect(carryNotes('delete-pages', [file('a.pdf', { hasPageLinks: true })]).notes).toEqual([
      'Links to pages that are left out are removed; other links between pages may not work.',
    ]);
  });
});
