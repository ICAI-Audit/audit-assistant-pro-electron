# Ledger Analysis (VERA Tools > Ledger Analysis)

Status (T-033, 14 November 2026): implemented on branch `ledger-analysis` (base `main` at `b835def`), pushed as a branch for the owner's review; **not merged, owner UAT pending**. Automated tests use synthetic data only. The live Tally fetch and every check were exercised by hand against the owner's live TallyPrime test company (FY 2025-26, 768 ledgers, about 19,700 day book lines); that client's names and figures are deliberately not recorded here. Task record: [T-033](tasks/T-033-ledger-analysis.md).

## Purpose

One screen that loads a company's accounting data, runs the Ledger Analysis checks from the owner's scope note, and extracts the Day Book to Excel. It combines the owner's Day Book Extractor and the ledger-analysis / audit-observation work inside VERA Tools instead of a separate application. It replaces the former VERA Tools "Tally Tools" tab (see [Tally Tools removed](#tally-tools-removed)).

## Where it sits

| Piece | Path |
|---|---|
| First and default VERA Tools tab (`/audit-tools`, `/audit-tools?tab=ledger`; old `?tab=tally` links open it; Ctrl+1) | `src/pages/AuditTools.tsx` (lazy-loads the module) |
| Screen, result table, Details side panel | `src/modules/ledger-analysis/LedgerAnalysisTool.tsx`, `ResultTable.tsx`, `DetailsPanel.tsx` |
| Importers (Day Book Extractor, TallyDayBook.exe output, generic day book, VERA Tally TB export, Busy, Zoho, generic TB, ledger masters) | `src/modules/ledger-analysis/importers.ts` (Busy / Zoho reuse `src/modules/fsg/utils/{busy,zoho}Parsers.js` unchanged) |
| Group classification | `src/modules/ledger-analysis/classify.ts` |
| Checks and Details data | `src/modules/ledger-analysis/engine.ts` |
| Excel exports | `src/modules/ledger-analysis/exportExcel.ts` |
| Live Tally fetch (main process, read-only HTTP XML export) | `electron/ledger-analysis/tally-xml.cjs`; IPC `ledger-analysis:tally-companies`, `ledger-analysis:tally-fetch` in `electron/main.cjs` (signed-in user required); bridge `window.electronAPI.ledgerAnalysis` in `electron/preload.cjs` |
| Tests | `src/modules/ledger-analysis/ledgerAnalysis.test.ts` (synthetic data); `scripts/test-t003-authorization.cjs` check "ledger analysis Tally handlers require a signed-in user (T-033)" |

The Analytics card "Duplicate Transaction Finder" ("Coming Soon" before) now opens this tab.

## Data sources

- **Tally (live)**: host/port (default `localhost:9000`), optional company, period. Fetches ledger masters (parent, opening, closing as at the period end, GSTIN incl. `LEDGSTREGDETAILS`, PAN from `IncomeTaxNumber`, GST registration type), group masters, voucher types, and the day book month by month. Requires a signed-in user. Every request is an Export; nothing is written to Tally.
- **Files**: Day Book Extractor workbook (`odbcdaybook` with `$Date`, `$Amount`, `$DRcr`... plus `Ledgers`), a TallyDayBook.exe output file, any columnar day book (columns detected by name; the user can change the mapping), trial balance (VERA "Get Trial Balance from Tally" export files made before T-033, Busy, Zoho, Day Book Extractor Ledgers sheet or generic Excel), ledger masters (GSTIN / PAN / group).
- Internal sign convention: debit positive. Tally and Day Book Extractor values are flipped on import.
- Data is held in renderer memory only. It is not written to SQLite or the engagement; closing the app discards it.

### Which Tally vouchers count

- Day book method "Auto" (default) uses the TDL voucher collection filtered by date, month by month; the Tally "Day Book" report is the fallback, or can be chosen.
- Left out, and counted in the warnings: optional and cancelled vouchers; post-dated vouchers (`ISPOSTDATED`); vouchers whose type resolves through the voucher-type Parent chain to Purchase Order, Sales Order, Delivery Note, Receipt Note, Rejections In/Out, Memorandum, Reversing Journal, Job Work In/Out Order or Material In/Out (they carry ledger lines but post nothing). Stock and Physical Stock journals are not excluded by type: they normally carry no ledger lines, and when they do Tally counts them.
- Item invoices: the sales / purchase ledger inside `ALLINVENTORYENTRIES/ACCOUNTINGALLOCATIONS` is read when the ledger entries do not balance.
- A month that times out is retried once, then named as MISSING in the warnings.

## Checks (scope note item → implementation)

| Tab / scope item | Implementation |
|---|---|
| Trial Balance: TB on a given date | Opening + day book entries up to the date; period-end TB from the file when there is no day book |
| Trial Balance: month over month | Month-end balances and monthly movement per ledger |
| Trial Balance: Day book vs TB (completeness) | Opening + day book debits - credits vs the closing balance from Tally / the TB, per ledger. Shows "N of M ledgers agree", amounts with Dr/Cr and a "What it means" column. Stock-in-hand and Profit & Loss A/c (its closing includes the current year's profit) are left out |
| Dormant Ledgers: Dormant | Nil opening, no debit, no credit, nil closing (owner definition) |
| Dormant Ledgers: Same opening & closing, no transactions | A balance carried all year with no entry, all ledgers; a ledger with no entry whose closing differs from its opening is listed with a note pointing to the day book / TB date |
| Negative ledgers: assets Cr, income Dr, expense Cr, liabilities Dr | By nature from the group chain; month-ends on the wrong side when a day book is loaded |
| Incomplete masters: customers / suppliers without GST number or PAN | Blank or invalid GSTIN (check digit via `src/lib/gstinValidation.ts`), blank / invalid PAN, PAN not matching GSTIN; "not run" when the source has no GSTIN / PAN field |
| Unusual balances: debtors / creditors with opening = closing and no transactions | Party ledgers with an opening balance and no entries |
| Unusual balances: small balances | Balance-sheet ledgers below a limit (default ₹1,000) |
| Unusual balances: creditors with several expense heads | Expense ledgers debited in vouchers that credit the supplier, flagged at 2 or more heads. Shows main head and its share; a round-off check (all round-off entries, largest entry, entries above a per-entry limit, default ₹10) with an "Ignore round off in this check" button (round off is counted by default); filter chips for the expense heads most used with suppliers; Details per creditor |
| Unusual balances: standard deviation of ledgers | Monthly movement vs the ledger's mean (outlier months beyond N SD, CV), with Details per ledger (month table and entries); single entries beyond N SD (z-score) |
| Duplicates | Transactions: exact (date, type, party, amount), near (within N days), same bill reference, repeated voucher number. Ledgers: same normalised name, similar name (party ledgers, ≥ 90%), same GSTIN, same PAN |
| Unusual Entries: round amounts | Voucher amount ≥ ₹10,000 and a multiple of ₹1,000; roundness and cash flag shown |
| Unusual Entries: same amount repeated | One party with the same amount in 3+ vouchers of one type; the same amount on one day to different parties (from ₹5,000); Details per group |
| Unusual Entries: cash over Income-tax limits | Per ledger per day on Cash-in-Hand ledgers: s.40A(3) cash payment > ₹10,000, s.269ST cash receipt ≥ ₹2,00,000, s.269SS / 269T loans or deposits in cash ≥ ₹20,000. Bank transfers and Capital Account excluded; the "person" is the ledger on the other side, so an expense ledger paid to several persons in a day must be split from the vouchers. The ₹35,000 goods-carriage limit and Rule 6DD exceptions are stated, not computed. This is an analysis aid, not a legal determination |
| Unusual Entries: journals on cash / bank / sales / purchase | Voucher types named Journal / Jrnl / JV that post to those ledgers; stock / manufacturing journals not included |
| Day Book Extractor | Day book table; Excel: standard extract, TallyDayBook.exe layout, Day Book Extractor format (`odbcdaybook`, `Ledgers`, `Dormant Ledgers`, `Unchanged Balances`, `Voucher Types`) |

All limits are editable in Settings on the screen (not persisted). Every Summary row opens its check. Details panels export their summary and vouchers to one workbook.

## TallyDayBook.exe (owner's Day Book Extractor v6)

The owner's `TallyDayBook.exe` (PyInstaller, Python) was unpacked and its logic recovered from the bytecode on 13 November 2026; the recovered source was handed to the owner separately and is not in this repository. Taken over: month-by-month fetch with progress, removal of characters illegal in XML, its field fallbacks (`DATE`/`VOUCHERDATE`, `VOUCHERNUMBER`/`VCHNO`, `VOUCHERTYPENAME`/`VCHTYPE`, `PARTYLEDGERNAME`/`PARTYNAME`/`BASICBUYERNAME`, `ALLLEDGERENTRIES`/`LEDGERENTRIES`/`LEDGER.LIST`, `LEDGERNAME`/`NAME`), bill-wise details (`BILLALLOCATIONS.LIST`/`BILL.LIST`), voucher amount, its Excel layout and Summary sheet (as the "TallyDayBook.exe layout" export) and reading its output files.

Corrected rather than copied:
- **Its Day Book report request returns one date per month on TallyPrime.** With `SVCURRENTDATE` set, a month's request returned only that date's vouchers (one test month: 73 vouchers on one date against 508 on 29 dates via the collection; the first owner fetch had about 2,500 of about 19,700 lines). Hence the collection is the default; a report month with a single date is flagged INCOMPLETE.
- A ledger line with several bills: the EXE repeats the line's Dr/Cr on every bill row. Here the amount is kept once; reading an EXE file merges the repeated rows back.
- Item invoices: the EXE misses the sales / purchase ledger inside accounting allocations; it is read here.
- A timed-out month: the EXE skips it silently; here it is retried and named.
- Dr/Cr side: the signed `AMOUNT` decides (the EXE used `ISDEEMEDPOSITIVE`, defaulting to Dr). The TOTAL row counts each voucher's amount once.

## Live verification (owner's test company, 13-14 November 2026)

- With the collection method and non-accounting vouchers left out, every ledger's opening + day book movement agreed with Tally's closing balance (767 of 767 checked; Profit & Loss A/c excluded as above).
- Counts on that company, for orientation only: 261 dormant and 89 unchanged-balance ledgers; 401 round-amount vouchers; 181 repeated-amount groups; 3 cash-limit cases; 118 journals on cash / bank / sales / purchase; round off used in 440 entries, 2 above ₹10.
- Branch `ledger-analysis` was re-verified in V2 against the same Tally on 14 November 2026 (same line count).

## Tally Tools removed

At the owner's request (13 November 2026, confirmed 14 November 2026 for this branch) the VERA Tools "Tally Tools" tab was removed and Ledger Analysis became the first and default tab and the one place that fetches Tally data. Deleted: the `TallyTools` component, its `ConnectionMode` type and three exported Tally line types in `src/pages/AuditTools.tsx`, and the hooks `src/hooks/useTallyODBC.ts` and `src/hooks/useOpeningBalanceMatching.ts` (no other user; `TallyContext` keeps its own types and stays). Its cards were: Get Trial Balance from Tally (and its Excel export), Get Month wise Data, GST Number Not Feeded, Negative Ledgers, Opening Balance Matching, No Transactions Ledgers, Daybook Export and the ODBC / Excel Import connection panel.

- Covered by Ledger Analysis: trial balance, month-wise data, negative ledgers, no-transaction (dormant) ledgers, GSTIN checks, day book export.
- **Opening Balance Matching (old vs new Tally, XML for import) has no replacement.** The owner accepted this loss.
- The ODBC IPC handlers in `electron/main.cjs` / `electron/preload.cjs` were left in place and now have no caller in the renderer; removing them is a separate decision.
- The deleted code is in git history (`main` at `b835def`).

## Known limits / open points

- The Tally field names (`LEDGSTREGDETAILS`, `IncomeTaxNumber`) and the TDL collection were confirmed on one TallyPrime release only; ERP 9 is untested.
- A condensed Tally Day Book Excel (one row per voucher) cannot be analysed; the screen warns when vouchers do not balance.
- The VERA TB export carries only the immediate group; for user-created groups the nature falls back to its Category column, which can be wrong for some P&L ledgers.
- Busy and Zoho were exercised only through the existing FSG parsers; no real Busy / Zoho day book file was available.
- Journals are recognised by voucher-type name; cash ledgers by the Cash-in-Hand group.
- Results are not saved as working papers or linked to Review Notes / Misstatements; that needs an owner decision.
- After a fetch the results take a few seconds to draw; a second click on Fetch starts a new fetch (seen once in owner testing).
- CAAT Tools (F-029) has some overlapping analytics (for example duplicate checks); which tool is canonical is an owner decision.
