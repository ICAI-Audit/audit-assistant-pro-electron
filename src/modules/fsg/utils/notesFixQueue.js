// T-083 (owner, 24 November 2026): ONE rule for "this still needs re-categorisation".
//
// The Rectification / Recategorisation screen used to build its list from its own database query
// (mapped-tb.js findMappedByFilter { uncategorised }) while Notes, the Balance Sheet and the P&L show Fix
// from the built statements. The two rules were patched separately (T-040 and after) and kept drifting
// apart: the screen said every ledger was categorised while Notes still showed Fix.
//
// This module is now the single source of truth. Each predicate below is the very test the screens use to
// draw a red Fix / Bifurcate / Review button, and notesFixTargets() collects the ledgers behind every such
// button. Recategorisation adds them to its list, so once that list is empty no screen can show Fix.
// Fill Details of the notes are not part of this (they are not categorisation).
import { ledgerIdsOf } from './fixTargets.js'
import { unsplitSaleLine } from './revenueLines.js'
import { isPrintedPlNoteLine } from './annexureGrouping.js'

const uncat = (s) => /uncategori[sz]ed/i.test(String(s || ''))
const nonZero = (x) => Math.abs(Number(x?.total) || 0) >= 0.005 || Math.abs(Number(x?.prevTotal) || 0) >= 0.005

// A line the CA has looked at on the Recategorisation screen (saved or approved there) is confirmed.
export const CONFIRMED_STATUSES = new Set(['user_override', 'user_approved'])
export const isConfirmedRow = (r) => CONFIRMED_STATUSES.has(String(r?.status || ''))

/** The note's own heading is an "Uncategorised …" head (Notes header shows "Fix Categorisation"). */
export const noteTitleNeedsFix = (note) => uncat(note?.title)

/** A P&L note line shown red with Fix / Bifurcate / Review - null when the line is fine. */
export function plLineFix(note, line) {
  if (!note?.isPL || !line || !isPrintedPlNoteLine(line)) return null
  if (unsplitSaleLine(note) === line) return 'Bifurcate'
  if (uncat(line.level2)) return 'Fix'
  if (line.needsReview) return 'Review'
  return null
}

/** A Balance Sheet note row (Notes template row) shown red with Fix - null when fine. */
export function bsRowFix(note, r) {
  if (!note || note.isPL || !r) return null
  if (r.type === 'l3') return uncat(r.label) ? 'Fix' : null
  if (r.type === 'l4') return null
  return r.unclassified ? 'Fix' : null
}

/** BS / P&L face: a head or line with no / an "Uncategorised" caption and a figure. */
export const sectionNeedsFix = (section) => (!section?.level1 || uncat(section.level1)) && nonZero(section)
export const sectionLineNeedsFix = (line) => (!line?.level2 || uncat(line.level2)) && nonZero(line)

/**
 * Every ledger behind a Fix on Notes / BS / P&L.
 *   { cy: number[], py: number[], items: [{ where, what, ids, pyIds }] }
 * ids are mapped_tb ids (what Recategorisation lists).
 */
export function notesFixTargets(data) {
  const items = []
  const add = (where, what, ids, pyIds = []) => { if (ids.length || pyIds.length) items.push({ where, what, ids, pyIds }) }
  for (const note of Object.values(data?.notes || {})) {
    const where = `Note ${note.num ?? ''}: ${note.displayTitle || note.title || ''}`.trim()
    if (noteTitleNeedsFix(note) && nonZero(note)) add(where, 'Fix Categorisation', ledgerIdsOf(note.rows))
    if (note.isPL) {
      for (const line of note.lines || []) {
        const what = plLineFix(note, line)
        if (what) add(`${where} - ${line.level2 || ''}`, what, ledgerIdsOf(line.rows))
      }
    } else {
      for (const r of note.templateRows || []) {
        const what = bsRowFix(note, r)
        if (what) add(`${where} - ${r.unclassified ? `Unclassified (Mapping ${r.natureLevel || 5})` : r.label}`, what,
          (r.ledgerIds || []).map(Number).filter(Number.isInteger), (r.pyLedgerIds || []).map(Number).filter(Number.isInteger))
      }
    }
  }
  // The Balance Sheet face flags a head and a line; the P&L face flags only an "Uncategorised" head (a P&L
  // head without a Level 2 is normal - its lines are in the note).
  for (const key of ['elSections', 'assetSections', 'incomeSections', 'expenseSections']) {
    const bs = key === 'elSections' || key === 'assetSections'
    for (const sec of data?.[key] || []) {
      if (sectionNeedsFix(sec)) add(sec.level1 || 'Uncategorised', 'Fix Categorisation', ledgerIdsOf((sec.lines || []).flatMap(l => l.rows || [])))
      else if (bs) for (const line of sec.lines || []) {
        if (sectionLineNeedsFix(line)) add(`${sec.level1} - ${line.level2 || 'Uncategorised'}`, 'Fix', ledgerIdsOf(line.rows))
      }
    }
  }
  const cy = [...new Set(items.flatMap(i => i.ids))]
  const py = [...new Set(items.flatMap(i => i.pyIds))]
  return { cy, py, items }
}
