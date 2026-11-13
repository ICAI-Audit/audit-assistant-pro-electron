# T-024: Known-ALIE Level 1 fallback categories

## Request, scope and approval

On 10 November 2026 the user explicitly requested incorporation of the five missing Level 1 categories into Mapping_v2.xlsx and other relevant Financial Statement Review paths, and asked whether this guarantees every Balance Sheet matches. The user restricted application changes to Financial Statement Review. Features: F-007 and F-009. Branch/source: `RSF` at `d86bd93`, with earlier T-023 work preserved separately. No other module is changed by T-024.

## Workbook and classification contract

The LevelFormat sheet adds precisely these terminal rows; Levels 2-7 are blank:

| Constitution | ALIE | Level 1 |
| --- | --- | --- |
| 3 | EQUITY AND LIABILITIES | Uncategorised Equity and Liabilities |
| 3 | Income | Uncategorised Income |
| 3 | Expenses | Uncategorised Expenses |
| 1 | EQUITY AND LIABILITIES | Uncategorised Equity and Liabilities |
| 1 | Expenses | Uncategorised Expenses |

LevelFormat grows from 679 to 684 data rows. Its original 679 rows and the Map1/Map2/Map3 sheet data (273/239/313 rows) are unchanged. The original workbook styles, existing worksheet XML and other ZIP parts are preserved except for the appended LevelFormat rows and its expanded dimension/filter/named range.

When ALIE is known but no Map1 hierarchy matches, the engine selects the constitution's terminal fallback master caption/id. It leaves mapping2_resultant and mapping3_resultant NULL and retains `auto_low`/low confidence. No amounts, signs or adjustments are changed. Unknown ALIE remains `unmapped`/none; it is not guessed. Existing abnormal-balance/contra rules remain in effect and may reclassify a balance as before while retaining its source sign. BS screen and common BS export layout now use the canonical Equity and Liabilities fallback wording.

Fallback is unresolved classification, not professional approval. Existing summary status-count semantics remain unchanged; no Dashboard/report module changes are made.

## Existing databases and recovery

`electron/fsg/db/level1-fallbacks.js` adds only missing terminal master rows to existing rule sets that already support the relevant constitution. It does not update stored TBs, existing mapped rows, manual overrides, notes, years or finalised records. Existing mapped fallbacks can acquire the new master link on a subsequent authorised remap; they are not remapped automatically on startup.

For the exact original bundled workbook hash (`a4745f...c993b6`) to the exact T-024 workbook hash (`1c765a...a7862`), `seedDefaultMapping` uses an additive upgrade instead of clearing/reseeding the existing rules. The five additions and the new seed marker commit together. Existing level_format IDs and Map1/2/3 rules are preserved. Other workbook revisions retain the previous refresh behavior; safety for arbitrary custom workbook replacements is not established by this task.

File-database changes are preceded by `VACUUM INTO` backup under `<userData>/fsg/backups/audit_assistant-before-T024-level1-fallbacks-<timestamp>.db`. The additions use a transaction; interruption leaves neither partial rows nor a completed seed marker. Repeated startup skips already-present rows. Synthetic checks restore the old backup and retry the upgrade. This database snapshot is not a complete evidence/localStorage backup. No real installed profile was upgraded in this task.

## Reconciliation limits: no universal guarantee

The additions ensure that the tested known-ALIE/no-Level-1 ledgers reach explicit fallback categories. They cannot guarantee that every Balance Sheet balances, or that a balanced statement is correctly classified. Source TB imbalance, missing/duplicated records, incomplete mapping, stock/adjustment treatment, comparative choices and equity/profit transfer remain relevant.

The synthetic company case with all four ALIE categories unresolved reconciles a balanced TB, including its P&L contribution. A one-unit source imbalance remains visible; no balancing plug is added. Profit/loss, zero rows and recognised contra balances are covered. Actual PDF text and reopened Excel retain the tested fallback captions and figures.

**Observed limitation retained (GAP-18):** for constitutions 1 and 2, when every equity-side ledger is unresolved and no classified owners'/partners' equity heading exists, the current profit-transfer logic has no target. A balanced synthetic TB (assets 130,000, E&L 100,000, income 60,000, expenses 30,000) therefore shows a 30,000 BS difference. With a properly classified equity heading, otherwise equivalent fallback fixtures reconcile. This existing rule was not changed to make the test pass. The owner must review classification/profit-transfer requirements before a separate financial-rule change.

## Validation and acceptance

The FSG integration suite now calls `scripts/fsg-fallback-checks.mjs`: workbook integrity, exact additions, fresh seeding, additive upgrade, interruption/rollback, backups/restoration/retry, ID and override preservation, three constitutions, known/unknown ALIE, terminal fields, profit/loss, source imbalance, zero/contra balances, HTML/PDF source, actual PDF text and reopened Excel figures. The UI suite adds company/partnership fallback screens and restart persistence.

Results are recorded in [current status](CURRENT_STATUS.md) and [latest handoff](SESSION_HANDOFF.md). Owner UAT, arbitrary-client data, original FSG_Bharat parity, real-profile upgrade and comprehensive PDF pagination remain unverified. No guarantee or professional acceptance is inferred from passing synthetic tests.
