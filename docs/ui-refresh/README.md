# Permanent File UI refresh (T-032, F-031)

Evidence for the UI refresh on `feature/permanent-file-ui-refresh`. Synthetic data only, captured by `scripts/capture-permanent-file-ui.cjs` from the production build on an isolated profile (`npm run build`, then `node scripts/capture-permanent-file-ui.cjs --label before|after --axe <axe.min.js>`).

- `before/` is the page at the baseline snapshot commit `b76febd`; `after/` is the final state. Each folder has PNGs and `report.json` (checks, axe results, tab order).
- The desktop window cannot be narrower than 1024 px. The 768 and 390 captures emulate that viewport and collapse the sidebar, so they test the content width, not a real window size.
- axe-core was run from a scratch folder outside the repository (tags wcag2a, wcag2aa, wcag21a, wcag21aa).

## What the captures show

| Capture | Before | After |
| --- | --- | --- |
| Ownership table header | "EFFECTIVE FROMUNTIL" collide; cells cut to "Asha Synth…", "2020-04-…" | Separate columns, full names, `dd MMM yyyy`, green "Open" badge |
| Documents table | "DOCUMENT NAMECATEGORY" collide; raw lowercase status | Badges, icon actions, reference under the name |
| 390 px | One letter per line in both tables | Header actions wrap below titles; tables scroll sideways inside the card |
| Client Details | Summary line, read-only block and full form shown together | Read-only description list; one edit form on demand |
| Modals | Full-width stacked buttons, native file input | Footer with right-aligned actions, helper text, drag-and-drop zone |

## Automated checks (final run)

- Harness: 20/20 checks passed, 0 renderer errors: each modal opens and closes with Esc at 1440 and 390 px; Esc on a dirty form asks "Discard changes?"; Keep editing leaves the form open; Discard closes it and focus returns to the "Add record" button.
- axe: **no violations in Permanent File content on any screen or modal.** Three violations remain on every screen and all are in the shared shell, not this module: an unnamed `aria-haspopup="dialog"` button and the client-switcher text (2.43:1) in the header, and the build-info label (4.17:1). The baseline reported the same three, so axe totals are unchanged before and after; the old page passed axe's automated rules, so axe does not measure this refresh. Lighthouse was not run (Electron app).
- Tab order follows the visual order: header, notice dismiss, Client Details toggle, Edit client details, Add record, table region, row Edit buttons, Add document, filters. Native date inputs add one stop per date segment.

## Known limits

- axe checks only part of WCAG; no screen-reader pass was done.
- At 768 px and narrower the tables scroll sideways inside their card (the header stays sticky); they are not stacked cards.
- The History and Documents cards are stacked at every width rather than side by side: at 1440 px each half is about 560 px, narrower than the 680 px the ownership table needs.
- Remaining shell findings above are untouched by design.
- Nothing here is owner UAT.
