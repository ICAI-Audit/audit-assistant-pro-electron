// Form No. 26 in the clause list and in storage: 57 units (one list entry and one storage row each)
// and one storage row per table. The ids here are for ever: a key is never renamed or reused
// (src/data/taxAuditForm26Clauses.frozen.json and its test guard this).
//
// Which answer, table and schedule belongs to which unit follows the form itself: an answer or a table
// belongs to the clause of its question row, a schedule to the clause whose answer opens it
// (src/data/taxAuditForm26Clauses.test.ts checks every unit against the definition).
// The short labels of clauses 9 to 53 are the "Subject" entries of the office's mapping of Form No. 26
// to Form 3CD; the wording shown in the editor is always the form's own, from the definition.
import { FORM26_DEFINITION } from './taxAuditForm26Definition';
import type { Form26Category } from './taxAuditForm26Types';
import { TAX_AUDIT_FORM26_CLAUSE_PREFIX, TAX_AUDIT_FORM26_WORKPAPER_PREFIX } from './taxAuditForm26Version';

export type Form26ListGroupId = 'report' | 'particulars' | 'DA' | 'DB' | 'DC' | 'DD' | 'DE' | 'DF' | 'DG' | 'DH' | 'DI' | 'DJ' | 'DK' | 'DZ' | 'schedules';
export type Form26ClauseUnit = {
  key: string;            // storage clause_key, e.g. 'f26_c14'
  no: string;             // clause_no shown and stored: 'Category' | 'Part A' | 'Part B' | '1'..'53' | 'Signature'
  label: string;          // clause_title stored; short list label
  group: Form26ListGroupId;
  fields: string[]; tables: string[]; schedules: string[]; questionRows: number[];
  category: Form26Category | null;   // Part A only for '1', Part B only for '2'
  workpaperRef: string;   // 'TA-F26-' + no with spaces removed
};

export const FORM26_LIST_GROUPS: { id: Form26ListGroupId; title: string }[] = [
  { id: 'report', title: 'Audit report' },
  { id: 'particulars', title: 'Part C: Particulars of the assessee' },
  { id: 'DA', title: 'A - General Information' },
  { id: 'DB', title: 'B - Particulars of books of account and method of accounting' },
  { id: 'DC', title: 'C - Particulars of receipt/income' },
  { id: 'DD', title: 'D - Particulars of expenses' },
  { id: 'DE', title: 'E - Particulars of Prior Period' },
  { id: 'DF', title: 'F - Particulars of Losses, Depreciation, and Deductions' },
  { id: 'DG', title: 'G - International Taxation' },
  { id: 'DH', title: 'H - Other Key Parameters' },
  { id: 'DI', title: 'I - Particulars of TDS/TCS' },
  { id: 'DJ', title: 'J - Particulars of indirect taxation' },
  { id: 'DK', title: 'K - Quantitative Details' },
  { id: 'DZ', title: 'Signature and Notes' },
  { id: 'schedules', title: 'Schedules' },
];

function unit(
  key: string,
  no: string,
  group: Form26ListGroupId,
  label: string,
  fields: string[],
  tables: string[],
  schedules: string[],
  questionRows: number[],
  category: Form26Category | null,
): Form26ClauseUnit {
  if (!key.startsWith(TAX_AUDIT_FORM26_CLAUSE_PREFIX)) throw new Error(`Form 26 clause key without its prefix: ${key}`);
  return { key, no, label, group, fields, tables, schedules, questionRows, category, workpaperRef: TAX_AUDIT_FORM26_WORKPAPER_PREFIX + no.replace(/\s+/g, '') };
}

// 57 units in the order of the form. `tables` lists the unit's own tables first, then the tables of the
// schedules opened under it; each table is stored in its own row (form26TableRowKey).
export const FORM26_CLAUSE_UNITS: Form26ClauseUnit[] = [
  unit('f26_category', 'Category', 'report', 'Category of assessee', ['cat'], [], [], [], null),
  unit('f26_part_a', 'Part A', 'report', 'Audit report where the accounts have been audited under any other law', ['A.assessee', 'A.auditor', 'A.act', 'A.rdate', 'A.pl', 'A.from', 'A.to', 'A.bs', 'A.q3a', 'A.place', 'A.date', 'A.name', 'A.mrn', 'A.pan', 'A.udin', 'A.firm', 'A.frn'], ['A3b', 'A5'], [], [], '1'),
  unit('f26_part_b', 'Part B', 'report', 'Audit report in the case of a person referred to in clause (b) of sub-rule (1) of rule 47', ['B.bs', 'B.pl', 'B.from', 'B.to', 'B.ho', 'B.br', 'B.obs', 'B.q3b', 'B.res', 'B.place', 'B.date', 'B.name', 'B.mrn', 'B.pan', 'B.udin', 'B.firm', 'B.frn'], ['B3b', 'B5'], [], [], '2'),
  unit('f26_p1', '1', 'particulars', 'Name', ['C.name'], [], [], [0], null),
  unit('f26_p2', '2', 'particulars', 'Address', ['C.a1', 'C.a2', 'C.a3', 'C.a4', 'C.a5', 'C.a6', 'C.a7'], [], [], [1], null),
  unit('f26_p3', '3', 'particulars', 'Permanent Account Number', ['C.pan'], [], [], [2], null),
  unit('f26_p4', '4', 'particulars', 'Status', ['C.status'], [], [], [3], null),
  unit('f26_p5', '5', 'particulars', 'Residential status', ['C.res'], [], [], [4], null),
  unit('f26_p6', '6', 'particulars', 'Email id', ['C.email'], [], [], [5], null),
  unit('f26_p7', '7', 'particulars', 'Contact number', ['C.cc', 'C.ph'], [], [], [6], null),
  unit('f26_p8', '8', 'particulars', 'Tax year', ['C.ty'], [], [], [7], null),
  unit('f26_c9', '9', 'DA', 'Ground on which audit is conducted', ['q9'], [], [], [8], null),
  unit('f26_c10', '10', 'DA', 'Option for concessional tax regime', ['c10'], [], [], [9], null),
  unit('f26_c11', '11', 'DA', 'Partners/members, PAN, profit-sharing ratio and changes', ['c11b'], ['P11a', 'S11b'], ['s11b'], [10, 11, 12], null),
  unit('f26_c12', '12', 'DA', 'Nature of business and change in it; Cost audit carried out; Turnover, GP, NP, stock and yield ratios – current and preceding year', ['c12b', 'c12c'], ['P12d', 'S12a', 'S12b', 'S12c'], ['s12a', 's12b', 's12c'], [13, 14, 15, 16, 17], null),
  unit('f26_c13', '13', 'DB', 'Books maintained and address(es) where kept', ['c13'], [], [], [18], null),
  unit('f26_c14', '14', 'DB', 'Books maintained and address(es) where kept; Accounting software; cloud storage with IP address and country; rule 46(8) compliance; backup server address in India', ['c14b', 'c14c', 'c14d', 'c14e'], ['P14a'], [], [19, 20, 21, 22, 23, 24], null),
  unit('f26_c15', '15', 'DB', 'Method of accounting and change in it', ['c15a', 'c15b'], ['S15b'], ['s15b'], [25, 26], null),
  unit('f26_c16', '16', 'DB', 'Inventory valuation; adjustment needed to comply with section 277', ['c16a1', 'c16a2', 'c16b'], ['S16b'], ['s16b'], [27, 28], null),
  unit('f26_c17', '17', 'DB', 'ICDS adjustments and disclosures', ['c17'], ['S17'], ['s17'], [29], null),
  unit('f26_c18', '18', 'DB', 'ICDS adjustments and disclosures', ['c18'], ['S18'], ['s18'], [30], null),
  unit('f26_c19', '19', 'DB', 'Presumptive profits included in P&L', ['c19'], ['S19'], ['s19'], [31], null),
  unit('f26_c20', '20', 'DC', 'Income under 92(2)(m) not credited to P&L', ['c20'], ['S20'], ['s20'], [32], null),
  unit('f26_c21', '21', 'DC', 'Other income chargeable but not credited to P&L', ['c21'], ['S21'], ['s21'], [33], null),
  unit('f26_c22', '22', 'DC', 'Capital asset converted into stock-in-trade', ['c22'], ['S22'], ['s22'], [34], null),
  unit('f26_c23', '23', 'DC', 'Land/building transferred below stamp duty value', ['c23'], ['S23'], ['s23'], [35], null),
  unit('f26_c24', '24', 'DC', 'Hundi borrowing and repayment deemed as income', ['c24', 'c24_amt'], [], [], [36], null),
  unit('f26_c25', '25', 'DC', 'Hundi borrowing and repayment deemed as income', ['c25', 'c25_amt'], [], [], [37], null),
  unit('f26_c26', '26', 'DD', 'Expenditure relating to exempt income', ['c26', 'c26_amt'], [], [], [38], null),
  unit('f26_c27', '27', 'DD', "Disallowance under 29, 31 and 32; Employees' contributions disallowable; Disallowance under section 34 (capital, personal, etc.); Disallowance under section 35 (other than TDS items)", ['c27a', 'c27b', 'c27c', 'c27d'], ['S27a', 'S27b', 'S27c', 'S27d'], ['s27a', 's27b', 's27c', 's27d'], [39, 40, 41, 42, 43], null),
  unit('f26_c28', '28', 'DD', 'Penalty levied under any law in or outside India', ['c28'], ['S28'], ['s28'], [44], null),
  unit('f26_c29', '29', 'DD', 'Payments to specified persons', ['c29'], ['S29'], ['s29'], [45], null),
  unit('f26_c30', '30', 'DD', 'Cash payments disallowable and deemed income on later cash payment', ['c30'], ['S30'], ['s30'], [46], null),
  unit('f26_c31', '31', 'DD', 'Cash payments disallowable and deemed income on later cash payment', ['c31'], ['S31'], ['s31'], [47], null),
  unit('f26_c32', '32', 'DD', 'Sums allowable only on actual payment; later-year allowance', ['c32a', 'c32b'], ['S32a', 'S32b'], ['s32a', 's32b'], [48, 49], null),
  unit('f26_c33', '33', 'DD', 'Interest under section 23 of MSMED Act; Payments to micro and small enterprises; later-year allowance', ['c33a', 'c33a_amt', 'c33b', 'c33b_amt', 'c33c', 'c33c_amt'], [], [], [50, 51, 52], null),
  unit('f26_c34', '34', 'DD', 'Amounts allowable as deduction under various sections', ['c34'], ['S34a', 'S34b'], ['s34'], [53], null),
  unit('f26_c35', '35', 'DE', 'Prior-period income and expenditure', ['c35a', 'c35b'], ['S35a', 'S35b'], ['s35a', 's35b'], [54, 55], null),
  unit('f26_c36', '36', 'DF', 'Depreciation allowable', ['c36'], ['Dpm', 'Dot'], ['s36'], [56], null),
  unit('f26_c37', '37', 'DF', 'Brought-forward loss; shareholding change; speculation loss; deemed speculation; specified business loss', ['c37a', 'c37b', 'c37b_amt', 'c37c', 'c37c_amt', 'c37d', 'c37d_amt', 'c37e', 'c37e_amt'], ['S37a'], ['s37a'], [57, 58, 59, 60, 61], null),
  unit('f26_c38', '38', 'DF', 'Chapter VIII deductions', ['c38'], ['S38'], ['s38'], [62], null),
  unit('f26_c39', '39', 'DF', 'Utilisation of MAT/AMT credit', ['c39'], ['S39'], ['s39'], [63], null),
  unit('f26_c40', '40', 'DG', 'Primary transfer-pricing adjustment', ['c40'], ['S40'], ['s40'], [64], null),
  unit('f26_c41', '41', 'DG', 'Interest exceeding specified limit; Interest brought forward and carried forward', ['c41a', 'c41b', 'c41c'], ['S41a', 'S41b', 'S41c'], ['s41a', 's41b', 's41c'], [65, 66, 67], null),
  unit('f26_c42', '42', 'DG', 'Disallowance under section 60', ['c42', 'c42_amt'], [], [], [68], null),
  unit('f26_c43', '43', 'DG', 'Remittances reported in Part D of Form 145', ['c43'], ['S43'], ['s43'], [69], null),
  unit('f26_c44', '44', 'DH', 'Amounts not to be included as income under 92(2)(m)', ['c44'], ['S44'], ['s44'], [70], null),
  unit('f26_c45', '45', 'DH', 'Loans/deposits taken, cash receipts, cash payments, repayments beyond limits', ['c45a', 'c45b', 'c45c', 'c45d'], ['S45a', 'S45b', 'S45c', 'S45d'], ['s45a', 's45b', 's45c', 's45d'], [71, 72, 73, 74], null),
  unit('f26_c46', '46', 'DH', 'Statements in Forms 98/165/166/167', ['c46'], ['S46'], ['s46'], [75], null),
  unit('f26_c47', '47', 'DH', 'Transactions in unquoted shares', ['c47'], ['S47'], ['s47'], [76], null),
  unit('f26_c48', '48', 'DH', 'Loan or advance treated as deemed dividend', ['c48'], ['S48'], ['s48'], [77], null),
  unit('f26_c49', '49', 'DI', 'All TANs held', [], ['P49'], [], [78, 79], null),
  unit('f26_c50', '50', 'DI', 'TDS/TCS particulars and statements; Interest on late deduction or payment', ['c50a', 'c50b', 'c50c'], ['S50a', 'S50b', 'S50c'], ['s50a', 's50b', 's50c'], [80, 81, 82], null),
  unit('f26_c51', '51', 'DI', 'Disallowance for TDS default – non-resident and resident payments; Same disallowances allowed in a later year', ['c51a', 'c51b', 'c51c', 'c51d'], ['S51a', 'S51b', 'S51c', 'S51d'], ['s51a', 's51b', 's51c', 's51d'], [83, 84, 85, 86], null),
  unit('f26_c52', '52', 'DJ', 'Registration / identification numbers; Expenditure split: GST-registered, unregistered, exempt supplies', ['c52'], ['S52a', 'S52b'], ['s52a', 's52b'], [87], null),
  unit('f26_c53', '53', 'DK', 'Trading unit / manufacturing concern', ['c53a', 'c53b'], ['S53a', 'S53bi', 'S53bii'], ['s53a', 's53bi', 's53bii'], [88, 89], null),
  unit('f26_sign', 'Signature', 'DZ', 'Signature and Notes', ['D.place', 'D.date', 'D.name', 'D.mrn', 'D.pan', 'D.udin', 'D.firm', 'D.frn'], [], [], [], null),
];

/** The storage clause_key of a table's own row: 'f26_t_' + the table id. */
export function form26TableRowKey(tableId: string): string {
  return `${TAX_AUDIT_FORM26_CLAUSE_PREFIX}t_${tableId}`;
}

function indexBy(pick: (unit: Form26ClauseUnit) => string[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const entry of FORM26_CLAUSE_UNITS) for (const id of pick(entry)) index.set(id, entry.key);
  return index;
}

const CLAUSE_KEY_OF_FIELD = indexBy((entry) => entry.fields);
const CLAUSE_KEY_OF_TABLE = indexBy((entry) => entry.tables);
const CLAUSE_KEY_OF_SCHEDULE = indexBy((entry) => entry.schedules);

function clauseKeyFrom(index: Map<string, string>, id: string, what: string): string {
  const key = index.get(id);
  if (key === undefined) throw new Error(`Form 26 has no ${what} "${id}"`);
  return key;
}

/** The clause unit that holds an answer, e.g. 'c14d' gives 'f26_c14'. Throws for a key the form does not have. */
export function form26ClauseKeyOfField(fieldKey: string): string {
  return clauseKeyFrom(CLAUSE_KEY_OF_FIELD, fieldKey, 'answer key');
}

/** The clause unit a table stands under (not the table's own row key), e.g. 'S45a' gives 'f26_c45'. */
export function form26ClauseKeyOfTable(tableId: string): string {
  return clauseKeyFrom(CLAUSE_KEY_OF_TABLE, tableId, 'table');
}

/** The clause unit a schedule is opened under, e.g. 's53bii' gives 'f26_c53'. */
export function form26ClauseKeyOfSchedule(scheduleId: string): string {
  return clauseKeyFrom(CLAUSE_KEY_OF_SCHEDULE, scheduleId, 'schedule');
}

// 57 clause keys in the order of the form, then 65 table keys in the order of the form's tables = 122.
export const FORM26_ALL_ROW_KEYS: string[] = [
  ...FORM26_CLAUSE_UNITS.map((entry) => entry.key),
  ...FORM26_DEFINITION.tables.map((table) => form26TableRowKey(table.id)),
];
