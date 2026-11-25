import { useEffect, useState } from 'react';
import { getSQLiteClient } from '@/integrations/sqlite/client';
import { getFsgEngagementSummary, buildFinancialReviewSnapshot, type FinancialReviewPeriod } from '@/lib/fsgEngagementSummary';

const db = getSQLiteClient();

type ActivityLog = {
  id: string;
  user_name: string;
  action: string;
  entity: string;
  details: string | null;
  created_at: string;
};



type ReadinessItem = {
  label: string;
  complete: boolean;
  detail?: string;
};

interface EngagementDashboardData {
  readiness: ReadinessItem[];
  financialReview: FinancialReviewPeriod[];
  auditExecution: {
    total: number;
    complete: number;
  };
  reviewNotes: {
    total: number;
    open: number;
    responded: number;
    cleared: number;
    priorities: {
      high: number;
      medium: number;
      low: number;
    };
    ageing: {
      lt7: number;
      lt30: number;
      gt30: number;
    };
  };
  evidence: {
    totalFiles: number;
    totalSize: number;
  };
  recentActivity: ActivityLog[];
}

const EMPTY_DATA: EngagementDashboardData = {
  readiness: [],
  financialReview: [
    {
      periodType: 'CY',
      hasData: false,
      totalLines: 0,
      classifiedLines: 0,
      unclassifiedLines: 0,
      classificationComplete: false,
    },
    {
      periodType: 'PY',
      hasData: false,
      totalLines: 0,
      classifiedLines: 0,
      unclassifiedLines: 0,
      classificationComplete: false,
    },
  ],
  auditExecution: {
    total: 0,
    complete: 0,
  },
  reviewNotes: {
    total: 0,
    open: 0,
    responded: 0,
    cleared: 0,
    priorities: {
      high: 0,
      medium: 0,
      low: 0,
    },
    ageing: {
      lt7: 0,
      lt30: 0,
      gt30: 0,
    },
  },
  evidence: {
    totalFiles: 0,
    totalSize: 0,
  },
  recentActivity: [],
};

const dayInMs = 24 * 60 * 60 * 1000;

const getAgeInDays = (isoDate: string) => {
  const date = new Date(isoDate).getTime();
  if (!Number.isFinite(date)) return 0;
  return Math.floor((Date.now() - date) / dayInMs);
};

export function useEngagementDashboardData(engagementId?: string) {
  const [data, setData] = useState<EngagementDashboardData>(EMPTY_DATA);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    if (!engagementId) {
      setData(EMPTY_DATA);
      setLoading(false);
      return;
    }

    setLoading(true);

    try {
      const [
        complianceRes,
        materialityRes,
        risksRes,
        evidenceRes,
        reviewNotesRes,
        reportSetupRes,
        activityRes,
        programsRes,
        fsgSummary,
      ] = await Promise.all([
        db
          .from('compliance_applicability')
          .select('id', { count: 'exact', head: true })
          .eq('engagement_id', engagementId),
        db
          .from('materiality_risk_assessment')
          .select('id', { count: 'exact', head: true })
          .eq('engagement_id', engagementId),
        db
          .from('risks')
          .select('combined_risk, status')
          .eq('engagement_id', engagementId),
        db
          .from('evidence_files')
          .select('file_size, file_type')
          .eq('engagement_id', engagementId),
        db
          .from('review_notes')
          .select('status, priority, created_at')
          .eq('engagement_id', engagementId),
        db
          .from('audit_report_setup')
          .select('id, report_status, setup_completed')
          .eq('engagement_id', engagementId)
          .limit(1),
        db
          .from('activity_logs')
          .select('id, user_name, action, entity, details, created_at')
          .eq('engagement_id', engagementId)
          .order('created_at', { ascending: false })
          .limit(10),
        db
          .from('audit_programs_new')
          .select('id')
          .eq('engagement_id', engagementId),
        getFsgEngagementSummary(engagementId),
      ]);

      const risks = risksRes.data || [];
      const evidence = evidenceRes.data || [];
      const reviewNotes = reviewNotesRes.data || [];
      const programs = programsRes.data || [];

      const evidenceStats = {
        totalFiles: evidence.length,
        totalSize: evidence.reduce((sum, file) => sum + (file.file_size || 0), 0),
      };

      const reviewNoteStats = {
        total: reviewNotes.length,
        open: reviewNotes.filter((note) => note.status === 'open').length,
        responded: reviewNotes.filter((note) => note.status === 'responded').length,
        cleared: reviewNotes.filter((note) => note.status === 'cleared').length,
        priorities: {
          high: reviewNotes.filter((note) => note.priority === 'high').length,
          medium: reviewNotes.filter((note) => note.priority === 'medium').length,
          low: reviewNotes.filter((note) => note.priority === 'low').length,
        },
        ageing: {
          lt7: 0,
          lt30: 0,
          gt30: 0,
        },
      };

      reviewNotes
        .filter((note) => note.status === 'open')
        .forEach((note) => {
          const ageDays = getAgeInDays(note.created_at);
          if (ageDays <= 7) reviewNoteStats.ageing.lt7 += 1;
          else if (ageDays <= 30) reviewNoteStats.ageing.lt30 += 1;
          else reviewNoteStats.ageing.gt30 += 1;
        });

      let auditExecutionStats = { total: 0, complete: 0 };

      if (programs.length > 0) {
        const programIds = programs.map((program) => program.id);
        const { data: sections } = await db
          .from('audit_program_sections')
          .select('id')
          .in('audit_program_id', programIds);

        const sectionIds = (sections || []).map((section) => section.id);

        if (sectionIds.length > 0) {
          const { data: boxes } = await db
            .from('audit_program_boxes')
            .select('status')
            .in('section_id', sectionIds);

          const total = boxes?.length || 0;
          const complete = (boxes || []).filter((box) => box.status === 'complete').length;
          auditExecutionStats = { total, complete };
        }
      }

      const financialReview = fsgSummary
        ? buildFinancialReviewSnapshot(fsgSummary)
        : EMPTY_DATA.financialReview;

      const appointmentFiles = evidence.filter((file) =>
        ['appointment_letter', 'engagement_acceptance_checklist_signed'].includes(file.file_type)
      );

      const riskRegisterComplete = risks.length > 0;
      const classificationComplete = financialReview
        .filter((period) => period.totalLines > 0)
        .every((period) => period.unclassifiedLines === 0);
      const hasAnyTb = financialReview.some((period) => period.totalLines > 0);
      const reportDraftExists = (reportSetupRes.data || []).length > 0;

      const readiness: ReadinessItem[] = [
        {
          label: 'Appointment & Engagement',
          complete: appointmentFiles.length > 0,
          detail: appointmentFiles.length > 0 ? 'Letter uploaded' : 'No letter uploaded',
        },
        {
          label: 'Compliance Applicability',
          complete: (complianceRes.count || 0) > 0,
          detail: (complianceRes.count || 0) > 0 ? 'Saved' : 'Pending',
        },
        {
          label: 'Materiality set',
          complete: (materialityRes.count || 0) > 0,
          detail: (materialityRes.count || 0) > 0 ? 'Saved' : 'Pending',
        },
        {
          label: 'Risk Register entries exist',
          complete: riskRegisterComplete,
          detail: riskRegisterComplete ? `${risks.length} risks` : 'None added',
        },
        {
          label: 'TB loaded CY/PY',
          complete: financialReview.every((period) => period.totalLines > 0),
          detail: hasAnyTb
            ? `CY ${financialReview[0].totalLines} | PY ${financialReview[1].totalLines}`
            : 'No TB uploaded',
        },
        {
          label: 'Classification completed',
          complete: classificationComplete,
          detail: classificationComplete ? 'All ledgers classified' : 'Pending',
        },
        {
          label: 'Audit Execution started',
          complete: programs.length > 0,
          detail: programs.length > 0 ? `${programs.length} program(s)` : 'Not started',
        },
        {
          label: 'Evidence uploaded',
          complete: evidenceStats.totalFiles > 0,
          detail: evidenceStats.totalFiles > 0 ? `${evidenceStats.totalFiles} file(s)` : 'No files',
        },
        {
          label: 'Review Notes pending',
          complete: reviewNoteStats.open === 0,
          detail:
            reviewNoteStats.open > 0
              ? `${reviewNoteStats.open} open`
              : 'No pending notes',
        },
        {
          label: 'Audit Report draft',
          complete: reportDraftExists,
          detail: reportDraftExists ? 'Draft in progress' : 'Not started',
        },
      ];

      setData({
        readiness,
        financialReview,
        auditExecution: auditExecutionStats,
        reviewNotes: reviewNoteStats,
        evidence: evidenceStats,
        recentActivity: (activityRes.data || []) as ActivityLog[],
      });
    } catch (error) {
      console.error('Error loading engagement dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();

    if (!engagementId) return undefined;

    // Real-time subscriptions not available in SQLite
    // Use polling if real-time updates are needed
    // const interval = setInterval(fetchData, 30000);
    // return () => clearInterval(interval);
  }, [engagementId]);

  return { data, loading, refetch: fetchData };
}
