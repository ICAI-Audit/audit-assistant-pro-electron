import { useEffect, useMemo, useState } from 'react';
import { getSQLiteClient } from '@/integrations/sqlite/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

const db = getSQLiteClient();

export type OpinionType = 'unqualified' | 'qualified' | 'adverse' | 'disclaimer';

export type SA720BoardReportStatus =
  | 'received_no_misstatement'
  | 'received_material_misstatement'
  | 'not_received';

export type StatusValue = 'yes' | 'no' | 'na' | 'qualified';

export type EmphasisOfMatterItem = {
  title: string;
  paragraph: string;
  note_ref?: string;
  is_example?: boolean;
};

export type OtherMatterItem = {
  title: string;
  paragraph: string;
};

export interface AuditReportMainContent {
  id: string;
  engagement_id: string;
  created_by: string;
  created_at: string | null;
  updated_at: string | null;

  version_number: number | null;
  is_finalized: boolean | null;
  finalized_at: string | null;
  finalized_by: string | null;

  // Opinion / Basis
  opinion_type: OpinionType;
  basis_for_opinion: string | null;
  basis_for_opinion_is_example?: boolean | null;
  qualification_details: string | null;

  // Optional paragraphs
  has_emphasis_of_matter: boolean | null;
  emphasis_of_matter_items: EmphasisOfMatterItem[] | null;

  has_other_matter: boolean | null;
  other_matter_items: OtherMatterItem[] | null;

  has_going_concern_uncertainty: boolean | null;
  going_concern_details: string | null;
  going_concern_note_ref: string | null;

  include_kam: boolean | null;

  // SA 720
  board_report_status: SA720BoardReportStatus | null;
  board_report_misstatement_details: string | null;

  // Section 143(3)
  clause_143_3_a_status: StatusValue | null;
  clause_143_3_a_details: string | null;

  clause_143_3_b_audit_trail_status: StatusValue | null;
  clause_143_3_b_audit_trail_details: string | null;
  clause_143_3_b_server_outside_india: boolean | null;

  clause_143_3_c_branch_returns: string | null;
  clause_143_3_e_going_concern_impact: string | null;

  clause_143_3_f_directors_disqualified: boolean | null;
  clause_143_3_f_disqualified_details: string | null;

  clause_143_3_g_qualification_impact: string | null;

  clause_143_3_h_remuneration_status: StatusValue | null;
  clause_143_3_h_details: string | null;

  clause_143_3_i_ifc_qualification: string | null;

  // Rule 11
  rule_11_a_pending_litigations: string | null;
  rule_11_a_note_ref: string | null;

  rule_11_b_long_term_contracts: string | null;
  rule_11_b_note_ref: string | null;

  rule_11_c_iepf_status: StatusValue | null;
  rule_11_c_delay_amount: number | null;
  rule_11_c_delay_details: string | null;

  rule_11_e_dividend_status: StatusValue | null;
  rule_11_e_dividend_note_ref: string | null;
  rule_11_e_dividend_details: string | null;
  rule_11_e_interim_dividend_paid: boolean | null;
  rule_11_e_interim_dividend_declared_not_paid: boolean | null;
  rule_11_e_final_dividend_previous_year: boolean | null;
  rule_11_e_final_dividend_proposed: boolean | null;

  rule_11_f_audit_trail_status: StatusValue | null;
  rule_11_f_audit_trail_details: string | null;

  rule_11_g_funds_advanced_status: StatusValue | null;
  rule_11_g_funds_advanced_details: string | null;

  // Signature block (stored in main content)
  firm_name: string | null;
  firm_registration_no: string | null;
  partner_name: string | null;
  membership_no: string | null;
}

const DEFAULT_INSERT: Partial<AuditReportMainContent> = {
  opinion_type: 'unqualified',
  include_kam: true,
  has_emphasis_of_matter: false,
  emphasis_of_matter_items: [],
  has_other_matter: false,
  other_matter_items: [],
  has_going_concern_uncertainty: false,
  board_report_status: 'received_no_misstatement',
  basis_for_opinion_is_example: false,

  clause_143_3_a_status: 'yes',
  clause_143_3_b_audit_trail_status: 'yes',
  clause_143_3_h_remuneration_status: 'yes',

  rule_11_c_iepf_status: 'na',
  rule_11_e_dividend_status: 'na',
  rule_11_f_audit_trail_status: 'yes',
  rule_11_g_funds_advanced_status: 'yes',
};

const OPINION_TYPES: readonly OpinionType[] = ['unqualified', 'qualified', 'adverse', 'disclaimer'];
const isOpinionType = (v: any): v is OpinionType => OPINION_TYPES.includes(v);

const BOOLEAN_FIELDS = [
  'is_finalized',
  'basis_for_opinion_is_example',
  'has_emphasis_of_matter',
  'has_other_matter',
  'has_going_concern_uncertainty',
  'include_kam',
  'clause_143_3_b_server_outside_india',
  'clause_143_3_f_directors_disqualified',
  'rule_11_e_interim_dividend_paid',
  'rule_11_e_interim_dividend_declared_not_paid',
  'rule_11_e_final_dividend_previous_year',
  'rule_11_e_final_dividend_proposed',
] as const;

const parseJsonArray = <T,>(value: unknown): T[] | null => {
  if (Array.isArray(value)) return value as T[];
  if (typeof value !== 'string') return null;

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const normalizeRow = (row: any): AuditReportMainContent => {
  const normalized: AuditReportMainContent = {
    ...(row as AuditReportMainContent),
    opinion_type: isOpinionType(row?.opinion_type) ? row.opinion_type : 'unqualified',
    emphasis_of_matter_items: parseJsonArray<EmphasisOfMatterItem>(row?.emphasis_of_matter_items),
    other_matter_items: parseJsonArray<OtherMatterItem>(row?.other_matter_items),
  };

  for (const field of BOOLEAN_FIELDS) {
    if (field in normalized && normalized[field] !== null && normalized[field] !== undefined) {
      (normalized as any)[field] = Boolean((normalized as any)[field]);
    }
  }

  return normalized;
};

export function useAuditReportContent(engagementId: string | undefined) {
  const { user } = useAuth();
  const [content, setContent] = useState<AuditReportMainContent | null>(null);
  const [loading, setLoading] = useState(true);

  const canCreate = useMemo(() => Boolean(engagementId && user?.id), [engagementId, user?.id]);

  const sanitizeInsert = (seed?: Partial<AuditReportMainContent>) => {
    if (!seed) return {};
    // Strip server-managed / immutable fields from insert seed (we set engagement_id & created_by explicitly)
    const {
      id,
      engagement_id,
      created_by,
      created_at,
      updated_at,
      finalized_at,
      finalized_by,
      ...rest
    } = seed as any;
    return rest;
  };

  const sanitizeUpdate = (patch: Partial<AuditReportMainContent>) => {
    // Strip immutable fields from update payload
    const { id, engagement_id, created_by, created_at, updated_at, finalized_at, finalized_by, ...rest } =
      patch as any;
    return rest;
  };

  const fetchContent = async () => {
    if (!engagementId) {
      setLoading(false);
      setContent(null);
      return;
    }

    try {
      setLoading(true);
      const { data, error } = await db
        .from('audit_report_main_content')
        .select('*')
        .eq('engagement_id', engagementId)
        .single();

      if (error) throw error;
      setContent(data ? normalizeRow(data) : null);
    } catch (err) {
      console.error('Error fetching audit report main content:', err);
    } finally {
      setLoading(false);
    }
  };

  const createContent = async (seed?: Partial<AuditReportMainContent>) => {
    if (!canCreate || !engagementId || !user) return null;

    try {
      const { data, error } = await db
        .from('audit_report_main_content')
        .insert({
          engagement_id: engagementId,
          created_by: user.id,
          ...(DEFAULT_INSERT as any),
          ...(sanitizeInsert(seed) as any),
        })
        .select('*')
        .single();

      if (error) throw error;
      const normalized = normalizeRow(data);
      setContent(normalized);
      return normalized;
    } catch (err: any) {
      console.error('Error creating audit report main content:', err);
      toast.error(err?.message || 'Failed to initialize report content');
      return null;
    }
  };

  const updateContent = async (patch: Partial<AuditReportMainContent>) => {
    if (!content) return null;

    try {
      const { data, error } = await db
        .from('audit_report_main_content')
        .update(sanitizeUpdate(patch) as any)
        .eq('id', content.id);

      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      const normalized = normalizeRow(row || { ...content, ...patch });
      setContent(normalized);
      return normalized;
    } catch (err: any) {
      console.error('Error updating audit report main content:', err);
      toast.error(err?.message || 'Failed to save report content');
      return null;
    }
  };

  const saveContent = async (patch: Partial<AuditReportMainContent>) => {
    if (content) return updateContent(patch);
    return createContent(patch);
  };

  // Auto-initialize once we can (keeps editor UX smooth)
  useEffect(() => {
    fetchContent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engagementId]);

  useEffect(() => {
    if (!loading && !content && canCreate) {
      void createContent();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, content, canCreate]);

  return {
    content,
    loading,
    createContent,
    saveContent,
    refetch: fetchContent,
  };
}
