'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { getDevelopmentUserDataPath } = require('./dev-user-data.cjs');

const defaultUserDataPath = path.resolve('standard-user-data');
const isolatedPath = path.resolve('isolated-synthetic-user-data');

test('keeps the default userData path when no development override is set', () => {
  assert.equal(
    getDevelopmentUserDataPath({ NODE_ENV: 'development' }, defaultUserDataPath),
    null,
  );
});

test('accepts a distinct absolute path only in development', () => {
  assert.equal(
    getDevelopmentUserDataPath({
      NODE_ENV: 'development',
      ICAI_VERA_DEV_USER_DATA_DIR: isolatedPath,
    }, defaultUserDataPath),
    isolatedPath,
  );
});

test('rejects the override outside development', () => {
  assert.throws(
    () => getDevelopmentUserDataPath({
      NODE_ENV: 'production',
      ICAI_VERA_DEV_USER_DATA_DIR: isolatedPath,
    }, defaultUserDataPath),
    /only supported when NODE_ENV=development/,
  );
});

test('rejects relative and default userData paths', () => {
  assert.throws(
    () => getDevelopmentUserDataPath({
      NODE_ENV: 'development',
      ICAI_VERA_DEV_USER_DATA_DIR: 'relative-user-data',
    }, defaultUserDataPath),
    /must be an absolute path/,
  );
  assert.throws(
    () => getDevelopmentUserDataPath({
      NODE_ENV: 'development',
      ICAI_VERA_DEV_USER_DATA_DIR: defaultUserDataPath,
    }, defaultUserDataPath),
    /must differ from the default userData path/,
  );
});
