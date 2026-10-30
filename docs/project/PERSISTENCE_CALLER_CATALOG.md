# Persistence caller catalogue

Lexical extraction of literal .from() calls under live src at `cc5c04729604fba7d05240a07f24682e0644665c`. There are 41 distinct literal targets. These include storage buckets as well as database tables, so this count must not be substituted for the earlier T-003 review's 41 database-table caller count. Dynamic targets and raw main-process SQL need separate inspection.

The field catalogue describes declared SQLite tables. The module specifications describe known JSON/localStorage and file stores. This catalogue supplies exact source paths for reconciliation, not proof that every operation succeeds.

| Literal target | Declaration status | Caller paths |
| --- | --- | --- |
| activity_logs | Declared SQLite table | `src/contexts/AuthContext.tsx`; `src/hooks/useActivityLogs.ts`; `src/hooks/useDashboardStats.ts`; `src/hooks/useEngagementDashboardData.ts`; `src/hooks/useEngagements.ts`; `src/hooks/useEvidenceFiles.ts`; `src/hooks/useOverallDashboardData.ts`; `src/hooks/useReviewNotes.ts`; `src/hooks/useRisks.ts`; `src/pages/AdminDashboard.tsx` |
| audit_program_attachments | Declared SQLite table | `src/hooks/useAuditExecution.ts`; `src/pages/AuditExecution.tsx`; `src/pages/EvidenceVault.tsx` |
| audit_program_boxes | Declared SQLite table | `src/hooks/useAuditExecution.ts`; `src/hooks/useEngagementDashboardData.ts`; `src/pages/AuditExecution.tsx` |
| audit_program_sections | Declared SQLite table | `src/hooks/useAuditExecution.ts`; `src/hooks/useEngagementDashboardData.ts`; `src/pages/AuditExecution.tsx` |
| audit_programs_new | Declared SQLite table | `src/hooks/useAuditExecution.ts`; `src/hooks/useEngagementDashboardData.ts`; `src/pages/EvidenceVault.tsx` |
| audit_report_documents | Declared SQLite table | `src/hooks/useAuditReportDocument.ts`; `src/hooks/useEligibilityCertificate.ts`; `src/hooks/useForm3CADocument.ts`; `src/hooks/useForm3CBDocument.ts`; `src/hooks/useIFCReportContent.ts`; `src/hooks/usePreviousAuditorCommunication.ts` |
| audit_report_main_content | Declared SQLite table | `src/hooks/useAuditReportContent.ts` |
| audit_report_setup | Declared SQLite table | `src/hooks/useAuditReportSetup.ts`; `src/hooks/useEngagementDashboardData.ts` |
| audit_trail | Declared SQLite table | `src/hooks/useEvidenceFiles.ts`; `src/hooks/useReviewNotes.ts` |
| caro_clause_library | Declared SQLite table | `src/hooks/useCAROClauseLibrary.ts` |
| caro_clause_responses | Declared SQLite table | `src/hooks/useCAROClauseResponses.ts` |
| caro_standard_answers | Declared SQLite table | `src/hooks/useCAROStandardAnswers.ts` |
| client_gstins | Declared SQLite table | `src/hooks/useTaxAudit.ts`; `src/pages/AuditTools.tsx`; `src/pages/GstzenIntegration.tsx` |
| clients | Declared SQLite table | `src/components/admin/BulkClientImportDialog.tsx`; `src/components/admin/DataIntegrityPanel.tsx`; `src/components/clients/ClientFormDialog.tsx`; `src/components/engagements/CreateClientDialog.tsx`; `src/hooks/useClient.ts`; `src/hooks/useClients.ts`; `src/hooks/useTaxAudit.ts`; `src/pages/AdminSettings.tsx` |
| compliance_applicability | Declared SQLite table | `src/hooks/useEngagementDashboardData.ts`; `src/pages/ComplianceApplicability.tsx`; `src/pages/Materiality.tsx` |
| engagement_assignments | Declared SQLite table | `src/components/admin/DataIntegrityPanel.tsx`; `src/hooks/useEngagementAssignments.ts`; `src/hooks/useTeamMembers.ts` |
| engagement_letter_templates | Declared SQLite table | `src/hooks/useEngagementLetterTemplates.ts` |
| engagement_tb_classification | Known missing SQLite declaration; T-017 | `src/hooks/useEngagementDashboardData.ts`; `src/hooks/useEngagementTrialBalance.ts` |
| engagement_trial_balance_header | Declared SQLite table | `src/hooks/useEngagementDashboardData.ts`; `src/hooks/useEngagementTrialBalance.ts` |
| engagement_trial_balance_lines | Declared SQLite table | `src/hooks/useEngagementDashboardData.ts`; `src/hooks/useEngagementTrialBalance.ts` |
| engagements | Declared SQLite table | `src/components/admin/DataIntegrityPanel.tsx`; `src/components/clients/ClientFormDialog.tsx`; `src/contexts/EngagementContext.tsx`; `src/hooks/useAuditExecution.ts`; `src/hooks/useDashboardStats.ts`; `src/hooks/useEngagements.ts`; `src/hooks/useOverallDashboardData.ts`; `src/pages/AdminDashboard.tsx`; `src/pages/AdminSettings.tsx` |
| evidence | Storage bucket or runtime/legacy declaration; inspect the caller before classifying | `src/hooks/useEvidenceFiles.ts`; `src/pages/AuditExecution.tsx` |
| evidence_files | Declared SQLite table | `src/components/admin/DataIntegrityPanel.tsx`; `src/hooks/useDashboardStats.ts`; `src/hooks/useEngagementDashboardData.ts`; `src/hooks/useEvidenceFiles.ts`; `src/hooks/useOverallDashboardData.ts`; `src/pages/AdminDashboard.tsx` |
| financial_years | Declared SQLite table | `src/hooks/useAuditExecution.ts`; `src/hooks/useFinancialYears.ts`; `src/pages/AdminSettings.tsx` |
| firm_settings | Declared SQLite table | `src/hooks/useFirmSettings.ts`; `src/pages/AdminSettings.tsx` |
| ifc_clause_library | Known missing SQLite declaration; T-017 | `src/hooks/useIFCClauseLibrary.ts` |
| ifc_control_responses | Storage bucket or runtime/legacy declaration; inspect the caller before classifying | `src/hooks/useIFCControlResponses.ts` |
| ifc_report_content | Storage bucket or runtime/legacy declaration; inspect the caller before classifying | `src/hooks/useIFCReportContent.ts` |
| key_audit_matters | Declared SQLite table | `src/hooks/useKeyAuditMatters.ts` |
| materiality_risk_assessment | Declared SQLite table | `src/hooks/useEngagementDashboardData.ts`; `src/pages/Materiality.tsx` |
| notifications | Declared SQLite table | `src/hooks/useNotifications.ts` |
| partners | Declared SQLite table | `src/components/admin/PartnersTabContent.tsx`; `src/hooks/usePartners.ts` |
| profiles | Declared SQLite table | `src/components/admin/BulkTeamImportDialog.tsx`; `src/components/admin/PartnersTabContent.tsx`; `src/components/audit/DeferredTaxCalculator.tsx`; `src/contexts/AuthContext.tsx`; `src/hooks/useEngagementAssignments.ts`; `src/hooks/useEvidenceFiles.ts`; `src/hooks/useTeamMembers.ts`; `src/integrations/sqlite/client-ipc.ts`; `src/integrations/sqlite/client.ts`; `src/pages/AdminDashboard.tsx`; `src/pages/AdminSettings.tsx`; `src/pages/Settings.tsx` |
| review_notes | Declared SQLite table | `src/components/admin/DataIntegrityPanel.tsx`; `src/hooks/useEngagementDashboardData.ts`; `src/hooks/useOverallDashboardData.ts`; `src/hooks/useReviewNotes.ts`; `src/pages/AdminDashboard.tsx`; `src/utils/generateEngagementReport.ts` |
| risks | Declared SQLite table | `src/components/admin/DataIntegrityPanel.tsx`; `src/hooks/useDashboardStats.ts`; `src/hooks/useEngagementDashboardData.ts`; `src/hooks/useOverallDashboardData.ts`; `src/hooks/useRisks.ts`; `src/pages/AdminDashboard.tsx`; `src/utils/generateEngagementReport.ts` |
| tax_audit_acceptance_checks | Declared SQLite table | `src/hooks/useTaxAudit.ts` |
| tax_audit_clause_evidence | Declared SQLite table | `src/hooks/useTaxAudit.ts`; `src/pages/EvidenceVault.tsx` |
| tax_audit_clause_responses | Declared SQLite table | `src/hooks/useTaxAudit.ts` |
| tax_audit_engagements | Declared SQLite table | `src/hooks/useTaxAudit.ts`; `src/pages/EvidenceVault.tsx` |
| trial_balance_lines | Declared SQLite table | `src/components/admin/DataIntegrityPanel.tsx`; `src/hooks/useTrialBalance.ts` |
| user_roles | Declared SQLite table | `src/components/admin/PartnersTabContent.tsx`; `src/contexts/AuthContext.tsx`; `src/hooks/useTeamMembers.ts`; `src/pages/AdminDashboard.tsx`; `src/pages/AdminSettings.tsx`; `src/pages/Settings.tsx` |

Known runtime/source differences must remain visible. Do not add a schema simply because an identifier appears in this lexical list. Check intended model, current startup migrations, existing client data and the relevant owner decision first.
