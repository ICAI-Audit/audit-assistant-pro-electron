# Verify report drafts and exported documents

## When to use

Use for reports, letters, statement packs, Form 3CA/3CB/3CD, or preview/export changes.

## Read before acting

Read the affected setup, saved document hooks, preview builder, export code, feature record and statutory version. Identify whether edits or generated content take precedence.

## Procedure

1. Fix a synthetic input snapshot containing client, period, currency, signatory, source figures, qualifications and review state. Define expected wording and totals.

2. Save edits, reopen and generate preview and each affected format from the same snapshot. Verify empty, not-applicable, missing-data and long table/text cases.

3. Check field provenance, note numbering, signs, rounding, headers, signature data, page breaks, escaping and warnings. Inspect actual exported pages and editable content rather than only the builder object.

4. Compare formats for consistent values and preserved edits. Test cancellation and failed writes. Record output names and hashes when a reproducible artefact is required.

5. Retain draft labels until the agreed approval conditions are met. Portal compatibility and signing are separate scopes. Update old documentation that contradicts newly verified output.

## Required result

Preview-to-export reconciliation and visual/functional evidence per format. A unit test of generated text does not validate final pagination.

## Shared records

Use the [project index](../README.md), [task template](../templates/TASK.md) and [handoff template](../templates/HANDOFF.md). Follow [shared instructions](../../../AGENTS.md).
