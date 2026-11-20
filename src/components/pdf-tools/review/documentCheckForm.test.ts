// The Document check dialog's words, record and message (documentCheckForm.ts): the record holds counts and
// one choice only, never a property value, a signer's name or a file's title.
import { describe, expect, it } from 'vitest';
import type { DocumentFacts } from '@/lib/pdf-tools/documentCheck';
import {
  BLOCKED_WHILE_READING,
  CHECK_STOPPED,
  DESCRIPTION,
  MADE_FROM_SIGNED_NOTE,
  RECORD_KEYS,
  RUN_LABEL,
  SIGNED_WARNING,
  SUMMARY,
  WRITING_LABEL,
  readingLabel,
  recordOptions,
  resultDescription,
  summary,
} from './documentCheckForm';

const facts: DocumentFacts = {
  pageCount: 12,
  sizeBytes: 2048,
  pageSizes: [{ label: 'A4 portrait', pages: 12 }],
  protection: 'restrictions',
  signatures: [
    { signer: 'MKSIGNER Example', signedOn: '17 November 2026', reason: 'MKREASON', location: 'MKPLACE', coversWholeFile: true },
    { signer: null, signedOn: null, reason: null, location: null, coversWholeFile: false },
  ],
  text: { pagesWithText: 9, pagesScanned: 2, pagesEmpty: 1 },
  properties: { title: 'MKTITLE', author: 'MKAUTHOR', subject: 'MKSUBJECT', keywords: 'MKKEYWORDS', creator: 'MKCREATOR', producer: 'MKPRODUCER', created: '1 April 2026', modified: null },
  pdfVersion: '1.7',
  hasBookmarks: true,
  hasFormFields: true,
  hasAttachments: true,
};

describe('document check record', () => {
  it('says what was done in one line with the page count', () => {
    expect(SUMMARY).toBe('Document check');
    expect(summary(facts)).toBe('Document check: 12 pages');
    expect(summary({ ...facts, pageCount: 1 })).toBe('Document check: 1 page');
  });

  it('keeps only counts and the protection choice', () => {
    expect(RECORD_KEYS).toEqual(['pages', 'signatures', 'pagesWithText', 'pagesScanned', 'protection']);
    const options = recordOptions(facts);
    expect(options).toEqual({ pages: 12, signatures: 2, pagesWithText: 9, pagesScanned: 2, protection: 'restrictions' });
    expect(Object.keys(options)).toEqual([...RECORD_KEYS]);
    expect(JSON.stringify(options) + summary(facts)).not.toMatch(/MK[A-Z]+/);
  });
});

describe('document check words', () => {
  it('has the plain words of the dialog', () => {
    expect(RUN_LABEL).toBe('Add report to list');
    expect(DESCRIPTION).toBe('See what this PDF holds, read on this computer. Add the facts to the list as a PDF report.');
    expect(SIGNED_WARNING).toBe('This file is signed. The result is a new file; the signed original is unchanged.');
    expect(readingLabel(3, 12)).toBe('Reading page 3 of 12');
    expect(WRITING_LABEL).toBe('Writing the report…');
    expect(CHECK_STOPPED).toBe('The check was stopped.');
    expect(BLOCKED_WHILE_READING).toBe('Wait for the check to finish, or stop it.');
    expect(MADE_FROM_SIGNED_NOTE).toBe('This copy was made in PDF Tools from a signed file. A signature still in it does not apply to this copy; check the signed original.');
    for (const text of [RUN_LABEL, DESCRIPTION, SIGNED_WARNING, CHECK_STOPPED, BLOCKED_WHILE_READING, MADE_FROM_SIGNED_NOTE]) expect(text).not.toMatch(/valid/i);
  });

  it('describes the result, with the signature note and the words not shown', () => {
    expect(resultDescription('Ledger_check.pdf', { signatures: 0, wordsNotShown: 0 })).toEqual({ message: 'Report added: Ledger_check.pdf', tone: 'success' });
    expect(resultDescription('Ledger_check.pdf', { signatures: 2, wordsNotShown: 0 })).toEqual({
      message: 'Report added: Ledger_check.pdf',
      detail: 'Open the file in Adobe Acrobat Reader to verify the signature.',
      tone: 'success',
    });
    expect(resultDescription('Ledger_check.pdf', { signatures: 0, wordsNotShown: 1 }).detail).toBe('1 word in another script is shown as [word in another script].');
    expect(resultDescription('Ledger_check.pdf', { signatures: 1, wordsNotShown: 3 }).detail).toBe(
      'Open the file in Adobe Acrobat Reader to verify the signature. 3 words in another script are shown as [word in another script].',
    );
  });
});
