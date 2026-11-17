import { describe, expect, it } from 'vitest';
import type { CarriedContent, WorkingFile } from '@/lib/pdf-tools/types';
import { carriedContentNotice, carriedFilesNotice, carriedGroupLabel, carriedTagLabel } from './carriedNotice';

const carried = (comments: number, attachments: number, properties: CarriedContent['properties'] = []): CarriedContent => ({ comments, attachments, properties });
const result = (name: string, c?: CarriedContent): WorkingFile =>
  ({ id: name, name, kind: 'pdf', mimeType: 'application/pdf', origin: 'result', bytes: new Uint8Array(), size: 0, pageCount: 1, wasProtected: false, hasRestrictions: false, hasSignature: false, sentTo: [], ...(c ? { carried: c } : {}) }) as WorkingFile;

describe('carriedContentNotice: one plain sentence with counts, only when there is something', () => {
  it('names comments, attachments and the properties filled in', () => {
    expect(carriedContentNotice(carried(2, 1, ['title', 'author', 'subject', 'keywords']))).toBe(
      'This copy still carries 2 comments, 1 attachment and its title, author, subject and keywords.',
    );
    expect(carriedContentNotice(carried(2, 1))).toBe('This copy still carries 2 comments and 1 attachment.');
  });
  it('says only what was found', () => {
    expect(carriedContentNotice(carried(1, 0))).toBe('This copy still carries 1 comment.');
    expect(carriedContentNotice(carried(0, 3))).toBe('This copy still carries 3 attachments.');
    expect(carriedContentNotice(carried(0, 0, ['author']))).toBe('This copy still carries its author.');
    expect(carriedContentNotice(carried(0, 0, ['title', 'keywords']))).toBe('This copy still carries its title and keywords.');
  });
  it('says nothing about a file that carries nothing', () => {
    expect(carriedContentNotice(carried(0, 0))).toBeNull();
    expect(carriedContentNotice(undefined)).toBeNull();
  });
  it('never claims to have looked for hidden text, and never sends the user to a cleaning step', () => {
    const text = carriedContentNotice(carried(2, 1, ['title'])) ?? '';
    expect(text).not.toMatch(/hidden|clean|remove|Clean copy/i);
    expect(text.split('. ').length).toBe(1);
  });
});

describe('carriedFilesNotice: the result message for what a run made', () => {
  it('is the one-file sentence for a single result', () => {
    expect(carriedFilesNotice([result('a.pdf', carried(2, 0))])).toBe('This copy still carries 2 comments.');
  });
  it('sums up several results in one sentence', () => {
    const props = carried(0, 0, ['title', 'author']);
    expect(carriedFilesNotice(Array.from({ length: 10 }, (_, i) => result(`p${i}.pdf`, props)))).toBe('These 10 copies still carry their title and author.');
    expect(carriedFilesNotice([result('a.pdf', props), result('b.pdf', props)])).toBe('Both copies still carry their title and author.');
    expect(carriedFilesNotice([result('a.pdf', carried(1, 0)), result('b.pdf', carried(2, 2, ['title'])), result('c.pdf')])).toBe(
      '2 of these 3 copies still carry 3 comments, 2 attachments and their title.',
    );
  });
  it('says nothing when no result carries anything (images included)', () => {
    expect(carriedFilesNotice([result('a.pdf'), result('b.pdf', carried(0, 0))])).toBeNull();
    expect(carriedFilesNotice([])).toBeNull();
  });
});

describe('carriedTagLabel', () => {
  it('a short label for the row, from the same words', () => {
    expect(carriedTagLabel(carried(2, 1, ['title']))).toBe('Still carries 2 comments, 1 attachment and its title');
    expect(carriedTagLabel(carried(0, 0, ['title']))).toBe('Still carries its title');
    expect(carriedTagLabel(carried(0, 0))).toBeNull();
  });
  it('a short label for a group row', () => {
    const props = carried(0, 0, ['title', 'author']);
    expect(carriedGroupLabel([result('p1.pdf', props), result('p2.pdf', props)])).toBe('Still carry their title and author');
    expect(carriedGroupLabel([result('p1.pdf', carried(1, 0)), result('p2.pdf')])).toBe('1 of 2 still carry 1 comment');
    expect(carriedGroupLabel([result('p1.pdf'), result('p2.pdf')])).toBeNull();
  });
});
