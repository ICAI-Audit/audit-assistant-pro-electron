// The note number printed against the Deferred tax line of the Profit & Loss account (owner, 23 November 2026).
//
// The Deferred tax charge / (benefit) of the year is the movement of the Deferred tax assets / liabilities shown in the
// Balance Sheet, so the P&L line points to that Balance Sheet note — but only when the P&L line has a figure (this year
// or last). With no figure the line keeps the note number it had (the Tax expense note, or none).
//
// A reference only: the Excel face must not take the line's amount from that note (a formula to the note's total
// would print the closing Deferred tax balance instead of the charge of the year), so callers check `ref`.

const DT_BS_NOTE_RX = /deferred\s*tax\s*(asset|liabilit)/i
const DT_PL_LINE_RX = /deferred\s*tax/i
const nonZero = (v) => Math.abs(parseFloat(v) || 0) >= 0.005

/** The Balance Sheet note of Deferred tax assets / liabilities that has a figure, or null. This year's first. */
export function deferredTaxBsNoteNum(notes) {
  const list = Object.values(notes || {})
    .filter(n => n && !n.isPL && DT_BS_NOTE_RX.test(n.title || '') && (nonZero(n.total) || nonZero(n.prevTotal)))
    .sort((a, b) => a.num - b.num)
  if (!list.length) return null
  return (list.find(n => nonZero(n.total)) || list[0]).num
}

/** True when this P&L line / face item is the Deferred tax line and has a figure this year or last. */
export function isDeferredTaxWithFigure(label, cy, py) {
  return DT_PL_LINE_RX.test(String(label || '')) && (nonZero(cy) || nonZero(py))
}

/**
 * The note number to print against one line of the Tax expense section: { num, ref }. ref is true when the number is
 * the Balance Sheet's Deferred tax note (a reference, not the source of the line's amount).
 */
export function taxLineNote(line, sec, notes) {
  if (isDeferredTaxWithFigure(line?.level2, line?.total, line?.prevTotal)) {
    const num = deferredTaxBsNoteNum(notes)
    if (num) return { num, ref: true }
  }
  return { num: line?.noteNum || sec?.noteNum || null, ref: false }
}
