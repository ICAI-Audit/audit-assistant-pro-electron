import { format, isValid, parseISO } from 'date-fns';
import { CONSTITUTION_TYPES } from '@/data/constitutionTypes';

type Tone = 'success' | 'warning' | 'info' | 'danger' | 'neutral' | 'violet';

// SQLite stores timestamps as "YYYY-MM-DD HH:MM:SS" in UTC.
const SQLITE_UTC = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/;

/** dd MMM yyyy for display only; the stored value is never changed. Unparseable input is returned as is. */
export function formatDisplayDate(value: string | null | undefined): string {
  if (!value) return '';
  const parsed = parseISO(SQLITE_UTC.test(value) ? `${value.replace(' ', 'T')}Z` : value);
  return isValid(parsed) ? format(parsed, 'dd MMM yyyy') : value;
}

/** "company" -> "Company"; known constitutions use their registered label. */
export function formatConstitution(value: string | null | undefined): string {
  if (!value) return '';
  const known = CONSTITUTION_TYPES.find((item) => item.value === value);
  if (known) return known.label;
  const spaced = value.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export const OWNERSHIP_KINDS: Record<string, { label: string; tone: Tone }> = {
  director: { label: 'Director', tone: 'violet' },
  kmp: { label: 'Key management personnel', tone: 'neutral' },
  partner: { label: 'Partner', tone: 'success' },
  shareholder: { label: 'Shareholder', tone: 'info' },
  beneficial_owner: { label: 'Beneficial owner', tone: 'warning' },
  related_party: { label: 'Related party', tone: 'neutral' },
  group_company: { label: 'Group company', tone: 'neutral' },
  committee: { label: 'Board or committee', tone: 'info' },
  authorized_signatory: { label: 'Authorised signatory', tone: 'success' },
};

export function kindLabel(kind: string): string {
  return OWNERSHIP_KINDS[kind]?.label ?? kind;
}

export const VERIFICATION_STATUSES: Record<string, { label: string; tone: Tone }> = {
  unverified: { label: 'Unverified', tone: 'warning' },
  verified: { label: 'Verified', tone: 'success' },
  rejected: { label: 'Rejected', tone: 'danger' },
};

/** Presentation-only grouping of the server's PF-xx categories; unknown codes fall under "Other". */
const CATEGORY_GROUPS: { label: string; codes: string[] }[] = [
  { label: 'Entity and constitution', codes: ['PF-01', 'PF-02', 'PF-03'] },
  { label: 'Operations and contracts', codes: ['PF-04', 'PF-05'] },
  { label: 'Finance and banking', codes: ['PF-06', 'PF-08', 'PF-10'] },
  { label: 'Registrations and compliance', codes: ['PF-07', 'PF-11', 'PF-12'] },
  { label: 'Controls, group and audit', codes: ['PF-09', 'PF-13', 'PF-14', 'PF-15'] },
];

export function groupCategories(categories: Record<string, string>): { label: string; options: [string, string][] }[] {
  const known = new Set(CATEGORY_GROUPS.flatMap((group) => group.codes));
  const groups = CATEGORY_GROUPS.map((group) => ({
    label: group.label,
    options: group.codes.filter((code) => code in categories).map((code): [string, string] => [code, categories[code]]),
  }));
  const other = Object.entries(categories).filter(([code]) => !known.has(code));
  if (other.length > 0) groups.push({ label: 'Other', options: other });
  return groups.filter((group) => group.options.length > 0);
}
