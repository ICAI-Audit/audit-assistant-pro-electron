// The tool dialogs' note about protection (QA-FIX E), describing the files in hand: a file opened with
// its password "was password-protected"; a file that opened without one only had restrictions (copying,
// printing). Every tool works on the unlocked copy, so no result has either. A result never had a password
// itself: that a source had one is kept in its record only ("protection removed").
import type { WorkingFile } from '@/lib/pdf-tools/types';

export interface ProtectionNotice {
  title: string;
  text: string;
}

export function protectionNotice(files: readonly WorkingFile[]): ProtectionNotice | null {
  const inputs = files.filter((f) => f.origin !== 'result' && f.wasProtected);
  const restricted = inputs.filter((f) => f.hasRestrictions);
  const passwords = inputs.filter((f) => !f.hasRestrictions);
  if (inputs.length === 0) return null;
  if (restricted.length > 0 && passwords.length > 0) {
    return { title: 'Protection removed', text: 'Some of these files had a password or restrictions. The result will have neither.' };
  }
  if (restricted.length > 0) {
    const who = restricted.length === 1 ? `${restricted[0].name} has` : `${restricted.length} of these files have`;
    return { title: 'Restrictions removed', text: `${who} restrictions (for example on copying or printing). The result will not have them.` };
  }
  const who = passwords.length === 1 ? `${passwords[0].name} was` : `${passwords.length} of these files were`;
  return { title: 'Protection removed', text: `${who} password-protected. The result will not have a password.` };
}
