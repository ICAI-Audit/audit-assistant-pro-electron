// Fills the user's ITR BS/PL entries back into the ORIGINAL reference
// workbook for the entity's constitution group, so the download preserves
// the exact "hard format" (labels, merged cells, borders, formulas) the
// figures were entered against — only the orange input cells and the
// dynamic Details tables are written; every formula cell is left untouched
// so Excel recalculates totals itself when the file is opened.
import ExcelJS from 'exceljs'
import { ITR_DETAILS_BLOCKS } from '../shared/itrDetailsBlocks.js'
import { assetPath } from '../paths.js'

// Reference workbooks are bundled in electron/fsg/assets/itr-templates.
// `group` arrives from the renderer, so only the bundled template names are accepted.
const ITR_TEMPLATE_GROUPS = new Set(['company', 'individual', 'partnership'])

function templatePath(group) {
  if (!ITR_TEMPLATE_GROUPS.has(group)) throw new Error(`Unknown ITR format: ${group}`)
  return assetPath('itr-templates', `${group}.xlsx`)
}

export async function buildItrExcel({ group, formValues, detailsData }) {
  const path = templatePath(group)
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(path)

  for (const [id, raw] of Object.entries(formValues || {})) {
    const [sheetName, cellRef] = id.split('!')
    const ws = wb.getWorksheet(sheetName)
    if (!ws) continue
    const num = parseFloat(raw)
    if (raw === '' || raw == null || isNaN(num)) continue
    ws.getCell(cellRef).value = num
  }

  for (const block of ITR_DETAILS_BLOCKS) {
    const list = detailsData?.[block.key]
    if (!list || !list.length) continue
    const ws = wb.getWorksheet(block.sheet)
    if (!ws) continue
    list.forEach((entry, i) => {
      const row = block.startRow + i
      for (const col of block.columns) {
        const val = entry?.[col.key]
        if (val === '' || val == null) continue
        ws.getCell(`${col.col}${row}`).value = col.type === 'number' ? (parseFloat(val) || 0) : String(val)
      }
    })
  }

  return wb.xlsx.writeBuffer()
}
