// T-047: how utils/veraExcel.js finishes the Trial Balance template, the Mapping Rules
// file, the Learned Ledger Rules file and the "all workings" backup. The main process
// still builds each file exactly as before; the renderer themes the bytes at save time.
// Sheet names, headers and cell positions are unchanged, so every upload reader reads
// old and new files alike (readers skip the "How to Fill" and "Lists" sheets).
//
// Dropdowns only where the choices are fixed (owner, 15 Nov 2026): Yes/No on the TB
// template, the Constitution code 1/2/3 and the four ALIE heads on the Mapping Rules
// file. Ledger names and Mapping 1-7 captions are long and client-specific: free text.

const YES_NO = ['Yes', 'No']
const CONSTITUTIONS = ['1', '2', '3']
const ALIE = ['EQUITY AND LIABILITIES', 'ASSETS', 'Income', 'Expenses']
const CONSTITUTION_NOTE = '1 = Individual / Proprietorship / Partnership, 2 = LLP, 3 = Company.'

/** Trial Balance upload template (electron/fsg/services/excel.js generateTBTemplate). */
export function tbTemplateExcelSpec() {
  const rows = 200
  return {
    mode: 'template',
    sheets: {
      'Trial Balance': {
        headerRow: 1,
        minRows: rows,
        inputCols: 'ABCDEFGHIJKLMNOPQRSTU'.split(''),
        amountCols: ['E', 'F', 'G', 'H', 'K'],
        widths: [12, 14, 14, 36, 16, 16, 16, 16, 12, 16, 14, 24],
        autoFilter: false,
        dropdowns: [
          { col: 'I', fromRow: 2, toRow: rows + 1, list: YES_NO, name: 'IsRevenue', prompt: 'Yes for an Income or Expense ledger, No for a balance sheet ledger.' },
          { col: 'J', fromRow: 2, toRow: rows + 1, list: YES_NO, name: 'IsDeemedPositive', prompt: 'Yes if the ledger is debit-natured, No if credit-natured.' },
        ],
      },
    },
    howTo: {
      title: 'Trial Balance — template',
      purpose: 'Enter a Trial Balance in the ODBC format, one ledger per row, and upload it on VERA\'s Upload TB screen.',
      steps: [
        'Go to the "Trial Balance" sheet.',
        'Enter one ledger per row in the pale-yellow cells. Leave a cell blank if it does not apply.',
        'Enter amounts in rupees without symbols or commas (for example 125000.50), with the same signs as your accounting software\'s ODBC export.',
        'Pick Yes or No in IsRevenue and IsDeemedPositive.',
        'Save the file, then on VERA\'s TB > Upload TB screen click "Upload Trial Balance", choose "ODBC Format" and pick it.',
      ],
      columns: [
        ['Period / Branch', 'The period label and the branch name (branch only for a client with branches).', 'Text — fill in'],
        ['Ledger Code / Name', 'The ledger\'s code (optional) and its name as in the books.', 'Text — fill in'],
        ['OpeningBalance, Debit, Credit, ClosingBalance', 'The ledger\'s figures for the year.', 'Amount — fill in'],
        ['IsRevenue', 'Yes for an Income or Expense ledger, No for a balance sheet ledger.', 'Dropdown'],
        ['IsDeemedPositive', 'Yes if the ledger is debit-natured, No if credit-natured.', 'Dropdown'],
        ['TrailBalance', 'Optional. The figure shown in the Trial Balance column of the export.', 'Amount — fill in'],
        ['Parent, Group.$Parent ... Group.$Parent.8', 'The ledger\'s group and the groups above it, nearest first. VERA maps ledgers from these.', 'Text — fill in'],
      ],
      tips: [
        'Do not rename, reorder or delete the column headings; VERA reads the file by them.',
        'Check that the Trial Balance tallies before uploading; VERA reports a difference on upload.',
      ],
    },
  }
}

/** Mapping Rules download (electron/fsg/services/excel.js exportMappingToExcel). */
export function mappingRulesExcelSpec() {
  const constitution = { col: 'A', list: CONSTITUTIONS, name: 'Constitution', prompt: CONSTITUTION_NOTE }
  return {
    mode: 'filled',
    sheets: {
      LevelFormat: { headerRow: 1, freezeCols: 2, dropdowns: [constitution, { col: 'B', list: ALIE, name: 'ALIE', prompt: 'The statement head the line belongs to.' }] },
      Map1: { headerRow: 1, dropdowns: [constitution] },
      Map2: { headerRow: 1, dropdowns: [constitution] },
      Map3: { headerRow: 1, dropdowns: [constitution] },
    },
    howTo: {
      title: 'Mapping Rules',
      purpose: 'The rules VERA uses to map Trial Balance ledgers to the financial statements. Edit or add rules here and upload the file back on Master > Mapping Rules to use them for this client.',
      steps: [
        'Open the sheet to change: LevelFormat (the Mapping 1 to 7 hierarchy), Map1 (Tally groups), Map2 or Map3 (keyword rules).',
        'Change a row, or add a new row at the end of the table. Keep one rule per row.',
        'Pick the Constitution from its dropdown (' + CONSTITUTION_NOTE + ') and, on LevelFormat, the ALIE head.',
        'Save the file, then on VERA\'s Master > Mapping Rules screen click "Upload User Mapping" and pick it.',
      ],
      columns: [
        ['Constitution', CONSTITUTION_NOTE + ' A row without it is skipped on upload.', 'Dropdown'],
        ['ALIE (LevelFormat)', 'EQUITY AND LIABILITIES, ASSETS, Income or Expenses.', 'Dropdown'],
        ['Mapping 1 to Mapping 7 (LevelFormat)', 'The captions of the hierarchy, from the broad head (Mapping 1) to the most detailed line (Mapping 7).', 'Text'],
        ['Tally Pre-Primary / Keyword', 'The Tally group (Map1) or the word in a ledger or group name (Map2, Map3) the rule looks for.', 'Text'],
        ['Mapping1/2/3 Resultant', 'Where a matching ledger is mapped. Use captions exactly as on LevelFormat.', 'Text'],
        ['Priority', 'Optional. When two keyword rules match, the one with the higher priority wins.', 'Number'],
      ],
      tips: [
        'Uploading creates a custom rule set for this client; the standard rules stay as they are and "Revert to default" brings them back.',
        'Do not rename the sheets or the column headings.',
      ],
    },
  }
}

/** Learned Ledger Rules download (electron/fsg/ipc/mapped-tb.js learnedRules:download). */
export function learnedRulesExcelSpec() {
  return {
    mode: 'filled',
    sheets: { 'Learned Ledger Rules': { headerRow: 1, freezeCols: 1, widths: [36] } },
    howTo: {
      title: 'Learned Ledger Rules',
      purpose: 'Every ledger whose mapping you approved or fixed for this client. VERA applies them by ledger name to every new Trial Balance. Keep this file as a backup, or upload it into another client.',
      steps: [
        'Review or correct the mapping of a ledger in its row; one ledger per row.',
        'Save the file, then on VERA\'s Master > Mapping Rules screen click "↑ Learned Ledger Rules" and pick it.',
      ],
      columns: [
        ['Ledger Name', 'The ledger, exactly as in the Trial Balance. Required.', 'Text'],
        ['Branch', 'For information only: the branch whose Trial Balance last confirmed the rule.', 'Text'],
        ['ALIE', 'The statement head of the ledger.', 'Text'],
        ['Mapping 1 to Mapping 7', 'Where the ledger is mapped. Mapping 1 is required.', 'Text'],
        ['Last Updated', 'When the rule was last confirmed.', 'Date'],
      ],
      tips: ['The file carries no client name, so it can be uploaded into a different client.'],
    },
  }
}

/** "Download all workings" backup (electron/fsg/ipc/workings.js buildWorkingsWorkbook). */
export function workingsExcelSpec() {
  // Only the readable copies are styled; "Read me" and "Workings data" (the part the
  // upload reads) are left exactly as built.
  const readable = (amountCols, widths) => ({ headerRow: 1, amountCols, widths })
  return {
    mode: 'filled',
    sheets: {
      'Stock': readable(['B', 'C', 'D', 'E'], [26, 16, 16, 16, 16, 40]),
      'Fill Details': readable([], [10, 60]),
      'Adjustments': readable(['D', 'E'], [36, 14, 16, 18, 18]),
      'Journal and added ledgers': readable(['C'], [36, 18, 22, 28, 28, 28]),
      'Manual PY': readable(['D'], [10, 40, 40, 20]),
      'Extra face lines': readable(['C', 'D'], [28, 40, 16, 16]),
      'Remarks': readable([], [20, 36, 70]),
      'Learned Ledger Rules': { headerRow: 1, freezeCols: 1, widths: [36] },
    },
    howTo: {
      title: 'All workings of one Trial Balance',
      purpose: 'A backup of every working done on one Trial Balance (notes, schedules, stock, adjustments, remarks and the rest), to restore them on a re-uploaded Trial Balance of the same client and year.',
      steps: [
        'Keep this file safe; do not edit it.',
        'To restore: on VERA\'s TB > Upload TB screen select the Trial Balance and click "Upload all workings", then pick this file and the workings to bring back.',
      ],
      columns: [
        ['Read me', 'The client, year, branch and Trial Balance this file was taken from, and how many items of each working it holds.', 'Information'],
        ['Stock, Adjustments, Remarks, ...', 'Readable copies of the workings, for reference only. Changes here are not uploaded.', 'For reference'],
        ['Workings data', 'The part VERA reads when the file is uploaded back. Do not edit, sort or delete it.', 'Do not edit'],
      ],
      tips: ['Workings are restored only to a Trial Balance of the same client; VERA warns when the year differs.'],
    },
  }
}
