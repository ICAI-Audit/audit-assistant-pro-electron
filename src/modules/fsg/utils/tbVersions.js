// T-071: versions of a Trial Balance within one financial year (and branch).
//
// Each upload for the same year and branch is a version: _v1, _v2, _v3. A
// fourth is refused until one of the three is deleted (the main process
// enforces this in tb.js claimTbVersion; this file only explains it first).
// The upload date and time are not part of a Trial Balance's name.
import { fsgApi } from '../api.js'

/** "_v2", or '' for a Trial Balance without a version (no financial year). */
export function tbVersionSuffix(tb) {
  const v = Number(tb?.tb_version)
  return Number.isInteger(v) && v > 0 ? `_v${v}` : ''
}

// T-087: an Auditee with branches holds up to three versions of each branch's Trial Balance per year. These
// group them so a branch is shown (and consolidated) once, with its versions under it.
const branchKey = (t) => `${t?.entity_period_id ?? ''}|${String(t?.branch_name || '').trim().toLowerCase()}`
const newer = (a, b) => (Number(a.tb_version) || 0) - (Number(b.tb_version) || 0) || a.id - b.id
/** [{ key, branch, tbs (oldest version first), latest }] in the order the branches first appear. */
export function groupBranchVersions(tbs) {
  const groups = new Map()
  for (const t of tbs || []) {
    const k = branchKey(t)
    if (!groups.has(k)) groups.set(k, { key: k, branch: t.branch_name || '', tbs: [] })
    groups.get(k).tbs.push(t)
  }
  return [...groups.values()].map(g => { const sorted = [...g.tbs].sort(newer); return { ...g, tbs: sorted, latest: sorted[sorted.length - 1] } })
}
/** The latest version of each branch (and year): what the Consolidated view adds together by default. */
export const latestPerBranch = (tbs) => groupBranchVersions(tbs).map(g => g.latest)

/** The name a Trial Balance is shown by: "2024-25_v2 [Head Office]". */
export function tbDisplayName(tb) {
  if (!tb) return ''
  const base = tb.period || tb.filename || `Trial Balance #${tb.id}`
  return `${base}${tbVersionSuffix(tb)}${tb.branch_name ? ` [${tb.branch_name}]` : ''}`
}

/**
 * Before an upload: is there room for another version of this year (and
 * branch)? Shows the reason and the way out when there is not. Returns
 * { proceed, status }: status.next is the version the upload will take.
 */
export async function checkTbVersionRoom(entityPeriodId, branchName = '') {
  if (!entityPeriodId) return { proceed: true, status: null }
  let status
  try {
    status = await fsgApi.tbVersionStatus({ entityPeriodId, branchName: branchName || '' })
  } catch {
    return { proceed: true, status: null }   // the upload itself still enforces the rule
  }
  if (status.locked) {
    window.alert(
      'This Financial Year is locked, so no Trial Balance can be uploaded into it.\n\n' +
      'To upload: unlock the year on the Master tab first, then upload again.'
    )
    return { proceed: false, status }
  }
  if (status.full) {
    const list = status.versions.map(v => `  • ${tbDisplayName(v)}${v.filename ? `   (${v.filename})` : ''}`).join('\n')
    window.alert(
      `Upload not allowed: ${status.yearLabel || 'this financial year'}${branchName ? ` (branch ${branchName})` : ''} ` +
      `already has ${status.limit} Trial Balances:\n\n${list}\n\n` +
      `Only ${status.limit} versions are kept for a financial year${branchName ? ' and branch' : ''}.\n\n` +
      'What to do: on TB > Upload TB, pick the version you no longer need in the Trial Balance list, ' +
      'click "Delete TB", and then upload the new Trial Balance again.'
    )
    return { proceed: false, status }
  }
  return { proceed: true, status }
}
