# Current status

## T-053 CAAT Tools v0.10 (17 November 2026)

On `caat_tools`, the embedded CAAT Tools was replaced by the owner-supplied v0.10 (new sidebar layout, data-type detection, Insights, export dialog, tests run on Apply mapping) and restyled with the VERA colours, type and components. The approved large-ledger loop fix and sampling wording fix were re-applied; SheetJS stays 0.20.3. Eight logic findings from the code review were fixed on the owner's instruction (see [CAAT_TOOLS.md](CAAT_TOOLS.md)). `npm run test:caat-ui` 38/38; owner UAT pending.
## T-052 PDF Tools phase 2 (15 November 2026)

- Request: the owner's decisions of 14 and 15 November 2026 ([DECISIONS.md](DECISIONS.md), D-012): complete PDF Tools phase 2, with the tools he added, before other tasks; commit phase 2 only after Redact passes. On 16 November 2026 the owner first kept that rule and later the same day directed: "close redact first, and then test other together". Feature F-030, task T-052 (`main` used T-032 to T-047 for other work while this ran; the task was T-045 until `main` took that number, and workspace notes call it T-032, T-033, T-034 or T-045). Design, limits and the verification plan: [PDF_TOOLS.md](PDF_TOOLS.md) revision 8.
- Branch `feat/pdf-tools-phase-2`, from `feat/pdf-tools` at `2c756ba`, fast-forwarded with the working tree kept as `main` moved: `fb607b5` (PR #111, PDF Tools phase 1), `6e5da5e` (PR #112), `b835def`, `36130e6` (PR #113), `a15b4c3` (PR #114 Ledger Analysis, PR #115 Financial Statement Review) and `be297bd` (PR #116, Financial Statement Review; the baseline now). Only the project records, `inventory.json` and the start-up label files overlapped; `main`'s text was kept and the phase 2 entries added to it (at `be297bd` no code overlapped; this file, `NEXT_TASKS.md` and `SESSION_HANDOFF.md` were merged with the teammates' text kept word for word). Phase 2 (first committed under the number T-048, renumbered T-052 on 17 November 2026 because pull request #117 uses T-048 to T-051) is committed as `ab62b2a` and pushed to `origin/feat/pdf-tools-phase-2` on 16 November 2026 on the owner's word; no pull request opened, not merged. Owner hand check of 16 November 2026: the owner tried Redact in the application and reported three points, each changed and checked in the application the same day (a group ticked by hand now ticks its possible matches too; one "Add a box" button with a mouse and a keyboard choice in place of two buttons; a keyboard box the user has placed is kept when the user goes back to the mouse), then gave the word to commit and push the branch. Which other items of the hand-check list the owner covered was not reported, so that list stays open for owner UAT. Not owner-accepted; no UAT.
- Built and usable: the page viewer with Find (Ctrl+F) and go to page; Bookmarks; Organise pages; Resize or crop pages (every page to A4 or another size, trim, add margins); Watermark with stamp and logo; Page numbers with more styles and header and footer text; Protect with password (AES-256); Split into a separate file for each range or at bookmarks; Compress "Fit to a size" and compression of scans whose images carry a colour profile; TIFF files (HEIC still refused, with a sentence on how to get a JPG); bookmarks carried by Merge, Split and Delete pages; reordering inside Merge and Images to PDF; one sentence on each result naming the comments, attachments and properties it still carries; the application asks before an engagement change throws away unsaved PDF Tools results; the shortcut guard; the UX audit's Tier 1 and Tier 2 items except a toolbar that stays in view (decided not built).
- Redact: switched on on 16 November 2026 (`BUILT = true` in `src/components/pdf-tools/redact/redactRun.ts`; the toolbar shows it as a usable tool). Five independent tests by testers who did not build it each ended "keep off": test 1 found 8 survivors (B1–B8) and test 2 found 8 others (R1–R8), all fixed, the second by changing the design to a guarantee at the level of each drawing; test 3 (the second re-test, 15 November 2026) found eight blocking findings and a 500-page run that ran out of memory, fixed in fix wave 3; test 4 (the third re-test, 15–16 November 2026) found 14 blocking findings, fixed in fix wave 4 (default deny); test 5 (the fourth re-test, 16 November 2026, three independent testers) found 4 blocking items (a name split by a page turn left readable when headers or footers differ between the pages; a typed Hindi name left readable; the window held 1.0–3.7 s on two ordinary files; the find holding the window 1.0–1.9 s on a 500-page statement) and gaps in how account numbers are read. All were fixed in fix waves 5 and 6. Then, on the owner's instruction of 16 November 2026 ("close redact first, and then test other together"), no further separate round was run: Redact was switched on and checked together with the whole module in one final pass. So no fresh independent test has run since the last fixes. Also not completed: test 5's independent test of unusual PDF structures against the newest protections (text positions proved against the page's pixels; the rule for when a page may be copied unchanged). That tester ran the 342 earlier cases again (324 held, 7 refused safely, 11 left the value, all 11 stated limits), but the planned new cases were not built, so those protections rest on the build lanes' own tests and the ordinary-document tests. Fix waves 5 and 6 added: a page turn read with lines left out, so that a name split by it is found on both pages; a typed value matched where a letter cannot be read, and unreadable text of its script covered whole when the word is placed nowhere; the line "Not found: N typed words."; account numbers compared without leading zeros, with the digit groups after them covered; more labels read; a confirmation that names the pages that will also become pictures; Redact waiting while typed words are searched; and sentences that name a busy computer instead of blaming the file ([PDF_TOOLS.md 5.9](PDF_TOOLS.md#59-redact-phase-2)). The identifier set gained 37 kinds and a "DPDP personal data" profile; company and professional numbers are ticked by no profile.
- Phase 1 defects fixed here, reaching `main` with phase 2 (owner decision): page numbers misplaced on pages that leave a graphics state open; every file opened for drawing kept in memory; a kept popup holding a left-out comment's text after Split or Delete pages; links to named destinations on removed pages kept.
- Shared files changed: the start-up label (`src/config/buildMessage.ts` "PDF Tools phase 2", `src/lib/buildInfoLabel.test.ts`; owner's wording); for the engagement question, now the application's own dialog: `src/contexts/EngagementContext.tsx` shows it, and changing or clearing the engagement now answers whether the change went ahead; `src/components/layout/Header.tsx`, `src/pages/Engagements.tsx` and `src/pages/SelectEngagement.tsx` wait for that answer (a few lines each). The owner said yes to the change on 15 November 2026 and was told of all four files; the in-app dialog, which replaced a native question box after which the window could not take typing until it lost and regained focus, changes them more than the first version he saw. The application test `scripts/test-pdf-tools-ui.cjs` and its entry script. No change to `electron/`, `sqlite/`, `src/App.tsx`, `src/pages/AuditTools.tsx`, `src/index.css`, `package.json` or the lockfile; no new dependency. `Vera Tools Meeting.docx` is untracked and not part of this work.
- Method: build lanes with disjoint files, a reviewer per lane (most with mutation checks), five independent tests of Redact by testers who did not build it, a user-view review in five roles (140 questions: 67 answered well, 37 partly, 24 not answered, 12 wrongly; the fixes are listed in [PDF_TOOLS.md section 9](PDF_TOOLS.md#9-testing)), a three-part review of the whole branch, three integration passes and one final pass of the whole module on a clean copy. Every screen was driven in the real application on scratch production builds with temporary profiles and synthetic files, results read back from the saved bytes. The machine ran at full load, so timings are upper bounds.
- Fixed after the whole-branch review (15–16 November 2026): the activity record holds counts and choices only (typed watermark, stamp, header and footer text is recorded as "custom" with its length, a logo as used with its size, never its file name); password boxes are wiped; the engagement question is the application's own dialog ("Change engagement anyway?" or "Log out anyway?", "1 result in PDF Tools is not saved and will be removed.", buttons Stay and Change engagement or Log out, Stay the default); limits on hostile input when a file is added and in TIFF files; Bookmarks keeps what it cannot prove is an old bookmark and says so; Stop lands during Merge and Split every N and while a file is being read; reading and writing give the window a turn by the clock (`pace.ts`); Watermark, Page numbers, Resize or crop pages and Bookmarks keep the source's Creator and set the modification date, while Compress keeps its designed Creator rule.
- Known limits added (PDF_TOOLS.md 11a): a deliberately built PDF can hold the window for some seconds while it is read; Merge and Organise pages (moving pages) hold it about 0.6 s inside the PDF library's writer on a 320-page file; Protect holds it 1.2–1.4 s once after Run, inside the library's AES-256 password set-up (measured on a two-core machine in the final pass); Images to PDF about 0.3 s per picture; a vault file over the size limit is read before it is refused. Redact, from test 5 and fix waves 5 and 6: a value split by a page turn is not joined when more than four lines stand between its halves; on a 500-page statement four later steps hold the window 0.4–0.8 s each, and two review actions search every page at once; the size promised before the run is about four times too small on bank statements; a slanted watermark is covered whole (about 61% of the test page black); the second line of a name wrapped in a table cell is not found; and the limits the dialog itself states.

| Check | Result |
| --- | --- |
| `npx vitest run src` (upper-case path; final pass on a clean copy, 16 November 2026) | 151 files, 3,195 tests, 3,195 passed, 0 failed, 0 skipped (the run before the commit, after the owner's hand-check changes; 3,194 of 3,194 on the earlier clean copy). Before the final pass, after Redact was switched on: the 23 test files of Redact and the shared tool rules, 735 of 735. The whole-suite figure of earlier that day (150 files, 3,008 of 3,016, 8 time limits on an overloaded machine) was taken before the last Redact fixes and before the switch-on, and is superseded |
| `npx tsc -p tsconfig.app.json --noEmit` | 49 diagnostics, the same 49 lines as a clean copy of `main` at `be297bd`, all outside PDF Tools; 0 under pdf-tools (16 November 2026, after the switch-on) |
| ESLint on the changed files and the application-test script | 317 of the 319 changed code files clean; the run exits 1 on one error that is on `main` unchanged (`src/pages/Engagements.tsx:156`), and `src/contexts/EngagementContext.tsx` has five warnings, three of them new (exports beside a component) (exit 0 on the three files changed for the switch-on) |
| `npm run build` | passed (exit 0) (the scratch production build of the tree with Redact switched on passed) |
| `node --test scripts/test-t003-authorization.cjs` | 28 of 28 (28 of 28 on a scratch build earlier on 16 November 2026, before the last Redact fixes) |
| `npm run test:native` (after unsetting `ELECTRON_RUN_AS_NODE`) | passed (Electron 40.9.1) |
| `npm run test:pdf-tools-ui` (production build, isolated profile, synthetic data) | 145 of 145 on a scratch build after the owner's two changes of 16 November 2026 (143 of 143 on the clean copy before the two checks for them, RD-9 and RD-10, were added). The test has 145 checks, twelve of them new Redact checks (RD-1 to RD-10: find, a typed word not found, confirmation, run, result read back, record, Stop, and no value left in the profile). On a scratch build of this tree with Redact switched on, the second whole run passed 143 of 143; the first stopped at 51 passed when a Protect Stop check ran out of its time limit under load, and that check passed when run alone |
| `npm run test:fsg`, `npm run test:fsg-ui` (run because `main` moved to `be297bd`) | 286 of 286, and 100 of 100 on a quiet machine (under heavy load `test:fsg-ui` stopped at its restart step in three runs; the script is `main`'s, unchanged, and passes on `main` on a quiet machine too) |
| Redact in the application window (final pass, invented documents) | Must-hold documents of test 5: 0 chosen values left in 23 results (13 page-turn, 5 Hindi, 5 account-number), read with two text readers and OCR of the drawing. The 27 ordinary files: 27 of 27 succeeded with 0 chosen values left and no question asked; the same pages became pictures as in the earlier table. Longest hold of the window on three ordinary files: 0.33 s on the watermark statement and the bilingual letter (nine runs); on the salary register 0.29 s in the drawing step under the DPDP profile after a final fix (1.19 s before it), and about 0.6 s when the review list is drawn under Balanced, which is over the 0.3 s aim and listed as a known limit. The 500-page statement: 0 chosen values left; nothing in the find over 0.41 s; longest hold 0.71 s, in the "Checking…" step after a final fix (1.47 s before it), which is over the 0.3 s aim and listed as a known limit; memory peak about 1.4 GB |
| Protect and Stop timings (final pass) | Protect: the longest window task was 1.2–1.4 s of processor time in three runs, one stretch inside the library's AES-256 password set-up, with 0.5 s more when the check opens the result; this is over the 0.3 s aim and is a known limit (moving the set-up to a worker is a next task). Stop: Stop during loading ended Merge in 66–75 ms and Organise pages in 260–336 ms of processor time, with "Stopped. Nothing was added." and no row added in 12 of 12 runs |
| `grep -rn MUTATION src/` before verification and commit | empty on 16 November 2026 after the switch-on; repeated before the commit |
| Packaged build and application test against it | built (exit 0, installer 161.1 MB, not installed); the application test against the packaged application passed 134 of 134, with 4 scenarios (9 checks) skipped by design |
| `npm run docs:inventory`, `npm run docs:check` | passed on 16 November 2026 after these records; run again if the code changes |

- Not verified: a separate independent test of Redact after fix waves 5 and 6, and test 5's new cases on unusual PDF structures (above); results in Adobe Acrobat Reader, Microsoft Edge and Google Chrome (compared in pdf.js; reviewers also used other open-source readers); a screen-reader pass; real client documents; sharpness and memory on this machine's 125% display; the installed package; the owner's hand check ([PDF_TOOLS.md section 9](PDF_TOOLS.md#9-testing)); owner UAT. Known limits: [PDF_TOOLS.md section 11a](PDF_TOOLS.md#11a-known-limits-phase-2).
- Application-wide notes, none changed ([PDF_TOOLS.md section 12](PDF_TOOLS.md#12-outside-this-feature-for-the-owner), GAP-22): Audit Trail times are shown 5½ hours behind IST (the owner decided that nothing changes there); no question when VERA is closed with unsaved results; fonts from Google Fonts; PostHog session recording not disabled; Electron's Ctrl+R and Ctrl+W behind dialogs; and others.
- Record correction: the phase 1 records that say "no pull request" were written before PR #111; it was merged to `main` at `fb607b5` on 14 November 2026 (the T-031 entry below names `6e5da5e`, the later PR #112 merge that contains it).

## T-048 and T-049 Variance Analysis and Ratio submenu (16 November 2026)

- Branch `FSG-AM` at `be297bd`; Financial Statement Review only (F-009). Uncommitted; no commit or push without the user's confirmation.
- T-048: a "Variance Analysis" button on BS, PL and Notes adds three columns after the Previous Year: Amount of Change (Current - Previous), Percentage of Change (Change / |Previous Year| x 100; "N.A." when the Previous Year is nil) and Reason of Change (free text, saved per Trial Balance in `remarks` under scopes `bs_change`, `pl_change`, `notes_change`, so it follows the year lock, the workings carry-over and the workings Excel). On screen only; the PDF and Excel outputs are unchanged. Disabled when Previous Year figures are not required.
- T-049: Features > Ratio is a submenu: Form 26 (Old Name - 3CD) (the former Form 3CD screen, renamed), Company Additional Disclosure Ratio (the eleven Schedule III ratios, same computation as Policy > Financial Ratios, variance over 25% in red) and Analytical Ratios (43 ratios: liquidity, solvency, activity, profitability, cost structure, growth and, for a Company, EPS and book value per share; closing or average basis). Shortcuts Ctrl+Shift+U, R, then F / C / A.
- T-050 (owner, 16 November 2026): the Balance Sheet and Profit & Loss toolbars were tidied into one line (title, Format, Variance Analysis, a "Previous Year" group holding the figures choice, Previous Year TB and Manual PY, then P&L Closed to Capital; one button size and style; wraps to a second tidy line only in a narrow window, nothing hidden). Variance column headings read Amount of Variance, % of Variance, Reason of Variance; every heading of that row sits on the bottom line; the amount and % columns were widened so figures are not cut off. On the Balance Sheet, (i)-(iv) under (a) Property, Plant and Equipment and Intangible assets now sit one step right, inside Particulars. Screen only. `npm run test:fsg-ui` 126/126 (6 new T-050 checks; one earlier run stopped at the first sign-in with "clients: Authentication required" before any FSG screen, and the rerun passed).
- T-051 (owner, 17 November 2026): the Balance Sheet screen's column headings read "As at 31 Mar 26" / "As at 31 Mar 25"; the title ("Balance Sheet as at 31 March 2026"), PL, Notes, PDF and Excel keep the full date (`statementColumnLabels(..., { short: true })`). `npm run test:fsg-ui` 127/127.
- Checks: `npm run test:fsg` 305/305 (23 new T-048/T-049 checks in `scripts/fsg-analyse-change-checks.mjs`), 4 PDF text checks skipped (win32-arm64); `npm run test:fsg-ui` 120/120 (20 new). Not run: owner UAT, a real client Trial Balance, lint/typecheck of FSG `.jsx`. See [handoff](SESSION_HANDOFF.md#t-048-and-t-049-variance-analysis-and-ratio-submenu-16-november-2026).

## T-045 to T-047 menu names, layout and Excel theme (15 November 2026)

- Branch `FSG-AM` at `a15b4c3`; Financial Statement Review only (F-007, F-009). Uncommitted; no commit or push without the user's confirmation.
- T-045 menu renames (TB, Inventory, Annex + Features > Reco, Review Financials); T-046 compact Notes header and Policy toolbar; T-047 VERA Excel theme on every template download (`utils/veraExcel.js`), real Excel dropdowns only for fixed predefined lists (owner decision, 15 November 2026). The shareholder Promoter/Non-Promoter dropdown never reached Excel before (SheetJS cannot write validations); it does now.
- Checks: `npm run test:fsg` 282/282, 4 PDF text checks skipped (win32-arm64); `npm run test:fsg-ui` 100/100 (one non-FSG renderer message: "Failed to load materiality risk assessment"); Excel theme checks 19/19, 34/34 (Dep), 38/38 (CFS, tax, share capital, investments), 44/44 (Fill Details, Manual PY), 25/25 (Policy, Ratio), 29/29 (TB, Mapping Rules, learned rules, workings). Not run: opening the files in desktop Excel, a real upload through the desktop app, owner UAT. See [handoff](SESSION_HANDOFF.md#t-045-to-t-047-menu-names-layout-and-excel-theme-15-november-2026).

## T-042 to T-044 Mapping 1-7, Policy format and workings carry-over (15 November 2026)

- Branch `FSG-AM` from `main` `36130e6`, updated to `e1fb062`; Financial Statement Review only (F-007, F-009). Committed and pushed on `FSG-AM`.
- T-042: "Level 4-7" (and "Level 1-3" captions) are shown as Mapping 4-7 / Mapping 1-3 across Rectification, Mapped TB, Override, Journal Entry, Notes, Mapping Rules and Excel downloads (Mapped TB download: "Mapping 1-3 (Format)" beside the engine's "Mapping 1-3"). `formatLevel` reads Level Format rows with either header; Learned Ledger Rules upload accepts both. Follow-up after owner review: the Rectification bulk row showed a free-text "Mapping 5 (Nature)" box right after Mapping 3 before any mapping was chosen, so Mapping 4 looked missing; it now appears only for a custom note line (no Level Format row), and the remaining "Level 4–7 only" and Mapping Rules descriptions say Mapping. `npm run test:fsg-ui` 95/95 after the change.
- T-043: Policy Excel format download (blank with the AS-1 example, or filled) and upload; see `utils/policyWorkbook.js`. Formatting (bold, italics, alignment) is not carried through Excel.
- T-044: workings of a TB (Fill Details, disclosures, ITR details, remarks, Dep (Books), Dep (Income Tax), Stock, manual PY, extra face lines, P&L-closed/EPS, adjustments, journal entries and added ledgers) are carried over to a re-uploaded TB of the same year and branch, in one transaction; Stock goes through `tb:saveStock` and adjustments through `mappedTB:setAdjustment`. Adjustments are matched by ledger code, else name; unmatched ones are reported. One Excel file holds all workings plus the learned ledger rules and is uploaded back with a preview; a file of another client is refused and another year is warned. Not carried: the hidden Dep (Old) schedule; consolidated (entity-level) branch data, which is not per TB.
- Checks: `npm run test:fsg` 282/282 (5 T-042, 11 T-043, 22 T-044 new checks), 4 PDF text checks skipped (win32-arm64); `npm run test:fsg-ui` 95/95; `npm run docs:inventory`; `npm run docs:check`. Not run: the carry-over dialog through a real re-upload in the desktop app, owner UAT. See [handoff](SESSION_HANDOFF.md#t-042-to-t-044-mapping-1-7-policy-format-and-workings-carry-over-15-november-2026).

## T-041 Diagnose button removed (15 November 2026)

- Branch `FSG-AM`; committed and pushed. The Rectification "Diagnose" button showed raw database counts as JSON and changed nothing; it, its panel, the `mappedTB:diagnostics` handler, its policy and `exceptionsDiagnostics` were removed. `npm run test:fsg` 244/244 (4 PDF text checks skipped, win32-arm64); `npm run test:fsg-ui` 93/93.
- Proposed to the owner, awaiting decisions: renaming Level 4-7 as Mapping 4-7; a downloadable/uploadable Policy format (Excel, optionally Word); carrying a year's workings over to a re-uploaded Trial Balance with a reminder. See [handoff](SESSION_HANDOFF.md#t-041-diagnose-removed-and-proposals-15-november-2026).

## T-040 recategorisation queue matches Notes Fix (15 November 2026)

- Branch `FSG-AM` from `main` `36130e6`, updated to `e1fb062`; Financial Statement Review only (F-007). Committed and pushed on `FSG-AM`.
- Cause: the queue exempted `user_override`/`user_approved` ledgers from the Level 4/5 test, never tested Level 6, treated a value outside the option list as chosen, and did not flag unsplit "Sale" ledgers, while Notes (`buildNoteTemplateRows`, `unsplitSaleLine`) flags all of these. The empty state also ignored the Previous Year Trial Balance, which Notes includes.
- Fix: `electron/fsg/ipc/mapped-tb.js` (`optionUnresolved` for Levels 4-6, `saleUnsplit`, `level6_value` in the combination key), `src/modules/fsg/utils/fixTargets.js` (bifurcation need), `src/modules/fsg/components/Exceptions/index.jsx` (Previous Year check before "No exceptions"). Ledgers saved earlier with a blank option list now reappear until an option is chosen. Level 7 is still not tested by the queue; Notes does not flag it either.
- Checks: `npm run test:fsg` 244/244 (13 new T-040 checks; 4 fail with the previous `mapped-tb.js`), 4 PDF text checks skipped (win32-arm64); `npm run test:fsg-ui` 93/93; `npm run docs:check`. See [handoff](SESSION_HANDOFF.md#t-040-recategorisation-queue-matches-notes-fix-15-november-2026).

## T-037 to T-039 TB import ALIE, menus and annexure recategorisation (15 November 2026)

- Branch `FSG-AM` from `main` `36130e6`, updated to `e1fb062`; Financial Statement Review only (F-007, F-009). Committed and pushed on `FSG-AM`.
- T-037: `tb:upload` (Excel), `tb:uploadTally` and the RealBooks/Zoho/Busy path now store `group_parent_8` and `trial_balance_type` (previously dropped by Excel and Tally). The mapping engine takes ALIE from TrialBalance, else from Tally's IsRevenue + IsDeemedPositive (No/Yes ASSETS, No/No EQUITY AND LIABILITIES, Yes/Yes Expenses, Yes/No Income); nothing is guessed when either is unknown. The live Tally master fetch reads group IsRevenue, inherited like IsDeemedPositive, and keeps the top group of chains longer than nine levels in `group_parent_8`; shorter chains keep their earlier layout. Not changed: the Python ODBC fallback (no flags fetched); existing TBs until re-uploaded or re-mapped. Re-running mapping on an affected TB can change previously unknown ALIEs.
- T-038: General Notes is shown as Policy (Ctrl+Shift+O; VERA's Ctrl+O is not triggered) and the exported sheet is "Policy". PPE removed from Features; the screen fed no statement. Known gap: Policy's ratio and useful-life tables use "Current Year/Previous Year" headings, not reporting dates.
- T-039: Annex & Reco ledgers have a ✎ button opening the Mapped TB Override Mapping dialog; the override is saved through `mappedTB:override` and the annexures reload. Consolidated view excluded.
- Checks: `npm run test:fsg` 231/231 (16 new T-037 checks), 4 PDF text checks skipped (win32-arm64); `npm run test:fsg-ui` 93/93; `npm run docs:check`. No live Tally, no real client data, no owner UAT. See [handoff](SESSION_HANDOFF.md#t-037-to-t-039-tb-import-alie-menus-and-annexure-recategorisation-15-november-2026).

## T-035 and T-036 locked years and Dep menu (15 November 2026)

- Branch `FSG-AM` from `main` `36130e6`, updated to `e1fb062`; Financial Statement Review only (F-009). Committed and pushed on `FSG-AM`.
- T-035: `authorizeCall` now refuses any write whose scope resolves to a locked or final `entity_periods` row (directly, or through a TB, mapped row, manual PY entry, face line or PPE ledger). Only `entityPeriod:lock`, `unlock` and `finalise` are exempt. Previously only TB uploads, mapping changes, PY mode and investments checked the lock. Reads still work. `LockBanner` now appears on every year-data tab and names everything that is frozen. Not covered: entity-level consolidated branch data (`entity_note_*`, `entity_manual_py_entries`, `entities.consolidated_*`), which has no year; one-time start-up data migrations.
- T-036: Dep menu items are Dep (Books) (Companies Act schedule, formerly Dep (Comp)) and Dep (Income Tax) (formerly Dep (IT)). Dep (Old) and its component were removed, and the PPE note no longer reads its saved schedule; the PPE note now comes from mapped ledgers or the schedule marked "Include in PPE Note". Saved `dep_schedules` rows remain. Excel template sheet names are unchanged.
- Checks: `npm run test:fsg` 215/215, 4 PDF text checks skipped (win32-arm64); `npm run test:fsg-ui` 84/84 (one earlier run stopped with a CDP `localStorage` SecurityError after all FSG checks had passed; the rerun passed); `npm run docs:check`. Not run: x64 PDF text checks, owner UAT. See [handoff](SESSION_HANDOFF.md#t-035-and-t-036-locked-years-and-dep-menu-15-november-2026).

## T-034 FSG test baseline on Windows-on-ARM (14 November 2026)

- Branch `FSG-AM` from `main` `36130e6`; FSG test scripts only (F-009 verification). No application code, schema, dependency or `package.json` change.
- `npm run test:fsg` previously aborted on win32-arm64 because the unused `pdf-parse` pins `@napi-rs/canvas` 0.1.80, which has no win32-arm64 binary, so pdfjs throws `DOMMatrix is not defined`. The four PDF text checks now go through `scripts/fsg-pdf-text.mjs`, which records them as **skipped, not passed** in that case only; other errors still fail, and `FSG_REQUIRE_PDF_TEXT=1` makes a skip fail. Result on this machine: 206/206 passed, 4 skipped (210 total). The PDF text checks still need a run on x64. Dependency fix options (remove `pdf-parse` or override `@napi-rs/canvas` ≥ 0.1.85) are left to the owner.
- `npm run test:fsg-ui` check "existing database receives a backup before the firm Place upgrade" was stale: the seed used HEAD's schema, which already has `firm_settings.place`. The seed now drops that column to reproduce a pre-T-023 install. Result: 81/81. See [handoff](SESSION_HANDOFF.md#t-034-fsg-test-baseline-on-windows-on-arm-14-november-2026).

## T-036 Sync latest main and refresh startup label (15 November 2026)

- Requested outcome: fetch the latest Git changes, merge them into local `main`, refresh the startup label and test the update. Selected task T-036; affected features F-001 and F-031, with F-008's VERA Tools path replaced and partial overlap with F-029.
- Started on clean local `main` at `36130e6`; fetched `origin/main` at `a64319d` (7 commits ahead), including Ledger Analysis and the documentation-inventory repair in PR #114. `git merge --ff-only origin/main` fast-forwarded cleanly; local `main` now matches `origin/main`.
- The shared label identifies `origin/main` (15 November 2026) and Ledger Analysis (PR #114). It is static build information, not a live GitHub check.
- Committed as `758e4e5` and pushed to `origin/main` at the user's request; the remote accepted the direct push while reporting that its pull-request-only rule was bypassed. The post-push worktree is clean.
- Passed: `npx.cmd --no-install vitest run src/modules/ledger-analysis src/lib/buildInfoLabel.test.ts` (29/29); scoped ESLint; `npm.cmd run test:t003-authorization` (production build and 28/28); inventory refresh and documentation checks. Exact results are in the [latest handoff](SESSION_HANDOFF.md#t-036-sync-latest-main-and-refresh-startup-label-15-november-2026).
- No live Tally fetch, desktop label-layout check or new owner UAT was performed; previously recorded owner test-company evidence remains separate. Ledger Analysis owner UAT is pending.

## T-035 Project documentation workflow repair (15 November 2026)

- Fixed the Project documentation Actions failure on PR #114: the tracked `docs/project/inventory.json` omitted a comma between the Ledger Analysis and Permanent File test paths, making it invalid JSON. `npm run docs:inventory` regenerated the tracked inventory; review found only the comma correction.
- Passed: `npm run docs:inventory` (33 routes, 11 schema files, 58 test files); `npm run docs:check`; `node --test scripts/check-project-docs.test.mjs` (3/3); `git -c core.whitespace=cr-at-eol diff --check`.
- Updated PR workflow run `43682029592` for commit `803dd6d` is `action_required` and has zero jobs; remote execution has not validated the fix.
- Documentation/CI-only change; no product feature IDs or application behavior changed. The original failure and next GitHub Actions verification step are recorded in the [latest handoff](SESSION_HANDOFF.md#t-035-project-documentation-workflow-repair-15-november-2026).

## T-033 Ledger Analysis merged in PR #114 (15 November 2026)

- Selected task: T-033; new feature F-031 (Ledger Analysis); F-008 VERA Tools path replaced; F-029 overlaps in part.
- The `ledger-analysis` branch was merged to `main` in PR #114. Ledger Analysis is the first and default VERA Tools tab; the Tally Tools tab, its component and the hooks `useTallyODBC` / `useOpeningBalanceMatching` were removed (Opening Balance Matching dropped with the owner's agreement).
- Live check on the owner's TallyPrime test company: day book vs TB agreed for all 767 ledgers checked after two fetch fixes (collection instead of the one-day Day Book report; non-accounting voucher types left out). No database or schema change; results are not persisted.
- New finding T-034: the T-003 authorization test is timing-dependent on unchanged `main` (3 of 4 runs failed); not fixed.
- Owner UAT remains pending. Validation and remaining limits: [latest handoff](SESSION_HANDOFF.md#t-033-ledger-analysis-on-branch-ledger-analysis-14-november-2026).
## T-033 Permanent File sync and startup label (14 November 2026)

- Local `main` fast-forwarded from `b835def` to fetched `origin/main` at `bb9ecf1`, containing the Permanent File branch merged in PR #113. No client data was opened or migrated by this sync.
- Affected features: F-001 (startup label) and F-031 (Permanent File). The label identifies the 14 November snapshot and PR #113; it is static build information, not a live GitHub check.
- Permanent File remains partial and is not owner-accepted. Its unresolved workflows, backup/restore and UAT limits remain open. See [latest handoff](SESSION_HANDOFF.md#t-033-permanent-file-sync-and-startup-label-14-november-2026) for validation.

## T-032 Permanent File UI refresh (14 November 2026)

- Visual and accessibility refresh of the Permanent File screen on branch `feature/permanent-file-ui-refresh` (commits `b76febd` to `6b8a0b3` plus the evidence commit), no change to IPC, data model, permissions or validation rules. Client Details has a read-only view and one edit form; the ownership and document tables use a scoped table component (fixes the header overlap caused by the global `table th/td` rules); both dialogs share a `Modal` with dirty-form guard and focus return; upload uses a drag-and-drop dropzone with the same 25 MiB rule. Evidence, limits and before/after captures: [docs/ui-refresh](../ui-refresh/README.md).
- Verified: capture harness 20/20; axe shows no violations in Permanent File content (three remain in the shared header and build label, unchanged from the baseline); Vitest 24/24 for the module and label tests; the six Permanent File `node --test` suites 33/33; native smoke test; scoped ESLint clean; `tsc` 61 diagnostic lines, none in changed files. Not done: screen-reader pass, owner UAT, real desktop profile, Lighthouse. Cards are stacked at every width and tables scroll sideways below about 700 px of content width.


## T-032 Permanent File integration (14 November 2026)

- UI refactor follow-up is **partial**: ownership entry, year-end comparison, document upload and metadata editing now open dialogs; a sandboxed PDF/image preview path, compact client summary, scoped typography and neutral header badge were added. Changing a PAN with nonmatching linked registrations is blocked in the Permanent File master handler, superseding the immediately previous user decision. Selective, record-preserving unlink remains unavailable, so some clients cannot change their PAN in this screen until reconciliation is implemented. No desktop preview/layout UAT was performed. See [handoff](SESSION_HANDOFF.md#t-032-modal-and-validation-follow-up).
- Client-master follow-up: assigned managers or above can edit the shared master in Permanent File; name changes update linked engagement names transactionally. A valid PAN separates matching registrations from those requiring reconciliation, and no existing GSTIN is deleted. The user approved saving PAN despite mismatches and requested a selectable, record-preserving unlink; the latter is **not implemented** because `client_gstins.client_id` is non-null and shared with GST and tax workflows. Other client/GST write paths do not enforce this PAN policy. See the [latest handoff](SESSION_HANDOFF.md#t-032-client-master-and-gstin-reconciliation-follow-up).
- User-requested layout and integrity follow-up is **partial**: module date inputs and main-process date writes/comparisons now reject future dates, including expiry dates; existing future-dated values are not migrated and cannot be resaved unchanged. The entity ID and raw uploader/history identifiers are hidden in the updated main register, while client identifiers and original document references remain unchanged in storage. Ownership and document lists are tabular and use add/edit entry points; legacy details remain editable to avoid data loss. Human-readable engagement names replace IDs in filters. PAN/constitution/GSTIN enforcement, DIN/DPIN and shareholding fields, fully structured branches, document preview and complete history editing are not implemented. Do not treat this partial work as fulfilling the full request.
- At the user's request, combined the uncommitted Permanent File implementation from the separate `permanent-file` worktree into the original `feature/resume-previous-work` checkout, based on PR #112 merge `6e5da5e`. The user's existing staged PR #112 changes and stashes were preserved. The separate worktree remains as a safety copy; the combined changes have not been committed or pushed.
- Permanent File remains a partial, unaccepted feature. Its sidebar entry, client-scoped documents, supplemental entity fields, effective-dated history, metadata filters and draft exports are present; complete core client editing, audit history, export inspection, UI verification and backup/restore remain open. SQLite-only backups do not include document files. See [handoff](SESSION_HANDOFF.md#t-032-combining-permanent-file-into-the-original-checkout-14-november-2026).
- Locally recorded `origin/main` is at `b835def`, a later startup-label commit; it was not fetched, merged or reset in this integration. The staged PR #112 startup label was retained as requested.

## Electron runtime recovery (14 November 2026)

- The Electron binary was missing after the scripts-disabled install; Electron's bundled installer restored 40.10.6. `npm run postinstall` rebuilt the native modules, and `npm run test:native` passed with synthetic data. Full application startup and UI remain unverified; see [handoff](SESSION_HANDOFF.md#electron-runtime-recovery-14-november-2026).

## Dependency recovery (14 November 2026)

- `@cantoo/pdf-lib@2.11.1` is installed and `npm run build` passed on `feature/resume-previous-work`. The requested npm install left the manifest and lockfile unchanged but changed 453 installed packages, reported 57 audit vulnerabilities, and skipped lifecycle scripts; native runtime remains unverified. See [handoff](SESSION_HANDOFF.md#dependency-recovery-on-pr-112-branch-14-november-2026).

## T-032 sync latest main and refresh startup label (14 November 2026)

- Selected task: T-032; affected feature F-001 (startup build label), plus merged features F-030 (PDF Tools) and F-023 (GSTIN lookup/bulk).
- Fast-forwarded local `main` from `8ee2107` to fetched `origin/main` at `6e5da5e` (8 commits, including PR #111 PDF Tools and PR #112 GSTIN lookup/bulk). No merge conflicts.
- Preserved the pre-existing `package-lock.json` edit and both untracked documentation packs. Restored the lockfile edit after fast-forward; its root dependency map matches `package.json`.
- Startup label now identifies `origin/main` synced 14 November 2026 and names PDF Tools (PR #111) and GSTIN lookup/bulk (PR #112). It remains static build metadata, not live remote status.
- Validation and remaining limits are recorded in the [latest handoff](SESSION_HANDOFF.md#t-032-sync-latest-main-and-refresh-startup-label-14-november-2026).

## T-024 GSTIN integration with current main (14 November 2026)

- Selected task: T-024 GSTIN lookup, feature F-023. Merged current `origin/main` at `fb607b5` into `feat/gstin-lookup-bulk` at `6fab70a`; common ancestor `26d3b9f`.
- Resolved the four documentation/inventory conflicts by preserving both GSTIN and upstream records and combining the source inventory entries. The merged `AuditTools.tsx` retains GSTIN lookup/consent while mounting the new PDF Tools component; `electron/main.cjs` retains GSTIN IPC and includes upstream migration, CAAT schema, and restricted-folder handling changes.
- Task-number ambiguity remains: independent GSTIN and main-branch FSG/CAAT records use T-023/T-024. IDs were not renumbered as part of this merge.
- Passed after integration on Linux with Node.js 22.23.4/npm 10.9.9: GSTIN tests 8/8; GSTIN/build-label Vitest 14/14; build; PDF Tools unit tests 884/884 when excluding the Windows-path-specific test file; docs inventory/check; documentation regressions 3/3; Electron syntax checks. The PDF UI application test could not start because the Electron sandbox helper permissions are unavailable in this environment. Full PDF unit tests had three Windows-path-specific failures; two export option assertions likewise expect Windows separators. Exact commands/results and other limits are in the [latest handoff](SESSION_HANDOFF.md).

## T-024 consented GSTIN lookup and bulk validation (11 November 2026)

- Publication preparation on 13 November: the consent explanation now says `Only GSTINs that pass local structure and checksum checks are sent to API.` The fixed endpoint and actual data boundary remain unchanged. The team test plan is [GSTIN_TEAM_TEST_GUIDE.md](GSTIN_TEAM_TEST_GUIDE.md). At that time, fetched `origin/main` was at `8ee2107`, eight commits ahead of this branch base, with overlapping changes and a separate T-024; those commits had not yet been integrated.
- Investigation on 13 November: single and bulk lookups call the same IPC handler and provider; single reports the pictured error when the parsed response is invalid. The user reports that the same GSTIN was marked "Lookup confirmed" with a taxpayer name in bulk; the underlying response and reason for the difference remain unverified. A synthetic parser check found that a response without either recognized validity flag is currently treated as valid, so a bulk "Lookup confirmed" label alone is not reliable proof of provider confirmation. Do not query client GSTINs without appropriate authorization; provider response contract and this parser gap require follow-up.
- Working branch: `feat/gstin-lookup-bulk`, based on `origin/main` at `26d3b9f` (PR #108 already merged). See the [latest handoff](SESSION_HANDOFF.md) for publication and remaining worktree state.
- GST Number Master now has a consent-gated single lookup, CSV template download, local CSV/XLS/XLSX parsing, invalid-row reporting, sequential lookup of only locally valid unique GSTINs, progress/stop control, provider-confirmed GSTIN CSV download, and local bulk save. GSTZen `createGstin` is no longer a prerequisite for this master; GSTZen GSTR-1/session integration remains separate.
- UI polish: removed the GSTIN lookup callout and the “Detected from GSTIN character 14” placeholder; the derived type field stays blank until available, and single lookup shows explicit fetching/completion status. A provider `valid:false` response says local format/checksum passed but the provider did not confirm the registration; manual name entry/local save remain available.
- Downloads: CSV template and provider-confirmed bulk rows use the CSV save filter/extension; existing DOCX exports keep their default. The single GSTIN shown in the user's screenshot was locally valid but the provider returned `valid:false` and no name.
- Outbound data boundary: only a normalized GSTIN query is sent to the fixed `api.e-waybill.in` endpoint after the exact consent checkbox is accepted. Spreadsheet data stays local; main IPC requires the current authenticated renderer and explicit consent, and revalidates the GSTIN.
- Provider limitation: one synthetic structurally valid but unregistered GSTIN returned `valid:false`, blank name, and no taxpayer-type field. A successful registered response, provider terms and rate limits are unverified. Type is now derived locally from character 14, not from API response data.
- Structure: standard PAN-based registrations require numeric character 13 and a checksum at character 15; chart-specific F/I/N/R/M layouts validate their character-13 and fixed character-15 values. Character 14 uses the chart's allowed code set; S/C/D/F/I/R/M map to their supplied categories, other allowed codes default to Regular Dealer, and unsupported codes are rejected with a character-14 message.
- Passed: `node --test scripts/test-gstin-lookup.cjs` (8/8); `node --test scripts/test-export-file-options.cjs` (3/3); `vitest run src/lib/gstinValidation.test.ts src/lib/gstinSpreadsheet.test.ts` (9/9); `npm run build` (4,084 modules; existing import/chunk warnings); focused page lint with the unrelated baseline `prefer-const` rule suppressed; `npm run docs:inventory` (31 routes, 10 schema files, 11 test files); `npm run docs:check`; CRLF-aware `git diff --check`.
- Failed as pre-existing: `npx tsc -p tsconfig.app.json --noEmit` reports 49 diagnostics in 14 untouched files. This is down from the earlier 76/18 baseline after removing conflicting duplicate Electron API declarations; no T-024 source file has a diagnostic. Full ESLint on `AuditTools.tsx` still reports one unrelated `prefer-const` issue at line 3698; focused lint with that rule suppressed passes.
- Runtime startup: after the latest export-handler changes, fresh `npm run electron:dev` opened the updated `ICAI VERA` window; Vite is serving `http://localhost:8080`. Electron initialized 112 schema tables with zero SQL errors. The user's screenshot shows single lookup reached the provider but received `valid:false`; the UI now explains this is separate from local format/checksum validation.
- Not established: successful provider lookup for a registered test GSTIN, full UI flow, client persistence UAT or owner acceptance. The app uses standard userData rather than an isolated synthetic profile; the assistant did not repeat the screenshot's GSTIN query and did not inspect or save GST records. Do not query real client GSTINs for testing.
## T-031 PDF Tools phase 1 (14 November 2026)

- Request: the lead's instructions of 13 November 2026 after the VERA Tools meeting of 2 November (action point 6). Feature F-030, task T-031. Design, known limits and application problems found on the way: [PDF_TOOLS.md](PDF_TOOLS.md).
- Branch `feat/pdf-tools`, started from `main` at `26d3b9f37a9f3aadd8b3d5bf456538e195a60a67` and moved (fast-forward) to `main` at `8ee2107`. The work was committed on branch `feat/pdf-tools` (base `main` at `8ee2107`) as three commits, `feat(T-031): add PDF Tools organise, numbering and image conversion`, `test(T-031): add PDF Tools application test` and `docs(T-031): record PDF Tools phase 1 design, status and inventory`, and pushed to `origin` (see `git log origin/feat/pdf-tools`); it was later merged to `main` in PR #111 at `6e5da5e`. The owner gave the go-ahead to commit and push on 14 November 2026 after the folder-save defect was fixed and re-verified. The owner's own re-test of the fixed folder save and the rest of the hand-check list (single-file Save As including cancel, drag and drop, another PDF reader, real scans and Office exports, the destinations) have not been reported back and are still to be confirmed. Not owner-accepted; no UAT.
- Built: the PDF Tools tab of VERA Tools replaced by a new screen: file list with thumbnails and a page panel; Merge, Split, Delete pages, Compress at three levels, Page numbers, Images to PDF, PDF to images; opening password-protected files; Save to computer, Add to Evidence Vault, Attach to working paper, Add from Evidence Vault; an activity-log entry for each send. Nine not-yet-built tools stay visible as "Soon" (T-022). Phases 2 and 3 not started.
- New dependencies: `pdfjs-dist` 5.4.296 (rendering) and `@cantoo/pdf-lib` 2.11.1 (unlocking only), added by hand to `package.json` and `package-lock.json` (lock diff +52 lines, no deletions); `pdf-lib` 1.17.1 unchanged. `package.json` also gains the script `test:pdf-tools-ui`. `public/pdf-tools/pdfjs/` holds copied worker files (195 files).
- Changed paths: modified `package.json` (+3), `package-lock.json` (+52), `src/pages/AuditTools.tsx` (+2/-712), `electron/main.cjs` (one block of about 20 lines, owner decision of 14 November 2026); new `src/lib/pdf-tools/`, `src/components/pdf-tools/`, `public/pdf-tools/pdfjs/`, `scripts/sync-pdfjs-assets.mjs`, `scripts/test-pdf-tools-ui.cjs`, `scripts/pdf-tools-electron-entry.cjs`, `docs/project/PDF_TOOLS.md`, and the records updated by this change.
- Environment: Windows; Node 24.15.0 and npm 11.12.1 on the build machine, not the pinned 24.12.0 / 11.6.2. Installs used `npx -y npm@11.6.2`; the checks above ran on a clean copy installed that way, so they were not run on the pinned Node 24.12.0.

| Check | Result |
| --- | --- |
| `npx -y npm@11.6.2 ci --dry-run` | Passed: lockfile in sync. A full clean `npx -y npm@11.6.2 ci` also succeeded in a scratch copy. |
| `npx vitest run src/lib/pdf-tools src/components/pdf-tools` | Passed: 43 files, 892 tests. |
| `npx vitest run src/lib`, first run | **Failed**: 3 files failed, 2 tests and one set-up hook timed out (an unlock test, a 300-page timing test, a compress set-up). Each reported about 1,640 s for work that takes seconds, and another process on the machine stalled for 600 s in the same window. Assessed as a machine-wide pause (sleep or freeze) of about 27 minutes, not a code failure; this is an assessment, not proven. |
| `npx vitest run src/lib`, two runs straight after | Passed both times: 24 files, 527 tests (21 s and 27 s). |
| `npx vitest run src/components/pdf-tools` | Passed: 29 files, 410 tests. |
| `npx tsc -p tsconfig.app.json --noEmit` | 76 diagnostics, the existing baseline; none in the new folders. |
| ESLint on `src/lib/pdf-tools`, `src/components/pdf-tools` and the three new scripts | Clean (exit 0). |
| `node --test scripts/test-t003-authorization.cjs` | Passed: 26/26. |
| `npm run test:native` (after unsetting `ELECTRON_RUN_AS_NODE`) | Passed (Electron 40.9.1). |
| `npm run test:pdf-tools-ui` (production build, isolated profile, synthetic data) | Passed: 32/32 (64 s). |
| Windows package (`npm run electron:build:win`), scratch copy only | Built (exit 0); not installed, not published. |
| `PDF_TOOLS_TEST_APP=<unpacked exe> node scripts/test-pdf-tools-ui.cjs` | Passed: 31 checks, 1 skipped (the download fallback, which needs the test's entry script). |

- Reviews: per-task reviews, a whole-branch review and three re-reviews; the last was approved for commit.
- Finding, 14 November 2026: during the owner's own hand check, saving three files to a folder failed with "A save window is already open". With the real Electron 40.9.1 folder window the cause was reproduced: when the chosen folder is one that Chromium treats as restricted (Desktop, Documents or Downloads themselves, the profile root, AppData, Windows, Program Files), Electron raises the session event `file-system-access-restricted`. `electron/main.cjs` had no listener, so the pick never answered, the folder window stayed active internally and every later save failed until the application was restarted. A folder inside Desktop worked. Fix, by the owner's decision of the same day (asked explicitly; the owner chose to edit `electron/main.cjs`): one block (the one beginning `const fileAccessSession`, about 20 lines) accepts the user's own Desktop, Documents and Downloads folders and anything inside them, and refuses any other restricted folder, so the pick ends as "no folder" and the screen shows the quiet note "Nothing was saved - No folder was chosen. Windows and program folders cannot be used for saving; choose another folder, such as Desktop or Documents." (`FOLDER_NOT_CHOSEN` in `src/components/pdf-tools/savePlan.ts`). Verified with the real folder window by running the exact listener code in a throw-away Electron window: Desktop itself returned a folder, write permission was granted and a file was written; an AppData folder ended the pick at once with a cancel-type error and no hang. Not yet verified: the same through the full application screen (owner hand check), and the single-file Save As window into those folders (expected to be unaffected, because only the folder itself is restricted, not files inside). The automated tests did not catch this because they replace the native windows with stand-ins; it was found by hand after automated verification had passed.
- After the `electron/main.cjs` change: re-run on the clean copy the same day: `npx vitest run src/lib` 24 files / 527 passed; `src/components/pdf-tools` 29 files / 410 passed (PDF Tools 892 in all); TypeScript 76 diagnostics, none in the new folders; ESLint clean; `node --test scripts/test-t003-authorization.cjs` 26/26; `npm run test:native` passed; `npm run test:pdf-tools-ui` 32/32. The Windows package was not rebuilt after this change, so the packaged-build run (31/31, 1 skipped) predates it.
- Split and Delete pages give each kept page only the resources it uses; when a page cannot be read with certainty its resources are kept whole and the result is marked "May hold left-out pages' images" (`sharedResourcesKept`). This is not redaction (Redact is phase 2). Every result of a signed source is marked "Signature no longer valid". Compared in generated files and in pdf.js only.
- Measured during the build (single runs on the build machine, not repeated): a 20-page 300 dpi colour scan came out 70% or more smaller at Recommended; 100 pages of 143 MB came down to 30.4 MB in about 41 s; opening an 83 MB AES-256 scan took about 18.5 s on the main thread.
- Not verified: the native save and folder dialogs through the application screen (including cancel and the "name (2).pdf" numbering; choosing Desktop, Documents and Downloads themselves was verified only with the real folder window in a probe), and the single-file Save As window into those folders; drag and drop; a screen-reader pass; results in Acrobat or another reader (compared in pdf.js only); real Word, Excel and scanner files; the largest sizes (a 300 MB list, 500 pages, 200 images); the installed package; owner UAT. Known limits: [PDF_TOOLS.md section 11](PDF_TOOLS.md#11-known-limits-phase-1).
- Open owner decisions: the application problems in [PDF_TOOLS.md section 12](PDF_TOOLS.md#12-outside-this-feature-for-the-owner) (none changed by this work); instant clearing on engagement change (the owner chose on 13 November 2026 not to edit `src/contexts/EngagementContext.tsx`).

## T-030 main pull status on login (13 November 2026)

- `main` was fast-forwarded from `26d3b9f` to the fetched `origin/main` at `99324ea` (6 commits; PR #109 CAAT Tools and PR #110 FSG/RSF updates). The existing `package-lock.json` modification and untracked documentation packs were preserved.
- The shared login/header label identifies the snapshot as `origin/main` synced 13 November 2026 and names PRs #109/#110. Its tooltip reports the build-time branch, commit and tracked-local-change flag. This is static build information, not a live GitHub check and not evidence that other installed builds have updated.
- The scoped change was committed as `bf0b5bf` and pushed to `origin/main`. GitHub accepted the direct push while reporting that the pull-request-only rule was bypassed.
- Selected task: T-030; affected feature: F-001 (shared login/header build label). See [handoff](SESSION_HANDOFF.md#t-030-main-pull-status-on-login-13-november-2026) for validation and limits.

## RSF published to GitHub (13 November 2026)

Owner explicitly authorised push. Implementation commit b842642 is published on origin/RSF, and local RSF tracks it. Only the reviewed source/docs/mapping-master changes are new; older tracked data artifacts are unchanged from already-published main. No new client TB/database files, merge, release or unrelated fixes. App health HTTP 200 confirmed. Publication details and remaining issues are in the latest handoff.

## T-029 owner-confirmed RSF commit (13 November 2026)

Owner said "so proceed" after the review and explanation of the 76 existing typecheck diagnostics, authorising the scoped T-023 through T-028 commit. This record is included in that commit on RSF; obtain its ID with git log -1. Fresh fetch still has origin/main at base/source 26d3b9f; no merge needed. Preserve documented financial gaps and existing typecheck debt. No unrelated error fixes, push, release or branch switch authorised. Integration 210/210, desktop 81/81 and documentation/diff checks passed in the reviewed tree; app HTTP 200 and responding Electron processes rechecked. Explicit reviewed source/docs/master-workbook staging excludes client uploads and database files. See RSF_PRE_COMMIT_REVIEW.md and RSF_COMMIT_MESSAGE.txt for full scope and limitations. Continue on RSF after commit.

## T-029 pre-commit review (13 November 2026)

Owner requested all pending RSF changes be reviewed before an explicitly confirmed commit. Fresh fetch confirms HEAD equals origin/main at 26d3b9f (0/0); no remote RSF or merge conflicts. Integration 210/210 and desktop 81/81 passed again. Explicit typecheck remains failing with 76 diagnostics; compiler-host comparison with HEAD versions of the three changed TS files found zero new signatures. VERA development app remains running. Complete scope, changed-path manifest, existing functional gaps and older tracked data-artifact privacy concern: [RSF review](RSF_PRE_COMMIT_REVIEW.md); [proposed full commit message](RSF_COMMIT_MESSAGE.txt). Nothing staged/committed/pushed; owner confirmation pending. No new application implementation in this review.

## T-027 supporting dates and T-028 Cloudtail removal (13 November 2026)

Extended dated headings from BS/P&L faces to their Notes, ledger Annexures, applicable supporting disclosure/ageing/working tables and normal PDF/Excel. BS notes use As at; P&L notes use For the year ended, using the same current/comparative period dates. Per-note Excel headers preserve column positions/formula links; movement Opening/Closing headings remain. Investment disclosure headers are dated without changing saved field keys or import-workbook contracts. T-028 removes the Cloudtail banner/button, manual and automatic final-export publication, renderer snapshot methods, IPC handlers/policies and snapshot serializer. Historical fs_snapshots storage is retained without migration/deletion. Finalisation/signing and normal financial exports remain. Integration 210/210 passed, including actual paginated dated-notes PDF and reopened Excel across multiple years. Desktop 81/81 passed, including production build, wrapped dated headings, Cloudtail absence, exports, finalisation and restart regressions; owner UAT pending. No client data or trial balances staged, committed or pushed.

## T-026 owner rollback: provisional liability removed (12 November 2026)

The owner explicitly selected rollback of the provisional liability only. Missing-ALIE reports now remain diagnostics: unresolved amounts are excluded pending classification and no synthetic ALIE MISSING section/rows enter BS, P&L, normal/columnar exports or new snapshots. The red beginning/end warnings, directly visible ledger review list, correction actions, non-blocking generation, nil filtering and Stock Entry PY exclusion remain. Warning wording states that statements may be incomplete or unbalanced. This supersedes all earlier descriptions of provisional liability inclusion below. No source data or stock calculations changed. Tests use invented data, not client trial balance figures; no client data staged/committed/pushed. Integration 201/201 and desktop 77/77 passed, including production build and restart; docs/inventory/diff checks passed. Final warning visually inspected. Validation details and corrected test-reader assertions recorded in the latest handoff; owner UAT pending.

## T-026 stock-input false-positive fix (12 November 2026)

The owner screenshot identified PY Opening Stock / PY Closing Stock as false missing-ALIE exceptions. Source tracing confirms `tb:saveStock` deliberately saves these as `upload_nature = Stock Entry PY` without mapping records, for Stock-form comparative disclosure only. The shared missing-ALIE query now excludes this provenance before counts, messages, provisional liability totals and export/snapshot evidence are built. Genuine imported stock ledgers remain checked even with identical names; actual CY stock mappings and financial stock calculations are unchanged. Stock values are preserved. Integration 201/201 passed with actual saved Stock-form inputs, selected consolidated/branch data, real ledger negative control and all prior export/source-preservation regressions. Desktop 77/77 passed including build and restart; stock exclusion and unchanged real exception net visually checked. Docs/inventory/diff checks passed; owner UAT pending. Restart VERA to load the changed main-process service.

## T-026 warning wording correction (12 November 2026)

Owner approved simplifying the confusing missing-ALIE notice. It now says ALIE classification is missing for a number of ledgers, reports the period closing/opening balance and Dr/Cr/Nil, explains negative/positive/net-zero provisional presentation under ALIE MISSING on the BS liability side, and asks for correct ALIE. Gross debit/credit amounts remain. Removed the P&L-only implication. The screen shows ledger names and debit/credit balances directly below the notice without expanding a disclosure. For rows not yet mapped, a plain next step explains Auto-Mapping followed by ALIE review; the existing correction action remains. Shared PDF/Excel messages and ledger-list captions follow the new wording. No mapping, source amounts, financial math or generation permissions changed. Integration 197/197 and desktop 76/76 passed; production build/docs/diff checks passed. Screen/PDF wording and layout visually inspected. Evidence and earlier assertion/markup corrections are in the latest handoff; owner UAT pending.

## T-027 dated BS and P&L columns (12 November 2026)

Implemented the owner-requested date headings within Financial Statement Review (F-009): BS columns use **As at 31 March 2026** / **As at 31 March 2025** for FY 2025-26; P&L uses **For the year ended** with the same dates. A shared formatter derives dates from the active reporting period and selected comparative, or the preceding year when comparatives use opening/manual figures. Explicit custom year ends are retained; invalid/absent dates retain generic headings. Screen, normal PDF and Excel BS/P&L titles/columns are aligned for companies, partnerships and LLPs. Branch-wise columnar exports retain branch-name columns (they have no CY/PY columns). Source amounts and financial calculations are unchanged. Integration 190/190 passed, including FY 2022-23/2024-25/2025-26/2026-27, custom year end, selected comparative, invalid dates and leap-day fallback. Desktop 75/75 passed including production build and both date-heading assertions. Screen/PDF layouts visually checked; documentation/inventory/diff checks passed. Owner UAT pending.

## T-026 follow-up: ALIE MISSING provisional BS head (12 November 2026)

Owner-authorised default liability-side **ALIE MISSING** presentation now includes actual signed missing-ALIE balances in BS totals, alongside red bold warnings. Nil amounts are excluded independently per period; opening/selected comparative balances remain relevant only to PY. Source classifications/statuses and P&L calculations remain unchanged. Company, partnership, LLP and columnar exports use the provisional head; correction removes it on reload. Integration passed 171/171; desktop checks passed 73/73 including production build. Documentation and diff checks passed. [Current contract](T026_MISSING_ALIE_WARNINGS.md#owner-follow-up-provisional-liability-side-presentation-12-november-2026) supersedes the earlier warning-only description below. Known-ALIE unresolved statuses and GAP-18 remain open; owner UAT pending.

## T-026 missing-ALIE warning part (12 November 2026)

Owner-authorised non-blocking missing-ALIE warnings are implemented in Financial Statement Review only. Source-ledger detection includes absent mapping records and null/blank/invalid ALIE; red bold beginning/end BS/P&L messages show count, closing debit/credit and net in rupees, with separately labelled comparative data. Rectification links, ledger-wise Annexures/PDF/Excel exceptions, columnar warnings and snapshot evidence are included. Existing financial statement calculations and unresolved-status filters are unchanged. [Contract and boundaries](T026_MISSING_ALIE_WARNINGS.md).

Integration `npm.cmd run test:fsg` passed 147/147, including actual PDF, reopened company/partnership/LLP and columnar Excel, permissions, PY scope, source preservation and correction. `npm.cmd run test:fsg-ui` passed 71/71 with production build; actual PDF and final screen warnings visually inspected. Documentation checks passed. The latest handoff records exact evidence and the resolved test-navigation failure. Known-ALIE conflict/discrepancy inclusion and GAP-18 remain outstanding T-026 work; owner UAT is pending. Existing uncommitted prior tasks remain preserved.

## T-026 unresolved ledger diagnosis (11 November 2026)

Owner clarified that unresolved mapping must not remove ledger values from the statements. Source inspection confirms all three `electron/fsg/ipc/financials.js` query paths exclude `unmapped`, `conflict` and `discrepancy` statuses and require resolved ALIE, before fallback presentation runs. The T-024 known-ALIE fallback is `auto_low` and included, but it did not address these excluded statuses. This is an implementation gap against the clarified intent; earlier passing tests do not verify it. GAP-18 is a separate non-corporate profit-transfer target issue. [T-026 diagnosis and next executable step](SESSION_HANDOFF.md#t-026-diagnosis-unresolved-ledger-inclusion-11-november-2026). No application change in this explanation turn.

## T-025 investment disclosures (11 November 2026)

- On `RSF` at source `26d3b9f`, implemented the owner's investment Fill Details request within Financial Statement Review only (F-009). Existing uncommitted T-023/T-024 work is retained. [Contract, sources and flow](T025_INVESTMENT_DISCLOSURES.md).
- Current/non-current tables follow populated sub-classifications with restricted ledger choices; printed investee, custom categories, relationships, securities/paid/quotation/valuation details, partnership partners/capital/shares, aggregates and redemption disclosures persist by year and TB/consolidated scope. Current investments have no trade/other split. Main-process permissions, ledger membership and locked/final-year checks protect saves. No source balance or measurement rule changes.
- Integration `npm.cmd run test:fsg`: 121/121 passed, including actual PDF extraction, reopened financial/Fill Details Excel, comparative-only ledgers, snapshots, year/client isolation and lock/bypass rejection. UI `npm.cmd run test:fsg-ui`: 61/61 passed; final layout confirmation is recorded in the latest handoff. Production build passed. PDF review found and fixed a continued-table header issue; the regenerated aggregate table was visually checked. Form screenshot review found and fixed a scoped label-style conflict.
- `npx.cmd tsc -p tsconfig.app.json --noEmit` remains failing in previously recorded shared application files; this task changes no TypeScript files. Sandbox build failed loading the installed native compiler; elevated build passed. PDF.js font-program warnings and the existing no-record Materiality warning remain. Documentation/source checks and final UI evidence are recorded in [handoff](SESSION_HANDOFF.md). Professional review, real-client UAT and installer testing remain open; no commit/release or owner acceptance claimed.

## T-023 GSTIN merge and startup label (11 November 2026)

- User-authorized outcome: pull PR #108 and identify that code update on startup.
- PR #108 was already merged by the owner at `f4d559742e8bf969a0c49125156c65b5c09345d6`; its GitHub `documentation` check passed. PR #107 (shared build label) was also already merged. Local `main` was fast-forwarded to `origin/main`, retaining the existing lockfile modification and untracked documentation packs.
- The shared login/header label now reads `Code baseline: 11 November 2026` and `Update: GSTIN normalization and validation (PR #108)`. The tooltip identifies `main` and the build-time commit; it does not poll GitHub or certify that an installed build is current.
- Passed: `npx --no-install vitest run src\lib` (10 files, 45 tests, including GSTIN validation and five label tests); `npx --no-install eslint src\config\buildMessage.ts src\lib\buildInfoLabel.test.ts`; `npm run build`.
- Failed: `npx --no-install tsc -p tsconfig.app.json --noEmit` (76 diagnostics in the same 18 files listed in the prior baseline, none in the label changes).
- `npm run docs:inventory` regenerated the inventory and screen map with no substantive diff. Documentation closeout results and remaining verification limits are in [SESSION_HANDOFF.md](SESSION_HANDOFF.md#t-023-gstin-merge-and-startup-label-11-november-2026).
- Not established: GST screen persistence/UAT, Electron visual fit, installer or release. The attempted production browser preview could not render because the application requires Electron; its temporary server was stopped. No client database was accessed or migrated.

## T-024 known-ALIE fallback categories (10 November 2026)

Implemented within Financial Statement Review on `RSF`: five requested LevelFormat terminal rows (684 workbook data rows), canonical master-linked low-confidence fallback mapping, matching BS wording, and a backup-backed additive upgrade for the known old workbook version. Existing IDs, overrides and balances are retained. See [T024_LEVEL1_FALLBACKS.md](T024_LEVEL1_FALLBACKS.md). Integration passed 93/93; UI passed 54/54; production build, documentation and syntax checks passed. Actual company PDF text and reopened Excel for constitutions 1/2/3 contain the tested fallback captions and figures. Synthetic backup/restore/retry and source-imbalance checks passed; no real-profile upgrade or owner UAT is claimed.

No universal balancing guarantee: all-fallback non-corporate equity can leave the existing profit-transfer rule without an owners'/partners' heading (GAP-18); the difference remains visible. No plug or new professional rule is introduced. Earlier T-023 work is preserved; other modules are not changed by T-024.

## T-023 firm signing place (10 November 2026)

Implemented on `RSF` from `d86bd93`, per the user's request and clarification: Place in VERA Settings/Admin Settings → Firm supplies Financial Statement Review's editable signing-place default. The global Siliguri/last-used preference is no longer consulted. Finalised years retain their recorded place. Additive upgrade creates a SQLite backup before adding `firm_settings.place`. Scope and acceptance: [T023_FIRM_SIGNING_PLACE.md](T023_FIRM_SIGNING_PLACE.md). Owner UAT is pending; the older snapshots below remain historical.

Validation: FSG integration passed 60/60, including seven fresh/upgrade/recovery checks; production build passed. Updated UI harness passed 47/47, including both settings screens, override/cancellation, restart, empty Place and finalised-year preservation. First UI run passed 44/45 because its restart assertion clicked export before statement loading enabled the button; the corrected readiness wait passed on rerun. Documentation and whitespace checks passed. TypeScript remains at 76 diagnostics and focused lint at 15 errors/1 warning; source comparisons against HEAD show no new diagnostics. Details and skipped checks are recorded in the handoff. PDF/Excel file content was not inspected.

## Snapshot

- Documentation review date: 30 October 2026.
- Reviewed application baseline: `cc5c04729604fba7d05240a07f24682e0644665c`.
- Source repository: ICAI-Audit/audit-assistant-pro-electron.
- Source branch and base commit: `main`, `c0ea50820094952b3bad9c83b45cc00cbff0381c`.
- Application package version: 0.9.1.
- Source remediation branch: `fix/t003-backend-authorization-2026-10-29`.
- Current documentation branch: `docs/application-review-2026-10-30`.
- Verification branch retained: `docs/t003-auth-lock-verification-2026-10-29` from `229a098f375050be1c5d4cd45236b5e0ec903325`.
- Branch HEAD: resolve with Git (`git rev-parse HEAD`); do not copy a commit's own SHA into this document.
- Local validation environment: Node.js 24.12.0 and npm 11.6.2.
- Current scope: handover preparation (2 November 2026): T-020 cleanup plus T-021 and T-012, integrated on `integration/handover-2026-11-02` from `main` at `cad1727eeb2500c8ecd06d9ffa3a86664a9246b4`. T-019 (Financial Statement Review) is merged to `main` as PR #105; see [FINANCIAL_STATEMENT_REVIEW.md](FINANCIAL_STATEMENT_REVIEW.md). The T-018 documentation review and its open owner decisions otherwise stand. PDF Tools phase 1 (T-031) is committed and pushed on `feat/pdf-tools`; no pull request, not merged.

## T-021 handover result (2 November 2026)

Fresh clone of `feat/t021-reconnect-tb-readers` (Windows, Node.js 24.12.0/npm 11.6.2, synthetic data): `npm ci --no-audit --no-fund` with normal postinstall, then the checks below. Branches and decisions: [SESSION_HANDOFF.md](SESSION_HANDOFF.md); module classification: [HANDOVER_CHECKLIST.md](HANDOVER_CHECKLIST.md).

| Check | Result |
| --- | --- |
| `npm ci --no-audit --no-fund` | Passed (exit 0; electron-rebuild of better-sqlite3 and bcrypt) |
| `npm run docs:check`; `node --test scripts/check-project-docs.test.mjs` | Passed; 3/3 |
| `npm run build` | Passed |
| `npm run test:native` | Passed (Electron 40.9.1) |
| `npm run test:fsg` | Passed, 53/53 (41 earlier + 12 for `fsg:engagement:summary`: counts, CY/PY, face-line amounts, branch trial balances, access refusal across engagements and clients, authentication, no writes) |
| `node scripts/test-fsg-ui.cjs` | Passed, 37/37 |
| `node --test scripts/test-t003-authorization.cjs` | Passed, 26/26 |
| `npx vitest run src/lib` | Passed; 8 files, 37 tests |
| `npx tsc -p tsconfig.app.json --noEmit` | **Failed**, 76 diagnostics in 18 files, same as the starting baseline (none in the T-021 files' own logic; none suppressed) |
| `npm run lint` | **Failed**, 545 problems (474 errors, 71 warnings); 546 before T-021 |

Skipped / not established: the three reconnected screens in the running application, PDF and Excel contents, sign-in and engagement switching through the UI, close and reopen through the UI, packaged launch, installer, live Tally, owner UAT. The engagement-isolation evidence is for the `fsg:engagement:summary` channel only.

## T-020 result (2 November 2026)

Windows, Node.js 24.12.0/npm 11.6.2, synthetic data only. Starting commit `cad1727eeb2500c8ecd06d9ffa3a86664a9246b4` (origin/main, unchanged since the earlier review).

| Check | Baseline at start | After cleanup |
| --- | --- | --- |
| `npm run docs:check` | Failed: `ENOENT scandir tests` | Passed |
| `node --test scripts/check-project-docs.test.mjs` | Failed (same cause) | Passed, 3/3 |
| `npm run build` | Passed | Passed |
| `npm run test:fsg` | 41/41 | 41/41 |
| `node scripts/test-fsg-ui.cjs` (after build) | Failed, 35/37 (seed used `HEAD`'s schema, which no longer has the legacy tables) | 37/37 |
| `node --test scripts/test-t003-authorization.cjs` | 26/26 | 26/26 |
| `npm run test:native`, `npx vitest run src/lib` | not run at baseline | Passed; 8 files, 37 tests |
| `npx tsc -p tsconfig.app.json --noEmit` | 76 diagnostics | 76 diagnostics (unchanged) |
| `npm run lint` | 564 problems (492 errors, 72 warnings) | 546 problems (475 errors, 71 warnings) |

Not established: application behaviour beyond the synthetic harnesses, packaged launch, installer, live Tally, owner UAT. Removals and retained candidates are listed in [SESSION_HANDOFF.md](SESSION_HANDOFF.md). The T-019 snapshot below is historical.

## T-019 result (2 November 2026, historical; merged to `main` as PR #105)

Windows, Electron 40.9.1, SQLite 3.53.0, Node.js 22.14.0/npm 10.9.2, synthetic data only. Developed on `work/developer-task` from `03d1a46f16b36da16d3821cee2e1c3280897a78c`.

**Passed**
- `npm run docs:check` (31 documents, links, inventory) and `node --test scripts/check-project-docs.test.mjs` (2/2).
- `npm run test:fsg`: 41/41.
- `node scripts/test-fsg-ui.cjs` after `npm run build`: 37/37.
- `node --test scripts/test-t003-authorization.cjs`: 26/26.
- `npm run test:native`.
- `npx vitest run src/lib`: 8 files, 37 tests.
- `npm run build`.

**Failing as baseline, reduced**
- TypeScript: 76 diagnostics in 18 files, none new in changed files.
- Lint: 492 errors and 72 warnings; changed TypeScript files are clean.

**Not established**
- Same-TB comparison with FSG_Bharat on PostgreSQL.
- PDF/Excel content review.
- Live Tally.
- Installer.
- Upgrade of a real installed database.
- `npm ci` on Node 24.12 after adding 11 renderer packages.
- Owner UAT.

**Removed**
- `test:classification` and `test:bulk-update`, with the code they tested.

## What is established

- Active runtime remains Electron main/preload with renderer IPC to local SQLite under Electron `userData`.
- T-001 remains partial: automatic repository-instruction loading is still unverified.
- T-002 installation/toolchain fixes remain intact.
- T-003 now has implemented backend enforcement for the previously confirmed unauthenticated and cross-engagement IPC defects.

## Earlier T-003 reported remediation evidence

The following application execution results were reported by the prior VS Code session and retained at the reviewed baseline. They were not rerun as part of this documentation pass. Full UI behaviour and unresolved policies remain separate.


The harness runs the real production handlers (`electron/main.cjs`, `electron/preload.cjs`) in an isolated temporary profile via `scripts/t003-electron-entry.cjs` and `scripts/test-t003-authorization.cjs`. It verifies that the temporary database does not exist before loading main, then exercises the actual preload API with synthetic users/data.

Implemented backend changes:

- Added centralized authorization checks in `electron/sqlite-authorization.cjs`.
- `sqlite-query` now rejects unauthenticated access, validates table/action, enforces filtered-only update/delete, and applies engagement-scoped checks for select/update/delete/insert/upsert.
- Cross-engagement forged-ID mutations are denied.
- Protected role and sensitive field updates are denied.
- Cross-engagement `evidence_links` insertion/read paths are blocked.
- Evidence file path/save/download/delete handlers now require authentication and evidence metadata ownership checks.
- Admin behavior follows approved task choice: partner-equivalent permissions plus global engagement scope.

Latest isolated regression result:

- `node --test scripts/test-t003-authorization.cjs`: **passed** (26 tests, 26 passed, 0 failed), including four review-finding regressions that failed before the fixes (canonical file ownership, parent-key moves, trial balance authorization, scoped upload rollback).

Observation-only cases intentionally remain:

- Evidence `locked`/`approval_stage` transition policy is still unresolved and not yet enforced by finalized business rules.
- Export while logged out still succeeds to local downloads; export authorization policy remains unresolved.

## Validation summary (T-003 time; historical, `test:classification` and `test:bulk-update` were removed in T-019)

**Passed**

- `npm ci --no-audit --no-fund`
- `node --check electron/sqlite-authorization.cjs`
- `node --check electron/main.cjs`
- `node --check scripts/test-t003-authorization.cjs`
- `node --test scripts/test-t003-authorization.cjs` (26/26 pass)
- `npm run test:native`, `npx vitest run src/lib` (8 files, 37 tests), `npm run test:classification`, `npm run test:bulk-update`, `npm run build`

**Failed (existing baseline, tracked separately)**

- `npx tsc -p tsconfig.app.json --noEmit`: existing diagnostics baseline (T-013).
- `npm run lint`: existing lint baseline (T-014).

**Not established in this scope**

- Installer/release validation.
- Cross-platform runtime validation.
- ODBC/Tally integration validation.
- Owner UAT.

## Blocking or material gaps

1. Export authorization policy remains undefined at the backend boundary.
2. Evidence approval/review/lock/reopen transition rules require product decisions before final enforcement.
3. Long-term role mapping decisions for `viewer` and `user` remain open.
4. TypeScript and lint baselines remain failing and must be triaged separately.
5. Prototype feature gaps remain for Misstatements and Completion (T-007 scope continues separately).
6. Dashboard, Audit Report setup and Data Integrity now read Financial Statement Review data (T-021, awaiting owner acceptance); the legacy tables stay unread and untouched, and their fate is an open owner decision.
7. Duplicate deferred-tax tools and placeholder actions are recorded and unchanged (T-022). The duplicate `/feedback` route is resolved (T-012).

## Documentation review result

Prepared the owner review edition and 19 canonical module specifications covering all 28 feature IDs; traced 35 original Phase I statements/blueprint proposals; documented principal business fields, rules, outputs, permission boundaries and acceptance scenarios. Added a 78-table/1,055-column declared-schema catalogue, persistence caller catalogue and tax clause/field catalogue with extraction limits. Consolidated 16 owner review groups and known implementation/verification gaps.

Documentation-only checks completed on Node.js 24.22.1: `node scripts/check-project-docs.mjs` passed, and `node --test scripts/check-project-docs.test.mjs` passed one regression test with zero failures. Additional review validation passed for 61 Markdown files, 617 local links, all 28 feature IDs, 19 module sections, 35 traced source statements, 60 unique proposed acceptance cases and 16 owner review groups. Source anchors exist and all 46 changed paths are Markdown or documentation JSON. `git diff --check` passed; staged/final diff is checked at commit. No application tests or legal review were rerun.

## First next activity

T-019: the owner reviews [FINANCIAL_STATEMENT_REVIEW.md](FINANCIAL_STATEMENT_REVIEW.md), answers the listed assumptions, and compares one anonymised trial balance in FSG_Bharat and in VERA. The T-018 activity below is unchanged.

The owner reviews REVIEW_START_HERE.md and APPLICATION_REVIEW.md and records decisions/corrections in OWNER_REVIEW_DECISIONS.md. Update the canonical modules and approved scope after that review. Do not automatically start export-policy implementation, schema repair, security remediation, typecheck or lint work from the previous handoff. Those remain documented pending tasks requiring a separate implementation request.
