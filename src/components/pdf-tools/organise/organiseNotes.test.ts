// What the Organise pages dialog says before a run about what the result keeps (design 5.15, 5.3 and
// 5.10, and pageOrder.ts after review fix round 1): a rotate-only run is made in the file itself and
// keeps everything; a move or removal goes through the page copy of Split and Delete pages, so the
// dialog says what that does not carry, only for what the file really has where that is known (as
// carryNotes does for Split and Delete pages), what happens to page labels, and what to do. At most two
// sentences (ux-audit E6).
import { describe, expect, it } from 'vitest';
import { carryNotesBeforeRun } from './organiseNotes';

const plain = { hasBookmarks: false, hasPageLinks: false, hasFormFields: false };
const rich = { hasBookmarks: true, hasPageLinks: true, hasFormFields: true };
const counts = (moved: number, turned: number, removed: number) => ({ moved, turned, removed, kept: 10 - removed });
const sentences = (text: string) => text.split(/(?<=\.)\s+/).filter(Boolean).length;

describe('carryNotesBeforeRun', () => {
  it('says nothing before a change', () => {
    expect(carryNotesBeforeRun(rich, counts(0, 0, 0))).toBeNull();
  });

  it('rotating only: made in the file itself, everything kept', () => {
    expect(carryNotesBeforeRun(rich, counts(0, 3, 0))).toEqual({
      kind: 'kept',
      title: 'Only rotating pages',
      text: 'The pages are rotated in the file itself, so its bookmarks, links, form fields, page labels and attachments are all kept.',
    });
  });

  it('a move on a plain file: the document parts a new file does not carry, labels, and what to do', () => {
    expect(carryNotesBeforeRun(plain, counts(2, 1, 0))).toEqual({
      kind: 'not-carried',
      title: 'What is not carried over',
      text: 'XMP metadata, accessibility tags, document scripts and viewer settings, if the file has any, are not carried into the new file. Page labels stay with their pages; keep the original if you need anything not carried.',
    });
  });

  it('a move on a file with bookmarks and links: both follow their pages, so nothing more is said', () => {
    expect(carryNotesBeforeRun(rich, counts(2, 0, 0))!.text).toBe(carryNotesBeforeRun(plain, counts(2, 0, 0))!.text);
  });

  it('a removal on a file with bookmarks and links: named first, in the Split and Delete pages words', () => {
    expect(carryNotesBeforeRun(rich, counts(0, 0, 1))!.text).toBe(
      'Bookmarks of removed pages, links to removed pages, and XMP metadata, accessibility tags, document scripts and viewer settings, if the file has any, are not carried into the new file. Page labels stay with their pages; keep the original if you need anything not carried.',
    );
    expect(carryNotesBeforeRun({ ...plain, hasBookmarks: true }, counts(0, 0, 1))!.text).toMatch(/^Bookmarks of removed pages, and XMP metadata/);
  });

  it('attachments: kept when pages are moved or removed, said only when the file has them (coordinator, review)', () => {
    const withFiles = { ...rich, hasAttachments: true };
    expect(carryNotesBeforeRun(withFiles, counts(0, 0, 1))!.kept).toBe("Attachments in the document's list are kept when pages are removed.");
    expect(carryNotesBeforeRun(withFiles, counts(2, 0, 0))!.kept).toBe("Attachments in the document's list are kept when pages are removed.");
    expect(carryNotesBeforeRun(rich, counts(0, 0, 1))!.kept).toBeUndefined();
    expect(carryNotesBeforeRun({ ...rich, hasAttachments: false }, counts(0, 0, 1))!.kept).toBeUndefined();
    expect(carryNotesBeforeRun(withFiles, counts(0, 1, 0))!.kept).toBeUndefined(); // rotate only: the text already says they are kept
  });

  it('at most two sentences, never naming the file', () => {
    for (const c of [counts(0, 1, 0), counts(1, 0, 0), counts(0, 0, 2), counts(3, 2, 1)]) {
      const notes = carryNotesBeforeRun({ ...rich, name: 'Client ledger.pdf' } as never, c)!;
      expect(sentences(notes.text), notes.text).toBeLessThanOrEqual(2);
      expect(JSON.stringify(notes)).not.toContain('ledger');
    }
  });
});
