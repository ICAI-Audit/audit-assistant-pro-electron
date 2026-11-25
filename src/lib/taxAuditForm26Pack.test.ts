import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { FORM26_CLAUSE_UNITS } from '@/data/taxAuditForm26Clauses';
import { FORM26_DEFINITION as DEF } from '@/data/taxAuditForm26Definition';
import { FORM26_MAPPING, shownEntry } from '@/data/taxAuditForm26Mapping';
import { buildForm26ExportModel, exportModelText } from '@/lib/taxAuditForm26ExportModel';
import { buildForm26Pack, buildForm26PackDocx, form26PackFileName, form26PackLines, form26StampTime, type Form26PackInput } from '@/lib/taxAuditForm26Pack';
import { seedRows } from '@/lib/taxAuditForm26Storage';
import type { Form26ClauseRow } from '@/lib/taxAuditForm26Store';
import type { Form26Values } from '@/lib/taxAuditForm26Values';

const fixture = (name: string) => readFileSync(new URL(`./__fixtures__/taxAuditForm26/${name}`, import.meta.url), 'utf8');
type SaveObject = { f: Record<string, string>; t: Form26Values['t'] };
const SAVES = JSON.parse(fixture('word-values.json')) as Record<'default' | 'filledCat2' | 'filledCat1', SaveObject>;
const values = JSON.parse(JSON.stringify({ f: SAVES.filledCat2.f, t: SAVES.filledCat2.t })) as Form26Values;

const PREPARED_AT = '2026-11-22T05:00:00.000Z';
const APPROVED_AT = '2026-11-22T06:15:00.000Z';
const REMARK = 'Invented review remark for clause 28: penalty order seen.';
const QUALIFICATION = 'Invented qualification: depreciation schedule not produced.';

function input(): Form26PackInput {
  const rowsByKey = new Map<string, Form26ClauseRow>(
    seedRows(DEF, 'audit-1', values, []).map((row, i) => {
      const extra: Partial<Form26ClauseRow> =
        row.clause_key === 'f26_c28'
          ? { review_status: 'approved', locked: 1, prepared_by: 'user-1', prepared_at: PREPARED_AT, reviewed_by: 'user-2', reviewed_at: PREPARED_AT, approved_by: 'user-2', approved_at: APPROVED_AT, auditor_remarks_html: `<p>${REMARK}</p>` }
          : row.clause_key === 'f26_c14'
            ? { review_status: 'prepared', prepared_by: 'user-1', prepared_at: PREPARED_AT, qualification_required: 1, qualification_text_html: `<p>${QUALIFICATION}</p>` }
            : {};
      return [row.clause_key, { ...row, id: `row-${row.clause_key}`, ...extra } as unknown as Form26ClauseRow];
    }),
  );
  return {
    def: DEF,
    values,
    rowsByKey,
    evidence: [{ id: 'link-1', tax_audit_id: 'audit-1', clause_response_id: 'row-f26_c28', clause_key: 'f26_c28', evidence_file_id: 'file-1', workpaper_ref: 'TA-F26-28', linked_at: PREPARED_AT }],
    files: [{ id: 'file-1', name: 'Invented penalty order.pdf' }],
    users: { 'user-1': 'Invented Preparer', 'user-2': 'Invented Partner' },
    clientName: 'Invented Traders Private Limited',
    financialYear: '2026-27',
    generatedAt: APPROVED_AT,
  };
}

async function docxText(blob: Blob): Promise<string> {
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const xml = await zip.file('word/document.xml')!.async('string');
  return xml
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

describe('buildForm26Pack', () => {
  const pack = buildForm26Pack(input());
  const text = form26PackLines(pack).join('\n');

  it('a title block: title, client, year, generation time; no draft notice (owner, 22 Nov 2026)', () => {
    const lines = form26PackLines(pack);
    expect(lines.slice(0, 5)).toEqual([
      'Form No. 26: working papers',
      'Client: Invented Traders Private Limited',
      'Tax year: 2026-27',
      `Generated: ${form26StampTime(APPROVED_AT)}`,
      'Index',
    ]);
    expect(Object.keys(pack)).not.toContain('draftNotice');
  });

  it('57 clause headings in form order, each with its working-paper reference and state', () => {
    expect(pack.clauses.map((clause) => clause.key)).toEqual(FORM26_CLAUSE_UNITS.map((unit) => unit.key));
    expect(pack.clauses).toHaveLength(57);
    const c28 = pack.clauses.find((clause) => clause.key === 'f26_c28')!;
    expect(c28.heading).toBe('Clause 28 · ' + FORM26_CLAUSE_UNITS.find((unit) => unit.key === 'f26_c28')!.label);
    expect(c28.reference).toBe('TA-F26-28');
    expect(c28.state).toBe('Approved');
    expect(c28.stamps).toEqual([
      `Prepared by Invented Preparer on ${form26StampTime(PREPARED_AT)}`,
      `Reviewed by Invented Partner on ${form26StampTime(PREPARED_AT)}`,
      `Approved by Invented Partner on ${form26StampTime(APPROVED_AT)}`,
    ]);
    expect(pack.index).toHaveLength(57);
    expect(pack.index.find((entry) => entry.no === '28')).toMatchObject({ state: 'Approved' });
  });

  it('answers as text with the form’s wording, schedule tables with their rows and totals', () => {
    const c28 = pack.clauses.find((clause) => clause.key === 'f26_c28')!;
    expect(c28.answers.length).toBeGreaterThan(0);
    // "Yes", then "If yes, refer Schedule …" on its own line, as the export prints it.
    expect(c28.answers[0].answer.split(/\n/)[0]).toBe('Yes');
    expect(c28.answers[0].wording.length).toBeGreaterThan(20);
    expect(c28.tables).toHaveLength(1);
    expect(c28.tables[0].table.id).toBe('S28');
    expect(c28.tables[0].table.body).toHaveLength(values.t.S28.length);
    expect(c28.tables[0].table.total?.[0]).toBe('Total');
    // The category, a unit without question rows: its answer by its label.
    const category = pack.clauses.find((clause) => clause.key === 'f26_category')!;
    expect(category.answers.length).toBe(1);
    expect(category.answers[0].answer).toContain('(ii)');
    // Part B's answers sit in its report text: each is named by the words beside it, not by the whole Part
    // (seen in Word: one cell held the Part's text with "[B.bs]" marks).
    const partB = pack.clauses.find((clause) => clause.key === 'f26_part_b')!;
    expect(partB.answers.length).toBeGreaterThan(10);
    for (const answer of partB.answers) {
      expect(answer.wording).not.toMatch(/\[B\./);
      expect(answer.wording.length).toBeLessThan(300);
    }
    expect(pack.index[0]).toMatchObject({ title: 'Category of assessee', label: '' });
    // Part A is not part of a category (ii) report.
    expect(pack.clauses.find((clause) => clause.key === 'f26_part_a')!.note).toBe('Not part of the report for category (ii).');
  });

  it('names the evidence file with its reference; review remarks and the qualification as plain text', () => {
    expect(pack.clauses.find((clause) => clause.key === 'f26_c28')!.evidence).toEqual(['Invented penalty order.pdf (TA-F26-28)']);
    expect(text).toContain(REMARK);
    expect(text).toContain(QUALIFICATION);
    expect(text).not.toContain('<p>');
  });

  it('contains no draft notice and no text of the mapping', () => {
    expect(text).not.toMatch(/Draft review note|Draft prepared in ICAI VERA/);
    expect(text).not.toContain('Was Form 3CD');
    expect(text).not.toContain('AuditPro');
    for (const row of FORM26_MAPPING) {
      const entry = shownEntry(row);
      if (entry.whatChanged.length > 40) expect(text).not.toContain(entry.whatChanged);
    }
  });

  it('review remarks and the qualification never enter the Form No. 26 exports (L9)', () => {
    const exported = exportModelText(buildForm26ExportModel(DEF, values, { showAllSchedules: false, generatedAt: APPROVED_AT }));
    expect(exported.portrait + exported.landscape).not.toContain(REMARK);
    expect(exported.portrait + exported.landscape).not.toContain(QUALIFICATION);
  });

  it('the file name is <stem>_working-papers.docx', () => {
    expect(form26PackFileName(pack)).toBe('Form26_AAAAA0000A_working-papers.docx');
  });
});

describe('buildForm26PackDocx', () => {
  it('a Word file (50 4B) whose text is the pack: headings, answers, a table value, evidence, remarks, qualification; no draft notice', async () => {
    const pack = buildForm26Pack(input());
    const blob = await buildForm26PackDocx(pack);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect([bytes[0], bytes[1]]).toEqual([0x50, 0x4b]);
    const text = await docxText(blob);
    for (const line of [
      'Form No. 26: working papers',
      pack.clauses.find((clause) => clause.key === 'f26_c28')!.heading,
      `Approved by Invented Partner on ${form26StampTime(APPROVED_AT)}`,
      'Invented penalty order.pdf (TA-F26-28)',
      REMARK,
      QUALIFICATION,
      values.t.S28[0]['1'],
    ]) expect(text).toContain(line);
    // Every clause heading is a Word heading (the navigation pane lists them).
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const xml = await zip.file('word/document.xml')!.async('string');
    expect((xml.match(/<w:pStyle w:val="Heading2"\/>/g) ?? []).length).toBe(57 + 1);
    expect(text).not.toContain('AuditPro');
    expect(text).not.toMatch(/Draft review note|Draft prepared in ICAI VERA/);
    expect(await zip.file('docProps/core.xml')!.async('string')).not.toMatch(/Draft prepared in ICAI VERA|<dc:description>/);
  }, 30000);
});
