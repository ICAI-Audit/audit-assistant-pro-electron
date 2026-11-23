// Generates src/data/taxAuditForm26Definition.ts from scripts/tax-audit-form26/as-built.json
// (the exact extraction of the office's fillable Form No. 26, trimmed by trim-as-built.mjs).
// Every rule here is mechanical: a name is changed or an entry is left out, nothing is decided.
//
//   node scripts/tax-audit-form26/generate-definition.mjs           writes the file
//   node scripts/tax-audit-form26/generate-definition.mjs --check   exits 1 when the file is out of date
//
// src/data/taxAuditForm26Definition.test.ts runs generate() and compares with the checked-in file.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const INPUT = path.join(here, 'as-built.json');
const OUTPUT = path.join(here, '..', '..', 'src', 'data', 'taxAuditForm26Definition.ts');

const PART_IDS = ['cat', 'A', 'B', 'C', 'D', 'S'];
const FIELD_KINDS = ['yesno', 'choice', 'radio', 'text', 'longtext', 'date', 'number', 'email'];
const COLUMN_TYPES = ['sl', 's', 'text', 'num', 'date', 'yn', 'sel', 'ta', 'calc'];
const COLUMN_KINDS = ['amount', 'number', 'percentage'];

// The file's calculated columns, by the formula text of the extraction. Anything else stops the build.
const EXPRESSIONS = {
  'c2-c3': { op: 'sub', a: '2', b: '3' },
  'c3-c2': { op: 'sub', a: '3', b: '2' },
  'c4-c5': { op: 'sub', a: '4', b: '5' },
  'c3-c4': { op: 'sub', a: '3', b: '4' },
  'max(0,c0-0.3*c1)': { op: 'excess', a: '0', b: '1', share: 0.3 },
  'c5*0.3': { op: 'scale', a: '5', factor: 0.3 },
  c5: { op: 'scale', a: '5', factor: 1 },
};

function oneOf(value, allowed, what) {
  if (!allowed.includes(value)) throw new Error(`${what}: unexpected value ${JSON.stringify(value)}`);
  return value;
}

/** Leaves out entries whose value is undefined, keeping the order given. */
function compact(entries) {
  const out = {};
  for (const [key, value] of Object.entries(entries)) if (value !== undefined) out[key] = value;
  return out;
}

const decodeAmp = (text) => text.replace(/&amp;/g, '&');

function fieldOf(source) {
  const kind = oneOf(source.kind, FIELD_KINDS, `field ${source.key} kind`);
  return compact({
    key: source.key,
    order: source.order,
    kind,
    options: kind === 'yesno' || kind === 'choice' ? source.options : undefined,
    radioOptions: kind === 'radio' ? source.options.map((option) => ({ value: option.value, label: option.label })) : undefined,
    placeholder: source.placeholder,
    maxLength: source.maxlength === undefined ? undefined : Number(source.maxlength),
    rows: source.rows === undefined ? undefined : Number(source.rows),
    default: source.default,
    part: oneOf(source.panel, PART_IDS, `field ${source.key} panel`),
    section: source.dsec,
    schedule: source.sched,
    category: source.cat,
    showIf: source.showif,
    questionRow: source.qRow,
    signature: source.sig,
    label: source.label,
    inlinePrefix: source.inlinePrefix,
    unfilledExempt: source.unfilledExempt,
    wordUnderline: source.wordUnderline,
  });
}

function columnOf(tableId, source) {
  const where = `column ${tableId}.${source.c}`;
  let calc;
  if (source.calc !== undefined) {
    const expr = EXPRESSIONS[source.calc.formula];
    if (!expr) throw new Error(`${where}: no expression for the formula ${JSON.stringify(source.calc.formula)}`);
    calc = { sources: source.calc.src, expr, formula: source.calc.formula };
  }
  return compact({
    c: source.c,
    header: source.header,
    headerPath: source.headerPath,
    letter: source.letter ?? undefined,
    type: oneOf(source.type, COLUMN_TYPES, `${where} type`),
    options: source.options,
    calc,
    input: source.input,
    optional: source.optionalWhenRowPartlyFilled === true,
    total: source.total,
    kind: source.semantic === undefined ? undefined : oneOf(source.semantic, COLUMN_KINDS, `${where} semantic`),
  });
}

function tableOf(source, depreciationFormulas) {
  const columns = (source.columns ?? []).map((column) => columnOf(source.id, column));
  let dep;
  if (source.dep !== undefined) {
    const formulas = depreciationFormulas[source.dep.kind];
    if (!Array.isArray(formulas)) throw new Error(`table ${source.id}: no depreciation formulas for ${JSON.stringify(source.dep.kind)}`);
    dep = {
      kind: source.dep.kind,
      rates: source.dep.rates,
      columnGroups: source.dep.columnGroups.map((group) => ({ text: group.text, span: group.span })),
      columnLetters: source.dep.columnLetters,
      rows: source.dep.rows.map((row) => ({ no: row.no, label: row.label, calculated: row.calculated, cells: row.cells })),
      formulas: formulas.map((formula) => ({ row: formula.row, formula: formula.formula, sources: formula.sources })),
    };
  }
  return compact({
    id: source.id,
    order: source.order,
    kind: oneOf(source.kind, ['rows', 'fixed', 'depreciation'], `table ${source.id} kind`),
    part: oneOf(source.panel, PART_IDS, `table ${source.id} panel`),
    section: source.dsec,
    schedule: source.sched,
    group: source.group,
    category: source.cat,
    showIf: source.showif,
    questionRow: source.qRow,
    columns,
    headerRows: source.headerRows.map((row) => ({
      letters: row.cls === 'lt',
      cells: row.cells.map((cell) => compact({ tag: oneOf(cell.tag, ['th', 'td'], `table ${source.id} header cell`), text: cell.text, colspan: cell.colspan, rowspan: cell.rowspan })),
    })),
    fixedRows: source.fixedRows,
    startRows: source.startRows,
    hasSerialColumn: columns.some((column) => column.type === 'sl'),
    total: source.total ? { label: source.total.label, labelColspan: source.total.labelColspan, columns: source.total.columns } : null,
    unfilledExempt: source.unfilledExemptTable,
    dep,
  });
}

function questionRowOf(source, scheduleIds) {
  return {
    index: source.index,
    part: oneOf(source.panel, ['C', 'D'], `question row ${source.index} panel`),
    section: source.dsec,
    no: source.no,
    clause: source.clause,
    sub: source.sub,
    fullWidth: source.full,
    wordingHtml: source.textHtml,
    wording: source.text,
    answer: source.respTree,
    fields: source.keys,
    tables: source.tables,
    links: source.links.map((link) => {
      const schedule = String(link.href).replace(/^#/, '');
      if (!String(link.href).startsWith('#') || !scheduleIds.has(schedule)) throw new Error(`question row ${source.index}: link ${JSON.stringify(link.href)} names no schedule`);
      return { schedule, text: link.text };
    }),
  };
}

/** The definition object, from the parsed as-built.json. */
export function buildDefinition(asBuilt) {
  const shortNames = new Map(asBuilt.navigation.partDSections);
  const scheduleIds = new Set(asBuilt.schedules.map((schedule) => schedule.id));
  return {
    sourceSha256: asBuilt.meta.sha256,
    title: asBuilt.meta.title,
    parts: asBuilt.panels.map((panel) => ({ id: oneOf(panel.id, PART_IDS, 'panel id'), heading: panel.heading, category: panel.cat })),
    sections: asBuilt.partDSections.map((section) => {
      const shortName = shortNames.get(section.id);
      if (typeof shortName !== 'string') throw new Error(`section ${section.id}: no short name`);
      return { id: section.id, title: section.title, shortName: decodeAmp(shortName) };
    }),
    fields: asBuilt.fields.map(fieldOf),
    tables: asBuilt.tables.map((table) => tableOf(table, asBuilt.calculations.depreciation)),
    questionRows: asBuilt.questionRows.map((row) => questionRowOf(row, scheduleIds)),
    schedules: asBuilt.schedules.map((schedule) => ({
      id: schedule.id,
      order: schedule.order,
      showIf: schedule.showif,
      group: schedule.group,
      title: schedule.title,
      navLabel: schedule.navLabel,
      tables: schedule.tables,
      body: schedule.body,
    })),
    scheduleGroups: asBuilt.scheduleGroups.map((group) => ({ id: group.g, name: group.gname, title: group.title, schedules: group.scheds })),
    tree: { main: asBuilt.tree.main, sched: asBuilt.tree.sched },
    documentOrder: asBuilt.unfilled.documentOrder,
    saveFile: { fieldOrder: asBuilt.saveFormat.fKeyOrder, tableOrder: asBuilt.saveFormat.tKeyOrder, radioKeys: asBuilt.saveFormat.radioKeys },
    optionalColumnPattern: { source: asBuilt.unfilled.optionalColumnHeaderPattern.source, flags: asBuilt.unfilled.optionalColumnHeaderPattern.flags },
    codes: asBuilt.scriptData.CODES,
  };
}

// ---- writing TypeScript: short values on one line, longer ones one entry per line

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const LINE = 150;
const keyText = (key) => (IDENTIFIER.test(key) ? key : JSON.stringify(key));

function inline(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(inline).join(', ')}]`;
  const entries = Object.entries(value);
  if (entries.length === 0) return '{}';
  return `{ ${entries.map(([key, item]) => `${keyText(key)}: ${inline(item)}`).join(', ')} }`;
}

function write(value, depth) {
  const flat = inline(value);
  if (value === null || typeof value !== 'object' || flat.length + depth * 2 <= LINE) return flat;
  const pad = '  '.repeat(depth + 1);
  const end = '  '.repeat(depth);
  if (Array.isArray(value)) return `[\n${value.map((item) => `${pad}${write(item, depth + 1)},`).join('\n')}\n${end}]`;
  return `{\n${Object.entries(value).map(([key, item]) => `${pad}${keyText(key)}: ${write(item, depth + 1)},`).join('\n')}\n${end}}`;
}

/** The text of src/data/taxAuditForm26Definition.ts. */
export function generate(asBuilt) {
  const definition = buildDefinition(asBuilt);
  return [
    `// GENERATED by scripts/tax-audit-form26/generate-definition.mjs from as-built.json (sha256 of the source file: ${definition.sourceSha256}). Do not edit by hand.`,
    "import type { Form26Definition } from './taxAuditForm26Types';",
    '',
    `export const FORM26_DEFINITION: Form26Definition = ${write(definition, 0)};`,
    '',
  ].join('\n');
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const text = generate(JSON.parse(fs.readFileSync(INPUT, 'utf8')));
  if (process.argv.includes('--check')) {
    const current = fs.existsSync(OUTPUT) ? fs.readFileSync(OUTPUT, 'utf8').replace(/\r\n/g, '\n') : null;
    if (current !== text) {
      console.error('src/data/taxAuditForm26Definition.ts is out of date: run node scripts/tax-audit-form26/generate-definition.mjs');
      process.exit(1);
    }
    console.log('src/data/taxAuditForm26Definition.ts is up to date.');
  } else {
    fs.writeFileSync(OUTPUT, text);
    console.log(`Wrote ${OUTPUT} (${text.length} characters)`);
  }
}
