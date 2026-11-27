# Financial Statement Review: typography, spacing and layout audit (T-088)

**Status: Step 1 only. Nothing has been changed in the application.** This is the audit and the proposal; implementation waits for approval of the decisions in section 7.

Generated from the working tree on 26 November 2026 by a session-only scanner (not part of the repository yet; it becomes `scripts/audit-fsr-typography.cjs` after approval, and is what Step 7 and Step 8 re-run). Counts are exact for what the scanner matches; see "Method and limits".

## 1. Scope, method and limits

- **Scanned:** 85 presentation files: every file under `src/modules/fsg/components`, `src/modules/fsg/App.jsx`, `ErrorBoundary.jsx`, `fsg.css`, `fsr-theme.css`, the page wrapper `src/pages/FinancialStatementReview.tsx`, and the shared shell `src/components/layout/{AppSidebar,Header,MainLayout,BuildInfoLabel}.tsx` (the sidebar and top bar are shared by every VERA module).
- **State of the tree:** the scan ran on the working tree including the uncommitted T-088 theme layer (`fsr-theme.css`) and shell edits made earlier the same day, so those files are counted as they now are. The scanner and this report are generated; the figures are the "before" for the token work, not for the original design.
- **Not scanned, by design:** `GenerateFinancials/{buildHTML,buildExcel,fillDetailsWorkbook}.js` and the `.print-view` / `@media print` blocks of `fsg.css`. They produce the PDF and Excel output (Times New Roman, pt and mm units). Changing them changes exports, which is outside a UI-only change; the future lint rule must exempt them.
- **Matched:** Tailwind utility classes (including arbitrary values such as `text-[10px]`, `w-[420px]`), React inline style objects, CSS declarations, AG Grid size props, viewport units, and `position`. **Not matched:** values computed at run time (`style={{ width: x }}`), counted separately as "(computed)"; values set by third-party CSS (AG Grid, TipTap) except through the overrides in `fsg.css`.
- A "use" is one occurrence in source, not one rendered element: a class inside a `.map()` renders many times.

## 2. Summary (the "before" numbers for Step 8)

| What | Distinct values | Total uses |
| --- | ---: | ---: |
| Font families (Tailwind `font-*`, CSS, inline) | 4 | 380 |
| Font sizes, Tailwind classes | 13 | 1684 |
| Font sizes, CSS declarations | 9 | 15 |
| Font sizes, inline styles | 4 | 12 |
| Font weights (all sources) | 10 | 933 |
| Line heights (all sources) | 9 | 34 |
| Letter spacings (all sources) | 3 | 41 |
| Spacing, Tailwind classes (padding, margin, gap, space-x/y) | 129 | 4708 |
| Spacing, inline styles and CSS declarations | 44 | 61 |
| Fixed widths/heights, arbitrary (`w-[420px]`, `w-[11%]`) | 45 | 97 |
| Fixed widths/heights, Tailwind scale (`w-56`, `h-8`) | 43 | 233 |
| Fixed max widths, named (`max-w-md` ...) | 12 | 56 |
| Inline pixel/percent widths and heights (`width: 180`) | 89 | 234 |
| Viewport units (`vh`, `vw`, `h-screen`) | 34 | 62 |
| `fixed` / `absolute` / `sticky` positions | 3 | 79 |
| AG Grid height props (`rowHeight`, `headerHeight`) | 7 | 12 |

The weight row counts notations (`font-semibold` and `font-weight: 600` are two values); normalised there are **4 weights** (400, 500, 600, 700). The viewport-unit row counts each value in both its class and numeric notation.

Normalised, the module draws text in **12 distinct pixel sizes** today (9, 10, 11, 11.5, 12, 13, 14, 16, 18, 20, 30, 36) across Tailwind, CSS and inline styles, plus the export-only point sizes that are out of scope.

## 3. Key findings

1. **Typeface is already almost uniform.** Every screen resolves to Inter. `font-mono` appears 376 times in source but `fsg.css` already forces it to Inter with tabular numerals on screen, so elements using it render Inter (code and pre elements, which the shared stylesheet sets to JetBrains Mono, are not used in these screens as far as the scan shows). The only other families are the print preview (`fsg.css` `.print-view`, Times New Roman, export-only) and one `sans-serif` in `ErrorBoundary.jsx`. Form controls already inherit the font (Tailwind preflight `font-family: inherit`).
2. **There is no root font-size anywhere.** `index.html` and `src/index.css` never set `html { font-size }`, so everything that is rem-based (all Tailwind spacing, `text-xs`/`text-sm`, `h-8`) sits on the browser default 16px. That makes the requested root-size scaling feasible, but it is app-wide (decision D1).
3. **Text is sized by a mix of rem and raw px.** text-xs and text-sm (rem) account for 1304 uses, but **291 Tailwind uses are raw px** (text-[10px] 164, text-[11px] 104, text-[13px] 14, text-[9px] 7, plus two in TopBar.jsx) and 12 inline fontSize values. Raw px does not scale with a root change, so these are the work.
4. **Spacing is rem-based but off the requested scale.** Of the Tailwind spacing uses, 3671 (79%) sit exactly on the 4/8/12/16/20/24px scale; **939 (20%) use half steps** (2px, 6px, 10px, 14px: `py-1.5` alone is 461 uses and `py-0.5` 239); 52 are larger than 24px and 0 are arbitrary brackets. Dense screens depend on the 6px step (decision D3).
5. **Weights are consistent in kind:** four weights (`normal` 21, `medium` 252, `semibold` 420, `bold` 215) plus CSS 600/bold/500. The requested scale (400/500/600/700) matches; the work is limiting 700 to titles and totals, since `font-bold` is used 215 times on far more than that.
6. **Layout is the larger risk.** 16 viewport-unit sizes in Tailwind classes plus 15 in inline styles (97vw, 94vh, 92vh ...), 15 fixed pixel widths and heights in classes (w-[420px], w-[480px], w-[700px] popups), 150 pixel-sized inline widths and heights (AG Grid columns width: 180/130/200/120), minWidth: 1300 on two tables, maxWidth: 1320px x8 in Inventory, and 82 percentage w-[..%] column widths on forms. None of this adapts to the root size.
7. **AG Grid sizes are JavaScript numbers, not CSS** (`rowHeight=28/30/38`, `headerHeight=36/52`, `floatingFiltersHeight=30/32`). rem-based density cannot reach them through CSS alone (decision D6).
8. **The app-wide stylesheet fights the module.** `src/index.css` forces every `table`, `th`, `td` to 11px with `!important` px padding and `nowrap`. The module already works around it case by case (`.fsg-dated-heading`, `.fsg-wrap`, the statement tables). A uniform scale needs one scoped override inside `.fsg-root`, not a change to the shared file (decision D2).
9. **Existing tests assert pixel sizes.** `test-fsg-ui.cjs` checks toolbar buttons `height <= 32`, groups `height <= 36`, toolbar `height < 48`, and that the menu bar fits at 1280px. The harness window is 1400px wide, which lands in the 16px-root band, so 2rem = 32px passes exactly at the limit (risk R1).
10. **The Electron window minimum is 1024px** (`electron/main.cjs`, protected, not editable here). The brief names 1280 as the minimum supported size; 1024-1279 will be designed to degrade gracefully, not to be fully dense.

## 4. Findings by category

### 4.1 Font family
| Source | Value | Uses | Where |
| --- | --- | ---: | --- |
| Tailwind class | `font-mono` | 376 | Notes/index.jsx ×115; DepreciationIT/index.jsx ×41; Annexures/index.jsx ×33 (+31 files) |
| CSS | `font-family: 'Inter', 'Segoe UI', system-ui, sans-serif` | 2 | fsg/fsg.css ×2 |
| CSS | `font-family: 'Times New Roman', Georgia, serif` | 1 | fsg/fsg.css ×1 |
| inline style | `fontFamily: sans-serif` | 1 | fsg/ErrorBoundary.jsx ×1 |

### 4.2 Font size, with proposed token
Tailwind classes (px equivalents: `xs`=12, `sm`=14, `base`=16, `lg`=18, `xl`=20, `2xl`=24, `3xl`=30, `4xl`=36):

| Class | Uses | Files | Where (top files) | Proposed |
| --- | ---: | ---: | --- | --- |
| `text-xs` | 911 | 77 | shared/MastersModal.jsx ×47; Exceptions/index.jsx ×45; BS/index.jsx ×43 (+74 files) | `--text-sm` (exact) |
| `text-sm` | 393 | 63 | TrialBalance/UploadTB.jsx ×39; GenerateFinancials/index.jsx ×33; shared/MastersModal.jsx ×23 (+60 files) | `--text-md` (exact) |
| `text-[10px]` | 164 | 41 | Notes/index.jsx ×18; Exceptions/index.jsx ×17; Notes/LongTermBorrowingsForm.jsx ×16 (+38 files) | `--text-xs` (11.5px): enlarges +1.5px |
| `text-[11px]` | 104 | 33 | Notes/index.jsx ×19; TrialBalance/UploadTB.jsx ×13; GeneralNotes/index.jsx ×7 (+30 files) | `--text-xs` (11.5px): enlarges +0.5px |
| `text-base` | 42 | 29 | TrialBalance/UploadTB.jsx ×7; GenerateFinancials/index.jsx ×3; Annexures/index.jsx ×2 (+26 files) | **no 16px token**: `--text-md` (14px) or `--text-lg` (18px)? decision D4 |
| `text-xl` | 28 | 23 | TrialBalance/UploadTB.jsx ×5; Notes/index.jsx ×2; MappedTB/BulkOverrideModal.jsx ×1 (+20 files) | `--text-xl` (exact) |
| `text-lg` | 16 | 16 | BranchMaster/index.jsx ×1; BS/index.jsx ×1; CFS/index.jsx ×1 (+13 files) | `--text-lg` (exact) |
| `text-[13px]` | 14 | 4 | DeferredTax/index.jsx ×6; TaxComputation/index.jsx ×5; layout/AppSidebar.tsx ×2 (+1 files) | `--text-base` (exact) |
| `text-[9px]` | 7 | 5 | Notes/ShareCapitalForm.jsx ×2; Stock/StockPage.jsx ×2; Annexures/index.jsx ×1 (+2 files) | `--text-xs` (11.5px): enlarges +2.5px |
| `text-3xl` | 2 | 1 | GenerateFinancials/index.jsx ×2 | **above the scale**: icon/emoji size via `--icon-*`, decision D4 |
| `text-[11.5px]` | 1 | 1 | Layout/TopBar.jsx ×1 | `--text-xs` (11.5px): enlarges none |
| `text-[18px]` | 1 | 1 | Layout/TopBar.jsx ×1 | `--text-lg` (exact) |
| `text-4xl` | 1 | 1 | MappedTB/BulkOverrideModal.jsx ×1 | **above the scale**: icon/emoji size via `--icon-*`, decision D4 |

CSS declarations (`fsg.css`, `fsr-theme.css`). The `pt` values belong to the export preview and are out of scope:

| Declaration | Uses | Files | Where (top files) |
| --- | ---: | ---: | --- |
| `font-size: 12px` | 6 | 2 | fsg/fsg.css ×3; fsg/fsr-theme.css ×3 |
| `font-size: 13px` | 2 | 1 | fsg/fsg.css ×2 |
| `font-size: 10pt` | 1 | 1 | fsg/fsg.css ×1 |
| `font-size: 14pt` | 1 | 1 | fsg/fsg.css ×1 |
| `font-size: 12pt` | 1 | 1 | fsg/fsg.css ×1 |
| `font-size: 9pt` | 1 | 1 | fsg/fsg.css ×1 |
| `font-size: 8pt` | 1 | 1 | fsg/fsg.css ×1 |
| `font-size: 10px` | 1 | 1 | fsg/fsg.css ×1 |
| `font-size: 11.5px` | 1 | 1 | fsg/fsr-theme.css ×1 |

Inline styles:

| Style | Uses | Files | Where (top files) |
| --- | ---: | ---: | --- |
| `fontSize: 11px` | 8 | 2 | MappedTBWithRemarks/index.jsx ×5; MappedTB/index.jsx ×3 |
| `fontSize: 13px` | 2 | 1 | fsg/ErrorBoundary.jsx ×2 |
| `fontSize: 18px` | 1 | 1 | fsg/ErrorBoundary.jsx ×1 |
| `fontSize: 12px` | 1 | 1 | fsg/ErrorBoundary.jsx ×1 |

### 4.3 Font weight
| Class | Uses | Files | Where (top files) |
| --- | ---: | ---: | --- |
| `font-semibold` | 420 | 64 | Notes/index.jsx ×49; Annexures/index.jsx ×36; TrialBalance/UploadTB.jsx ×23 (+61 files) |
| `font-medium` | 252 | 61 | Notes/index.jsx ×25; TrialBalance/UploadTB.jsx ×24; MappedTB/index.jsx ×15 (+58 files) |
| `font-bold` | 215 | 52 | Notes/index.jsx ×25; Annexures/index.jsx ×20; BS/index.jsx ×19 (+49 files) |
| `font-normal` | 21 | 12 | Notes/index.jsx ×5; TrialBalance/UploadTB.jsx ×3; CFS/index.jsx ×2 (+9 files) |

| CSS declaration | Uses | Files | Where (top files) |
| --- | ---: | ---: | --- |
| `font-weight: 600` | 7 | 2 | fsg/fsg.css ×5; fsg/fsr-theme.css ×2 |
| `font-weight: bold` | 5 | 1 | fsg/fsg.css ×5 |
| `font-weight: 500` | 1 | 1 | fsg/fsr-theme.css ×1 |

| Inline style | Uses | Files | Where (top files) |
| --- | ---: | ---: | --- |
| `fontWeight: 500` | 10 | 2 | MappedTB/index.jsx ×6; MappedTBWithRemarks/index.jsx ×4 |
| `fontWeight: 600` | 1 | 1 | MappedTB/index.jsx ×1 |
| `fontWeight: bold` | 1 | 1 | fsg/ErrorBoundary.jsx ×1 |

### 4.4 Line height and letter spacing
| Class | Uses | Files | Where (top files) |
| --- | ---: | ---: | --- |
| `leading-relaxed` | 12 | 4 | TrialBalance/UploadTB.jsx ×6; Notes/index.jsx ×4; CFS/index.jsx ×1 (+1 files) |
| `leading-none` | 8 | 8 | Master/AuditeeFormModal.jsx ×1; Master/AuditeeReadModal.jsx ×1; Master/AuditorManageModal.jsx ×1 (+5 files) |
| `leading-tight` | 5 | 3 | Layout/TopBar.jsx ×2; layout/AppSidebar.tsx ×2; layout/Header.tsx ×1 |
| `leading-snug` | 3 | 3 | DeferredTax/index.jsx ×1; TaxComputation/index.jsx ×1; layout/BuildInfoLabel.tsx ×1 |
| `leading-5` | 1 | 1 | Notes/index.jsx ×1 |

| CSS declaration | Uses | Files | Where (top files) |
| --- | ---: | ---: | --- |
| `line-height: 1.35` | 2 | 1 | fsg/fsg.css ×2 |
| `line-height: 1.6` | 1 | 1 | fsg/fsg.css ×1 |
| `line-height: 1` | 1 | 1 | fsg/fsg.css ×1 |
| `line-height: 18px` | 1 | 1 | fsg/fsr-theme.css ×1 |

| Class | Uses | Files | Where (top files) |
| --- | ---: | ---: | --- |
| `tracking-wide` | 31 | 16 | BS/index.jsx ×6; Annexures/index.jsx ×5; CFS/index.jsx ×3 (+13 files) |
| `tracking-wider` | 9 | 5 | BS/index.jsx ×4; layout/AppSidebar.tsx ×2; DeferredTax/index.jsx ×1 (+2 files) |

| CSS declaration | Uses | Files | Where (top files) |
| --- | ---: | ---: | --- |
| `letter-spacing: 0.04em` | 1 | 1 | fsg/fsg.css ×1 |

### 4.5 Border radius
| Class | Uses | Files | Where (top files) |
| --- | ---: | ---: | --- |
| `rounded-lg` | 68 | 35 | GenerateFinancials/index.jsx ×7; Master/index.jsx ×5; Notes/index.jsx ×4 (+32 files) |
| `rounded-full` | 31 | 16 | TrialBalance/UploadTB.jsx ×6; MappedTB/ConflictModal.jsx ×3; shared/BranchModeBar.jsx ×3 (+13 files) |
| `rounded-xl` | 19 | 7 | TrialBalance/UploadTB.jsx ×6; Master/index.jsx ×4; TrialBalance/ActualTBTable.jsx ×3 (+4 files) |
| `rounded-md` | 7 | 7 | BS/index.jsx ×1; ITR/ITRDetailsTable.jsx ×1; ITR/ITRSectionTable.jsx ×1 (+4 files) |
| `rounded-t` | 2 | 2 | MappingRules/index.jsx ×1; Notes/TradePayablesDisclosureForm.jsx ×1 |
| `rounded-r` | 1 | 1 | layout/AppSidebar.tsx ×1 |

(`rounded` with no suffix is also used throughout; the scanner counts suffixed forms only.)

### 4.6 Spacing: Tailwind classes (padding, margin, gap, space-x/y)
Summary: **4662 uses**: 3671 on the 4/8/12/16/20/24px scale, 939 on half steps, 52 above 24px, 0 arbitrary. Full table:

| Class | Uses | Files | Where (top files) | Proposed |
| --- | ---: | ---: | --- | --- |
| `py-1` | 592 | 60 | Notes/index.jsx ×122; Notes/OwnersCapitalAccountForm.jsx ×68; DepreciationIT/index.jsx ×57 (+57 files) | `--space-1` (exact) |
| `px-2` | 581 | 52 | DepreciationIT/index.jsx ×86; Notes/OwnersCapitalAccountForm.jsx ×65; Notes/ShareCapitalForm.jsx ×39 (+49 files) | `--space-2` (exact) |
| `py-1.5` | 461 | 58 | Notes/index.jsx ×68; DepreciationIT/index.jsx ×51; CFS/index.jsx ×21 (+55 files) | half step `--space-1-5` (6px): decision D3 |
| `px-3` | 449 | 55 | Notes/index.jsx ×123; shared/MastersModal.jsx ×41; Annexures/index.jsx ×37 (+52 files) | `--space-3` (exact) |
| `py-0.5` | 239 | 35 | Notes/OwnersCapitalAccountForm.jsx ×45; Annexures/index.jsx ×30; Exceptions/index.jsx ×23 (+32 files) | half step `--space-0-5` (2px): decision D3 |
| `py-2` | 228 | 54 | shared/MastersModal.jsx ×33; TrialBalance/UploadTB.jsx ×20; BS/index.jsx ×13 (+51 files) | `--space-2` (exact) |
| `gap-2` | 177 | 59 | TrialBalance/UploadTB.jsx ×15; GenerateFinancials/index.jsx ×14; Notes/index.jsx ×13 (+56 files) | `--space-2` (exact) |
| `px-1` | 139 | 26 | Notes/OwnersCapitalAccountForm.jsx ×50; Exceptions/index.jsx ×17; Notes/ShareCapitalForm.jsx ×15 (+23 files) | `--space-1` (exact) |
| `px-4` | 113 | 40 | Notes/index.jsx ×35; Annexures/index.jsx ×8; Exceptions/index.jsx ×5 (+37 files) | `--space-4` (exact) |
| `mb-1` | 110 | 28 | shared/MastersModal.jsx ×16; TallyTBUpload/index.jsx ×11; TrialBalance/UploadTB.jsx ×10 (+25 files) | `--space-1` (exact) |
| `mb-4` | 92 | 36 | Stock/StockPage.jsx ×8; Notes/index.jsx ×7; TrialBalance/UploadTB.jsx ×7 (+33 files) | `--space-4` (exact) |
| `mb-3` | 89 | 30 | shared/MastersModal.jsx ×11; GenerateFinancials/index.jsx ×8; Notes/index.jsx ×7 (+27 files) | `--space-3` (exact) |
| `mb-2` | 78 | 29 | Notes/LongTermBorrowingsForm.jsx ×12; Notes/ShortTermBorrowingsForm.jsx ×11; Master/AuditeeFormModal.jsx ×7 (+26 files) | `--space-2` (exact) |
| `gap-3` | 75 | 36 | GenerateFinancials/index.jsx ×7; MappedTB/index.jsx ×4; MappedTB/OverrideModal.jsx ×4 (+33 files) | `--space-3` (exact) |
| `pr-2` | 70 | 9 | BS/index.jsx ×16; CFS/index.jsx ×13; PL/index.jsx ×11 (+6 files) | `--space-2` (exact) |
| `mt-1` | 56 | 30 | TrialBalance/UploadTB.jsx ×8; GenerateFinancials/index.jsx ×5; TrialBalance/VersionCarryModal.jsx ×4 (+27 files) | `--space-1` (exact) |
| `px-1.5` | 55 | 24 | DepreciationIT/index.jsx ×12; Notes/index.jsx ×8; DepreciationComp/index.jsx ×5 (+21 files) | half step `--space-1-5` (6px): decision D3 |
| `mt-2` | 52 | 26 | TrialBalance/UploadTB.jsx ×6; Notes/index.jsx ×4; Notes/LongTermBorrowingsForm.jsx ×4 (+23 files) | `--space-2` (exact) |
| `p-3` | 46 | 23 | TrialBalance/UploadTB.jsx ×5; Notes/InvestmentsForm.jsx ×4; Notes/TradePayablesDisclosureForm.jsx ×4 (+20 files) | `--space-3` (exact) |
| `mt-0.5` | 44 | 26 | TallyTBUpload/index.jsx ×4; CFS/index.jsx ×3; MappedTB/ConflictModal.jsx ×3 (+23 files) | half step `--space-0-5` (2px): decision D3 |
| `p-4` | 44 | 26 | TrialBalance/UploadTB.jsx ×7; TallyTBUpload/index.jsx ×5; Format/index.jsx ×4 (+23 files) | `--space-4` (exact) |
| `gap-1` | 39 | 25 | shared/BranchModeBar.jsx ×6; CFS/index.jsx ×4; Exceptions/index.jsx ×3 (+22 files) | `--space-1` (exact) |
| `py-3` | 33 | 21 | Notes/index.jsx ×3; GenerateFinancials/index.jsx ×2; MappedTB/ConflictModal.jsx ×2 (+18 files) | `--space-3` (exact) |
| `gap-1.5` | 33 | 19 | MappedTB/index.jsx ×6; CFS/index.jsx ×3; TrialBalance/UploadTB.jsx ×3 (+16 files) | half step `--space-1-5` (6px): decision D3 |
| `ml-auto` | 32 | 26 | MappedTB/index.jsx ×4; CFS/index.jsx ×2; Exceptions/index.jsx ×2 (+23 files) | unchanged (auto) |
| `mt-3` | 32 | 23 | MappedTB/OverrideModal.jsx ×4; shared/MastersModal.jsx ×3; TallyTBUpload/index.jsx ×3 (+20 files) | `--space-3` (exact) |
| `ml-2` | 31 | 14 | Exceptions/index.jsx ×6; TrialBalance/UploadTB.jsx ×6; BS/index.jsx ×3 (+11 files) | `--space-2` (exact) |
| `pr-3` | 31 | 3 | Notes/index.jsx ×23; DeferredTax/index.jsx ×4; TaxComputation/index.jsx ×4 | `--space-3` (exact) |
| `p-1` | 29 | 2 | Ratio/Form3CD.jsx ×22; Notes/InvestmentsForm.jsx ×7 | `--space-1` (exact) |
| `ml-1` | 28 | 15 | Notes/index.jsx ×9; BS/index.jsx ×3; Notes/ShareCapitalForm.jsx ×2 (+12 files) | `--space-1` (exact) |
| `px-5` | 28 | 13 | Notes/index.jsx ×5; DepreciationIT/index.jsx ×4; TallyTBUpload/index.jsx ×4 (+10 files) | `--space-5` (exact) |
| `mb-0.5` | 26 | 11 | Master/AuditorManageModal.jsx ×7; Exceptions/index.jsx ×6; Master/SignatoryManageModal.jsx ×3 (+8 files) | half step `--space-0-5` (2px): decision D3 |
| `mt-4` | 25 | 20 | TrialBalance/UploadTB.jsx ×4; Notes/index.jsx ×2; TallyTBUpload/index.jsx ×2 (+17 files) | `--space-4` (exact) |
| `px-6` | 23 | 14 | Notes/TradePayablesDisclosureForm.jsx ×3; TrialBalance/UploadTB.jsx ×3; Notes/CashBankDetailsForm.jsx ×2 (+11 files) | `--space-6` (exact) |
| `p-5` | 22 | 15 | GenerateFinancials/index.jsx ×4; Master/index.jsx ×4; Notes/index.jsx ×2 (+12 files) | `--space-5` (exact) |
| `gap-4` | 22 | 13 | GenerateFinancials/index.jsx ×8; MappingRules/MapSheetView.jsx ×2; TallyTBUpload/index.jsx ×2 (+10 files) | `--space-4` (exact) |
| `p-6` | 21 | 17 | BranchMaster/index.jsx ×2; Notes/CashBankDetailsForm.jsx ×2; Notes/InvestmentsForm.jsx ×2 (+14 files) | `--space-6` (exact) |
| `pl-6` | 19 | 6 | CFS/index.jsx ×8; Annexures/index.jsx ×4; Notes/TradePayablesDisclosureForm.jsx ×3 (+3 files) | `--space-6` (exact) |
| `p-2` | 18 | 10 | Ratio/Form3CD.jsx ×6; TrialBalance/UploadTB.jsx ×3; Notes/ShareCapitalForm.jsx ×2 (+7 files) | `--space-2` (exact) |
| `px-2.5` | 17 | 15 | GeneralNotes/index.jsx ×2; layout/AppSidebar.tsx ×2; ExceptionReport/index.jsx ×1 (+12 files) | half step `--space-2-5` (10px): decision D3 |
| `space-y-0.5` | 16 | 8 | GenerateFinancials/index.jsx ×6; TallyTBUpload/index.jsx ×2; TrialBalance/SimpleTbUploadModal.jsx ×2 (+5 files) | half step `--space-0-5` (2px): decision D3 |
| `pl-2` | 13 | 4 | Annexures/index.jsx ×5; CFS/index.jsx ×4; Ratio/Form3CD.jsx ×2 (+1 files) | `--space-2` (exact) |
| `space-y-3` | 13 | 7 | TrialBalance/UploadTB.jsx ×4; Notes/InvestmentsForm.jsx ×3; Notes/index.jsx ×2 (+4 files) | `--space-3` (exact) |
| `pt-3` | 13 | 9 | GenerateFinancials/index.jsx ×4; Master/AuditeeFormModal.jsx ×2; Master/AuditeeReadModal.jsx ×1 (+6 files) | `--space-3` (exact) |
| `pb-3` | 12 | 12 | Annexures/index.jsx ×1; BS/index.jsx ×1; CFS/index.jsx ×1 (+9 files) | `--space-3` (exact) |
| `pl-4` | 12 | 4 | Notes/index.jsx ×5; GenerateFinancials/index.jsx ×4; Ratio/AnalyticalRatios.jsx ×2 (+1 files) | `--space-4` (exact) |
| `px-8` | 10 | 10 | Annexures/index.jsx ×1; BS/index.jsx ×1; CFS/index.jsx ×1 (+7 files) | **above the scale** (32px): decision D3 |
| `mr-1` | 10 | 7 | CFS/index.jsx ×2; GeneralNotes/index.jsx ×2; shared/BranchModeBar.jsx ×2 (+4 files) | `--space-1` (exact) |
| `mt-6` | 10 | 3 | Notes/index.jsx ×8; CFS/index.jsx ×1; Notes/InvestmentsForm.jsx ×1 | `--space-6` (exact) |
| `space-y-1` | 10 | 7 | layout/AppSidebar.tsx ×4; CFS/index.jsx ×1; MappedTB/DiscrepancyModal.jsx ×1 (+4 files) | `--space-1` (exact) |
| `ml-3` | 10 | 7 | Exceptions/index.jsx ×3; MappingRules/MapSheetView.jsx ×2; Notes/LongTermBorrowingsForm.jsx ×1 (+4 files) | `--space-3` (exact) |
| `pt-6` | 10 | 3 | Notes/index.jsx ×8; Notes/InvestmentsForm.jsx ×1; TrialBalance/UploadTB.jsx ×1 | `--space-6` (exact) |
| `pb-4` | 10 | 3 | Notes/index.jsx ×8; Notes/InvestmentsForm.jsx ×1; TrialBalance/UploadTB.jsx ×1 | `--space-4` (exact) |
| `py-2.5` | 9 | 7 | Notes/index.jsx ×3; DeferredTax/index.jsx ×1; Master/AuditorManageModal.jsx ×1 (+4 files) | half step `--space-2-5` (10px): decision D3 |
| `mr-2` | 9 | 5 | layout/Header.tsx ×4; MappedTB/index.jsx ×2; shared/BranchModeBar.jsx ×1 (+2 files) | `--space-2` (exact) |
| `py-8` | 9 | 7 | shared/MastersModal.jsx ×3; Notes/DirectorLoansForm.jsx ×1; Notes/LongTermBorrowingsForm.jsx ×1 (+4 files) | **above the scale** (32px): decision D3 |
| `pl-10` | 9 | 3 | PL/index.jsx ×6; Notes/index.jsx ×2; layout/Header.tsx ×1 | **above the scale** (40px): decision D3 |
| `mb-6` | 8 | 5 | Notes/index.jsx ×3; Notes/CashBankDetailsForm.jsx ×2; Annexures/index.jsx ×1 (+2 files) | `--space-6` (exact) |
| `pb-1` | 8 | 5 | BS/index.jsx ×4; GenerateFinancials/index.jsx ×1; Layout/FinancialYearBadge.jsx ×1 (+2 files) | `--space-1` (exact) |
| `mx-auto` | 8 | 5 | CFS/index.jsx ×4; DeferredTax/index.jsx ×1; Master/index.jsx ×1 (+2 files) | unchanged (auto) |
| `space-y-4` | 8 | 5 | Notes/InvestmentsForm.jsx ×4; DepreciationIT/index.jsx ×1; Notes/LongTermBorrowingsForm.jsx ×1 (+2 files) | `--space-4` (exact) |
| `py-6` | 8 | 4 | Master/AuditorManageModal.jsx ×3; Master/SignatoryManageModal.jsx ×3; ExceptionReport/index.jsx ×1 (+1 files) | `--space-6` (exact) |
| `pt-4` | 7 | 5 | Annexures/index.jsx ×2; shared/SettingsModal.jsx ×2; Notes/InvestmentsForm.jsx ×1 (+2 files) | `--space-4` (exact) |
| `mb-5` | 7 | 7 | BS/index.jsx ×1; MappedTB/BulkOverrideModal.jsx ×1; Master/AuditeeReadModal.jsx ×1 (+4 files) | `--space-5` (exact) |
| `py-4` | 7 | 5 | Exceptions/index.jsx ×2; MappedTB/BulkOverrideModal.jsx ×2; GeneralNotes/index.jsx ×1 (+2 files) | `--space-4` (exact) |
| `pl-5` | 7 | 4 | Notes/index.jsx ×3; GenerateFinancials/index.jsx ×2; Exceptions/index.jsx ×1 (+1 files) | `--space-5` (exact) |
| `gap-x-4` | 6 | 6 | CFS/index.jsx ×1; GeneralNotes/index.jsx ×1; MappedTB/index.jsx ×1 (+3 files) | `--space-4` (exact) |
| `gap-y-1` | 6 | 5 | CFS/index.jsx ×2; MappedTB/index.jsx ×1; Notes/OwnersCapitalAccountForm.jsx ×1 (+2 files) | `--space-1` (exact) |
| `mx-1` | 6 | 3 | GeneralNotes/index.jsx ×4; DeferredTax/index.jsx ×1; TaxComputation/index.jsx ×1 | `--space-1` (exact) |
| `py-5` | 6 | 3 | Exceptions/index.jsx ×4; DeferredTax/index.jsx ×1; TaxComputation/index.jsx ×1 | `--space-5` (exact) |
| `p-8` | 6 | 3 | DepreciationIT/index.jsx ×3; DepreciationComp/index.jsx ×2; Ratio/Form3CD.jsx ×1 | **above the scale** (32px): decision D3 |
| `pt-2` | 5 | 4 | Stock/StockPage.jsx ×2; Annexures/index.jsx ×1; Exceptions/index.jsx ×1 (+1 files) | `--space-2` (exact) |
| `pl-8` | 5 | 3 | BS/index.jsx ×3; MappingRules/MapSheetView.jsx ×1; Notes/index.jsx ×1 | **above the scale** (32px): decision D3 |
| `gap-6` | 5 | 4 | DepreciationComp/index.jsx ×2; DepreciationIT/index.jsx ×1; Master/AuditorManageModal.jsx ×1 (+1 files) | `--space-6` (exact) |
| `mt-1.5` | 5 | 4 | TrialBalance/UploadTB.jsx ×2; DepreciationIT/index.jsx ×1; MappedTB/ConflictModal.jsx ×1 (+1 files) | half step `--space-1-5` (6px): decision D3 |
| `mx-6` | 4 | 2 | DeferredTax/index.jsx ×2; TaxComputation/index.jsx ×2 | `--space-6` (exact) |
| `-mb-px` | 4 | 3 | TallyTBUpload/index.jsx ×2; DepreciationIT/index.jsx ×1; MappingRules/index.jsx ×1 | 1px hairline: border token |
| `px-0.5` | 4 | 4 | Exceptions/index.jsx ×1; MappingRules/MapSheetView.jsx ×1; Notes/index.jsx ×1 (+1 files) | half step `--space-0-5` (2px): decision D3 |
| `space-y-2` | 4 | 4 | GenerateFinancials/index.jsx ×1; MappedTB/ConflictModal.jsx ×1; MappedTB/DiscrepancyModal.jsx ×1 (+1 files) | `--space-2` (exact) |
| `gap-0.5` | 4 | 3 | TaxComputation/index.jsx ×2; Layout/NavTabs.jsx ×1; shared/RemarkCell.jsx ×1 | half step `--space-0-5` (2px): decision D3 |
| `mb-8` | 3 | 3 | Annexures/index.jsx ×1; Notes/TradePayablesDisclosureForm.jsx ×1; Notes/TradeReceivablesAgingForm.jsx ×1 | **above the scale** (32px): decision D3 |
| `mt-10` | 3 | 2 | Annexures/index.jsx ×2; Notes/index.jsx ×1 | **above the scale** (40px): decision D3 |
| `pt-1` | 3 | 3 | DepreciationIT/index.jsx ×1; Layout/FinancialYearBadge.jsx ×1; Notes/ShareCapitalForm.jsx ×1 | `--space-1` (exact) |
| `mb-1.5` | 3 | 2 | shared/HierarchyPopup.jsx ×2; Exceptions/index.jsx ×1 | half step `--space-1-5` (6px): decision D3 |
| `ml-4` | 3 | 3 | GenerateFinancials/index.jsx ×1; Notes/LongTermBorrowingsForm.jsx ×1; Notes/ShortTermBorrowingsForm.jsx ×1 | `--space-4` (exact) |
| `pt-1.5` | 3 | 3 | Layout/FinancialYearBadge.jsx ×1; Notes/index.jsx ×1; TallyTBUpload/index.jsx ×1 | half step `--space-1-5` (6px): decision D3 |
| `p-1.5` | 3 | 1 | Layout/TopBar.jsx ×3 | half step `--space-1-5` (6px): decision D3 |
| `space-y-1.5` | 3 | 3 | Master/AuditeeFormModal.jsx ×1; Master/AuditeeReadModal.jsx ×1; TallyTBUpload/index.jsx ×1 | half step `--space-1-5` (6px): decision D3 |
| `mx-4` | 3 | 2 | Notes/index.jsx ×2; TrialBalance/UploadTB.jsx ×1 | `--space-4` (exact) |
| `mt-5` | 3 | 2 | shared/SettingsModal.jsx ×2; Notes/TradeReceivablesAgeingNonCorpForm.jsx ×1 | `--space-5` (exact) |
| `pb-1.5` | 3 | 1 | shared/BranchModeBar.jsx ×3 | half step `--space-1-5` (6px): decision D3 |
| `mr-3` | 3 | 1 | shared/MastersModal.jsx ×3 | `--space-3` (exact) |
| `gap-x-3` | 2 | 2 | CFS/index.jsx ×1; shared/AdjustmentNotice.jsx ×1 | `--space-3` (exact) |
| `pt-5` | 2 | 2 | DeferredTax/index.jsx ×1; TaxComputation/index.jsx ×1 | `--space-5` (exact) |
| `gap-y-2` | 2 | 2 | GeneralNotes/index.jsx ×1; Master/AuditeeReadModal.jsx ×1 | `--space-2` (exact) |
| `mt-auto` | 2 | 1 | GenerateFinancials/index.jsx ×2 | unchanged (auto) |
| `-mt-1` | 2 | 2 | Layout/NavTabs.jsx ×1; TrialBalance/UploadTB.jsx ×1 | `--space-1` (exact) |
| `pr-1` | 2 | 2 | MappedTB/ConflictModal.jsx ×1; shared/AnalyseChange.jsx ×1 | `--space-1` (exact) |
| `mx-2` | 2 | 2 | MappingRules/MapSheetView.jsx ×1; layout/Header.tsx ×1 | `--space-2` (exact) |
| `-mx-2` | 2 | 2 | Master/AuditorManageModal.jsx ×1; Master/SignatoryManageModal.jsx ×1 | `--space-2` (exact) |
| `pb-2` | 2 | 1 | Notes/index.jsx ×2 | `--space-2` (exact) |
| `pl-3` | 2 | 2 | Notes/index.jsx ×1; PL/index.jsx ×1 | `--space-3` (exact) |
| `ml-5` | 2 | 1 | shared/MissingAlieWarning.jsx ×2 | `--space-5` (exact) |
| `p-0` | 2 | 2 | TrialBalance/UploadTB.jsx ×1; layout/Header.tsx ×1 | unchanged (0) |
| `gap-2.5` | 2 | 1 | layout/AppSidebar.tsx ×2 | half step `--space-2-5` (10px): decision D3 |
| `mt-8` | 1 | 1 | Annexures/index.jsx ×1 | **above the scale** (32px): decision D3 |
| `ml-1.5` | 1 | 1 | Annexures/index.jsx ×1 | half step `--space-1-5` (6px): decision D3 |
| `py-0` | 1 | 1 | Annexures/index.jsx ×1 | unchanged (0) |
| `space-x-2` | 1 | 1 | BranchMaster/index.jsx ×1 | `--space-2` (exact) |
| `pl-12` | 1 | 1 | BS/index.jsx ×1 | **above the scale** (48px): decision D3 |
| `my-4` | 1 | 1 | DeferredTax/index.jsx ×1 | `--space-4` (exact) |
| `py-10` | 1 | 1 | GeneralNotes/index.jsx ×1 | **above the scale** (40px): decision D3 |
| `gap-5` | 1 | 1 | GenerateFinancials/index.jsx ×1 | `--space-5` (exact) |
| `pt-0` | 1 | 1 | MappedTB/index.jsx ×1 | unchanged (0) |
| `gap-0` | 1 | 1 | MappingRules/index.jsx ×1 | unchanged (0) |
| `pr-8` | 1 | 1 | MappingRules/MapSheetView.jsx ×1 | **above the scale** (32px): decision D3 |
| `pl-2.5` | 1 | 1 | Notes/index.jsx ×1 | half step `--space-2-5` (10px): decision D3 |
| `pr-6` | 1 | 1 | Notes/index.jsx ×1 | `--space-6` (exact) |
| `-mt-5` | 1 | 1 | Notes/index.jsx ×1 | `--space-5` (exact) |
| `mx-0` | 1 | 1 | Notes/index.jsx ×1 | unchanged (0) |
| `pl-9` | 1 | 1 | Notes/InvestmentsForm.jsx ×1 | **above the scale** (36px): decision D3 |
| `gap-x-5` | 1 | 1 | Notes/OwnersCapitalAccountForm.jsx ×1 | `--space-5` (exact) |
| `pl-14` | 1 | 1 | PL/index.jsx ×1 | **above the scale** (56px): decision D3 |
| `gap-x-6` | 1 | 1 | PL/index.jsx ×1 | `--space-6` (exact) |
| `pl-7` | 1 | 1 | Ratio/Form3CD.jsx ×1 | **above the scale** (28px): decision D3 |
| `my-3` | 1 | 1 | shared/MissingAlieWarning.jsx ×1 | `--space-3` (exact) |
| `pb-6` | 1 | 1 | TrialBalance/UploadTB.jsx ×1 | `--space-6` (exact) |
| `gap-y-0.5` | 1 | 1 | TrialBalance/UploadTB.jsx ×1 | half step `--space-0-5` (2px): decision D3 |
| `ml-6` | 1 | 1 | layout/AppSidebar.tsx ×1 | `--space-6` (exact) |

### 4.7 Spacing: inline styles and CSS declarations
| Inline style | Uses | Files | Where (top files) |
| --- | ---: | ---: | --- |
| `padding: 3` | 6 | 2 | TaxComputation/index.jsx ×4; DeferredTax/index.jsx ×2 |
| `paddingLeft: 36` | 4 | 2 | DeferredTax/index.jsx ×2; TaxComputation/index.jsx ×2 |
| `margin: 18` | 2 | 2 | DeferredTax/index.jsx ×1; TaxComputation/index.jsx ×1 |
| `margin: 2` | 2 | 2 | DeferredTax/index.jsx ×1; TaxComputation/index.jsx ×1 |
| `paddingLeft: 2rem` | 1 | 1 | BS/index.jsx ×1 |
| `padding: 4` | 1 | 1 | DeferredTax/index.jsx ×1 |
| `padding: 6` | 1 | 1 | MappedTB/index.jsx ×1 |
| `padding: 0` | 1 | 1 | Notes/index.jsx ×1 |
| `gap: 4` | 1 | 1 | Notes/InvestmentsForm.jsx ×1 |
| `marginBottom: 20px` | 1 | 1 | Ratio/Form3CD.jsx ×1 |
| `padding: 24px` | 1 | 1 | fsg/ErrorBoundary.jsx ×1 |
| `margin: 0 auto` | 1 | 1 | fsg/ErrorBoundary.jsx ×1 |
| `marginTop: 8px` | 1 | 1 | fsg/ErrorBoundary.jsx ×1 |
| `marginTop: 12px` | 1 | 1 | fsg/ErrorBoundary.jsx ×1 |
| `padding: 12px` | 1 | 1 | fsg/ErrorBoundary.jsx ×1 |
| `marginTop: 16px` | 1 | 1 | fsg/ErrorBoundary.jsx ×1 |
| `padding: 8px 16px` | 1 | 1 | fsg/ErrorBoundary.jsx ×1 |

| CSS declaration | Uses | Files | Where (top files) |
| --- | ---: | ---: | --- |
| `margin: 0 0 8px` | 3 | 1 | fsg/fsg.css ×3 |
| `padding: 3pt 4pt` | 2 | 1 | fsg/fsg.css ×2 |
| `padding-left: 22px` | 2 | 1 | fsg/fsg.css ×2 |
| `row-gap: 6px` | 2 | 1 | fsg/fsg.css ×2 |
| `padding: 2px 8px` | 2 | 2 | fsg/fsg.css ×1; fsg/fsr-theme.css ×1 |
| `margin-right: 6px` | 2 | 1 | fsg/fsr-theme.css ×2 |
| `padding: 0.5rem 1rem` | 1 | 1 | fsg/fsg.css ×1 |
| `margin: 0` | 1 | 1 | fsg/fsg.css ×1 |
| `margin-bottom: 2mm` | 1 | 1 | fsg/fsg.css ×1 |
| `margin-top: 2mm` | 1 | 1 | fsg/fsg.css ×1 |
| `margin-bottom: 4mm` | 1 | 1 | fsg/fsg.css ×1 |
| `padding: 2pt 4pt` | 1 | 1 | fsg/fsg.css ×1 |
| `padding: 4pt 0` | 1 | 1 | fsg/fsg.css ×1 |
| `margin: 8px 0` | 1 | 1 | fsg/fsg.css ×1 |
| `padding: 4px 8px` | 1 | 1 | fsg/fsg.css ×1 |
| `column-gap: 0.5rem` | 1 | 1 | fsg/fsg.css ×1 |
| `gap: 0.25rem` | 1 | 1 | fsg/fsg.css ×1 |
| `padding: 0 10px` | 1 | 1 | fsg/fsg.css ×1 |
| `padding-top: 0` | 1 | 1 | fsg/fsg.css ×1 |
| `padding-bottom: 0` | 1 | 1 | fsg/fsg.css ×1 |
| `gap: 0.5rem` | 1 | 1 | fsg/fsg.css ×1 |
| `padding: 0 8px` | 1 | 1 | fsg/fsg.css ×1 |
| `gap: 6px` | 1 | 1 | fsg/fsr-theme.css ×1 |
| `gap: 4px 16px` | 1 | 1 | fsg/fsr-theme.css ×1 |
| `padding: 6px 12px` | 1 | 1 | fsg/fsr-theme.css ×1 |
| `padding: 6px 10px` | 1 | 1 | fsg/fsr-theme.css ×1 |
| `padding: 0 12px 10px` | 1 | 1 | fsg/fsr-theme.css ×1 |

## 5. Findings: sizes that can break on another screen

### 5.1 Viewport units (every one is a sizing that ignores the layout around it)
| Value | Uses | Files | Where (top files) |
| --- | ---: | ---: | --- |
| `92vh` | 6 | 6 | Notes/DirectorLoansForm.jsx ×1; Notes/ShortTermBorrowingsForm.jsx ×1; Notes/TradePayablesDisclosureForm.jsx ×1 (+3 files) |
| `90vh` | 5 | 5 | MappedTB/DiscrepancyModal.jsx ×1; MappedTB/OverrideModal.jsx ×1; Notes/CashBankDetailsForm.jsx ×1 (+2 files) |
| `max-h-[92vh]` | 5 | 5 | Notes/DirectorLoansForm.jsx ×1; Notes/TradePayablesDisclosureForm.jsx ×1; Notes/TradeReceivablesAgeingNonCorpForm.jsx ×1 (+2 files) |
| `max-h-[90vh]` | 4 | 4 | MappedTB/DiscrepancyModal.jsx ×1; MappedTB/OverrideModal.jsx ×1; Notes/CashBankDetailsForm.jsx ×1 (+1 files) |
| `100vh` | 2 | 2 | Exceptions/index.jsx ×1; TrialBalance/UploadTB.jsx ×1 |
| `92vw` | 2 | 2 | Master/AuditorManageModal.jsx ×1; Master/SignatoryManageModal.jsx ×1 |
| `82vh` | 2 | 2 | Master/AuditorManageModal.jsx ×1; Master/SignatoryManageModal.jsx ×1 |
| `maxWidth: 92vw` | 2 | 2 | Master/AuditorManageModal.jsx ×1; Master/SignatoryManageModal.jsx ×1 |
| `maxHeight: 82vh` | 2 | 2 | Master/AuditorManageModal.jsx ×1; Master/SignatoryManageModal.jsx ×1 |
| `97vw` | 2 | 2 | Notes/LongTermBorrowingsForm.jsx ×1; Notes/OwnersCapitalAccountForm.jsx ×1 |
| `width: 97vw` | 2 | 2 | Notes/LongTermBorrowingsForm.jsx ×1; Notes/OwnersCapitalAccountForm.jsx ×1 |
| `94vh` | 2 | 2 | Notes/OwnersCapitalAccountForm.jsx ×1; Notes/ShareCapitalForm.jsx ×1 |
| `maxHeight: 94vh` | 2 | 2 | Notes/OwnersCapitalAccountForm.jsx ×1; Notes/ShareCapitalForm.jsx ×1 |
| `95vw` | 2 | 2 | Notes/ShortTermBorrowingsForm.jsx ×1; shared/MastersModal.jsx ×1 |
| `width: 95vw` | 2 | 2 | Notes/ShortTermBorrowingsForm.jsx ×1; shared/MastersModal.jsx ×1 |
| `h-screen` | 2 | 1 | layout/MainLayout.tsx ×2 |
| `max-h-[calc(100vh-360px)]` | 1 | 1 | Exceptions/index.jsx ×1 |
| `max-h-[88vh]` | 1 | 1 | Master/AuditeeFormModal.jsx ×1 |
| `88vh` | 1 | 1 | Master/AuditeeFormModal.jsx ×1 |
| `95vh` | 1 | 1 | Notes/LongTermBorrowingsForm.jsx ×1 |
| `maxHeight: 95vh` | 1 | 1 | Notes/LongTermBorrowingsForm.jsx ×1 |
| `96vw` | 1 | 1 | Notes/ShareCapitalForm.jsx ×1 |
| `width: 96vw` | 1 | 1 | Notes/ShareCapitalForm.jsx ×1 |
| `maxHeight: 92vh` | 1 | 1 | Notes/ShortTermBorrowingsForm.jsx ×1 |
| `85vw` | 1 | 1 | shared/FormatReference.jsx ×1 |
| `width: 85vw` | 1 | 1 | shared/FormatReference.jsx ×1 |
| `height: 90vh` | 1 | 1 | shared/FormatReference.jsx ×1 |
| `max-h-[calc(100vh-3rem)]` | 1 | 1 | TrialBalance/UploadTB.jsx ×1 |
| `max-h-[32vh]` | 1 | 1 | TrialBalance/VersionCarryModal.jsx ×1 |
| `32vh` | 1 | 1 | TrialBalance/VersionCarryModal.jsx ×1 |
| `max-h-[50vh]` | 1 | 1 | TrialBalance/WorkingsModal.jsx ×1 |
| `50vh` | 1 | 1 | TrialBalance/WorkingsModal.jsx ×1 |
| `max-w-[90vw]` | 1 | 1 | fsg/App.jsx ×1 |
| `90vw` | 1 | 1 | fsg/App.jsx ×1 |

### 5.2 Fixed pixel and arbitrary widths and heights (Tailwind)
| Class | Uses | Files | Where (top files) |
| --- | ---: | ---: | --- |
| `w-[11%]` | 12 | 2 | Annexures/index.jsx ×8; Stock/StockPage.jsx ×4 |
| `w-[20%]` | 10 | 3 | Notes/TradePayablesDisclosureForm.jsx ×5; Annexures/index.jsx ×3; PL/index.jsx ×2 |
| `w-[22%]` | 10 | 5 | CFS/index.jsx ×4; Notes/DirectorLoansForm.jsx ×2; Notes/index.jsx ×2 (+2 files) |
| `w-[55%]` | 5 | 4 | Notes/index.jsx ×2; Notes/TradePayablesDisclosureForm.jsx ×1; Notes/TradeReceivablesAgeingNonCorpForm.jsx ×1 (+1 files) |
| `w-[35%]` | 4 | 4 | Annexures/index.jsx ×1; Notes/CashBankDetailsForm.jsx ×1; Notes/index.jsx ×1 (+1 files) |
| `w-[30%]` | 4 | 4 | Notes/CashBankDetailsForm.jsx ×1; Notes/ShareCapitalForm.jsx ×1; Notes/TradeReceivablesAgeingNonCorpForm.jsx ×1 (+1 files) |
| `w-[18%]` | 3 | 2 | Notes/DirectorLoansForm.jsx ×2; Notes/index.jsx ×1 |
| `w-[46%]` | 2 | 2 | Annexures/index.jsx ×1; Notes/TradeReceivablesAgeingNonCorpForm.jsx ×1 |
| `w-[10%]` | 2 | 1 | Annexures/index.jsx ×2 |
| `w-[8%]` | 2 | 2 | Annexures/index.jsx ×1; PL/index.jsx ×1 |
| `w-[56%]` | 2 | 1 | CFS/index.jsx ×2 |
| `w-[5%]` | 2 | 2 | Notes/CashBankDetailsForm.jsx ×1; Notes/TradePayablesDisclosureForm.jsx ×1 |
| `w-[15%]` | 2 | 1 | Notes/CashBankDetailsForm.jsx ×2 |
| `w-[26%]` | 2 | 2 | Notes/index.jsx ×1; Notes/TradeReceivablesAgingForm.jsx ×1 |
| `w-[40%]` | 2 | 1 | Notes/ShareCapitalForm.jsx ×2 |
| `min-w-[45%]` | 2 | 2 | Notes/TradeReceivablesAgeingNonCorpForm.jsx ×1; Notes/TradeReceivablesAgingForm.jsx ×1 |
| `w-[12.5%]` | 2 | 1 | PL/index.jsx ×2 |
| `h-[52px]` | 2 | 2 | layout/AppSidebar.tsx ×1; layout/Header.tsx ×1 |
| `w-[60%]` | 1 | 1 | Annexures/index.jsx ×1 |
| `w-[12%]` | 1 | 1 | Annexures/index.jsx ×1 |
| `w-[16%]` | 1 | 1 | Annexures/index.jsx ×1 |
| `w-[13%]` | 1 | 1 | Annexures/index.jsx ×1 |
| `w-[24%]` | 1 | 1 | ExceptionReport/index.jsx ×1 |
| `w-[420px]` | 1 | 1 | Exceptions/index.jsx ×1 |
| `min-h-[80px]` | 1 | 1 | GeneralNotes/index.jsx ×1 |
| `max-h-[420px]` | 1 | 1 | GeneralNotes/index.jsx ×1 |
| `min-h-[60px]` | 1 | 1 | GeneralNotes/index.jsx ×1 |
| `h-[60px]` | 1 | 1 | Layout/TopBar.jsx ×1 |
| `max-w-[180px]` | 1 | 1 | MappingRules/index.jsx ×1 |
| `w-[14%]` | 1 | 1 | Notes/index.jsx ×1 |
| `w-[23%]` | 1 | 1 | Notes/index.jsx ×1 |
| `max-h-[360px]` | 1 | 1 | Notes/index.jsx ×1 |
| `min-w-[160px]` | 1 | 1 | Notes/InvestmentsForm.jsx ×1 |
| `w-[25%]` | 1 | 1 | Notes/ShareCapitalForm.jsx ×1 |
| `min-w-[60%]` | 1 | 1 | Notes/TradePayablesDisclosureForm.jsx ×1 |
| `w-[44%]` | 1 | 1 | Notes/TradeReceivablesAgeingNonCorpForm.jsx ×1 |
| `w-[28%]` | 1 | 1 | Notes/TradeReceivablesAgeingNonCorpForm.jsx ×1 |
| `w-[32%]` | 1 | 1 | PL/index.jsx ×1 |
| `w-[52%]` | 1 | 1 | PL/index.jsx ×1 |
| `w-[6%]` | 1 | 1 | PL/index.jsx ×1 |
| `w-[700px]` | 1 | 1 | shared/HierarchyPopup.jsx ×1 |
| `max-w-[140px]` | 1 | 1 | shared/RemarkCell.jsx ×1 |
| `w-[480px]` | 1 | 1 | fsg/App.jsx ×1 |
| `w-[3px]` | 1 | 1 | layout/AppSidebar.tsx ×1 |
| `min-w-[140px]` | 1 | 1 | layout/Header.tsx ×1 |

### 5.3 Named maximum widths
| Class | Uses | Files | Where (top files) |
| --- | ---: | ---: | --- |
| `max-w-md` | 8 | 8 | GeneralNotes/index.jsx ×1; GenerateFinancials/index.jsx ×1; MappedTB/BulkOverrideModal.jsx ×1 (+5 files) |
| `max-w-sm` | 7 | 5 | TrialBalance/UploadTB.jsx ×3; MappedTB/BulkOverrideModal.jsx ×1; MappedTB/index.jsx ×1 (+2 files) |
| `max-w-xl` | 7 | 5 | TrialBalance/UploadTB.jsx ×3; MappedTB/DiscrepancyModal.jsx ×1; TallyTBUpload/index.jsx ×1 (+2 files) |
| `max-w-lg` | 7 | 7 | Master/AuditeeFormModal.jsx ×1; Master/AuditeeReadModal.jsx ×1; Notes/index.jsx ×1 (+4 files) |
| `max-w-5xl` | 6 | 3 | CFS/index.jsx ×4; Master/index.jsx ×1; Notes/CashBankDetailsForm.jsx ×1 |
| `max-w-2xl` | 6 | 6 | DepreciationComp/index.jsx ×1; DepreciationIT/index.jsx ×1; MappedTB/ConflictModal.jsx ×1 (+3 files) |
| `max-w-4xl` | 4 | 4 | BranchMaster/index.jsx ×1; DeferredTax/index.jsx ×1; TaxComputation/index.jsx ×1 (+1 files) |
| `max-w-3xl` | 3 | 3 | Annexures/index.jsx ×1; Notes/DirectorLoansForm.jsx ×1; Notes/TradeReceivablesAgeingNonCorpForm.jsx ×1 |
| `max-w-xs` | 3 | 2 | MappingRules/MapSheetView.jsx ×2; layout/Header.tsx ×1 |
| `max-w-none` | 2 | 2 | GeneralNotes/index.jsx ×1; Notes/index.jsx ×1 |
| `max-w-6xl` | 2 | 2 | Notes/TradePayablesDisclosureForm.jsx ×1; Notes/TradeReceivablesAgingForm.jsx ×1 |
| `max-w-7xl` | 1 | 1 | Notes/InvestmentsForm.jsx ×1 |

### 5.4 Tailwind-scale fixed sizes (mostly icons; `w-4`/`h-4` are icon boxes)
| Class | Uses | Files | Where (top files) |
| --- | ---: | ---: | --- |
| `h-4` | 36 | 9 | layout/Header.tsx ×13; MappedTB/index.jsx ×6; GeneralNotes/index.jsx ×4 (+6 files) |
| `w-4` | 32 | 8 | layout/Header.tsx ×13; MappedTB/index.jsx ×6; layout/AppSidebar.tsx ×4 (+5 files) |
| `min-w-0` | 14 | 8 | layout/Header.tsx ×3; Exceptions/index.jsx ×2; GenerateFinancials/index.jsx ×2 (+5 files) |
| `w-6` | 12 | 5 | Notes/OwnersCapitalAccountForm.jsx ×5; TallyTBUpload/index.jsx ×3; Notes/ShareCapitalForm.jsx ×2 (+2 files) |
| `w-5` | 10 | 4 | layout/AppSidebar.tsx ×4; Layout/TopBar.jsx ×3; layout/Header.tsx ×2 (+1 files) |
| `w-8` | 9 | 5 | layout/Header.tsx ×3; BS/index.jsx ×2; layout/AppSidebar.tsx ×2 (+2 files) |
| `h-5` | 9 | 3 | layout/AppSidebar.tsx ×4; Layout/TopBar.jsx ×3; layout/Header.tsx ×2 |
| `h-7` | 8 | 4 | Exceptions/index.jsx ×4; layout/Header.tsx ×2; GeneralNotes/index.jsx ×1 (+1 files) |
| `w-56` | 7 | 7 | BranchMaster/index.jsx ×1; Exceptions/index.jsx ×1; MappedTB/index.jsx ×1 (+4 files) |
| `w-3` | 7 | 4 | layout/Header.tsx ×3; shared/RemarkCell.jsx ×2; Layout/NavTabs.jsx ×1 (+1 files) |
| `h-3` | 7 | 4 | layout/Header.tsx ×3; shared/RemarkCell.jsx ×2; Layout/NavTabs.jsx ×1 (+1 files) |
| `w-10` | 6 | 4 | MappingRules/MapSheetView.jsx ×3; BS/index.jsx ×1; MappingRules/MappingEntryTable.jsx ×1 (+1 files) |
| `min-h-0` | 6 | 6 | Format/index.jsx ×1; MappedTBWithRemarks/index.jsx ×1; Master/AuditorManageModal.jsx ×1 (+3 files) |
| `h-8` | 6 | 3 | layout/Header.tsx ×3; layout/AppSidebar.tsx ×2; GeneralNotes/index.jsx ×1 |
| `w-16` | 5 | 5 | BS/index.jsx ×1; GeneralNotes/index.jsx ×1; MappingRules/MappingEntryTable.jsx ×1 (+2 files) |
| `h-6` | 5 | 3 | TallyTBUpload/index.jsx ×3; layout/AppSidebar.tsx ×1; layout/Header.tsx ×1 |
| `w-40` | 4 | 4 | Annexures/index.jsx ×1; DeferredTax/index.jsx ×1; ITR/ITRSectionTable.jsx ×1 (+1 files) |
| `w-48` | 4 | 4 | Layout/TopBar.jsx ×1; MappedTB/index.jsx ×1; MappingRules/ModelFormat.jsx ×1 (+1 files) |
| `max-h-64` | 4 | 4 | MappingRules/MappingEntryTable.jsx ×1; Ratio/Form3CD.jsx ×1; shared/MissingAlieWarning.jsx ×1 (+1 files) |
| `w-72` | 3 | 2 | Layout/NavTabs.jsx ×2; BranchMaster/index.jsx ×1 |
| `w-32` | 3 | 2 | BS/index.jsx ×2; TaxComputation/index.jsx ×1 |
| `w-3.5` | 3 | 2 | MappingRules/MapSheetView.jsx ×2; Layout/FinancialYearBadge.jsx ×1 |
| `h-3.5` | 3 | 2 | MappingRules/MapSheetView.jsx ×2; Layout/FinancialYearBadge.jsx ×1 |
| `h-1.5` | 3 | 2 | MappedTB/BulkOverrideModal.jsx ×2; MappedTB/ConflictModal.jsx ×1 |
| `max-h-72` | 3 | 3 | MappedTB/ConflictModal.jsx ×1; MappingRules/ModelFormat.jsx ×1; fsg/App.jsx ×1 |
| `w-36` | 2 | 2 | BranchMaster/index.jsx ×1; Notes/index.jsx ×1 |
| `w-64` | 2 | 2 | Layout/FinancialYearBadge.jsx ×1; layout/AppSidebar.tsx ×1 |
| `w-60` | 2 | 1 | Layout/NavTabs.jsx ×2 |
| `h-10` | 2 | 2 | Layout/NavTabs.jsx ×1; MappingRules/MapSheetView.jsx ×1 |
| `max-h-80` | 2 | 2 | Notes/index.jsx ×1; layout/Header.tsx ×1 |
| `w-80` | 2 | 1 | layout/Header.tsx ×2 |
| `w-20` | 1 | 1 | DeferredTax/index.jsx ×1 |
| `w-96` | 1 | 1 | DepreciationIT/index.jsx ×1 |
| `w-9` | 1 | 1 | GeneralNotes/index.jsx ×1 |
| `w-14` | 1 | 1 | GeneralNotes/index.jsx ×1 |
| `w-1.5` | 1 | 1 | MappedTB/ConflictModal.jsx ×1 |
| `max-h-96` | 1 | 1 | MappedTB/index.jsx ×1 |
| `w-28` | 1 | 1 | MappingRules/MappingEntryTable.jsx ×1 |
| `w-52` | 1 | 1 | MappingRules/ModelFormat.jsx ×1 |
| `w-24` | 1 | 1 | Ratio/Form3CD.jsx ×1 |
| `max-h-60` | 1 | 1 | Stock/StockPage.jsx ×1 |
| `w-12` | 1 | 1 | TrialBalance/ActualTBTable.jsx ×1 |
| `h-12` | 1 | 1 | TrialBalance/ActualTBTable.jsx ×1 |

### 5.5 Inline widths and heights (React style objects; includes AG Grid column definitions)
| Inline style | Uses | Files | Where (top files) |
| --- | ---: | ---: | --- |
| `width: 180` | 19 | 5 | TrialBalance/ActualTBTable.jsx ×6; Exceptions/index.jsx ×5; MappedTB/index.jsx ×5 (+2 files) |
| `width: 130` | 17 | 5 | MappedTB/index.jsx ×6; TrialBalance/ActualTBTable.jsx ×5; TallyTBUpload/index.jsx ×4 (+2 files) |
| `width: 200` | 16 | 4 | MappedTBWithRemarks/index.jsx ×7; TrialBalance/ActualTBTable.jsx ×5; Exceptions/index.jsx ×2 (+1 files) |
| `width: 10%` | 15 | 2 | Ratio/Form3CD.jsx ×12; Ratio/AnalyticalRatios.jsx ×3 |
| `width: 120` | 9 | 4 | MappedTB/index.jsx ×4; Exceptions/index.jsx ×2; TallyTBUpload/index.jsx ×2 (+1 files) |
| `maxWidth: 1320px` | 8 | 1 | Stock/StockPage.jsx ×8 |
| `width: 5%` | 6 | 2 | Ratio/Form3CD.jsx ×4; BS/index.jsx ×2 |
| `width: 6%` | 5 | 2 | Ratio/Form3CD.jsx ×3; BS/index.jsx ×2 |
| `width: 100` | 5 | 4 | TrialBalance/ActualTBTable.jsx ×2; DeferredTax/index.jsx ×1; MappedTB/index.jsx ×1 (+1 files) |
| `width: 4%` | 4 | 1 | BS/index.jsx ×4 |
| `width: 12.5%` | 4 | 1 | BS/index.jsx ×4 |
| `width: 16%` | 4 | 1 | BS/index.jsx ×4 |
| `minWidth: 95` | 4 | 1 | DepreciationIT/index.jsx ×4 |
| `width: 140` | 4 | 3 | MappedTBWithRemarks/index.jsx ×2; MappedTB/index.jsx ×1; TrialBalance/ActualTBTable.jsx ×1 |
| `width: 240` | 4 | 4 | MappedTB/index.jsx ×1; MappedTBWithRemarks/index.jsx ×1; TallyTBUpload/index.jsx ×1 (+1 files) |
| `width: 20%` | 4 | 2 | Ratio/Form3CD.jsx ×3; Ratio/AnalyticalRatios.jsx ×1 |
| `width: 12%` | 4 | 1 | Ratio/Form3CD.jsx ×4 |
| `minWidth: 100` | 3 | 2 | DepreciationIT/index.jsx ×2; MappedTB/index.jsx ×1 |
| `minWidth: 90` | 3 | 1 | DepreciationIT/index.jsx ×3 |
| `width: 210` | 3 | 1 | Exceptions/index.jsx ×3 |
| `width: 160` | 3 | 2 | MappedTB/index.jsx ×2; MappingRules/ModelFormat.jsx ×1 |
| `minWidth: 0` | 3 | 1 | Notes/InvestmentsForm.jsx ×3 |
| `width: 100%` | 3 | 2 | Notes/InvestmentsForm.jsx ×2; Ratio/Form3CD.jsx ×1 |
| `width: 3%` | 2 | 1 | BS/index.jsx ×2 |
| `width: 27%` | 2 | 1 | BS/index.jsx ×2 |
| `width: 50%` | 2 | 1 | BS/index.jsx ×2 |
| `width: 9%` | 2 | 1 | BS/index.jsx ×2 |
| `minWidth: 220` | 2 | 1 | DepreciationIT/index.jsx ×2 |
| `minWidth: 1300` | 2 | 2 | DepreciationIT/index.jsx ×1; MappingRules/MappingEntryTable.jsx ×1 |
| `width: 170` | 2 | 2 | Exceptions/index.jsx ×1; MappedTBWithRemarks/index.jsx ×1 |
| `width: 150` | 2 | 2 | MappedTB/index.jsx ×1; MappedTBWithRemarks/index.jsx ×1 |
| `width: 250` | 2 | 1 | MappedTB/index.jsx ×2 |
| `width: 110` | 2 | 2 | MappedTBWithRemarks/index.jsx ×1; TrialBalance/ActualTBTable.jsx ×1 |
| `maxWidth: 92vw` | 2 | 2 | Master/AuditorManageModal.jsx ×1; Master/SignatoryManageModal.jsx ×1 |
| `maxHeight: 82vh` | 2 | 2 | Master/AuditorManageModal.jsx ×1; Master/SignatoryManageModal.jsx ×1 |
| `width: 97vw` | 2 | 2 | Notes/LongTermBorrowingsForm.jsx ×1; Notes/OwnersCapitalAccountForm.jsx ×1 |
| `maxWidth: 1400px` | 2 | 2 | Notes/OwnersCapitalAccountForm.jsx ×1; Ratio/Form3CD.jsx ×1 |
| `maxHeight: 94vh` | 2 | 2 | Notes/OwnersCapitalAccountForm.jsx ×1; Notes/ShareCapitalForm.jsx ×1 |
| `width: 95vw` | 2 | 2 | Notes/ShortTermBorrowingsForm.jsx ×1; shared/MastersModal.jsx ×1 |
| `width: 11%` | 2 | 1 | Ratio/AnalyticalRatios.jsx ×2 |
| `width: 37%` | 2 | 1 | Ratio/Form3CD.jsx ×2 |
| `minWidth: 800` | 1 | 1 | Annexures/index.jsx ×1 |
| `minWidth: 1000` | 1 | 1 | Annexures/index.jsx ×1 |
| `minWidth: 200` | 1 | 1 | DepreciationComp/index.jsx ×1 |
| `minWidth: 1150` | 1 | 1 | DepreciationComp/index.jsx ×1 |
| `minWidth: 190` | 1 | 1 | DepreciationComp/index.jsx ×1 |
| `minWidth: 180` | 1 | 1 | DepreciationIT/index.jsx ×1 |
| `minWidth: 55` | 1 | 1 | DepreciationIT/index.jsx ×1 |
| `width: 44` | 1 | 1 | Exceptions/index.jsx ×1 |
| `width: 260` | 1 | 1 | Exceptions/index.jsx ×1 |
| `width: 48` | 1 | 1 | Exceptions/index.jsx ×1 |
| `width: 80` | 1 | 1 | Exceptions/index.jsx ×1 |
| `width: 230` | 1 | 1 | Exceptions/index.jsx ×1 |
| `width: 190` | 1 | 1 | Exceptions/index.jsx ×1 |
| `width: (computed)` | 1 | 1 | MappedTB/BulkOverrideModal.jsx ×1 |
| `height: 1.2` | 1 | 1 | MappedTB/index.jsx ×1 |
| `width: 38` | 1 | 1 | MappedTB/index.jsx ×1 |
| `minWidth: 170` | 1 | 1 | MappedTB/index.jsx ×1 |
| `width: 220` | 1 | 1 | MappedTB/index.jsx ×1 |
| `width: 106` | 1 | 1 | MappedTB/index.jsx ×1 |
| `width: 158` | 1 | 1 | MappedTB/index.jsx ×1 |
| `maxWidth: 220` | 1 | 1 | MappedTB/index.jsx ×1 |
| `minWidth: 600` | 1 | 1 | MappingRules/MapSheetView.jsx ×1 |
| `minWidth: 700` | 1 | 1 | MappingRules/MapSheetView.jsx ×1 |
| `width: 60` | 1 | 1 | MappingRules/ModelFormat.jsx ×1 |
| `width: 620px` | 1 | 1 | Master/AuditorManageModal.jsx ×1 |
| `width: 560px` | 1 | 1 | Master/SignatoryManageModal.jsx ×1 |
| `minWidth: 900` | 1 | 1 | Notes/index.jsx ×1 |
| `maxWidth: 56rem` | 1 | 1 | Notes/index.jsx ×1 |
| `height: auto` | 1 | 1 | Notes/index.jsx ×1 |
| `maxWidth: 1200px` | 1 | 1 | Notes/LongTermBorrowingsForm.jsx ×1 |
| `maxHeight: 95vh` | 1 | 1 | Notes/LongTermBorrowingsForm.jsx ×1 |
| `maxWidth: 1100px` | 1 | 1 | Notes/ShareCapitalForm.jsx ×1 |
| `width: 96vw` | 1 | 1 | Notes/ShareCapitalForm.jsx ×1 |
| `maxWidth: 1000px` | 1 | 1 | Notes/ShortTermBorrowingsForm.jsx ×1 |
| `maxHeight: 92vh` | 1 | 1 | Notes/ShortTermBorrowingsForm.jsx ×1 |
| `width: 28%` | 1 | 1 | Ratio/AnalyticalRatios.jsx ×1 |
| `minWidth: 1400px` | 1 | 1 | Ratio/Form3CD.jsx ×1 |
| `minWidth: 60px` | 1 | 1 | Ratio/Form3CD.jsx ×1 |
| `minWidth: 200px` | 1 | 1 | Ratio/Form3CD.jsx ×1 |
| `width: 13%` | 1 | 1 | shared/AnalyseChange.jsx ×1 |
| `width: 8%` | 1 | 1 | shared/AnalyseChange.jsx ×1 |
| `width: 14%` | 1 | 1 | shared/AnalyseChange.jsx ×1 |
| `width: 85vw` | 1 | 1 | shared/FormatReference.jsx ×1 |
| `height: 90vh` | 1 | 1 | shared/FormatReference.jsx ×1 |
| `maxWidth: 960px` | 1 | 1 | shared/MastersModal.jsx ×1 |
| `width: 90` | 1 | 1 | TrialBalance/ActualTBTable.jsx ×1 |
| `width: 64` | 1 | 1 | TrialBalance/ActualTBTable.jsx ×1 |
| `maxWidth: 900px` | 1 | 1 | fsg/ErrorBoundary.jsx ×1 |

### 5.6 CSS widths and heights
| Declaration | Uses | Files | Where (top files) |
| --- | ---: | ---: | --- |
| `width: 8px` | 2 | 2 | fsg/fsg.css ×1; fsg/fsr-theme.css ×1 |
| `height: 8px` | 2 | 2 | fsg/fsg.css ×1; fsg/fsr-theme.css ×1 |
| `width: 100%` | 2 | 1 | fsg/fsg.css ×2 |
| `height: 28px` | 2 | 1 | fsg/fsg.css ×2 |
| `min-height: 100px` | 1 | 1 | fsg/fsg.css ×1 |
| `max-width: 9.5rem` | 1 | 1 | fsg/fsg.css ×1 |
| `height: 26px` | 1 | 1 | fsg/fsg.css ×1 |
| `max-width: 8rem` | 1 | 1 | fsg/fsg.css ×1 |
| `width: 6px` | 1 | 1 | fsg/fsr-theme.css ×1 |
| `height: 6px` | 1 | 1 | fsg/fsr-theme.css ×1 |

### 5.7 AG Grid height constants (JavaScript numbers)
| Prop | Uses | Files | Where (top files) |
| --- | ---: | ---: | --- |
| `headerHeight=36` | 3 | 3 | MappedTBWithRemarks/index.jsx ×1; MappingRules/ModelFormat.jsx ×1; TrialBalance/ActualTBTable.jsx ×1 |
| `floatingFiltersHeight=32` | 3 | 3 | MappedTBWithRemarks/index.jsx ×1; MappingRules/ModelFormat.jsx ×1; TrialBalance/ActualTBTable.jsx ×1 |
| `rowHeight=28` | 2 | 2 | MappedTB/index.jsx ×1; TrialBalance/ActualTBTable.jsx ×1 |
| `headerHeight=52` | 1 | 1 | MappedTB/index.jsx ×1 |
| `floatingFiltersHeight=30` | 1 | 1 | MappedTB/index.jsx ×1 |
| `rowHeight=38` | 1 | 1 | MappedTBWithRemarks/index.jsx ×1 |
| `rowHeight=30` | 1 | 1 | MappingRules/ModelFormat.jsx ×1 |

### 5.8 Positioning and offsets
| Position | Uses | Files | Where (top files) |
| --- | ---: | ---: | --- |
| `fixed` | 44 | 25 | Exceptions/index.jsx ×5; DepreciationIT/index.jsx ×4; GeneralNotes/index.jsx ×4 (+22 files) |
| `sticky` | 21 | 13 | Exceptions/index.jsx ×2; MappingRules/MapSheetView.jsx ×2; Notes/CashBankDetailsForm.jsx ×2 (+10 files) |
| `relative` | 15 | 12 | Layout/NavTabs.jsx ×2; layout/AppSidebar.tsx ×2; layout/Header.tsx ×2 (+9 files) |
| `absolute` | 14 | 12 | MappingRules/MapSheetView.jsx ×2; layout/Header.tsx ×2; Layout/FinancialYearBadge.jsx ×1 (+9 files) |

| Offset | Uses | Files | Where (top files) |
| --- | ---: | ---: | --- |
| `inset-0` | 14 | 14 | DepreciationIT/index.jsx ×1; Exceptions/index.jsx ×1; Layout/FinancialYearBadge.jsx ×1 (+11 files) |
| `top-0` | 14 | 13 | MappingRules/MapSheetView.jsx ×2; Exceptions/index.jsx ×1; Layout/NavTabs.jsx ×1 (+10 files) |
| `bottom-0` | 7 | 7 | BS/index.jsx ×1; Notes/CashBankDetailsForm.jsx ×1; Notes/DirectorLoansForm.jsx ×1 (+4 files) |
| `left-0` | 4 | 4 | Layout/FinancialYearBadge.jsx ×1; Master/index.jsx ×1; Stock/StockPage.jsx ×1 (+1 files) |
| `right-0` | 4 | 4 | Layout/TopBar.jsx ×1; MappedTB/index.jsx ×1; MappingRules/ModelFormat.jsx ×1 (+1 files) |
| `bottom-4` | 3 | 3 | DepreciationComp/index.jsx ×1; DepreciationIT/index.jsx ×1; fsg/App.jsx ×1 |
| `right-4` | 3 | 3 | DepreciationComp/index.jsx ×1; DepreciationIT/index.jsx ×1; fsg/App.jsx ×1 |
| `left-2.5` | 1 | 1 | MappingRules/MapSheetView.jsx ×1 |
| `right-2` | 1 | 1 | MappingRules/MapSheetView.jsx ×1 |
| `right-1.5` | 1 | 1 | Notes/index.jsx ×1 |
| `left-3` | 1 | 1 | layout/Header.tsx ×1 |
| `top-1` | 1 | 1 | layout/Header.tsx ×1 |
| `right-1` | 1 | 1 | layout/Header.tsx ×1 |

`fixed` is overwhelmingly modal backdrops (`fixed inset-0`), expected; the layout risk is the 4 fixed popups with pixel widths, not the backdrops.

## 6. Proposal

### 6.1 Tokens (as requested, in rem; resulting px at each root size)

| Token | rem | 15px root | 16px | 17px | 18px |
| --- | ---: | ---: | ---: | ---: | ---: |
| `--text-xs` | 0.72 | 10.8 | 11.5 | 12.2 | 13.0 |
| `--text-sm` | 0.75 | 11.3 | 12.0 | 12.8 | 13.5 |
| `--text-base` | 0.8125 | 12.2 | 13.0 | 13.8 | 14.6 |
| `--text-md` | 0.875 | 13.1 | 14.0 | 14.9 | 15.8 |
| `--text-lg` | 1.125 | 16.9 | 18.0 | 19.1 | 20.3 |
| `--text-xl` | 1.25 | 18.8 | 20.0 | 21.3 | 22.5 |

| Token | rem | 15px root | 16px | 17px | 18px |
| --- | ---: | ---: | ---: | ---: | ---: |
| `--space-1` | 0.25 | 3.8 | 4.0 | 4.3 | 4.5 |
| `--space-2` | 0.5 | 7.5 | 8.0 | 8.5 | 9.0 |
| `--space-3` | 0.75 | 11.3 | 12.0 | 12.8 | 13.5 |
| `--space-4` | 1 | 15.0 | 16.0 | 17.0 | 18.0 |
| `--space-5` | 1.25 | 18.8 | 20.0 | 21.3 | 22.5 |
| `--space-6` | 1.5 | 22.5 | 24.0 | 25.5 | 27.0 |
| `control height` | 2 | 30.0 | 32.0 | 34.0 | 36.0 |
| `control height (dialog)` | 2.25 | 33.8 | 36.0 | 38.3 | 40.5 |
| `table row` | 2.25 | 33.8 | 36.0 | 38.3 | 40.5 |
| `statement row` | 2 | 30.0 | 32.0 | 34.0 | 36.0 |

Weights 400 / 500 / 600 / 700 (700 for page title and totals only). Line heights 1.3 headings, 1.5 body. Radius 0.45rem controls, 0.65rem cards, 0.9rem dialogs. Root size by width: ≤1366px 15px; 1367-1919px 16px; ≥1920px 17px; ≥2560px 18px. Density: compact at ≤1366px (row 2rem, control 1.875rem), comfortable at ≥1920px (row 2.5rem), manual override in settings.

### 6.2 Breakpoints and the effective viewports they serve

| Band | Width | Root | Serves | Density | Sidebar |
| --- | --- | --- | --- | --- | --- |
| Compact | ≤1366px | 15px | 1280×720, 1366×768 (13.3" at 150%, 15.6" HD) | compact | 4rem icon rail |
| Default | 1367-1919px | 16px | 1440×810, 1536×864, 1600×900 | regular | 4rem rail below 1440px, else 16rem |
| Large | 1920-2559px | 17px | 1920×1080 (15.6"-21") | comfortable | 16rem |
| Extra large | ≥2560px | 18px | 2560×1440 (21"+ QHD) | comfortable | 16rem, content capped and centred |

### 6.3 Rules that follow from the audit

- **Text:** all sizes come from the six tokens; the 164 `text-[10px]` and 104 `text-[11px]` uses become `--text-xs`, so the smallest label is 11.5px at the default root (today 10px). That is a deliberate +15%; Notes forms and the Owners Capital / Share Capital tables are the dense places to verify.
- **Roles, not sizes:** define one class per role (page title, card title, table header, toolbar button, form label, helper text, dialog title, amount) and move screens to the role. The role classes live in the token file, so the lint in Step 7 can ban everything else.
- **Spacing:** page padding `--space-4` / `--space-6`, section gap `--space-3`, card padding `--space-4`, toolbar gap `--space-2`, label gap 0.3rem, form row gap 0.875rem, dialog padding `--space-6`, footer `--space-3` `--space-6` (all as requested).
- **Layout:** replace viewport-unit dialogs with `width: min(<preferred>, 100% - 2rem)` and `max-height: 90%`, internal scroll, sticky footer; replace the 3 fixed-px popups; convert grid column widths to `flex` plus a rem `minWidth`; cap statement, form and dialog content at a readable width above 1920px while grids keep filling.

## 7. Decisions needed before any edit

| # | Decision | Recommendation |
| --- | --- | --- |
| **D1** | The root font-size change is `html`-level, so it also rescales every other VERA module (Dashboard, Permanent File, Tax Audit ...) by -6% at ≤1366px and +6% at ≥1920px. The only alternative is to size the FSR module in `em` inside `.fsg-root`, which cannot reach the shared sidebar and top bar. | Apply app-wide: the shell is shared, and one scale is the point. Tell me if other modules must stay at 16px. |
| **D2** | `src/index.css` forces all tables to 11px with `!important`. | Leave the shared file untouched; neutralise it with one `.fsg-root` override. Then the CI check scans the module and shell only. |
| **D3** | The requested spacing scale has no 2px, 6px or 10px step, yet **939 uses** (20%) rely on them (`py-1.5` 461, `py-0.5` 239). Snapping them to 4/8px makes every dense row 2-4px taller or shorter and may cost vertical space at 1280×720. | Add two half steps, `--space-0-5` (0.125rem) and `--space-1-5` (0.375rem), and map 10px/14px to the nearest full step. This keeps the 4px base. |
| **D4** | No 16px token exists (`text-base`: 42 uses) and nothing above 20px (`text-3xl` ×2, `text-4xl` ×1 are decorative emoji icons). | Map `text-base` to `--text-md`; move the three big ones to an icon-size token. |
| **D5** | The "More" overflow menu and the density toggle add new controls. Moving an existing control into a menu is allowed; a new density setting adds a persisted preference. | Approve both. Store the density in `localStorage` (presentation preference only), surface it in the FSR Tools/Settings dialog. |
| **D6** | AG Grid sizes (`rowHeight`, `headerHeight`, column widths) are JavaScript numbers in grid code that also holds logic. | Allow a small `rem()` helper that returns `n × root font-size` for those constants only, changing numbers and nothing else. Alternative: leave the grids at fixed px and accept that they do not scale. |
| **D7** | Auto-collapse of the sidebar below 1440px hides item labels, and the existing test collects them from `aside a` text. | Keep the labels in the DOM as visually hidden text when collapsed (also better for screen readers), so the test passes unchanged. |
| **D8** | The window minimum is 1024px (`electron/main.cjs`, protected). | Design and verify from 1280px; 1024-1279 degrades gracefully (single column, icon rail). |

## 8. Risks to the "tests pass unchanged" rule

- **R1: pixel assertions.** Toolbar buttons must stay ≤32px and groups ≤36px in the harness (1400px window, 16px root): a 2rem control is exactly 32px, so there is no slack for a border or padding change. I will measure these before and after rather than assume.
- **R2: the sidebar label test** (D7) and the "menu bar fits at 1280px with the sidebar open" check, which an icon rail only helps.
- **R3: text enlargement.** 10px/11px labels becoming 11.5px can overflow cells that were sized to the smaller text. The report in Step 8 will list any that do.
- **R4: the compact root (15px) makes `--text-xs` 10.8px and `--text-sm` 11.25px** at ≤1366px, below what is comfortable for dense financial text. I suggest a floor: the compact band uses 15px for spacing and controls but keeps text at no less than 11.5px. Your call.
- **R5: AG Grid** reads its sizes once; a density or root change at run time needs the grid refreshed, which is a call into grid code (D6).

## 9. Plan after approval

1. Tokens, root-size breakpoints, role classes and density variables in one token file (`fsr-tokens.css`), imported first.
2. Rewrite `fsr-theme.css` and the `fsg.css` UI blocks to the tokens; remove the px values.
3. Shell: sidebar rail and auto-collapse, 9.5rem chrome, top bar and header to role classes.
4. Statement, form, dialog, toolbar and grid primitives; move screens to them in the order Master, TB, Mapping, Inventory, Dep, BS, PL, CFS, Notes, A/c Policy, Annex, Review.
5. `scripts/check-fsr-typography.cjs` plus an npm script `lint:fsr-ui`: fails on raw px font sizes, font families, raw spacing values, fixed-px layout widths and `100vh`/`vw` outside the token file; exempts the print/export blocks.
6. Verification: re-run this scanner for before/after counts; screenshots at 1280×720, 1366×768, 1536×864, 1600×900, 1920×1080 and 2560×1440 at 100/125/150% scaling and 90/110% zoom into `docs/ui-refresh/responsive/`; a slow-resize sweep from 1280 to 2560; the existing `test:fsg`, `test:fsg-ui`, type-check and lint unchanged; `git diff --stat` limited to presentation files.

Stop point: awaiting your answers to D1-D8 and approval of the tokens and breakpoints.

## 10. Decisions recorded (27 November 2026, user answers in session)

- **D1: FSR module only.** `<html>` font-size is unchanged; the scale is `--fsr-scale` on `.fsg-root` (0.9375 up to 1366px, 1 default, 1.0625 from 1920px, 1.125 from 2560px), and `src/modules/fsg/fsr-scale.css` (generated by `npm run gen:fsr-scale`) re-declares each Tailwind size utility the module uses multiplied by it. The VERA sidebar and top bar keep fixed sizes.
- **D2:** recommendation applied (one scoped override in `fsr-tokens.css`; `src/index.css` untouched).
- **D3: half steps kept** (`--space-0-5`, `--space-1-5`).
- **D4:** recommendation applied (`text-base` to `--fsr-text-lead`, `text-3xl`/`text-4xl` to icon tokens).
- **D5: approved.** Density (Automatic / Compact / Regular / Comfortable) is in FSR Tools, stored in `localStorage` key `vera.fsr.density`; the "More" menu holds Report heading and Focus mode.
- **D6: not selected.** AG Grid row, header and column sizes stay fixed px; the unused helper was removed. Grid cell font sizes use the text token (CSS).
- **D7, D8:** recommendations stand; no sidebar auto-collapse was added in this pass (shell is out of scope under D1).
- **R4: 11.5px floor kept** (`--fsr-text-xs` is `max(..., 11.5px)`).
- Guard: `npm run lint:fsr-ui` (`scripts/check-fsr-ui.cjs`).
