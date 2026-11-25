// T-087 checks, called by test-fsg-integration.mjs: Branch Master. A Trial Balance of a branch entity is uploaded
// against a branch picked from the master (or added there); a second upload of the same branch and year is that
// branch's next version, never a new branch; the Consolidated view adds the latest version of each branch only.
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export async function checkBranchMaster({ db, root, check, staff, entityId, periodId }) {
  const mod = (...p) => import(pathToFileURL(join(root, ...p)).href)
  const { ensureBranchMaster } = await mod('electron', 'fsg', 'db', 'schema.js')
  const { groupBranchVersions, latestPerBranch } = await mod('src', 'modules', 'fsg', 'utils', 'tbVersions.js')
  const { chooseConsolidation } = await mod('src', 'modules', 'fsg', 'utils', 'consolidationSelection.js')

  const rows = (tag) => [
    { name: `Br Capital ${tag}`, opening_balance: 0, debit: 0, credit: 500, closing_balance: 500, parent: 'Capital Account', group_parent: 'Capital Account' },
    { name: `Br Bank ${tag}`, opening_balance: 0, debit: 500, credit: 0, closing_balance: -500, parent: 'Bank Accounts', group_parent: 'Current Assets' },
  ]
  const names = () => (db.prepare('SELECT name FROM fsg_branches WHERE entity_id = ? ORDER BY name').all(entityId)).map(r => r.name)

  const first = await staff('tb:uploadRealBooks', { entityId, entityPeriodId: periodId, fileName: 'branch-a.xlsx', branchName: 'Branch Alpha', tbRows: rows('1') })
  check('T-087 a branch Trial Balance uploads and its branch is put on the Branch Master', first.ok && names().includes('Branch Alpha'), first.ok ? names() : first)
  const second = await staff('tb:uploadRealBooks', { entityId, entityPeriodId: periodId, fileName: 'branch-a-2.xlsx', branchName: '  branch   ALPHA ', tbRows: rows('2') })
  const a1 = first.ok && first.result.tb, a2 = second.ok && second.result.tb
  check('T-087 a second upload of the same branch (any case or spacing) stays that branch and is its next version',
    !!a1 && !!a2 && a2.branch_name === 'Branch Alpha' && Number(a2.tb_version) === Number(a1.tb_version) + 1, a2 || second)
  check('T-087 the Branch Master still has the branch once', names().filter(n => n.toLowerCase() === 'branch alpha').length === 1, names())

  const added = await staff('tb:addBranch', { entityId, name: 'Branch Beta' })
  const again = await staff('tb:addBranch', { entityId, name: 'branch beta' })
  check('T-087 "Add new branch" adds it once; the same name again returns the existing branch',
    added.ok && again.ok && again.result.name === 'Branch Beta' && names().filter(n => /^branch beta$/i.test(n)).length === 1, { added, again })
  const blank = await staff('tb:addBranch', { entityId, name: '   ' })
  check('T-087 a blank branch name is refused', !blank.ok, blank)
  const list = await staff('tb:listBranchMaster', entityId)
  check('T-087 the upload screens list the Branch Master', list.ok && list.result.some(b => b.name === 'Branch Beta') && list.result.some(b => b.name === 'Branch Alpha'), list)

  const tbs = await staff('tb:getBranches', entityId)
  check('T-087 the branch list carries the version of each Trial Balance', tbs.ok && tbs.result.some(t => t.id === a2?.id && Number(t.tb_version) === Number(a2.tb_version)), tbs.ok ? tbs.result.filter(t => /alpha/i.test(t.branch_name || '')) : tbs)

  // Branch Master screen: rename (its Trial Balances follow) and delete (only when unused).
  const idOf = (n) => db.prepare('SELECT id FROM fsg_branches WHERE entity_id = ? AND name = ? COLLATE NOCASE').get(entityId, n)?.id
  const clash = await staff('tb:renameBranch', { entityId, id: idOf('Branch Alpha'), name: 'branch beta' })
  check('T-087 renaming to a name already on the Branch Master is refused', !clash.ok && /already exists/.test(clash.error), clash)
  db.prepare('UPDATE entity_periods SET locked = 1 WHERE id = ?').run(periodId)
  const lockedRename = await staff('tb:renameBranch', { entityId, id: idOf('Branch Alpha'), name: 'Branch Gamma' })
  db.prepare('UPDATE entity_periods SET locked = 0 WHERE id = ?').run(periodId)
  check('T-087 a branch with a Trial Balance in a locked year cannot be renamed', !lockedRename.ok && /locked/.test(lockedRename.error), lockedRename)
  const renamed = await staff('tb:renameBranch', { entityId, id: idOf('Branch Alpha'), name: 'Branch Gamma' })
  const tbNames = db.prepare('SELECT branch_name FROM trial_balances WHERE id IN (?, ?)').all(a1?.id, a2?.id).map(r => r.branch_name)
  check('T-087 rename moves both versions of the branch to the new name', renamed.ok && tbNames.length === 2 && tbNames.every(n => n === 'Branch Gamma') && !idOf('Branch Alpha') && !!idOf('Branch Gamma'), { renamed, tbNames })
  const third = await staff('tb:uploadRealBooks', { entityId, entityPeriodId: periodId, fileName: 'branch-g-3.xlsx', branchName: 'Branch Gamma', tbRows: rows('3') })
  check('T-087 after the rename the next upload is still that branch\'s next version (_v3)', third.ok && Number(third.result.tb.tb_version) === Number(a2?.tb_version) + 1, third.ok ? third.result.tb : third)
  const usedDelete = await staff('tb:deleteBranch', { entityId, id: idOf('Branch Gamma') })
  check('T-087 a branch used by Trial Balances cannot be deleted', !usedDelete.ok && /cannot be deleted/.test(usedDelete.error) && !!idOf('Branch Gamma'), usedDelete)
  const freeDelete = await staff('tb:deleteBranch', { entityId, id: idOf('Branch Beta') })
  check('T-087 an unused branch is deleted', freeDelete.ok && !idOf('Branch Beta'), freeDelete)
  const counted = (await staff('tb:listBranchMaster', entityId)).result?.find(b => b.name === 'Branch Gamma')
  check('T-087 the Branch Master shows how many Trial Balances use each branch', counted?.tb_count === 3 && counted?.locked_count === 0, counted)

  // Names already on Trial Balances before the master existed are put on it once.
  db.prepare(`INSERT INTO trial_balances (entity_id, period, filename, row_count, branch_name, entity_period_id, tb_version) VALUES (?, '', 'legacy.xlsx', 0, 'Legacy Branch', NULL, NULL)`).run(entityId)
  await ensureBranchMaster(); await ensureBranchMaster()
  check('T-087 existing branch names are seeded into the Branch Master once', names().filter(n => n === 'Legacy Branch').length === 1, names())

  // Pure: one button per branch, and the Consolidated default takes the latest version of each branch.
  const fake = [
    { id: 1, branch_name: 'A', entity_period_id: 9, tb_version: 1 }, { id: 2, branch_name: 'B', entity_period_id: 9, tb_version: 1 },
    { id: 3, branch_name: 'A', entity_period_id: 9, tb_version: 2 }, { id: 4, branch_name: 'A', entity_period_id: 8, tb_version: 1 },
  ]
  const groups = groupBranchVersions(fake.filter(t => t.entity_period_id === 9))
  check('T-087 the branch bar shows A and B once each, A with versions _v1 and _v2 (latest _v2)',
    groups.length === 2 && groups[0].branch === 'A' && groups[0].tbs.map(t => t.id).join() === '1,3' && groups[0].latest.id === 3, groups)
  check('T-087 latest version per branch and year', latestPerBranch(fake).map(t => t.id).sort().join() === '2,3,4', latestPerBranch(fake))
  const sel = chooseConsolidation({ tbs: fake, periods: [{ id: 9 }, { id: 8 }], entityPeriodId: 9, override: null })
  check('T-087 Consolidated adds A_v2 and B, not A_v1 as well; the Previous Year takes last year\'s A',
    sel.cyIds.slice().sort().join() === '2,3' && sel.pyIds.join() === '4', sel)
}
