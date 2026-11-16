// The Page numbers dialog's header and footer (design 5.17), beyond what toolOptions.ts reads: the
// characters each line may hold (checked as the user types, in the library's words), the token values
// read when Run is pressed, the result name, and the plan that numbers one page of the file exactly as
// the whole run numbers it (for the preview of any page in the range).
import { defaultResultName } from '@/lib/pdf-tools/resultNames';
import { fillTokens, formatDate, formatNumber, type DateFormat, type NumberStyle, type PageNumberRunOptions, type Slot } from '@/lib/pdf-tools/pageNumbers';
import { SLOT_NAMES, TEXT_SLOTS, usedTexts, type PageNumberForm } from '../toolOptions';
import { charactersError, type CharacterCheck } from './markText';
import { colourName, letterMm, MARGINS, MM_LIMITS, MM_PER_PT, mmText, NUMBER_SIZES, ptForLetter, ptForMm, readMm, sizeChoiceOf } from './units';

export interface TokenSource {
  /** The source's name as the list shows it (already cleaned, never a path). */
  file: string;
  /** The engagement's client name and financial year, read when Run is pressed. */
  client: string | null | undefined;
  fy: string | null | undefined;
  today: Date;
}

/** What `addPageNumbers` fills the tokens from (design 5.17): only these, never a global. */
export function pageNumberTokens(source: TokenSource): NonNullable<PageNumberRunOptions['tokens']> {
  return { file: source.file, client: source.client ?? '', fy: source.fy ?? '', today: source.today };
}

/** The values the preview and the token help fill in, as the run would on the page numbered `page`. */
export function previewTokenValues(source: TokenSource, dateFormat: DateFormat, style: NumberStyle, total: number, page = 1) {
  const tokens = pageNumberTokens(source);
  return {
    page: formatNumber(page, style),
    pages: formatNumber(total, style),
    file: tokens.file,
    name: tokens.file.replace(/\.pdf$/i, ''),
    date: formatDate(tokens.today, dateFormat),
    client: tokens.client,
    fy: tokens.fy,
  };
}

/**
 * Lines whose characters the built-in fonts cannot write, typed or brought in by a token (the file
 * name, the client name, the financial year), with the library's message for each place.
 */
export function slotTextProblems(texts: Readonly<Record<Slot, string>>, check: CharacterCheck | null, source: TokenSource): Partial<Record<Slot, string>> {
  const problems: Partial<Record<Slot, string>> = {};
  if (!check) return problems;
  const values = previewTokenValues(source, 'dd-mm-yyyy', 'arabic', 1);
  for (const [slot, text] of usedTexts(texts)) {
    const message =
      charactersError(check, text, 'header or footer text') ??
      charactersError(check, fillTokens(text, values), 'file name, client name or financial year used in the header or footer text');
    if (message) problems[slot] = message;
  }
  return problems;
}

/** `<name>_numbered.pdf`, or `<name>_header_footer.pdf` when header or footer text is used (design 5.17). */
export function pageNumbersResultName(sourceName: string, form: Pick<PageNumberForm, 'texts'> & Partial<Pick<PageNumberForm, 'numbersOn'>>): string {
  return defaultResultName('page-numbers', sourceName, { headerFooter: usedTexts(form.texts).length > 0 });
}

// ---- sizes in mm, the folds' lines, the Run button (UX audit C6.4, C6.5, principles 1 and 5) -------

/** How the dialog shows the font size and the margin: a preset, or a typed size in mm. */
export interface NumberSizes {
  sizeChoice: string;
  sizeMm: string;
  marginChoice: string;
  marginMm: string;
}

const round1 = (x: number) => String(Math.round(x * 10) / 10);
const presetMm = (mm: number) => mmText(mm).replace(' mm', '');

/** The dialog's sizes for a form (points as text): presets where they match, otherwise mm. */
export function numberSizesOf(form: Pick<PageNumberForm, 'fontSize' | 'marginPt'>): NumberSizes {
  const size = Number(form.fontSize);
  const margin = Number(form.marginPt);
  const sizeChoice = sizeChoiceOf(size, NUMBER_SIZES);
  const marginChoice = sizeChoiceOf(margin, MARGINS);
  return {
    sizeChoice,
    sizeMm: sizeChoice === 'other' ? round1(letterMm(size)) : presetMm(letterMm(size)),
    marginChoice,
    marginMm: marginChoice === 'other' ? round1(margin * MM_PER_PT) : presetMm(margin * MM_PER_PT),
  };
}

/** The form with the font size and margin in points, from the presets or the typed mm; mm messages for a typed size out of range. */
export function applyNumberSizes(form: PageNumberForm, sizes: NumberSizes): { form: PageNumberForm; errors: { fontSize?: string; marginPt?: string } } {
  const errors: { fontSize?: string; marginPt?: string } = {};
  let { fontSize, marginPt } = form;
  const sizePreset = NUMBER_SIZES.find((p) => p.id === sizes.sizeChoice);
  if (sizePreset) fontSize = String(sizePreset.pt);
  else {
    const mm = readMm(sizes.sizeMm, MM_LIMITS.number);
    if (Number.isNaN(mm)) errors.fontSize = `Enter a letter height from ${MM_LIMITS.number.min} to ${MM_LIMITS.number.max} mm.`;
    else fontSize = String(ptForLetter(mm, { min: 6, max: 36 }));
  }
  const marginPreset = MARGINS.find((p) => p.id === sizes.marginChoice);
  if (marginPreset) marginPt = String(marginPreset.pt);
  else {
    const mm = readMm(sizes.marginMm, MM_LIMITS.margin);
    if (Number.isNaN(mm)) errors.marginPt = `Enter a margin from ${MM_LIMITS.margin.min} to ${MM_LIMITS.margin.max} mm.`;
    else marginPt = String(ptForMm(mm, { min: 8, max: 144 }));
  }
  return { form: { ...form, fontSize, marginPt }, errors };
}

const STYLE_WORDS: Record<NumberStyle, string> = { arabic: 'numbers 1, 2, 3', 'roman-lower': 'numbers i, ii, iii', 'roman-upper': 'numbers I, II, III', alpha: 'letters a, b, c', circled: 'numbers in circles' };
const FONT_WORDS = { helvetica: 'Helvetica', times: 'Times', courier: 'Courier' } as const;

/** The closed "More options" line: start, style, font, size, colour and margin, in words and mm. */
export function pageNumberSummary(form: PageNumberForm, sizes: NumberSizes): string {
  const face = [FONT_WORDS[form.font ?? 'helvetica'], form.bold ? 'bold' : '', form.italic ? 'italic' : ''].filter(Boolean).join(' ');
  const sizePreset = NUMBER_SIZES.find((p) => p.id === sizes.sizeChoice);
  const size = sizePreset ? `${sizePreset.label.toLowerCase()} size (${mmText(letterMm(sizePreset.pt))})` : `letters ${sizes.sizeMm.trim()} mm tall`;
  const marginPreset = MARGINS.find((p) => p.id === sizes.marginChoice);
  const margin = marginPreset ? `${marginPreset.label.toLowerCase()} margin (${mmText(marginPreset.pt * MM_PER_PT)})` : `margin ${sizes.marginMm.trim()} mm`;
  return [`Starts at ${form.startNumber.trim()}`, STYLE_WORDS[form.style ?? 'arabic'], face, size, colourName(form.color), margin].join(', ');
}

/** The closed "Header and footer" line: the places used and their text as typed. */
export function headerFooterSummary(texts: Readonly<Record<Slot, string>>): string {
  const cut = (text: string) => ([...text].length > 24 ? `${[...text].slice(0, 23).join('')}…` : text);
  const used = TEXT_SLOTS.filter((slot) => texts[slot] !== undefined && texts[slot].trim() !== '').map((slot) => `${SLOT_NAMES[slot]} “${cut(texts[slot].trim())}”`);
  if (used.length === 0) return 'None';
  const line = used.join(', ');
  return `${line.charAt(0).toUpperCase()}${line.slice(1)}`;
}

/** The Run button: a verb, what is added, and to how many pages ("Add page numbers to 12 pages"). */
export function pageNumbersRunLabel(form: Pick<PageNumberForm, 'numbersOn' | 'texts'>, pages: number | null, pageCount: number): string {
  const texts = usedTexts(form.texts).length > 0;
  const what = form.numbersOn === false ? 'header and footer' : texts ? 'page numbers, header and footer' : 'page numbers';
  if (pages === null || pageCount === 1) return `Add ${what}`;
  return `Add ${what} to ${pages === 1 ? '1 page' : `${pages} pages`}`;
}

/**
 * The options that number a one-page copy of page `page` (from 1) as the whole run numbers that page:
 * its own number, and "of N" and {pages} written with the run's total. Null for a page outside the range.
 */
export function numberPreviewFor<O extends PageNumberRunOptions>(options: O, page: number): O | null {
  if (page < options.fromPage || page > options.toPage) return null;
  const style = options.style ?? 'arabic';
  const total = formatNumber(options.toPage - options.fromPage + options.startNumber, style);
  let { format, prefix, suffix } = options;
  if (format === 'n-of-total' || format === 'page-n-of-total') {
    prefix = format === 'page-n-of-total' ? 'Page ' : '';
    suffix = ` of ${total}`;
    format = 'custom';
  }
  const texts = options.texts
    ? (Object.fromEntries(Object.entries(options.texts).map(([slot, text]) => [slot, typeof text === 'string' ? text.replace(/\{pages\}/gi, total) : text])) as O['texts'])
    : undefined;
  return { ...options, format, prefix, suffix, startNumber: options.startNumber + (page - options.fromPage), fromPage: 1, toPage: 1, ...(texts ? { texts } : {}) };
}
