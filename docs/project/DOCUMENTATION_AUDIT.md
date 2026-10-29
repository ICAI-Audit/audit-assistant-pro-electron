# Documentation audit

Review date 29 October 2026. Scope: current main source, root documentation, selected technical/pilot guides and supplied concept documents. No full application execution or clause-level legal audit was performed.

| ID | Finding and evidence | Resolution in this change | Remaining work |
| --- | --- | --- | --- |
| A-001 | No AGENTS.md, CLAUDE.md, Copilot instruction file or project workflow index in source tree | Added shared instructions and client adapters | T-001 validates actual client loading |
| A-002 | README describes Supabase as backend while active hooks and main.cjs use SQLite | Corrected active database description and linked project baseline | Classify retained Supabase artefacts before any deletion |
| A-003 | START_HERE.md is an updater delivery summary and advertises production readiness | Replaced entry page with application/session guidance; preserved original updater text | Historical updater steps need independent validation |
| A-004 | No shared current-state, prioritised task list or session handoff | Added status, tasks, handoff and templates | Maintain them in each implementation change |
| A-005 | Broad feature descriptions obscure sample-based screens | Added feature register marking Misstatements and Completion as prototypes | T-005 to T-007 address contracts and implementation |
| A-006 | Original offline Phase I and AI/web blueprint disagree | Added scope conflict and decision register | T-004 requires product owner decisions |
| A-007 | Tax-audit pilot notes exclude formats now present in TaxAudit.tsx | Added supersession notices pointing to current register | T-008 verifies current drafts and professional content |
| A-008 | Updater guides refer to main.js and auto-updater.js while package selects .cjs paths | Added warning links and active architecture record | Revalidate old examples before copying |
| A-009 | Older documents claim security or completeness without a current evidence boundary | Added control matrix and evidence vocabulary | T-003, T-007, T-009 and T-010 need runtime evidence |
| A-010 | Setup guidance says Node/npm alone suffices; clean-install diagnostic fails | Recorded exact failure and native-module prerequisites | T-002 fixes and verifies reproducibility |
| A-011 | No check detects missing handoff links or stale route/schema inventory | Added dependency-free documentation validator and CI | Structural checks cannot detect incorrect prose or stale professional judgement |
| A-012 | Multiple TB generations, localStorage, and local files complicate onboarding | Added persistence ownership map and generated source inventory | T-005 needs field-level read/write coverage |

## Definition of documentation readiness

A new developer can find the product boundary, active runtime, feature status, data stores, exact validation limits, and next authorised task without reconstructing prior chats. Every affected requirement links to implementation or an open task. Client adapters point to shared instructions. A task closes with evidence and a current handoff. No application completeness percentage is asserted without a defined and approved denominator.

## Review limits

All source files were inventoried by path; selected runtime, data, route, report, tax-audit, auth and sample-screen paths were inspected. This is not an exhaustive functional, security, statutory or performance assessment. No claim is made that every screen, calculation, clause, integration or native component has been tested. Detailed missing application components are recorded as tasks rather than silently implemented as part of documentation work.
