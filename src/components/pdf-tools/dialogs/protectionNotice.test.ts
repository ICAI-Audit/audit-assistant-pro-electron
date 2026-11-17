import { describe, expect, it } from 'vitest';
import type { WorkingFile } from '@/lib/pdf-tools/types';
import { protectionNotice } from './protectionNotice';

const file = (name: string, extra: Partial<WorkingFile> = {}): WorkingFile =>
  ({ id: name, name, kind: 'pdf', mimeType: 'application/pdf', origin: 'computer', bytes: new Uint8Array(), size: 0, pageCount: 1, wasProtected: false, hasRestrictions: false, hasSignature: false, sentTo: [], ...extra }) as WorkingFile;

describe('protectionNotice: the dialogs describe the files in hand', () => {
  it('a file opened with its password', () => {
    expect(protectionNotice([file('Q2.pdf', { wasProtected: true })])).toEqual({
      title: 'Protection removed',
      text: 'Q2.pdf was password-protected. The result will not have a password.',
    });
    expect(protectionNotice([file('a.pdf', { wasProtected: true }), file('b.pdf', { wasProtected: true }), file('c.pdf')])).toEqual({
      title: 'Protection removed',
      text: '2 of these files were password-protected. The result will not have a password.',
    });
  });
  it('a file that opened without a password has restrictions, not a password', () => {
    expect(protectionNotice([file('No copy.pdf', { wasProtected: true, hasRestrictions: true })])).toEqual({
      title: 'Restrictions removed',
      text: 'No copy.pdf has restrictions (for example on copying or printing). The result will not have them.',
    });
    expect(protectionNotice([file('a.pdf', { wasProtected: true, hasRestrictions: true }), file('b.pdf', { wasProtected: true, hasRestrictions: true })])?.text).toBe(
      '2 of these files have restrictions (for example on copying or printing). The result will not have them.',
    );
  });
  it('both kinds together', () => {
    expect(protectionNotice([file('a.pdf', { wasProtected: true }), file('b.pdf', { wasProtected: true, hasRestrictions: true })])).toEqual({
      title: 'Protection removed',
      text: 'Some of these files had a password or restrictions. The result will have neither.',
    });
  });
  it('says nothing for results (they never have a password) or plain files', () => {
    expect(protectionNotice([file('merged.pdf', { origin: 'result' }), file('x.pdf')])).toBeNull();
    // An older row that still says so is not believed for a result.
    expect(protectionNotice([file('merged.pdf', { origin: 'result', wasProtected: true })])).toBeNull();
  });
});
