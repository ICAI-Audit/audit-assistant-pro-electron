import { useEffect, useState } from 'react';
import { getSQLiteClient } from '@/integrations/sqlite/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

const db = getSQLiteClient();

const BOOLEAN_FIELDS = [
  'is_standalone',
  'is_private_company',
  'cash_flow_required',
  'has_branch_auditors',
  'has_predecessor_auditor',
  'is_public_unlisted_company',
  'private_turnover_above_50cr',
  'private_borrowing_above_25cr',
  'is_small_company',
  'is_opc',
  'is_public_company',
  'is_private_exceeding_threshold',
  'is_private_non_exceeding_threshold',
  'ifc_applicable',
  'is_listed_company',
  'has_subsidiaries',
  'setup_completed',
  'locked',
] as const;

const normalizeSetup = (value: any): AuditReportSetup | null => {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row) return null;

  const normalized = { ...row };
  for (const field of BOOLEAN_FIELDS) {
    if (field in normalized && normalized[field] !== null && normalized[field] !== undefined) {
      normalized[field] = Boolean(normalized[field]);
    }
  }

  return normalized as AuditReportSetup;
};

export interface AuditReportSetup {
  id: string;
  engagement_id: string;

  company_cin: string | null;
  registered_office: string | null;
  nature_of_business: string | null;

  is_standalone: boolean | null;
  accounting_framework: string | null;
  company_type: string | null;

  caro_applicable_status: string | null;
  caro_exclusion_reason: string | null;

  is_private_company: boolean | null;
  paid_up_capital: number | null;
  reserves_surplus: number | null;
  borrowings_amount: number | null;

  // Report configuration extensions
  cash_flow_required: boolean | null;
  has_branch_auditors: boolean | null;
  branch_locations: string | null;
  has_predecessor_auditor: boolean | null;
  
  // IFC Applicability Criteria
  is_public_unlisted_company: boolean | null;
  private_turnover_above_50cr: boolean | null;
  private_borrowing_above_25cr: boolean | null;
  
  // IFC Exemptions
  is_small_company: boolean | null;
  is_opc: boolean | null;
  
  // Company Type Classification
  is_public_company: boolean | null;
  is_private_exceeding_threshold: boolean | null;
  is_private_non_exceeding_threshold: boolean | null;
  
  predecessor_auditor_name: string | null;
  predecessor_report_date: string | null;
  ifc_applicable: boolean | null;
  is_listed_company: boolean | null;
  has_subsidiaries: boolean | null;
  caro_annexure_letter: string | null;
  ifc_annexure_letter: string | null;

  // Signing
  signing_partner_id: string | null;
  report_date: string | null;
  report_city: string | null;
  udin: string | null;

  setup_completed: boolean | null;
  report_status: string | null;

  locked: boolean | null;
  locked_at: string | null;
  locked_by: string | null;
  unlock_reason: string | null;
  unlocked_at: string | null;
  unlocked_by: string | null;

  created_by: string;
  created_at: string;
  updated_at: string;
}

export function useAuditReportSetup(engagementId: string | undefined) {
  const [setup, setSetup] = useState<AuditReportSetup | null>(null);
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();

  const fetchSetup = async () => {
    if (!engagementId) {
      setSetup(null);
      setLoading(false);
      return;
    }

    setLoading(true);

    try {
      const { data, error } = await db
        .from('audit_report_setup')
        .select('*')
        .eq('engagement_id', engagementId)
        .maybeSingle();

      if (error) throw error;
      setSetup(normalizeSetup(data));
    } catch (error) {
      console.error('Error fetching audit report setup:', error);
    } finally {
      setLoading(false);
    }
  };

  const createSetup = async (data: Partial<AuditReportSetup>) => {
    if (!engagementId || !user) return null;

    try {
      const { data: newSetup, error } = await db
        .from('audit_report_setup')
        .insert({
          engagement_id: engagementId,
          created_by: user.id,
          ...data,
        });

      if (error) throw error;
      const normalized = normalizeSetup(newSetup);
      setSetup(normalized);
      toast.success('Audit report setup created');
      return normalized;
    } catch (error: any) {
      console.error('Error creating audit report setup:', error);
      toast.error(error.message || 'Failed to create setup');
      return null;
    }
  };

  const updateSetup = async (data: Partial<AuditReportSetup>) => {
    if (!setup) return null;

    try {
      const { data: updatedSetup, error } = await db
        .from('audit_report_setup')
        .update(data)
        .eq('id', setup.id);

      if (error) throw error;
      const normalized = normalizeSetup(updatedSetup) || { ...setup, ...data } as AuditReportSetup;
      setSetup(normalized);
      toast.success('Setup updated');
      return normalized;
    } catch (error: any) {
      console.error('Error updating audit report setup:', error);
      toast.error(error.message || 'Failed to update setup');
      return null;
    }
  };

  const saveSetup = async (data: Partial<AuditReportSetup>) => {
    if (setup) {
      return updateSetup(data);
    } else {
      return createSetup(data);
    }
  };

  useEffect(() => {
    fetchSetup();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engagementId]);

  return {
    setup,
    loading,
    createSetup,
    updateSetup,
    saveSetup,
    refetch: fetchSetup,
  };
}
