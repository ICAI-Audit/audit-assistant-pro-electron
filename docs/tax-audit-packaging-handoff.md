# Tax Audit Packaging Handoff

## Beta Identity

- Product area: ICAI Audit Tool - Tax Audit module.
- Beta label: Tax Audit Beta v0.1 RC1.
- Scope: AY 2025-26, Rule 6G, Forms 3CA, 3CB and 3CD.
- Phase: Phase 1 - Structured Tax Audit Workflow.

## Current Feature Scope

- Tax Audit setup and applicability.
- Acceptance and eligibility checklist.
- Compliance tracker.
- Manual structured capture for active Form 3CD clauses 1 to 44.
- Review Summary.
- Report Readiness.
- Audit Programme and Checklists.
- Professional Responsibility and Disclaimers.
- Working Paper Report Pack with Preview, Copy Summary and Download Markdown.

## Known Limitations

- Final statutory Form 3CD generation is not part of this beta.
- Portal filing is not part of this beta.
- PDF, Word and Excel export are not part of this beta.
- GST, TDS and purchase register imports are not part of this beta.
- Structured clause capture is manual and requires professional review.
- Working Paper Report Pack is an internal working paper summary, not a signed report.

## Validation Commands Passed

Run these before packaging the pilot build:

```bash
npx.cmd tsc --noEmit --pretty false
npx.cmd vitest run src\lib\taxAuditReportPack.test.ts src\lib\taxAuditReportReadiness.test.ts src\lib\taxAuditProgramme.test.ts src\lib\taxAuditDisclaimer.test.ts
npx.cmd eslint src\pages\TaxAudit.tsx src\lib\taxAuditReportPack.ts src\lib\taxAuditReportPack.test.ts src\lib\taxAuditReportReadiness.ts src\lib\taxAuditReportReadiness.test.ts src\lib\taxAuditProgramme.ts src\lib\taxAuditProgramme.test.ts src\components\tax-audit\AuditProgrammePanel.tsx src\components\tax-audit\ProfessionalResponsibilityPanel.tsx src\data\taxAuditDisclaimers.ts src\data\taxAuditProgrammeChecklist.ts
npm.cmd run build
```

## Native Module Packaging Note

- Electron version: `^40.0.0`.
- better-sqlite3 version: `^12.6.2`.
- Native rebuild command if required: `npx electron-rebuild -f -w better-sqlite3,bcrypt`.
- The package already defines a postinstall rebuild for `better-sqlite3` and `bcrypt`; packaging owner should still confirm native modules load in the packaged app.
- Expected local database behavior: existing local data should persist across app restart and should not be silently deleted during uninstall unless intentionally configured and disclosed.

## Packaging Owner Checklist

- [ ] Packaging owner or vendor confirms installer creation.
- [ ] Confirm package version and release label before installer build.
- [ ] Confirm native modules are rebuilt for Electron, especially `better-sqlite3`.
- [ ] Confirm production installer excludes source maps unless they are explicitly required.
- [ ] Confirm local database persists across app restart.
- [ ] Confirm app uninstall does not silently delete pilot data unless intended and disclosed.
- [ ] Confirm pilot build can be installed on the supported Windows environment.
- [ ] Confirm auto-updater channel behavior, if pilot builds use update distribution.

## Smoke Validation Before Packaging

- [ ] Fresh install opens.
- [ ] Existing local database opens.
- [ ] Create engagement.
- [ ] Save Tax Audit setup.
- [ ] Save clause response.
- [ ] Save Audit Programme item.
- [ ] Save Professional Responsibility acknowledgement.
- [ ] Generate Working Paper Report Pack.
- [ ] Close and reopen the app.
- [ ] Verify data remains available after restart.

## Pilot Testing Recommendation

Run the pilot with dummy or anonymised data unless ICAI or the firm has specifically permitted use of confidential client data. Start with selected CA firms and require issue reports to include app version, Tax Audit module version, operating system, tab/module, reproduction steps, expected result, actual result and severity.

## Release Notes Draft

Tax Audit Beta v0.1 RC1 provides a structured tax audit workflow for AY 2025-26 covering setup, applicability, acceptance, compliance tracking, active Form 3CD clause capture, review summary, readiness checks, audit programme, professional responsibility acknowledgement and internal working paper report pack. This beta is intended for controlled pilot testing and does not generate final statutory forms or perform portal filing.
