'use strict';

const { isDeepStrictEqual } = require('node:util');

const CATEGORIES = Object.freeze({
  'PF-01': 'Entity master information',
  'PF-02': 'Incorporation and constitutional documents',
  'PF-03': 'Ownership and management',
  'PF-04': 'Business operations',
  'PF-05': 'Legal agreements and contracts',
  'PF-06': 'Banking and borrowings',
  'PF-07': 'Registrations and licences',
  'PF-08': 'Accounting policies',
  'PF-09': 'Internal control and processes',
  'PF-10': 'Historical financial statements',
  'PF-11': 'Tax and statutory compliance',
  'PF-12': 'Litigation and contingent liabilities',
  'PF-13': 'Group and related-party information',
  'PF-14': 'Industry-specific records',
  'PF-15': 'Continuing audit observations',
});

function documentReference(entityId, category, documentNumber, version) {
  if (typeof entityId !== 'string' || !/^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/.test(entityId)) {
    throw new TypeError('Entity ID must contain only letters, numbers, and internal hyphens.');
  }
  if (!Object.hasOwn(CATEGORIES, category)) throw new RangeError('Unknown permanent-file category.');
  if (!Number.isSafeInteger(documentNumber) || documentNumber < 1) {
    throw new RangeError('Document number must be a positive safe integer.');
  }
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new RangeError('Document version must be a positive safe integer.');
  }
  return `${entityId}-${category}-DOC-${String(documentNumber).padStart(3, '0')}-V${String(version).padStart(2, '0')}`;
}

function validDate(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new TypeError(`${label} must be a date in YYYY-MM-DD format.`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new RangeError(`${label} must be a valid calendar date.`);
  }
}

function requirePastOrToday(value, label) {
  validDate(value, label);
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  if (value > today) throw new RangeError(`${label} cannot be in the future.`);
}

function snapshotAt(records, date) {
  const result = new Map();
  for (const record of records) {
    if (record.effectiveFrom <= date && (record.effectiveUntil === null || date < record.effectiveUntil)) {
      const key = JSON.stringify([record.kind, record.subjectId]);
      if (result.has(key)) {
        throw new Error('Overlapping effective records for the same subject and kind.');
      }
      result.set(key, record);
    }
  }
  return result;
}

function compareYearEnds(records, previousDate, currentDate) {
  if (!Array.isArray(records)) throw new TypeError('Records must be an array.');
  validDate(previousDate, 'Previous year end');
  validDate(currentDate, 'Current year end');
  if (previousDate >= currentDate) throw new RangeError('Previous year end must precede current year end.');

  for (const record of records) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      throw new TypeError('Each history record must be an object.');
    }
    if (typeof record.kind !== 'string' || !record.kind.trim()
      || typeof record.subjectId !== 'string' || !record.subjectId.trim()) {
      throw new TypeError('Each history record needs a kind and a stable subject ID.');
    }
    validDate(record.effectiveFrom, 'Effective from');
    if (record.effectiveUntil !== null) {
      validDate(record.effectiveUntil, 'Effective until');
      if (record.effectiveUntil <= record.effectiveFrom) {
        throw new RangeError('Effective until must be after effective from.');
      }
    }
    if (!record.attributes || Object.getPrototypeOf(record.attributes) !== Object.prototype) {
      throw new TypeError('Record attributes must be a plain object.');
    }
  }

  const previous = snapshotAt(records, previousDate);
  const current = snapshotAt(records, currentDate);
  const keys = [...new Set([...previous.keys(), ...current.keys()])].sort();
  return keys.flatMap((key) => {
    const before = previous.get(key);
    const after = current.get(key);
    if (!before) return [{ kind: after.kind, subjectId: after.subjectId, change: 'added', before: null, after: after.attributes }];
    if (!after) return [{ kind: before.kind, subjectId: before.subjectId, change: 'removed', before: before.attributes, after: null }];
    if (!isDeepStrictEqual(before.attributes, after.attributes)) {
      return [{ kind: after.kind, subjectId: after.subjectId, change: 'changed', before: before.attributes, after: after.attributes }];
    }
    return [];
  });
}

module.exports = { CATEGORIES, compareYearEnds, documentReference, requirePastOrToday };
