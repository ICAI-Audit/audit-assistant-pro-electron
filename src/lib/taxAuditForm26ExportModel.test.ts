import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FORM26_DEFINITION as DEF } from '@/data/taxAuditForm26Definition';
import { FORM26_MAPPING, FORM26_NOT_IN_FORM26 } from '@/data/taxAuditForm26Mapping';
import {
  FORM26_FILE_INDENTED_LINES,
  buildForm26ExportModel,
  exportModelLines,
  exportModelText,
  exportedValue,
  form26ExportColumnShares,
  type Form26ExportBlock,
  type Form26ExportModel,
  type Form26Run,
} from '@/lib/taxAuditForm26ExportModel';
import { FORM26_QUIRKS } from '@/lib/taxAuditForm26Quirks';
import { defaultValues, type Form26Values } from '@/lib/taxAuditForm26Values';
import { TAX_AUDIT_FORM_3CD_DRAFT_NOTICE } from '@/lib/taxAuditForm3CDExport';

// The owner's fillable file exported three states to Word (fixtures word-*.doc.html) from the three save
// objects in word-values.json. The model built from each save object must say what those exports say.

const fixture = (name: string) => readFileSync(new URL(`./__fixtures__/taxAuditForm26/${name}`, import.meta.url), 'utf8');
type SaveObject = { f: Record<string, string>; t: Form26Values['t']; v: 1 };
const SAVES = JSON.parse(fixture('word-values.json')) as Record<'default' | 'filledCat2' | 'filledCat1', SaveObject>;
const valuesOf = (save: SaveObject): Form26Values => JSON.parse(JSON.stringify({ f: save.f, t: save.t })) as Form26Values;
const AT = '2026-11-22T10:00:00.000Z';
const build = (values: Form26Values, showAllSchedules = false) => buildForm26ExportModel(DEF, values, { showAllSchedules, generatedAt: AT });

// ---------------------------------------------------------------------------------------------------
// A small reader of the exported .doc (an HTML document): elements, text, entities. Test code only.

type HNode = string | HEl;
type HEl = { tag: string; attrs: Record<string, string>; kids: HNode[] };
const VOID = new Set(['br', 'meta', 'img', 'hr', 'input', 'link']);
const ENTITY: Record<string, string> = { nbsp: '\u00A0', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (text: string) =>
  text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] === '#') return String.fromCodePoint(name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10));
    return ENTITY[name.toLowerCase()] ?? whole;
  });

function parseHtml(html: string): HEl {
  const root: HEl = { tag: '#root', attrs: {}, kids: [] };
  const stack: HEl[] = [root];
  const pattern = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9:]*)([^>]*)>|([^<]+)/g;
  for (let m = pattern.exec(html); m !== null; m = pattern.exec(html)) {
    const top = stack[stack.length - 1];
    if (m[4] !== undefined) {
      top.kids.push(decode(m[4]));
      continue;
    }
    if (m[2] === undefined) continue; // a comment
    const tag = m[2].toLowerCase();
    if (m[1] === '/') {
      const at = stack.map((el) => el.tag).lastIndexOf(tag);
      if (at > 0) stack.length = at;
      continue;
    }
    const attrs: Record<string, string> = {};
    for (const a of m[3].matchAll(/([^\s=/]+)\s*=\s*"([^"]*)"/g)) attrs[a[1].toLowerCase()] = decode(a[2]);
    const el: HEl = { tag, attrs, kids: [] };
    top.kids.push(el);
    if (!VOID.has(tag) && !m[3].trim().endsWith('/')) stack.push(el);
  }
  return root;
}

const isEl = (node: HNode): node is HEl => typeof node !== 'string';
const classes = (el: HEl) => (el.attrs.class ?? '').split(/\s+/).filter(Boolean);
const hasClass = (el: HEl, name: string) => classes(el).includes(name);
function find(el: HEl, test: (el: HEl) => boolean): HEl | null {
  if (test(el)) return el;
  for (const kid of el.kids) if (isEl(kid)) {
    const hit = find(kid, test);
    if (hit) return hit;
  }
  return null;
}
const elementKids = (el: HEl, tag?: string) => el.kids.filter(isEl).filter((kid) => tag === undefined || kid.tag === tag);

// The comparison drops white space (as the plan says) but keeps non-breaking spaces: a blank value is four of them.
const squash = (text: string) => text.replace(/[ \t\r\n]+/g, '').replace(/<\/(b|i|u)><\1>/g, '');

const INLINE = new Set(['span', 'strong', 'em', 'a', 'b', 'i', 'u', 'label', 'br', 'sub', 'sup']);
const isBlockEl = (el: HEl) => !INLINE.has(el.tag) || (el.tag === 'label' && hasClass(el, 'opt'));

/** Inline content with marks: <b> for strong, <i> for em, <u> for an underlined span. */
function markedText(nodes: HNode[]): string {
  let out = '';
  for (const node of nodes) {
    if (typeof node === 'string') out += node;
    else if (node.tag === 'br') out += ' ';
    else if (node.tag === 'strong' || node.tag === 'b') out += `<b>${markedText(node.kids)}</b>`;
    else if (node.tag === 'em' || node.tag === 'i') out += `<i>${markedText(node.kids)}</i>`;
    else if (node.tag === 'span' && /underline/.test(node.attrs.style ?? '')) out += `<u>${markedText(node.kids)}</u>`;
    else out += ` ${markedText(node.kids)} `;
  }
  return out;
}
const plain = (nodes: HNode[]) => markedText(nodes).replace(/<\/?[biu]>/g, '');

function cellLine(prefix: string, cells: HEl[]): string {
  return `${prefix}:${cells
    .map((cell) => `${squash(markedText(cell.kids))}${cell.attrs.colspan && cell.attrs.colspan !== '1' ? `{cs=${cell.attrs.colspan}}` : ''}${cell.attrs.rowspan ? `{rs=${cell.attrs.rowspan}}` : ''}`)
    .join('|')}`;
}

function htmlTable(el: HEl, out: string[]) {
  for (const part of elementKids(el)) {
    for (const tr of elementKids(part, 'tr')) {
      const cells = elementKids(tr).filter((cell) => cell.tag === 'td' || cell.tag === 'th');
      if (part.tag === 'thead') out.push(cellLine(hasClass(tr, 'lt') ? 'lt' : 'th', cells));
      else out.push(cellLine(part.tag === 'tfoot' ? 'tf' : 'td', cells));
    }
  }
}

type Flow = { indent: boolean; para: string };

function htmlFlow(nodes: HNode[], out: string[], flow: Flow) {
  let inline: HNode[] = [];
  const flush = () => {
    const text = squash(markedText(inline));
    if (text !== '') out.push(`${flow.para}${flow.indent ? '.in' : ''}:${text}`);
    inline = [];
  };
  for (const node of nodes) {
    if (!isEl(node) || !isBlockEl(node)) inline.push(node);
    else {
      flush();
      htmlBlock(node, out, flow);
    }
  }
  flush();
}

function htmlBlock(el: HEl, out: string[], flow: Flow) {
  const indent = flow.indent || /margin-left/.test(el.attrs.style ?? '');
  if (/^h[1-4]$/.test(el.tag)) {
    out.push(`${el.tag}${classes(el).length ? `.${classes(el)[0]}` : ''}:${squash(plain(el.kids))}`);
    return;
  }
  if (el.tag === 'table' && hasClass(el, 'q')) {
    for (const tr of elementKids(elementKids(el, 'tbody')[0], 'tr')) {
      const tds = elementKids(tr, 'td');
      if (tds.length === 2 && tds[1].attrs.colspan === '2') htmlFlow(tds[1].kids, out, { indent: false, para: 'p' });
      else out.push(`q:${squash(plain(tds[0].kids))}|${squash(markedText(tds[1].kids))}|${squash(markedText(tds[2].kids))}`);
    }
    return;
  }
  if (el.tag === 'table' && hasClass(el, 'sg')) {
    for (const tr of elementKids(elementKids(el, 'tbody')[0], 'tr')) {
      const filled = elementKids(tr, 'td').map((td) => squash(plain(td.kids))).filter((text) => text !== '');
      out.push(`sg:${filled.join('|')}`);
    }
    return;
  }
  if (el.tag === 'table') {
    htmlTable(el, out);
    return;
  }
  if (el.tag === 'div' && hasClass(el, 'note') && elementKids(el, 'ol').length > 0) {
    out.push(`note:${squash(plain(elementKids(el, 'strong')[0].kids))}`);
    for (const li of elementKids(elementKids(el, 'ol')[0], 'li')) htmlFlow(li.kids, out, { indent: false, para: 'li' });
    return;
  }
  const blockKids = el.kids.some((kid) => isEl(kid) && isBlockEl(kid));
  if (blockKids) {
    htmlFlow(el.kids, out, { indent, para: flow.para });
    return;
  }
  const text = squash(markedText(el.kids));
  if (text === '') return;
  const mods = `${hasClass(el, 'c') || hasClass(el, 'sub') ? '.c' : ''}${indent ? '.in' : ''}${hasClass(el, 'note') ? '.sm' : ''}`;
  out.push(`${flow.para}${mods}:${text}`);
}

function htmlLines(html: string, section: 'WordSection1' | 'WordSection2'): string[] {
  const root = parseHtml(html);
  const holder = find(root, (el) => el.tag === 'div' && hasClass(el, section));
  if (!holder) throw new Error(`no ${section}`);
  const out: string[] = [];
  htmlFlow(holder.kids, out, { indent: false, para: 'p' });
  return out;
}

const htmlPlainText = (html: string, section: 'WordSection1' | 'WordSection2') => {
  const holder = find(parseHtml(html), (el) => el.tag === 'div' && hasClass(el, section));
  if (!holder) throw new Error(`no ${section}`);
  return plain(holder.kids).replace(/[ \t\r\n]+/g, '');
};

// The same lines from the model's blocks (the model is the only input here).

const runsMarked = (runs: Form26Run[]) =>
  runs
    .map((run) => {
      let text = run.text;
      if (run.underline) text = `<u>${text}</u>`;
      if (run.italic) text = `<i>${text}</i>`;
      if (run.bold) text = `<b>${text}</b>`;
      return text;
    })
    .join('');

function headCellLine(prefix: string, cells: { text: string; colspan?: number; rowspan?: number }[]) {
  return `${prefix}:${cells.map((cell) => `${squash(cell.text)}${cell.colspan && cell.colspan !== 1 ? `{cs=${cell.colspan}}` : ''}${cell.rowspan ? `{rs=${cell.rowspan}}` : ''}`).join('|')}`;
}

function modelBlockLines(block: Form26ExportBlock, out: string[], para = 'p') {
  switch (block.kind) {
    case 'heading': {
      const tag = block.level === 2 ? 'h2.part' : block.level === 3 ? (block.underlined ? 'h3.sch' : 'h3.sec') : `h${block.level}`;
      out.push(`${tag}:${squash(block.text)}`);
      return;
    }
    case 'para':
      out.push(`${para}${block.centred ? '.c' : ''}${block.indent ? '.in' : ''}${block.small ? '.sm' : ''}:${squash(runsMarked(block.runs))}`);
      return;
    case 'questions':
      for (const row of block.rows) {
        if (row.fullWidth) row.fullWidth.forEach((inner) => modelBlockLines(inner, out));
        else out.push(`q:${squash(row.no)}|${squash(runsMarked(row.wording))}|${squash(runsMarked(row.answer))}`);
      }
      return;
    case 'table':
      for (const head of block.head) out.push(headCellLine(head.every((cell) => cell.tag === 'td') ? 'lt' : 'th', head));
      for (const row of block.body) out.push(`td:${row.map(squash).join('|')}`);
      if (block.total) out.push(`tf:${block.total.map((cell, i) => `${squash(cell)}${i === 0 && block.totalSpan && block.totalSpan !== 1 ? `{cs=${block.totalSpan}}` : ''}`).join('|')}`);
      return;
    case 'signature':
      for (const line of block.lines) out.push(`sg:${[line.label, line.value].map(squash).filter((text) => text !== '').join('|')}`);
      if (block.closing !== '') out.push(`sg:${squash(block.closing)}`);
      return;
    case 'notes':
      out.push(`note:${squash(block.title)}`);
      for (const item of block.items) item.forEach((inner) => modelBlockLines(inner, out, 'li'));
      return;
  }
}

const modelLines = (blocks: Form26ExportBlock[]) => {
  const out: string[] = [];
  blocks.forEach((block) => modelBlockLines(block, out));
  return out;
};

// ---------------------------------------------------------------------------------------------------

const CASES = [
  { name: 'as opened', save: 'default', html: 'word-default.doc.html' },
  { name: 'filled, category (ii), every answer Yes', save: 'filledCat2', html: 'word-filled-cat2.doc.html' },
  { name: 'filled, category (i), every answer Yes', save: 'filledCat1', html: 'word-filled-cat1.doc.html' },
] as const;

describe('the export model against the owner\'s Word exports', () => {
  for (const c of CASES) {
    describe(c.name, () => {
      const html = fixture(c.html);
      const model = build(valuesOf(SAVES[c.save]));

      it('portrait: block for block, in order, the owner\'s section 1, with no exception (no draft notice: owner, 22 Nov 2026)', () => {
        expect(modelLines(model.portrait)).toEqual(htmlLines(html, 'WordSection1'));
      });

      it('landscape: block for block, in order, the owner\'s section 2', () => {
        expect(modelLines(model.landscape)).toEqual(htmlLines(html, 'WordSection2'));
      });

      it('the text of the model equals the owner\'s export (tags stripped, entities decoded, white space removed)', () => {
        const text = exportModelText(model);
        const portrait = text.portrait.split('\n');
        expect(portrait.join('\n').replace(/[ \t\r\n]+/g, '')).toBe(htmlPlainText(html, 'WordSection1'));
        expect(text.landscape.replace(/[ \t\r\n]+/g, '')).toBe(htmlPlainText(html, 'WordSection2'));
      });
    });
  }

  it('filled exports: 55 schedules in 11 groups, 57 schedule tables; Part B resp. Part A', () => {
    for (const [save, part, other] of [['filledCat2', 'PART B', 'PART A'], ['filledCat1', 'PART A', 'PART B']] as const) {
      const model = build(valuesOf(SAVES[save]));
      const headings = model.landscape.filter((block) => block.kind === 'heading');
      expect(headings.filter((block) => block.kind === 'heading' && block.level === 3)).toHaveLength(11);
      expect(headings.filter((block) => block.kind === 'heading' && block.level === 4)).toHaveLength(55);
      expect(model.landscape.filter((block) => block.kind === 'table')).toHaveLength(57);
      const parts = model.portrait.filter((block) => block.kind === 'heading' && block.level === 2).map((block) => (block.kind === 'heading' ? block.text : ''));
      expect(parts).toContain(part);
      expect(parts).not.toContain(other);
    }
  });

  it('order of headings as opened equals the outline the owner\'s file exported', () => {
    const asBuilt = JSON.parse(readFileSync(new URL('../../scripts/tax-audit-form26/as-built.json', import.meta.url), 'utf8')) as {
      wordExport: { outlineAtOpen: { secs: { cls: string; headings: string[] }[] } };
    };
    const expected = asBuilt.wordExport.outlineAtOpen.secs[0].headings;
    const model = build(defaultValues(DEF));
    const headings = model.portrait.flatMap((block) => {
      if (block.kind !== 'heading') return [];
      const tag = block.level === 2 ? 'h2.part' : block.level === 3 ? (block.underlined ? 'h3.sch' : 'h3.sec') : `h${block.level}`;
      return [`${tag}: ${block.text}`];
    });
    expect(expected).toHaveLength(17);
    expect(headings).toEqual(expected);
    expect(headings[0]).toBe('h1: FORM NO. 26');
    expect(headings[16]).toBe('h3.sec: Signature and Notes');
  });

  it('the opening state of the application equals the owner\'s opening export', () => {
    // defaultValues() is the file's state at open; it must export exactly as the save object of that state.
    expect(exportModelText(build(defaultValues(DEF)))).toEqual(exportModelText(build(valuesOf(SAVES.default))));
  });
});

describe('the two lines whose indent the definition does not hold', () => {
  it('each is in the form exactly once, right after a line break, with the indent squeezed to one space', () => {
    const found: string[] = [];
    const visit = (nodes: (typeof DEF.tree.main)[number][]) => {
      nodes.forEach((node, i) => {
        if (typeof node === 'string') {
          const before = nodes[i - 1];
          if (FORM26_FILE_INDENTED_LINES.some((line) => node.trim().startsWith(line))) {
            expect(typeof before === 'object' && 't' in before && before.t).toBe('br');
            expect(node.startsWith(' (')).toBe(true);
            found.push(node.trim());
          }
        } else if ('t' in node && node.k) visit(node.k);
      });
    };
    visit([...DEF.tree.main, ...DEF.tree.sched]);
    expect(found).toHaveLength(FORM26_FILE_INDENTED_LINES.length);
    // In the owner's export both lines start with &nbsp;&nbsp;&nbsp;.
    const html = fixture('word-default.doc.html');
    for (const line of FORM26_FILE_INDENTED_LINES) expect(html).toContain(`&nbsp;&nbsp;&nbsp;${line.slice(0, 20)}`);
  });
});

describe('exportedValue', () => {
  it('a date as dd/mm/yyyy, a blank as four non-breaking spaces, long text keeps its lines, a chosen radio ☑', () => {
    expect(exportedValue('date', '2027-03-31')).toBe('31/03/2027');
    expect(exportedValue('text', '')).toBe('\u00A0\u00A0\u00A0\u00A0');
    expect(exportedValue('date', '')).toBe('\u00A0\u00A0\u00A0\u00A0');
    expect(exportedValue('longtext', 'line one\nline two')).toBe('line one\nline two');
    expect(exportedValue('ta', 'cell one\ncell two')).toBe('cell one\ncell two');
    expect(exportedValue('radio', '2')).toBe('☑');
    expect(exportedValue('radio', '')).toBe('☐');
    expect(exportedValue('yesno', 'No')).toBe('No');
    expect(exportedValue('choice', 'Trust')).toBe('Trust');
    expect(exportedValue('num', '1234.5')).toBe('1234.5');
    expect(exportedValue('calc', '-1000.01')).toBe('-1000.01');
    // A text box that holds a date (A.rdate is a text box in the file) is exported as typed.
    expect(exportedValue('text', '2026-09-01')).toBe('2026-09-01');
  });
});

describe('what is shown is what is exported', () => {
  const lines = (model: Form26ExportModel) => [...exportModelLines(model).portrait, ...exportModelLines(model).landscape].join('\n');

  it('a schedule whose answer is No is not exported although "Show all schedules" is on (decision A3)', () => {
    expect(FORM26_QUIRKS.showAllSchedulesAffectsExport).toBe(false);
    const values = defaultValues(DEF);
    values.t.S28 = [{ 1: 'Invented penalty authority', 2: 'Invented nature', 3: '500' }];
    const on = build(values, true);
    const off = build(values, false);
    expect(exportModelText(on)).toEqual(exportModelText(off));
    expect(lines(on)).not.toContain('Invented penalty authority');
    expect(on.landscape.some((block) => block.kind === 'heading' && block.text.startsWith('28.'))).toBe(false);
  });

  it('with the file\'s own setting the screen switch would export the "No" schedules too (the switch is honoured)', () => {
    const values = defaultValues(DEF);
    values.t.S28 = [{ 1: 'Invented penalty authority', 2: 'Invented nature', 3: '500' }];
    const fileWay = buildForm26ExportModel(DEF, values, { showAllSchedules: true, generatedAt: AT, quirks: { ...FORM26_QUIRKS, showAllSchedulesAffectsExport: true } });
    expect(lines(fileWay)).toContain('Invented penalty authority');
    expect(fileWay.landscape.filter((block) => block.kind === 'heading' && block.level === 4)).toHaveLength(55);
    // Inline items of the form stay as the answers say: the line "If yes, refer …" under 28 is still left out.
    expect(lines(fileWay)).not.toMatch(/Any penalty levied[^\n]*If yes/);
  });

  it('values of the hidden Part and of hidden schedules are not in the text', () => {
    const values = defaultValues(DEF);
    values.f['A.assessee'] = 'Invented hidden assessee';
    values.f['A.q3a'] = 'Yes';
    values.t.A3b = [{ 1: 'Invented hidden observation', 2: '1', 3: '2', 4: '-1', 5: '' }];
    values.t.S11b = [{ 1: '2026-05-01', 2: 'Invented hidden partner', 3: '', 4: '', 5: '', 6: '', 7: '' }];
    const text = lines(build(values));
    expect(text).not.toContain('Invented hidden assessee');
    expect(text).not.toContain('Invented hidden observation');
    expect(text).not.toContain('Invented hidden partner');
    expect(text).not.toContain('PART A');
    // Category (i) shows them (Part A, with 3(a) Yes); the schedule still needs its answer.
    values.f.cat = '1';
    const cat1 = lines(build(values));
    expect(cat1).toContain('Invented hidden assessee');
    expect(cat1).toContain('Invented hidden observation');
    expect(cat1).not.toContain('Invented hidden partner');
  });

  it('with no category chosen both Parts are exported (as the file shows both)', () => {
    const values = defaultValues(DEF);
    delete values.f.cat;
    const parts = build(values).portrait.flatMap((block) => (block.kind === 'heading' && block.level === 2 ? [block.text] : []));
    expect(parts.slice(0, 2)).toEqual(['PART A', 'PART B']);
  });

  it('the file\'s on-screen hints are not exported: the Tip, the category hint, the depreciation hint', () => {
    const values = valuesOf(SAVES.filledCat2);
    const text = lines(build(values));
    expect(text).not.toContain('Tip: use the tabs above');
    expect(text).not.toContain('Category (i) shows Parts A, C and D');
    expect(text).not.toContain('Rows shaded as calculated fields');
  });

  it('totals as the file formats them; a table with no rows exports one blank row (the file keeps one)', () => {
    const values = defaultValues(DEF);
    values.f.c28 = 'Yes';
    values.t.S28 = [{ 1: 'a', 2: 'b', 3: '1234567.891' }, { 1: 'c', 2: 'd', 3: '0.005' }];
    values.f.c29 = 'Yes';
    values.t.S29 = [];
    const model = build(values);
    const s28 = model.landscape.find((block): block is Extract<Form26ExportBlock, { kind: 'table' }> => block.kind === 'table' && block.id === 'S28');
    expect(s28?.total?.[s28.total.length - 1]).toBe('12,34,567.9');
    const s29 = model.landscape.find((block): block is Extract<Form26ExportBlock, { kind: 'table' }> => block.kind === 'table' && block.id === 'S29');
    expect(s29?.body).toHaveLength(1);
    expect(s29?.body[0][0]).toBe('1');
    expect(s29?.body[0].slice(1).every((cell) => cell === '\u00A0\u00A0\u00A0\u00A0')).toBe(true);
  });
});

describe('nothing but the form', () => {
  it('no comparison or review text can enter: the model reads only the definition, the answers and the view', () => {
    expect(buildForm26ExportModel.length).toBe(3);
    const values = valuesOf(SAVES.filledCat2) as Form26Values & Record<string, unknown>;
    // State a screen holds beside the answers: review remarks, a qualification text, mapping lines.
    values.f.f26_review_remarks = 'Invented review remark for the export test';
    values.f.qualification_text = 'Invented qualification for the export test';
    (values as Record<string, unknown>).review = { remarks: 'Invented review remark for the export test' };
    const text = JSON.stringify(build(values));
    expect(text).not.toContain('Invented review remark for the export test');
    expect(text).not.toContain('Invented qualification for the export test');
    const formText = JSON.stringify(DEF.tree);
    const commentary = [
      ...FORM26_MAPPING.flatMap((row) => [row.office, row.corrected].flatMap((entry) => (entry ? [entry.whatChanged, entry.askClient ?? '', ...entry.threeCd.map((c) => c.subject)] : []))),
      ...FORM26_NOT_IN_FORM26.flatMap((row) => [row.office, row.corrected].flatMap((entry) => (entry ? [entry.position, entry.subject] : []))),
    ].filter((line) => line.length >= 25 && !formText.includes(line));
    expect(commentary.length).toBeGreaterThan(50);
    for (const line of commentary) expect(text).not.toContain(line);
  });

  it('no draft notice anywhere in the model (owner, 22 Nov 2026): no paragraph, no label, no field for it', () => {
    for (const values of [defaultValues(DEF), valuesOf(SAVES.filledCat2)]) {
      const model = build(values);
      const text = JSON.stringify(model);
      for (const words of ['Draft review note', 'Draft prepared in ICAI VERA', 'draft-notice', 'draftNotice', 'AuditPro']) expect(text).not.toContain(words);
      expect(Object.keys(model).sort()).toEqual(['fileStem', 'generatedAt', 'landscape', 'portrait']);
    }
    expect(TAX_AUDIT_FORM_3CD_DRAFT_NOTICE).toContain('AuditPro'); // the 3CD constant is left as it is
  });

  it('file stem and time as given', () => {
    const values = valuesOf(SAVES.filledCat2);
    const model = build(values);
    expect(model.fileStem).toBe('Form26_AAAAA0000A');
    expect(model.generatedAt).toBe(AT);
  });
});

describe('question rows carry their place in the form (for the working-paper pack)', () => {
  it('every question row of Parts C and D is in the model once, in order, with its definition index', () => {
    const model = build(valuesOf(SAVES.filledCat2));
    const rows = model.portrait.flatMap((block) => (block.kind === 'questions' ? block.rows : []));
    expect(rows.map((row) => row.index)).toEqual(DEF.questionRows.map((row) => row.index));
    rows.forEach((row) => {
      const def = DEF.questionRows[row.index];
      if (def.fullWidth) expect(row.fullWidth?.map((block) => (block.kind === 'table' ? block.id : '?'))).toEqual(def.tables);
      else expect(row.no.replace(/\.$/, '')).toBe(def.no.replace(/\.$/, ''));
    });
  });
});

describe('column shares (Word and PDF widths)', () => {
  it('one share per column, all positive, summing to 1; the serial column is the narrowest', () => {
    const model = build(valuesOf(SAVES.filledCat2));
    for (const block of model.landscape) {
      if (block.kind !== 'table') continue;
      const shares = form26ExportColumnShares(block);
      expect(shares).toHaveLength(block.body[0].length);
      expect(shares.every((share) => share > 0)).toBe(true);
      expect(shares.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    }
    const s28 = model.landscape.find((block): block is Extract<Form26ExportBlock, { kind: 'table' }> => block.kind === 'table' && block.id === 'S28');
    const shares = form26ExportColumnShares(s28!);
    expect(Math.min(...shares)).toBe(shares[0]);
  });
});

describe('size', () => {
  it('250 rows in every add/delete table, every answer Yes: built in reasonable time', () => {
    const values = valuesOf(SAVES.filledCat2);
    for (const table of DEF.tables) {
      if (table.kind !== 'rows') continue;
      const row = values.t[table.id]?.[0] ?? {};
      values.t[table.id] = Array.from({ length: 250 }, (_, i) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, `${value} ${i + 1}`])));
    }
    const started = performance.now();
    const model = build(values);
    const ms = performance.now() - started;
    const tables = [...model.portrait, ...model.landscape].flatMap((block) => (block.kind === 'table' ? [block] : block.kind === 'questions' ? block.rows.flatMap((row) => row.fullWidth ?? []).filter((inner) => inner.kind === 'table') : []));
    const s29 = tables.find((block) => block.kind === 'table' && block.id === 'S29');
    expect(s29 && s29.kind === 'table' && s29.body).toHaveLength(250);
    console.info(`[T21] export model, 250 rows per table: ${ms.toFixed(0)} ms`);
    expect(ms).toBeLessThan(2000);
  });
});
