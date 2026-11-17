// The Page numbers dialog (design 5.6, 5.17): page numbers in one of six places, and from phase 2 a
// header and a footer in the others, with tokens, more number styles, font, bold and italic.
//
// Layout (UX audit C6.4, principle 4): position, format and pages stay in view as in phase 1; the start
// number, style, font, size, colour and margin are under "More options", and the header and footer under
// their own fold, each closed line saying the current values. Sizes and margins are presets in mm,
// turned into points here (marks/pageNumberText.ts); the recommended ones are phase 1's 10 pt and 28 pt.
//
// The preview draws a page of the file numbered exactly as the run numbers it (usePageNumberPreview.ts);
// the expand icon opens the page viewer with every page in the range numbered the same way.
// Confidentiality: {client} and {fy} are this engagement's, read when Run is pressed; the record keeps
// the texts as typed (runTool.ts pageNumberRecord), never the filled-in values.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bold, Italic } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Toggle } from '@/components/ui/toggle';
import { useEngagement } from '@/contexts/EngagementContext';
import { cn } from '@/lib/utils';
import { addPageNumbers, fillTokens, pageNumberLabel, type DateFormat, type NumberFormat, type NumberPosition, type NumberStyle, type Slot } from '@/lib/pdf-tools/pageNumbers';
import { ColourSwatches, SizeChoice } from '../marks/ChoiceControls';
import MarkedPageOverlay, { OverlayCache } from '../marks/MarkedPageOverlay';
import MarkPreviewPane from '../marks/MarkPreviewPane';
import { charactersError, HEADER_TOKEN_HELP, usesToken } from '../marks/markText';
import {
  applyNumberSizes,
  headerFooterSummary,
  numberPreviewFor,
  numberSizesOf,
  pageNumberSummary,
  pageNumbersResultName,
  pageNumbersRunLabel,
  pageNumberTokens,
  previewTokenValues,
  slotTextProblems,
  type NumberSizes,
} from '../marks/pageNumberText';
import TokenBar from '../marks/TokenBar';
import { MARGINS, NUMBER_SIZES } from '../marks/units';
import { useCharacterCheck } from '../marks/useMarkData';
import { useTokenTarget } from '../marks/useTokenTarget';
import { closeUpOffset, defaultPageNumberForm, PAGE_NUMBER_LIMITS, readPageNumberForm, SLOT_NAMES, usedTexts, type PageNumberFont, type PageNumberForm } from '../toolOptions';
import PageViewer from '../viewer/PageViewer';
import { INVALID_INPUT } from './fieldProps';
import { Field, MoreOptions, ResultNameField, ToolDialog } from './ToolDialog';
import { previewPageOf, usePageNumberPreview } from './usePageNumberPreview';
import { useResultName, useToolRun, type ToolDialogProps } from './useToolRun';

const POSITION_ROWS: NumberPosition[][] = [
  ['top-left', 'top-center', 'top-right'],
  ['bottom-left', 'bottom-center', 'bottom-right'],
];
const POSITION_NAMES: Record<NumberPosition, string> = {
  'top-left': 'Top left',
  'top-center': 'Top centre',
  'top-right': 'Top right',
  'bottom-left': 'Bottom left',
  'bottom-center': 'Bottom centre',
  'bottom-right': 'Bottom right',
};
const FORMATS: { value: NumberFormat; label: string }[] = [
  { value: 'n', label: '1' },
  { value: 'n-dot', label: '1.' },
  { value: 'pg-n', label: 'Pg-1' },
  { value: 'page-n', label: 'Page 1' },
  { value: 'n-of-total', label: '1 of N' },
  { value: 'page-n-of-total', label: 'Page 1 of N' },
  { value: 'custom', label: 'Custom text' },
];
const STYLES: { value: NumberStyle; label: string }[] = [
  { value: 'arabic', label: '1, 2, 3' },
  { value: 'roman-lower', label: 'i, ii, iii' },
  { value: 'roman-upper', label: 'I, II, III' },
  { value: 'alpha', label: 'a, b, c' },
  { value: 'circled', label: 'Numbers in circles' },
];
const FONTS: { value: PageNumberFont; label: string }[] = [
  { value: 'helvetica', label: 'Helvetica' },
  { value: 'times', label: 'Times' },
  { value: 'courier', label: 'Courier' },
];
const DATE_FORMATS: { value: DateFormat; label: string }[] = [
  { value: 'dd-mm-yyyy', label: 'DD-MM-YYYY' },
  { value: 'dd/mm/yyyy', label: 'DD/MM/YYYY' },
  { value: 'yyyy-mm-dd', label: 'YYYY-MM-DD' },
  { value: 'long', label: '14 November 2026' },
];
const ROWS: { label: string; slots: Slot[] }[] = [
  { label: 'Header', slots: ['top-left', 'top-center', 'top-right'] },
  { label: 'Footer', slots: ['bottom-left', 'bottom-center', 'bottom-right'] },
];
const SIDE: Record<string, string> = { left: 'left', center: 'centre', right: 'right' };
const CLOSE_UP = { width: 236, height: 76 };
/** The one message for a problem with the options; invalid inputs point to it. */
const PROBLEM_ID = 'pdf-tools-number-problem';

/** Six corners and edges on a small page; arrow keys move between them. */
function PositionPicker({ value, onChange, disabled }: { value: NumberPosition; onChange: (value: NumberPosition) => void; disabled: boolean }) {
  const dot = (position: NumberPosition) => (
    <RadioGroupItem
      key={position}
      value={position}
      aria-label={POSITION_NAMES[position]}
      data-testid={`pdf-tools-position-${position}`}
      className={cn('h-4 w-4 justify-self-center', position.endsWith('left') && 'justify-self-start', position.endsWith('right') && 'justify-self-end')}
    />
  );
  return (
    <div className="space-y-1.5">
      <p id="pdf-tools-position-label" className="text-sm font-medium leading-none">
        Position
      </p>
      <div className="flex items-center gap-3">
        <RadioGroup
          aria-labelledby="pdf-tools-position-label"
          value={value}
          disabled={disabled}
          onValueChange={(next) => onChange(next as NumberPosition)}
          className="grid h-[112px] w-[86px] shrink-0 grid-cols-3 grid-rows-[auto_1fr_auto] items-center gap-0 rounded-md border bg-background p-2 shadow-sm"
        >
          {POSITION_ROWS[0].map(dot)}
          <div className="col-span-3 space-y-1.5 py-1.5" aria-hidden="true">
            {[100, 85, 92, 70].map((w, i) => (
              <div key={i} className="h-1 rounded-full bg-muted-foreground/15" style={{ width: `${w}%` }} />
            ))}
          </div>
          {POSITION_ROWS[1].map(dot)}
        </RadioGroup>
        <span className="text-sm text-muted-foreground">{POSITION_NAMES[value]}</span>
      </div>
    </div>
  );
}

export default function PageNumbersDialog(props: ToolDialogProps) {
  const { files, onClose } = props;
  const file = files[0];
  const pageCount = file.pageCount ?? 0;
  const run = useToolRun('page-numbers', props);
  const { currentEngagement } = useEngagement();
  const check = useCharacterCheck();
  const tokenTarget = useTokenTarget();

  // The list this dialog was opened for: nothing is shown once it has moved on.
  const latestProps = useRef(props);
  latestProps.current = props;
  const [opened] = useState(() => props.scope());
  const isCurrent = useCallback(() => {
    const now = latestProps.current.scope();
    return now.contextKey !== null && now.contextKey === opened.contextKey && now.session === opened.session;
  }, [opened]);

  const [form, setForm] = useState<PageNumberForm>(() => defaultPageNumberForm(pageCount));
  const [sizes, setSizes] = useState<NumberSizes>(() => numberSizesOf(defaultPageNumberForm(pageCount)));
  const [today] = useState(() => new Date());
  const [focusSlot, setFocusSlot] = useState<Slot | null>(null);
  const { clearMessages } = run;

  const set = <K extends keyof PageNumberForm>(key: K, value: PageNumberForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    clearMessages();
  };
  const setSize = (patch: Partial<NumberSizes>) => {
    setSizes((current) => ({ ...current, ...patch }));
    clearMessages();
  };
  const setText = (slot: Slot, text: string) => {
    setForm((current) => ({ ...current, texts: { ...current.texts, [slot]: text } }));
    clearMessages();
  };

  // ---- reading the form: sizes from mm, then the shared reader, then the characters of the lines ----
  const tokenSource = { file: file.name, client: currentEngagement?.client_name, fy: currentEngagement?.financial_year, today };
  const applied = applyNumberSizes(form, sizes);
  const read = readPageNumberForm(applied.form, pageCount);
  const slotProblems = slotTextProblems(form.texts, check, tokenSource);
  const firstSlotProblem = (Object.entries(slotProblems) as [Slot, string][])[0];
  // The custom text around the number, checked as it is typed (the library's words).
  const affixProblem = form.format === 'custom' && form.numbersOn !== false ? charactersError(check, `${form.prefix}${form.suffix}`, 'page number text') : null;
  const options =
    read.options && !applied.errors.fontSize && !applied.errors.marginPt && !firstSlotProblem && !affixProblem ? { ...read.options, tokens: pageNumberTokens(tokenSource) } : null;
  const name = useResultName(pageNumbersResultName(file.name, form));
  const numbersOn = form.numbersOn !== false;

  // ---- preview ----
  const [previewPage, setPreviewPage] = useState<number | undefined>(undefined);
  const { preview, pending } = usePageNumberPreview(file.bytes, options, { page: previewPage, isCurrent });
  const range = read.options ? Array.from({ length: read.options.toPage - read.options.fromPage + 1 }, (_, i) => read.options!.fromPage + i) : [];
  const shownPage = preview?.status === 'ready' ? preview.page : (range[0] ?? 1);
  // The page asked for, not the one last drawn: Next and Previous step from it at once, as in Watermark, so a
  // quick second click goes on to the next page instead of asking for the same one again (REV-B S10).
  const askedPage = read.options ? previewPageOf(read.options, previewPage) : shownPage;

  const previewCode = preview?.status === 'error' && preview.blocking ? preview.code : undefined;
  const previewProblem = preview?.status === 'error' && preview.blocking ? preview.message : null;
  const slotProblemText = firstSlotProblem ? `${SLOT_NAMES[firstSlotProblem[0]].charAt(0).toUpperCase()}${SLOT_NAMES[firstSlotProblem[0]].slice(1)}: ${firstSlotProblem[1]}` : null;
  const problem = applied.errors.fontSize ?? applied.errors.marginPt ?? read.error ?? affixProblem ?? slotProblemText ?? previewProblem;

  // The inputs the problem is about: marked invalid and pointed at the message, which is an alert.
  const invalid = new Set<string>(
    applied.errors.fontSize
      ? ['fontSize']
      : applied.errors.marginPt
        ? ['marginPt']
        : read.field
          ? [read.field]
          : affixProblem
            ? ['prefix', 'suffix']
            : firstSlotProblem
            ? [`text-${firstSlotProblem[0]}`]
            : previewCode === 'unsupported-characters'
              ? ['prefix', 'suffix']
              : previewCode === 'invalid-number-options' && form.format === 'custom'
                ? ['prefix', 'suffix']
                : [],
  );
  const marked = (field: string) => ({
    'aria-invalid': invalid.has(field) ? true : undefined,
    'aria-describedby': invalid.has(field) ? PROBLEM_ID : undefined,
  });
  const moreInvalid = ['startNumber', 'fontSize', 'marginPt', 'color', 'style'].some((f) => invalid.has(f));
  const textsInvalid = invalid.has('numbersOn') || [...invalid].some((f) => f.startsWith('text-'));

  const numbers = read.options && { first: read.options.startNumber, last: read.options.startNumber + read.options.toPage - read.options.fromPage };
  const sample = read.options && numbers ? { first: pageNumberLabel(read.options, numbers.first, numbers.last), last: pageNumberLabel(read.options, numbers.last, numbers.last) } : null;
  const closeSlot = focusSlot ?? (preview?.status === 'ready' ? preview.options.position : form.position);
  const offset =
    preview?.status === 'ready'
      ? closeUpOffset({
          imageWidth: preview.width,
          imageHeight: preview.height,
          pxPerPt: preview.pxPerPt,
          position: closeSlot,
          marginPt: preview.options.marginPt,
          fontSize: preview.options.fontSize,
          viewWidth: CLOSE_UP.width,
          viewHeight: CLOSE_UP.height,
        })
      : null;

  // What the focused line prints on the page shown, tokens filled in.
  const focusText = focusSlot ? form.texts[focusSlot] : '';
  const total = read.options ? read.options.toPage - read.options.fromPage + read.options.startNumber : 1;
  const focusFilled =
    focusSlot && focusText.trim() !== '' && /\{[^{}]*\}/.test(focusText) && read.options
      ? fillTokens(focusText, previewTokenValues(tokenSource, form.dateFormat, form.style, total, read.options.startNumber + shownPage - read.options.fromPage))
      : null;
  const usesDate = usedTexts(form.texts).some(([, text]) => usesToken(text, 'date'));

  // ---- the large view ----
  const [viewing, setViewing] = useState<{ opener: HTMLElement; page: number } | null>(null);
  const overlayCache = useMemo(() => new OverlayCache(), []);
  useEffect(() => () => overlayCache.clear(), [overlayCache]);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const markFor = useCallback((pageIndex: number) => {
    const current = optionsRef.current;
    const plan = current ? numberPreviewFor(current, pageIndex + 1) : null;
    if (!current || !plan) return null;
    return { key: JSON.stringify({ options: current, page: pageIndex + 1 }), mark: async (one: Uint8Array) => ({ bytes: await addPageNumbers(one, plan) }) };
  }, []);
  const lastViewed = useRef<number | null>(null);
  const onPageShown = useCallback((pageIndex: number) => {
    lastViewed.current = pageIndex + 1;
  }, []);

  const pagesNumbered = read.options ? read.options.toPage - read.options.fromPage + 1 : null;
  const onRun = () => {
    // The client name and financial year are this engagement's, read now (design 5.17).
    const scope = props.scope();
    if (!options || !currentEngagement || !isCurrent() || !scope.contextKey?.endsWith(`:${currentEngagement.id}`)) return;
    const tokens = pageNumberTokens({ file: file.name, client: currentEngagement.client_name, fy: currentEngagement.financial_year, today: new Date() });
    run.start({ numbers: { ...options, tokens }, name: name.resolved });
  };

  const numberInput = (key: 'startNumber', limits: { min: number; max: number }) => (
    <Input
      id={`pdf-tools-number-${key}`}
      data-testid={`pdf-tools-number-${key}`}
      {...marked(key)}
      className={INVALID_INPUT}
      type="number"
      inputMode="numeric"
      min={limits.min}
      max={limits.max}
      step={1}
      value={form[key]}
      onChange={(event) => set(key, event.target.value)}
    />
  );

  return (
    <ToolDialog
      tool="page-numbers"
      files={files}
      run={run}
      size="2xl"
      showFile
      description="Add page numbers, a header or a footer to a copy of this PDF. The original is not changed."
      runLabel={pageNumbersRunLabel(form, pagesNumbered, pageCount)}
      blocked={problem !== null || options === null}
      blockedReason={problem ?? (options === null ? 'Check the options above.' : null)}
      busyNote="Stop takes effect between pages."
      onRun={onRun}
      onClose={onClose}
    >
      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_260px]">
        <div className="min-w-0 space-y-4">
          <div className={cn('grid gap-4 sm:grid-cols-[auto_minmax(0,1fr)]', !numbersOn && 'opacity-60')}>
            {/* A new position or format: the close-up shows the number again, not the header or footer box last used (REV-B S10). */}
            <PositionPicker
              value={form.position}
              onChange={(position) => {
                setFocusSlot(null);
                set('position', position);
              }}
              disabled={!numbersOn}
            />
            <div className="min-w-0 space-y-3">
              <Field id="pdf-tools-number-format" label="Format">
                <Select
                  value={form.format}
                  disabled={!numbersOn}
                  onValueChange={(value) => {
                    setFocusSlot(null);
                    set('format', value as NumberFormat);
                  }}
                >
                  <SelectTrigger id="pdf-tools-number-format" data-testid="pdf-tools-number-format">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FORMATS.map((f) => (
                      <SelectItem key={f.value} value={f.value} data-testid={`pdf-tools-format-${f.value}`}>
                        {f.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              {form.format === 'custom' && (
                <div className="grid grid-cols-2 gap-3">
                  <Field id="pdf-tools-number-prefix" label="Before the number">
                    <Input id="pdf-tools-number-prefix" data-testid="pdf-tools-number-prefix" {...marked('prefix')} className={INVALID_INPUT} placeholder="WP-A1 / " maxLength={60} disabled={!numbersOn} value={form.prefix} onChange={(event) => set('prefix', event.target.value)} />
                  </Field>
                  <Field id="pdf-tools-number-suffix" label="After the number">
                    <Input id="pdf-tools-number-suffix" data-testid="pdf-tools-number-suffix" {...marked('suffix')} className={INVALID_INPUT} maxLength={60} disabled={!numbersOn} value={form.suffix} onChange={(event) => set('suffix', event.target.value)} />
                  </Field>
                </div>
              )}
              {numbersOn && sample && (
                <p className="text-xs text-muted-foreground" data-testid="pdf-tools-number-sample">
                  From <span className="font-medium text-foreground">{sample.first}</span> to <span className="font-medium text-foreground">{sample.last}</span>
                </p>
              )}
              {!numbersOn && <p className="text-xs text-muted-foreground">Page numbers are off. Only the header and footer are added.</p>}
            </div>
          </div>

          <div className="space-y-1.5">
            <p id="pdf-tools-number-pages-label" className="text-sm font-medium leading-none">
              {numbersOn ? 'Number these pages' : 'Pages'}
            </p>
            <RadioGroup aria-labelledby="pdf-tools-number-pages-label" value={form.range} onValueChange={(value) => set('range', value as 'all' | 'some')} className="gap-2 pt-1">
              <div className="flex items-center gap-2">
                <RadioGroupItem id="pdf-tools-number-all" value="all" data-testid="pdf-tools-number-range-all" />
                <Label htmlFor="pdf-tools-number-all" className="font-normal">
                  {pageCount === 1 ? 'The page' : `All ${pageCount} pages`}
                </Label>
              </div>
              {/* A range of one page says nothing more: shown from two pages on, as in Watermark. */}
              <div className={cn('flex flex-wrap items-center gap-2', pageCount === 1 && 'hidden')}>
                <RadioGroupItem id="pdf-tools-number-some" value="some" data-testid="pdf-tools-number-range-some" />
                <Label htmlFor="pdf-tools-number-some" className="font-normal">
                  From page
                </Label>
                <Input aria-label="First page to number" data-testid="pdf-tools-number-from" {...marked('range')} className={cn('h-8 w-20', INVALID_INPUT)} type="number" inputMode="numeric" min={1} max={pageCount} disabled={form.range === 'all'} value={form.fromPage} onChange={(event) => set('fromPage', event.target.value)} />
                <span className="text-sm">to</span>
                <Input aria-label="Last page to number" data-testid="pdf-tools-number-to" {...marked('range')} className={cn('h-8 w-20', INVALID_INPUT)} type="number" inputMode="numeric" min={1} max={pageCount} disabled={form.range === 'all'} value={form.toPage} onChange={(event) => set('toPage', event.target.value)} />
              </div>
            </RadioGroup>
            {pageCount > 1 && <p className="text-xs text-muted-foreground">Leave a cover page unnumbered by starting from page 2.</p>}
          </div>

          <MoreOptions id="pdf-tools-number-more" summary={pageNumberSummary(applied.form, sizes)} invalid={moreInvalid}>
            <div className="grid gap-3 sm:grid-cols-[120px_minmax(0,1fr)_auto]">
              <Field id="pdf-tools-number-startNumber" label="Start at">
                {numberInput('startNumber', PAGE_NUMBER_LIMITS.startNumber)}
              </Field>
              <Field id="pdf-tools-number-style" label="Numbers">
                <Select value={form.style} onValueChange={(value) => set('style', value as NumberStyle)}>
                  <SelectTrigger id="pdf-tools-number-style" data-testid="pdf-tools-number-style" {...marked('style')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STYLES.map((s) => (
                      <SelectItem key={s.value} value={s.value} data-testid={`pdf-tools-style-${s.value}`}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <Field id="pdf-tools-number-font" label="Font" className="w-[150px]">
                <Select value={form.font} onValueChange={(value) => set('font', value as PageNumberFont)}>
                  <SelectTrigger id="pdf-tools-number-font" data-testid="pdf-tools-number-font">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FONTS.map((f) => (
                      <SelectItem key={f.value} value={f.value} data-testid={`pdf-tools-number-font-${f.value}`}>
                        {f.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <div className="flex gap-1">
                <Toggle variant="outline" size="sm" aria-label="Bold" data-testid="pdf-tools-number-bold" pressed={form.bold} onPressedChange={(bold) => set('bold', bold)}>
                  <Bold className="h-4 w-4" />
                </Toggle>
                <Toggle variant="outline" size="sm" aria-label="Italic" data-testid="pdf-tools-number-italic" pressed={form.italic} onPressedChange={(italic) => set('italic', italic)}>
                  <Italic className="h-4 w-4" />
                </Toggle>
              </div>
            </div>
            <SizeChoice
              id="pdf-tools-number-size"
              label="Size"
              presets={NUMBER_SIZES}
              value={sizes.sizeChoice}
              onChange={(sizeChoice) => setSize({ sizeChoice })}
              mm={sizes.sizeMm}
              onMm={(sizeMm) => setSize({ sizeMm })}
              measure="letter"
              error={applied.errors.fontSize}
            />
            <ColourSwatches id="pdf-tools-number-color" label="Colour" value={form.color} onChange={(color) => set('color', color)} error={invalid.has('color') ? read.error : null} />
            <SizeChoice
              id="pdf-tools-number-margin"
              label="Margin"
              presets={MARGINS}
              value={sizes.marginChoice}
              onChange={(marginChoice) => setSize({ marginChoice })}
              mm={sizes.marginMm}
              onMm={(marginMm) => setSize({ marginMm })}
              measure="distance"
              error={applied.errors.marginPt}
            />
          </MoreOptions>

          <MoreOptions id="pdf-tools-number-texts" label="Header and footer" summary={headerFooterSummary(form.texts)} invalid={textsInvalid}>
            <div className="flex items-center gap-2">
              <Checkbox id="pdf-tools-number-switch" data-testid="pdf-tools-number-switch" checked={numbersOn} onCheckedChange={(on) => set('numbersOn', on === true)} {...marked('numbersOn')} />
              <Label htmlFor="pdf-tools-number-switch" className="font-normal">
                Add page numbers too
              </Label>
            </div>
            <TokenBar
              id="pdf-tools-number-tokens"
              tokens={HEADER_TOKEN_HELP}
              onInsert={(token) => {
                const slot = focusSlot ?? 'top-left';
                const input = document.getElementById(`pdf-tools-number-text-${slot}`) as HTMLInputElement | null;
                tokenTarget.insert(token, input ? { input, set: (text) => setText(slot, text) } : undefined);
              }}
            />
            <div className="space-y-2">
              {ROWS.map((row) => (
                <div key={row.label} className="grid grid-cols-[52px_repeat(3,minmax(0,1fr))] items-center gap-2" role="group" aria-label={row.label}>
                  <span className="text-xs font-medium text-muted-foreground">{row.label}</span>
                  {row.slots.map((slot) => {
                    const side = SIDE[slot.split('-')[1]];
                    const isNumber = numbersOn && slot === form.position;
                    return (
                      <Input
                        key={slot}
                        id={`pdf-tools-number-text-${slot}`}
                        data-testid={`pdf-tools-number-text-${slot}`}
                        aria-label={`${row.label}, ${side}`}
                        {...marked(`text-${slot}`)}
                        onFocus={(event) => {
                          setFocusSlot(slot);
                          tokenTarget.field((text) => setText(slot, text)).onFocus(event);
                        }}
                        className={cn('h-9 text-xs', INVALID_INPUT)}
                        placeholder={isNumber ? 'Page number' : side.charAt(0).toUpperCase() + side.slice(1)}
                        maxLength={240}
                        spellCheck={false}
                        autoComplete="off"
                        value={form.texts[slot]}
                        onChange={(event) => setText(slot, event.target.value)}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
            {focusFilled && (
              <p className="text-xs text-muted-foreground" data-testid="pdf-tools-number-text-sample">
                On page {shownPage} this prints “<span className="text-foreground">{focusFilled}</span>”
              </p>
            )}
            {usesDate && (
              <Field id="pdf-tools-number-date-format" label="Write {date} as" hint={`Today: ${previewTokenValues(tokenSource, form.dateFormat, 'arabic', 1).date}`}>
                <Select value={form.dateFormat} onValueChange={(value) => set('dateFormat', value as DateFormat)}>
                  <SelectTrigger id="pdf-tools-number-date-format" data-testid="pdf-tools-number-date-format" className="sm:w-[220px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DATE_FORMATS.map((f) => (
                      <SelectItem key={f.value} value={f.value}>
                        {f.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
          </MoreOptions>

          <ResultNameField name={name} />
        </div>

        <div className="md:sticky md:top-0 md:self-start">
          <MarkPreviewPane
            id="pdf-tools-number-preview"
            imageTestId="pdf-tools-preview-page"
            errorTestId="pdf-tools-preview-error"
            preview={preview && (preview.status === 'ready' ? preview : { status: 'error', message: preview.message, blocking: preview.blocking })}
            pending={pending}
            page={askedPage}
            pages={range}
            onPage={setPreviewPage}
            picking={null}
            onPick={() => undefined}
            onStopPicking={() => undefined}
            onExpand={(opener) => setViewing({ opener, page: askedPage })}
            alt={preview?.status === 'ready' ? `Page ${preview.page} with the number ${preview.label}` : 'Preview'}
            problem={problem}
            problemId={PROBLEM_ID}
            maxHeight={220}
          >
            {preview?.status === 'ready' && (
              <>
                <p className="pt-1 text-xs font-medium text-foreground">Close-up, {POSITION_NAMES[closeSlot].toLowerCase()}</p>
                <div className="overflow-hidden rounded border bg-white" style={{ width: CLOSE_UP.width, height: CLOSE_UP.height }}>
                  <img src={preview.url} alt="" className="h-full w-full max-w-none" style={{ objectFit: 'none', objectPosition: offset ? `${offset.x}px ${offset.y}px` : 'center' }} />
                </div>
                {numbersOn && (
                  <p className="text-xs text-muted-foreground">
                    This page shows <span className="font-medium text-foreground">{preview.label}</span>.
                  </p>
                )}
              </>
            )}
          </MarkPreviewPane>
        </div>
      </div>

      {viewing && (
        <PageViewer
          file={file}
          startPage={viewing.page}
          returnFocusTo={viewing.opener}
          onClose={() => {
            const seen = lastViewed.current;
            if (seen !== null && range.includes(seen)) setPreviewPage(seen);
            overlayCache.clear();
            setViewing(null);
          }}
          overlay={(surface) => (
            <MarkedPageOverlay
              surface={surface}
              bytes={file.bytes}
              markFor={markFor}
              cache={overlayCache}
              seed={preview?.status === 'ready' && options ? { key: JSON.stringify({ options, page: preview.page }), pageIndex: preview.page - 1, url: preview.url } : null}
              isCurrent={isCurrent}
              onPageShown={onPageShown}
            />
          )}
        />
      )}
    </ToolDialog>
  );
}
