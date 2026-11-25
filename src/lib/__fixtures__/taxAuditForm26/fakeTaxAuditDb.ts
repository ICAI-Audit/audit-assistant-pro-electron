// An in-memory stand-in for the main process's `sqlite-query` handler, for the Form No. 26 store tests.
// It follows electron/main.cjs (the handler) and electron/sqlite-authorization.cjs for the tables the store
// uses: the engagement scope on a select, the per-row check on insert / update / delete, the protected
// columns, "filtered update and delete only", inserts one by one without a transaction, the unique indexes,
// NOT NULL and CHECK rules, the column defaults (statutory_version defaults to the Form 3CD key) and the
// trigger that stamps `updated_at` in whole seconds. An update answers with the rows that match the SAME
// filters after the trigger has run.
//
// It is stricter than the real thing in one way: a write that would touch a tax-audit row which is not
// Form No. 26's (by `statutory_version` or by `clause_key`) is refused AND recorded in `violations`; so is
// any write to `tax_audit_acceptance_checks` (Form No. 26 has no acceptance check; task 26 only reads it).
// The real renderer client (src/integrations/sqlite/client.ts) is used on top of it, unchanged.

export const THREE_CD_VERSION = 'ITA_TAX_AUDIT_AY_2025_26_RULE_6G_NOTIF_23_2025';
export const FORM26_VERSION = 'ITA_2025_FORM_26_RULE_47_NOTIF_22_2026';

export type FakeRow = Record<string, unknown>;
export type FakeFilter = { column: string; operator?: string; value?: unknown };
export type FakeQuery = {
  table: string; action: string; columns?: string; filters?: FakeFilter[]; data?: unknown;
  orderBy?: { column: string; ascending: boolean }; limit?: number;
};
export type FakeResult = { data: unknown; error: { message: string } | null };

type TableSpec = {
  columns: string[];
  defaults: () => FakeRow;
  notNull: string[];
  checks: Record<string, unknown[]>;
  unique: string[][];
  stamped: boolean;                 // has the trigger that sets updated_at on every update
};

const REVIEW = ['draft', 'prepared', 'reviewed', 'approved', 'locked'];
const ENGAGEMENT_TABLES = new Set(['tax_audit_engagements', 'tax_audit_clause_responses', 'tax_audit_clause_evidence', 'tax_audit_acceptance_checks', 'evidence_files']);
const WRITABLE = new Set(['tax_audit_engagements', 'tax_audit_clause_responses', 'tax_audit_clause_evidence']);
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

const hasOwn = (o: object, key: string): boolean => Object.prototype.hasOwnProperty.call(o, key);
const fail = (message: string): FakeResult => ({ data: null, error: { message } });

function toSqliteValue(value: unknown): unknown {
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value === undefined) return null;
  if (value !== null && typeof value === 'object') return JSON.stringify(value);
  return value;
}

export class FakeTaxAuditDb {
  /** The signed-in user. */
  userId = 'user-1';
  /** Partner or admin: every engagement. Otherwise only the assigned ones. */
  globalAccess = false;
  assigned = new Set<string>();
  /** Every request the client sent, in order. */
  calls: FakeQuery[] = [];
  /** Writes that would have touched a row that is not Form No. 26's. Must stay empty. */
  violations: string[] = [];
  /**
   * Called before a request is carried out. Return a result to answer in its place (nothing is written),
   * throw to make the request itself fail, or wait inside it to make the answer slow.
   */
  before: ((query: FakeQuery, index: number) => FakeResult | void | Promise<FakeResult | void>) | null = null;

  private tables: Record<string, FakeRow[]> = {
    engagements: [], clients: [], evidence_files: [],
    tax_audit_engagements: [], tax_audit_clause_responses: [], tax_audit_clause_evidence: [], tax_audit_acceptance_checks: [],
  };
  private seconds = 0;
  private nextId = 1;

  private specs: Record<string, TableSpec> = {
    engagements: { columns: ['id', 'client_id', 'client_name', 'financial_year', 'engagement_type'], defaults: () => ({}), notNull: [], checks: {}, unique: [], stamped: false },
    clients: { columns: ['id', 'name', 'pan', 'constitution'], defaults: () => ({}), notNull: [], checks: {}, unique: [], stamped: false },
    evidence_files: { columns: ['id', 'engagement_id', 'name', 'file_path'], defaults: () => ({}), notNull: [], checks: {}, unique: [], stamped: false },
    tax_audit_engagements: {
      columns: ['id', 'engagement_id', 'client_id', 'statutory_version', 'form_type', 'financial_year', 'assessment_year', 'previous_year_from', 'previous_year_to',
        'assessee_name', 'pan', 'address', 'status', 'business_or_profession', 'nature_of_business', 'books_audited_under_other_law', 'other_law_name', 'turnover',
        'gross_receipts', 'cash_receipts_percent', 'cash_payments_percent', 'presumptive_taxation', 'lower_than_presumptive', 'applicability_result',
        'applicability_reason', 'setup_json', 'source_links_json', 'status_summary_json', 'review_status', 'prepared_by', 'prepared_at', 'reviewed_by', 'reviewed_at',
        'approved_by', 'approved_at', 'locked', 'locked_by', 'locked_at', 'unlock_reason', 'created_by', 'created_at', 'updated_at'],
      defaults: () => ({
        client_id: null, statutory_version: THREE_CD_VERSION, form_type: '3CB', financial_year: null, assessment_year: null, previous_year_from: null,
        previous_year_to: null, assessee_name: null, pan: null, address: null, status: null, business_or_profession: 'business', nature_of_business: null,
        books_audited_under_other_law: 0, other_law_name: null, turnover: 0, gross_receipts: 0, cash_receipts_percent: 0, cash_payments_percent: 0,
        presumptive_taxation: 0, lower_than_presumptive: 0, applicability_result: null, applicability_reason: null, setup_json: '{}', source_links_json: '[]',
        status_summary_json: '{}', review_status: 'draft', prepared_by: null, prepared_at: null, reviewed_by: null, reviewed_at: null, approved_by: null,
        approved_at: null, locked: 0, locked_by: null, locked_at: null, unlock_reason: null, created_by: null,
      }),
      notNull: ['engagement_id', 'statutory_version', 'form_type', 'books_audited_under_other_law', 'review_status', 'locked'],
      checks: { form_type: ['3CA', '3CB'], review_status: REVIEW },
      unique: [['engagement_id', 'statutory_version']],
      stamped: true,
    },
    tax_audit_clause_responses: {
      columns: ['id', 'tax_audit_id', 'clause_key', 'clause_no', 'clause_title', 'statutory_version', 'applicability_status', 'response_json', 'response_html',
        'auditor_remarks_html', 'prefill_status', 'source_links_json', 'source_conflicts_json', 'missing_fields_json', 'last_source_hash', 'validation_status',
        'validation_messages_json', 'qualification_required', 'qualification_text_html', 'workpaper_ref', 'review_status', 'prepared_by', 'prepared_at',
        'reviewed_by', 'reviewed_at', 'approved_by', 'approved_at', 'locked', 'locked_by', 'locked_at', 'unlock_reason', 'created_at', 'updated_at'],
      defaults: () => ({
        statutory_version: THREE_CD_VERSION, applicability_status: 'applicable', response_json: '{}', response_html: null, auditor_remarks_html: null,
        prefill_status: 'not_attempted', source_links_json: '[]', source_conflicts_json: '[]', missing_fields_json: '[]', last_source_hash: null,
        validation_status: 'not_run', validation_messages_json: '[]', qualification_required: 0, qualification_text_html: null, workpaper_ref: null,
        review_status: 'draft', prepared_by: null, prepared_at: null, reviewed_by: null, reviewed_at: null, approved_by: null, approved_at: null, locked: 0,
        locked_by: null, locked_at: null, unlock_reason: null,
      }),
      notNull: ['tax_audit_id', 'clause_key', 'clause_no', 'clause_title', 'statutory_version', 'applicability_status', 'prefill_status', 'validation_status',
        'qualification_required', 'review_status', 'locked'],
      checks: {
        applicability_status: ['applicable', 'not_applicable', 'not_assessed'],
        prefill_status: ['not_attempted', 'auto_filled', 'partially_filled', 'needs_input', 'source_conflict', 'outdated_source', 'manual_override'],
        validation_status: ['not_run', 'valid', 'warning', 'error'],
        review_status: REVIEW,
      },
      unique: [['tax_audit_id', 'clause_key']],
      stamped: true,
    },
    tax_audit_clause_evidence: {
      columns: ['id', 'tax_audit_id', 'clause_response_id', 'clause_key', 'evidence_file_id', 'workpaper_ref', 'notes_html', 'linked_by', 'linked_at'],
      defaults: () => ({ workpaper_ref: null, notes_html: null, linked_by: null, linked_at: this.now() }),
      notNull: ['tax_audit_id', 'clause_response_id', 'clause_key', 'evidence_file_id'],
      checks: {},
      unique: [['clause_response_id', 'evidence_file_id']],
      stamped: false,
    },
    // The Form 3CD acceptance checklist (sqlite/schema/09_tax_audit_tables.sql): read only here.
    tax_audit_acceptance_checks: {
      columns: ['id', 'tax_audit_id', 'checklist_json', 'overall_status', 'remarks_html', 'reviewed_by', 'reviewed_at', 'approved_by', 'approved_at', 'created_at', 'updated_at'],
      defaults: () => ({ checklist_json: '{}', overall_status: 'not_started', remarks_html: null, reviewed_by: null, reviewed_at: null, approved_by: null, approved_at: null }),
      notNull: ['tax_audit_id', 'checklist_json', 'overall_status'],
      checks: { overall_status: ['not_started', 'in_progress', 'completed', 'issue_noted', 'not_accepted'] },
      unique: [['tax_audit_id']],
      stamped: true,
    },
  };

  /** The database clock, as SQLite's datetime('now') gives it: whole seconds. */
  now(): string {
    return new Date(Date.UTC(2026, 10, 22, 10, 0, 0) + this.seconds * 1000).toISOString().slice(0, 19).replace('T', ' ');
  }

  tick(seconds = 1): void {
    this.seconds += seconds;
  }

  /** A copy of a table's rows. */
  rows(table: string): FakeRow[] {
    return this.table(table).map((row) => ({ ...row }));
  }

  /** Put a row in directly (test set-up, or "what another program wrote"): defaults applied, no access check. */
  seed(table: string, row: FakeRow): FakeRow {
    const stored = this.withDefaults(table, row);
    this.table(table).push(stored);
    return { ...stored };
  }

  /** Change a row as another user's window would: the columns given, and the trigger's time stamp. */
  changeElsewhere(table: string, id: string, patch: FakeRow): void {
    const row = this.table(table).find((entry) => entry.id === id);
    if (!row) throw new Error(`fake database: no row ${id} in ${table}`);
    Object.assign(row, patch);
    if (this.specs[table].stamped) row.updated_at = this.now();
  }

  remove(table: string, keep: (row: FakeRow) => boolean): void {
    this.tables[table] = this.table(table).filter(keep);
  }

  writes(): FakeQuery[] {
    return this.calls.filter((call) => call.action !== 'select');
  }

  /** What the preload exposes as `window.electronAPI.sqliteQuery`. */
  async sqliteQuery(query: FakeQuery): Promise<FakeResult> {
    const index = this.calls.length;
    this.calls.push(JSON.parse(JSON.stringify(query ?? {})) as FakeQuery);
    if (this.before) {
      const instead = await this.before(query, index);
      if (instead) return instead;
    }
    try {
      return this.run(query);
    } catch (error) {
      return fail(error instanceof Error ? error.message : 'SQLite query failed');
    }
  }

  private table(name: string): FakeRow[] {
    const rows = this.tables[name];
    if (!rows) throw new Error(`fake database: unknown table ${name}`);
    return rows;
  }

  private withDefaults(table: string, row: FakeRow): FakeRow {
    const spec = this.specs[table];
    const stored: FakeRow = { id: `id-${this.nextId++}`, ...spec.defaults() };
    if (spec.columns.includes('created_at')) stored.created_at = this.now();
    if (spec.columns.includes('updated_at')) stored.updated_at = this.now();
    for (const key of Object.keys(row)) stored[key] = toSqliteValue(row[key]);
    return stored;
  }

  private hasEngagementAccess(engagementId: unknown): boolean {
    if (this.globalAccess) return true;
    return typeof engagementId === 'string' && engagementId !== '' && this.assigned.has(engagementId);
  }

  // electron/sqlite-authorization.cjs: getRecordEngagementIds
  private engagementIdsOf(table: string, row: FakeRow | undefined): string[] | null {
    if (!row) return [];
    if (table === 'tax_audit_clause_evidence') {
      const audit = this.tables.tax_audit_engagements.find((entry) => entry.id === row.tax_audit_id);
      const file = this.tables.evidence_files.find((entry) => entry.id === row.evidence_file_id);
      if (!audit?.engagement_id || audit.engagement_id !== file?.engagement_id) return [];
      return [String(audit.engagement_id)];
    }
    if (table === 'engagements') return row.id ? [String(row.id)] : [];
    if (hasOwn(row, 'engagement_id')) return row.engagement_id ? [String(row.engagement_id)] : [];
    if (table === 'tax_audit_clause_responses' || table === 'tax_audit_acceptance_checks') {
      return this.engagementIdsOf('tax_audit_engagements', this.tables.tax_audit_engagements.find((entry) => entry.id === row.tax_audit_id));
    }
    return null;
  }

  // electron/sqlite-authorization.cjs: rowIsAuthorized (also what the engagement scope of a select lets through)
  private rowIsAuthorized(table: string, row: FakeRow): boolean {
    const ids = this.engagementIdsOf(table, row);
    if (ids === null) return !ENGAGEMENT_TABLES.has(table);
    return ids.length > 0 && ids.every((id) => this.hasEngagementAccess(id));
  }

  private matches(row: FakeRow, filters: FakeFilter[]): boolean {
    return filters.every((filter) => {
      const held = row[filter.column];
      const value = toSqliteValue(filter.value);
      switch (filter.operator ?? 'eq') {
        case 'in': return Array.isArray(filter.value) && filter.value.map(toSqliteValue).includes(held);
        case 'neq': return held !== null && held !== value;
        case 'is': return held === value;
        case 'gte': return held !== null && value !== null && (held as string | number) >= (value as string | number);
        case 'lte': return held !== null && value !== null && (held as string | number) <= (value as string | number);
        case 'gt': return held !== null && value !== null && (held as string | number) > (value as string | number);
        case 'lt': return held !== null && value !== null && (held as string | number) < (value as string | number);
        default: return held !== null && held === value;
      }
    });
  }

  // Not in the real handler: a write must stay inside Form No. 26.
  private isForm26Row(table: string, row: FakeRow): boolean {
    if (table === 'tax_audit_engagements') return row.statutory_version === FORM26_VERSION;
    if (table === 'tax_audit_clause_responses') return row.statutory_version === FORM26_VERSION && typeof row.clause_key === 'string' && row.clause_key.startsWith('f26_');
    if (table === 'tax_audit_clause_evidence') return typeof row.clause_key === 'string' && row.clause_key.startsWith('f26_');
    return false;
  }

  private violation(what: string): FakeResult {
    this.violations.push(what);
    return fail(`TEST GUARD: ${what}`);
  }

  private constraintError(table: string, row: FakeRow, self: FakeRow | null): string | null {
    const spec = this.specs[table];
    for (const key of Object.keys(row)) {
      if (!spec.columns.includes(key)) return `table ${table} has no column named ${key}`;
    }
    for (const column of spec.notNull) {
      if (row[column] === null || row[column] === undefined) return `NOT NULL constraint failed: ${table}.${column}`;
    }
    for (const column of Object.keys(spec.checks)) {
      if (!spec.checks[column].includes(row[column])) return `CHECK constraint failed: ${column}`;
    }
    for (const columns of spec.unique) {
      const clash = this.table(table).some((other) => other !== self && columns.every((column) => other[column] === row[column]));
      if (clash) return `UNIQUE constraint failed: ${columns.map((column) => `${table}.${column}`).join(', ')}`;
    }
    if (table === 'tax_audit_clause_responses' && !this.tables.tax_audit_engagements.some((audit) => audit.id === row.tax_audit_id)) return 'FOREIGN KEY constraint failed';
    if (table === 'tax_audit_clause_evidence') {
      const parents = this.tables.tax_audit_engagements.some((audit) => audit.id === row.tax_audit_id)
        && this.tables.tax_audit_clause_responses.some((clause) => clause.id === row.clause_response_id)
        && this.tables.evidence_files.some((file) => file.id === row.evidence_file_id);
      if (!parents) return 'FOREIGN KEY constraint failed';
    }
    return null;
  }

  private run(query: FakeQuery): FakeResult {
    const { table, action, columns, data, orderBy, limit } = query ?? ({} as FakeQuery);
    if (!table || !action) return fail('Table and action are required.');
    if (!IDENTIFIER.test(table)) return fail(`Invalid SQL identifier: ${table}`);
    const colList = columns && typeof columns === 'string' ? columns : '*';
    if (colList !== '*' && !/^[A-Za-z_][A-Za-z0-9_]*(\s*,\s*[A-Za-z_][A-Za-z0-9_]*)*$/.test(colList)) return fail('Invalid selected columns.');
    const spec = this.specs[table];
    if (!spec) return fail(`Unknown table: ${table}`);
    if (!['select', 'insert', 'update', 'delete'].includes(action)) return fail(`Access denied for ${action} on ${table}.`);
    if (action !== 'select' && !WRITABLE.has(table)) return this.violation(`${action} on ${table}`);

    const filters = Array.isArray(query.filters) ? query.filters.filter((filter) => filter && filter.column) : [];
    for (const filter of filters) {
      if (!IDENTIFIER.test(filter.column)) return fail(`Invalid SQL identifier: ${filter.column}`);
      if (!spec.columns.includes(filter.column)) return fail(`no such column: ${filter.column}`);
    }
    if ((action === 'update' || action === 'delete') && filters.length === 0) return fail('Filtered update and delete requests are required.');

    if (action === 'select') {
      const wanted = colList === '*' ? null : colList.split(',').map((column) => column.trim());
      if (wanted) for (const column of wanted) if (!spec.columns.includes(column)) return fail(`no such column: ${column}`);
      let rows = this.table(table).filter((row) => this.matches(row, filters) && this.rowIsAuthorized(table, row));
      if (orderBy && orderBy.column) {
        const column = orderBy.column;
        rows = [...rows].sort((a, b) => (String(a[column] ?? '') < String(b[column] ?? '') ? -1 : String(a[column] ?? '') > String(b[column] ?? '') ? 1 : 0));
        if (!orderBy.ascending) rows.reverse();
      }
      if (limit && typeof limit === 'number' && limit > 0) rows = rows.slice(0, limit);
      return { data: rows.map((row) => (wanted ? Object.fromEntries(wanted.map((column) => [column, row[column]])) : { ...row })), error: null };
    }

    if (action === 'insert') {
      if (!data || (Array.isArray(data) && data.length === 0)) return fail('No data to insert.');
      const list: unknown[] = Array.isArray(data) ? data : [data];
      const inserted: FakeRow[] = [];
      for (const given of list) {
        if (!given || typeof given !== 'object' || Array.isArray(given)) return fail('Each inserted row must be an object.');
        const row = given as FakeRow;
        if (!this.rowIsAuthorized(table, row)) return fail('Cannot insert a row outside the authenticated user’s access.');
        const clean: FakeRow = { ...row };
        if ('created_by' in clean) clean.created_by = this.userId;
        for (const key of Object.keys(clean)) if (!IDENTIFIER.test(key)) return fail(`Invalid SQL identifier: ${key}`);
        const stored = this.withDefaults(table, clean);
        const problem = this.constraintError(table, stored, null);
        if (problem) return fail(problem);                       // rows inserted before this one stay: no transaction
        if (!this.isForm26Row(table, stored)) return this.violation(`insert into ${table} of a row that is not Form No. 26's (${String(stored.statutory_version ?? '')} ${String(stored.clause_key ?? '')})`);
        this.table(table).push(stored);
        inserted.push({ ...stored });
      }
      return { data: inserted, error: null };
    }

    if (action === 'update') {
      if (!data || typeof data !== 'object' || Array.isArray(data)) return fail('No data to update.');
      const patch = data as FakeRow;
      const targets = this.table(table).filter((row) => this.matches(row, filters));
      const isProtected = (row: FakeRow) => Object.keys(patch)
        .filter((key) => !(key in row && String(row[key] ?? '') === String(patch[key] ?? '')))
        .some((key) => ['id', 'engagement_id', 'created_by', 'uploaded_by'].includes(key));
      if (targets.some((row) => !this.rowIsAuthorized(table, row) || isProtected(row) || !this.rowIsAuthorized(table, { ...row, ...patch }))) {
        return fail('Update includes a protected or inaccessible row or field.');
      }
      const keys = Object.keys(patch);
      if (keys.length === 0) return fail('No fields to update.');
      for (const key of keys) if (!spec.columns.includes(key)) return fail(`no such column: ${key}`);
      for (const row of targets) {
        if (!this.isForm26Row(table, row)) return this.violation(`update of a ${table} row that is not Form No. 26's (${String(row.id)})`);
        const next: FakeRow = { ...row };
        for (const key of keys) next[key] = toSqliteValue(patch[key]);
        if (!this.isForm26Row(table, next)) return this.violation(`update that takes a ${table} row out of Form No. 26 (${String(row.id)})`);
        const problem = this.constraintError(table, next, row);
        if (problem) return fail(problem);
      }
      for (const row of targets) {
        for (const key of keys) row[key] = toSqliteValue(patch[key]);
        if (spec.stamped) row.updated_at = this.now();           // the AFTER UPDATE trigger
      }
      // As the handler: the rows that match the same filters NOW (a filter on updated_at may match none any more).
      return { data: this.table(table).filter((row) => this.matches(row, filters) && this.rowIsAuthorized(table, row)).map((row) => ({ ...row })), error: null };
    }

    const targets = this.table(table).filter((row) => this.matches(row, filters));
    if (targets.some((row) => !this.rowIsAuthorized(table, row))) return fail('Cannot delete an inaccessible row.');
    for (const row of targets) {
      if (!this.isForm26Row(table, row)) return this.violation(`delete of a ${table} row that is not Form No. 26's (${String(row.id)})`);
    }
    if (table !== 'tax_audit_clause_evidence') return this.violation(`delete from ${table}`);
    this.tables[table] = this.table(table).filter((row) => !targets.includes(row));
    return { data: null, error: null };
  }
}

// The real client keeps the first `electronAPI` it is given for good, so it is handed one object that passes
// each request to the database of the test now running.
let current: FakeTaxAuditDb | null = null;
const electronAPI = {
  sqliteQuery: (query: FakeQuery): Promise<FakeResult> => {
    if (!current) return Promise.resolve(fail('fake database: no database is set'));
    return current.sqliteQuery(query);
  },
};

/** The application's own SQLite client (src/integrations/sqlite/client.ts), talking to this fake database. */
export async function clientOn(db: FakeTaxAuditDb) {
  current = db;
  const holder = globalThis as { window?: { electronAPI?: unknown } };
  if (!holder.window) holder.window = {};
  holder.window.electronAPI = electronAPI;
  const client = await import('@/integrations/sqlite/client');
  return client.getSQLiteClient();
}
