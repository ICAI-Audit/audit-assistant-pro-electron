// SQLite data-access adapter for the Financial Statement Review (FSG) module.
//
// FSG_Bharat was written against PostgreSQL through node-pg: every call site
// does `const { rows } = await query(sql, [$1, $2 ...])` and a handful wrap
// work in runInTransaction(async () => ...). ICAI VERA keeps all data in one
// local better-sqlite3 database (audit_assistant.db), opened by electron/main.cjs.
// This module keeps FSG's query()/runInTransaction() contract so the ported
// handlers stay close to the tested originals, while executing on VERA's
// connection:
//
//   * `$n` placeholders are rewritten to positional `?` (reused numbers are
//     expanded), skipping string literals, quoted identifiers and comments.
//   * Parameters are converted to values SQLite can bind: booleans -> 1/0,
//     Date -> ISO-8601 text, undefined -> NULL, arrays/plain objects -> JSON text
//     (read back with json_each() where PostgreSQL used `= ANY($n)`).
//   * Results come back as node-pg did: { rows, rowCount }. Known boolean
//     columns are returned as true/false (PostgreSQL BOOLEAN semantics).
//   * A small set of PostgreSQL functions used by FSG SQL is registered as
//     SQLite functions (see registerPgCompatFunctions). PostgreSQL-only syntax
//     (casts, DISTINCT ON, data-modifying CTEs, FOR UPDATE ...) is rewritten at
//     the call sites, not here.
//
// Transactions: better-sqlite3 is synchronous and cannot hold an async
// callback inside db.transaction(). runInTransaction() therefore issues
// BEGIN IMMEDIATE / COMMIT / ROLLBACK itself, runs the callback inside an
// AsyncLocalStorage context, and makes every query() from *outside* that
// context wait until the transaction finishes. Callbacks must only await
// query()/runInTransaction() (no file or network I/O) so that no unrelated IPC
// handler on the shared connection can run while the transaction is open.

import { AsyncLocalStorage } from 'node:async_hooks'

let db = null
const txStorage = new AsyncLocalStorage()
let activeTx = null // { done: Promise<void> } while a transaction is open

const STATEMENT_CACHE_LIMIT = 500
const statementCache = new Map()

// Columns declared BOOLEAN in the FSG PostgreSQL schema. SQLite stores them as
// 0/1; node-pg returned true/false and FSG code compares with === true / false.
const BOOLEAN_COLUMNS = new Set([
  'is_default',
  'is_active',
  'has_branches',
  'locked',
  'is_final',
  'manual_py',
  'is_revenue',
  'is_deemed_positive',
  'hand_fixed',
  'is_custom',
  'consolidated_manual_py',
  'consolidated_pl_closed_to_capital',
])

export function attachDatabase(sqliteDb) {
  if (!sqliteDb) throw new Error('FSG: a SQLite connection is required.')
  if (db === sqliteDb) return
  db = sqliteDb
  statementCache.clear()
  registerPgCompatFunctions(db)
}

export function getDB() {
  if (!db) throw new Error('Database not initialised.')
  return db
}

// The SQLite connection is owned and closed by electron/main.cjs.
export function flushDB() {}

// ── PostgreSQL compatibility functions ─────────────────────────────────────

function pgRegexToJs(pattern, flags) {
  const jsFlags = new Set()
  for (const f of String(flags || '')) {
    if (f === 'g') jsFlags.add('g')
    else if (f === 'i') jsFlags.add('i')
  }
  return new RegExp(String(pattern), [...jsFlags].join(''))
}

function registerPgCompatFunctions(conn) {
  const fn = (name, options, impl) => conn.function(name, options, impl)

  // now(): PostgreSQL transaction timestamp. Stored as ISO-8601 UTC text, the
  // same format the schema defaults use.
  fn('now', { deterministic: false }, () => new Date().toISOString())

  // regexp_replace(source, pattern, replacement [, flags])
  fn('regexp_replace', { deterministic: true, varargs: true }, (source, pattern, replacement, flags) => {
    if (source === null || source === undefined) return null
    return String(source).replace(pgRegexToJs(pattern, flags), String(replacement ?? ''))
  })

  // btrim(text [, characters])
  fn('btrim', { deterministic: true, varargs: true }, (value, chars) => {
    if (value === null || value === undefined) return null
    const s = String(value)
    const set = new Set(chars === undefined || chars === null ? ' ' : String(chars))
    let start = 0
    let end = s.length
    while (start < end && set.has(s[start])) start++
    while (end > start && set.has(s[end - 1])) end--
    return s.slice(start, end)
  })

  // strpos(text, substring): 1-based position, 0 when absent (same as instr).
  fn('strpos', { deterministic: true }, (value, needle) => {
    if (value === null || value === undefined || needle === null || needle === undefined) return null
    return String(value).indexOf(String(needle)) + 1
  })

  // greatest()/least() ignore NULL arguments in PostgreSQL; SQLite's
  // multi-argument max()/min() return NULL if any argument is NULL.
  fn('greatest', { deterministic: true, varargs: true }, (...args) => {
    const values = args.filter((v) => v !== null && v !== undefined)
    if (!values.length) return null
    return values.reduce((a, b) => (b > a ? b : a))
  })
  fn('least', { deterministic: true, varargs: true }, (...args) => {
    const values = args.filter((v) => v !== null && v !== undefined)
    if (!values.length) return null
    return values.reduce((a, b) => (b < a ? b : a))
  })
}

// ── SQL / parameter translation ────────────────────────────────────────────

// Rewrites $1..$n to `?` and returns the parameter order. Text inside '...',
// "...", -- comments and /* */ comments is copied unchanged.
export function translatePlaceholders(sql) {
  let out = ''
  const order = []
  let i = 0
  const n = sql.length
  while (i < n) {
    const ch = sql[i]
    if (ch === "'" || ch === '"') {
      let j = i + 1
      while (j < n) {
        if (sql[j] === ch) {
          if (sql[j + 1] === ch) { j += 2; continue }
          break
        }
        j++
      }
      out += sql.slice(i, j + 1)
      i = j + 1
      continue
    }
    if (ch === '-' && sql[i + 1] === '-') {
      const j = sql.indexOf('\n', i)
      const end = j === -1 ? n : j
      out += sql.slice(i, end)
      i = end
      continue
    }
    if (ch === '/' && sql[i + 1] === '*') {
      const j = sql.indexOf('*/', i + 2)
      const end = j === -1 ? n : j + 2
      out += sql.slice(i, end)
      i = end
      continue
    }
    if (ch === '$' && /[0-9]/.test(sql[i + 1] || '')) {
      let j = i + 1
      while (j < n && /[0-9]/.test(sql[j])) j++
      order.push(Number(sql.slice(i + 1, j)) - 1)
      out += '?'
      i = j
      continue
    }
    out += ch
    i++
  }
  return { sql: out, order }
}

export function toSqliteParam(value) {
  if (value === undefined || value === null) return null
  if (typeof value === 'boolean') return value ? 1 : 0
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'bigint' || typeof value === 'number' || typeof value === 'string') return value
  if (Buffer.isBuffer(value)) return value
  if (Array.isArray(value) || typeof value === 'object') return JSON.stringify(value)
  return value
}

function normaliseRow(row) {
  for (const key of Object.keys(row)) {
    if (BOOLEAN_COLUMNS.has(key)) {
      const v = row[key]
      if (v === 0 || v === 1) row[key] = v === 1
    }
  }
  return row
}

function prepare(conn, sql) {
  let entry = statementCache.get(sql)
  if (entry) {
    statementCache.delete(sql)
    statementCache.set(sql, entry)
    return entry
  }
  const translated = translatePlaceholders(sql)
  const stmt = conn.prepare(translated.sql)
  entry = { stmt, order: translated.order }
  statementCache.set(sql, entry)
  if (statementCache.size > STATEMENT_CACHE_LIMIT) {
    statementCache.delete(statementCache.keys().next().value)
  }
  return entry
}

function isMultiStatementError(err) {
  return err && /more than one statement/i.test(String(err.message))
}

function runNow(sql, params) {
  const conn = getDB()
  let entry
  try {
    entry = prepare(conn, sql)
  } catch (err) {
    // Parameterless DDL batches (several statements in one string).
    if (isMultiStatementError(err) && (!params || params.length === 0)) {
      conn.exec(sql)
      return { rows: [], rowCount: 0 }
    }
    err.message = `${err.message}\nSQL: ${sql.trim().slice(0, 400)}`
    throw err
  }
  const values = entry.order.map((index) => {
    if (index < 0 || index >= params.length) {
      throw new Error(`FSG query references parameter $${index + 1} but ${params.length} were supplied.`)
    }
    return toSqliteParam(params[index])
  })
  try {
    if (entry.stmt.reader) {
      const rows = entry.stmt.all(...values).map(normaliseRow)
      return { rows, rowCount: rows.length }
    }
    const info = entry.stmt.run(...values)
    return { rows: [], rowCount: info.changes, lastInsertRowid: info.lastInsertRowid }
  } catch (err) {
    err.message = `${err.message}\nSQL: ${sql.trim().slice(0, 400)}`
    throw err
  }
}

// The check of activeTx and the work that depends on it must run with no
// `await` in between; otherwise another caller could claim or release the
// transaction in the gap.

export async function query(sql, params = []) {
  // Queries issued inside the running transaction's async context proceed;
  // everything else waits for it to finish.
  while (activeTx && txStorage.getStore() !== activeTx) {
    await activeTx.done
  }
  return runNow(sql, params)
}

export async function runInTransaction(fn) {
  while (activeTx) {
    // Re-entrant: nested calls join the transaction already open in this context.
    if (txStorage.getStore() === activeTx) return fn()
    await activeTx.done
  }
  const conn = getDB()
  let release
  const tx = { done: new Promise((resolve) => { release = resolve }) }
  activeTx = tx
  try {
    conn.exec('BEGIN IMMEDIATE')
    try {
      const result = await txStorage.run(tx, fn)
      conn.exec('COMMIT')
      return result
    } catch (err) {
      try { conn.exec('ROLLBACK') } catch (_) { /* already rolled back */ }
      throw err
    }
  } finally {
    activeTx = null
    release()
  }
}

// FSG serialised start-up work across many PCs sharing one PostgreSQL server
// (pg_advisory_lock). VERA's database is a local file opened by one process,
// so start-up work simply runs in order.
export async function withStartupLock(fn) {
  return fn()
}
