// The Watermark tool's dialog (design 5.16): a watermark, a stamp and a logo, each with its own switch,
// placed on the chosen pages, with a live preview of a real page of the file as the run will make it
// (useMarkPreview.ts: the same library call on a one-page copy) and the page viewer behind its expand
// icon. The fields are plain data in marks/watermarkForm.ts; the run step is watermarkRun.ts.
//
// Layout (UX audit C6.4, principle 4): in view are the three switches, each part's text (or image),
// the pages and the preview; font, size, angle, colour, opacity, layer and exact position are under
// each part's "More options", whose closed line says their current values.
//
// Confidentiality: the dialog's scope is captured when it opens; the preview, the page scan and the
// logo are shown only while the list is still that scope's. The client name is read from the current
// engagement when Run is pressed (and only for that engagement's list); the record keeps choices only
// (a ready-made text, a token template, or "custom text" and its length), so neither a typed text nor the
// name a {client} token brings reaches it. The logo is never remembered, and never named in the record.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Bold, Image as ImageIcon, Italic, Stamp, Type } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Toggle } from '@/components/ui/toggle';
import { useEngagement } from '@/contexts/EngagementContext';
import { cn } from '@/lib/utils';
import { formatDate, type DateFormat } from '@/lib/pdf-tools/pageNumbers';
import { addWatermark, emptyMarkReport, type FontFamily } from '@/lib/pdf-tools/watermark';
import { formatBytes, plural } from '../format';
import { ColourSwatches, SizeChoice } from '../marks/ChoiceControls';
import { logoCandidates } from '../marks/logoIntake';
import MarkedPageOverlay, { OverlayCache } from '../marks/MarkedPageOverlay';
import { fieldsNote, previewNotes, scanNote } from '../marks/markNotes';
import MarkPreviewPane from '../marks/MarkPreviewPane';
import { MARK_TOKEN_HELP, usesToken } from '../marks/markText';
import PlacePicker from '../marks/PlacePicker';
import TokenBar from '../marks/TokenBar';
import { useTokenTarget } from '../marks/useTokenTarget';
import { STAMP_SIZES, WATERMARK_SIZES } from '../marks/units';
import { useCharacterCheck, usePageScan, usePreparedLogo } from '../marks/useMarkData';
import {
  chosenPages,
  defaultWatermarkForm,
  logoSummary,
  markRunLabel,
  presetOf,
  presetText,
  readWatermarkForm,
  STAMP_PRESETS,
  stampSummary,
  WATERMARK_PRESETS,
  watermarkPreviewOptions,
  watermarkResultName,
  watermarkSummary,
  type LogoState,
  type PlaceForm,
  type WatermarkField,
  type WatermarkForm,
} from '../marks/watermarkForm';
import { useWorkingList } from '../useWorkingList';
import PageViewer from '../viewer/PageViewer';
import { describedBy, INVALID_INPUT } from './fieldProps';
import { Field, MoreOptions, Notice, ResultNameField, ToolDialog } from './ToolDialog';
import { useMarkPreview } from './useMarkPreview';
import { useResultName, useToolRun, type ToolDialogProps } from './useToolRun';

const ID = 'pdf-tools-watermark';
const PROBLEM_ID = `${ID}-problem`;
const FONTS: { value: FontFamily; label: string }[] = [
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
type Mark = 'watermark' | 'stamp' | 'logo';

// ---- small parts -------------------------------------------------------------------------------

/** A part of the tool with its own switch: its options show while it is on. */
function Section({ mark, icon: Icon, title, description, on, onChange, children }: {
  mark: Mark;
  icon: typeof Type;
  title: string;
  description: string;
  on: boolean;
  onChange: (on: boolean) => void;
  children: ReactNode;
}) {
  const switchId = mark === 'watermark' ? `${ID}-switch` : `${ID}-${mark}-switch`;
  return (
    <section aria-labelledby={`${switchId}-title`} className={cn('rounded-lg border transition-colors', on ? 'border-primary/40 bg-card shadow-sm' : 'bg-muted/20')}>
      <div className="flex items-center gap-3 px-4 py-2.5">
        <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-md', on ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground')} aria-hidden="true">
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <Label htmlFor={switchId} id={`${switchId}-title`} className="text-sm font-semibold">
            {title}
          </Label>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
        <Switch id={switchId} data-testid={switchId} checked={on} onCheckedChange={onChange} />
      </div>
      {on && <div className="space-y-3 border-t px-4 pb-4 pt-3">{children}</div>}
    </section>
  );
}

/** A number field with its unit inside the box ("%", "°"). */
function UnitInput({ id, testId, unit, value, onChange, error, label, min, max }: {
  id: string;
  testId: string;
  unit: string;
  value: string;
  onChange: (value: string) => void;
  error?: string | null;
  label?: string;
  min: number;
  max: number;
}) {
  return (
    <div className="relative">
      <Input
        {...describedBy(id, error)}
        aria-label={label}
        data-testid={testId}
        className={cn('pr-9 tabular-nums', INVALID_INPUT)}
        type="number"
        inputMode="decimal"
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground" aria-hidden="true">
        {unit}
      </span>
    </div>
  );
}

/** Ready-made texts as small buttons: one press fills the text field, which stays editable. */
function PresetChips({ idPrefix, presets, active, onChoose, disabled }: {
  idPrefix: string;
  presets: readonly { id: string; label: string }[];
  active: string;
  onChoose: (id: string) => void;
  disabled?: (id: string) => string | null;
}) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Ready-made texts">
      {presets.map((preset) => {
        const why = disabled?.(preset.id) ?? null;
        return (
          <button
            key={preset.id}
            type="button"
            data-testid={`${idPrefix}-${preset.id}`}
            aria-pressed={active === preset.id}
            aria-disabled={why !== null || undefined}
            aria-describedby={why ? `${idPrefix}-${preset.id}-why` : undefined}
            onClick={() => why === null && onChoose(preset.id)}
            className={cn(
              'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              active === preset.id ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background text-foreground hover:bg-muted',
              why !== null && 'cursor-not-allowed opacity-60 hover:bg-background',
            )}
          >
            {preset.label}
            {why && (
              <span id={`${idPrefix}-${preset.id}-why`} className="sr-only">
                {why}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ---- the dialog --------------------------------------------------------------------------------

export default function WatermarkDialog(props: ToolDialogProps) {
  const { files, onClose } = props;
  const file = files[0];
  const pageCount = file.pageCount ?? 0;
  const run = useToolRun('watermark', props);
  const { state: list } = useWorkingList();
  const { currentEngagement } = useEngagement();
  const client = currentEngagement?.client_name ?? '';

  // The list this dialog was opened for: nothing is shown once it has moved on.
  const latestProps = useRef(props);
  latestProps.current = props;
  const [opened] = useState(() => props.scope());
  const isCurrent = useCallback(() => {
    const now = latestProps.current.scope();
    return now.contextKey !== null && now.contextKey === opened.contextKey && now.session === opened.session;
  }, [opened]);

  const [today] = useState(() => new Date());
  const [form, setForm] = useState<WatermarkForm>(() => defaultWatermarkForm(pageCount));
  const [picking, setPicking] = useState<Mark | null>(null);
  const check = useCharacterCheck();
  const tokens = useTokenTarget();
  const { clearMessages } = run;

  const set = useCallback(
    (patch: Partial<WatermarkForm>) => {
      setForm((current) => ({ ...current, ...patch }));
      clearMessages();
    },
    [clearMessages],
  );

  // ---- the logo: one of the list's images, made ready here, never remembered ----
  const candidates = useMemo(() => logoCandidates(list.files), [list.files]);
  const logoFile = form.logoOn && form.logoId ? (list.files.find((f) => f.id === form.logoId) ?? null) : null;
  const logo = usePreparedLogo(logoFile, isCurrent);
  useEffect(() => {
    // An image that left the list is no longer offered; with one image in the list, it is chosen for the user.
    if (form.logoId && !candidates.some((c) => c.id === form.logoId)) setForm((f) => ({ ...f, logoId: null }));
    else if (form.logoOn && !form.logoId && candidates.length === 1) setForm((f) => ({ ...f, logoId: candidates[0].id }));
  }, [candidates, form.logoId, form.logoOn]);
  const logoState: LogoState = !form.logoOn || !form.logoId ? 'none' : logo.status === 'ready' ? 'ready' : logo.status === 'error' ? { error: logo.message } : 'preparing';

  // ---- reading the form ----
  const ctx = {
    pageCount,
    check,
    tokens: { date: formatDate(today, form.dateFormat), client },
    logo: logo.status === 'ready' ? { image: logo.full.image, format: logo.full.format } : null,
    logoState,
  };
  const read = readWatermarkForm(form, ctx);
  const errors: Partial<Record<WatermarkField, string>> = read.errors;
  const pages = chosenPages(form, pageCount);
  const chosen = useMemo(() => pages ?? [1], [pages]);
  const name = useResultName(watermarkResultName(file.name, form));

  // ---- preview: the page chosen in the preview, marked by the library ----
  const [previewPage, setPreviewPage] = useState(1);
  const page = chosen.includes(previewPage) ? previewPage : chosen[0];
  const previewLogo = logo.status === 'ready' ? { image: logo.preview.image, format: logo.preview.format } : null;
  const previewOptions = read.options ? watermarkPreviewOptions(read.options, previewLogo) : null;
  const previewKey = previewOptions
    ? JSON.stringify({ ...previewOptions, logo: previewOptions.logo ? { ...previewOptions.logo, image: `${form.logoId}:${previewLogo?.image.length}` } : undefined })
    : null;
  const latestOptions = useRef(previewOptions);
  latestOptions.current = previewOptions;
  const mark = useCallback(async (one: Uint8Array) => {
    // The options of the latest render: the preview hook reads `mark` when it starts drawing that key.
    const report = emptyMarkReport();
    const bytes = await addWatermark(one, latestOptions.current!, { report });
    return { bytes, report };
  }, []);
  const { preview, pending } = useMarkPreview({ bytes: file.bytes, pageIndex: page - 1, key: previewKey, mark, isCurrent });
  const previewProblem = preview?.status === 'error' && preview.blocking ? preview.message : null;
  const notes = preview?.status === 'ready' && preview.report && preview.key === previewKey ? previewNotes(preview.report) : [];

  // ---- notes before the run: scans under a watermark behind, form fields over marks in front ----
  const behind = form.watermarkOn && form.layer === 'behind';
  const inFront = (form.watermarkOn && form.layer === 'front') || form.stampOn || form.logoOn;
  const scan = usePageScan(file.bytes, behind || (inFront && file.hasFormFields === true), isCurrent);
  const scanCount = scan ? chosen.filter((p) => scan.scans.includes(p)).length : 0;
  const scanText = behind && scan ? scanNote(scanCount, chosen.length) : null;
  const fieldsText = inFront && scan ? fieldsNote(chosen.filter((p) => scan.withFields.includes(p)), 'mark') : null;

  // ---- the large view ----
  const [viewing, setViewing] = useState<{ opener: HTMLElement; page: number } | null>(null);
  const overlayCache = useMemo(() => new OverlayCache(), []);
  useEffect(() => () => overlayCache.clear(), [overlayCache]);
  const lastViewed = useRef<number | null>(null);
  const markFor = useCallback((pageIndex: number) => (previewKey && chosen.includes(pageIndex + 1) ? { key: previewKey, mark } : null), [previewKey, chosen, mark]);
  const onPageShown = useCallback((pageIndex: number) => {
    lastViewed.current = pageIndex + 1;
  }, []);

  const setPlace = (which: Mark, place: PlaceForm) => set(which === 'watermark' ? { place } : which === 'stamp' ? { stampPlace: place } : { logoPlace: place });
  const usesDate = (form.watermarkOn && usesToken(form.text, 'date')) || (form.stampOn && usesToken(form.stampText, 'date'));

  const blocked = read.options === null || previewProblem !== null;
  // Why Run waits (UX principle 8), said by the frame on hover, focus and click.
  const blockedReason = blocked ? (read.first ?? previewProblem ?? (read.waiting ? 'Wait a moment: the logo is being made ready.' : 'Check the options above.')) : null;
  const onRun = () => {
    // The client name is this engagement's, read now; Run does nothing for a list that is not its own.
    const scope = props.scope();
    if (!currentEngagement || !isCurrent() || !scope.contextKey?.endsWith(`:${currentEngagement.id}`)) return;
    const final = readWatermarkForm(form, { ...ctx, tokens: { date: formatDate(new Date(), form.dateFormat), client: currentEngagement.client_name ?? '' } });
    if (!final.options) return;
    setPicking(null);
    run.start({ options: final.options, name: name.resolved });
  };

  // Waiting for a click holds only while that mark is on and placed at a point: choosing an anchor (or turning
  // the mark off) ends it, so the preview's Escape listener never outlives what it is for (REV-B S8).
  const placeOfMark = (which: Mark) => (which === 'watermark' ? form.place : which === 'stamp' ? form.stampPlace : form.logoPlace);
  const markOn = (which: Mark) => (which === 'watermark' ? form.watermarkOn : which === 'stamp' ? form.stampOn : form.logoOn);
  const activePick = picking && markOn(picking) && placeOfMark(picking).anchor === 'point' ? picking : null;
  const togglePick = (which: Mark) => setPicking((p) => (p === which ? null : which));
  const pickTip = (which: Mark) => `Click where the ${which} should go.`;

  const textField = (which: 'watermark' | 'stamp') => {
    const isStamp = which === 'stamp';
    const id = isStamp ? `${ID}-stamp-text` : `${ID}-text`;
    const value = isStamp ? form.stampText : form.text;
    const error = isStamp ? errors.stampText : errors.text;
    const write = (text: string) => set(isStamp ? { stampText: text, stampPreset: presetOf(text, client, 'stamp') } : { text, preset: presetOf(text, client, 'watermark') });
    const filled = usesToken(value, 'date') || usesToken(value, 'client') ? value.replace(/\{date\}/gi, ctx.tokens.date).replace(/\{client\}/gi, client) : null;
    return (
      <div className="space-y-2">
        <PresetChips
          idPrefix={isStamp ? `${ID}-stamp-preset` : `${ID}-preset`}
          presets={(isStamp ? STAMP_PRESETS : WATERMARK_PRESETS).filter((p) => p.id !== 'custom')}
          active={isStamp ? form.stampPreset : form.preset}
          disabled={(id) => (id === 'client' && client.trim() === '' ? 'This engagement has no client name. Type the text instead.' : null)}
          onChoose={(id) =>
            isStamp
              ? set({ stampPreset: id as WatermarkForm['stampPreset'], stampText: presetText(id as WatermarkForm['stampPreset'], client) })
              : set({ preset: id as WatermarkForm['preset'], text: presetText(id as WatermarkForm['preset'], client) })
          }
        />
        <Field id={id} label={isStamp ? 'Stamp text' : 'Watermark text'} error={error} hint={filled ? <>Prints as “{filled}”</> : null}>
          <Input
            {...describedBy(id, error, filled)}
            data-testid={id}
            className={INVALID_INPUT}
            maxLength={120}
            spellCheck={false}
            autoComplete="off"
            value={value}
            onChange={(event) => write(event.target.value)}
          />
        </Field>
        <TokenBar
          id={`${id}-tokens`}
          tokens={MARK_TOKEN_HELP}
          onInsert={(token) => {
            // Into this bar's own field, whichever text field was used last (REV-B S2).
            const input = document.getElementById(id) as HTMLInputElement | null;
            if (input) tokens.insertInto({ input, set: write }, token);
          }}
        />
      </div>
    );
  };

  return (
    <ToolDialog
      tool="watermark"
      files={files}
      run={run}
      size="2xl"
      showFile
      description="Put a watermark, a stamp or a logo on a copy of this PDF. The original is not changed."
      runLabel={markRunLabel(form, pages, pageCount)}
      blocked={blocked}
      blockedReason={blockedReason}
      busyNote="Stop takes effect between pages."
      onRun={onRun}
      onClose={onClose}
    >
      <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_280px]">
        <div className="min-w-0 space-y-3">
          {errors.parts && (
            <p role="alert" className="text-xs text-destructive" data-testid="pdf-tools-field-error">
              {errors.parts}
            </p>
          )}

          <Section mark="watermark" icon={Type} title="Watermark" description="Large text across the page, such as DRAFT." on={form.watermarkOn} onChange={(on) => set({ watermarkOn: on })}>
            {textField('watermark')}
            <MoreOptions id={`${ID}-more`} summary={watermarkSummary(form)} invalid={Boolean(errors.size || errors.angle || errors.color || errors.opacity || errors.place)}>
              <div className="flex flex-wrap items-end gap-3">
                <Field id={`${ID}-font`} label="Font" className="w-[150px]">
                  <Select value={form.font} onValueChange={(font) => set({ font: font as FontFamily })}>
                    <SelectTrigger id={`${ID}-font`} data-testid={`${ID}-font`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {FONTS.map((f) => (
                        <SelectItem key={f.value} value={f.value} data-testid={`${ID}-font-${f.value}`}>
                          {f.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <div className="flex gap-1">
                  <Toggle variant="outline" size="sm" aria-label="Bold" data-testid={`${ID}-bold`} pressed={form.bold} onPressedChange={(bold) => set({ bold })}>
                    <Bold className="h-4 w-4" />
                  </Toggle>
                  <Toggle variant="outline" size="sm" aria-label="Italic" data-testid={`${ID}-italic`} pressed={form.italic} onPressedChange={(italic) => set({ italic })}>
                    <Italic className="h-4 w-4" />
                  </Toggle>
                </div>
              </div>
              <SizeChoice
                id={`${ID}-size`}
                label="Size"
                presets={WATERMARK_SIZES}
                value={form.sizeMode}
                onChange={(sizeMode) => set({ sizeMode: sizeMode as WatermarkForm['sizeMode'] })}
                auto={{ label: 'Auto', hint: 'As large as fits each page.' }}
                mm={form.sizeMm}
                onMm={(sizeMm) => set({ sizeMm })}
                measure="letter"
                error={errors.size}
              />
              <Field id={`${ID}-angle`} label="Angle" error={errors.angle} hint={form.angleMode === 'diagonal' ? 'Corner to corner of each page.' : null}>
                <div className="flex gap-2">
                  <Select value={form.angleMode} onValueChange={(angleMode) => set({ angleMode: angleMode as WatermarkForm['angleMode'] })}>
                    <SelectTrigger id={`${ID}-angle`} data-testid={`${ID}-angle`} className="w-[160px] shrink-0">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="diagonal">Diagonal</SelectItem>
                      <SelectItem value="horizontal" data-testid={`${ID}-angle-horizontal`}>
                        Horizontal
                      </SelectItem>
                      <SelectItem value="vertical" data-testid={`${ID}-angle-vertical`}>
                        Vertical
                      </SelectItem>
                      <SelectItem value="custom" data-testid={`${ID}-angle-custom`}>
                        Other angle
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  {form.angleMode === 'custom' && (
                    <div className="w-24">
                      <UnitInput id={`${ID}-angle-value`} testId={`${ID}-angle-value`} label="Angle in degrees, -90 to 90" unit="°" value={form.angle} onChange={(angle) => set({ angle })} error={errors.angle} min={-90} max={90} />
                    </div>
                  )}
                </div>
              </Field>
              <ColourSwatches id={`${ID}-color`} label="Colour" value={form.color} onChange={(color) => set({ color })} error={errors.color} />
              <Field id={`${ID}-opacity`} label="Opacity" error={errors.opacity} className="w-[150px]">
                <UnitInput id={`${ID}-opacity`} testId={`${ID}-opacity`} unit="%" value={form.opacity} onChange={(opacity) => set({ opacity })} error={errors.opacity} min={5} max={100} />
              </Field>
              <div className="space-y-1.5">
                <p id={`${ID}-layer-label`} className="text-sm font-medium leading-none">
                  Layer
                </p>
                <RadioGroup aria-labelledby={`${ID}-layer-label`} value={form.layer} onValueChange={(layer) => set({ layer: layer as WatermarkForm['layer'] })} className="flex flex-wrap gap-x-5 gap-y-1.5 pt-1">
                  <div className="flex items-center gap-2">
                    <RadioGroupItem id={`${ID}-layer-front`} value="front" data-testid={`${ID}-layer-front`} />
                    <Label htmlFor={`${ID}-layer-front`} className="font-normal">
                      In front of the page <span className="text-xs text-muted-foreground">Recommended</span>
                    </Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <RadioGroupItem id={`${ID}-layer-behind`} value="behind" data-testid={`${ID}-layer-behind`} />
                    <Label htmlFor={`${ID}-layer-behind`} className="font-normal">
                      Behind the page
                    </Label>
                  </div>
                </RadioGroup>
              </div>
              <PlacePicker id={`${ID}-place`} what="watermark" value={form.place} onChange={(place) => setPlace('watermark', place)} picking={activePick === 'watermark'} onPick={() => togglePick('watermark')} error={errors.place} />
            </MoreOptions>
            {scanText && (
              <div className="flex flex-wrap items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2" data-testid={`${ID}-scan-note`} role="status">
                <p className="min-w-0 flex-1 text-xs text-foreground">{scanText}</p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  data-testid={`${ID}-use-front`}
                  onClick={() => {
                    // This note and its button go once the watermark is in front: the focus moves to the fold line first (REV-B S7).
                    document.querySelector<HTMLElement>(`[data-testid="${ID}-more"]`)?.focus();
                    set({ layer: 'front' });
                  }}
                >
                  Put it in front
                </Button>
              </div>
            )}
          </Section>

          <Section mark="stamp" icon={Stamp} title="Stamp" description="A short line such as VERIFIED, in a corner." on={form.stampOn} onChange={(on) => set({ stampOn: on })}>
            {textField('stamp')}
            <MoreOptions id={`${ID}-stamp-more`} summary={stampSummary(form)} invalid={Boolean(errors.stampSize || errors.stampAngle || errors.stampColor || errors.stampOpacity || errors.stampPlace)}>
              <SizeChoice
                id={`${ID}-stamp-size`}
                label="Size"
                presets={STAMP_SIZES}
                value={form.stampSizeMode}
                onChange={(stampSizeMode) => set({ stampSizeMode: stampSizeMode as WatermarkForm['stampSizeMode'] })}
                mm={form.stampSizeMm}
                onMm={(stampSizeMm) => set({ stampSizeMm })}
                measure="letter"
                error={errors.stampSize}
              />
              <div className="flex flex-wrap items-end gap-3">
                <Field id={`${ID}-stamp-angle`} label="Angle" error={errors.stampAngle} className="w-[120px]">
                  <UnitInput id={`${ID}-stamp-angle`} testId={`${ID}-stamp-angle`} unit="°" value={form.stampAngle} onChange={(stampAngle) => set({ stampAngle })} error={errors.stampAngle} min={-90} max={90} />
                </Field>
                <Field id={`${ID}-stamp-opacity`} label="Opacity" error={errors.stampOpacity} className="w-[120px]">
                  <UnitInput id={`${ID}-stamp-opacity`} testId={`${ID}-stamp-opacity`} unit="%" value={form.stampOpacity} onChange={(stampOpacity) => set({ stampOpacity })} error={errors.stampOpacity} min={5} max={100} />
                </Field>
                <Toggle variant="outline" size="sm" aria-label="Bold stamp" data-testid={`${ID}-stamp-bold`} pressed={form.stampBold} onPressedChange={(stampBold) => set({ stampBold })} className="mb-0.5">
                  <Bold className="h-4 w-4" />
                </Toggle>
              </div>
              <ColourSwatches id={`${ID}-stamp-color`} label="Colour" value={form.stampColor} onChange={(stampColor) => set({ stampColor })} error={errors.stampColor} />
              <PlacePicker id={`${ID}-stamp-place`} what="stamp" value={form.stampPlace} onChange={(place) => setPlace('stamp', place)} picking={activePick === 'stamp'} onPick={() => togglePick('stamp')} error={errors.stampPlace} />
            </MoreOptions>
          </Section>

          <Section mark="logo" icon={ImageIcon} title="Logo" description="An image from the file list, such as the firm's logo." on={form.logoOn} onChange={(on) => set({ logoOn: on })}>
            {candidates.length === 0 ? (
              <Notice tone="neutral" title="There is no image in the file list" testId={`${ID}-logo-none`}>
                Add the logo (a PNG or JPG) to the list from the computer or the Evidence Vault, then choose it here.
              </Notice>
            ) : (
              <Field
                id={`${ID}-logo-select`}
                label="Image"
                error={errors.logo}
                hint={
                  logo.status === 'ready' ? (
                    <span data-testid={`${ID}-logo-status`}>
                      Ready{logo.full.changed.length > 0 ? `: ${[logo.full.changed.includes('turned') ? 'turned upright' : '', logo.full.changed.includes('cmyk') ? 'colours converted for screens' : '', logo.full.changed.includes('large') ? 'made smaller' : ''].filter(Boolean).join(', ')}` : ''}. Not remembered after this dialog closes.
                    </span>
                  ) : logo.status === 'preparing' ? (
                    <span data-testid={`${ID}-logo-status`}>Getting the image ready…</span>
                  ) : (
                    'Not remembered after this dialog closes.'
                  )
                }
              >
                <Select value={form.logoId ?? ''} onValueChange={(logoId) => set({ logoId })}>
                  <SelectTrigger id={`${ID}-logo-select`} data-testid={`${ID}-logo-select`} {...describedBy(`${ID}-logo-select`, errors.logo, 'hint')}>
                    <SelectValue placeholder="Choose an image" />
                  </SelectTrigger>
                  <SelectContent>
                    {candidates.map((c, i) => (
                      <SelectItem key={c.id} value={c.id} data-testid={`${ID}-logo-option-${i + 1}`}>
                        {c.name} ({formatBytes(c.size)})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
            <MoreOptions id={`${ID}-logo-more`} summary={logoSummary(form)} invalid={Boolean(errors.logoWidth || errors.logoOpacity || errors.logoPlace)}>
              <div className="flex flex-wrap items-end gap-3">
                <Field id={`${ID}-logo-width`} label="Width, share of the page" error={errors.logoWidth} className="w-[180px]">
                  <UnitInput id={`${ID}-logo-width`} testId={`${ID}-logo-width`} unit="%" value={form.logoWidth} onChange={(logoWidth) => set({ logoWidth })} error={errors.logoWidth} min={5} max={50} />
                </Field>
                <Field id={`${ID}-logo-opacity`} label="Opacity" error={errors.logoOpacity} className="w-[120px]">
                  <UnitInput id={`${ID}-logo-opacity`} testId={`${ID}-logo-opacity`} unit="%" value={form.logoOpacity} onChange={(logoOpacity) => set({ logoOpacity })} error={errors.logoOpacity} min={10} max={100} />
                </Field>
              </div>
              <PlacePicker id={`${ID}-logo-place`} what="logo" value={form.logoPlace} onChange={(place) => setPlace('logo', place)} picking={activePick === 'logo'} onPick={() => togglePick('logo')} error={errors.logoPlace} />
            </MoreOptions>
          </Section>

          <div className="space-y-1.5 rounded-lg border px-4 py-3">
            <p id={`${ID}-pages-label`} className="text-sm font-medium leading-none">
              Pages
            </p>
            <RadioGroup aria-labelledby={`${ID}-pages-label`} data-testid={`${ID}-pages`} value={form.pages} onValueChange={(next) => set({ pages: next as WatermarkForm['pages'] })} className="gap-2 pt-1">
              <div className="flex items-center gap-2">
                <RadioGroupItem id={`${ID}-pages-all`} value="all" data-testid={`${ID}-pages-all`} />
                <Label htmlFor={`${ID}-pages-all`} className="font-normal">
                  {pageCount === 1 ? 'The page' : `All ${pageCount} pages`}
                </Label>
              </div>
              {pageCount > 1 && (
                <div className="flex flex-wrap items-center gap-2">
                  <RadioGroupItem id={`${ID}-pages-range`} value="range" data-testid={`${ID}-pages-range`} />
                  <Label htmlFor={`${ID}-pages-range`} className="font-normal">
                    From page
                  </Label>
                  <Input
                    aria-label="First page to mark"
                    data-testid={`${ID}-from`}
                    aria-invalid={errors.pages ? true : undefined}
                    aria-describedby={errors.pages ? `${ID}-pages-message` : undefined}
                    className={cn('h-8 w-20', INVALID_INPUT)}
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={pageCount}
                    disabled={form.pages !== 'range'}
                    value={form.from}
                    onChange={(event) => set({ from: event.target.value })}
                  />
                  <span className="text-sm">to</span>
                  <Input
                    aria-label="Last page to mark"
                    data-testid={`${ID}-to`}
                    aria-invalid={errors.pages ? true : undefined}
                    aria-describedby={errors.pages ? `${ID}-pages-message` : undefined}
                    className={cn('h-8 w-20', INVALID_INPUT)}
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={pageCount}
                    disabled={form.pages !== 'range'}
                    value={form.to}
                    onChange={(event) => set({ to: event.target.value })}
                  />
                </div>
              )}
              {pageCount > 1 && (
                <div className="flex items-center gap-2">
                  <RadioGroupItem id={`${ID}-pages-first`} value="first" data-testid={`${ID}-pages-first`} />
                  <Label htmlFor={`${ID}-pages-first`} className="font-normal">
                    The first page only
                  </Label>
                </div>
              )}
            </RadioGroup>
            {errors.pages ? (
              <p id={`${ID}-pages-message`} role="alert" className="text-xs text-destructive" data-testid="pdf-tools-field-error">
                {errors.pages}
              </p>
            ) : (
              form.pages === 'first' && <p className="text-xs text-muted-foreground">Everything that is on, the watermark included, goes on page 1 only.</p>
            )}
          </div>

          {usesDate && (
            <Field id={`${ID}-date-format`} label="Write {date} as" hint={`Today: ${formatDate(today, form.dateFormat)}`}>
              <Select value={form.dateFormat} onValueChange={(dateFormat) => set({ dateFormat: dateFormat as DateFormat })}>
                <SelectTrigger id={`${ID}-date-format`} data-testid={`${ID}-date-format`} className="sm:w-[220px]">
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

          {fieldsText && (
            <Notice tone="info" title="Form fields on the chosen pages" testId={`${ID}-fields-note`} role="status">
              {fieldsText}
            </Notice>
          )}

          <ResultNameField name={name} />
        </div>

        <div className="md:sticky md:top-0 md:self-start">
          <MarkPreviewPane
            id={`${ID}-preview`}
            preview={preview && (preview.status === 'ready' ? preview : { status: 'error', message: preview.message, blocking: preview.blocking })}
            pending={pending || (form.logoOn && logo.status === 'preparing')}
            page={page}
            pages={chosen}
            onPage={setPreviewPage}
            picking={activePick ? pickTip(activePick) : null}
            onPick={(point) => {
              if (!activePick) return;
              setPlace(activePick, { anchor: 'point', x: String(point.x), y: String(point.y) });
              setPicking(null);
            }}
            onStopPicking={() => setPicking(null)}
            onExpand={(opener) => {
              setPicking(null); // the viewer takes Escape for itself
              setViewing({ opener, page });
            }}
            alt={`Page ${page} with the marks as they will be added`}
            notes={notes}
            problem={read.first ?? previewProblem}
            // A field's problem is read out at the field; said here too, it would be read out twice (REV-B minor 6).
            problemAlert={read.first === null}
            problemId={PROBLEM_ID}
          />
          {pages && pages.length > 0 && <p className="mt-1.5 px-1 text-xs text-muted-foreground">{plural(pages.length, 'page')} will be marked.</p>}
        </div>
      </div>

      {viewing && (
        <PageViewer
          file={file}
          startPage={viewing.page}
          returnFocusTo={viewing.opener}
          onClose={() => {
            const seen = lastViewed.current;
            if (seen !== null && chosen.includes(seen)) setPreviewPage(seen);
            overlayCache.clear();
            setViewing(null);
          }}
          overlay={(surface) => (
            <MarkedPageOverlay
              surface={surface}
              bytes={file.bytes}
              markFor={markFor}
              cache={overlayCache}
              seed={preview?.status === 'ready' ? { key: preview.key, pageIndex: preview.pageIndex, url: preview.url } : null}
              isCurrent={isCurrent}
              onPageShown={onPageShown}
            />
          )}
        />
      )}
    </ToolDialog>
  );
}
