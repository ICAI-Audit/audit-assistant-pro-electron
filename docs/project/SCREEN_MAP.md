# Screen map

Generated from src/App.tsx by npm run docs:inventory. This maps route declarations and their guards, not verified end-to-end behaviour. See the [feature register](FEATURE_REGISTER.md) for implementation limits.

| Route | Component | Declared guard |
| --- | --- | --- |
| /auth | Auth | public |
| /select-engagement | SelectEngagement | ProtectedRoute |
| /permanent-file | PermanentFile | ProtectedEngagementRoute |
| / | Dashboard | ProtectedEngagementRoute |
| /engagements | Engagements | ProtectedRoute |
| /financial-statement-review | FinancialStatementReview | ProtectedEngagementRoute |
| /financial-review | Redirect to /financial-statement-review | public |
| /trial-balance | Redirect to /financial-statement-review | public |
| /appointment | Appointment | ProtectedEngagementRoute |
| /appointment/engagement-letter | EngagementLetterGenerator | ProtectedEngagementRoute |
| /materiality | Materiality | ProtectedEngagementRoute |
| /risks | RiskRegister | ProtectedEngagementRoute |
| /audit-execution | AuditExecution | ProtectedEngagementRoute |
| /programs-new | AuditExecution | ProtectedEngagementRoute |
| /procedures/:procedureId/workpaper | ProcedureWorkpaper | ProtectedEngagementRoute |
| /evidence | EvidenceVault | ProtectedEngagementRoute |
| /review-notes | ReviewNotes | ProtectedEngagementRoute |
| /misstatements | Misstatements | ProtectedEngagementRoute |
| /audit-trail | AuditTrail | ProtectedEngagementRoute |
| /completion | Completion | ProtectedEngagementRoute |
| /audit-tools | AuditTools | ProtectedRoute |
| /caat-tools | CaatTools | ProtectedEngagementRoute |
| /tax-audit | TaxAudit | ProtectedEngagementRoute |
| /audit-report | AuditReport | ProtectedEngagementRoute |
| /feedback | Feedback | ProtectedEngagementRoute |
| /settings | Settings | ProtectedRoute |
| /gstr1-integration | GstzenIntegration | ProtectedRoute |
| /gstzen-login | GstzenLogin | ProtectedRoute |
| /gstin/:gstinUuid/gstr1 | Gstr1Dashboard | ProtectedRoute |
| /admin | AdminDashboard | ProtectedAdminRoute |
| /admin/settings | AdminSettings | ProtectedAdminRoute |
| /compliance-applicability | ComplianceApplicability | ProtectedEngagementRoute |
| * | NotFound | public |

/financial-statement-review (Audit Execution → Financial Statement Review, T-019) replaced the former Financial Review screen; /trial-balance and /financial-review redirect to it. /programs-new aliases AuditExecution. /feedback is declared once, engagement-scoped (T-012, owner decision 2 November 2026). A public fallback is not an authentication guarantee for other screens.
