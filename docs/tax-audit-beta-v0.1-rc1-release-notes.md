# Tax Audit Beta v0.1 RC1 Release Notes

## Release Label

Tax Audit Beta v0.1 RC1  
AY 2025-26 | Rule 6G | Forms 3CA, 3CB and 3CD  
Phase 1: Structured Tax Audit Workflow

## Pilot-Only Warning

This release candidate is for controlled pilot testing by selected CA firms. The Tax Audit module assists in documentation and review. It does not replace the auditor's professional judgment, audit procedures or responsibility for the final tax audit report.

Pilot users should avoid using confidential client data unless specifically permitted by ICAI or their firm. Use dummy data or anonymised data where possible.

## Feature Scope

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

## Installation Notes

- Packaging owner must confirm installer creation for the supported Windows environment.
- Electron version: `^40.0.0`.
- better-sqlite3 version: `^12.6.2`.
- Native rebuild command if required: `npx electron-rebuild -f -w better-sqlite3,bcrypt`.
- Confirm no `better-sqlite3` native module error occurs on startup.
- Confirm no blank screen occurs on startup.

## Uninstall and Data Retention

Pilot data is expected to persist across app restart. The packaging owner must confirm whether uninstall preserves or removes local pilot data. Uninstall must not silently delete pilot data unless that behavior is intentional and disclosed to pilot testers.

## Feedback Process

For every issue, capture:

- Firm name.
- Tester name.
- Date.
- Operating system.
- App version.
- Tax Audit module version.
- Module/tab.
- Steps to reproduce.
- Expected result.
- Actual result.
- Screenshot, if possible.
- Severity: blocker / major / minor / suggestion.

## Installer Smoke Checklist

- [ ] Install app on a clean Windows machine.
- [ ] Open app.
- [ ] Create or open tax audit engagement.
- [ ] Save setup and applicability.
- [ ] Save acceptance checklist.
- [ ] Save compliance tracker.
- [ ] Save one Form 3CD structured clause row.
- [ ] Save one Audit Programme item.
- [ ] Save Professional Responsibility acknowledgement.
- [ ] Open Review Summary.
- [ ] Check Report Readiness.
- [ ] Preview Working Paper Report Pack.
- [ ] Download Markdown.
- [ ] Close app.
- [ ] Reopen app.
- [ ] Confirm saved data persists.
- [ ] Confirm no `better-sqlite3` native module error.
- [ ] Confirm no blank screen on startup.
