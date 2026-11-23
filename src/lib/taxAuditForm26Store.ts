// Form No. 26 in the database: loading an audit (creating and completing its rows), saving one row with a
// check that nobody else has changed it, the setup, and evidence links.
//
// The database client is handed in, so this file runs without Electron. Every request here names the
// Form 26 statutory-version key or a Form 26 audit / row id; no request can reach a Form 3CD row:
//  - an audit row is read and written only together with the Form 26 version key;
//  - a clause row is written only `WHERE id = ? AND statutory_version = <Form 26> AND updated_at = ?`
//    (and `response_json` still the answers that were read, whenever the caller gives them; when its
//    answers are being replaced, also only while the row is not approved or locked);
//  - the setup of the audit row is written only `WHERE id = ? AND statutory_version = <Form 26> AND
//    updated_at = ? AND setup_json = <as read>`, entry by entry on top of what is stored;
//  - an evidence link is added or removed only for a row whose key is one of Form 26's;
//  - once a load has opened an audit, rows, links and setup of any other audit are neither read back nor
//    written through this store (`AND tax_audit_id = <that audit>`);
//  - the earlier Form 3CD draft (task 26) is only ever SELECTED: its audit row, clause rows, evidence links and
//    acceptance check are read to bring answers across and to show it read only, and never written.
import { FORM26_ALL_ROW_KEYS, FORM26_CLAUSE_UNITS, form26ClauseKeyOfField, form26ClauseKeyOfTable, form26TableRowKey } from '@/data/taxAuditForm26Clauses';
import { FORM26_DEFINITION } from '@/data/taxAuditForm26Definition';
import { TAX_AUDIT_FORM26_STATUTORY_VERSION, TAX_AUDIT_FORM26_WORKPAPER_PREFIX } from '@/data/taxAuditForm26Version';
import { FORM26_CARRY, isThreeCdUntouched, planConversion, type ThreeCdSnapshot } from '@/lib/taxAuditForm26Conversion';
import { isRowLocked } from '@/lib/taxAuditForm26Review';
import type { Form26SaveOutcome } from '@/lib/taxAuditForm26SaveQueue';
import {
  clausePayloadPatch,
  derivedAuditColumns,
  isForm26RowKey,
  missingRows,
  newAuditRow,
  parseClausePayload,
  parseTablePayload,
  prefillParticulars,
  readSetup,
  seedRows,
  tablePayload,
  valuesFromRows,
  writeSetup,
  type Form26NewClauseRow,
  type Form26Setup,
} from '@/lib/taxAuditForm26Storage';
import { defaultValues, type Form26Row, type Form26Values } from '@/lib/taxAuditForm26Values';
import { FORM26_FIRST_TAX_YEAR_START, parseEngagementYear } from '@/lib/taxAuditForm26Year';
import type { TaxAuditClauseEvidence, TaxAuditClauseResponse, TaxAuditSetup } from '@/types/taxAudit';

export type Form26Db = ReturnType<typeof import('@/integrations/sqlite/client').getSQLiteClient>;   // type only
export type Form26ClauseRow = TaxAuditClauseResponse;
export type Form26Loaded =
  | { state: 'ready'; audit: TaxAuditSetup; setup: Form26Setup; rows: Form26ClauseRow[]; evidence: TaxAuditClauseEvidence[]; values: Form26Values }
  | { state: 'needs-conversion'; threeCdAuditId: string }
  | { state: 'no-access' } | { state: 'error'; message: string };
export type Form26SaveRowResult =
  | { ok: true; row: Form26ClauseRow }
  | { ok: false; reason: 'changed-elsewhere'; latest: Form26ClauseRow }
  | { ok: false; reason: 'failed'; message: string };
/** An entry of the setup that a save can change. */
export type Form26SetupEntry = Exclude<keyof Form26Setup, 'v'>;
/**
 * `changed-elsewhere`: the entries named were changed by someone else since the user saw them; nothing was
 * written; `audit` and `setup` are the row as it is now (show them; saving again on top of them is "Keep mine").
 */
export type Form26SaveSetupResult =
  | { ok: true; audit: TaxAuditSetup; setup: Form26Setup }
  | { ok: false; reason: 'changed-elsewhere'; fields: Form26SetupEntry[]; audit: TaxAuditSetup; setup: Form26Setup }
  | { ok: false; reason: 'failed'; message: string };
export type Form26Store = {
  load(input: { engagementId: string; clientId: string | null; financialYear: string; userId: string }): Promise<Form26Loaded>;
  createAudit(input: { engagementId: string; clientId: string | null; financialYear: string; setup?: Partial<Form26Setup> }): Promise<TaxAuditSetup>;
  /**
   * `row`: what the user saw. Its `updated_at` is always checked; its `response_json`, when given, too (also
   * for a change of state: an approval is refused when the answers moved). Leave the answers out for a patch
   * that does not depend on them (unlocking, remarks, the qualification box).
   */
  saveRow(row: { id: string; updated_at?: string; response_json?: string | null }, patch: Partial<Form26ClauseRow>): Promise<Form26SaveRowResult>;
  /**
   * Changes only the entries the patch names, on top of the setup as stored now. An entry whose stored value
   * differs from what the user saw (`seen`, else the `setup_json` of the audit row the caller holds) is a
   * clash: nothing is written. Pass the audit row you hold, as it is (a row without `setup_json` means "not
   * known" and skips the check for the entries `seen` does not give), and only the entries the user changed.
   */
  saveSetup(audit: { id?: string; setup_json?: string | null }, patch: Partial<Form26Setup>, seen?: Partial<Form26Setup>): Promise<Form26SaveSetupResult>;
  reloadRow(id: string): Promise<Form26ClauseRow | null>;
  linkEvidence(audit: { id: string }, row: Form26ClauseRow, evidenceFileId: string, userId: string): Promise<void>;
  unlinkEvidence(linkId: string): Promise<void>;
  listEvidence(taxAuditId: string): Promise<TaxAuditClauseEvidence[]>;
  findThreeCdAudit(engagementId: string): Promise<{ id: string } | null>;      // select only
  findForm26Audit(engagementId: string): Promise<{ id: string } | null>;       // select only
  /** Last year's tax audit of the same client (task 25). Select only; never binds the store. */
  loadLastYear(input: { engagementId: string; clientId: string | null; financialYear: string }): Promise<Form26LastYearResult>;
  /**
   * Task 26 (R5): makes the Form No. 26 audit of an engagement that holds a Form 3CD draft, brings the answers
   * of the same substance across (marked "brought", to be confirmed) and records the conversion; a conversion
   * left unfinished is completed by the next load. Never writes a Form 3CD row. Binds the store to the audit.
   */
  convert(input: { engagementId: string; clientId: string | null; financialYear: string; threeCdAuditId: string; userId: string }): Promise<Form26Loaded>;
  /** The engagement's year moved within Form No. 26 years: the audit row's `financial_year` follows; nothing else changes. */
  syncYear(audit: TaxAuditSetup, financialYear: string): Promise<TaxAuditSetup>;
  /** The earlier Form 3CD draft as it is stored. Select only; null for an id that is not a Form 3CD audit the user may see. */
  loadThreeCdSnapshot(threeCdAuditId: string): Promise<ThreeCdSnapshot | null>;
  /** The engagement's Form No. 26 draft for the read-only view (a year changed back to Form 3CD). Select only; never binds. */
  readForm26Draft(engagementId: string): Promise<Form26Draft | null>;
};
/** A Form No. 26 audit read only: its row, its setup, its rows and the answers they hold. */
export type Form26Draft = { audit: TaxAuditSetup; setup: Form26Setup; rows: Form26ClauseRow[]; values: Form26Values };
export type Form26LastYearForm = '3cd' | 'form26';
/**
 * `none`: no engagement of last year for this client that the user may open, or no tax audit on it (`year`
 * is last year as '2025-26', null when this engagement's year is not understood). `form`: the form of last
 * year ('3cd' before tax year 2026-27).
 */
export type Form26LastYearResult =
  | { state: 'none'; year: string | null; form: Form26LastYearForm }
  | { state: 'found'; year: string; form: Form26LastYearForm; audit: TaxAuditSetup; rows: TaxAuditClauseResponse[] }
  | { state: 'error'; message: string };

export const FORM26_LOAD_FAILED = 'Form No. 26 could not be loaded.';
export const FORM26_NOT_PREPARED = 'Form No. 26 could not be prepared for this engagement.';
const ROW_NOT_FOUND = 'This clause could not be found. Open the engagement again.';
const KEEPS_CHANGING = 'This clause is being changed by someone else. Try again.';
const AUDIT_NOT_FOUND = 'This Form No. 26 audit could not be found. Open the engagement again.';
const SETUP_KEEPS_CHANGING = 'The settings of this audit are being changed by someone else. Try again.';
const SETUP_ENTRIES: Form26SetupEntry[] = ['category', 'showAllSchedules', 'comparisonHidden', 'conversion', 'importedFrom'];

const AUDITS = 'tax_audit_engagements';
const CLAUSES = 'tax_audit_clause_responses';
const LINKS = 'tax_audit_clause_evidence';
const ACCEPTANCE = 'tax_audit_acceptance_checks';
const VERSION = TAX_AUDIT_FORM26_STATUTORY_VERSION;
// The columns that say which row a clause row is: never part of a save.
const IDENTITY_COLUMNS = ['id', 'tax_audit_id', 'clause_key', 'statutory_version', 'created_at', 'updated_at'];
const MERGE_ATTEMPTS = 4;

type DbResult = { data: unknown; error: { message?: string } | null };

class Form26NoAccess extends Error {}

const messageOf = (error: unknown, fallback: string): string => {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'object' && error !== null && typeof (error as { message?: unknown }).message === 'string') {
    return (error as { message: string }).message || fallback;
  }
  return fallback;
};

// The result of a request, or a thrown Error carrying the database's message.
async function run(request: PromiseLike<DbResult>): Promise<unknown> {
  const { data, error } = await request;
  if (error) throw new Error(messageOf(error, 'The database refused the request.'));
  return data;
}

const listOf = <T,>(data: unknown): T[] => (Array.isArray(data) ? (data as T[]) : []);

// A value as the database holds it, for comparing a patch with the row read back.
function held(value: unknown): string {
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

const hasOwn = (o: object, key: string): boolean => Object.prototype.hasOwnProperty.call(o, key);

// One entry of the setup as readSetup gives it (unknown parts dropped, a fixed order), as text for comparing.
function entryText(key: Form26SetupEntry, value: unknown): string {
  const entry = readSetup(JSON.stringify({ form26: { v: 1, category: '', showAllSchedules: false, [key]: value } }))[key];
  return JSON.stringify(entry ?? null);
}

// The setup with the patch's entries put on top. A conversion record is merged field by field, so that a
// patch that does not give its completion time never takes it away.
function mergedSetup(stored: Form26Setup, patch: Partial<Form26Setup>, entries: Form26SetupEntry[]): Form26Setup {
  const next: Record<string, unknown> = { ...stored };
  for (const key of entries) {
    const value = patch[key];
    if (key === 'conversion' && stored.conversion && typeof value === 'object' && value !== null) {
      const given = Object.fromEntries(Object.entries(value).filter(([, part]) => part !== undefined));
      next.conversion = { ...stored.conversion, ...given };
    } else {
      next[key] = value;
    }
  }
  return readSetup(JSON.stringify({ form26: next }));
}

const CARRY_ORDER = FORM26_CARRY.map((rule) => rule.field);
const ORDER_OF_KEY = new Map<string, number>(FORM26_ALL_ROW_KEYS.map((key, index) => [key, index]));
const UNIT_REF_OF_KEY = new Map<string, string>(FORM26_CLAUSE_UNITS.map((unit) => [unit.key, unit.workpaperRef]));

function workpaperRefOf(row: Form26ClauseRow): string {
  if (row.workpaper_ref) return row.workpaper_ref;
  const direct = UNIT_REF_OF_KEY.get(row.clause_key);
  if (direct) return direct;
  const tableId = FORM26_DEFINITION.tables.find((table) => form26TableRowKey(table.id) === row.clause_key)?.id;
  return (tableId ? UNIT_REF_OF_KEY.get(form26ClauseKeyOfTable(tableId)) : undefined) ?? `${TAX_AUDIT_FORM26_WORKPAPER_PREFIX}${row.clause_no}`;
}

export function createForm26Store(db: Form26Db, opts: { nowIso?(): string } = {}): Form26Store {
  const def = FORM26_DEFINITION;
  const nowIso = opts.nowIso ?? (() => new Date().toISOString());
  // The audit this store works on: set by a load that ends ready (and by createAudit). Once set, no row, link
  // or setup of another audit is read back or written through this store.
  let boundAuditId: string | null = null;
  const foreign = (taxAuditId: unknown): boolean => boundAuditId !== null && taxAuditId !== boundAuditId;

  async function selectForm26Audit(engagementId: string): Promise<TaxAuditSetup | null> {
    const data = await run(db.from(AUDITS).select('*').eq('engagement_id', engagementId).eq('statutory_version', VERSION).maybeSingle());
    return (data as TaxAuditSetup | null) ?? null;
  }

  async function selectAuditById(id: string): Promise<TaxAuditSetup | null> {
    const data = await run(db.from(AUDITS).select('*').eq('id', id).eq('statutory_version', VERSION).maybeSingle());
    return (data as TaxAuditSetup | null) ?? null;
  }

  async function findForm26Audit(engagementId: string): Promise<{ id: string } | null> {
    const audit = await selectForm26Audit(engagementId);
    return audit?.id ? { id: audit.id } : null;
  }

  // Any tax audit of the engagement that is not Form No. 26's (the Form 3CD audit). Read only.
  async function findThreeCdAudit(engagementId: string): Promise<{ id: string } | null> {
    const data = await run(db.from(AUDITS).select('id, statutory_version, created_at').eq('engagement_id', engagementId).neq('statutory_version', VERSION).order('created_at', { ascending: false }).execute());
    const first = listOf<{ id: string }>(data)[0];
    return first ? { id: first.id } : null;
  }

  async function selectClient(clientId: string | null): Promise<{ name: string | null; pan: string | null }> {
    if (!clientId) return { name: null, pan: null };
    const data = (await run(db.from('clients').select('id, name, pan').eq('id', clientId).maybeSingle())) as { name?: unknown; pan?: unknown } | null;
    return { name: typeof data?.name === 'string' && data.name !== '' ? data.name : null, pan: typeof data?.pan === 'string' && data.pan !== '' ? data.pan : null };
  }

  async function canSeeEngagement(engagementId: string): Promise<boolean> {
    // The main process lets a user see only the engagements they are on: no row means no access.
    const data = await run(db.from('engagements').select('id').eq('id', engagementId).maybeSingle());
    return data !== null && data !== undefined;
  }

  async function insertAudit(
    input: { engagementId: string; clientId: string | null; financialYear: string; setup?: Partial<Form26Setup> },
    client: { name: string | null; pan: string | null },
    userId: string | null,
  ): Promise<TaxAuditSetup> {
    const row = newAuditRow({ engagementId: input.engagementId, clientId: input.clientId, financialYear: input.financialYear, clientName: client.name, clientPan: client.pan }, def);
    const setup: Form26Setup = { ...readSetup(row.setup_json), ...(input.setup ?? {}), v: 1 };
    const { data, error } = (await db
      .from(AUDITS)
      // `created_by` is set by the main process to the signed-in user whenever the column is sent.
      .insert({ ...row, ...derivedAuditColumns(setup.category), setup_json: writeSetup(row.setup_json, setup), created_by: userId })
      .select()
      .single()) as DbResult;
    if (!error && data) return data as TaxAuditSetup;
    // Another window may have created it a moment ago (one audit per engagement and version): use that one.
    const existing = await selectForm26Audit(input.engagementId);
    if (existing) return existing;
    const message = messageOf(error, FORM26_NOT_PREPARED);
    if (/outside the authenticated user/i.test(message)) throw new Form26NoAccess(message);
    throw new Error(message);
  }

  async function createAudit(input: { engagementId: string; clientId: string | null; financialYear: string; setup?: Partial<Form26Setup> }): Promise<TaxAuditSetup> {
    const audit = await insertAudit(input, await selectClient(input.clientId), null);
    if (audit.id) boundAuditId = audit.id;
    return audit;
  }

  async function selectRows(taxAuditId: string): Promise<Form26ClauseRow[]> {
    const data = await run(db.from(CLAUSES).select('*').eq('tax_audit_id', taxAuditId).execute());
    return listOf<Form26ClauseRow>(data)
      .filter((row) => isForm26RowKey(row.clause_key))
      .sort((a, b) => (ORDER_OF_KEY.get(a.clause_key) ?? 0) - (ORDER_OF_KEY.get(b.clause_key) ?? 0));
  }

  async function listEvidence(taxAuditId: string): Promise<TaxAuditClauseEvidence[]> {
    const data = await run(db.from(LINKS).select('*').eq('tax_audit_id', taxAuditId).execute());
    return listOf<TaxAuditClauseEvidence>(data).filter((link) => isForm26RowKey(link.clause_key));
  }

  // Bring the audit to its 122 rows. Only keys that are absent are inserted; a row that is there is never touched.
  async function completeRows(audit: TaxAuditSetup & { id: string }, input: { clientId: string | null; financialYear: string }): Promise<Form26ClauseRow[] | null> {
    let rows = await selectRows(audit.id);
    if (rows.length === FORM26_ALL_ROW_KEYS.length) return rows;

    let wanted: Form26NewClauseRow[];
    if (rows.length === 0) {
      // A new audit: the form's opening answers, with the name, PAN and tax year from the client master.
      const client = await selectClient(input.clientId ?? audit.client_id ?? null);
      const prefill = prefillParticulars(defaultValues(def), { clientName: client.name, clientPan: client.pan, financialYear: input.financialYear });
      wanted = seedRows(def, audit.id, prefill.values, prefill.prefilled);
    } else {
      wanted = missingRows(def, audit.id, rows.map((row) => row.clause_key));
    }

    const first = (await db.from(CLAUSES).insert(wanted).execute()) as DbResult;
    rows = await selectRows(audit.id);
    if (first.error && rows.length < FORM26_ALL_ROW_KEYS.length) {
      // The insert stopped part of the way (rows go in one by one, without a transaction): add what is
      // still absent row by row, so that one row that cannot go in does not hold back the others.
      const present = new Set(rows.map((row) => row.clause_key));
      for (const row of wanted) {
        if (present.has(row.clause_key)) continue;
        await db.from(CLAUSES).insert(row).execute();
      }
      rows = await selectRows(audit.id);
    }
    return rows.length === FORM26_ALL_ROW_KEYS.length ? rows : null;
  }

  async function load(input: { engagementId: string; clientId: string | null; financialYear: string; userId: string }): Promise<Form26Loaded> {
    try {
      let audit = await selectForm26Audit(input.engagementId);
      if (!audit) {
        if (!(await canSeeEngagement(input.engagementId))) return { state: 'no-access' };
        const threeCd = await findThreeCdAudit(input.engagementId);
        if (threeCd) return { state: 'needs-conversion', threeCdAuditId: threeCd.id };     // nothing is created here
        audit = await insertAudit(input, await selectClient(input.clientId), input.userId || null);
      }
      return await openAudit(audit, input);
    } catch (error) {
      if (error instanceof Form26NoAccess) return { state: 'no-access' };
      console.error('Error loading Form No. 26:', error);
      return { state: 'error', message: FORM26_LOAD_FAILED };
    }
  }

  // An audit row found or made: its year brought in line with the engagement, its 122 rows completed, a
  // conversion left unfinished completed, then the store bound to it. Throws on a failure (the caller says it).
  async function openAudit(found: TaxAuditSetup, input: { clientId: string | null; financialYear: string }): Promise<Form26Loaded> {
    let audit = found;
    const auditId = audit.id;
    if (!auditId || audit.statutory_version !== VERSION) return { state: 'error', message: FORM26_NOT_PREPARED };
    if (input.financialYear && audit.financial_year !== input.financialYear) audit = await syncYear(audit, input.financialYear);

    let rows = await completeRows({ ...audit, id: auditId }, input);
    if (!rows || rows.some((row) => row.statutory_version !== VERSION || row.tax_audit_id !== auditId)) {
      return { state: 'error', message: FORM26_NOT_PREPARED };
    }
    const pending = readSetup(audit.setup_json).conversion;
    if (pending && !pending.completedAt) {
      const before = boundAuditId;
      boundAuditId = auditId;                         // the conversion writes into this audit only
      try {
        ({ audit, rows } = await finishConversion(audit, rows));
      } catch (error) {
        boundAuditId = before;
        throw error;
      }
    }
    const evidence = await listEvidence(auditId);
    const setup = readSetup(audit.setup_json);
    boundAuditId = auditId;
    return { state: 'ready', audit, setup, rows, evidence, values: valuesFromRows(def, setup, rows) };
  }

  // ---- Task 26: the earlier Form 3CD draft (read only) and the conversion

  async function loadThreeCdSnapshot(threeCdAuditId: string): Promise<ThreeCdSnapshot | null> {
    const audit = (await run(db.from(AUDITS).select('*').eq('id', threeCdAuditId).neq('statutory_version', VERSION).maybeSingle())) as TaxAuditSetup | null;
    if (!audit?.id) return null;
    const rows = listOf<TaxAuditClauseResponse>(await run(db.from(CLAUSES).select('*').eq('tax_audit_id', audit.id).execute()))
      .filter((row) => row.statutory_version !== VERSION && !isForm26RowKey(row.clause_key));
    const links = listOf<{ id: string }>(await run(db.from(LINKS).select('id').eq('tax_audit_id', audit.id).execute()));
    const checks = listOf<{ id: string }>(await run(db.from(ACCEPTANCE).select('id').eq('tax_audit_id', audit.id).execute()));
    return { audit, rows, evidenceCount: links.length, hasAcceptanceCheck: checks.length > 0 };
  }

  async function convert(input: { engagementId: string; clientId: string | null; financialYear: string; threeCdAuditId: string; userId: string }): Promise<Form26Loaded> {
    try {
      let audit = await selectForm26Audit(input.engagementId);
      if (!audit) {
        if (!(await canSeeEngagement(input.engagementId))) return { state: 'no-access' };
        const snapshot = await loadThreeCdSnapshot(input.threeCdAuditId);
        if (!snapshot || snapshot.audit.engagement_id !== input.engagementId) return { state: 'error', message: FORM26_NOT_PREPARED };
        // Recorded first, so that a conversion stopped part of the way is known as one and completed later.
        const conversion = { fromTaxAuditId: String(snapshot.audit.id), startedAt: nowIso(), untouched: isThreeCdUntouched(snapshot), carried: [] };
        audit = await insertAudit({ ...input, setup: { conversion } }, await selectClient(input.clientId), input.userId || null);
      }
      return await openAudit(audit, input);
    } catch (error) {
      if (error instanceof Form26NoAccess) return { state: 'no-access' };
      console.error('Error converting the Form 3CD draft to Form No. 26:', error);
      return { state: 'error', message: FORM26_NOT_PREPARED };
    }
  }

  // The answers of the same substance come across, each into a row not edited since it was seeded and only
  // once (a row that holds the mark already is done; a row someone wrote meanwhile is left as they wrote it),
  // then the completion is recorded. Every step can run again: a stopped run is finished by the next load.
  async function finishConversion(found: TaxAuditSetup, foundRows: Form26ClauseRow[]): Promise<{ audit: TaxAuditSetup; rows: Form26ClauseRow[] }> {
    let audit = found;
    const setup = readSetup(audit.setup_json);
    const conversion = setup.conversion;
    if (!conversion || conversion.completedAt) return { audit, rows: foundRows };
    const byKey = new Map(foundRows.map((row) => [row.clause_key, row]));
    const carried = [...conversion.carried];

    const snapshot = conversion.untouched ? null : await loadThreeCdSnapshot(conversion.fromTaxAuditId);
    if (snapshot) {
      // The mark's time is the conversion's start: every run and every window writes the very same payload.
      const plan = planConversion(def, snapshot, valuesFromRows(def, setup, foundRows), conversion.startedAt);
      // One write per row with all its carried answers (15(a) and 15(b) share a row), so a row is either done
      // whole or not at all.
      const keysByRow = new Map<string, string[]>();
      for (const key of Object.keys(plan.brought)) {
        if (carried.includes(key)) continue;
        const clauseKey = form26ClauseKeyOfField(key);
        keysByRow.set(clauseKey, [...(keysByRow.get(clauseKey) ?? []), key]);
      }
      for (const [clauseKey, keys] of keysByRow) {
        const row = byKey.get(clauseKey);
        if (!row) continue;
        const payload = parseClausePayload(row.response_json);
        if (keys.some((key) => payload.brought?.[key])) {                             // written by an earlier run or window
          carried.push(...keys.filter((key) => payload.brought?.[key]));
          continue;
        }
        if (row.updated_at !== row.created_at || isRowLocked(row)) continue;          // edited since it was seeded
        const next = { v: 1, f: { ...payload.f }, brought: { ...(payload.brought ?? {}) } };
        for (const key of keys) {
          next.f[key] = plan.values.f[key];
          next.brought[key] = plan.brought[key];
        }
        const result = await saveRow(row, { response_json: JSON.stringify(next) });
        if ('row' in result) {
          byKey.set(clauseKey, result.row);
          carried.push(...keys);
        } else if ('latest' in result) {
          byKey.set(clauseKey, result.latest);                                         // written meanwhile: theirs stands
          const marks = parseClausePayload(result.latest.response_json).brought ?? {};
          carried.push(...keys.filter((key) => marks[key]));
        } else {
          throw new Error(result.message);
        }
      }
      carried.sort((a, b) => CARRY_ORDER.indexOf(a) - CARRY_ORDER.indexOf(b));
    }

    let held = audit;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const done = await saveSetup(held, { conversion: { ...conversion, completedAt: nowIso(), carried } });
      if (!('audit' in done)) throw new Error(done.message);
      audit = done.audit;
      if (done.ok || readSetup(done.audit.setup_json).conversion?.completedAt) break;       // or another window completed it
      held = done.audit;
    }
    const rows = FORM26_ALL_ROW_KEYS.map((key) => byKey.get(key)).filter((row): row is Form26ClauseRow => row !== undefined);
    return { audit, rows };
  }

  async function syncYear(audit: TaxAuditSetup, financialYear: string): Promise<TaxAuditSetup> {
    const auditId = audit.id;
    if (!auditId || audit.financial_year === financialYear || foreign(auditId)) return audit;
    const { data, error } = (await db.from(AUDITS).update({ financial_year: financialYear }).eq('id', auditId).eq('statutory_version', VERSION).execute()) as DbResult;
    if (error) throw new Error(messageOf(error, FORM26_NOT_PREPARED));
    const returned = listOf<TaxAuditSetup>(data)[0];
    if (returned?.id === auditId) return returned;
    return (await selectAuditById(auditId)) ?? audit;
  }

  async function readForm26Draft(engagementId: string): Promise<Form26Draft | null> {
    const audit = await selectForm26Audit(engagementId);
    if (!audit?.id) return null;
    const setup = readSetup(audit.setup_json);
    const rows = await selectRows(audit.id);
    return { audit, setup, rows, values: valuesFromRows(def, setup, rows) };
  }

  async function reloadRow(id: string): Promise<Form26ClauseRow | null> {
    let request = db.from(CLAUSES).select('*').eq('id', id).eq('statutory_version', VERSION);
    if (boundAuditId !== null) request = request.eq('tax_audit_id', boundAuditId);
    const data = await run(request.maybeSingle());
    return (data as Form26ClauseRow | null) ?? null;
  }

  async function saveRow(row: { id: string; updated_at?: string; response_json?: string | null }, patch: Partial<Form26ClauseRow>): Promise<Form26SaveRowResult> {
    try {
      const columns: Record<string, unknown> = {};
      for (const key of Object.keys(patch)) {
        const value = (patch as Record<string, unknown>)[key];
        if (!IDENTITY_COLUMNS.includes(key) && value !== undefined) columns[key] = value;
      }
      if (Object.keys(columns).length === 0) return { ok: false, reason: 'failed', message: 'There is nothing to save.' };

      let expected = row.updated_at;
      if (!expected) {
        const present = await reloadRow(row.id);
        if (!present?.updated_at) return { ok: false, reason: 'failed', message: ROW_NOT_FOUND };
        expected = present.updated_at;
      }

      let request = db.from(CLAUSES).update(columns).eq('id', row.id).eq('statutory_version', VERSION).eq('updated_at', expected);
      if (boundAuditId !== null) request = request.eq('tax_audit_id', boundAuditId);
      // The time stamp moves in whole seconds. When the row is given with its answers, the answers that were
      // read must still be there too, so a change made elsewhere within the same second is not lost and a
      // change of state (an approval) never lands on answers the user has not seen (N2). A state patch sent
      // without answers (unlocking, remarks) is checked on the time stamp only.
      // And answers never go into a row that is approved or locked, whenever that happened.
      if ('response_json' in columns) request = request.eq('locked', 0).neq('review_status', 'approved').neq('review_status', 'locked');
      if (typeof row.response_json === 'string') request = request.eq('response_json', row.response_json);
      const { data, error } = (await request.execute()) as DbResult;
      if (error) return { ok: false, reason: 'failed', message: messageOf(error, 'The change could not be saved.') };

      // The answer lists the rows that still match the filters AFTER the update, so a row that was written
      // and then stamped with a later time is not in it: read the row and see whether the patch is there.
      const returned = listOf<Form26ClauseRow>(data);
      if (returned.length === 1 && returned[0].id === row.id) return { ok: true, row: returned[0] };
      const latest = await reloadRow(row.id);
      if (!latest) return { ok: false, reason: 'failed', message: ROW_NOT_FOUND };
      const applied = Object.keys(columns).every((key) => held(columns[key]) === held((latest as Record<string, unknown>)[key]));
      return applied ? { ok: true, row: latest } : { ok: false, reason: 'changed-elsewhere', latest };
    } catch (error) {
      return { ok: false, reason: 'failed', message: messageOf(error, 'The change could not be saved.') };
    }
  }

  // The setup entries are judged one by one against what the user saw (a field-level check, as for answers):
  // two users changing DIFFERENT entries (one the category, the other "Show all schedules") both get their
  // change; only the same entry changed by both is a clash. Within the call, the row is written only if it is
  // still exactly as read (time stamp and setup text), so nothing written between the read and the write is lost.
  async function saveSetup(audit: { id?: string; setup_json?: string | null }, patch: Partial<Form26Setup>, seen?: Partial<Form26Setup>): Promise<Form26SaveSetupResult> {
    const failed = (message: string): Form26SaveSetupResult => ({ ok: false, reason: 'failed', message });
    try {
      const auditId = audit.id;
      if (typeof auditId !== 'string' || auditId === '' || foreign(auditId)) return failed(AUDIT_NOT_FOUND);
      const entries = SETUP_ENTRIES.filter((key) => hasOwn(patch, key) && patch[key] !== undefined);
      if (entries.length === 0) return failed('There is nothing to save.');
      const shown = typeof audit.setup_json === 'string' ? readSetup(audit.setup_json) : null;
      const sawText = (key: Form26SetupEntry): string | null => {
        if (seen && hasOwn(seen, key)) return entryText(key, seen[key]);
        return shown ? entryText(key, shown[key]) : null;                   // nothing known: no check for it
      };

      for (let attempt = 0; attempt < MERGE_ATTEMPTS; attempt += 1) {
        const present = await selectAuditById(auditId);
        if (!present?.id) return failed(AUDIT_NOT_FOUND);
        const stored = readSetup(present.setup_json);
        const clashing = entries.filter((key) => {
          const saw = sawText(key);
          const now = entryText(key, stored[key]);
          return saw !== null && now !== saw && now !== entryText(key, patch[key]);
        });
        if (clashing.length > 0) return { ok: false, reason: 'changed-elsewhere', fields: clashing, audit: present, setup: stored };

        const next = mergedSetup(stored, patch, entries);
        const columns: Record<string, unknown> = { setup_json: writeSetup(present.setup_json, next), ...derivedAuditColumns(next.category) };
        let request = db.from(AUDITS).update(columns).eq('id', present.id).eq('statutory_version', VERSION);
        if (typeof present.updated_at === 'string') request = request.eq('updated_at', present.updated_at);
        if (typeof present.setup_json === 'string') request = request.eq('setup_json', present.setup_json);
        const { data, error } = (await request.execute()) as DbResult;
        if (error) return failed(messageOf(error, 'The change could not be saved.'));

        // As for saveRow: the answer lists the rows still matching the filters after the update.
        const returned = listOf<TaxAuditSetup>(data)[0];
        if (returned && returned.id === present.id) return { ok: true, audit: returned, setup: readSetup(returned.setup_json) };
        const latest = await selectAuditById(present.id);
        if (!latest) return failed(AUDIT_NOT_FOUND);
        if (Object.keys(columns).every((key) => held(columns[key]) === held((latest as Record<string, unknown>)[key]))) {
          return { ok: true, audit: latest, setup: readSetup(latest.setup_json) };
        }
        // Changed by someone else between the read and the write: read again and judge again.
      }
      return failed(SETUP_KEEPS_CHANGING);
    } catch (error) {
      return failed(messageOf(error, 'The change could not be saved.'));
    }
  }

  async function linkEvidence(audit: { id: string }, row: Form26ClauseRow, evidenceFileId: string, userId: string): Promise<void> {
    if (foreign(audit.id) || !isForm26RowKey(row.clause_key) || row.statutory_version !== VERSION || row.tax_audit_id !== audit.id) {
      throw new Error('Evidence can be linked here only to a clause of this Form No. 26 audit.');
    }
    const { error } = (await db
      .from(LINKS)
      .insert({ tax_audit_id: audit.id, clause_response_id: row.id, clause_key: row.clause_key, evidence_file_id: evidenceFileId, workpaper_ref: workpaperRefOf(row), linked_by: userId })
      .execute()) as DbResult;
    if (!error) return;
    const message = messageOf(error, 'The evidence could not be linked.');
    if (/unique/i.test(message)) return;                    // this file is already linked to this clause
    throw new Error(message);
  }

  async function unlinkEvidence(linkId: string): Promise<void> {
    const link = (await run(db.from(LINKS).select('*').eq('id', linkId).maybeSingle())) as TaxAuditClauseEvidence | null;
    if (!link) return;
    if (!isForm26RowKey(link.clause_key)) throw new Error('This evidence link does not belong to Form No. 26.');
    if (foreign(link.tax_audit_id)) throw new Error('This evidence link does not belong to this audit.');
    await run(db.from(LINKS).delete().eq('id', linkId).eq('tax_audit_id', link.tax_audit_id).eq('clause_key', link.clause_key).execute());
  }

  // Last year (task 25; Task 26 reads the earlier 3CD draft the same way): the engagement of the same client
  // whose year is the one before, and its tax audit with its rows. Selects only, never a write, and it does
  // not bind the store. The main process lets a user see only the engagements they are on, so an engagement
  // the user may not open is simply not found ("none", not an error).
  async function loadLastYear(input: { engagementId: string; clientId: string | null; financialYear: string }): Promise<Form26LastYearResult> {
    const year = parseEngagementYear(input.financialYear);
    const start = year ? year.startYear - 1 : null;
    const label = start !== null ? `${start}-${String((start + 1) % 100).padStart(2, '0')}` : null;
    const form: Form26LastYearForm = start !== null && start >= FORM26_FIRST_TAX_YEAR_START ? 'form26' : '3cd';
    const none: Form26LastYearResult = { state: 'none', year: label, form };
    if (!year || !label || !input.clientId) return none;
    try {
      const engagements = listOf<{ id: string; financial_year?: string | null }>(
        await run(db.from('engagements').select('id, financial_year').eq('client_id', input.clientId).execute()),
      ).filter((engagement) => engagement.id !== input.engagementId && parseEngagementYear(engagement.financial_year)?.startYear === year.startYear - 1);
      if (engagements.length === 0) return none;
      const audits = listOf<TaxAuditSetup>(
        await run(db.from(AUDITS).select('*').in('engagement_id', engagements.map((engagement) => engagement.id)).order('created_at', { ascending: false }).execute()),
      ).filter((audit) => (form === 'form26' ? audit.statutory_version === VERSION : audit.statutory_version !== VERSION));
      const audit = audits[0];
      if (!audit?.id) return none;
      const rows = listOf<Form26ClauseRow>(await run(db.from(CLAUSES).select('*').eq('tax_audit_id', audit.id).execute())).filter((row) =>
        form === 'form26' ? row.statutory_version === VERSION && isForm26RowKey(row.clause_key) : row.statutory_version !== VERSION && !isForm26RowKey(row.clause_key),
      );
      return { state: 'found', year: label, form, audit, rows };
    } catch (error) {
      return { state: 'error', message: messageOf(error, 'Last year\'s tax audit could not be read.') };
    }
  }

  return {
    load, createAudit, saveRow, saveSetup, reloadRow, linkEvidence, unlinkEvidence, listEvidence, findThreeCdAudit, findForm26Audit, loadLastYear,
    convert, syncYear, loadThreeCdSnapshot, readForm26Draft,
  };
}

/**
 * What the save queue calls to put answers into the database (its `saveClause` and `saveTable`).
 *
 * `getRow` gives the row as the screen last knew it (its answers are "what the user saw"); `onRow` is told of
 * every fresher row that is read or written, and must keep it for the next `getRow`.
 *
 * A clause: only the fields given are changed. A field is judged against `seen[field]`, the value the user
 * saw when they began editing it (without it, against the row `getRow` gives). If the stored value is no
 * longer that one, someone else changed it: it is left as they wrote it and named in `{ conflict: [...] }`.
 * If the row was changed elsewhere meanwhile, the fields the other user did NOT change are put on top of the
 * latest row and saved again without a word. Saving a clashing field again afterwards without `seen` is the
 * user's own decision ("Keep mine") and goes through. When a later attempt of the same save fails, the clash
 * found is still named: `{ conflict: [...], failed: '...' }`. A clause that is approved or locked is never written.
 * A table: saved whole into its own row; not when its clause has been approved (the clause row is read
 * afresh first), and not on top of rows someone else has changed (`{ conflict: [tableId] }`).
 */
export function createForm26RowWriter(input: {
  store: Pick<Form26Store, 'saveRow' | 'reloadRow'>;
  getRow(clauseKey: string): Form26ClauseRow | undefined;
  onRow(row: Form26ClauseRow): void;
}): {
  saveClause(clauseKey: string, changes: Record<string, string>, seen?: Record<string, string>): Promise<Form26SaveOutcome>;
  saveTable(tableId: string, rows: Form26Row[]): Promise<Form26SaveOutcome>;
  isStored(clauseKey: string, fieldKey: string, value: string): boolean;
} {
  const def = FORM26_DEFINITION;
  const { store, getRow, onRow } = input;
  const valueIn = (f: Record<string, string>, key: string): string => (Object.prototype.hasOwnProperty.call(f, key) ? f[key] : '');

  async function saveClause(clauseKey: string, changes: Record<string, string>, seen?: Record<string, string>): Promise<Form26SaveOutcome> {
    const clashing: string[] = [];
    // A failure after a clash was found still names the clash, so the caller never retries it blindly.
    const outcome = (failure?: string): Form26SaveOutcome => {
      if (failure !== undefined) return clashing.length > 0 ? { conflict: [...clashing], failed: failure } : { failed: failure };
      return clashing.length > 0 ? { conflict: [...clashing] } : 'ok';
    };
    try {
      let row = getRow(clauseKey);
      if (!row || !isForm26RowKey(clauseKey)) return { failed: ROW_NOT_FOUND };
      let base = parseClausePayload(row.response_json);
      clausePayloadPatch(def, clauseKey, changes, base);          // throws for a field that is not this clause's
      if (isRowLocked(row)) return { conflict: Object.keys(changes) };

      // What each field held when the user began editing it.
      const expected: Record<string, string> = {};
      const wanted: Record<string, string> = {};
      for (const key of Object.keys(changes)) {
        const now = valueIn(base.f, key);
        if (now === changes[key]) continue;                                // already so (also: both gave the same answer)
        const saw = seen && Object.prototype.hasOwnProperty.call(seen, key) ? seen[key] : now;
        if (now !== saw) {                                                 // changed by someone else since the user saw it
          clashing.push(key);
          continue;
        }
        expected[key] = saw;
        wanted[key] = changes[key];
      }

      for (let attempt = 0; attempt < MERGE_ATTEMPTS; attempt += 1) {
        if (Object.keys(wanted).length === 0) return outcome();
        const result = await store.saveRow(row, { response_json: JSON.stringify(clausePayloadPatch(def, clauseKey, wanted, base)) });
        // (Narrowed with `in`: the project's compiler settings do not narrow on `ok`.)
        if ('row' in result) {
          onRow(result.row);
          return outcome();
        }
        if (!('latest' in result)) return outcome(result.message);

        // Changed elsewhere since it was read. Nothing of ours has been written.
        const latest = result.latest;
        onRow(latest);
        if (isRowLocked(latest)) return { conflict: [...clashing, ...Object.keys(wanted)] };
        const theirs = parseClausePayload(latest.response_json);
        for (const key of Object.keys(wanted)) {
          const now = valueIn(theirs.f, key);
          if (now === wanted[key]) delete wanted[key];                       // they gave the same answer
          else if (now !== expected[key]) {                                  // they changed this very field
            clashing.push(key);
            delete wanted[key];
          }
        }
        row = latest;
        base = theirs;
      }
      return outcome(KEEPS_CHANGING);
    } catch (error) {
      return outcome(messageOf(error, 'The change could not be saved.'));
    }
  }

  async function saveTable(tableId: string, rows: Form26Row[]): Promise<Form26SaveOutcome> {
    try {
      const json = tablePayload(def, tableId, rows);              // throws for a table the form does not have
      const sameRows = (stored: string | null | undefined): boolean => tablePayload(def, tableId, parseTablePayload(stored).rows) === json;
      let row = getRow(form26TableRowKey(tableId));
      if (!row) return { failed: ROW_NOT_FOUND };
      if (sameRows(row.response_json)) return 'ok';

      // A table is locked with its clause, and the clause row may have been approved since it was read.
      const clause = getRow(form26ClauseKeyOfTable(tableId));
      if (clause) {
        const fresh = await store.reloadRow(clause.id);
        if (isRowLocked(fresh ?? clause)) {
          if (fresh) onRow(fresh);                                // the screen learns of the lock
          return { conflict: [tableId] };
        }
      }

      for (let attempt = 0; attempt < MERGE_ATTEMPTS; attempt += 1) {
        const result = await store.saveRow(row, { response_json: json });
        if ('row' in result) {
          onRow(result.row);
          return 'ok';
        }
        if (!('latest' in result)) return { failed: result.message };
        const latest = result.latest;
        onRow(latest);
        if (sameRows(latest.response_json)) return 'ok';
        // Only when the rows themselves are as they were read (something else of the row moved) is it saved again.
        if (tablePayload(def, tableId, parseTablePayload(latest.response_json).rows) !== tablePayload(def, tableId, parseTablePayload(row.response_json).rows)) {
          return { conflict: [tableId] };
        }
        row = latest;
      }
      return { failed: KEEPS_CHANGING };
    } catch (error) {
      return { failed: messageOf(error, 'The change could not be saved.') };
    }
  }

  function isStored(clauseKey: string, fieldKey: string, value: string): boolean {
    const row = getRow(clauseKey);
    return row !== undefined && valueIn(parseClausePayload(row.response_json).f, fieldKey) === value;
  }

  return { saveClause, saveTable, isStored };
}
