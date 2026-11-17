import { describe, expect, it, vi } from 'vitest';
import { solidPng } from '@/lib/pdf-tools/testMarksPdf';
import { makePdf, pageTexts } from '@/lib/pdf-tools/testPdf';
import { addWatermark, watermarkError, WATERMARK_DEFAULTS, type WatermarkOptions } from '@/lib/pdf-tools/watermark';
import { buildActivityEntry, STAMP_CHOICES, WATERMARK_CHOICES } from '@/lib/pdf-tools/activity';
import type { WorkingFile } from '@/lib/pdf-tools/types';

vi.setConfig({ testTimeout: 60_000 });
import { loadCharacterCheck } from './markText';
import {
  choosePlace,
  chosenPages,
  defaultWatermarkForm,
  logoSummary,
  markRunLabel,
  placementOf,
  stampSummary,
  watermarkSummary,
  presetOf,
  presetText,
  readWatermarkForm,
  STAMP_PRESETS,
  WATERMARK_PRESETS,
  watermarkPreviewOptions,
  watermarkRecord,
  watermarkResultName,
  type WatermarkForm,
  type WatermarkReadContext,
} from './watermarkForm';

const tokens = { date: '14-11-2026', client: 'ABC Ltd' };
const logo = { image: solidPng(40, 20, [0, 0, 255]), format: 'png' as const };
const ctx = (over: Partial<WatermarkReadContext> = {}): WatermarkReadContext => ({ pageCount: 12, check: null, tokens, logo: null, logoState: 'none', ...over });
const form = (over: Partial<WatermarkForm> = {}): WatermarkForm => ({ ...defaultWatermarkForm(12), ...over });

describe('defaults (design 5.16)', () => {
  it('starts with the watermark on: DRAFT, Helvetica bold, auto size, diagonal, centre, grey, 25%, in front, every page', () => {
    const read = readWatermarkForm(form(), ctx());
    expect(read.errors).toEqual({});
    const o = read.options!;
    expect(o.stamp).toBeUndefined();
    expect(o.logo).toBeUndefined();
    expect(o.pages).toEqual({ from: 1, to: 12 });
    expect(o.tokens).toEqual(tokens);
    const w = o.watermark!;
    expect({ ...w, color: undefined, placement: undefined }).toEqual({ ...WATERMARK_DEFAULTS.watermark, color: undefined, placement: undefined });
    expect(w.placement).toEqual({ anchor: 'center', padPt: 20 });
    expect(w.color.r).toBeCloseTo(0.5, 2);
  });

  it('gives the stamp and the logo their defaults when switched on', () => {
    const read = readWatermarkForm(form({ watermarkOn: false, stampOn: true, logoOn: true, logoId: 'L' }), ctx({ logo, logoState: 'ready' }));
    expect(read.errors).toEqual({});
    const { stamp, logo: l } = read.options!;
    expect(stamp).toMatchObject({ text: 'VERIFIED', size: 20, bold: true, opacity: 0.78, angle: 0, placement: { anchor: 'top-right', padPt: 20 } });
    expect(stamp!.color.r).toBeCloseTo(0.627, 3);
    expect(l).toEqual({ image: logo.image, format: 'png', widthShare: 0.18, opacity: 1, placement: { anchor: 'top-left', padPt: 20 } });
  });
});

/** The library's own check on options built from the form's raw values. */
const library = (opts: Partial<WatermarkOptions>, pageCount = 12) => watermarkError({ pages: { from: 1, to: pageCount }, tokens, ...opts }, pageCount);
const wm = (over: Partial<NonNullable<WatermarkOptions['watermark']>>): NonNullable<WatermarkOptions['watermark']> => ({ ...WATERMARK_DEFAULTS.watermark, placement: { anchor: 'center', padPt: 20 }, ...over });
const st = (over: Partial<NonNullable<WatermarkOptions['stamp']>>): NonNullable<WatermarkOptions['stamp']> => ({ ...WATERMARK_DEFAULTS.stamp, placement: { anchor: 'top-right', padPt: 20 }, text: 'PAID', ...over });

describe('field checks, in the words of the library', () => {
  const cases: [string, Partial<WatermarkForm>, string, string][] = [
    ['nothing on', { watermarkOn: false }, 'parts', library({ watermark: undefined })!],
    ['text too long', { text: 'x'.repeat(61) }, 'text', library({ watermark: wm({ text: 'x'.repeat(61) }) })!],
    ['unknown token', { text: 'COPY {page}' }, 'text', library({ watermark: wm({ text: 'COPY {page}' }) })!],
    ['custom angle too steep', { angleMode: 'custom', angle: '-91' }, 'angle', library({ watermark: wm({ angle: -91 }) })!],
    ['opacity too faint', { opacity: '4' }, 'opacity', library({ watermark: wm({ opacity: 0.04 }) })!],
    ['bad colour', { color: 'grey' }, 'color', library({ watermark: wm({ color: { r: -1, g: 0, b: 0 } }) })!],
    // The point is typed as well as clicked: the words serve both (review S2), not the library's "Click inside…".
    ['point not chosen', { place: { anchor: 'point', x: '', y: '' } }, 'place', 'Enter a point from 0 to 100% across and down for the watermark, or click the preview.'],
    ['point off the page', { place: { anchor: 'point', x: '101', y: '5' } }, 'place', 'Enter a point from 0 to 100% across and down for the watermark, or click the preview.'],
    ['range backwards', { pages: 'range', from: '5', to: '3' }, 'pages', library({ watermark: wm({}), pages: { from: 5, to: 3 } })!],
    ['range past the end', { pages: 'range', from: '1', to: '13' }, 'pages', library({ watermark: wm({}), pages: { from: 1, to: 13 } })!],
    ['stamp text empty', { stampOn: true, stampText: ' ' }, 'stampText', library({ stamp: st({ text: ' ' }) })!],
    ['stamp angle', { stampOn: true, stampAngle: '95' }, 'stampAngle', library({ stamp: st({ angle: 95 }) })!],
    ['stamp opacity', { stampOn: true, stampOpacity: '101' }, 'stampOpacity', library({ stamp: st({ opacity: 1.01 }) })!],
    ['stamp token', { stampOn: true, stampText: 'PAID {fy}' }, 'stampText', library({ stamp: st({ text: 'PAID {fy}' }) })!],
  ];
  for (const [name, over, field, message] of cases) {
    it(name, () => {
      const read = readWatermarkForm(form(over), ctx());
      expect(read.options).toBeNull();
      expect(read.errors[field as keyof typeof read.errors]).toBe(message);
      expect(read.first).toBe(message);
    });
  }

  it('asks for a logo, and checks its width and opacity', () => {
    expect(readWatermarkForm(form({ logoOn: true }), ctx()).errors.logo).toBe(library({ logo: { image: new Uint8Array(), format: 'png', widthShare: 0.18, opacity: 1, placement: { anchor: 'top-left', padPt: 20 } } }));
    const ready = ctx({ logo, logoState: 'ready' });
    expect(readWatermarkForm(form({ logoOn: true, logoId: 'L', logoWidth: '51' }), ready).errors.logoWidth).toBe(
      library({ logo: { ...logo, widthShare: 0.51, opacity: 1, placement: { anchor: 'top-left', padPt: 20 } } }),
    );
    expect(readWatermarkForm(form({ logoOn: true, logoId: 'L', logoOpacity: '9' }), ready).errors.logoOpacity).toBe(
      library({ logo: { ...logo, widthShare: 0.18, opacity: 0.09, placement: { anchor: 'top-left', padPt: 20 } } }),
    );
  });

  it('waits, without an error, while the logo is being made ready, and shows why it could not be', () => {
    const waiting = readWatermarkForm(form({ logoOn: true, logoId: 'L' }), ctx({ logoState: 'preparing' }));
    expect(waiting).toMatchObject({ options: null, waiting: true, first: null, errors: {} });
    const failed = readWatermarkForm(form({ logoOn: true, logoId: 'L' }), ctx({ logoState: { error: 'This image could not be read. It may be damaged.' } }));
    expect(failed.errors.logo).toBe('This image could not be read. It may be damaged.');
  });

  it('refuses a rupee sign as the user types, in the library words, and only fields that are on are checked', async () => {
    const check = await loadCharacterCheck();
    const read = readWatermarkForm(form({ text: 'Rs ₹ 500' }), ctx({ check }));
    expect(read.errors.text).toContain('“₹” cannot be printed in the watermark text');
    expect(read.errors.text).toContain('(write Rs. for ₹).');
    expect(readWatermarkForm(form({ text: 'Rs ₹ 500', watermarkOn: false, stampOn: true }), ctx({ check })).errors).toEqual({});
  });

  it('accepts angles and sizes at their limits, decimals included', () => {
    for (const over of [{ angleMode: 'custom', angle: '-90' }, { angleMode: 'custom', angle: '90' }, { sizeMode: 'other', sizeMm: '3' }, { sizeMode: 'other', sizeMm: '50' }, { opacity: '5' }, { opacity: '100' }, { angleMode: 'custom', angle: '12.5' }, { stampOn: true, stampSizeMode: 'other', stampSizeMm: '18' }] as Partial<WatermarkForm>[]) {
      expect(readWatermarkForm(form(over), ctx()).errors).toEqual({});
    }
  });

  it('asks for a letter height in mm, never in points', () => {
    for (const sizeMm of ['2', 'big', '51', '']) {
      expect(readWatermarkForm(form({ sizeMode: 'other', sizeMm }), ctx()).errors.size).toBe('Enter a letter height from 3 to 50 mm, or choose Auto.');
    }
    expect(readWatermarkForm(form({ stampOn: true, stampSizeMode: 'other', stampSizeMm: '19' }), ctx()).errors.stampSize).toBe('Enter a letter height from 2 to 18 mm.');
  });
});

describe('mapping to the library', () => {
  it('turns the angle choices into the angles the library draws', () => {
    const angle = (over: Partial<WatermarkForm>) => readWatermarkForm(form(over), ctx()).options!.watermark!.angle;
    expect(angle({ angleMode: 'diagonal' })).toBe('diagonal');
    expect(angle({ angleMode: 'horizontal' })).toBe(0);
    expect(angle({ angleMode: 'vertical' })).toBe(90);
    expect(angle({ angleMode: 'custom', angle: '-30' })).toBe(-30);
  });

  it('choosing "A point on the page" starts at the middle (50% across, 50% down), so it is never an error at once (REV-B minor 8)', () => {
    const centre = { anchor: 'center' as const, x: '', y: '' };
    expect(choosePlace(centre, 'point')).toEqual({ anchor: 'point', x: '50', y: '50' });
    expect(readWatermarkForm(form({ place: choosePlace(centre, 'point') }), ctx()).errors).toEqual({});
    // a point typed before is kept; an anchor keeps what was typed for the next time
    expect(choosePlace({ anchor: 'top-left', x: '20', y: '80' }, 'point')).toEqual({ anchor: 'point', x: '20', y: '80' });
    expect(choosePlace({ anchor: 'point', x: '20', y: '80' }, 'bottom-right')).toEqual({ anchor: 'bottom-right', x: '20', y: '80' });
  });

  it('places a point given from the top-left as fractions from the bottom-left, and an anchor 20 pt in', () => {
    expect(placementOf({ anchor: 'point', x: '25', y: '10' })).toEqual({ point: { u: 0.25, v: 0.9 } });
    expect(placementOf({ anchor: 'bottom-right', x: '', y: '' })).toEqual({ anchor: 'bottom-right', padPt: 20 });
  });

  it('marks the first page only, or a range', () => {
    expect(readWatermarkForm(form({ pages: 'first' }), ctx()).options!.pages).toBe('first');
    expect(readWatermarkForm(form({ pages: 'range', from: '3', to: '7' }), ctx()).options!.pages).toEqual({ from: 3, to: 7 });
    expect(chosenPages(form({ pages: 'range', from: '3', to: '5' }), 12)).toEqual([3, 4, 5]);
    expect(chosenPages(form({ pages: 'first' }), 12)).toEqual([1]);
    expect(chosenPages(form({ pages: 'range', from: '9', to: '2' }), 12)).toBeNull();
  });

  it('fixed size, italic Times and the stamp colour reach the options', () => {
    const o = readWatermarkForm(form({ sizeMode: 'medium', font: 'times', italic: true, bold: false, stampOn: true, stampColor: '#0000ff', stampSizeMode: 'large' }), ctx()).options!;
    expect(o.watermark).toMatchObject({ size: 72, font: 'times', italic: true, bold: false });
    expect(o.stamp!.color).toEqual({ r: 0, g: 0, b: 1 });
    expect(o.stamp!.size).toBe(32);
  });

  it('turns a letter height typed in mm into the size in points the library draws', () => {
    const o = readWatermarkForm(form({ sizeMode: 'other', sizeMm: '18', stampOn: true, stampSizeMode: 'other', stampSizeMm: '5' }), ctx()).options!;
    expect(o.watermark!.size).toBeCloseTo(71.06, 2);
    expect(o.stamp!.size).toBeCloseTo(19.74, 2);
  });

  it('marks only the previewed page of a one-page copy, with the preview copy of the logo', () => {
    const run = readWatermarkForm(form({ pages: 'range', from: '4', to: '9', logoOn: true, logoId: 'L' }), ctx({ logo, logoState: 'ready' })).options!;
    const small = { image: solidPng(4, 2, [0, 0, 255]), format: 'png' as const };
    const preview = watermarkPreviewOptions(run, small);
    expect(preview.pages).toEqual({ from: 1, to: 1 });
    expect(preview.logo!.image).toBe(small.image);
    expect(preview.watermark).toEqual(run.watermark);
  });
});

describe('presets', () => {
  it('puts the {client} token for the client preset, never the name, and recognises typed text', () => {
    expect(presetText('client', 'ABC Ltd')).toBe('{client}');
    expect(presetText('not-for-circulation', '')).toBe('NOT FOR CIRCULATION');
    expect(presetOf('CONFIDENTIAL', 'ABC Ltd', 'watermark')).toBe('confidential');
    expect(presetOf('{client}', 'ABC Ltd', 'watermark')).toBe('client');
    expect(presetOf('{Client}', 'ABC Ltd', 'watermark')).toBe('client');
    expect(presetOf('ABC Ltd', 'ABC Ltd', 'watermark')).toBe('custom');
    expect(presetOf('Draft copy', 'ABC Ltd', 'watermark')).toBe('custom');
    expect(presetOf('ORIGINAL SEEN', '', 'stamp')).toBe('original-seen');
  });

  it('records the token after the client preset, while the page shows the name (filled only when the PDF is written)', async () => {
    const text = presetText('client', 'ABC Ltd');
    const options = readWatermarkForm(form({ text, preset: 'client', pages: 'range', from: '1', to: '1' }), ctx()).options!;
    const record = watermarkRecord(options, 12);
    expect(record.options.watermark).toBe('{client}');
    expect(record.summary).toBe('Watermark {client}, page 1');
    expect(JSON.stringify(record)).not.toContain('ABC Ltd');
    const page = await addWatermark(await makePdf('P', 1), watermarkPreviewOptions(options, null));
    expect((await pageTexts(page))[0]).toContain('ABC Ltd');
  });
});

describe('what the closed "More options" lines say, and the Run button', () => {
  it('summarises the current values in plain words and millimetres', () => {
    expect(watermarkSummary(form())).toBe('Helvetica bold, auto size, diagonal, grey, 25% opacity, in front, centre');
    expect(watermarkSummary(form({ font: 'times', bold: false, italic: true, sizeMode: 'medium', angleMode: 'custom', angle: '-30', color: '#123456', opacity: '40', layer: 'behind', place: { anchor: 'point', x: '25', y: '10' } }))).toBe(
      'Times italic, medium size (18 mm), -30°, #123456, 40% opacity, behind the page, a point 25% across and 10% down',
    );
    expect(watermarkSummary(form({ sizeMode: 'other', sizeMm: '12' }))).toContain('letters 12 mm tall');
    expect(stampSummary(form())).toBe('Bold, medium size (5 mm), 0°, dark red, 78% opacity, top right');
    expect(logoSummary(form())).toBe('18% of the page width, 100% opacity, top left');
  });

  it('starts with a verb and names what is added and where', () => {
    expect(markRunLabel(form(), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 12)).toBe('Add watermark to 12 pages');
    expect(markRunLabel(form({ watermarkOn: false, stampOn: true, logoOn: true }), [1], 12)).toBe('Add stamp and logo to page 1');
    expect(markRunLabel(form({ stampOn: true, logoOn: true }), [2, 3], 12)).toBe('Add watermark, stamp and logo to 2 pages');
    expect(markRunLabel(form(), [1], 1)).toBe('Add watermark');
    expect(markRunLabel(form({ watermarkOn: false }), [1], 12)).toBe('Add marks');
  });
});

describe('result name and record (design 5.16)', () => {
  it('is _watermarked with a watermark, _stamped with only a stamp or logo', () => {
    expect(watermarkResultName('Ledger.pdf', form())).toBe('Ledger_watermarked.pdf');
    expect(watermarkResultName('Ledger.pdf', form({ watermarkOn: false, stampOn: true }))).toBe('Ledger_stamped.pdf');
    expect(watermarkResultName('Ledger.pdf', form({ watermarkOn: false, logoOn: true }))).toBe('Ledger_stamped.pdf');
    expect(watermarkResultName('Ledger.pdf', form({ stampOn: true }))).toBe('Ledger_watermarked.pdf');
  });

  it('records choices only: custom text by its length and the tokens it uses, the logo by its size in pixels, never a text or a file name (REV-B B1)', () => {
    const o = readWatermarkForm(
      form({ text: 'FOR {client}', stampOn: true, stampText: 'PAID {date}', logoOn: true, logoId: 'L', pages: 'range', from: '1', to: '12', layer: 'behind', opacity: '30' }),
      ctx({ logo, logoState: 'ready' }),
    ).options!;
    const record = watermarkRecord(o, 12);
    expect(record.summary).toBe('Watermark (custom text), stamp (custom text), logo, all pages');
    expect(record.options).toEqual({
      pages: 'all',
      watermark: 'custom',
      watermarkLength: 12,
      watermarkUses: '{client}',
      watermarkFont: 'helvetica bold',
      watermarkSize: 'auto',
      watermarkAngle: 'diagonal',
      watermarkColour: '#808080',
      watermarkOpacity: 30,
      watermarkLayer: 'behind',
      watermarkPosition: 'center',
      stamp: 'custom',
      stampLength: 11,
      stampUses: '{date}',
      stampSize: 20,
      stampAngle: 0,
      stampColour: '#a00000',
      stampOpacity: 78,
      stampPosition: 'top-right',
      logo: true,
      logoPixelWidth: 40,
      logoPixelHeight: 20,
      logoWidth: 18,
      logoOpacity: 100,
      logoPosition: 'top-left',
    });
    // The activity entry keeps every key the record holds (the producer and activity.ts's allow-list agree),
    // and nothing typed, filled in or named reaches it.
    const file: WorkingFile = { id: 'r', name: 'Ledger_watermarked.pdf', kind: 'pdf', mimeType: 'application/pdf', origin: 'result', bytes: new Uint8Array(1), size: 1, pageCount: 12, wasProtected: false, hasRestrictions: false, hasSignature: false, sentTo: [], operation: { tool: 'watermark', sources: [], ...record } };
    const entry = buildActivityEntry({ file, destination: 'computer', sha256: 'ab'.repeat(32) });
    expect(entry.metadata.options).toEqual(record.options);
    for (const typed of ['FOR', 'PAID', 'ABC Ltd', '14-11-2026', 'firm-logo']) expect(JSON.stringify(entry)).not.toContain(typed);
  });

  it('names a ready-made text or a template of tokens as it is, in the record and its summary', () => {
    const o = readWatermarkForm(form({ stampOn: true, stampText: 'VERIFIED', pages: 'first' }), ctx()).options!;
    const record = watermarkRecord(o, 12);
    expect(record.summary).toBe('Watermark DRAFT, stamp VERIFIED, page 1');
    expect(record.options).toMatchObject({ watermark: 'DRAFT', stamp: 'VERIFIED', pages: 'first' });
    expect(record.options).not.toHaveProperty('watermarkLength');
    const template = watermarkRecord(readWatermarkForm(form({ text: '{date} - {client}' }), ctx()).options!, 12);
    expect(template.options.watermark).toBe('{date} - {client}');
    expect(template.summary).toBe('Watermark {date} - {client}, all pages');
    // every ready-made text of the dialog is a choice the activity entry accepts
    expect(WATERMARK_PRESETS.flatMap((p) => (p.text ? [p.text] : [])).every((t) => (WATERMARK_CHOICES as readonly string[]).includes(t))).toBe(true);
    expect(STAMP_PRESETS.flatMap((p) => (p.text ? [p.text] : [])).every((t) => (STAMP_CHOICES as readonly string[]).includes(t))).toBe(true);
  });

  it('writes a point and a page range; a long own text is recorded by its length', () => {
    const long = 'A'.repeat(60);
    const o = readWatermarkForm(form({ text: long, place: { anchor: 'point', x: '25.5', y: '10' }, pages: 'range', from: '2', to: '5' }), ctx()).options!;
    const record = watermarkRecord(o, 12);
    expect(record.options.watermarkPosition).toBe('point 25.5% across, 10% down');
    expect(record.options.pages).toBe('2-5');
    expect(record.options).toMatchObject({ watermark: 'custom', watermarkLength: 60 });
    expect(record.options).not.toHaveProperty('watermarkUses');
    expect(record.summary).toBe('Watermark (custom text), pages 2-5');
  });
});
