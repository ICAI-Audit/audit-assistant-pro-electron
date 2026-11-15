'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { requirePastOrToday } = require('../electron/permanent-file/domain.cjs');

test('date validation accepts the local current date and rejects future or invalid dates', () => {
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  assert.doesNotThrow(() => requirePastOrToday(today, 'Date'));
  assert.throws(() => requirePastOrToday('9999-12-31', 'Date'), /future/i);
  assert.throws(() => requirePastOrToday('2024-02-30', 'Date'), /valid calendar date/i);
});
const { CATEGORIES, compareYearEnds, documentReference } = require('../electron/permanent-file/domain.cjs');

test('all fifteen requested categories have stable codes', () => {
  assert.equal(Object.keys(CATEGORIES).length, 15);
  assert.equal(CATEGORIES['PF-06'], 'Banking and borrowings');
  assert.equal(CATEGORIES['PF-15'], 'Continuing audit observations');
});

test('document references retain entity, category, document and version identity', () => {
  assert.equal(documentReference('ENTITYID', 'PF-06', 1, 2), 'ENTITYID-PF-06-DOC-001-V02');
  assert.equal(documentReference('a1-b2', 'PF-15', 1000, 100), 'a1-b2-PF-15-DOC-1000-V100');
  assert.throws(() => documentReference('../client', 'PF-06', 1, 1), /Entity ID/);
  assert.throws(() => documentReference('ENTITYID', 'PF-16', 1, 1), /category/);
  assert.throws(() => documentReference('ENTITYID', 'PF-01', 0, 1), /Document number/);
  assert.throws(() => documentReference('ENTITYID', 'PF-01', 1, 1.5), /version/);
});

test('year-end comparison flags added, removed and changed records only', () => {
  const records = [
    { kind: 'director', subjectId: 'one', effectiveFrom: '2020-01-01', effectiveUntil: '2025-04-01', attributes: { name: 'A', title: 'Director' } },
    { kind: 'director', subjectId: 'one', effectiveFrom: '2025-04-01', effectiveUntil: null, attributes: { title: 'Chair', name: 'A' } },
    { kind: 'director', subjectId: 'two', effectiveFrom: '2025-04-01', effectiveUntil: null, attributes: { name: 'B' } },
    { kind: 'partner', subjectId: 'three', effectiveFrom: '2020-01-01', effectiveUntil: '2025-04-01', attributes: { name: 'C' } },
    { kind: 'shareholder', subjectId: 'four', effectiveFrom: '2020-01-01', effectiveUntil: null, attributes: { name: 'D', percentage: 25 } },
    { kind: 'director', subjectId: 'future', effectiveFrom: '2026-04-01', effectiveUntil: null, attributes: { name: 'E' } },
  ];
  assert.deepEqual(compareYearEnds(records, '2025-03-31', '2026-03-31'), [
    { kind: 'director', subjectId: 'one', change: 'changed', before: { name: 'A', title: 'Director' }, after: { title: 'Chair', name: 'A' } },
    { kind: 'director', subjectId: 'two', change: 'added', before: null, after: { name: 'B' } },
    { kind: 'partner', subjectId: 'three', change: 'removed', before: { name: 'C' }, after: null },
  ]);
});

test('effective start is inclusive and end is exclusive', () => {
  const records = [
    { kind: 'director', subjectId: 'one', effectiveFrom: '2025-03-31', effectiveUntil: '2026-03-31', attributes: { name: 'A' } },
  ];
  assert.equal(compareYearEnds(records, '2025-03-31', '2026-03-31')[0].change, 'removed');
});

test('invalid inputs and overlapping records at a comparison date fail explicitly', () => {
  const entry = { kind: 'director', subjectId: 'one', effectiveFrom: '2020-01-01', effectiveUntil: null, attributes: { name: 'A' } };
  assert.throws(() => compareYearEnds([entry, entry], '2025-03-31', '2026-03-31'), /Overlapping/);
  assert.throws(() => compareYearEnds([entry], '2026-03-31', '2025-03-31'), /precede/);
  assert.throws(() => compareYearEnds([entry], '2025-02-29', '2026-03-31'), /calendar date/);
  assert.throws(() => compareYearEnds([{ ...entry, effectiveUntil: '2019-01-01' }], '2025-03-31', '2026-03-31'), /after effective from/);
  assert.throws(() => compareYearEnds([{ ...entry, attributes: null }], '2025-03-31', '2026-03-31'), /attributes/);
});
