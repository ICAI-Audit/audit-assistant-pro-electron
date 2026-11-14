const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

// Parse explicit reporting dates first; FY labels are April–March shorthand.
function endDate(period) {
  const text = String(period || '').trim()
  const raw = text.split(/\s+to\s+/i).at(-1).trim()
  let m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  let parts = m && [Number(m[1]), Number(m[2]), Number(m[3])]
  if (!parts) {
    m = raw.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/)
    if (m) parts = [Number(m[3]), Number(m[2]), Number(m[1])]
  }
  if (!parts) {
    m = text.match(/^(?:FY\s*)?(\d{4})\s*[-/]\s*(\d{2}|\d{4})$/i)
    if (m) {
      const start = Number(m[1]), finish = Number(m[2])
      if (finish === start + 1 || (m[2].length === 2 && finish === (start + 1) % 100)) parts = [start + 1, 3, 31]
    }
  }
  if (!parts) return null
  const [year, month, day] = parts
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? parts : null
}
const display = parts => parts ? `${parts[2]} ${months[parts[1] - 1]} ${parts[0]}` : ''

export function statementDates(activeTB, prevTB = null) {
  const cy = endDate(activeTB?.period)
  // An explicitly selected comparative supplies its own reporting end date.
  // Opening/manual PY figures otherwise relate to the preceding year end.
  let py = prevTB?.period ? endDate(prevTB.period) : null
  if (!prevTB?.period && cy) {
    const [year, month, day] = cy
    py = [year - 1, month, Math.min(day, new Date(Date.UTC(year - 1, month, 0)).getUTCDate())]
  }
  return { cy: display(cy), py: display(py) }
}

export function statementColumnLabels(activeTB, prevTB = null, kind = 'bs') {
  const dates = statementDates(activeTB, prevTB)
  const prefix = kind === 'bs' ? 'As at' : 'For the year ended'
  return { cy: dates.cy ? `${prefix} ${dates.cy}` : 'Current Year', py: dates.py ? `${prefix} ${dates.py}` : 'Previous Year' }
}

export function noteColumnLabels(activeTB, prevTB, note) {
  return statementColumnLabels(activeTB, prevTB, note?.isPL || ['Income', 'Expenses'].includes(note?.alie) ? 'pl' : 'bs')
}

// Display headings only; never run this on ledger names or saved disclosure text.
export function datedPeriodLabel(label, labels) {
  return String(label).replace(/\bCurrent Year\b|\bCY\b/gi, () => labels.cy)
    .replace(/\bPrevious Year\b|\bPY\b/gi, () => labels.py)
}
