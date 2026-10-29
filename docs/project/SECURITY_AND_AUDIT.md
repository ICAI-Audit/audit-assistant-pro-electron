# Security and audit controls

This is a code-grounded control review and required verification plan. It is not a penetration test, privacy-law opinion or security certification.

## Observed controls and gaps

| Area | Evidence | Assurance limit and required action |
| --- | --- | --- |
| Desktop isolation | BrowserWindow disables nodeIntegration and enables contextIsolation and webSecurity | Preload and IPC still require payload, sender, identity and authorization checks |
| Local authentication | sqlite-auth hashes and compares passwords using bcrypt; startup clears session | Verify first-admin creation, inactive users, password operations and session transitions |
| UI permissions | ProtectedAdminRoute checks partner/manager/admin; engagement route requires selected engagement | UI checks are not backend enforcement |
| Generic database bridge | sqlite-query receives table, action, columns, filters and data | Handler does not visibly invoke the separate access-control module; investigate missing identity, assignment and lock checks |
| SQL construction | Identifier checks and parameterised filter values exist | Raw select column text and every action need a scoped validation review; identifier syntax alone is not permission enforcement |
| Evidence storage | Main-process file handlers and storage path normalisation exist | Verify cross-engagement access, traversal, overwrite and metadata/file consistency, including locked evidence |
| History | activity_logs and audit_trail writes exist | No proven append-only or tamper-evident system; generic local database access must not be described as immutable |
| Encryption and backup | Local SQLite and files are used | Application encryption at rest and complete recovery are not established by this review |
| Update trust | electron-updater configured; package flags disable Windows update signature verification | Reconcile old documentation claims with actual signing and distribution policy |

## Required security contract for new work

Identify the actor, role, engagement assignment, record ownership and allowed operation. Enforce at the active main-process boundary before touching records or files. Deny unknown actions and tables as appropriate to the approved design. Check indirect relationships, not just supplied engagement IDs. Define bulk-operation behaviour and affected-row limits. Return only allowed fields. Log relevant changes without credentials or unnecessary client information.

For evidence and reports, specify draft, prepared, reviewed, approved, locked and reopened states, who can transition them, required reasons, and retained before/after history. A whole-file completion lock needs an explicit backend design; evidence-level flags cannot be assumed to lock every report or TB record.

## External services

GSTZen requires external sessions and updater requests reach release services. Inventory actual endpoints, purpose, fields, retention, credentials and failure behaviour before asserting an offline-only or no-data-leaves-device policy. AI processing requires a separate approved data-use contract. Redact secrets from logs, screenshots and prompts. Do not transmit source client files to research or coding services merely for convenience.

## Verification evidence

Use synthetic users and separate engagements. Assert unauthenticated, staff, manager and administrator cases, direct IPC calls, forged IDs, locked records, expired/deactivated sessions, and local file access. Record command, commit, environment, expected rejection and actual result. Security findings remain open until an appropriate test proves the enforcement in the active runtime. See T-003, T-007, T-009 and the security workflow.
