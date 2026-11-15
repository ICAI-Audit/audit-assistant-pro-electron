// T-047: how utils/veraExcel.js finishes the Tax Computation "Save Excel" file
// (utils/taxComputationIO.js buildSavedWorkbook). Sheet names and cells are unchanged,
// so parseSavedWorkbook reads old and new files alike. This file is a saved copy, not a
// form: nothing is yellow and there are no dropdowns (no column offers a fixed choice).

export function taxComputationExcelSpec(lineCount = 0) {
  return {
    mode: 'filled',
    sheets: {
      'Tax Computation': { headerRow: 5, lastRow: 5 + lineCount, amountCols: ['B'], widths: [84, 20], autoFilter: false },
      'Inputs (do not edit)': { headerRow: 2, widths: [22, 50, 18], autoFilter: false, boldFirstCol: false },
    },
    howTo: {
      title: 'Tax Computation — saved copy',
      purpose: 'The Computation of Total Income and Tax as VERA shows it, with the figures you typed on the Tax Computation screen. Keep it to put those figures back later, for example after uploading a fresh Trial Balance.',
      steps: [
        'Read the computation on the "Tax Computation" sheet.',
        'Keep the file safe. Do not change the "Inputs (do not edit)" sheet: it holds the figures VERA puts back.',
        'To restore the figures, open Features > Tax Computation in VERA, click "Upload saved Excel" and pick this file.',
      ],
      columns: [
        ['Particulars', 'Each line of the computation.', 'Fixed'],
        ['Amount (Rs.)', 'The figure of that line, as computed by VERA.', 'Amount'],
      ],
      tips: [
        'Changing a figure on the "Tax Computation" sheet does not change what is restored; only the inputs sheet is read.',
      ],
    },
  }
}
