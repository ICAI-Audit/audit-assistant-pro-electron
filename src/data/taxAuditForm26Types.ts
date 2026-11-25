// Types of the Form No. 26 definition (src/data/taxAuditForm26Definition.ts, generated).
// The definition is data: every screen, calculation, count and export of Form No. 26 reads it.

export type Form26PartId = 'cat' | 'A' | 'B' | 'C' | 'D' | 'S';
export type Form26Category = '1' | '2';
export type Form26FieldKind = 'yesno' | 'choice' | 'radio' | 'text' | 'longtext' | 'date' | 'number' | 'email';
export type Form26Field = {
  key: string;                 // the file's data-k, e.g. 'c14d', 'A.assessee', 'C.pan'
  order: number;               // document order
  kind: Form26FieldKind;
  options?: string[];          // yesno: ['Yes','No']; choice: option texts in order (blank excluded)
  radioOptions?: { value: string; label: string }[];
  placeholder?: string; maxLength?: number; rows?: number;
  default: string;             // value when the file opens ('' = blank)
  part: Form26PartId; section: string | null;      // Part D section id 'A'..'K' | 'Z'
  schedule: string | null;     // always null today (no field sits in a schedule)
  category: Form26Category | null;                 // '1' = Part A, '2' = Part B
  showIf: string[];            // keys that must be 'Yes', outermost first
  questionRow: number | null; signature: boolean;
  label: string; inlinePrefix?: string;
  unfilledExempt: boolean;     // keys ending 'udin', and 'B.obs'
  wordUnderline: boolean;
};
export type Form26ColumnType = 'sl' | 's' | 'text' | 'num' | 'date' | 'yn' | 'sel' | 'ta' | 'calc';
export type Form26Expr =
  | { op: 'sub'; a: string; b: string }                       // a - b
  | { op: 'scale'; a: string; factor: number }                // a * factor
  | { op: 'excess'; a: string; b: string; share: number };    // max(0, a - share * b)
export type Form26Column = {
  c: string; header: string; headerPath?: string[]; letter?: string;
  type: Form26ColumnType; options?: string[];
  calc?: { sources: string[]; expr: Form26Expr; formula: string };
  input: boolean; optional: boolean; total: boolean;
  kind?: 'amount' | 'number' | 'percentage';
};
export type Form26HeaderCell = { tag: 'th' | 'td'; text: string; colspan?: number; rowspan?: number };
export type Form26DepRow = { no: number; label: string; calculated: boolean; cells: string[] };
export type Form26DepFormula = { row: number; formula: string; sources: number[] };
export type Form26Table = {
  id: string; order: number; kind: 'rows' | 'fixed' | 'depreciation';
  part: Form26PartId; section: string | null; schedule: string | null; group: string | null;
  category: Form26Category | null; showIf: string[]; questionRow: number | null;
  columns: Form26Column[];                      // [] for depreciation
  headerRows: { letters: boolean; cells: Form26HeaderCell[] }[];
  fixedRows?: string[][]; startRows: number; hasSerialColumn: boolean;
  total: { label: string; labelColspan: number; columns: string[] } | null;
  unfilledExempt: boolean;                      // A5, B5, P11a
  dep?: { kind: 'pm' | 'ot'; rates: string[]; columnGroups: { text: string; span: number }[]; columnLetters: string[]; rows: Form26DepRow[]; formulas: Form26DepFormula[] };
};
export type Form26QuestionRow = {
  index: number; part: 'C' | 'D'; section: string | null; no: string; clause: string; sub: string | null;
  fullWidth: boolean; wordingHtml: string | null; wording: string | null;
  answer: Form26Node[]; fields: string[]; tables: string[]; links: { schedule: string; text: string }[];
};
export type Form26Node = string | { f: string; rv?: string } | { tbl: string } | { t: string; c?: string; a?: Record<string, string>; k?: Form26Node[] };
export type Form26Schedule = { id: string; order: number; showIf: string | null; group: string; title: string; navLabel: string; tables: string[]; body: Form26Node[] };
export type Form26ScheduleGroup = { id: string; name: string; title: string; schedules: string[] };
export type Form26Definition = {
  sourceSha256: string; title: string;
  parts: { id: Form26PartId; heading: string | null; category: Form26Category | null }[];
  sections: { id: string; title: string; shortName: string }[];        // Part D: 'A'..'K','Z'
  fields: Form26Field[]; tables: Form26Table[]; questionRows: Form26QuestionRow[];
  schedules: Form26Schedule[]; scheduleGroups: Form26ScheduleGroup[];
  tree: { main: Form26Node[]; sched: Form26Node[] };   // the whole document in the file's order: prose, question tables ({f} = field, {tbl} = table), notes
  documentOrder: ({ k: string } | { t: string })[];
  saveFile: { fieldOrder: string[]; tableOrder: string[]; radioKeys: string[] };
  optionalColumnPattern: { source: string; flags: string };
  codes: [string, string][];
};
