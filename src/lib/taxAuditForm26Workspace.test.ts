import { describe, expect, it } from 'vitest';
import { FORM26_DEFINITION as DEF } from '@/data/taxAuditForm26Definition';
import { form26ClockTime, form26FieldDomId } from '@/lib/taxAuditForm26EditorModel';
import { buildListModel } from '@/lib/taxAuditForm26ListModel';
import { scanUnfilled } from '@/lib/taxAuditForm26Unfilled';
import { defaultValues } from '@/lib/taxAuditForm26Values';
import {
  adjacentClause,
  form26CategoryBadge,
  form26TableConflictLine,
  form26CloseDecision,
  form26HeldCloseOutcome,
  form26EditorWidth,
  form26FieldKeyOfElement,
  form26HeaderModel,
  form26KeyCommand,
  form26LeaveGuardText,
  form26SaveStateLocked,
  form26ObservationAction,
  form26Tabs,
  form26UnfilledStep,
  form26YearUnknownText,
  FORM26_CLOSE_SAVED,
  FORM26_CLOSE_WARNING,
  FORM26_STATE_TEXT,
  isTypingElement,
  listedClauseKeys,
  rovingTarget,
} from '@/lib/taxAuditForm26Workspace';

const view = { showAllSchedules: false };
const model = (values = defaultValues(DEF), filter: 'all' | 'unfilled' = 'all', search = '') =>
  buildListModel({ def: DEF, values, view, rowsByKey: new Map(), evidence: [], unconfirmed: new Set(), filter, search });

describe('keys of the workspace', () => {
  it('F8 / Shift+F8 go to the next / previous unfilled item, also while typing; with Ctrl, Alt or Meta they do nothing', () => {
    expect(form26KeyCommand({ key: 'F8' }, false)).toBe('next-unfilled');
    expect(form26KeyCommand({ key: 'F8' }, true)).toBe('next-unfilled');
    expect(form26KeyCommand({ key: 'F8', shiftKey: true }, true)).toBe('previous-unfilled');
    expect(form26KeyCommand({ key: 'F8', ctrlKey: true }, false)).toBeNull();
    expect(form26KeyCommand({ key: 'F8', altKey: true }, false)).toBeNull();
    expect(form26KeyCommand({ key: 'F8', metaKey: true }, false)).toBeNull();
  });

  it('Alt+PageDown / Alt+PageUp go to the next / previous clause; PageDown alone scrolls as usual', () => {
    expect(form26KeyCommand({ key: 'PageDown', altKey: true }, true)).toBe('next-clause');
    expect(form26KeyCommand({ key: 'PageUp', altKey: true }, false)).toBe('previous-clause');
    expect(form26KeyCommand({ key: 'PageDown' }, false)).toBeNull();
    expect(form26KeyCommand({ key: 'PageDown', altKey: true, ctrlKey: true }, false)).toBeNull();
  });

  it('"/" puts the keyboard in the search only when no field has it; Y, N, Enter and Esc are left to the controls (handled inside them)', () => {
    expect(form26KeyCommand({ key: '/' }, false)).toBe('focus-search');
    expect(form26KeyCommand({ key: '/' }, true)).toBeNull();
    expect(form26KeyCommand({ key: '/', ctrlKey: true }, false)).toBeNull();
    for (const key of ['y', 'Y', 'n', 'N', 'Enter', 'Escape', 'Tab', 'ArrowDown']) expect(form26KeyCommand({ key }, false)).toBeNull();
  });

  it('isTypingElement: text boxes, long text, selects and rich text count as typing; buttons, radios, switches and the page do not', () => {
    expect(isTypingElement({ tagName: 'INPUT', type: 'text' })).toBe(true);
    expect(isTypingElement({ tagName: 'INPUT', type: 'number' })).toBe(true);
    expect(isTypingElement({ tagName: 'TEXTAREA' })).toBe(true);
    expect(isTypingElement({ tagName: 'SELECT' })).toBe(true);
    expect(isTypingElement({ tagName: 'DIV', isContentEditable: true })).toBe(true);
    expect(isTypingElement({ tagName: 'INPUT', type: 'checkbox' })).toBe(false);
    expect(isTypingElement({ tagName: 'INPUT', type: 'radio' })).toBe(false);
    expect(isTypingElement({ tagName: 'BUTTON' })).toBe(false);
    expect(isTypingElement({ tagName: 'BODY' })).toBe(false);
    expect(isTypingElement(null)).toBe(false);
  });
});

describe('moving through the clauses', () => {
  it('listedClauseKeys: the clause entries on the list in order (schedule entries are not clauses); Part A is left out under category (ii)', () => {
    const keys = listedClauseKeys(model());
    expect(keys[0]).toBe('f26_category');
    expect(keys).not.toContain('f26_part_a');
    expect(keys).toContain('f26_part_b');
    expect(keys).toHaveLength(56);
    expect(keys.at(-1)).toBe('f26_sign');
  });

  it('adjacentClause goes to the next / previous listed clause and stops at the ends; from a clause the filter hides it goes to the nearest in the form\'s order', () => {
    const keys = listedClauseKeys(model());
    expect(adjacentClause(keys, 'f26_c14', 1)).toBe('f26_c15');
    expect(adjacentClause(keys, 'f26_c14', -1)).toBe('f26_c13');
    expect(adjacentClause(keys, 'f26_sign', 1)).toBeNull();
    expect(adjacentClause(keys, 'f26_category', -1)).toBeNull();
    const few = ['f26_c9', 'f26_c20', 'f26_c40'];
    expect(adjacentClause(few, 'f26_c14', 1)).toBe('f26_c20');
    expect(adjacentClause(few, 'f26_c14', -1)).toBe('f26_c9');
    expect(adjacentClause(few, 'f26_c50', 1)).toBeNull();
    expect(adjacentClause([], 'f26_c14', 1)).toBeNull();
  });

  it('rovingTarget moves among the entries with the arrow keys, Home and End', () => {
    const ids = ['a', 'b', 'c'];
    expect(rovingTarget(ids, 'a', 'ArrowDown')).toBe('b');
    expect(rovingTarget(ids, 'c', 'ArrowDown')).toBe('c');
    expect(rovingTarget(ids, 'b', 'ArrowUp')).toBe('a');
    expect(rovingTarget(ids, 'a', 'ArrowUp')).toBe('a');
    expect(rovingTarget(ids, 'b', 'Home')).toBe('a');
    expect(rovingTarget(ids, 'a', 'End')).toBe('c');
    expect(rovingTarget(ids, 'x', 'ArrowDown')).toBe('a');
    expect(rovingTarget([], 'x', 'ArrowDown')).toBeNull();
    expect(rovingTarget(ids, 'a', 'Enter')).toBeNull();
  });

  it('form26UnfilledStep: F8 from the start goes to the first unfilled item and opens its clause; Shift+F8 to the last; nothing left gives null', () => {
    const values = defaultValues(DEF);
    const items = scanUnfilled(DEF, values, view);
    const first = form26UnfilledStep(DEF, items, null, 1);
    expect(first?.item).toEqual(items[0]);
    expect(first?.target.clauseKey).toBeDefined();
    const second = form26UnfilledStep(DEF, items, first!.item, 1);
    expect(second?.item).toEqual(items[1]);
    expect(form26UnfilledStep(DEF, items, null, -1)?.item).toEqual(items.at(-1));
    expect(form26UnfilledStep(DEF, [], null, 1)).toBeNull();
    values.f.c28 = 'Yes';
    const withSchedule = scanUnfilled(DEF, values, view);
    const table = withSchedule.find((item) => 't' in item && item.t === 'S28');
    expect(form26UnfilledStep(DEF, [table!], null, 1)?.target).toEqual({ clauseKey: 'f26_c28', scheduleId: 's28', focus: { table: 'S28', row: 0, column: '1' } });
  });
});

describe('the header', () => {
  it('badges Form No. 26, Income-tax Act, 2025, Rule 47 and the category; the year sentence; the main button with the count', () => {
    const header = form26HeaderModel({ clientName: 'Invented Traders Private Limited', financialYear: '2026-27', category: '2', saveState: { kind: 'idle' }, clock: () => '16:42', unfilled: 42 });
    expect(header.title).toBe('Tax Audit');
    expect(header.subtitle).toBe('Invented Traders Private Limited - 2026-27');
    expect(header.badges).toEqual(['Form No. 26', 'Income-tax Act, 2025', 'Rule 47', 'Category (ii)']);
    expect(header.why).toBe('Form No. 26 applies to tax years from 2026-27. This engagement is for 2026-27.');
    expect(header.next).toEqual({ label: 'Next unfilled · 42', keys: 'F8', count: '42 unfilled items left' });
    expect(header.save).toEqual({ text: '', tone: 'quiet', retry: false });
    expect(JSON.stringify(header)).not.toMatch(/1961|Beta|6G/);
  });

  it('the save state reads as the plan says; nothing left to fill is said in the header, not in an alert', () => {
    const base = { clientName: 'Invented', financialYear: '2026-27', category: '' as const, clock: () => '16:42', unfilled: 0 };
    expect(form26HeaderModel({ ...base, saveState: { kind: 'saved', at: 1 } }).save.text).toBe('Saved 16:42');
    expect(form26HeaderModel({ ...base, saveState: { kind: 'saving', since: 1 } }).save.text).toBe('Saving…');
    expect(form26HeaderModel({ ...base, saveState: { kind: 'failed', message: 'x', pending: 1 } }).save).toEqual({ text: 'Could not save. Your entry is still on screen. Try again.', tone: 'error', retry: true });
    expect(form26HeaderModel({ ...base, saveState: { kind: 'idle' }, message: 'Nothing left to fill.' }).message).toBe('Nothing left to fill.');
    expect(form26HeaderModel({ ...base, saveState: { kind: 'idle' } }).badges.at(-1)).toBe('Category not chosen');
    expect(form26HeaderModel({ ...base, saveState: { kind: 'idle' } }).next.count).toBe('Nothing left to fill');
    expect(form26HeaderModel({ ...base, unfilled: 1, saveState: { kind: 'idle' } }).next.count).toBe('1 unfilled item left');
  });

  it('a clash whose clause was approved meanwhile says so in the header, not "choose which entry to keep"', () => {
    const base = { clientName: 'Invented', financialYear: '2026-27', category: '' as const, clock: () => '16:42', unfilled: 0 };
    const saveState = { kind: 'changed-elsewhere' as const, clauseKey: 'f26_c14', fields: ['c14b'] };
    expect(form26HeaderModel({ ...base, saveState }).save.text).toBe('Someone else changed this clause. Choose which entry to keep.');
    expect(form26HeaderModel({ ...base, saveState, saveLocked: false }).save.text).toBe('Someone else changed this clause. Choose which entry to keep.');
    expect(form26HeaderModel({ ...base, saveState, saveLocked: true }).save).toEqual({
      text: 'This clause was approved while you were typing. Your entry was not saved.',
      tone: 'warning',
      retry: false,
    });
  });

  it('whether the clash of the save state is on an approved clause (a table: the clause it stands under)', () => {
    const row = (key: string, review_status: string, locked: number) => [key, { clause_key: key, review_status, locked }] as const;
    const rows = new Map([
      row('f26_c14', 'approved', 1),
      row('f26_c28', 'reviewed', 0),
      row('f26_c29', 'locked', 0),
      row('f26_t_S28', 'not_started', 0),
    ]) as unknown as Parameters<typeof form26SaveStateLocked>[2];
    const clash = (clauseKey: string) => ({ kind: 'changed-elsewhere' as const, clauseKey, fields: ['x'] });
    expect(form26SaveStateLocked(DEF, clash('f26_c14'), rows)).toBe(true);
    expect(form26SaveStateLocked(DEF, clash('f26_c29'), rows)).toBe(true);
    expect(form26SaveStateLocked(DEF, clash('f26_c28'), rows)).toBe(false);
    expect(form26SaveStateLocked(DEF, clash('f26_c9'), rows)).toBe(false);
    // S28 stands under clause 28 (not approved); S29 under clause 29 (locked).
    expect(form26SaveStateLocked(DEF, clash('f26_t_S28'), rows)).toBe(false);
    expect(form26SaveStateLocked(DEF, clash('f26_t_S29'), rows)).toBe(true);
    expect(form26SaveStateLocked(DEF, clash('f26_t_NoSuchTable'), rows)).toBe(false);
    expect(form26SaveStateLocked(DEF, { kind: 'saved', at: 1 }, rows)).toBe(false);
    expect(form26SaveStateLocked(DEF, { kind: 'failed', message: 'x', pending: 1 }, rows)).toBe(false);
  });

  it('category badges', () => {
    expect(form26CategoryBadge('1')).toBe('Category (i)');
    expect(form26CategoryBadge('2')).toBe('Category (ii)');
    expect(form26CategoryBadge('')).toBe('Category not chosen');
  });
});

describe('states, tabs and leaving', () => {
  it('the plain sentences of the states', () => {
    expect(FORM26_STATE_TEXT.noAccess).toBe('You are not assigned to this engagement, so its tax audit cannot be opened.');
    expect(FORM26_STATE_TEXT.noEngagement).toBe('Please select an engagement before opening Tax Audit.');
    expect(form26YearUnknownText('Year 26')).toBe('The financial year of this engagement ("Year 26") is not in the form 2026-27, so the tax audit form cannot be chosen. Correct it in Engagements.');
  });

  it('tabs: the clause workspace alone until What changed (task 25) and Review Summary (task 24) exist; the tab bar is drawn only for two or more', () => {
    expect(form26Tabs({ whatChanged: false, reviewSummary: false })).toEqual([{ id: 'clauses', label: 'Clauses' }]);
    expect(form26Tabs({ whatChanged: true, reviewSummary: true })).toEqual([
      { id: 'clauses', label: 'Clauses' },
      { id: 'what-changed', label: 'What changed' },
      { id: 'summary', label: 'Review Summary' },
    ]);
    expect(form26Tabs({ whatChanged: false, reviewSummary: true }).map((tab) => tab.id)).toEqual(['clauses', 'summary']);
  });

  it('closing the window (F6): nothing waiting closes; something waiting is held and saved; a clash or a failure warns once, then lets the user go', () => {
    expect(form26CloseDecision({ allowed: false, pending: false, unresolved: false, warned: false })).toBe('allow');
    expect(form26CloseDecision({ allowed: false, pending: true, unresolved: false, warned: false })).toBe('hold');
    expect(form26CloseDecision({ allowed: false, pending: true, unresolved: true, warned: false })).toBe('warn');
    expect(form26CloseDecision({ allowed: false, pending: true, unresolved: true, warned: true })).toBe('allow');
    expect(form26CloseDecision({ allowed: true, pending: true, unresolved: true, warned: false })).toBe('allow');
    expect(FORM26_CLOSE_WARNING).toEqual({
      title: 'Close without saving?',
      text: 'Some changes are not saved: a save failed, or someone else changed the same answer. If you close now, they are lost.',
      stay: 'Stay',
      close: 'Close without saving',
    });
  });

  it('a held close is saved and then announced, never closed by the workspace itself (lead ruling, Tasks 19-20)', () => {
    // A menu reload cannot be told from a close, so after the save the user is told and closes again.
    expect(form26HeldCloseOutcome(true)).toEqual({ kind: 'saved', message: 'All changes are saved. You can close the window now.' });
    expect(FORM26_CLOSE_SAVED).toBe('All changes are saved. You can close the window now.');
    // A save that fails while the close is held keeps the one existing warning.
    expect(form26HeldCloseOutcome(false)).toEqual({ kind: 'warn' });
    // While the held save is still out, a further close stays held and starts no second save.
    expect(form26CloseDecision({ allowed: false, pending: true, unresolved: false, warned: false, holding: true })).toBe('wait');
    expect(form26CloseDecision({ allowed: false, pending: false, unresolved: false, warned: false, holding: true })).toBe('wait');
    // A clash met while holding still warns once.
    expect(form26CloseDecision({ allowed: false, pending: true, unresolved: true, warned: false, holding: true })).toBe('warn');
    // After the announcement: the second close goes through; an answer changed since is held (and saved) again.
    expect(form26CloseDecision({ allowed: false, pending: false, unresolved: false, warned: false, holding: false })).toBe('allow');
    expect(form26CloseDecision({ allowed: false, pending: true, unresolved: false, warned: false, holding: false })).toBe('hold');
  });

  it('changing the engagement asks first only when changes could not be saved', () => {
    expect(form26LeaveGuardText(false)).toBeNull();
    expect(form26LeaveGuardText(true)).toBe('Some Form No. 26 changes could not be saved and will be lost.');
  });

  it('the editor\'s room for its rows: the body\'s width less its 24 px of side padding', () => {
    expect(form26EditorWidth(396)).toBe(372);
    expect(form26EditorWidth(10)).toBe(0);
  });

  it('a table that met someone else\'s change, or its clause\'s approval, is named in one line with the choices it allows', () => {
    expect(form26TableConflictLine(DEF, 'S28', { theirs: '', at: '2026-11-22 10:42:05' }, false)).toEqual({
      text: `The table under "28. Particulars of penalty levied under any law in force in or outside India" was changed by someone else at ${form26ClockTime('2026-11-22 10:42:05')}.`,
      actions: ['mine', 'theirs'],
    });
    expect(form26TableConflictLine(DEF, 'P14a', { theirs: '', at: '' }, false).text).toBe('The table of clause 14 was changed by someone else.');
    expect(form26TableConflictLine(DEF, 'S28', { theirs: '', at: '' }, true)).toEqual({
      text: 'Clause 28 was approved while you were typing. Your entry in its table was not saved.',
      actions: ['theirs'],
    });
  });

  it('form26FieldKeyOfElement finds the answer a focused control belongs to (a radio option by its group)', () => {
    const node = (id: string, parent: unknown = null) => ({ id, parentElement: parent });
    expect(form26FieldKeyOfElement(node(form26FieldDomId('C.name')) as never)).toBe('C.name');
    const group = node(form26FieldDomId('q9'));
    expect(form26FieldKeyOfElement(node(`${form26FieldDomId('q9')}-o1`, group) as never)).toBe('q9');
    expect(form26FieldKeyOfElement(node('f26-t-S28-0-1') as never)).toBeNull();
    expect(form26FieldKeyOfElement(null)).toBeNull();
  });
});

describe('"Add to the report\'s observations" (decision A8)', () => {
  const base = { clauseNo: '14', category: '2' as const, plainText: 'Invented observation', rows: [{ '1': '', '2': '', '3': '' }], locked: false, partLocked: false };
  it('is offered for clauses 9 to 53 once a category is chosen and the box holds text', () => {
    expect(form26ObservationAction(base)).toEqual({ enabled: true, reason: null, table: 'B5', part: 'Part B' });
    expect(form26ObservationAction({ ...base, category: '1' })).toMatchObject({ enabled: true, table: 'A5', part: 'Part A' });
  });
  it('says why when it is not', () => {
    expect(form26ObservationAction({ ...base, category: '' }).reason).toBe('Choose the category of assessee first.');
    expect(form26ObservationAction({ ...base, clauseNo: '5' }).reason).toBe('Only clauses 9 to 53 go into the report\'s observations.');
    expect(form26ObservationAction({ ...base, plainText: '  ' }).reason).toBe('Write the qualification first.');
    expect(form26ObservationAction({ ...base, rows: [{ '1': '14', '2': '', '3': 'x' }] }).reason).toBe('Clause 14 is already in the report\'s observations (Part B).');
    expect(form26ObservationAction({ ...base, partLocked: true }).reason).toBe('Part B is approved, so its observations cannot be changed.');
    expect(form26ObservationAction({ ...base, locked: true }).enabled).toBe(false);
  });
});
