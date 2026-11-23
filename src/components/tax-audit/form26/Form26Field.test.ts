import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Form26Field, type Form26FieldProps } from '@/components/tax-audit/form26/Form26Field';
import { FORM26_DEFINITION as DEF } from '@/data/taxAuditForm26Definition';
import { form26ClockTime } from '@/lib/taxAuditForm26EditorModel';
import { expectControlsNamed, expectFinished, expectReferencesResolve, visibleText } from '@/lib/__fixtures__/taxAuditForm26/renderCheck';

// The answer controls drawn without a browser (react-dom/server): markup, names, states and wording.
const fieldOf = (key: string) => {
  const field = DEF.fields.find((entry) => entry.key === key);
  if (!field) throw new Error(`no field ${key}`);
  return field;
};

function draw(key: string, extra: Partial<Form26FieldProps> = {}): string {
  const html = renderToStaticMarkup(
    createElement(Form26Field, { field: fieldOf(key), value: '', locked: false, unfilled: false, highlight: false, onCommit: () => undefined, ...extra }),
  );
  expectFinished(html);
  expectControlsNamed(html);
  return html;
}

describe('Form 26 answer controls (static render)', () => {
  it('yes/no: a select with blank, Yes, No; named by the ids it is given; the chosen answer selected', () => {
    const html = draw('c14d', { value: 'Yes', labelledBy: 'f26-q23-wording' });
    expect(html).toMatch(/<select [^>]*id="f26-f-c14d" aria-labelledby="f26-q23-wording"/);
    expect(html).toMatch(/<option value=""><\/option><option value="Yes" selected="">Yes<\/option><option value="No">No<\/option>/);
    expect(html).not.toContain('aria-label=');
  });

  it('choice: a blank first and the options in the file\'s order', () => {
    const html = draw('C.status');
    const options = [...html.matchAll(/<option value="([^"]*)"/g)].map((match) => match[1]);
    expect(options).toEqual(['', ...(fieldOf('C.status').options ?? [])]);
    expect(options).toHaveLength(11);
  });

  it('radio: a group of options with the file\'s labels word for word, each tied to its button', () => {
    const html = draw('q9', { value: '1', labelledBy: 'f26-q8-wording' });
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('aria-labelledby="f26-q8-wording"');
    expect(html.match(/role="radio"/g)).toHaveLength(4);
    for (const option of fieldOf('q9').radioOptions ?? []) expect(visibleText(html)).toContain(option.label);
    expect(html).toMatch(/id="f26-f-q9-o0"[^>]*>/);
    expect(html).toContain('for="f26-f-q9-o0"');
    expectReferencesResolve(html.replace(/aria-labelledby="f26-q8-wording"/, ''));
    expect(visibleText(draw('cat', { value: '2' }))).toContain(fieldOf('cat').radioOptions?.[1].label ?? 'missing');
  });

  it('text: placeholder and length from the definition; the PAN box shows capitals (the value is kept as typed)', () => {
    const pan = draw('C.pan', { value: 'aaaaa0000a' });
    expect(pan).toContain('maxLength="10"');
    expect(pan).toContain('value="aaaaa0000a"');
    expect(pan).toMatch(/class="[^"]*\buppercase\b/);
    expect(draw('C.ty')).toContain('placeholder="e.g. 2026-27"');
    expect(draw('A.assessee')).toContain('placeholder="name of assessee"');
  });

  it('long text, date, amount and e-mail: the right control for each', () => {
    expect(draw('c13')).toMatch(/<textarea[^>]*rows="3"/);
    expect(draw('A.date')).toContain('type="date"');
    const amount = draw('c24_amt', { value: '1234.5' });
    expect(amount).toContain('type="number"');
    expect(amount).toContain('step="any"');
    expect(amount).toContain('inputMode="decimal"');
    expect(amount).toMatch(/class="[^"]*text-right[^"]*tabular-nums/);
    expect(draw('C.email')).toContain('type="email"');
  });

  it('a control without given ids is named by the words beside it in the form', () => {
    expect(draw('A.assessee')).toContain('aria-label="1. I report that the statutory audit of"');
    expect(draw('B.br')).toContain('aria-label="and branches (total number of branches)."');
  });

  it('locked: read-only boxes, disabled choices, no unfilled mark, still readable', () => {
    const text = draw('c14b', { value: 'Invented Books', locked: true, unfilled: true, highlight: true });
    expect(text).toContain('readonly=""');
    expect(text).not.toContain('Not filled yet.');
    expect(text).not.toContain('bg-warning-soft');
    expect(draw('c14d', { value: 'No', locked: true })).toContain('disabled=""');
    expect(draw('q9', { value: '1', locked: true })).toContain('data-disabled=""');
  });

  it('unfilled: a hint for screen readers always; with "Highlight unfilled" the soft warning tint and a dashed edge (not colour alone)', () => {
    const quiet = draw('c14b', { unfilled: true });
    expect(quiet).toContain('aria-describedby="f26-f-c14b-hint"');
    expect(visibleText(quiet)).toContain('Not filled yet.');
    expect(quiet).not.toContain('bg-warning-soft');
    expect(quiet).toContain('data-unfilled="true"');
    const tinted = draw('c14b', { unfilled: true, highlight: true });
    expect(tinted).toMatch(/class="[^"]*border-dashed[^"]*bg-warning-soft/);
    expectReferencesResolve(tinted);
    // No red in an untouched form.
    expect(tinted).not.toMatch(/destructive|danger/);
  });

  it('changed by someone else: the line under the answer with its time, "Keep mine" and "Use theirs", announced', () => {
    const html = draw('c14b', { value: 'Mine', conflict: { theirs: 'Theirs', at: '2026-11-22 10:42:05' } });
    const time = form26ClockTime('2026-11-22 10:42:05');
    expect(html).toContain('role="status"');
    expect(visibleText(html)).toContain(`Changed by someone else at ${time}. Keep mine Use theirs`);
    expect(html).toContain('aria-describedby="f26-f-c14b-line"');
    expectReferencesResolve(html);
  });

  it('save failed after approval: the answer says its entry was not saved and offers only the stored entry', () => {
    const html = draw('c14b', { value: 'Mine', locked: true, conflict: { theirs: 'Theirs', at: '2026-11-22 10:42:05' } });
    expect(visibleText(html)).toContain('This clause was approved while you were typing. Your entry was not saved. Use theirs');
    expect(visibleText(html)).not.toContain('Keep mine');
  });

  it('where a value came from: a quiet chip, "Confirm" for a value brought from the 3CD draft; the line is kept even when empty', () => {
    expect(visibleText(draw('C.name', { value: 'Invented Traders Private Limited', provenance: 'client-master' }))).toContain('From client master');
    const brought = draw('c14b', { value: 'Invented Books', provenance: 'brought-from-3cd' });
    expect(visibleText(brought)).toContain('Brought from the 3CD draft Confirm');
    const reserved = draw('C.name', { provenance: null });
    expect(reserved).toMatch(/<span class="flex min-h-5/);
    expect(draw('C.name')).not.toContain('min-h-5');
  });

  it('the value stays what was typed: no grouping, no rounding in the box', () => {
    expect(draw('c24_amt', { value: '1234567.891' })).toContain('value="1234567.891"');
  });
});
