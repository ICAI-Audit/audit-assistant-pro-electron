# T-023: Firm profile default for financial-statement signing place

- Request and approval: user instruction on 10 November 2026 to replace the default Siliguri with the firm's Place, keeping Signing Place editable. Clarification explicitly selected **VERA Settings/Admin Settings → Firm**, not FSG's independent auditor masters.
- Features: F-002 (firm master), F-009 (financial-statement export).
- Source branch/base: `RSF`, `d86bd938be58122683691a8270d291110b279583`.
- State: implemented; validation results are in [current status](CURRENT_STATUS.md). Owner UAT remains pending.

## Field and behavior contract

`firm_settings.place` is nullable TEXT, without a hard-coded city. Settings → Firm and Admin Settings → Firm both load/save it; surrounding whitespace is trimmed and blank is stored as NULL. Existing firm read/write permissions apply: authenticated reads and partner/admin writes, enforced by the existing SQLite authorization layer. No new IPC channel or permission is introduced.

Financial Statement Review → Generate Financials reads this field through `useFirmSettings`. It prefills Signing Place for PDF/Excel confirmation. Blank/missing Place leaves the input empty; the existing non-columnar export validation requires a signing place before continuing. Columnar export retains its existing confirmation behavior.

The user can override Signing Place without altering the firm profile. That edit lasts in the mounted Generate Financials screen for the current auditor/client/year context and survives cancellation/reopening of its dialog. Remounting/restarting uses the saved firm default again. The legacy global `localStorage['fsg.signPlace']` value is no longer read or written; it is not deleted. A finalised year continues to use its database-recorded place/date and disabled inputs. Existing finalisation/locking policy is unchanged.

All existing PDF/Excel variants and local snapshot payloads consume the same effective signing place. No financial calculation, mapping, sign convention, legal wording or auditor-master identity is changed.

## Upgrade and recovery

Fresh databases declare `place` in `01_core_tables.sql`. Existing installations run `electron/firm-place-migration.cjs` immediately after core schema initialisation. It checks `PRAGMA table_info`, writes a complete SQLite backup with `VACUUM INTO` to `<userData>/backups/audit_assistant-before-T023-firm-place-<timestamp>.db`, then adds the nullable column in a transaction. Existing records remain unchanged and receive NULL Place.

A failed backup leaves the old schema unchanged. A failed ALTER rolls back and can be retried on startup. Repeat startup skips the upgrade when the column exists. To rehearse recovery, close the isolated test database, restore the backup to a separate file/profile and retry the upgrade. The integration harness exercises this flow with synthetic firm details and signed balances. This SQLite migration backup is not a complete application/evidence/localStorage backup.

## Acceptance and validation

- Both Firm screens save/reload the same Place.
- The profile value overrides a legacy Siliguri preference.
- Manual signing edits do not change the profile and survive dialog cancellation.
- Restart restores the firm default.
- A finalised year keeps its recorded place.
- An empty profile Place does not manufacture a city.
- Fresh/upgrade/idempotence, backup failure, interrupted ALTER, restored backup and retry preserve existing records and balances.

Checks: `npm.cmd run test:fsg`, `npm.cmd run test:fsg-ui` (or its Node harness after a successful production build), explicit TypeScript check, focused lint, `npm.cmd run docs:inventory`, `npm.cmd run docs:check`, and `git diff --check`. Runtime suites use isolated synthetic profiles. Actual PDF/Excel file content and pagination, installed-profile upgrade and owner UAT remain unverified.
