# Change financial data and calculations

## When to use

Use for TB import, classification, materiality, statement totals, notes or financial export calculations.

## Read before acting

Read the active FinancialReview imports, classificationRules, trialBalanceNewClassification, relevant hooks, calculation utilities, financialExport, materiality logic and existing tests. Read the requirement and professional source if the formula is statutory.

## Procedure

1. Define source balance, debit/credit convention, period, currency, scaling, precision, rounding, zero/null meaning and override precedence. Record input and expected output examples before editing.

2. Trace totals from imported rows through grouping and adjustment to displayed and exported amounts. Keep imported values distinct from presentation and classification. Never alter original balances to balance an output.

3. Use synthetic fixtures covering positive/negative balances, zero activity, duplicates, prior period, contra balances, stock and unmapped ledgers. Include a case that should remain unchanged.

4. Assert row counts and financial reconciliation, including balance-sheet equality where the fixture requires it. Test manual overrides, repeated import and save/reopen behaviour.

5. Compare preview and export totals and identifiers. Require professional review for judgement or statutory rule changes; record a remaining question rather than inventing its answer.

## Required result

A documented calculation contract, reconciled expected outputs and focused regressions. A successful build is not financial accuracy evidence.

## Shared records

Use the [project index](../README.md), [task template](../templates/TASK.md) and [handoff template](../templates/HANDOFF.md). Follow [shared instructions](../../../AGENTS.md).
