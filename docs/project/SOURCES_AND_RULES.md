# Sources and statutory rule governance

## Product source register

| ID | Source | What it supports | Limitation |
| --- | --- | --- | --- |
| S-001 | Repository main at c0ea50820094952b3bad9c83b45cc00cbff0381c | Static implementation baseline | Code presence is not successful runtime or approval evidence |
| S-002 | Supplied Summary of Phase I Development.docx | Original offline assistance objectives and exclusions | Supplied in project conversation; original is not bundled into this repository change |
| S-003 | Supplied ICAI AI Audit Tool_Blueprint.docx | Broader AI/web concept | Proposal, conflicting with S-002 on scope |
| S-004 | Supplied AI Audit Tool Summary.docx | Strategic and feature proposals | Not a technical implementation contract; claimed performance and vendor comparisons unverified |
| S-005 | Supplied Digital Audit Tool.pdf | General digital audit rationale | Not proof of product reliability or regulatory compliance |
| S-006 | Supplied GN on TAx audit 2025 version.pdf | Candidate professional tax-audit guidance | Not reviewed clause by clause for this task; verify edition, publication and applicability |
| S-007 | Supplied Quick referencer Tax audit AY 23-24- TAQRB.pdf | Candidate historical tax-audit reference | AY-specific historical material; do not apply automatically to another year |
| S-008 | Existing repository guides and historical handoffs | Past intent and reported checks | Reconcile against active code; older beta limitations and updater references conflict with current source |

Future coding sessions cannot assume conversation attachments exist in their checkout. Obtain the authorised original source when needed and record its location and version. Do not copy third-party source documents into a public repository without rights and confidentiality review.

## Source hierarchy for professional content

Use the applicable authoritative Act, Rules, notifications, prescribed form/portal schema, and relevant ICAI standards and guidance for the particular question. Record differences between law, professional guidance, interpretation and product policy. This document does not determine a legal hierarchy for every possible conflict. A prior-year quick reference and AI-generated text cannot independently establish current law.

## Required rule record

For every legal calculation or applicability rule, record rule ID, feature and code location, jurisdiction, financial/assessment period, effective-from and effective-to dates, source title and exact clause/page, official URL or controlled document reference, retrieved/checked date, reviewer, version, calculation and rounding policy, examples and boundary tests, and affected outputs. Record the amendment and transition treatment. Keep previous rule versions available for historical engagements.

## Current tax-audit tagging

src/data/taxAudit3CDClauses.ts uses version key ITA_TAX_AUDIT_AY_2025_26_RULE_6G_NOTIF_23_2025. src/lib/taxAuditStatutoryVersion.ts supports AY 2025-26 and returns warnings for unset or different years. These are observed code labels. This review has not independently verified the notification, complete form text, applicability thresholds or continued suitability. A warning mechanism does not establish legal compliance or portal acceptance.

## Agent instruction references

These official pages were retrieved through Firecrawl on 29 October 2026 to verify repository-instruction conventions. Client behaviour depends on installed version and settings; verify locally using T-001.

- [OpenAI Codex repository instructions](https://developers.openai.com/codex/guides/agents-md): AGENTS.md discovery and size limits.
- [Claude Code project memory](https://code.claude.com/docs/en/memory): CLAUDE.md and project imports; instructions guide behaviour and are not enforcement.
- [GitHub Copilot repository instructions](https://docs.github.com/en/copilot/how-tos/configure-custom-instructions/add-repository-instructions): repository and agent instructions.

The shared runbooks are explicitly loaded through AGENTS.md. They do not claim automatic native SKILL.md discovery in every client. Avoid duplicating business rules into three tool-specific copies.

## Latest documentation evidence

S-009: source snapshot cc5c04729604fba7d05240a07f24682e0644665c and the latest reported T-003 outcome, reviewed on 30 October 2026. S-010: the user’s direction to complete documentation for one review and keep further code fixes outside the current task. The source trace enumerates 35 original Phase I statements/blueprint proposals; the module and field catalogues document the current implementation without legal or owner acceptance claims.
