// T-048 Variance Analysis arithmetic (BS, PL, Notes), kept free of React so it can be checked on its own.
// Amount of Change = Current Year - Previous Year. Percentage of Change = Amount / |Previous Year| x 100: the
// Previous Year is taken as an absolute value so an increase reads as a positive percentage even when the
// Previous Year figure is negative (a loss, a debit balance shown in brackets).

/** { amount, pct } for a Current / Previous Year pair; null when neither has a figure. pct is null when the Previous Year is nil. */
export function computeChange(cy, py) {
  const hasC = cy !== undefined && cy !== null && !isNaN(cy)
  const hasP = py !== undefined && py !== null && !isNaN(py)
  if (!hasC && !hasP) return null
  const c = hasC ? Number(cy) : 0
  const p = hasP ? Number(py) : 0
  const amount = c - p
  const pct = Math.abs(p) < 0.005 ? null : (amount / Math.abs(p)) * 100
  return { amount, pct }
}

/** "12.34%" / "N.A." (nil Previous Year with a Current Year figure) / "" (no change at all). */
export function fmtChangePct(change) {
  if (!change) return ''
  if (change.pct === null) return Math.abs(change.amount) < 0.005 ? '' : 'N.A.'
  return `${change.pct.toFixed(2)}%`
}

