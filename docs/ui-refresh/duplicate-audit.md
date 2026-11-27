# Financial Statement Review duplicate audit

Status: preliminary; screen-by-screen review and verification remain open.
The approved repeated entity text was removed from A/c Policy and Review
Financials; the other findings below remain constraints, not completed work.

| Area | Finding | Constraint |
| --- | --- | --- |
| Engagement / year | The VERA engagement selector and FSR financial-year selector have different handlers. | Keep both; do not silently couple or remove either. |
| Header | Compact build label and version badge both show a version. | Keep build details and the update-check handler accessible. |
| Master | Auditee Read and Edit appear in both menu and Current Context. | Preserve both entry points and handlers. |
| Previous year | Mode, prior TB and Manual PY are separate existing shared controls. | Preserve separate persistence, selection and disabled rules. |
| Notes | Manual PY toggle, download and upload are distinct actions. | Group visually without removing any action. |
| Mapping | The pinned TOTAL row uses the same action cell renderer as ledger rows. | Do not convert its handler to a bulk action without determining and preserving its behavior. |
| Actual TB | The current Is Revenue and Deemed +ve columns show row values, not interactive checkbox controls. | A checkbox-like appearance must not create a new editable action or change values. |
| Accounting Policy | The position chip displays state; Note 1 / Note (Last) persist a choice. | Keep both; the approved label is Place as. |
| Notes | Each note title button and the separate expand / collapse button both toggle that note. | Keep both entry points and their handler until a removal is specifically approved. |
| Review Financials | Summary displayed the entity already shown in the active context. | Approved repeated display removed; auditor and signatory selections and their information retained. |
| A/c Policy | Entity name repeated under the toolbar. | Approved repeated display removed; auditor and signatory text retained. |
| Notes / Annex | Reference images suggest note-number differences. | Do not change numbering or data; investigate and report. |
| Auditor / Signatory management | The form is conditional on `editing`, while the list is independently rendered. Previously an empty-state message appeared alongside an open form. | Empty message now suppressed during editing; list actions, loading and error states remain. Source: `AuditorManageModal.jsx`, `SignatoryManageModal.jsx`. |
| Current Context / FSR top bar | Both display the auditee name and constitution. The top-bar auditee display is also a button opening Master; Current Context has separate Read / Edit actions. | Avoid merely deleting the button when reducing repeated information; keep its navigation and the distinct Read / Edit entry points. Source: `Layout/TopBar.jsx`, `Master/index.jsx`. |
| Header version | Compact build label is hard-coded build information while `VersionBadge` reads `currentVersion` and beta status. They can differ. | A single visual presentation must not misrepresent runtime version or silently discard build details or beta status. Source: `Header.tsx`, `BuildInfoLabel.tsx`. |
| Upload TB | Header Download Template and the simple-format dialog's Download the blank format both lead to the simple template. | Group visually only if both existing entry points remain available; the other upload formats have separate handlers. |
| Notes / statements | Previous-year mode is present on several screens, while the TB selector and Manual PY actions have screen-specific availability and callbacks. | A shared presentation must pass each existing callback and disabled state rather than treating similar labels as interchangeable. |

Other screens and dialogs remain to be inventoried.
