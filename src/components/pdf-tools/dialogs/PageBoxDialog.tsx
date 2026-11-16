// The Resize or crop pages dialog (owner decision, 15 November 2026; owner's instruction of the same day:
// keep it simple, open on the common case). One tool, two plain choices:
// - Make every page one size: A4 unless another size is chosen from one drop-down; the content is scaled
//   to fit and centred, never stretched. It opens ready to run. Direction, small pages, margin, an own
//   size in mm and the result name are under "More options". Pages already that size are left exactly
//   as they are.
// - Crop the pages: four number boxes and a frame on the preview that the mouse drags and the arrow keys
//   move, in step. The dialog says that trimming hides and does not remove (lead's ruling: point to
//   Redact). Swapping left and right on even pages, adding white space instead of trimming and the result
//   name are under "More options".
// No technical words on screen; one short sentence per outcome. Plain data and checks are in
// pagebox/pageBoxForm.ts; the run step is pageBoxRun.ts.
//
// Confidentiality: the dialog's scope is captured when it opens; page sizes and the preview are shown
// only while the list is still that scope's, and Run does nothing for a list that is not its own.
import { useCallback, useMemo, useRef, useState } from 'react';
import { EyeOff } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { PT_PER_MM, type PageBoxOptions } from '@/lib/pdf-tools/pageBox';
import type { ToolId } from '@/lib/pdf-tools/types';
import { plural } from '../format';
import { SizeChoice } from '../marks/ChoiceControls';
import { chosenPages } from '../marks/watermarkForm';
import CropFrame from '../pagebox/CropFrame';
import EdgeFields from '../pagebox/EdgeFields';
import PageBoxPreview from '../pagebox/PageBoxPreview';
import {
  defaultPageBoxForm,
  edgesMm,
  MARGIN_PRESETS,
  cropSummary,
  pageBoxResultName,
  pageBoxRunLabel,
  pageSizeText,
  PAPER_CHOICES,
  readPageBoxForm,
  resizeSummary,
  sameNote,
  shownEdges,
  sizeLabel,
  type EdgesMm,
  type MarginChoice,
  type PageBoxForm,
} from '../pagebox/pageBoxForm';
import { usePageBoxPreview, usePageShapes } from '../pagebox/usePageBoxData';
import type { PageBoxRunOptions } from '../pageBoxRun';
import { INVALID_INPUT } from './fieldProps';
import { ChoiceCards, Field, MoreOptions, Notice, ResultNameField, ToolDialog } from './ToolDialog';
import { useResultName, useToolRun, type ToolDialogProps } from './useToolRun';

const TOOL = 'resize-crop' satisfies ToolId;
const ID = 'pdf-tools-page-box';
const TRIM_NOTE = 'Trimmed parts are hidden, not removed. To remove content, use Redact.';
/** What the trim preview is drawn from when the edges are not valid: only its mode matters (the page as it is). */
const TRIM_AS_IS: PageBoxOptions = { mode: 'trim', sides: { left: 0, top: 0, right: 0, bottom: 0 }, mirror: false, pages: { from: 1, to: 1 } };
/** An edge the frame can show: one that cannot be read is shown at 0. */
const usable = (mm: number) => (Number.isFinite(mm) && mm >= 0 ? mm : 0);

export default function PageBoxDialog(props: ToolDialogProps) {
  const { files, onClose } = props;
  const file = files[0];
  const pageCount = file.pageCount ?? 0;
  const run = useToolRun(TOOL, props);

  // The list this dialog was opened for: nothing is shown once it has moved on.
  const latestProps = useRef(props);
  latestProps.current = props;
  const [opened] = useState(() => props.scope());
  const isCurrent = useCallback(() => {
    const now = latestProps.current.scope();
    return now.contextKey !== null && now.contextKey === opened.contextKey && now.session === opened.session;
  }, [opened]);

  const [form, setForm] = useState<PageBoxForm>(() => defaultPageBoxForm(pageCount));
  const [announcement, setAnnouncement] = useState('');
  const { clearMessages } = run;
  const set = useCallback(
    (patch: Partial<PageBoxForm>) => {
      setForm((current) => ({ ...current, ...patch }));
      clearMessages();
    },
    [clearMessages],
  );

  // ---- reading the form: with every page's size once read, every chosen page is checked as the run will ----
  const shapes = usePageShapes(file.bytes, isCurrent);
  const reading = readPageBoxForm(form, { pageCount, shapes });
  const loose = readPageBoxForm(form, { pageCount, shapes: null }); // the preview's options: field checks only
  const { errors } = reading;
  const pages = chosenPages(form, pageCount);
  const chosen = useMemo(() => pages ?? [1], [pages]);
  const name = useResultName(pageBoxResultName(file.name, form));
  const resize = form.mode === 'resize';
  const trim = !resize && form.cropKind === 'trim';

  // ---- the preview ----
  const [previewPage, setPreviewPage] = useState(1);
  const page = chosen.includes(previewPage) ? previewPage : chosen[0];
  // A trim is drawn as the page as it is with the frame over it, whatever the edges say: while they are not
  // valid (all four at 0, a letter typed) the frame stays, at 0 for an edge that cannot be read, so a drag or
  // the keys never lose it (REV-B S6).
  const previewOptions = trim ? (loose.options ?? TRIM_AS_IS) : loose.options;
  const { preview, pending, key: previewKey } = usePageBoxPreview({ bytes: file.bytes, pageIndex: page - 1, options: previewOptions, isCurrent });
  const shape = shapes?.[page - 1] ?? null;
  const edges: EdgesMm = edgesMm(form);
  const frameEdges: EdgesMm = { left: usable(edges.left), top: usable(edges.top), right: usable(edges.right), bottom: usable(edges.bottom) };
  const setEdges = (next: EdgesMm, said: string) => {
    set({ edges: { left: String(next.left), top: String(next.top), right: String(next.right), bottom: String(next.bottom) } });
    setAnnouncement(said);
  };
  // The picture of the current request only: the crop frame is never drawn over an older picture (a resized page).
  const ready = preview?.status === 'ready' && preview.pageIndex === page - 1 && preview.key === previewKey ? preview : null;
  const notes: string[] = [];
  if (resize && ready?.unchanged) notes.push(`Page ${page} is already ${sizeLabel(form)}: it stays exactly as it is.`);
  const caption = shape ? captionFor(form, shape.width, shape.height, page, ready?.status === 'ready' ? ready : null) : null;

  const blocked = reading.options === null;
  const blockedReason = blocked ? (reading.first ?? 'Check the options above.') : null;
  const onRun = () => {
    if (!isCurrent()) return;
    const final = readPageBoxForm(form, { pageCount, shapes });
    if (!final.options) return;
    const options: PageBoxRunOptions = { options: final.options, name: name.resolved };
    run.start(options);
  };

  const pagesBlock = (
    <div className="space-y-1.5 rounded-lg border px-4 py-3">
      <p id={`${ID}-pages-label`} className="text-sm font-medium leading-none">
        Pages
      </p>
      <RadioGroup aria-labelledby={`${ID}-pages-label`} data-testid={`${ID}-pages`} value={form.pages} onValueChange={(next) => set({ pages: next as PageBoxForm['pages'] })} className="gap-2 pt-1">
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
              aria-label="First page to change"
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
              aria-label="Last page to change"
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
      </RadioGroup>
      {errors.pages && (
        <p id={`${ID}-pages-message`} role="alert" className="text-xs text-destructive" data-testid="pdf-tools-field-error">
          {errors.pages}
        </p>
      )}
    </div>
  );

  return (
    <ToolDialog
      tool={TOOL}
      files={files}
      run={run}
      size="2xl"
      showFile
      description="Make every page of a copy one size, or crop its pages. The original is not changed."
      runLabel={pageBoxRunLabel(form, reading, pageCount)}
      blocked={blocked}
      blockedReason={blockedReason}
      busyNote="Stop takes effect between pages."
      onRun={onRun}
      onClose={onClose}
    >
      <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_280px]">
        <div className="min-w-0 space-y-4">
          <div data-testid={`${ID}-mode`}>
            <ChoiceCards
              label="What to do"
              value={form.mode}
              onChange={(mode) => set({ mode })}
              columns={2}
              compact
              testIdPrefix={`${ID}-mode`}
              choices={[
                { value: 'resize', label: 'Make every page one size', description: 'A4, or another size you choose.' },
                { value: 'crop', label: 'Crop the pages', description: 'Trim the edges, shown by a frame on the preview.' },
              ]}
            />
          </div>

          {resize ? (
            <>
              <Field
                id={`${ID}-paper`}
                label="Page size"
                hint={reading.counts && reading.counts.same > 0 && reading.counts.change > 0 ? <span data-testid={`${ID}-same-note`}>{sameNote(reading.counts, sizeLabel(form))}</span> : null}
              >
                <Select value={form.paper} onValueChange={(paper) => set({ paper: paper as PageBoxForm['paper'] })}>
                  <SelectTrigger id={`${ID}-paper`} data-testid={`${ID}-paper`} className="sm:w-[280px]" aria-describedby={`${ID}-paper-message`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAPER_CHOICES.map((p) => (
                      <SelectItem key={p.id} value={p.id} data-testid={`${ID}-paper-${p.id}`}>
                        {p.id === 'custom' ? 'Own size (set under More options)' : `${p.label} (${p.detail})`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              {pagesBlock}

              {/* An own size holds the fold open: its two boxes belong to the size just chosen. */}
              <MoreOptions id={`${ID}-more`} summary={resizeSummary(form)} invalid={Boolean(errors.margin || errors.size) || form.paper === 'custom'}>
                {form.paper === 'custom' && (
                  <div className="space-y-1.5">
                    <p className="text-sm font-medium leading-none">Own size</p>
                    <div className="flex flex-wrap items-center gap-2">
                      <MmInput id={`${ID}-width`} label="Width in millimetres" value={form.width} onChange={(width) => set({ width })} error={errors.size} messageId={`${ID}-size-message`} />
                      <span className="text-sm text-muted-foreground" aria-hidden="true">
                        ×
                      </span>
                      <MmInput id={`${ID}-height`} label="Height in millimetres" value={form.height} onChange={(height) => set({ height })} error={errors.size} messageId={`${ID}-size-message`} />
                    </div>
                    {errors.size && (
                      <p id={`${ID}-size-message`} role="alert" className="text-xs text-destructive" data-testid="pdf-tools-field-error">
                        {errors.size}
                      </p>
                    )}
                  </div>
                )}
                <div className="space-y-1.5">
                  <p id={`${ID}-direction-label`} className="text-sm font-medium leading-none">
                    Direction
                  </p>
                  <RadioGroup aria-labelledby={`${ID}-direction-label`} value={form.direction} onValueChange={(direction) => set({ direction: direction as PageBoxForm['direction'] })} className="gap-1.5 pt-1">
                    {(
                      [
                        ['keep', "Keep each page's direction"],
                        ['portrait', 'Make every page portrait'],
                        ['landscape', 'Make every page landscape'],
                      ] as const
                    ).map(([value, label]) => (
                      <div key={value} className="flex items-center gap-2">
                        <RadioGroupItem id={`${ID}-direction-${value}`} value={value} data-testid={`${ID}-direction-${value}`} />
                        <Label htmlFor={`${ID}-direction-${value}`} className="font-normal">
                          {label}
                          {value === 'keep' && <span className="text-xs text-muted-foreground"> Recommended</span>}
                        </Label>
                      </div>
                    ))}
                  </RadioGroup>
                </div>
                <SwitchRow id={`${ID}-small`} label="Do not enlarge small pages" hint="A receipt stays receipt-sized, in the middle of the page." recommended checked={!form.enlarge} onChange={(on) => set({ enlarge: !on })} />
                <SizeChoice
                  id={`${ID}-margin`}
                  label="Margin around the content"
                  presets={MARGIN_PRESETS}
                  value={form.margin}
                  onChange={(margin) => set({ margin: margin as MarginChoice })}
                  mm={form.marginMm}
                  onMm={(marginMm) => set({ marginMm })}
                  measure="distance"
                  error={errors.margin}
                />
                <ResultNameField name={name} />
              </MoreOptions>
            </>
          ) : (
            <>
              {trim && (
                <Notice tone="info" icon={EyeOff} title="Trimming hides, it does not remove" testId={`${ID}-hidden-note`}>
                  {TRIM_NOTE}
                </Notice>
              )}

              <EdgeFields
                id={`${ID}-edge`}
                label={trim ? 'How much to trim' : 'White space to add'}
                values={form.edges}
                onChange={(edge, value) => set({ edges: { ...form.edges, [edge]: value } })}
                error={errors.edges}
                hint={trim ? 'Or drag the frame on the preview.' : 'Each page grows by these widths.'}
              />

              {pagesBlock}

              <MoreOptions id={`${ID}-more`} summary={cropSummary(form)}>
                <SwitchRow id={`${ID}-mirror`} label="Swap left and right on even pages" hint="For pages printed on both sides." checked={form.mirror} onChange={(mirror) => set({ mirror })} />
                <SwitchRow id={`${ID}-add`} label="Add white space instead of trimming" hint="Each page grows by the widths above; nothing is trimmed." checked={form.cropKind === 'margin'} onChange={(on) => set({ cropKind: on ? 'margin' : 'trim' })} />
                <ResultNameField name={name} />
              </MoreOptions>
            </>
          )}
        </div>

        <div className="md:sticky md:top-0 md:self-start">
          <PageBoxPreview
            id={`${ID}-preview`}
            preview={preview}
            pending={pending}
            page={page}
            pages={chosen}
            onPage={(p) => {
              setPreviewPage(p);
              setAnnouncement('');
            }}
            alt={trim ? `Page ${page} with the crop frame` : `Page ${page} as it will be`}
            overlay={
              trim && ready && shape ? (
                <CropFrame id={`${ID}-frame`} edges={frameEdges} mirror={form.mirror} page={page} shape={shape} onChange={setEdges} disabled={run.phase !== 'idle'} />
              ) : null
            }
            caption={caption}
            notes={notes}
            problem={reading.first && reading.options === null ? reading.first : null}
            announcement={announcement}
            maxHeight={300}
          />
          {pages && pages.length > 0 && (
            <p className="mt-1.5 px-1 text-xs text-muted-foreground" data-testid={`${ID}-count`}>
              {reading.counts ? `${plural(reading.counts.change, 'page')} will change.` : `${plural(pages.length, 'page')} chosen.`}
            </p>
          )}
        </div>
      </div>
    </ToolDialog>
  );
}

/** The page's size and what it becomes ("216 × 279 mm (Letter) → 210 × 297 mm (A4)"). */
function captionFor(form: PageBoxForm, width: number, height: number, page: number, ready: { width: number; height: number; pxPerPt: number } | null) {
  const before = pageSizeText(width, height);
  let after: string | null = null;
  if (form.mode === 'crop' && form.cropKind === 'trim') {
    // A trim is drawn as a frame over the page as it is: the new size comes from the edges.
    const e = shownEdges(edgesMm(form), form.mirror, page);
    const w = width - (e.left + e.right) * PT_PER_MM;
    const h = height - (e.top + e.bottom) * PT_PER_MM;
    if (w > 0 && h > 0) after = pageSizeText(w, h);
  } else if (ready) {
    // The picture is the run's own result for this page: its size in pixels gives the page's new size.
    after = pageSizeText(ready.width / ready.pxPerPt, ready.height / ready.pxPerPt);
  }
  return !after || before === after ? `This page: ${before}` : `This page: ${before} → ${after}`;
}

/** A switch with its label and one line of explanation. */
function SwitchRow({ id, label, hint, checked, onChange, recommended = false }: { id: string; label: string; hint: string; checked: boolean; onChange: (on: boolean) => void; recommended?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <Label htmlFor={id} className="font-normal leading-snug">
        {label}
        {recommended && <span className="text-xs text-muted-foreground"> Recommended</span>}
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </Label>
      <Switch id={id} data-testid={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

/** A number of millimetres with "mm" inside the box. */
function MmInput({ id, label, value, onChange, error, messageId }: { id: string; label: string; value: string; onChange: (value: string) => void; error?: string | null; messageId: string }) {
  return (
    <div className="relative w-28">
      <Input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? messageId : undefined}
        aria-label={label}
        data-testid={id}
        className={cn('pr-10 tabular-nums', INVALID_INPUT)}
        inputMode="decimal"
        autoComplete="off"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground" aria-hidden="true">
        mm
      </span>
    </div>
  );
}

