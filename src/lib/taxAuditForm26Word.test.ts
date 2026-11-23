import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FORM26_DEFINITION as DEF } from '@/data/taxAuditForm26Definition';
import {
  buildForm26ExportModel,
  exportModelText,
  type Form26ExportBlock,
  type Form26ExportModel,
} from '@/lib/taxAuditForm26ExportModel';
import { defaultValues, type Form26Values } from '@/lib/taxAuditForm26Values';
import { FORM26_DOCX_MIME, buildForm26Docx, form26DocxFileName } from '@/lib/taxAuditForm26Word';

const fixture = (name: string) => readFileSync(new URL(`./__fixtures__/taxAuditForm26/${name}`, import.meta.url), 'utf8');
type SaveObject = { f: Record<string, string>; t: Form26Values['t'] };
const SAVES = JSON.parse(fixture('word-values.json')) as Record<'default' | 'filledCat2' | 'filledCat1', SaveObject>;
const valuesOf = (save: SaveObject): Form26Values => JSON.parse(JSON.stringify({ f: save.f, t: save.t })) as Form26Values;
const AT = '2026-11-22T10:00:00.000Z';
const build = (values: Form26Values) => buildForm26ExportModel(DEF, values, { showAllSchedules: false, generatedAt: AT });

async function unzip(model: Form26ExportModel) {
  const blob = await buildForm26Docx(model);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const zip = await JSZip.loadAsync(bytes);
  const read = async (path: string) => {
    const file = zip.file(path);
    if (!file) throw new Error(`no ${path} in the package`);
    return file.async('string');
  };
  return { blob, bytes, document: await read('word/document.xml'), styles: await read('word/styles.xml'), numbering: await read('word/numbering.xml'), core: await read('docProps/core.xml') };
}

const decodeXml = (text: string) => text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
/** The text of the document in order: every w:t, a line break or tab as a space, paragraphs on their own lines. */
const documentText = (xml: string) =>
  xml
    .replace(/<w:br\/>|<w:br [^>]*\/>|<w:tab\/>/g, '<w:t> </w:t>')
    .replace(/<\/w:p>/g, '<w:t>\n</w:t>')
    .match(/<w:t(?: [^>]*)?>[^<]*<\/w:t>/g)!
    .map((tag) => decodeXml(tag.replace(/<[^>]+>/g, '')))
    .join('');
const noSpace = (text: string) => text.replace(/[ \t\r\n]+/g, '');
const count = (text: string, pattern: RegExp) => (text.match(pattern) ?? []).length;
const paragraphs = (xml: string) => xml.match(/<w:p>[\s\S]*?<\/w:p>|<w:p [^>]*>[\s\S]*?<\/w:p>/g) ?? [];
const tables = (xml: string) => {
  // Top-level and nested tables, each with its own XML (nesting is not used, so a simple split is enough).
  return xml.split('<w:tbl>').slice(1).map((part) => part.slice(0, part.indexOf('</w:tbl>')));
};
const allTables = (model: Form26ExportModel) => {
  const out: Extract<Form26ExportBlock, { kind: 'table' }>[] = [];
  const visit = (blocks: Form26ExportBlock[]) => {
    for (const block of blocks) {
      if (block.kind === 'table') out.push(block);
      if (block.kind === 'questions') block.rows.forEach((row) => visit(row.fullWidth ?? []));
      if (block.kind === 'notes') block.items.forEach(visit);
    }
  };
  visit(model.portrait);
  visit(model.landscape);
  return out;
};

describe('buildForm26Docx', () => {
  it('returns a zip (first bytes 50 4B) of the Word type with two sections', async () => {
    const { blob, bytes, document } = await unzip(build(defaultValues(DEF)));
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
    expect(blob.type).toBe(FORM26_DOCX_MIME);
    expect(count(document, /<w:sectPr[ >]/g)).toBe(2);
  });

  it('section 1 is A4 portrait, margins 54 pt top and bottom, 46 pt sides; section 2 A4 landscape, 40 pt and 36 pt', async () => {
    const { document } = await unzip(build(defaultValues(DEF)));
    const sections = document.match(/<w:sectPr[ >][\s\S]*?<\/w:sectPr>/g)!;
    expect(sections).toHaveLength(2);
    // A4 = 595.3 pt x 841.9 pt = 11906 x 16838 twentieths of a point.
    expect(sections[0]).toMatch(/<w:pgSz w:w="11906" w:h="16838" w:orient="portrait"\/>/);
    expect(sections[0]).toMatch(/<w:pgMar w:top="1080" w:right="920" w:bottom="1080" w:left="920"/);
    expect(sections[1]).toMatch(/<w:pgSz w:w="16838" w:h="11906" w:orient="landscape"\/>/);
    expect(sections[1]).toMatch(/<w:pgMar w:top="800" w:right="720" w:bottom="800" w:left="720"/);
    // The first section ends in the last paragraph of the form; the schedules follow on a new page.
    const firstSectionAt = document.indexOf(sections[0]);
    const scheduleHeadingAt = document.indexOf('>Schedule – General Information</w:t>');
    expect(firstSectionAt).toBeGreaterThan(0);
    expect(scheduleHeadingAt).toBeGreaterThan(firstSectionAt);
    expect(sections[1]).toMatch(/<w:type w:val="nextPage"\/>|^(?![\s\S]*w:type)/);
  });

  it('fonts and sizes: Times New Roman 11 pt; headings 15 / 14 / 13 underlined / 13 / 11 pt; tables 10 pt; notes 9.5 pt', async () => {
    const model = build(valuesOf(SAVES.filledCat2));
    const { document, styles } = await unzip(model);
    const defaults = styles.slice(styles.indexOf('<w:docDefaults>'), styles.indexOf('</w:docDefaults>'));
    expect(defaults).toMatch(/<w:rFonts w:ascii="Times New Roman" w:cs="Times New Roman" w:eastAsia="Times New Roman" w:hAnsi="Times New Roman"\/>/);
    expect(defaults).toMatch(/<w:sz w:val="22"\/>/);
    const para = (text: string) => paragraphs(document).find((p) => documentText(p).trim() === text)!;
    const has = (xml: string, ...marks: string[]) => marks.forEach((mark) => expect(xml).toContain(mark));
    const centred = '<w:jc w:val="center"/>';
    has(para('FORM NO. 26'), '<w:pStyle w:val="Heading1"/>', centred, '<w:b/>', '<w:sz w:val="30"/>');
    has(para('PART B'), '<w:pStyle w:val="Heading2"/>', centred, '<w:b/>', '<w:sz w:val="28"/>');
    has(para('Part C: Particulars of the assessee'), '<w:pStyle w:val="Heading2"/>', centred, '<w:sz w:val="28"/>');
    has(para('Schedule – General Information'), '<w:pStyle w:val="Heading3"/>', centred, '<w:u w:val="single"/>', '<w:b/>', '<w:sz w:val="26"/>');
    const section = para('A - General Information');
    has(section, '<w:pStyle w:val="Heading3"/>', '<w:b/>', '<w:sz w:val="26"/>');
    expect(section).not.toContain('<w:u ');
    expect(section).not.toContain(centred);
    has(para('Category of assessee (select one)'), '<w:pStyle w:val="Heading4"/>', '<w:b/>', '<w:sz w:val="22"/>');
    has(para('12. (a) Nature of businesses / professions'), '<w:pStyle w:val="Heading4"/>', '<w:sz w:val="22"/>');
    // A paragraph of the report: the body's 11 pt (no style, no size of its own); the indented ones by 22 px.
    expect(para('(b) Impact of audit qualifications')).not.toMatch(/<w:sz |<w:pStyle /);
    expect(paragraphs(document).find((p) => documentText(p).includes('(c) Subject to above'))).toBeDefined();
    has(paragraphs(document).find((p) => documentText(p).startsWith('(A) I have obtained all the information'))!, '<w:ind w:left="330"/>');
    // Every heading style is black Times New Roman (the package's default blue is not used).
    for (const id of ['Heading1', 'Heading2', 'Heading3', 'Heading4']) {
      const style = styles.slice(styles.indexOf(`w:styleId="${id}"`), styles.indexOf('</w:style>', styles.indexOf(`w:styleId="${id}"`)));
      expect(style).toMatch(/<w:color w:val="000000"\/>/);
      expect(style).toMatch(/<w:rFonts w:ascii="Times New Roman"/);
    }
    // Table text 10 pt: every paragraph of a bordered table is in the table style (10 pt); only the small labels
    // inside answers (9.5 pt) carry a size of their own.
    const styleOf = (id: string) => styles.slice(styles.indexOf(`w:styleId="${id}"`), styles.indexOf('</w:style>', styles.indexOf(`w:styleId="${id}"`)));
    expect(styleOf('Form26Cell')).toContain('<w:sz w:val="20"/>');
    expect(styleOf('Form26Note')).toContain('<w:sz w:val="19"/>');
    const tableParagraphs = tables(document).filter((xml) => xml.includes('w:val="single"')).flatMap(paragraphs);
    expect(tableParagraphs.length).toBeGreaterThan(1000);
    expect(tableParagraphs.every((p) => p.includes('<w:pStyle w:val="Form26Cell"/>'))).toBe(true);
    expect(tableParagraphs.flatMap((p) => p.match(/<w:sz w:val="\d+"\/>/g) ?? []).every((sz) => sz === '<w:sz w:val="19"/>')).toBe(true);
    // Notes 9.5 pt, numbered.
    const note = para('This report has to be signed by an accountant as per section 515(3)(b).');
    expect(note).toMatch(/<w:numPr>/);
    expect(note).toContain('<w:pStyle w:val="Form26Note"/>');
    // Part B has 5 notes and Part D 10 (category (ii): Part A is not in the export).
    expect(paragraphs(document).filter((p) => p.includes('<w:numPr>')).length).toBe(5 + 10);
    // No draft notice (owner, 22 Nov 2026): the document opens with the form itself.
    expect(documentText(paragraphs(document)[0]).trim()).toBe('FORM NO. 26');
    expect(documentText(document)).not.toMatch(/Draft review note|Draft prepared in ICAI VERA/);
  });

  it('table headings shaded EEEEEE (only the th cells), borders single on every table of the form, none round the signature', async () => {
    const model = build(valuesOf(SAVES.filledCat2));
    const { document } = await unzip(model);
    const thCells = allTables(model).reduce((n, table) => n + table.head.flat().filter((cell) => cell.tag === 'th').length, 0);
    expect(count(document, /<w:shd w:fill="EEEEEE" w:color="auto" w:val="clear"\/>/g)).toBe(thCells);
    const xml = tables(document);
    const bordered = xml.filter((t) => /<w:tblBorders><w:top w:val="single" w:color="000000" w:sz="4" w:space="0"\/>/.test(t));
    const borderless = xml.filter((t) => /<w:tblBorders><w:top w:val="none"/.test(t));
    const questionBlocks = model.portrait.filter((block) => block.kind === 'questions').length;
    expect(bordered.length).toBeGreaterThanOrEqual(allTables(model).length + questionBlocks);
    expect(borderless).toHaveLength(model.portrait.filter((block) => block.kind === 'signature').length);
    for (const t of bordered) expect(t).toMatch(/<w:insideH w:val="single"[\s\S]*<w:insideV w:val="single"/);
    // Two tables never touch (Word would show them as one table).
    expect(document).not.toContain('</w:tbl><w:tbl>');
    // Header rows repeat on every page.
    expect(count(document, /<w:tblHeader\/>/g)).toBeGreaterThanOrEqual(allTables(model).filter((t) => t.head.length > 0).length);
  });

  it('underlined answers of Parts A and B, ☑ / ☐ marks, dates dd/mm/yyyy and long text lines are in the document', async () => {
    const { document } = await unzip(build(valuesOf(SAVES.filledCat2)));
    const balanceSheet = paragraphs(document).find((p) => documentText(p).includes('1. I have examined the balance sheet as on'))!;
    expect(balanceSheet).toMatch(/<w:u w:val="single"\/>[\s\S]*?<w:t[^>]*>15\/04\/2026<\/w:t>/);
    expect(documentText(document)).toContain('☑');
    expect(documentText(document)).toContain('☐');
    const obs = paragraphs(document).find((p) => documentText(p).includes('Invented line one B.obs'))!;
    expect(obs).toMatch(/Invented line one B\.obs<\/w:t><\/w:r><w:r>(?:<w:rPr>[\s\S]*?<\/w:rPr>)?<w:br\/>/);
    // In an answer each option of a group and each "If yes, …" line stands on its own line.
    const q9 = paragraphs(document).find((p) => documentText(p).includes('total sales, turnover or gross receipts'))!;
    expect(count(q9, /<w:br\/>/g)).toBe(3);
    const c11b = paragraphs(document).find((p) => documentText(p).replace(/\s+/g, ' ').trim() === 'Yes If yes, refer Schedule – General Information')!;
    expect(c11b).toMatch(/>Yes<\/w:t><\/w:r><w:r><w:br\/><\/w:r>/);
  });

  for (const name of ['default', 'filledCat2', 'filledCat1'] as const) {
    it(`its text equals the model's text (${name})`, async () => {
      const model = build(valuesOf(SAVES[name]));
      const { document } = await unzip(model);
      const text = exportModelText(model);
      expect(noSpace(documentText(document))).toBe(noSpace(text.portrait + text.landscape));
    });
  }

  it('the package carries the title, no draft notice, no author', async () => {
    const { core } = await unzip(build(defaultValues(DEF)));
    expect(core).toContain('<dc:title>Form No. 26</dc:title>');
    expect(core).not.toMatch(/Draft review note|Draft prepared in ICAI VERA|<dc:description>/);
    expect(core).not.toMatch(/<dc:creator>[^<]+<\/dc:creator>/);
  });

  it('250 rows in every add/delete table: written in reasonable time, every row in the document', async () => {
    const values = valuesOf(SAVES.filledCat2);
    for (const table of DEF.tables) {
      if (table.kind !== 'rows') continue;
      const row = values.t[table.id]?.[0] ?? {};
      values.t[table.id] = Array.from({ length: 250 }, (_, i) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, `${value} n${i + 1}`])));
    }
    const model = build(values);
    const started = performance.now();
    const blob = await buildForm26Docx(model);
    const ms = performance.now() - started;
    const zip = await JSZip.loadAsync(new Uint8Array(await blob.arrayBuffer()));
    const document = await zip.file('word/document.xml')!.async('string');
    console.info(`[T21] Word, 250 rows per table: ${ms.toFixed(0)} ms to build, .docx ${(blob.size / 1e6).toFixed(1)} MB, document.xml ${(document.length / 1e6).toFixed(1)} MB`);
    const text = documentText(document);
    for (let i = 1; i <= 250; i += 1) expect(text).toContain(`Invented S29 r1 c1 n${i}`);
    expect(ms).toBeLessThan(60000);
  }, 120000);
});

describe('saving', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('the file name is the file stem with .docx; nothing here downloads through a link (FIX-T29: the screen saves through the save window)', async () => {
    const model = build(valuesOf(SAVES.filledCat2));
    expect(form26DocxFileName(model)).toBe('Form26_AAAAA0000A.docx');
    const word = await import('@/lib/taxAuditForm26Word');
    expect(Object.keys(word)).not.toContain('saveForm26Docx');
    expect(Object.keys(word)).not.toContain('downloadForm26Blob');
  });
});
