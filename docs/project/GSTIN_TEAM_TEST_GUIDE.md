# GSTIN changes: team test guide

## Builds to compare

- Previous commit: `26d3b9f` (11 November 2026), which identifies the merged GSTIN normalization and validation work in the login and common-header build label.
- This commit: the GSTIN lookup and bulk-validation work on `feat/gstin-lookup-bulk`, plus the consent-help wording requested on 13 November 2026. Resolve its exact commit with `git rev-parse HEAD` after checking out the branch.
- The feature branch starts at `26d3b9f`; fetched `origin/main` had advanced to `8ee2107` at review time. It contains independent changes, including a different task numbered T-024. These are not included in this branch and integration requires a separate review.

## Safe setup

Use a disposable test profile and synthetic client and engagement, never production client records. Do not reset or overwrite an existing database. The application stores more than its database: evidence files and renderer configuration may also matter. Use provider-approved test GSTINs only after confirming the service's terms and authorization. Do not put GSTINs, taxpayer details, or raw provider responses in shared test reports.

Record commit, Windows and Node versions, fixture identifier, test date, expected and actual outcomes, and reviewer. Run `npm run electron:dev` on a free port 8080 and open VERA Tools, then GST Number Master for the test client.

## Previous commit: startup label

1. On the login screen and shared application header, check that the label states `Code baseline: 11 November 2026` and `Update: GSTIN normalization and validation (PR #108)`.
2. Inspect the tooltip for source and build metadata. The label is a build-time identifier, not a live check for the latest GitHub version.
3. With synthetic GSTINs, confirm normalization and invalid checksum rejection in GST entry flows. This commit labels earlier merged validation work; it does not by itself implement the bulk lookup described below.

## This commit: GST Number Master

1. Confirm the explanation reads exactly: `Only GSTINs that pass local structure and checksum checks are sent to API.` It is wording only; the fixed provider endpoint and consent requirement have not changed.
2. Before consent, verify lookup actions cannot send a request. After consent, enter an invalid state code, invalid length, invalid character 14, or incorrect checksum and verify the value is rejected locally. Standard registration character 13 is numeric; special layouts follow the chart recorded in [the task](tasks/T-024-gstin-lookup-bulk.md).
3. With an authorized provider test GSTIN, fetch single details. Check progress, result, taxpayer name where returned, and locally derived registration type. A locally valid GSTIN that the service does not confirm must show the warning, not a fabricated name; a user may enter a name manually for local saving.
4. Download the template and verify the `.csv` extension and `GSTIN` in cell A1. Import CSV, XLS and XLSX fixtures with the `GSTIN` header in A1 and GSTINs in column A from row 2. Verify invalid rows are reported without being sent, duplicates are skipped, and valid rows receive individual outcomes.
5. Check sequential progress and stop-after-current-request behavior. Verify errors are displayed per row, and download the result CSV and inspect its contents and extension. Check formula-like names are escaped in CSV. Do not assume a row labelled confirmed is necessarily confirmed by the provider: see the known issue below.
6. Save eligible test rows locally, reopen the dialog and restart the app. Check duplicates and switch to a different synthetic client to verify client isolation. Verify manual local saving does not require GSTZen create; do not disturb the separate GSTZen login/GSTR-1 flow.
7. Test a rejected lookup and a successful bulk lookup of the same provider-approved test GSTIN. Record whether each supplies a name and a validity flag, without including personal data in shared reports.

## Known limitations and acceptance

- A user reported that the same GSTIN was not confirmed in single lookup but showed a name and confirmation in bulk. The underlying provider responses and the reason for the difference have not been verified.
- The response parser currently treats an object without a recognized `valid` or `isValid` flag as valid. Therefore the bulk confirmation label and exported rows are not proof of provider verification until the response contract and this gap are resolved.
- Automated checks are not owner acceptance. Provider terms, rate limits, authenticated UI flows, persistence, client isolation and full UAT remain to be verified. Report failures separately and do not mark the feature accepted merely because a build passes.

For automated checks run `node --test scripts\test-gstin-lookup.cjs scripts\test-export-file-options.cjs`, `npx --no-install vitest run src\lib\gstinValidation.test.ts src\lib\gstinSpreadsheet.test.ts src\lib\buildInfoLabel.test.ts`, and `npm run docs:check`. Native prerequisites and broader validation are described in [the testing guide](TESTING.md).
