// The Watermark dialog's fields as plain data (design 5.16): defaults, presets, the checks made as
// the user types (in the words of watermark.ts, which checks the same things again when it runs),
// the options handed to the library, the result name and the record. No React here.
import { CUSTOM_TEXT, MARK_TEXT_TOKENS, typedTextRecord } from '@/lib/pdf-tools/activity';
import type { DateFormat } from '@/lib/pdf-tools/pageNumbers';
import { defaultResultName } from '@/lib/pdf-tools/resultNames';
import { describeWatermark, WATERMARK_DEFAULTS, type Anchor, type FontFamily, type Placement, type WatermarkOptions } from '@/lib/pdf-tools/watermark';
import { hexToRgb, rgbToHex } from '../toolOptions';
import { inspectLogo } from './logoIntake';
import { markTextError, type CharacterCheck } from './markText';
import { colourName, letterMm, MM_LIMITS, mmText, ptForLetter, readMm, STAMP_SIZES, WATERMARK_SIZES } from './units';

/** Stamp and logo sit 20 pt in from the edges (design 5.16); the watermark at an edge anchor does too. */
export const MARK_PAD_PT = 20;

export const WATERMARK_PRESETS = [
  { id: 'draft', label: 'DRAFT', text: 'DRAFT' },
  { id: 'confidential', label: 'CONFIDENTIAL', text: 'CONFIDENTIAL' },
  { id: 'copy', label: 'COPY', text: 'COPY' },
  { id: 'for-audit-use-only', label: 'FOR AUDIT USE ONLY', text: 'FOR AUDIT USE ONLY' },
  { id: 'not-for-circulation', label: 'NOT FOR CIRCULATION', text: 'NOT FOR CIRCULATION' },
  { id: 'client', label: 'Client name', text: null },
  { id: 'custom', label: 'Your own text', text: null },
] as const;
export type WatermarkPresetId = (typeof WATERMARK_PRESETS)[number]['id'];

export const STAMP_PRESETS = [
  { id: 'verified', label: 'VERIFIED', text: 'VERIFIED' },
  { id: 'received', label: 'RECEIVED', text: 'RECEIVED' },
  { id: 'checked', label: 'CHECKED', text: 'CHECKED' },
  { id: 'paid', label: 'PAID', text: 'PAID' },
  { id: 'original-seen', label: 'ORIGINAL SEEN', text: 'ORIGINAL SEEN' },
  { id: 'custom', label: 'Your own text', text: null },
] as const;
export type StampPresetId = (typeof STAMP_PRESETS)[number]['id'];

export const MARK_LIMITS = {
  watermarkSize: { min: 12, max: 200 },
  angle: { min: -90, max: 90 },
  opacity: { min: 5, max: 100 },
  stampSize: { min: 8, max: 72 },
  logoWidth: { min: 5, max: 50 },
  logoOpacity: { min: 10, max: 100 },
} as const;

export const ANCHOR_NAMES: Record<Anchor, string> = {
  'top-left': 'Top left',
  'top-center': 'Top centre',
  'top-right': 'Top right',
  'middle-left': 'Middle left',
  center: 'Centre',
  'middle-right': 'Middle right',
  'bottom-left': 'Bottom left',
  'bottom-center': 'Bottom centre',
  'bottom-right': 'Bottom right',
};

export type PlaceChoice = Anchor | 'point';
/** Where a mark goes: an anchor, or a point given in percent from the left and from the top of the page as displayed. */
export interface PlaceForm {
  anchor: PlaceChoice;
  x: string;
  y: string;
}

export interface WatermarkForm {
  watermarkOn: boolean;
  preset: WatermarkPresetId;
  text: string;
  font: FontFamily;
  bold: boolean;
  italic: boolean;
  /** Auto (fits each page), a preset, or a letter height typed in mm. */
  sizeMode: 'auto' | 'small' | 'medium' | 'large' | 'other';
  sizeMm: string;
  angleMode: 'diagonal' | 'horizontal' | 'vertical' | 'custom';
  angle: string;
  place: PlaceForm;
  /** #rrggbb */
  color: string;
  /** Percent. */
  opacity: string;
  layer: 'front' | 'behind';

  stampOn: boolean;
  stampPreset: StampPresetId;
  stampText: string;
  stampSizeMode: 'small' | 'medium' | 'large' | 'other';
  /** Letter height in mm, when `stampSizeMode` is 'other'. */
  stampSizeMm: string;
  stampBold: boolean;
  stampColor: string;
  stampOpacity: string;
  stampAngle: string;
  stampPlace: PlaceForm;

  logoOn: boolean;
  /** The working-list image chosen; never remembered after the dialog closes. */
  logoId: string | null;
  /** Percent of the page's displayed width. */
  logoWidth: string;
  logoOpacity: string;
  logoPlace: PlaceForm;

  pages: 'all' | 'range' | 'first';
  from: string;
  to: string;
  /** How {date} is written in the watermark and stamp text. */
  dateFormat: DateFormat;
}

const percent = (share: number) => String(Math.round(share * 100));
const anchorOf = (p: Placement): PlaceForm => ('anchor' in p ? { anchor: p.anchor, x: '', y: '' } : { anchor: 'point', x: '', y: '' });

export function defaultWatermarkForm(pageCount: number): WatermarkForm {
  const { watermark: w, stamp: s, logo: l } = WATERMARK_DEFAULTS;
  return {
    watermarkOn: true,
    preset: 'draft',
    text: w.text,
    font: w.font,
    bold: w.bold,
    italic: w.italic,
    sizeMode: 'auto',
    sizeMm: '18',
    angleMode: 'diagonal',
    angle: '45',
    place: anchorOf(w.placement),
    color: rgbToHex(w.color),
    opacity: percent(w.opacity),
    layer: w.layer,
    stampOn: false,
    stampPreset: 'verified',
    stampText: 'VERIFIED',
    stampSizeMode: (STAMP_SIZES.find((p) => p.pt === s.size)?.id ?? 'medium') as WatermarkForm['stampSizeMode'],
    stampSizeMm: '5',
    stampBold: s.bold,
    stampColor: rgbToHex(s.color),
    stampOpacity: percent(s.opacity),
    stampAngle: String(s.angle),
    stampPlace: anchorOf(s.placement),
    logoOn: false,
    logoId: null,
    logoWidth: percent(l.widthShare),
    logoOpacity: percent(l.opacity),
    logoPlace: anchorOf(l.placement),
    pages: 'all',
    from: '1',
    to: String(pageCount),
    dateFormat: 'dd-mm-yyyy',
  };
}

// ---- presets ---------------------------------------------------------------------------------------

/**
 * The text a preset puts in the field. 'client' puts the token `{client}`, never the name: the name is filled
 * only when the PDF is written, so the record keeps the token as typed (design 5.17's record rule).
 */
export function presetText(id: WatermarkPresetId | StampPresetId, _client: string): string {
  if (id === 'client') return '{client}';
  const preset = [...WATERMARK_PRESETS, ...STAMP_PRESETS].find((p) => p.id === id);
  return preset?.text ?? '';
}

/** Which preset a typed text is, so the preset list follows the field. */
export function presetOf(text: string, client: string, what: 'watermark'): WatermarkPresetId;
export function presetOf(text: string, client: string, what: 'stamp'): StampPresetId;
export function presetOf(text: string, client: string, what: 'watermark' | 'stamp'): string {
  const list = what === 'watermark' ? WATERMARK_PRESETS : STAMP_PRESETS;
  const fixed = list.find((p) => p.text !== null && p.text === text);
  if (fixed) return fixed.id;
  if (what === 'watermark' && /^\{client\}$/i.test(text.trim())) return 'client';
  return 'custom';
}

// ---- reading the form ------------------------------------------------------------------------------

export type WatermarkField =
  | 'parts'
  | 'text'
  | 'size'
  | 'angle'
  | 'color'
  | 'opacity'
  | 'place'
  | 'stampText'
  | 'stampSize'
  | 'stampAngle'
  | 'stampColor'
  | 'stampOpacity'
  | 'stampPlace'
  | 'logo'
  | 'logoWidth'
  | 'logoOpacity'
  | 'logoPlace'
  | 'pages';

export type LogoState = 'none' | 'preparing' | 'ready' | { error: string };

export interface WatermarkReadContext {
  pageCount: number;
  /** The characters the fonts can write (null until loaded: the library still checks). */
  check: CharacterCheck | null;
  /** What {date} and {client} are filled with. */
  tokens: { date: string; client: string };
  /** The prepared logo, when ready. */
  logo: { image: Uint8Array; format: 'png' | 'jpeg' } | null;
  logoState: LogoState;
}

export interface WatermarkReading {
  options: WatermarkOptions | null;
  errors: Partial<Record<WatermarkField, string>>;
  /** The first problem, in the order of the fields. */
  first: string | null;
  /** Run must wait: the logo is still being made ready. */
  waiting: boolean;
}

const decimal = (text: string) => (/^-?\d+(\.\d+)?$/.test(text.trim()) ? Number(text.trim()) : Number.NaN);
const whole = (text: string) => (/^\d+$/.test(text.trim()) ? Number(text.trim()) : Number.NaN);
const within = (value: number, limits: { min: number; max: number }) => value >= limits.min && value <= limits.max;

/**
 * The place after the user chooses `anchor`. "A point on the page" with no point typed yet starts at the middle
 * (50% across, 50% down), never as an error (REV-B minor 8); a point typed before is kept.
 */
export function choosePlace(value: PlaceForm, anchor: PlaceChoice): PlaceForm {
  if (anchor === 'point' && value.x.trim() === '' && value.y.trim() === '') return { anchor, x: '50', y: '50' };
  return { ...value, anchor };
}

/** The library's placement from the form: an anchor 20 pt in, or a point (fractions from the bottom-left). */
export function placementOf(place: PlaceForm): Placement {
  if (place.anchor !== 'point') return { anchor: place.anchor, padPt: MARK_PAD_PT };
  return { point: { u: decimal(place.x) / 100, v: 1 - decimal(place.y) / 100 } };
}

function placeError(place: PlaceForm, what: string): string | null {
  if (place.anchor !== 'point') return null;
  const p = placementOf(place);
  const ok = 'point' in p && within(p.point.u, { min: 0, max: 1 }) && within(p.point.v, { min: 0, max: 1 });
  // Typed as well as clicked, so the words serve both.
  return ok ? null : `Enter a point from 0 to 100% across and down for the ${what}, or click the preview.`;
}

/** The watermark's size in points: 'auto', a preset, or the typed letter height (NaN when not valid). */
export function watermarkSizePt(form: Pick<WatermarkForm, 'sizeMode' | 'sizeMm'>): number | 'auto' {
  if (form.sizeMode === 'auto') return 'auto';
  if (form.sizeMode !== 'other') return WATERMARK_SIZES.find((p) => p.id === form.sizeMode)?.pt ?? Number.NaN;
  const mm = readMm(form.sizeMm, MM_LIMITS.watermark);
  return Number.isNaN(mm) ? Number.NaN : ptForLetter(mm, MARK_LIMITS.watermarkSize);
}

/** The stamp's size in points: a preset, or the typed letter height (NaN when not valid). */
export function stampSizePt(form: Pick<WatermarkForm, 'stampSizeMode' | 'stampSizeMm'>): number {
  if (form.stampSizeMode !== 'other') return STAMP_SIZES.find((p) => p.id === form.stampSizeMode)?.pt ?? Number.NaN;
  const mm = readMm(form.stampSizeMm, MM_LIMITS.stamp);
  return Number.isNaN(mm) ? Number.NaN : ptForLetter(mm, MARK_LIMITS.stampSize);
}

/** "Centre", "Top right", "a point 25% across and 10% down". */
export function placeLabel(place: PlaceForm): string {
  if (place.anchor !== 'point') return ANCHOR_NAMES[place.anchor];
  return place.x.trim() !== '' && place.y.trim() !== '' ? `a point ${place.x.trim()}% across and ${place.y.trim()}% down` : 'a point on the page';
}

/** The page numbers (from 1) the marks go on, or null when the range is not valid. */
export function chosenPages(form: Pick<WatermarkForm, 'pages' | 'from' | 'to'>, pageCount: number): number[] | null {
  if (form.pages === 'first') return [1];
  const from = form.pages === 'all' ? 1 : whole(form.from);
  const to = form.pages === 'all' ? pageCount : whole(form.to);
  if (!(from >= 1 && to <= pageCount && from <= to)) return null;
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

/** Reads the form in the library's order, with its messages; options only when nothing is wrong. */
export function readWatermarkForm(form: WatermarkForm, ctx: WatermarkReadContext): WatermarkReading {
  const errors: Partial<Record<WatermarkField, string>> = {};
  const fail = (field: WatermarkField, message: string | null) => {
    if (message && !errors[field]) errors[field] = message;
  };
  let waiting = false;

  if (!form.watermarkOn && !form.stampOn && !form.logoOn) fail('parts', 'Turn on at least one of the watermark, the stamp and the logo.');
  const pages = chosenPages(form, ctx.pageCount);
  if (!pages) fail('pages', `Enter a page range between 1 and ${ctx.pageCount}, with the first page not after the last.`);

  let watermark: WatermarkOptions['watermark'];
  if (form.watermarkOn) {
    fail('text', markTextError(form.text, 'watermark', ctx.check, ctx.tokens));
    const size = watermarkSizePt(form);
    if (size !== 'auto' && !within(size, MARK_LIMITS.watermarkSize)) fail('size', `Enter a letter height from ${MM_LIMITS.watermark.min} to ${MM_LIMITS.watermark.max} mm, or choose Auto.`);
    const angle = form.angleMode === 'diagonal' ? 'diagonal' : form.angleMode === 'horizontal' ? 0 : form.angleMode === 'vertical' ? 90 : decimal(form.angle);
    if (angle !== 'diagonal' && !within(angle, MARK_LIMITS.angle)) fail('angle', 'Enter a watermark angle from -90 to 90 degrees.');
    const color = hexToRgb(form.color);
    if (!color) fail('color', 'Choose a valid colour for the watermark.');
    const opacity = decimal(form.opacity);
    if (!within(opacity, MARK_LIMITS.opacity)) fail('opacity', 'Enter a watermark opacity from 5% to 100%.');
    fail('place', placeError(form.place, 'watermark'));
    if (color) {
      watermark = { text: form.text, font: form.font, bold: form.bold, italic: form.italic, size, angle, placement: placementOf(form.place), color, opacity: opacity / 100, layer: form.layer };
    }
  }

  let stamp: WatermarkOptions['stamp'];
  if (form.stampOn) {
    fail('stampText', markTextError(form.stampText, 'stamp', ctx.check, ctx.tokens));
    const size = stampSizePt(form);
    if (!within(size, MARK_LIMITS.stampSize)) fail('stampSize', `Enter a letter height from ${MM_LIMITS.stamp.min} to ${MM_LIMITS.stamp.max} mm.`);
    const angle = decimal(form.stampAngle);
    if (!within(angle, MARK_LIMITS.angle)) fail('stampAngle', 'Enter a stamp angle from -90 to 90 degrees.');
    const color = hexToRgb(form.stampColor);
    if (!color) fail('stampColor', 'Choose a valid colour for the stamp.');
    const opacity = decimal(form.stampOpacity);
    if (!within(opacity, MARK_LIMITS.opacity)) fail('stampOpacity', 'Enter a stamp opacity from 5% to 100%.');
    fail('stampPlace', placeError(form.stampPlace, 'stamp'));
    if (color) stamp = { text: form.stampText, size, bold: form.stampBold, color, opacity: opacity / 100, angle, placement: placementOf(form.stampPlace) };
  }

  let logo: WatermarkOptions['logo'];
  if (form.logoOn) {
    if (ctx.logoState === 'preparing') waiting = true;
    else if (typeof ctx.logoState === 'object') fail('logo', ctx.logoState.error);
    else if (!form.logoId || !ctx.logo) fail('logo', 'Choose a PNG or JPG image for the logo.');
    const width = decimal(form.logoWidth);
    if (!within(width, MARK_LIMITS.logoWidth)) fail('logoWidth', 'Enter a logo width from 5% to 50% of the page width.');
    const opacity = decimal(form.logoOpacity);
    if (!within(opacity, MARK_LIMITS.logoOpacity)) fail('logoOpacity', 'Enter a logo opacity from 10% to 100%.');
    fail('logoPlace', placeError(form.logoPlace, 'logo'));
    if (ctx.logo) logo = { image: ctx.logo.image, format: ctx.logo.format, widthShare: width / 100, opacity: opacity / 100, placement: placementOf(form.logoPlace) };
  }

  const ORDER: WatermarkField[] = ['parts', 'text', 'size', 'angle', 'color', 'opacity', 'place', 'stampText', 'stampSize', 'stampAngle', 'stampColor', 'stampOpacity', 'stampPlace', 'logo', 'logoWidth', 'logoOpacity', 'logoPlace', 'pages'];
  const first = ORDER.map((field) => errors[field]).find((message) => message !== undefined) ?? null;
  if (first || waiting || !pages) return { options: null, errors, first, waiting };
  const range = form.pages === 'first' ? 'first' : { from: pages[0], to: pages[pages.length - 1] };
  const options: WatermarkOptions = { pages: range, tokens: { ...ctx.tokens } };
  if (watermark) options.watermark = watermark;
  if (stamp) options.stamp = stamp;
  if (logo) options.logo = logo;
  return { options, errors, first: null, waiting: false };
}

/** The same marks on the one-page copy the preview draws, with the preview's smaller copy of the logo. */
export function watermarkPreviewOptions(options: WatermarkOptions, previewLogo: { image: Uint8Array; format: 'png' | 'jpeg' } | null): WatermarkOptions {
  const preview: WatermarkOptions = { ...options, pages: { from: 1, to: 1 } };
  if (options.logo && previewLogo) preview.logo = { ...options.logo, image: previewLogo.image, format: previewLogo.format };
  return preview;
}

// ---- what the dialog says about the form -----------------------------------------------------------

const FONT_NAMES: Record<FontFamily, string> = { helvetica: 'Helvetica', times: 'Times', courier: 'Courier' };
const lowerFirst = (text: string) => `${text.charAt(0).toLowerCase()}${text.slice(1)}`;
const sizeWords = (mode: string, presets: readonly { id: string; label: string; pt: number }[], typedMm: string): string => {
  const preset = presets.find((p) => p.id === mode);
  if (preset) return `${preset.label.toLowerCase()} size (${mmText(letterMm(preset.pt))})`;
  return `letters ${typedMm.trim()} mm tall`;
};

/** The closed "More options" line of the watermark: every value it will be drawn with. */
export function watermarkSummary(form: WatermarkForm): string {
  const face = [FONT_NAMES[form.font], form.bold ? 'bold' : '', form.italic ? 'italic' : ''].filter(Boolean).join(' ');
  const size = form.sizeMode === 'auto' ? 'auto size' : sizeWords(form.sizeMode, WATERMARK_SIZES, form.sizeMm);
  const angle = form.angleMode === 'custom' ? `${form.angle.trim()}°` : form.angleMode;
  const layer = form.layer === 'front' ? 'in front' : 'behind the page';
  return [face, size, angle, colourName(form.color), `${form.opacity.trim()}% opacity`, layer, lowerFirst(placeLabel(form.place))].join(', ');
}

/** The closed "More options" line of the stamp. */
export function stampSummary(form: WatermarkForm): string {
  return [form.stampBold ? 'Bold' : 'Regular', sizeWords(form.stampSizeMode, STAMP_SIZES, form.stampSizeMm), `${form.stampAngle.trim()}°`, colourName(form.stampColor), `${form.stampOpacity.trim()}% opacity`, lowerFirst(placeLabel(form.stampPlace))].join(', ');
}

/** The closed "More options" line of the logo. */
export function logoSummary(form: WatermarkForm): string {
  return [`${form.logoWidth.trim()}% of the page width`, `${form.logoOpacity.trim()}% opacity`, lowerFirst(placeLabel(form.logoPlace))].join(', ');
}

/** The Run button: a verb, what is added, and where ("Add watermark to 12 pages"). */
export function markRunLabel(form: Pick<WatermarkForm, 'watermarkOn' | 'stampOn' | 'logoOn'>, pages: readonly number[] | null, pageCount: number): string {
  const parts = [form.watermarkOn && 'watermark', form.stampOn && 'stamp', form.logoOn && 'logo'].filter((p): p is string => Boolean(p));
  if (parts.length === 0) return 'Add marks';
  const what = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0];
  if (!pages || pageCount === 1) return `Add ${what}`;
  return `Add ${what} to ${pages.length === 1 ? `page ${pages[0]}` : `${pages.length} pages`}`;
}

// ---- result name and record ------------------------------------------------------------------------

/** `<name>_watermarked.pdf`, or `<name>_stamped.pdf` when only the stamp or the logo is on (design 5.16). */
export function watermarkResultName(sourceName: string, form: Pick<WatermarkForm, 'watermarkOn' | 'stampOn' | 'logoOn'>): string {
  return defaultResultName('watermark', sourceName, { stampOnly: !form.watermarkOn && (form.stampOn || form.logoOn) });
}

const faceOf = (font: FontFamily, bold: boolean, italic: boolean) => [font, bold ? 'bold' : '', italic ? 'italic' : ''].filter(Boolean).join(' ');
const positionOf = (p: Placement) =>
  'anchor' in p ? p.anchor : `point ${Math.round(p.point.u * 1000) / 10}% across, ${Math.round((1 - p.point.v) * 1000) / 10}% down`;
const opacityOf = (alpha: number) => Math.round(alpha * 100);
const WATERMARK_TEXTS = WATERMARK_PRESETS.flatMap((p) => (p.text ? [p.text] : []));
const STAMP_TEXTS = STAMP_PRESETS.flatMap((p) => (p.text ? [p.text] : []));

/**
 * A text in the record (activity.ts typedTextRecord): the ready-made text or token template as it is, or
 * "custom" with its length and the tokens it uses under `<key>Length` and `<key>Uses`.
 */
function putText(record: Record<string, string | number | boolean>, key: string, text: string, choices: readonly string[]): string {
  const typed = typedTextRecord(text, choices, MARK_TEXT_TOKENS);
  record[key] = typed.value;
  if (typed.length !== undefined) record[`${key}Length`] = typed.length;
  if (typed.uses) record[`${key}Uses`] = typed.uses;
  return typed.value === CUSTOM_TEXT ? '(custom text)' : typed.value;
}

/**
 * The record of a run (design 5.16; lead's ruling on REV-B B1: counts and choices only): "Watermark DRAFT,
 * stamp (custom text), logo, pages 1-12", and the options flat. A text is recorded as the ready-made text or
 * token template chosen (a token stays a token: the client name is never recorded through it), or only as
 * custom text with its length and tokens; the logo only as used, with its size in pixels, never its file name.
 */
export function watermarkRecord(options: WatermarkOptions, pageCount: number): { summary: string; options: Record<string, string | number | boolean> } {
  const record: Record<string, string | number | boolean> = {};
  const words: { watermark?: string; stamp?: string } = {};
  const { pages, watermark: w, stamp: s, logo: l } = options;
  record.pages = pages === 'first' ? 'first' : pages.from === 1 && pages.to === pageCount ? 'all' : pages.from === pages.to ? String(pages.from) : `${pages.from}-${pages.to}`;
  if (w) {
    words.watermark = putText(record, 'watermark', w.text, WATERMARK_TEXTS);
    record.watermarkFont = faceOf(w.font, w.bold, w.italic);
    record.watermarkSize = w.size;
    record.watermarkAngle = w.angle;
    record.watermarkColour = rgbToHex(w.color);
    record.watermarkOpacity = opacityOf(w.opacity);
    record.watermarkLayer = w.layer;
    record.watermarkPosition = positionOf(w.placement);
  }
  if (s) {
    words.stamp = putText(record, 'stamp', s.text, STAMP_TEXTS);
    record.stampSize = s.size;
    record.stampAngle = s.angle;
    record.stampColour = rgbToHex(s.color);
    record.stampOpacity = opacityOf(s.opacity);
    record.stampPosition = positionOf(s.placement);
  }
  if (l) {
    record.logo = true;
    // The size of the image placed (as it was made ready), read from its header.
    const { width, height } = inspectLogo(l.image);
    if (width > 0 && height > 0) {
      record.logoPixelWidth = width;
      record.logoPixelHeight = height;
    }
    record.logoWidth = opacityOf(l.widthShare);
    record.logoOpacity = opacityOf(l.opacity);
    record.logoPosition = positionOf(l.placement);
  }
  return { summary: describeWatermark(options, pageCount, words), options: record };
}
