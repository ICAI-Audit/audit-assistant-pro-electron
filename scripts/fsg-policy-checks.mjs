// T-043 synthetic checks, called by test-fsg-integration.mjs. Pure workbook logic, no profile.
// The renderer module is bundled the way Vite does (xlsx-js-style is CommonJS), as the other FSG checks do.
import { createRequire } from 'node:module'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
const require = createRequire(import.meta.url)

export async function checkPolicyFormat({ root, userData, check }) {
  const XLSX = require(join(root, 'node_modules', 'xlsx'))
  const bundle = require('esbuild').buildSync({ stdin: { contents: `
    export * from './src/modules/fsg/utils/policyWorkbook.js';
    export { pointLabel } from './src/modules/fsg/utils/pointLabel.js';
`, resolveDir: root }, bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'silent' })
  const bundlePath = join(userData, 'policy-workbook.cjs'); writeFileSync(bundlePath, bundle.outputFiles[0].contents)
  const { buildPolicyBlankWorkbook, buildPolicyFilledWorkbook, parsePolicyWorkbook, pointsFromPolicyRows, policyBlocks, stripSectionNumbering, pointLabel } = require(bundlePath)
  const reopen = (wb) => XLSX.read(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }))

  // The owner's AS-1 example, typed with its own "(b)" numbering.
  const as1 = pointsFromPolicyRows([
    ['(a) Method of Accounting', 'Paragraph', 'Accounts are prepared on the mercantile basis.'],
    ['(b) Basis of Preparation of Financial Statements (AS-1)', 'Paragraph', 'The financial statements have been prepared and presented taking into consideration the Fundamental Accounting Assumptions as per AS-1.'],
    ['', 'Paragraph', 'The Fundamental Accounting Assumptions as per AS-1 which have been followed are:'],
    ['', 'Bullet', 'Assumption of Going Concern'],
    ['', 'Bullet', 'Adoption of Accrual System of Accounting\nAdoption of Rule of Consistency'],
    ['', '', ''],
    ['2. Revenue Recognition (AS-9)', '', 'Revenue is recognised when the significant risks & rewards pass.'],
  ])
  check('T-043 each Section heading becomes one section, in order', as1.errors.length === 0 && as1.points.map(p => p.header).join('|') === 'Method of Accounting|Basis of Preparation of Financial Statements (AS-1)|Revenue Recognition (AS-9)', as1)
  check('T-043 typed numbering is removed and the app letters the sections (a), (b), (c)', [0, 1, 2].map(pointLabel).join('') === '(a)(b)(c)' && stripSectionNumbering('(b) Basis') === 'Basis' && stripSectionNumbering('ii) Basis') === 'Basis' && stripSectionNumbering('12. Basis') === 'Basis')
  const basis = as1.points[1]?.contentHtml || ''
  check('T-043 paragraphs and bullet lines are kept under their section', (basis.match(/<p>/g) || []).length === 5 && (basis.match(/<li>/g) || []).length === 3 && basis.indexOf('<ul>') > basis.indexOf('which have been followed'), basis)
  check('T-043 a blank Type is a paragraph and special characters are escaped', as1.points[2].contentHtml === '<p>Revenue is recognised when the significant risks &amp; rewards pass.</p>', as1.points[2])

  // Round trip: the filled download uploads back to the same sections and text, and a table is kept.
  const table = '<table><tbody><tr><th><p>Ratio</p></th></tr><tr><td><p>1.2</p></td></tr></tbody></table>'
  const existing = [
    { id: 'x1', header: 'Method of Accounting', contentHtml: '<p>Mercantile &amp; accrual.</p>' },
    { id: 'x2', header: 'Related Party Transaction', contentHtml: '<ul><li><p><strong>Name of Related Party</strong></p></li></ul>' + table },
    { id: 'x3', header: 'Financial Ratios', contentHtml: '<p>The ratios are:</p>' + table },
  ]
  const back = parsePolicyWorkbook(reopen(buildPolicyFilledWorkbook(existing)), existing)
  check('T-043 the filled download uploads back to the same sections', back.errors.length === 0 && back.points.map(p => p.header).join('|') === existing.map(p => p.header).join('|'), back)
  check('T-043 text survives the round trip', back.points[0].contentHtml === '<p>Mercantile &amp; accrual.</p>' && policyBlocks(back.points[1].contentHtml)[0].text === 'Name of Related Party', back.points)
  check('T-043 a "Table" row keeps the existing table of that section', back.points[2].contentHtml === '<p>The ratios are:</p>' + table && back.points[1].contentHtml.includes(table))
  const noTable = pointsFromPolicyRows([['New Section', 'Table', '']], existing)
  check('T-043 a "Table" row with no table to keep is reported, not invented', noTable.points[0].contentHtml === '<p></p>' && noTable.warnings.length === 1, noTable)

  // Blank format and mistakes.
  const blank = reopen(buildPolicyBlankWorkbook())
  const blankParsed = parsePolicyWorkbook(blank, [])
  check('T-043 the blank format has Policy and How-to sheets and parses to its example sections', blank.SheetNames.join('|') === 'Policy|How to fill' && blankParsed.points.length === 2 && blankParsed.points[0].header === 'Basis of Preparation of Financial Statements (AS-1)', blankParsed)
  const orphan = pointsFromPolicyRows([['', 'Paragraph', 'Text before any heading']])
  check('T-043 text without a section heading above it is refused', orphan.errors.length >= 1 && orphan.points.length === 0, orphan)
  const wrong = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wrong, XLSX.utils.aoa_to_sheet([['Ledger', 'Amount'], ['Cash', 10]]), 'Sheet1')
  check('T-043 a workbook that is not a Policy format is refused', parsePolicyWorkbook(reopen(wrong), []).errors.length === 1)
}
