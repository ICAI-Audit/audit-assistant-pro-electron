# CAAT Tools (T-024)

CAAT Tools adds data analytics tests and SA 530 audit sampling to VERA at `/caat-tools` (sidebar: **CAAT Tools**, after VERA Tools). It embeds the owner-supplied standalone tool, now `CAAT_Tools3.html` (v0.10, T-030, 17 November 2026; previously `CAAT_Tools2.html` Prototype v0.6) and saves its work per engagement in the VERA database.

Approval source: the owner's instruction of 11 November 2026, given after reviewing the findings below: fix the large-ledger crash, upgrade the bundled SheetJS if possible, save values in the database, fix the sampling wording, leave the disclaimer as it is, and leave statutory limits as user-configured settings.

## What the tool does

- **Data & Mapping:** loads CSV/TXT/TSV and Excel files; combines files and sheets; skips totals, opening/closing balance rows and repeated headings; fills down blank cells; turns period columns into rows; reads Dr/Cr and split debit/credit layouts and Indian or comma-decimal numbers; row filters; reusable mapping profiles.
- **11 tests:** Relative Size Factor, Check missing (document number gaps and duplicates, blank cells), Check duplicates, Round numbers, Repetitive odd numbers, Classification & Stratification, Single transactions, Isolated outliers (IQR / Z-score), Benford's Law (first, second, first-two digits), GSTIN / PAN format check (including the GSTIN check digit), Entries just under a threshold (including split transactions).
- **Audit sampling (SA 530):** tests of details (MUS formula, own number or fixed interval) and tests of controls (SIA 5 frequency table, attribute formula or own number); MUS, random, systematic, stratified and random-period selection with a recorded seed; evaluation (projected misstatement, MUS upper misstatement limit, deviation rate and upper deviation limit).
- **Export:** an Excel working paper with the source file SHA-256, data clean-up log, parameters, results and sampling plan.

Thresholds, limits, confidence levels and the SIA 5 table values are shown as defaults that the auditor can change; their statutory currency is the auditor's responsibility, as the tool's disclaimer states.

## Files

| Part | Path | Notes |
| --- | --- | --- |
| Tool | `public/caat/caat-tools.html` | The owner's file with only the changes listed below. Served at `./caat/caat-tools.html` in development and from `dist/caat` in the packaged app. |
| Spreadsheet library | `public/caat/xlsx-0.20.3.core.min.js`, `public/caat/SHEETJS-LICENSE.txt` | SheetJS Community Edition 0.20.3 core build from the official `cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz` (tarball SHA-256 `8dc73fc3b00203e72d176e85b50938627c7b086e607c682e8d3c22c02bb99fe8`), Apache-2.0. Used only by CAAT Tools; the rest of VERA still uses the npm `xlsx` 0.18.5. |
| Theme | `public/caat/caat-vera-theme.css` | Loaded after the tool's own styles: VERA colours, Inter type, buttons, inputs, tables, cards, navigation, dialog and toast. Restyling only. |
| Bridge | `public/caat/caat-bridge.js` | Loaded after the tool's script inside the frame. Saves and restores the workspace through the host page with `postMessage`. Does nothing when the HTML is opened on its own. |
| Page | `src/pages/CaatTools.tsx` | Hosts the frame (`MainLayout fullBleed`, `ProtectedEngagementRoute`), loads and writes the workspace through the generic SQLite client and shows the save status. |
| Schema | `sqlite/schema/11_caat_tables.sql` | `caat_workspaces` (one row per engagement, JSON `state`) and `caat_source_files` (source files as base64, unique per engagement and file key). Applied by `electron/main.cjs` with the other schema files (`CREATE ... IF NOT EXISTS`). |
| Access | `electron/sqlite-authorization.cjs` | Both tables are engagement tables: users reach only engagements they may access. |
| Test | `scripts/test-caat-ui.cjs`, `npm run test:caat-ui` | Synthetic end-to-end check in the production main process on a throw-away profile. |

## Changes to the owner's tool

Only these changes were made to the tested HTML; no test, sampling or export logic was altered.

1. **Large-ledger crash fixed.** `Math.max(...array)` / `Math.min(...array)` throw `RangeError: Maximum call stack size exceeded` above about 120,000 items in V8 (reproduced in Node 24). The Overview card "Largest / smallest" (shown immediately after Apply mapping), the stratum minimum/maximum and the split-transaction smallest-part calculation now use a loop with the same result.
2. **SheetJS upgraded** from the embedded 0.18.5 to 0.20.3, which fixes CVE-2023-30533 (prototype pollution when reading a crafted file, fixed in 0.19.3) and CVE-2024-22363 (regular-expression denial of service, fixed in 0.20.2). The inline copy was replaced by a script tag for the separate file; the API calls the tool uses are unchanged.
3. **Wording.** The sampling evaluation said "Enter tolerable misstatement in step 3" (it is entered in step 4) and was headed "5. Evaluation" although step 5 is the selection method; it now says step 4 and is headed "Evaluation" / "Evaluation of results", as for tests of controls.
4. **Bridge script tag** added before `</body>`.

The disclaimer was left unchanged at the owner's instruction.

## v0.10 update (T-030, 17 November 2026)

Owner instruction of 17 November 2026: add the revised version to CAAT Tools with the same UI/UX as the application, review the code, merge to `caat_tools` and push after a pull.

What v0.10 changes (owner's code): the tool now has its own left navigation (Data & Mapping, Insights, the 11 tests, Audit Sampling) with a data card and an "Export working papers" button; entity/period/prepared-by moved into an export dialog; the data type (general listing, purchase, sales, cash, bank, day book, …) and source software are detected and drive presets; Apply mapping runs every test and opens Insights.

Changes made for VERA, re-applied to the new file (the owner's file has none of them):

1. Large-ledger crash: `Math.max(...a)` / `Math.min(...a)` over ledger-sized arrays replaced by loop helpers `arrMax` / `arrMin` in stratification, Benford (new), the document-number series check (new) and split transactions. Remaining spreads are over at most a few hundred items.
2. The inline SheetJS 0.18.5 removed again; the tool loads `xlsx-0.20.3.core.min.js`.
3. Sampling wording: "step 3" → "step 4"; "5. Evaluation" → "Evaluation" / "Evaluation of results".
4. VERA look: theme stylesheet link; the two chart colours changed to the app's primary blue and success green; the bridge adds class `vera` to `<body>` (hides the tool's own logo inside VERA).
5. Bridge: also saves whether the data type and statement type were detected or chosen by the user; on restore it no longer re-runs tests that Apply mapping already ran.

Review findings in the owner's new code that were **not** changed (they alter test results, so they need the owner's decision):

- Check missing: choosing between "numbered per voucher type" and "one shared series" compares gap counts only. Where each voucher type has its own 1..N series, the shared series has no gaps but many duplicates and is chosen, reporting false duplicates.
- With one amount column, the "side to analyse" (payments/receipts) leaves no lines out, yet the data log and screen say only that side was analysed.
- Check missing drill-down for duplicates is empty when prefixes are not treated as separate series, and searches only rows on the chosen side.
- Apply mapping silently overwrites "Show as positive" / "Treat as negative" when a side is chosen, and those values are then saved in profiles.
- An imported profile with an unknown data type makes the Data view throw.
- Demo data keeps the data type of a file loaded earlier.
- Insights always says "all 11 tests run", even when some could not run.
- (Already in v0.6) the MUS conclusion compares the upper misstatement limit, which excludes key-item misstatement, with tolerable misstatement.
- Low risk: "Copy table" puts raw cell text on the clipboard; text beginning with `=`, `+`, `-` or `@` becomes a formula if pasted into Excel. The `.xlsx` export is not affected.

Checked without findings: Benford expected values and critical values, GSTIN check digit and PAN rules, RSF, round and repeated amounts, outliers, MUS and attribute sample sizes and limits, seeded selection, parsing; all file-derived text is escaped; no network calls or `eval`.

Verification: `npm run test:caat-ui` 29/29 (the large-ledger check now requires that no test fails with the call-stack error after Apply mapping runs all tests on 150,000 rows, and that stratification, Benford and Check missing produce results). Screenshots reviewed for the VERA look.

## Saving and restoring

- Saved automatically (about a second after a change, and every 1.5 seconds while something is unsaved): entity/period/prepared-by fields, source files and sheet selection, layout and clean-up settings, column mapping, row filters, test parameters, which tests were run, the sampling settings (including the seed actually used) and the audited values, control results and remarks entered.
- Results are not stored. When the page opens, the bridge reloads the saved files and settings through the tool's own functions, re-applies the mapping, re-runs the tests that had been run and re-selects the sample with the recorded seed, then restores the entered values. The same files and settings give the same results and the same sample. A sample drawn with "Use a seed number" off is re-selected with the seed recorded for that run; the plan still says the seed setting was off.
- A new workspace takes the entity name, financial year and preparer from the engagement and the signed-in user.
- Removing files in the tool deletes them from `caat_source_files` on the next save.
- Database requests are only accepted from the main application frame, so the frame never writes to the database; the page does.
- Mapping profiles stay in the tool's local storage as before.

## Verification (11 November 2026, synthetic data only)

- `node scripts/test-caat-ui.cjs` after `npm run build`: 29/29 checks — schema applied on a new database; sidebar entry; frame loads with SheetJS 0.20.3; workspace pre-filled from the engagement; demo data, all 11 tests, a changed RSF threshold, a sample without fixed seed and an audited value saved; a 150,000-row CSV opens the Overview and runs stratification; after a restart both engagements' workspaces return with identical flags, parameters, sample items, seed, audited value and evaluation; removed files are deleted; database integrity and foreign keys.
- Regression: `node --test scripts/test-t003-authorization.cjs` 26/26; `node scripts/test-fsg-ui.cjs` 37/37; `npx vitest run src/lib` 10 files / 45 tests; `npx eslint` on the new page and bridge clean; `npx tsc -p tsconfig.app.json --noEmit` unchanged at the 76 recorded diagnostics, none in the new files.

## Known limits

- Very large source files are stored in full (base64) in the database and loaded into memory when the page opens.
- The Excel export uses the browser download, which in VERA opens the standard Save dialog; it is not filed in the Evidence Vault automatically.
- Changing the column mapping after "Apply mapping" without applying it again is saved as the newer mapping and applied on the next open.
- A change made less than about a second before leaving the page may not be saved.
- Not established: owner UAT with real client ledgers, packaged-installer behaviour, and review of the statutory defaults.
