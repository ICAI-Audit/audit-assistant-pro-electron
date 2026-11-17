// What a result still carries besides its pages (comments, attachments, document properties), in one
// plain sentence with counts, shown in the run's message and on the result's row; nothing when there is
// nothing. The counts come from the result's own bytes (inspect.ts). Text that only looks hidden cannot
// be found reliably, so it is never claimed; and no cleaning step is offered (none exists). All the
// words of this notice live here.
import { carriesAnything } from '@/lib/pdf-tools/inspect';
import type { CarriedContent, CarriedProperty, WorkingFile } from '@/lib/pdf-tools/types';
import { plural } from './format';

/** "a", "a and b", "a, b and c". */
function andList(items: readonly string[]): string {
  return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

const ORDER: readonly CarriedProperty[] = ['title', 'author', 'subject', 'keywords'];

/** What is carried, as words: "2 comments, 1 attachment and its title and author". */
function carriedWords(comments: number, attachments: number, properties: readonly CarriedProperty[], owner: 'its' | 'their'): string {
  const parts: string[] = [];
  if (comments > 0) parts.push(plural(comments, 'comment'));
  if (attachments > 0) parts.push(plural(attachments, 'attachment'));
  const named = ORDER.filter((p) => properties.includes(p));
  if (named.length > 0) parts.push(`${owner} ${andList(named)}`);
  return andList(parts);
}

/** One copy: "This copy still carries 2 comments and 1 attachment." Null when it carries nothing. */
export function carriedContentNotice(carried: CarriedContent | undefined): string | null {
  if (!carriesAnything(carried)) return null;
  return `This copy still carries ${carriedWords(carried.comments, carried.attachments, carried.properties, 'its')}.`;
}

/** Several files: how many carry something, and what they carry together (counts summed). */
function together(files: readonly WorkingFile[]): { carrying: number; words: string } | null {
  const carrying = files.filter((f) => carriesAnything(f.carried));
  if (carrying.length === 0) return null;
  const comments = carrying.reduce((sum, f) => sum + (f.carried?.comments ?? 0), 0);
  const attachments = carrying.reduce((sum, f) => sum + (f.carried?.attachments ?? 0), 0);
  const properties = ORDER.filter((p) => carrying.some((f) => f.carried?.properties.includes(p)));
  return { carrying: carrying.length, words: carriedWords(comments, attachments, properties, 'their') };
}

/** The run's message for the results it made: one sentence, the counts summed. Null when none carries anything. */
export function carriedFilesNotice(files: readonly WorkingFile[]): string | null {
  if (files.length === 1) return carriedContentNotice(files[0].carried);
  const all = together(files);
  if (!all) return null;
  const who = all.carrying < files.length ? `${all.carrying} of these ${files.length} copies` : files.length === 2 ? 'Both copies' : `These ${files.length} copies`;
  return `${who} still carry ${all.words}.`;
}

/** A group row's short label (the parts of a split): "Still carry their title and author". Null when none carries anything. */
export function carriedGroupLabel(files: readonly WorkingFile[]): string | null {
  const all = together(files);
  if (!all) return null;
  return all.carrying < files.length ? `${all.carrying} of ${files.length} still carry ${all.words}` : `Still carry ${all.words}`;
}

/** The row's short label: "Still carries 2 comments and its title". Null when nothing. */
export function carriedTagLabel(carried: CarriedContent | undefined): string | null {
  if (!carriesAnything(carried)) return null;
  return `Still carries ${carriedWords(carried.comments, carried.attachments, carried.properties, 'its')}`;
}
