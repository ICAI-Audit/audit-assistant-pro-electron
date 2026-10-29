# Screen map

Generated from src/App.tsx by npm run docs:inventory. This maps route declarations and their guards, not verified end-to-end behaviour. See the [feature register](FEATURE_REGISTER.md) for implementation limits.

| Route | Component | Declared guard |
| --- | --- | --- |
| /auth | Auth | public |
| /select-engagement | SelectEngagement | ProtectedRoute |
| / | Dashboard | ProtectedEngagementRoute |
| /engagements | Engagements | ProtectedRoute |
| /trial-balance | FinancialReview | ProtectedEngagementRoute |
| /financial-review | FinancialReview | ProtectedEngagementRoute |
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
| /tax-audit | TaxAudit | ProtectedEngagementRoute |
| /audit-report | AuditReport | ProtectedEngagementRoute |
| /feedback | Feedback | ProtectedEngagementRoute |
| /settings | Settings | ProtectedRoute |
| /feedback | Feedback | ProtectedRoute |
| /gstr1-integration | GstzenIntegration | ProtectedRoute |
| /gstzen-login | GstzenLogin | ProtectedRoute |
| /gstin/:gstinUuid/gstr1 | Gstr1Dashboard | ProtectedRoute |
| /admin | AdminDashboard | ProtectedAdminRoute |
| /admin/settings | AdminSettings | ProtectedAdminRoute |
| /compliance-applicability | ComplianceApplicability | ProtectedEngagementRoute |
| * | NotFound | public |

Both /trial-balance and /financial-review select FinancialReview. /programs-new aliases AuditExecution. /feedback is declared twice with different guards; resolve intent in a scoped route task rather than inferring permissions from its label. A public fallback is not an authentication guarantee for other screens.
