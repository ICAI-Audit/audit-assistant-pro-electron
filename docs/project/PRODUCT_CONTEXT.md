# Product context

Documentation review baseline: 30 October 2026 at `cc5c04729604fba7d05240a07f24682e0644665c`. Detailed scope and implementation are in the [module coverage](MODULE_COVERAGE_MATRIX.md); owner questions are consolidated in [review decisions](OWNER_REVIEW_DECISIONS.md).

## Purpose and users

ICAI VERA assists chartered accountants and audit teams with client and engagement records, appointment documents, financial review, applicability, materiality, risk, working papers, evidence, statutory and tax-audit drafting. Professional judgement, sufficient evidence, and report approval remain with the auditor. This describes the repository's product direction, not certification by ICAI or a regulator.

The reviewed package is a desktop application, version 0.9.1. Local SQLite and local files support its core storage. External GSTZen services and update checks need connectivity. A fully functioning browser-only application, firm LAN server, cloud collaboration, immutable ledger, and CA GPT integration have not been established by this review.

## Scope evidence and conflicts

| Source | Stated direction | Treatment |
| --- | --- | --- |
| Supplied Summary of Phase I Development | Offline assistance for less complex entities; engagement documentation, applicability, materiality, financial comparison, workpapers, checklists and MRL formats; excludes financial-statement preparation and advanced workflow | Historical scope input, not evidence of implemented or accepted functionality |
| Supplied ICAI AI Audit Tool Blueprint | Web application; AI risk analysis, knowledge retrieval, broader audit types and reporting | Future concept; conflicts with Phase I on deployment and breadth |
| Supplied AI Audit Tool Summary | Broad AI, analytics, knowledge and regulatory vision | Proposal; performance and adoption claims are not validated product metrics |
| Current repository | Electron, SQLite, financial statement layout and export code, tax-audit draft exports, and some sample screens | Current implementation evidence, not automatic approval of expanded scope |

Preserve existing behaviour while resolving scope. Do not remove reporting code because Phase I excluded preparation, and do not implement the broader AI blueprint without a recorded product decision. Decisions D-001 to D-004 remain open.

## Product requirements needing traceability

Each feature needs an ID, user and purpose, inputs, validations, calculation rules, storage location, permissions, state transitions, outputs, exceptional cases, tests, and acceptance evidence. Use the task template to elaborate an individual feature before changing it. The feature register identifies where evidence exists and where completion is unproven.

Core workflow to verify: sign in, select or create client and engagement, assess applicability, appoint and plan, import and reconcile TB, set materiality and risks, perform procedures, attach and review evidence, resolve findings, draft reports, approve and preserve the audit file. The routed completion screen is a prototype, so this whole workflow cannot currently be described as verified end to end.

## Product rules for subsequent implementation

- Engagement and year identify the working context. Switching engagement or user must not expose stale data, evidence, or exports.
- Preserve imported figures and provenance. Classification and presentation must remain distinguishable from source values.
- Distinguish saved, reviewed, approved, and locked states. A UI label alone must not confer a permission or lock.
- Empty, zero, not applicable, pending, and unsupported are different business states.
- Legal rules need jurisdiction, period, effective date, source, reviewer, and version. Historical engagements must retain the rule basis used for their outputs.
- Report drafts, reviewed outputs, signed reports, and portal filing are separate stages. Do not infer one from another.
- AI remains proposed until its provider, data use, grounded sources, evaluation, human review, and audit logging are specified and approved.

## Completion evidence

No feature is labelled accepted solely from static inspection. Code-backed functionality must be exercised with an isolated synthetic engagement, persisted and reopened, tested for forbidden actions, and accepted by an identified reviewer before its status advances to UAT accepted. Current evidence is in the status record and VERIFICATION_EVIDENCE.md. The 19 detailed modules now supply source-grounded business fields, workflows, outputs and proposed acceptance cases. UI/schema parity, professional accuracy and owner acceptance remain distinct verification gaps.
