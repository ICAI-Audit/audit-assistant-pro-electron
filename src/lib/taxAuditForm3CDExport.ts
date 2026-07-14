import { FORM_3CD_CLAUSES } from '@/data/taxAudit3CDClauses';
import { TaxAuditClauseResponse, TaxAuditSetup } from '@/types/taxAudit';

export type TaxAuditForm3CDExportRow = {
  clauseKey: string;
  clauseNo: string;
  title: string;
  particulars: string;
  status: string;
  reviewStatus: string;
  auditorRemarks: string;
  qualificationOrObservation: string;
  workpaperReference: string;
};

export type TaxAuditForm3CDExport = {
  generatedAt: string;
  fileBaseName: string;
  heading: string;
  statutoryReference: string;
  draftNotice: string;
  assesseeDetailsHeading: string;
  particularsHeading: string;
  assessee: {
    name: string;
    pan: string;
    address: string;
    status: string;
    assessmentYear: string;
    previousYear: string;
    formType: string;
  };
  rows: TaxAuditForm3CDExportRow[];
};

export type BuildTaxAuditForm3CDExportInput = {
  setup: TaxAuditSetup;
  clientName?: string | null;
  clausesByKey: Map<string, TaxAuditClauseResponse>;
  generatedAt?: string;
};

const parseJson = <T,>(value: string | null | undefined, fallback: T): T => {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

const stripHtml = (value: string | null | undefined) =>
  (value || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const compact = (value: unknown, fallback = 'Not available') => {
  const text = value === null || value === undefined ? '' : String(value).trim();
  return text || fallback;
};

const formatStatus = (value: string | null | undefined) =>
  value
    ? value
        .split('_')
        .map((part) => (part ? `${part.charAt(0).toUpperCase()}${part.slice(1)}` : part))
        .join(' ')
    : 'Not available';

const humanizeKey = (key: string) =>
  key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());

const structuredValueHasContent = (value: unknown): boolean => {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'boolean') return value === true;
  if (Array.isArray(value)) return value.some((item) => structuredValueHasContent(item));
  if (typeof value === 'object') return Object.values(value as Record<string, unknown>).some(structuredValueHasContent);
  return false;
};

const formatStructuredScalar = (value: unknown) => {
  if (value === true) return 'Yes';
  if (value === false) return 'No';
  if (value === null || value === undefined) return '';
  return String(value).trim();
};

const formatStructuredRow = (row: unknown) => {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return formatStructuredScalar(row);
  return Object.entries(row as Record<string, unknown>)
    .filter(([, value]) => structuredValueHasContent(value))
    .map(([key, value]) => `${humanizeKey(key)}: ${formatStructuredScalar(value)}`)
    .join('; ');
};

const getStructuredParticulars = (clause?: TaxAuditClauseResponse) => {
  if (!clause) return '';
  const response = parseJson<Record<string, unknown>>(clause.response_json, {});
  const structured =
    response.structured && typeof response.structured === 'object' && !Array.isArray(response.structured)
      ? (response.structured as Record<string, unknown>)
      : {};

  return Object.entries(structured)
    .flatMap(([key, value]) => {
      if (!structuredValueHasContent(value)) return [];
      if (Array.isArray(value)) {
        const rows = value.map(formatStructuredRow).filter(Boolean);
        if (rows.length === 0) return [];
        return [`${humanizeKey(key)}:`, ...rows.map((row, index) => `${index + 1}. ${row}`)];
      }
      return [`${humanizeKey(key)}: ${formatStructuredScalar(value)}`];
    })
    .join('\n');
};

export const TAX_AUDIT_FORM_3CD_EMPTY_PARTICULARS =
  'Particulars not captured. Review and complete this clause before signing or portal upload.';

export const TAX_AUDIT_FORM_3CD_DRAFT_NOTICE =
  'Draft output generated from AuditPro Tax Audit module. Review all particulars, applicability, evidence, and qualifications before signing or uploading to the Income Tax portal.';

const buildClauseParticulars = (clause?: TaxAuditClauseResponse) => {
  const responseText = stripHtml(clause?.response_html);
  const structuredText = getStructuredParticulars(clause);
  const parts = [responseText, structuredText].filter(Boolean);
  return parts.length > 0 ? parts.join('\n\n') : TAX_AUDIT_FORM_3CD_EMPTY_PARTICULARS;
};

const safeFilenamePart = (value: string) =>
  Array.from(value)
    .map((character) =>
      '<>:"/\\|?*'.includes(character) || character.charCodeAt(0) < 32 ? '_' : character
    )
    .join('')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 80);

export const buildTaxAuditForm3CDExport = ({
  setup,
  clientName,
  clausesByKey,
  generatedAt = new Date().toISOString(),
}: BuildTaxAuditForm3CDExportInput): TaxAuditForm3CDExport => {
  const assesseeName = compact(clientName || setup.assessee_name, 'Assessee');
  const previousYear =
    setup.previous_year_from && setup.previous_year_to
      ? `${setup.previous_year_from} to ${setup.previous_year_to}`
      : compact(setup.financial_year);

  return {
    generatedAt,
    fileBaseName: `Form_3CD_${safeFilenamePart(assesseeName)}_${safeFilenamePart(setup.assessment_year || 'AY')}`,
    heading: 'Form No. 3CD',
    statutoryReference: 'Statement of particulars required to be furnished under section 44AB of the Income-tax Act, 1961 and Rule 6G of the Income-tax Rules, 1962.',
    draftNotice: TAX_AUDIT_FORM_3CD_DRAFT_NOTICE,
    assesseeDetailsHeading: 'Assessee and Report Details',
    particularsHeading: 'Statement of Particulars',
    assessee: {
      name: assesseeName,
      pan: compact(setup.pan),
      address: compact(setup.address),
      status: compact(setup.status),
      assessmentYear: compact(setup.assessment_year),
      previousYear,
      formType: setup.form_type ? `Form ${setup.form_type} + 3CD` : 'Form 3CD',
    },
    rows: FORM_3CD_CLAUSES.map((definition) => {
      const clause = clausesByKey.get(definition.key);
      return {
        clauseKey: definition.key,
        clauseNo: definition.clauseNo,
        title: definition.title,
        particulars: buildClauseParticulars(clause),
        status: formatStatus(clause?.prefill_status),
        reviewStatus: formatStatus(clause?.review_status),
        auditorRemarks: stripHtml(clause?.auditor_remarks_html),
        qualificationOrObservation: stripHtml(clause?.qualification_text_html),
        workpaperReference: compact(clause?.workpaper_ref, ''),
      };
    }),
  };
};

export const formatTaxAuditForm3CDClauseDetails = (row: TaxAuditForm3CDExportRow) =>
  [
    row.particulars,
    row.qualificationOrObservation
      ? `Qualification / Observation requiring reporting:\n${row.qualificationOrObservation}`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n');

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const formatHtmlMultiline = (value: string) => escapeHtml(value).replace(/\n/g, '<br />');

export const renderTaxAuditForm3CDHtml = (form: TaxAuditForm3CDExport) => `
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(form.heading)}</title>
  <style>
    body { font-family: "Times New Roman", Times, serif; color: #111; margin: 36px; }
    h1, h2, p { margin: 0 0 8px; }
    h1 { text-align: center; font-size: 18px; }
    h2 { font-size: 14px; margin-top: 18px; }
    table { width: 100%; border-collapse: collapse; margin-top: 10px; }
    th, td { border: 1px solid #333; padding: 6px; vertical-align: top; font-size: 11px; }
    th { background: #f1f1f1; text-align: left; }
    .meta td:first-child { width: 180px; font-weight: bold; }
    .clause-no { width: 64px; text-align: center; }
    .title { width: 240px; }
    .muted { color: #555; }
    .notice { border: 1px solid #666; padding: 8px; margin: 14px 0; font-size: 11px; }
    .qualification { border-top: 1px solid #999; margin-top: 8px; padding-top: 8px; }
    .footer { margin-top: 18px; font-size: 10px; color: #444; }
    @media print { body { margin: 18mm; } }
  </style>
</head>
<body>
  <h1>${escapeHtml(form.heading)}</h1>
  <p style="text-align:center">${escapeHtml(form.statutoryReference)}</p>
  <p class="notice"><strong>Draft review note:</strong> ${escapeHtml(form.draftNotice)}</p>
  <h2>${escapeHtml(form.assesseeDetailsHeading)}</h2>
  <table class="meta">
    <tbody>
      <tr><td>Name of assessee</td><td>${escapeHtml(form.assessee.name)}</td></tr>
      <tr><td>PAN / Aadhaar</td><td>${escapeHtml(form.assessee.pan)}</td></tr>
      <tr><td>Address</td><td>${escapeHtml(form.assessee.address)}</td></tr>
      <tr><td>Status</td><td>${escapeHtml(form.assessee.status)}</td></tr>
      <tr><td>Previous year</td><td>${escapeHtml(form.assessee.previousYear)}</td></tr>
      <tr><td>Assessment year</td><td>${escapeHtml(form.assessee.assessmentYear)}</td></tr>
      <tr><td>Report form</td><td>${escapeHtml(form.assessee.formType)}</td></tr>
    </tbody>
  </table>
  <h2>${escapeHtml(form.particularsHeading)}</h2>
  <table>
    <thead>
      <tr>
        <th class="clause-no">Clause</th>
        <th class="title">Particulars required</th>
        <th>Details furnished</th>
      </tr>
    </thead>
    <tbody>
      ${form.rows
        .map(
          (row) => `
        <tr>
          <td class="clause-no">${escapeHtml(row.clauseNo)}</td>
          <td>${escapeHtml(row.title)}</td>
          <td>
            ${formatHtmlMultiline(row.particulars)}
            ${row.qualificationOrObservation ? `<div class="qualification"><strong>Qualification / Observation requiring reporting:</strong><br />${formatHtmlMultiline(row.qualificationOrObservation)}</div>` : ''}
          </td>
        </tr>`
        )
        .join('')}
    </tbody>
  </table>
  <p class="footer">Generated from AuditPro Tax Audit module on ${escapeHtml(new Date(form.generatedAt).toLocaleString('en-IN'))}. Draft for professional review only.</p>
</body>
</html>`;
