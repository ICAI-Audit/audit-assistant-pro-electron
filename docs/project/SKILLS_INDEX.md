# Project skills and workflows

The repository previously had no shared project workflow index or agent entry instructions. This change supplies eight reusable workflows. They are detailed procedures in portable Markdown, loaded explicitly through AGENTS.md. They are not native installed personal skills, third-party plugins or extra executable application modules. This avoids assuming that all installed coding clients discover the same skill directory.

| Workflow | Trigger | Procedure |
| --- | --- | --- |
| session-continuity | Use at every new coding session, context reset, agent switch, and task close. | [Resume and close a coding session](workflows/session-continuity.md) |
| feature-change | Use for a new capability, behavioural change, or defect fix. | [Specify and implement a bounded feature change](workflows/feature-change.md) |
| financial-rules | Use for TB import, classification, materiality, statement totals, notes or financial export calculations. | [Change financial data and calculations](workflows/financial-rules.md) |
| statutory-content | Use for applicability, tax-audit fields, forms, CARO, standards, thresholds or report wording. | [Maintain statutory rules and audit wording](workflows/statutory-content.md) |
| database-change | Use for schema, persistent field, data mapping, storage path or migration changes. | [Upgrade data safely](workflows/database-change.md) |
| security-review | Use for authentication, role/assignment access, IPC, evidence, report approval, locking or audit-trail changes. | [Verify authorization and evidence controls](workflows/security-review.md) |
| report-export | Use for reports, letters, statement packs, Form 3CA/3CB/3CD, or preview/export changes. | [Verify report drafts and exported documents](workflows/report-export.md) |
| desktop-validation | Use for Electron launch, preload, native dependencies, installation, updater or distribution work. | [Validate native desktop and packaging changes](workflows/desktop-validation.md) |

## Usage and verification

Select only workflows relevant to the request. Session continuity is always relevant. A financial report change may additionally require financial rules, statutory content and report export. Read the referenced code and source records before applying a procedure. The workflow guides execution; it cannot supply unavailable evidence or substitute for professional approval.

Each procedure specifies when it applies, what to read, the steps and required result. Add scripts only when they provide repeatable, testable value. Do not turn every documentation page into a separate skill. If native skill packaging is later required for a particular IDE, first verify its version and official supported discovery paths, and make any adapter point to these canonical procedures. Verify the actual client loads them rather than relying on a folder name.

Coverage still needs validation: eight runbooks exist and are structurally checked; fresh-session use by each installed coding client is T-001. Native integration tests, legal review, desktop execution and application completeness are separate evidence levels. The documentation checker cannot certify them.

## Module context for a workflow

Use [module index](MODULE_INDEX.md) to load only the affected specification, then the relevant runbook. The current task is owner documentation review; open code gaps are not new authorisation to implement fixes. See [review guide](REVIEW_START_HERE.md).
