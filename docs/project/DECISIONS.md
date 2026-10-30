# Decision register

Separate observed implementation from product approval. A decision record needs ID, question, state, owner, date, evidence, chosen option, consequences and affected feature/task IDs. Do not manufacture the product owner's approval from repository code or a previous AI response.

| ID | Question | Current record | State and action |
| --- | --- | --- | --- |
| D-001 | Deployment model | Phase I says offline; blueprint says web; active code is Electron/SQLite | Open product decision. Preserve desktop implementation pending direction |
| D-002 | Financial statement preparation | Original scope excludes preparation; repository has statement layout and export code | Open scope reconciliation. Record whether preparation, comparison or both are in the next release |
| D-003 | Next release audience and audit type | Phase I focuses less complex entities; broader concept spans statutory, GST, internal, NGO and PSU; repository has statutory and tax-audit modules | Open. Select target users, audit types and acceptance boundary |
| D-004 | AI and external data use | Blueprint proposes CA GPT and grounded knowledge; no verified runtime integration identified | Open. Do not select a provider or disclose client data by inference |
| D-005 | Shared session knowledge | User requested consistent application knowledge and next steps across VS Code agents on 29 October 2026 | Authorised documentation objective. One shared repository record with short client adapters |
| D-006 | Supported toolchain and release destination | T-002 selected Node 24 based on locked Electron tooling requirements, updated the release workflow from Node 18, and repaired reproduced stale lock metadata. Two clean Windows installs and native smoke tests passed on Node.js 24.12.0/npm 11.6.2. Publish owner still differs from repository owner | Installation/toolchain correction verified only on Windows x64 at the stated versions. Release destination, target-platform packaging and update feed remain open; see T-010 |
| D-007 | Authorization, finalization and reopening policy | Scoped IPC authorization and canonical evidence controls have reported regression evidence at cc5c0472. Completion remains a prototype; session trust, export and state-transition policy remain open | Do not treat implementation assumptions or selected passing tests as final product-policy approval. T-016, T-007 and RV-03/RV-04/RV-09 |
| D-008 | Backup and retention | Local database, files and localStorage identified; approved recovery facility not established | Open. Owner requirements and isolated restore evidence needed |

## Current documentation scope

D-009 records the user’s instruction on 30 October 2026 to focus on completing documentation for one owner review. Application fixes, schema changes and policy enforcement are outside this documentation pass. The [16 consolidated review groups](OWNER_REVIEW_DECISIONS.md) collect unanswered product questions without inventing answers.

## Maintenance

When an explicit user decision arrives, quote or faithfully summarise its scope, date and source without publishing private chat. Close only the question actually answered. Use a new record when a later decision supersedes an old one, and link the superseded ID. Technical implementation choices may be recorded by the developer when within the authorised task; label them as such rather than business-policy approvals.
