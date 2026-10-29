# Decision register

Separate observed implementation from product approval. A decision record needs ID, question, state, owner, date, evidence, chosen option, consequences and affected feature/task IDs. Do not manufacture the product owner's approval from repository code or a previous AI response.

| ID | Question | Current record | State and action |
| --- | --- | --- | --- |
| D-001 | Deployment model | Phase I says offline; blueprint says web; active code is Electron/SQLite | Open product decision. Preserve desktop implementation pending direction |
| D-002 | Financial statement preparation | Original scope excludes preparation; repository has statement layout and export code | Open scope reconciliation. Record whether preparation, comparison or both are in the next release |
| D-003 | Next release audience and audit type | Phase I focuses less complex entities; broader concept spans statutory, GST, internal, NGO and PSU; repository has statutory and tax-audit modules | Open. Select target users, audit types and acceptance boundary |
| D-004 | AI and external data use | Blueprint proposes CA GPT and grounded knowledge; no verified runtime integration identified | Open. Do not select a provider or disclose client data by inference |
| D-005 | Shared session knowledge | User requested consistent application knowledge and next steps across VS Code agents on 29 October 2026 | Authorised documentation objective. One shared repository record with short client adapters |
| D-006 | Supported toolchain and release destination | Workflow uses Node 18; clean install failed on available Node 24/npm 11; publish owner differs from repository owner | Technical investigation needed. Do not claim a tested supported matrix or change distribution target without checking |
| D-007 | Authorization, finalization and reopening policy | Role and engagement UI guards and evidence state fields exist; generic IPC enforcement needs verification; Completion is a prototype | Open control specification and implementation work. T-003 and T-007 |
| D-008 | Backup and retention | Local database, files and localStorage identified; approved recovery facility not established | Open. Owner requirements and isolated restore evidence needed |

## Maintenance

When an explicit user decision arrives, quote or faithfully summarise its scope, date and source without publishing private chat. Close only the question actually answered. Use a new record when a later decision supersedes an old one, and link the superseded ID. Technical implementation choices may be recorded by the developer when within the authorised task; label them as such rather than business-policy approvals.
