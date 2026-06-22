import { FORM_3CD_CLAUSES } from '@/data/taxAudit3CDClauses';
import { TAX_AUDIT_3CD_FIELD_SCHEMA_BY_CLAUSE } from '@/data/taxAudit3CDFieldSchemas';
import { TaxAuditClauseDefinition, TaxAuditClauseEvidence, TaxAuditClauseResponse, TaxAuditReviewStatus } from '@/types/taxAudit';

export type TaxAuditReviewDataStatus =
  | 'not_started'
  | 'in_progress'
  | 'needs_attention'
  | 'prepared'
  | 'reviewed'
  | 'approved';

export type TaxAuditReviewSummaryRow = {
  clauseKey: string;
  clauseNo: string;
  clauseTitle: string;
  dataStatus: TaxAuditReviewDataStatus;
  reviewStatus: TaxAuditReviewStatus;
  warningCount: number;
  evidenceCount: number;
  hasAdditionalParticulars: boolean;
  hasInternalRemarks: boolean;
  hasQualification: boolean;
  hasObservation: boolean;
};

export type TaxAuditReviewSummaryCounts = {
  totalActiveClauses: number;
  notStarted: number;
  inProgress: number;
  needsAttention: number;
  prepared: number;
  reviewed: number;
  approved: number;
  clausesWithEvidence: number;
  clausesWithInternalRemarks: number;
  clausesWithQualification: number;
};

const parseJson = <T,>(value: string | null | undefined, fallback: T): T => {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

const isBlank = (value: unknown) => value === null || value === undefined || String(value).trim() === '';

const hasRichTextContent = (value: string | null | undefined) => {
  if (!value) return false;
  return value.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim().length > 0;
};

const hasUsefulValue = (value: unknown): boolean => {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'boolean') return value === true;
  if (Array.isArray(value)) return value.some((item) => hasUsefulValue(item));
  if (typeof value === 'object') return Object.values(value as Record<string, unknown>).some((item) => hasUsefulValue(item));
  return false;
};

const getStructuredValues = (clause: TaxAuditClauseResponse | undefined) => {
  if (!clause) return {};
  const parsed = parseJson<Record<string, unknown>>(clause.response_json, {});
  return parsed.structured && typeof parsed.structured === 'object' && !Array.isArray(parsed.structured)
    ? (parsed.structured as Record<string, unknown>)
    : {};
};

const getFallbackWarningCount = (definition: TaxAuditClauseDefinition, clause?: TaxAuditClauseResponse) => {
  if (!clause) return 0;
  const schema = TAX_AUDIT_3CD_FIELD_SCHEMA_BY_CLAUSE.get(definition.key);
  if (!schema) return 0;

  let count = 0;
  const structured = getStructuredValues(clause);

  (schema.fields || []).forEach((field) => {
    if (field.required && isBlank(structured[field.key])) count += 1;
  });

  const tables = schema.tables || (schema.table ? [schema.table] : []);
  tables.forEach((table) => {
    const rows = Array.isArray(structured[table.key]) ? (structured[table.key] as Record<string, unknown>[]) : [];
    const hasUsefulRow = rows.some((row) => Object.values(row).some((value) => hasUsefulValue(value)));

    if (table.required && !hasUsefulRow) {
      count += 1;
    }
    rows.forEach((row) => {
      table.columns.forEach((column) => {
        if (column.required && isBlank(row[column.key])) {
          count += 1;
        }
      });
    });
  });

  return count;
};

const getComputedDataStatus = ({
  reviewStatus,
  warningCount,
  hasStructuredData,
  hasAdditionalParticulars,
  hasInternalRemarks,
  evidenceCount,
}: {
  reviewStatus: TaxAuditReviewStatus;
  warningCount: number;
  hasStructuredData: boolean;
  hasAdditionalParticulars: boolean;
  hasInternalRemarks: boolean;
  evidenceCount: number;
}): TaxAuditReviewDataStatus => {
  if (reviewStatus === 'approved' || reviewStatus === 'locked') return 'approved';
  if (reviewStatus === 'reviewed') return 'reviewed';
  if (reviewStatus === 'prepared') return 'prepared';
  if (warningCount > 0) return 'needs_attention';
  if (!hasStructuredData && !hasAdditionalParticulars && !hasInternalRemarks && evidenceCount === 0) return 'not_started';
  return 'in_progress';
};

export const buildTaxAuditReviewSummaryRows = (
  clausesByKey: Map<string, TaxAuditClauseResponse>,
  evidenceLinks: TaxAuditClauseEvidence[] = []
) => {
  const evidenceCountByClauseId = evidenceLinks.reduce<Map<string, number>>((result, link) => {
    result.set(link.clause_response_id, (result.get(link.clause_response_id) || 0) + 1);
    return result;
  }, new Map());

  return FORM_3CD_CLAUSES.map<TaxAuditReviewSummaryRow>((definition) => {
    const clause = clausesByKey.get(definition.key);
    const structured = getStructuredValues(clause);
    const validationMessages = clause ? parseJson<string[]>(clause.validation_messages_json, []) : [];
    const fallbackWarningCount = getFallbackWarningCount(definition, clause);
    const warningCount = validationMessages.length > 0 ? validationMessages.length : fallbackWarningCount;
    const evidenceCount = clause ? evidenceCountByClauseId.get(clause.id) || 0 : 0;
    const hasAdditionalParticulars = hasRichTextContent(clause?.response_html);
    const hasInternalRemarks = hasRichTextContent(clause?.auditor_remarks_html);
    const hasQualification = Boolean(clause && (clause.qualification_required === true || clause.qualification_required === 1 || clause.qualification_required === '1'));
    const hasObservation = hasQualification || hasRichTextContent(clause?.qualification_text_html);
    const hasStructuredData = Object.values(structured).some((value) => hasUsefulValue(value));
    const reviewStatus = clause?.review_status || 'draft';

    return {
      clauseKey: definition.key,
      clauseNo: definition.clauseNo,
      clauseTitle: definition.title,
      dataStatus: getComputedDataStatus({
        reviewStatus,
        warningCount,
        hasStructuredData,
        hasAdditionalParticulars,
        hasInternalRemarks,
        evidenceCount,
      }),
      reviewStatus,
      warningCount,
      evidenceCount,
      hasAdditionalParticulars,
      hasInternalRemarks,
      hasQualification,
      hasObservation,
    };
  });
};

export const buildTaxAuditReviewSummaryCounts = (rows: TaxAuditReviewSummaryRow[]): TaxAuditReviewSummaryCounts => ({
  totalActiveClauses: rows.length,
  notStarted: rows.filter((row) => row.dataStatus === 'not_started').length,
  inProgress: rows.filter((row) => row.dataStatus === 'in_progress').length,
  needsAttention: rows.filter((row) => row.dataStatus === 'needs_attention').length,
  prepared: rows.filter((row) => row.reviewStatus === 'prepared').length,
  reviewed: rows.filter((row) => row.reviewStatus === 'reviewed').length,
  approved: rows.filter((row) => row.reviewStatus === 'approved' || row.reviewStatus === 'locked').length,
  clausesWithEvidence: rows.filter((row) => row.evidenceCount > 0).length,
  clausesWithInternalRemarks: rows.filter((row) => row.hasInternalRemarks).length,
  clausesWithQualification: rows.filter((row) => row.hasObservation).length,
});
