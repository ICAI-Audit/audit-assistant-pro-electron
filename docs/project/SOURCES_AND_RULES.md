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

## Tax Audit Form No. 26 (T-067)

Added 23 November 2026. Form No. 26 (F-032) has its own labels in code: version key `ITA_2025_FORM_26_RULE_47_NOTIF_22_2026`, header labels "Form No. 26", "Income-tax Act, 2025" and "Rule 47" (`src/data/taxAuditForm26Version.ts`), and the year rule "tax years beginning on or after 1 April 2026" (`src/lib/taxAuditForm26Year.ts`). The official sources behind them were obtained and read on 21 November 2026. Only public citations are given here; the study's full list is in section 3 of the [Form 26 domain review](TAX_AUDIT_FORM26_DOMAIN_REVIEW.md), under the same IDs.

| ID | Source | What it supports | Limitation |
| --- | --- | --- | --- |
| S-011 | Income-tax Rules, 2026, Gazette of India, Extraordinary, Part II, Section 3(i), G.S.R. 198(E), 20 March 2026 (Notification No. 22/2026); [official copy](https://www.incometax.gov.in/iec/foportal/sites/default/files/2026-03/En-Notified-IT-Rules-2026-20-03-2026.pdf). Form No. 26 is in Appendix III at Gazette pages 1875 to 1904; rules 46 and 47 at Gazette pages 1569 and 1570 | The form itself, its Parts and its two categories of assessee; the label "Rule 47"; commencement on 1 April 2026 (rule 1(2)) | The authority for the form. Its own printing slips stand uncorrected (for example "(27 of 2026)" in clause 33(a)); they are set out in the domain review |
| S-012 | Corrigendum to the Rules, G.S.R. 286(E), 16 April 2026 (Notification No. 64/2026); [official copy](https://www.incometax.gov.in/iec/foportal/sites/default/files/2026-04/Notification%20No.64_2026.pdf) | None of its 76 corrections touches Form No. 26, rule 46 or rule 47 | - |
| S-030, S-031, S-013 to S-018 | The amendments of the Income-tax Rules, 2026: G.S.R. 241(E) of 31 March, 646(E) of 21 July, 656(E) of 24 July, 822(E) of 17 September, 830(E) of 22 September, 871(E) of 8 October, 901(E) of 19 October and 961(E) of 30 October 2026 (Notifications No. 55, 94, 97, 120, 121, 134, 137 and 139 of 2026) | The chain, read in full, was checked to 21 November 2026: none amends Form No. 26, rule 46 or rule 47 | A search listing is not proof that nothing later exists: check the chain again before each release |
| S-020, S-021 | The Income-tax Act, 2025 (Act No. 30 of 2025), Gazette of India, Extraordinary, Part II, Section 1, 21 August 2025; corrigenda of 30 January 2026 | The label "Income-tax Act, 2025"; the tax audit under section 63; commencement on 1 April 2026 and the 1961 Act for tax years beginning before that date (sections 1(3), 3(1) and 536(2)(c)) | - |
| S-036, S-037 | The Finance Act, 2026 (Act No. 4 of 2026), 30 March 2026; corrigenda of 22 April 2026 | Shows that some sections the form cites changed after the form was notified (section 2(40)(f) omitted, 29(1)(e) substituted, 206 recast, the due-date table of 263(1)(c) substituted) | The tool keeps the form's wording; how to show such a clause is asked of the domain team (domain review, Part Three) |
| S-027 | Form No. 26, the Income Tax Department's stand-alone copy (30 pages), incometaxindia.gov.in | The same words and pages as the Gazette form | - |
| S-028 | Form No. 26: Frequently Asked Questions (38 questions), Income Tax Department. FAQ 2: "Form No. 26 is applicable for tax years commencing on or after 1st April, 2026." FAQ 6: "Forms 3CA, 3CB and 3CD continue for tax audits for previous years relevant to assessment years up to 2026-27. However, from tax year 2026-27, tax audit has to be furnished in Form No. 26." | The year rule in code: 2026-27 and later get Form No. 26, earlier years Forms 3CA, 3CB and 3CD | The department's explanation, not notified text. It letters the Parts as the public-consultation draft did, not as the notified form does |
| S-029 | Guidance note on Form No. 26, Income Tax Department | Explanation of the form | The department's explanation, not notified text; the same lettering point as S-028 |

**What the form's content rests on.** The form in the tool is the office's fillable Form 26 as it stands (decision D-014): its wording, Parts, clauses, schedules, tables, preset answers, totals and calculations. A study compared that file with S-011, and the office's Form 26 / Form 3CD mapping with the official texts. Its recommendations on the form are not applied; they await the domain team in the [Form 26 domain review](TAX_AUDIT_FORM26_DOMAIN_REVIEW.md), and the tool is to be revised on the team's answers. The mapping the tool shows is the one corrected from the official texts, with the office's entry where a cell could not be confirmed (D-014). The owner signs off tax content (RV-06); no professional reviewer is named yet. No official schema, utility or validation rules for Form No. 26 were found on the e-filing portal or the department's site as at 21 November 2026, so the tool makes no portal file (GAP-24). None of this is a claim of legal correctness or of portal acceptance.

## Agent instruction references

These official pages were retrieved through Firecrawl on 29 October 2026 to verify repository-instruction conventions. Client behaviour depends on installed version and settings; verify locally using T-001.

- [OpenAI Codex repository instructions](https://developers.openai.com/codex/guides/agents-md): AGENTS.md discovery and size limits.
- [Claude Code project memory](https://code.claude.com/docs/en/memory): CLAUDE.md and project imports; instructions guide behaviour and are not enforcement.
- [GitHub Copilot repository instructions](https://docs.github.com/en/copilot/how-tos/configure-custom-instructions/add-repository-instructions): repository and agent instructions.

The shared runbooks are explicitly loaded through AGENTS.md. They do not claim automatic native SKILL.md discovery in every client. Avoid duplicating business rules into three tool-specific copies.

## Latest documentation evidence

S-009: source snapshot cc5c04729604fba7d05240a07f24682e0644665c and the latest reported T-003 outcome, reviewed on 30 October 2026. S-010: the user’s direction to complete documentation for one review and keep further code fixes outside the current task. The source trace enumerates 35 original Phase I statements/blueprint proposals; the module and field catalogues document the current implementation without legal or owner acceptance claims.
