# PDF Tools (T-031, F-030)

Status: **revision 3 (14 November 2026): phase 1 is implemented and committed on branch `feat/pdf-tools`, which is pushed to `origin`; no pull request is open and nothing is merged to `main`.** The owner gave the go-ahead to commit and push on 14 November 2026. It has not been accepted by the owner and no UAT has been done. It has seven tools (Merge, Split, Delete pages, Compress, Page numbers, Images to PDF, PDF to images), opening of password-protected files, and four destinations (Save to computer, Evidence Vault, working paper, and the activity log entry written for each). Phases 2 and 3 are not started. **Checked by automated tests on 14 November 2026:** unit tests of the PDF functions and the screen logic (43 files, 892 tests passed in the two PDF Tools folders), and an application test in the real application on a throw-away profile with synthetic data (32 of 32 checks passed); the same application test against an unpacked Windows package built in a scratch copy passed 31 checks with 1 skipped (the download fallback). Section 9 lists what the application test covers. **Not verified, and still to be checked by hand by the owner:** the native save and folder dialogs, including cancelling them, the "name (2).pdf" numbering and choosing Desktop, Documents and Downloads themselves (accepted in a probe with the real window; to be confirmed in the application); dragging files in from the desktop; a screen-reader pass; opening the results in Acrobat or another PDF reader (results were compared in pdf.js only); real Word, Excel and scanner files; the largest sizes (a 300 MB list, 500 pages, 200 images); the installed package (the package was built in a scratch copy, not installed or published); and owner UAT. Full results, including one failed run and its cause, are in `CURRENT_STATUS.md` and `SESSION_HANDOFF.md`. Written on branch `feat/pdf-tools`, first from `main` at `26d3b9f37a9f3aadd8b3d5bf456538e195a60a67`; the branch now sits on `main` at `8ee2107`. One defect, saving to a folder failing with "A save window is already open", was found by this hand check after the automated tests had passed, because the tests replace the native windows; it is fixed by a listener in `electron/main.cjs` (section 6) and re-verification is recorded in the records. Section 11 lists the known limits and section 12 the application problems found on the way that this feature does not change.

Revision 3 changes only what the build made untrue or left out: the compression values, the page-number preview, the way the screen is mounted, how dependencies were added, where the destinations are offered, what each tool carries over, how cancelling works, how results are recorded, and the limits found while building.

Request source: the VERA Tools meeting of 2 November 2026 (action point 6, "PDF Tools", lead Abhishek) and the lead's instructions of 13 November 2026. Revision 2 records the lead's review of revision 1: a premium-grade tool; results saved as PDFs, not zipped; three compression levels; password-protected files accepted when the user gives the password; page numbering, images to PDF and PDF to images added; every item of the meeting draft specified here, not only the first phase.

Items marked **(design call)** were decided by the author of this document, not by the lead or owner, and are open to change at review.

## 1. Why

Auditors receive client documents as PDFs and scans: confirmations, bank statements, agreements, signed financials. Preparing them for the audit file is done today in outside tools, often online ones, which sends client data out of the firm. PDF Tools does that work inside VERA, offline, to the standard of a paid desktop PDF product, and lets the result go straight into the engagement's Evidence Vault or onto a working paper.

## 2. Behaviour before this change

This section describes `main` as it was when the design was written. Phase 1 replaces the inline PDF Tools code described here, so the defects listed below do not apply to the new screen.

- VERA Tools (`/audit-tools`, `src/pages/AuditTools.tsx`) has a "PDF Tools" tab. Its code is the inline `PDFTools` component, about 700 lines of the 3,925-line page.
- Merge and Split work, using `pdf-lib` in the renderer. Six cards (Word to PDF, Excel to PDF, Redact PII, OCR, Compress, Watermark) are "Coming Soon" placeholders.
- The only output is a browser download. Nothing can be read from or saved to the Evidence Vault.
- Known defects: files cannot be reordered before a merge; an encrypted PDF fails with a raw library error; the `.pdf` suffix is removed case-sensitively; "split every N pages" raises one download per part; closing the dialog leaves split settings behind.

## 3. Scope: every item, and when it is delivered

| Meeting draft item | Tool in this design | Phase |
| --- | --- | --- |
| Screen: tools on top, files below, select file then action | Section 4 | 1 |
| Organise: Merge | Merge | 1 |
| Organise: Split | Split | 1 |
| Organise: Delete | Delete pages | 1 |
| Organise: Compress size | Compress, three levels | 1 |
| Prepare: Paginate | Page numbers | 1 |
| Prepare: Redact, Remove PID, Replace PID | Redact | 2 |
| Prepare: Bookmark | Bookmarks | 2 |
| Convert: PDF to Excel | PDF to Excel | 3 |
| Convert: PDF to Word | PDF to Word | 3 |
| Convert: Scanned PDF to OCR PDF | Make searchable (OCR) | 3 |
| Review (heading with no content in the draft) | Proposal in section 5.13; needs the owner to define it | 3 |
| Added by the lead, 13 November | Images to PDF; PDF to images; open password-protected files | 1 |
| Added by the lead, 13 November | Send results to Evidence Vault or working paper; take input from the vault | 1 |

Each phase is one pull request. Phase 1 is specified to build-ready detail. Phases 2 and 3 are specified for behaviour here and get a build check against this document before their own work starts.

### Not included

- Word to PDF, Excel to PDF and Watermark. They are on today's screen but not in the meeting draft. They stay visible as "Coming soon", because the owner decision of 2 November 2026 (T-022) is that no visible placeholder is removed.
- Changes to Evidence Vault rules: the vault has no file hashing or versioning and does not enforce its lock in the main process; all of that stays as it is (T-016).
- Any database table or column.

### Must never happen

- A source file is altered. Every operation produces a new file; a vault record is never overwritten.
- A document, a password, or any part of either leaves the machine. Passwords are never stored or logged.
- A file from one engagement becomes visible or usable after switching to another engagement or user.
- A tool reports success while producing a damaged or silently incomplete file.
- A redacted file still contains the redacted text anywhere inside it.

## 4. The screen

The PDF Tools tab keeps its place in VERA Tools (fifth of six tabs, shortcut Ctrl+5, deep link `?tab=pdf`). The meeting's layout is followed: tools on top, files below, select files and then the action.

**Top: tools**, grouped under Organise, Prepare, Convert, Review. Tools not yet built are shown inline as compact, muted "Soon" buttons that cannot be used (owner decision T-022). Phase 1 shows nine such tools: Redact, Bookmarks, Watermark, PDF to Excel, PDF to Word, Make searchable, Word to PDF, Excel to PDF and Review. A tool button is enabled only when the current selection suits it, and says why when it is not (for example "Select at least two files to merge").

**Middle: files.** One list of the working files, each row showing a first-page thumbnail, name, where it came from (Computer, Evidence Vault, or Result), page count, size, a lock icon if it was password-protected, and a checkbox. Two ways to add:

- **Add from computer**: file picker or drag and drop. PDFs, and images for Images to PDF.
- **Add from Evidence Vault**: a dialog listing the current engagement's vault files that are PDFs or images, with search by name. Locked and approved files may be used as input, since input is read-only.

Rows can be moved up and down (this is the merge order) and removed from the list. Removing a row never deletes a vault file.

**Page view.** Selecting a file opens a page panel with a thumbnail of every page and its page number. Tools that work on pages (Split, Delete pages, PDF to images, Redact) let the user pick pages by clicking thumbnails as well as by typing a list such as `1-5, 8`; the two stay in step.

**Results** appear in the same list, marked "Result", and can be selected as input to another tool, so a user can merge, number and compress without saving in between. The destinations of section 6 are offered on the selection bar above the list, for the rows that are ticked, not on each row. The row shows a badge for each destination it has reached; a result that has not been sent anywhere is marked "Not saved".

The list lives in memory only, and belongs to one user in one engagement **(design call)**:

- It survives moving to another VERA Tools tab or another screen and coming back.
- It is emptied when the engagement changes or the user signs out. While the PDF Tools screen is open this happens before anything from the new context is shown. While the screen is closed, a watcher inside the PDF Tools code clears the list within about one second (section 11).
- It is lost when the application closes. Nothing is written to localStorage or disk until the user chooses a destination.

## 5. The tools

### 5.1 Rules common to all tools

- A file is checked when added: a PDF must parse and have at least one page; an image must decode. Otherwise it is rejected with the file name in the message.
- **Password-protected PDFs.** When a protected file is added, the user is asked for its password. A wrong password can be retried or the file skipped. Once opened, the file works in every tool.
  - The password is held in memory for that file only, and is never stored, logged or written to the activity log.
  - A result made from a protected file is **not** password-protected. The user is told this at the time, and the result row says "Protection removed".
  - A file that opens without a password but carries its author's restrictions (no editing, no copying) is opened with a notice that it carries restrictions.
  - A file protected only by an owner password (so it opens without asking) has those restrictions removed in the copy PDF Tools makes. The notice says protection was removed; the original file is unchanged. Only use PDF Tools on such a file if you are entitled to remove its restrictions.
- If a source contains a digital signature, the user is warned before the operation that the result will not carry a valid signature. The operation is still allowed. A signed input is marked "Signed". Every result made from a signed source, whichever tool made it (Merge, Split, Delete pages, Compress or Page numbers), and every later result made from such a result, is marked "Signature no longer valid" (hint: "Made from a signed file. The signature in this copy is no longer valid. The original signed file is unchanged."). The mark is cautious: a part of a split file that holds no signature is marked too. The activity record carries the flag `signatureInvalid` and the note "; signature no longer valid".
- While a tool runs, progress is shown and the run can be stopped. Stop always asks for confirmation, so that one key press does not lose minutes of work. Compress and PDF to images stop part-way, after the confirmation. Split into parts of N pages shows "Splitting… part n of N" and stops between parts. Delete pages and Split by range or by selected pages show "Taking out the pages (n of N)…" or "Copying the remaining pages (n of N)…" and stop between pages. Merge, Page numbers and Images to PDF stop only between steps: the step in progress finishes, and then nothing is added. Reading a very large file and writing the result are single steps that a Stop waits for. A failure or a stop leaves the list as it was and produces no result row.
- Every result file carries the document properties Producer and Creator "ICAI VERA". A result of Split or Delete pages also keeps the source's title, author, subject, keywords and creation date; a merged file keeps none.
- Every result file carries the document properties Producer and Creator "ICAI VERA". A result of Split or Delete pages also keeps the source's title, author, subject, keywords and creation date; a merged file keeps none.
- Default result names are suggested and editable (section 6 covers the rules).

### 5.2 Merge (phase 1)

Combines two or more selected files in list order into one file. Images in the selection are included as pages. Default name: `<first file name>_merged.pdf`.

What is not carried over: form fields, bookmarks and links between pages of the source files. The dialog says so, naming the files, only when a chosen file has them (for form fields: "Filled-in form fields are not carried into the merged file; the values may not be shown"). The result's activity record is flagged "form fields not carried" or "bookmarks not carried". From phase 2, a bookmark is created for each source file at its first page.

### 5.3 Split (phase 1)

Works on exactly one file. Three modes:

- **Page range**: from page A to page B, giving one file. Default name `<name>_pages_A-B.pdf`.
- **Every N pages**: consecutive parts of N pages, giving several files named `<name>_part_01.pdf`, `_part_02.pdf` and so on.
- **Selected pages**: thumbnails clicked or a list such as `1-5, 8, 10-12`, giving one file with those pages in the order written.

Validation: page numbers are whole numbers from 1 to the page count; a range's start is not after its end; N is at least 1 and less than the page count. Invalid input is explained next to the field and the tool does not run. A page listed twice is included twice **(design call)**.

What Split and Delete pages carry (section 5.4 as well). Split and Delete pages copy only what the kept pages use, so the left-out pages' content, comments, annotations, form values, and the images, drawings and layers that only they use are not copied (tested on generated files covering shared and inherited resources, nested forms, patterns, soft masks, Type 3 fonts, layers, comments with replies and signature fields). **This is not redaction.** Fonts shared with kept pages and the form's default resources are copied whole, a resource whose name a kept page happens to contain is kept, a few non-standard structures are copied as they are, and when a page cannot be read with certainty its resources are kept whole. Do not use Split or Delete pages to remove sensitive content from a file; redaction with a guarantee is phase 2 (section 5.9).

Each kept page is given only the resources (images, fonts, graphics settings, colour spaces, patterns) that its drawing may use. When a page cannot be read with certainty, for example an unsupported stream filter, a stream that is not a stream, a resource of an unexpected kind, a non-standard resource key, a name the PDF library does not read exactly, references nested deeper than 32, or an unknown layer setting, its resources are kept whole and the result is marked. The row shows the tag "May hold left-out pages' images" (hint: "Some pages could not be read with certainty, so everything they could draw with was kept. The file may still contain images or fonts from pages that were left out."), a warning message says "Some pages could not be read with certainty. The file may still contain images or fonts from pages that were left out.", the activity summary ends "; may still contain images or fonts of left-out pages", and the record carries the flag `sharedResourcesKept`.

Carried: the form fields that sit on the kept pages, with their values and stored appearances (and the settings that make a viewer draw a field that has no stored appearance); a field keeps only its parts on kept pages, and a field only on removed pages is dropped. Layers are carried with their default visibility. Links to kept pages keep working. Dropped: signature fields as form fields (their visible mark stays on the page); links to left-out pages; article threads; structure destinations; a reply's link to a comment that was on a removed page (the reply stays as its own comment) and popups whose parent was on a removed page. Not carried: bookmarks; links by name may not work. The dialogs say so when the file has bookmarks or links, and the activity record is flagged `bookmarksDropped`.

Test measurements on this machine, single runs, not repeated: a generated 300-page scan of 1.85 MB with one image shared by many pages gave 6,088 bytes for one extracted page (1,259,177 bytes before the per-page resources were added) and 1.3 s and 1.8 MB in total for Split every page (57 s and 378 MB before); deleting one page of a 2,000-page generated file took 5.3 s with a peak of 263 MB of memory (15.3 s and 1,370 MB before). A 30-page scan in the application: Delete pages 2 to 30 gave 41,106 bytes holding only page 1's image.

### 5.4 Delete pages (phase 1)

Works on exactly one file. The user marks pages on the thumbnails or types a list; the result is the file without them, in original order. Default name `<name>_pages_removed.pdf`. Removing every page is refused. Form fields, bookmarks, links and signature fields are handled as described in section 5.3.

### 5.5 Compress (phase 1)

Works on one or more files, each giving its own result. Default name `<name>_compressed.pdf`.

Three levels, the pattern users know from market PDF tools:

| Level | Image resolution limit | Image quality | Meant for |
| --- | --- | --- | --- |
| Low compression | 200 dpi | High (JPEG quality 0.82) | Documents that will be printed or read closely |
| Recommended (default) | 150 dpi | Medium (JPEG quality 0.68) | The audit file; clear on screen |
| Extreme | 96 dpi | Low (JPEG quality 0.45) | Emailing; small text in scans may become hard to read |

How it works **(design call)**: images inside the file are reduced to the level's resolution and re-encoded. Resolution is worked out as if each image filled its page, which is exact for scans and errs towards keeping more detail for small images set within a page; the file is then re-saved in a compact structure. Text, fonts and line drawings are not touched, so text stays selectable and sharp at every level. The quality figures in the table are those built into `src/lib/pdf-tools/compress.ts`. Image orientation data and colour profiles are not applied when an image is re-encoded, so pages do not turn or change colour.

Rules:

- An image is replaced only if its new encoding is under 90% of the old size. Black-and-white fax-style scan images are already compact and are left as they are.
- The result shows original size, new size and percentage saved.
- If a level gives a file less than 1% smaller, no result is produced and the user is told the file is already compact at that level.
- Acceptance check: a 20-page colour scan at 300 dpi must come out at least 50% smaller at Recommended with body text still readable at 100% zoom, and each level must be smaller than the one above it.

### 5.6 Page numbers (phase 1)

Adds page numbers to one file. Default name `<name>_numbered.pdf`. Options:

- **Position**: bottom centre (default), bottom left, bottom right, top centre, top left, top right, with a margin setting.
- **Format**: `1`, `Page 1`, `1 of N`, `Page 1 of N`, or custom text with a prefix and suffix (for example a working-paper reference: `WP-A1 / 1`).
- **Start number** (default 1) and **which pages**: all, or from page X to page Y, so a cover page can be left unnumbered.
- **Font size and colour** (default 10 pt black).
- A live preview inside the Page numbers dialog before applying: a small preview of the first numbered page and a close-up of the number's position. It is not shown on the page panel.

Numbers are placed relative to each page's own size and rotation, so mixed portrait, landscape and rotated scans all come out right. Existing page content is not changed.

### 5.7 Images to PDF (phase 1)

Turns one or more selected images into one PDF, one image per page, in list order. Accepts JPG, PNG, WebP, BMP and GIF (first frame). TIFF is not accepted **(design call: the application cannot decode it without another library)**. Options: page size (A4 turned to suit each image, which is the default; same size as each image; A4 portrait; A4 landscape) and margin (default 28 pt, 0 to 279 pt; none for "same size"). A phone photo's stored rotation is honoured. A margin that leaves less than 36 pt of usable area is refused, and "same size" pages are limited to 14,400 pt so that PDF readers accept them. Default name `<first image name>.pdf`.

### 5.8 PDF to images (phase 1)

Turns pages of one file into images, one per page. Options: all or selected pages; PNG or JPG; resolution 100, 150 (default) or 300 dpi. Results are named `<name>_page_001.png` and so on, and are grouped under one result row that expands to show them. Images can be saved to the computer or added to the Evidence Vault like any other result.

### 5.9 Redact (phase 2)

Permanently removes sensitive information from one file. The meeting draft's two actions:

- **Remove**: the area is blacked out.
- **Replace**: the area is covered and replacement text is printed over it, for example a masked value (`XXXXXX234F`) or a label (`[PAN redacted]`).

How the user marks what to redact:

- **Find personal data automatically.** The file's text is searched for PAN, Aadhaar number, GSTIN, mobile number, email address, bank account number with IFSC, and any words or numbers the user types in. Every match is shown as a proposed box on the page, with a list the user can tick or untick. The patterns reuse the application's existing PAN and GSTIN validation where it exists.
- **Draw by hand.** The user drags a box over any area of a page. This is the only way on scanned pages until they have been made searchable (5.12).

Nothing is redacted until the user reviews the boxes and confirms.

How removal is guaranteed **(design call)**: each page with a redaction is rebuilt as an image with the boxes burned in, so the original text and image data under a box no longer exist in the file. The cost is that text on those pages is no longer selectable; pages without redactions are unchanged. Document properties (title, author, subject, keywords) are cleared. After writing, the tool re-reads the result and confirms that none of the redacted text can be found; if any can, the result is discarded and an error shown.

Default name `<name>_redacted.pdf`. The activity log records how many areas were redacted on how many pages, and never the redacted values.

### 5.10 Bookmarks (phase 2)

Shows the file's bookmark list beside the page panel. The user can add a bookmark for the current page, rename, reorder, nest one level, and delete. Merge gains an option, on by default, to create a bookmark per source file. Default name `<name>_bookmarked.pdf`.

### 5.11 PDF to Excel and PDF to Word (phase 3)

Both work from the text in the file; a scanned file must be made searchable first, and the tool says so.

- **PDF to Excel.** Text is placed into rows and columns by its position on the page, one worksheet per page or all pages on one sheet (user's choice). Numbers are written as numbers where they parse unambiguously, with Indian digit grouping understood. A preview of the detected table is shown before saving. Stated limit: tables without clear column alignment may need tidying.
- **PDF to Word.** Text is written as paragraphs and simple tables in reading order, with headings and page breaks kept. Stated limit: it is an editable text version, not a copy of the page layout.

Results are `.xlsx` and `.docx` files and go to the same three destinations.

### 5.12 Make searchable, OCR (phase 3)

Turns a scanned file into one whose text can be searched, selected and used by Redact and the Convert tools. The pages look the same; recognised text is added invisibly behind them. Recognition runs on the machine with the language data shipped in the installer: English and Hindi **(design call; other languages on request, each adds to the installer size)**. Pages that already have text are skipped. Default name `<name>_searchable.pdf`. The result reports pages processed and a confidence figure per page, so the auditor knows not to rely blindly on recognised numbers.

### 5.13 Review (phase 3, proposal)

The meeting draft has the heading only. Proposed content, for the owner to accept, change or drop **(design call)**:

- **Document check**: pages, size, whether it is password-protected, digitally signed (and by whom, as stated in the file), has searchable text, and its properties and dates.
- **Compare two versions**: pages whose text differs between two PDFs, listed with the differing text, for example a draft and a signed set of financial statements.

### 5.14 Limits

Combined size of files in the list: a warning above 150 MB, and adding is refused above 300 MB, and a run whose results would take the list over 300 MB adds nothing **(design call; the application enforces no file-size limit elsewhere, and these files are held in memory)**. A 300 MB merge to confirm these figures has not yet been run.

## 6. Where results go

Each result can be sent to any of the three destinations, more than once.

### Save to computer

- **One result**: a save dialog; the file is saved as a PDF (or its own type for images, Excel and Word).
- **Several results**: the user picks a folder once, and each result is saved into it as its own file. An existing file of the same name is never overwritten silently; the new file gets a numbered suffix such as `name (2).pdf`.
- "Save as one zip" is offered as an extra for several results, for emailing. It is never the default.

The row is marked "Saved to computer" only when the save is known to have completed; a cancelled dialog changes nothing. Any file in the list, not only a result, can be saved to the computer; the activity record then reads "Copy of a file from the computer" or "from the Evidence Vault" (and "without its password" for a protected file).

The folder window: the user's own Desktop, Documents and Downloads folders, and anything inside them, can be chosen. Any other folder that Chromium treats as restricted (the profile root, AppData, Windows, Program Files) is refused by a listener in `electron/main.cjs`; the pick then ends as "no folder" and a quiet note appears once: "Nothing was saved. No folder was chosen. Windows and program folders cannot be used for saving; choose another folder, such as Desktop or Documents." The note also appears if the folder window ends without a folder for any other reason, and it is withdrawn if a folder is then chosen. Only the latest click's save gives the note, and Save As and zip saves never do. As safety nets: if the save or folder window does not answer within 10 seconds, the Save button is released so that it can be pressed again (the screen is never blocked as a whole); and if the browser refuses to open a second picker, the message "A save window is already open. Finish or close it, then try again. If no save window is open, restart the application." is shown, nothing is saved, nothing is marked, and the file is never silently downloaded instead. Verified with the real folder window in a throw-away probe; the owner is to confirm it through the application (section 9).

If the pickers are not available, the file is sent as an ordinary download. A download cannot tell the application whether it was saved (Electron may show its own Save As window, which can be cancelled). The row is then marked "Sent to download", not "Saved", and the activity record says "Computer, by download (completion not confirmed)".

How it is built **(design call)**: the application's present downloads cannot tell whether a save completed, and its export channel forces a Word file name. The browser's save-file and folder pickers are used, with the download fallback above. They were found to be present in the development build and when the page loads from `file://`. No main-process save handler was added; the only main-process change is the folder-access listener described above (section 8). The real native windows are not covered by the automated test.

### Add to Evidence Vault

A small form for the ticked results: a name for each (default: the result name), one evidence type for all (the vault's existing five types, default "Document"), and an optional working-paper reference. This destination takes results only; a file added from the computer or the vault is already a file the user has, so it is left out, and the dialog says how many were left out. Saving uses the vault's existing upload path, so the file belongs to the current engagement, is recorded as uploaded by the current user, starts in draft, and appears in the Evidence Vault like any other upload. Files are sent one at a time, with progress and a Stop that finishes the current file. The shared upload code shows its own "File uploaded successfully" message for each file, with no file name.

The row is then marked "In Evidence Vault" (its hint names the vault record). The form warns when this engagement's vault already has a file of the same name, and when the result is already in the vault ("Adding it again keeps a second copy"), but does not block **(design call)**. Names repeated within one batch get " (2)", " (3)".

### Attach to working paper

In this application a working paper attachment is a file on an Audit Execution programme, on one of its sections, or on a working box inside a section, and it always points at a vault file. So this destination saves to the Evidence Vault first (same form as above) and then attaches.

If the result is already in the Evidence Vault, that vault record is attached and no second copy is uploaded. Attaching the same result to a second programme, section or box also reuses the one record. Before reusing a vault record, the application checks that it still exists in the vault list. If it has been deleted in the Evidence Vault screen, the "In Evidence Vault" mark is cleared and the vault form is shown first. Like Add to Evidence Vault, this destination takes results only.

The user picks the programme, then optionally a section, then optionally a box. If the engagement has no audit programme, the option is disabled with an explanation. Sections and boxes marked locked are shown but cannot be chosen **(design call: the main process does not enforce these locks today, and PDF Tools should not be a way to add material to locked work)**.

If the vault save succeeds and the attachment fails, the file stays in the vault and the row is marked "In Evidence Vault". The user is told the attachment failed and can retry it from the same row, or attach from Audit Execution. The vault record is not rolled back, because it is valid evidence.

Existing behaviour to be aware of, unchanged here: in Audit Execution, removing the last attachment that points at a vault file also deletes that vault file.

### File names

A name is cleaned before use: characters the vault rejects (`\ / : * ? " < > |`) are replaced with `_`, trailing dots and spaces are removed, the right extension is ensured (case-insensitive), and an empty name falls back to `document`. Control characters and the line and paragraph separators (U+2028, U+2029) are replaced too. If a name cannot be numbered, it falls back to "result (n)". Names are cut to 120 characters, and a name already in the list gets " (2)", " (3)" without regard to case, as Windows does. The same cleaned name is used for all three destinations.

### Record of what was done

Every send to a destination writes one PDF Tools activity-log entry for the engagement **(design call)**:

- The Audit Trail screen shows only an entry's action, entity and details text. So the details text carries the readable record: operation (for example "Merged 3 files", "Compressed, Recommended", "Redacted 14 areas on 3 pages"), destination, source file names with origin, result name, page count, and the first 12 characters of the result's SHA-256.
- The entry's metadata holds the same facts in structured form, with the full SHA-256 and the vault record ids of any vault sources. The screen does not display metadata today and is not changed.
- Passwords and redacted values never appear in either.
- A vault save also produces the vault's own "Uploaded" entry, because the existing upload path is reused unchanged. Two entries for a vault save are accepted.
- The vault stores no hash of its files. The SHA-256 exists only in this log entry; it lets a reviewer check a stored file against what PDF Tools produced.
- A failed log write is reported to the user as a warning; it does not undo the save.
- A result made from earlier results lists its whole chain. The details text reads "Sources: … Earlier steps: <what was done> → <result name>; … (and N earlier steps). Original sources: <name> [vault|computer|result]; …". The last 10 earlier steps are listed and the rest are counted. The entry's metadata holds `earlierSteps`, `earlierStepsNotListed` and `originalSources`, with the vault record id of each original source that came from the vault. So a vault file that was compressed and then numbered is traceable to the vault record it started from.
- The metadata also carries flags where they apply: `formFieldsDropped`, `bookmarksDropped`, `signatureInvalid`, `sharedResourcesKept`; the readable summary ends with the matching note ("; form fields not carried", "; bookmarks not carried", "; signature no longer valid", "; may still contain images or fonts of left-out pages"). `sharedResourcesKept` is set for the reasons listed in section 5.3.
- If the engagement is changed while an upload is still running, the upload finishes in the engagement it was started for, and its PDF Tools entry is still written there, silently, with that engagement's identity. A file must not exist in the vault without its provenance line. The user sees no message about it.
- Computer saves are logged too: "Destination: Computer.", or "Computer, by download (completion not confirmed)", with ", in one zip file" where that applies.

## 7. Roles, engagement and security

- The tab already requires a signed-in user and a selected engagement; that is unchanged.
- Anyone who can open the engagement can use the tools and save to its vault. That is the existing vault rule, enforced in the main process (`electron/sqlite-authorization.cjs`), and this feature adds no path around it.
- Vault input is read through the existing `file-download` channel and vault output through the existing insert and `file-save` channels. Both already refuse other engagements' files.
- Attaching uses the existing `audit_program_attachments` insert. Removing an attachment later remains partner/admin only, as today.
- Switching engagement or signing out clears the file list, results and any held passwords before the new context is shown.
- All processing is local. No tool makes a network request. The application test records the renderer's network requests and reports any made during PDF Tools steps; it tolerates requests for font files to Google Fonts (section 12), which are not made by PDF Tools. Network use by the main process is not observed by it. In its final run on 14 November 2026 (32 of 32 checks) the test found no request from a PDF Tools step; the font requests it noted were all outside PDF Tools steps.

## 8. How it is built

Decided:

- All new code lives in new files: UI under `src/components/pdf-tools/`, and the PDF operations as plain functions under `src/lib/pdf-tools/` with no React or Electron dependency, so they can be unit-tested.
- The inline `PDFTools` component and the `pdf-lib` import are removed from `src/pages/AuditTools.tsx`. The tab mounts a small component, `src/components/pdf-tools/PdfToolsMount.tsx`, which loads the screen lazily, shows a waiting message and contains a failure to load the screen. Apart from the removal, the edit to the page is one import line and one mount line. Other parallel work adds tools to the same page, so the edit must stay that small.
- No change to `sqlite/`, `src/App.tsx`, the sidebar or `src/config/buildMessage.ts`. `electron/main.cjs` gains one block of about 20 lines (beginning `const fileAccessSession`), by owner decision of 14 November 2026, so that the folder window can return the user's Desktop, Documents and Downloads folders (section 6). `electron/main.cjs` is a shared file; nothing else in `electron/` is changed. The earlier decision not to edit `src/contexts/EngagementContext.tsx` stands. Save to computer otherwise uses the browser's save-file and folder pickers with a download fallback.
- Existing hooks are reused as they are: `useEvidenceFiles`, `useAuditExecution` and its section, box and attachment hooks, `useActivityLogs`, `useEngagement`, `useAuth`.
- New dependencies. Each is added by hand, as one line in `package.json` and the matching lines in `package-lock.json`, and then checked with `npx -y npm@11.6.2 ci`, which refuses a lockfile that is out of step. `npm install` is not used on this branch because it rewrites hundreds of unrelated lockfile lines. The build machine has Node 24.15.0, not the pinned 24.12.0; the pinned npm 11.6.2 was used for every install. Nothing else is upgraded:
  - Phase 1: a page-rendering library for thumbnails, PDF to images and (phase 2) redaction. `pdfjs-dist` 5.4.296 is declared in `package.json` at that exact version. Its worker and data files are copied into `public/pdf-tools/pdfjs/` (195 files, about 2.8 MB) by `scripts/sync-pdfjs-assets.mjs`, so they load from `file://`.
  - Phase 1: a way to open password-protected files and write them out unprotected. `pdf-lib` cannot. **The builder's first job is a short trial** of candidate libraries against test files protected with each common scheme (40-bit and 128-bit RC4, 128-bit and 256-bit AES), running offline in the packaged application, with licences checked. The choice and the evidence are recorded here before the rest is built. If no candidate passes, password support is reported back as blocked; it is not faked by turning pages into pictures.
    - **Trial result (2026-11-13): chosen `@cantoo/pdf-lib` 2.11.1, MIT** (its dependencies `fflate`, `culori`, `node-html-better-parser`, `html-entities` are MIT and `tslib` is 0BSD). It is used only to decrypt: `PDFDocument.load(bytes, { password, updateMetadata: false })`, then `save()`. The resulting bytes go to `pdf-lib` 1.17.1 as usual. A wrong password throws `Error('Password incorrect')`. A protected file loaded with no password throws `EncryptedPDFError`, and with `ignoreEncryption: true` it reports `isEncrypted`. It can also create protected files for tests: `encrypt({ userPassword, ownerPassword, algorithm: 'RC4-40' | 'RC4-128' | 'AES-128' | 'AES-256', allowWeakCryptography: true })`. Two fixes are needed after loading, and both are proven in the trial. First, the trailer `/Info` link is dropped on decrypt; take it from an `ignoreEncryption` load and restore it, or title and author are lost. Second, the old security dictionary, whose `/O` and `/U` entries are password checks, is left behind as an unused object; delete it along with stale `XRef` and `ObjStm` objects. The tests must check that no `/Filter /Standard` dictionary remains.
    - Test files: a 3-page text PDF made with `pdf-lib`, protected with user password `Test@123` by qpdf 12.2.0 and, separately, by `@cantoo/pdf-lib`. `pdfjs-dist` 5.4.296 refused each file with no password or a wrong password, and opened it with the right one. To pass, the right password must give bytes that `pdf-lib` 1.17.1 loads without `ignoreEncryption`, with 3 pages, the original text (read with `pdfjs-dist`) and no `/Encrypt`, and a wrong password must be refused. Each candidate also had to run with networking blocked (Node with network calls stubbed; Electron 40.9.1 with offline emulation and every request logged, all `file://`) and load from a Vite production build opened from `file://` with the application's `webPreferences` and its `fs`/`path`/`crypto` externals.

      | Candidate (licence) | RC4 40-bit | RC4 128-bit | AES 128-bit | AES 256-bit | Notes |
      | --- | --- | --- | --- | --- | --- |
      | `@cantoo/pdf-lib` 2.11.1 (MIT) | Pass | Pass | Pass | Pass | Pure JavaScript, one lazy chunk of about 549 kB (237 kB gzip), no wasm or worker. Passes only with the two fixes above. |
      | `@neslinesli93/qpdf-wasm` 0.3.0 (ISC; qpdf 12.2.0 Apache-2.0, zlib, libjpeg-turbo; built-in crypto only) | Pass | Pass | Pass | Pass | Fallback. 1.33 MB wasm, loaded from `file://` by relative URL. Its CommonJS loader `require`s `fs`, `path` and `crypto`, which the application's Vite externals turn into bare imports that fail; it needs an empty-module shim like `xlsxJsStyleWithoutFs`. It ignores `print` and `printErr`, so a wrong password (exit code 2, "invalid password") can only be read by redirecting `console.error`. Version 0.3.1 was not tried because it was published on 2026-11-03. |
      | `qpdf-wasm` 0.1.0 (Apache-2.0) | Fail | Fail | Fail | Fail | Threaded build: it needs `SharedArrayBuffer` and `crossOriginIsolated`, which a `file://` page does not have. It hangs at start-up with `DataCloneError` and does not run in Node. |

  - Phase 3: an offline recognition engine and its language data.
- Every dependency's worker and data files must load in the packaged application, which runs from `file://`. This is proven in a packaged build before the phase is called done.

Left to the builder:

- Component breakdown inside `src/components/pdf-tools/`, state management, and exact wording of messages.
- Whether long operations move to a background worker. Developer choice for phase 1, still open for the owner to change: opening a password-protected file stays on the main thread (section 11); other operations show progress and can be cancelled. A 200-page scanned file was used to check that the page-number preview stays responsive (longest main-thread task 165 ms); a measurement of every tool on such a file is not yet verified.
- How digital signatures and restrictions are detected. As built: a file is treated as signed when its form has the signature flags set or the text `/ByteRange` appears in it; a file "carries restrictions" when it is protected but opens without a password. Form fields, bookmarks and links between pages are detected when a file is added and on every result; a push button is not counted as a form field.

## 9. Testing

These were the conditions for committing; they were met before the commit on 14 November 2026, and the list of what remains unverified is in sections 11 and the owner hand check below.

**Unit tests** (`src/lib/pdf-tools/*.test.ts` and `src/components/pdf-tools/*.test.ts`, run by `npx vitest run src/lib src/components/pdf-tools`; on this machine vitest finds the tests only when started from the upper-case path `C:\Users\ASUS\Desktop\audit-assistant-pro-electron`). Test files are generated inside the tests; no binary fixture is committed. Minimum cases for phase 1:

- Page-list parsing: valid lists, spaces, reversed range, zero, beyond page count, non-numeric, empty, duplicates.
- Merge: page count is the sum; order follows input order; images become pages; single-file and empty inputs are refused.
- Split: each mode's page counts and page order; N boundaries; names of parts.
- Delete pages: remaining count and order; delete-all refused.
- Compress: an image is replaced only when smaller; each level no larger than the one above; no-gain reported; page count and text unchanged.
- Page numbers: every format; start number; page range; position on portrait, landscape and rotated pages; existing content still present.
- Images to PDF: one page per image; page size options; undecodable image refused.
- Password: right password opens; wrong password refused; result opens without a password; password absent from the result and from log text.
- Rejections: non-PDF bytes, zero-length file.
- File-name cleaning: each forbidden character, trailing dot and space, missing and upper-case extension, empty name.

Phase 2 adds: every personal-data pattern with valid, invalid and near-miss examples; redacted text absent from the result's bytes and extracted text; unredacted pages byte-comparable in content; properties cleared; bookmarks written, nested and read back. Phase 3 adds: table detection on generated statements; number parsing; recognition of a generated scanned page.

**Application test** (`scripts/test-pdf-tools-ui.cjs`, run with `npm run test:pdf-tools-ui`, which builds first; it starts the real application through `scripts/pdf-tools-electron-entry.cjs` in an isolated temporary profile with synthetic users and data, and drives the screen over the Chrome DevTools Protocol). It has 32 checks. First launch: opening PDF Tools in an engagement; adding files from the computer (thumbnails, a protected PDF and its password); Merge; PDF to images; Escape during a long run asks before stopping; Add to Evidence Vault (the record, the stored bytes, and the SHA-256 in the activity entry); Attach to working paper (the same vault file, no second record); Add from Evidence Vault; the PDF Tools activity entries; the password appearing nowhere (database, profile files, console); isolation between two engagements. After a restart: the vault file and attachment persist; Split, Delete pages, Compress, Page numbers and Images to PDF, each result read back as bytes and checked; Save to computer marking and its activity entry, and the download fallback; Enter and Cancel during a long run (Keep running, Stop); an engagement change while PDF Tools is closed; an engagement change during a vault upload. Throughout: the renderer's network requests and errors.
`PDF_TOOLS_TEST_APP=<path to the packaged ICAI-VERA.exe> node scripts/test-pdf-tools-ui.cjs` runs the same checks against a packaged build, still on the temporary profile (the download check is skipped there). The test cannot drive the native save and folder windows, Save as ZIP, or dragging files in from the desktop; it replaces the browser's pickers with stubs that keep what is written. It does not observe the main process's own network use; a packaged build checks its update feed at start-up.

Checks it was meant to cover from the design, now reached by the list above: merge and add to the vault, attach without a second record, use a vault file as input, open a protected file, thumbnails and PDF to images in the production build, an activity entry for each send, isolation between engagements and after switching, persistence after restart, and the network check.

**Existing checks**, compared with the recorded baseline on `main`: `npm run build`; `npx tsc -p tsconfig.app.json --noEmit` (76 existing diagnostics, none new); `eslint` on the changed files (clean); `node --test scripts/test-t003-authorization.cjs` (26/26, proving the vault boundary is unchanged); `npm run test:native`; `npm run docs:inventory` then `npm run docs:check`.

**Manual run** in `npm run electron:dev` and in a packaged build, with synthetic files: each tool and option, each destination, cancel at each dialog and mid-operation, a protected file, a signed file, a large scanned file, mixed page sizes and rotations. The owner's hand check must include: Save as and the folder window, cancelling each, and choosing Desktop, Documents and Downloads themselves (accepted; verified with the real window in a probe, the owner is to confirm it in the application) as well as a folder inside them, and a folder that must be refused, such as one under AppData; dragging files in from the desktop; a screen-reader pass over the dialogs; the installed package. Results are opened in a second PDF reader as well as in the application. Results are recorded in the handoff; owner UAT is separate and is not claimed.

## 10. Records to update with the implementation

- `FEATURE_REGISTER.md`: new row F-030 "PDF Tools" **(design call: a new feature ID, since F-023 covers audit calculators)**.
- `NEXT_TASKS.md`: row T-031. T-024 to T-030 and F-029 are used on `main`.
- `CURRENT_STATUS.md`, `SESSION_HANDOFF.md`: results and limits.
- `inventory.json`, `SCREEN_MAP.md`: regenerated, never hand-merged.
- These files, and `package.json` with its lockfile, are edited by parallel branches. Conflicts there are resolved at rebase on `main` immediately before the pull request; the lockfile is regenerated, not hand-merged.

## 11. Known limits (phase 1)

These are limits found while building phase 1. "Not yet verified" means no test or manual check has covered it.

**Password-protected files**

- Opening a password-protected file runs on the main thread, so the screen is busy while it opens. An 83 MB AES-256 scan took about 18.5 s; typical files take under 2 s. A background worker would remove the wait and is a candidate for a later phase, left open for the owner. It was not done in phase 1 because of the risk of bundling a worker that must load from `file://`.
- Not yet verified: protected files with no `/ID` entry, and non-Latin passwords on files made by Acrobat or Word that use the older protection (revision 4 or lower). Linearised protected files are covered in the repository tests only by a hand-built equivalent, not by a real file from a PDF product.
- A linearised file protected with a certificate (public-key) handler may be reported as not protected.
- Opening a file that has only an owner password removes its restrictions in the copy (section 5.1).

**Tools**

- Merge does not carry bookmarks, form fields or links between pages. The merge dialog says so when a chosen file has them. Merge also keeps duplicate hidden page dictionaries (size only) and carries signature marks without a form (the result is marked). Split and Delete pages carry form fields of kept pages but not bookmarks, links by name or signature fields as fields (section 5.3). They are not a redaction tool: fonts shared with kept pages and the form's default resources are copied whole, extra resources are kept when a kept page's text, a string or inline image data contains a resource name, a page whose key holds a `#` that the library cannot read exactly keeps everything, and unknown keys in a layer configuration are copied as they are. In these cases, where the code can tell, the result is marked "May hold left-out pages' images".
- Stop works only between steps for Merge, Page numbers and Images to PDF, and between parts or pages for Split and Delete pages. Reading and writing a very large file are single steps that a Stop waits for; the stop then takes effect and nothing is added (section 5.1).
- Page numbers and Compress keep content from an earlier saved revision of the source that is no longer shown (a PDF can hold older versions of its pages after "incremental" saves). Merge, Split and Delete pages do not.
- Names written with lower-case `#xx` escapes can be re-encoded by the PDF library when it saves, so a page may lose that resource and draw differently. This is rare, and it applies to every tool; Split and Delete pages flag it, the others do not.
- Results were compared with the sources in pdf.js only (the reader PDF Tools itself uses), not in Acrobat or other readers.
- Text on a kept page that contains a resource's name keeps that resource, so Split and Delete pages can keep an image or font that only a left-out page needs. The form's default resources are copied whole, and so are fonts shared with kept pages.
- If a file is such that every page has to be kept whole (the "May hold left-out pages' images" case on every page), Split every N is as large and as slow as it was before per-page resources were added, and the warning is shown.
- An invisible form field whose only widget is on no page is not carried by Split or Delete pages.
- If the engagement is changed while the folder window is open and a folder is then chosen, the files are still written (the user's own save, started in the engagement it was begun in) but nothing is marked or shown.
- "Signature no longer valid" also appears on a part of a split file that holds no signature. The mark is deliberately cautious.
- Compress: the XMP metadata producer is not updated. Images drawn larger than the page lose more than the nominal dpi. Grey scans are stored as RGB, so a grey scan can come out slightly larger. Images above 64 megapixels are not recompressed. Compressing a signed file invalidates its signature; the screen warns before the run.
- A file that merely contains the text of a signature byte range (`/ByteRange`) is flagged "Signed". This is a cautious false positive: it adds a warning and blocks nothing.
- Images to PDF is slow for many PNG files (one test run with 200 PNG images of 600 x 800 pixels took 22 s), and the screen shows a busy bar rather than a count. The same image added twice is stored twice in the result. HEIC images are refused, like TIFF.
- PDF to images: the size shown before the run is an estimate and a warning only. The 300 MB working-list limit is enforced on the real bytes during the run, and a run that would exceed it stops and adds nothing. Very large pages are drawn at a reduced dpi, and the screen says so. Out-of-memory and renderer-restart failures have their own messages; these are proven by unit tests, or by a provoked restart, not by a natural failure.
- The working list holds at most 300 MB and warns at 150 MB (section 5.14).
- The largest sizes have not been run by anyone: a 300 MB list, a 300 MB merge, a 500-page PDF to images at 300 dpi, 200 images in one Images to PDF, and a 150 MB upload to the vault. Several steps copy the bytes more than once, so the figures are design limits, not measured ones.

**Screen and records**

- When the engagement changes while the PDF Tools screen is closed, the working list is cleared by a watcher within about one second, not instantly. Until then the files stay in memory but are not shown. Owner decision, 13 November 2026: `src/contexts/EngagementContext.tsx`, a file shared with parallel work, is not edited, to avoid merge conflicts. A one-line notification from that context would make the clearing immediate if the owner later accepts the conflict risk.
- A message naming a file (for example "result made", "not added") can stay on screen for a few seconds after an engagement switch. It is the same user and nothing can be done with it.
- The "In Evidence Vault" mark can be out of date until the next destination dialog is opened, if the record is deleted in the Evidence Vault screen. Attaching rechecks the record (section 6).
- There is no warning when the application is closed while results are "Not saved". A warning needs a further change to the main process (`electron/main.cjs`), which was not made.
- Opening PDF Tools loads up to 500 activity-log rows of the shared hook (the hook's own limit), although only its write function is used. The shared upload hook shows its own "File uploaded successfully" message for each file, without a file name, even after an engagement switch.
- The Evidence Vault picker list is not virtualised, so a vault with hundreds of files may be slow to scroll.
- Both PDF libraries are packed whole into the installer, although the screen's code already holds what it uses, and `public/pdf-tools` is packed twice. This adds to the installer size only.

**Not checked by the automated test**

- Native save and folder dialogs cannot be driven by the automated application test, which replaces them with stand-ins, and are checked by hand, as are dragging files in from the desktop and a screen-reader pass. This is not theoretical: on 14 November 2026 the owner's hand check found that saving to a folder failed with "A save window is already open", after automated verification had passed (cause and fix: section 6). Choosing Desktop, Documents and Downloads themselves is accepted and was verified with the real folder window in a throw-away probe; the same through the application screen, and the single-file Save As window into those folders, are not yet verified.
- Installed package: a Windows package was built in a scratch copy and the application test run against its unpacked build passed 31 checks with 1 skipped (the download fallback, which needs the test's entry script). The package was not installed and not published, and the installer was not run.
- Network use by the main process, and by a packaged application at start-up (it checks its update feed), is not observed by the application test.
- Rendering of JPEG 2000, JBIG2, CMYK and CJK-font PDFs from `file://` with a real file; dark theme; Hindi or other non-Latin file names end to end.

## 12. Outside this feature, for the owner

These are problems in the application that were found while building PDF Tools. They are not caused by it and **none has been changed**. They are listed for the owner to decide.

- `src/index.css` imports the Inter font from Google Fonts. Displaying a character outside the font subset already loaded, for example the rupee sign, can cause a font request to `fonts.gstatic.com`. No file content is sent, but this conflicts with the "no network" aim of section 7. A fix is to host the font inside the application, which edits a shared file.
- The main process does not enforce section and box locks on working-paper attachments, so Audit Execution lets users attach to locked items. PDF Tools is stricter: it does not offer locked sections or boxes.
- Deleting an Evidence Vault record leaves Audit Execution attachments pointing at it.
- `uploadFile` in the Evidence Vault hook inserts the database row before it writes the file, so quitting in between leaves a record with no file, and it shows the raw error text of the main process to the user.
- A stray "0" appears next to each file on the Evidence Vault screen and in each section header of Audit Execution (a flag stored as 0 is printed).
- The Audit Trail Details column cuts long entries at the right edge (about 45 characters at 1280 px width), so the sources, destination and SHA-256 of a PDF Tools entry need horizontal scrolling. The full text is in the record.
- The application has no `will-download` handler, so a download opens Electron's own Save As window.
- Deep links of the form `?tab=` on VERA Tools bounce to another tab in some cases.
- The header update button overlaps the engagement switcher at 1280 px width.
- The packaged application checks its update feed at start-up.
- `AuthContext.tsx` writes the signed-in user's id to the console at sign-in.
- An automated security check flagged a possible stored cross-site-scripting problem in `public/caat/caat-tools.html` (CAAT Tools, T-024): values from a saved workspace or shared mapping profile are put into the page without escaping. This was not verified by us and is not part of PDF Tools.
