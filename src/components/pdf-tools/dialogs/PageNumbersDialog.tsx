import { useState } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { pageNumberLabel, type NumberFormat, type NumberPosition } from '@/lib/pdf-tools/pageNumbers';
import { defaultResultName } from '@/lib/pdf-tools/resultNames';
import { closeUpOffset, defaultPageNumberForm, PAGE_NUMBER_LIMITS, ptToMm, readPageNumberForm, type PageNumberForm } from '../toolOptions';
import { INVALID_INPUT } from './fieldProps';
import { Field, ResultNameField, ToolDialog } from './ToolDialog';
import { usePageNumberPreview } from './usePageNumberPreview';
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
  { value: 'page-n', label: 'Page 1' },
  { value: 'n-of-total', label: '1 of N' },
  { value: 'page-n-of-total', label: 'Page 1 of N' },
  { value: 'custom', label: 'Custom text' },
];
const CLOSE_UP = { width: 236, height: 76 };
/** The one message for a problem with the options; invalid inputs point to it. */
const PROBLEM_ID = 'pdf-tools-number-problem';

/** Six corners and edges on a small page; arrow keys move between them. */
function PositionPicker({ value, onChange }: { value: NumberPosition; onChange: (value: NumberPosition) => void }) {
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
  const [form, setForm] = useState<PageNumberForm>(() => defaultPageNumberForm(pageCount));
  const name = useResultName(defaultResultName('page-numbers', file.name));
  const read = readPageNumberForm(form, pageCount);
  const { preview, pending } = usePageNumberPreview(file.bytes, read.options);

  const set = <K extends keyof PageNumberForm>(key: K, value: PageNumberForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    run.clearMessages();
  };

  const previewProblem = preview?.status === 'error' && preview.blocking ? preview.message : null;
  const problem = read.error ?? previewProblem;
  // The inputs the problem is about: marked invalid and pointed at the message, which is an alert.
  const previewCode = preview?.status === 'error' && preview.blocking ? preview.code : undefined;
  const invalid = new Set<string>(
    read.field
      ? [read.field]
      : previewCode === 'unsupported-characters'
        ? ['prefix', 'suffix']
        : previewCode === 'invalid-number-options' // does not fit on a page
          ? ['fontSize', 'marginPt', ...(form.format === 'custom' ? ['prefix', 'suffix'] : [])]
          : [],
  );
  const marked = (field: string, hintId?: string) => ({
    'aria-invalid': invalid.has(field) ? true : undefined,
    'aria-describedby': [invalid.has(field) ? PROBLEM_ID : null, hintId].filter(Boolean).join(' ') || undefined,
  });
  const margin = Number(form.marginPt);
  const numbers = read.options && {
    first: read.options.startNumber,
    last: read.options.startNumber + read.options.toPage - read.options.fromPage,
  };
  const sample =
    read.options && numbers
      ? { first: pageNumberLabel(read.options, numbers.first, numbers.last), last: pageNumberLabel(read.options, numbers.last, numbers.last) }
      : null;

  const offset =
    preview?.status === 'ready'
      ? closeUpOffset({
          imageWidth: preview.width,
          imageHeight: preview.height,
          pxPerPt: preview.pxPerPt,
          position: preview.options.position,
          marginPt: preview.options.marginPt,
          fontSize: preview.options.fontSize,
          viewWidth: CLOSE_UP.width,
          viewHeight: CLOSE_UP.height,
        })
      : null;

  const numberInput = (key: 'startNumber' | 'fontSize' | 'marginPt', limits: { min: number; max: number }, step = 1) => (
    <Input
      id={`pdf-tools-number-${key}`}
      data-testid={`pdf-tools-number-${key}`}
      {...marked(key, `pdf-tools-number-${key}-message`)}
      className={INVALID_INPUT}
      type="number"
      inputMode="numeric"
      min={limits.min}
      max={limits.max}
      step={step}
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
      description="Add page numbers or a working-paper reference. Each number is placed by the page's own size and rotation; nothing else on the page changes."
      runLabel="Add page numbers"
      blocked={problem !== null}
      onRun={() => read.options && run.start({ numbers: read.options, name: name.resolved })}
      onClose={onClose}
    >
      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_260px]">
        <div className="min-w-0 space-y-4">
          <div className="grid gap-4 sm:grid-cols-[auto_minmax(0,1fr)]">
            <PositionPicker value={form.position} onChange={(position) => set('position', position)} />
            <div className="min-w-0 space-y-3">
              <Field id="pdf-tools-number-format" label="Format">
                <Select value={form.format} onValueChange={(value) => set('format', value as NumberFormat)}>
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
                    <Input
                      id="pdf-tools-number-prefix"
                      data-testid="pdf-tools-number-prefix"
                      {...marked('prefix')}
                      className={INVALID_INPUT}
                      placeholder="WP-A1 / "
                      maxLength={60}
                      value={form.prefix}
                      onChange={(event) => set('prefix', event.target.value)}
                    />
                  </Field>
                  <Field id="pdf-tools-number-suffix" label="After the number">
                    <Input
                      id="pdf-tools-number-suffix"
                      data-testid="pdf-tools-number-suffix"
                      {...marked('suffix')}
                      className={INVALID_INPUT}
                      maxLength={60}
                      value={form.suffix}
                      onChange={(event) => set('suffix', event.target.value)}
                    />
                  </Field>
                </div>
              )}
              {sample !== null && (
                <p className="text-xs text-muted-foreground" data-testid="pdf-tools-number-sample">
                  From <span className="font-medium text-foreground">{sample.first}</span> to{' '}
                  <span className="font-medium text-foreground">{sample.last}</span>
                </p>
              )}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-[120px_minmax(0,1fr)]">
            <Field id="pdf-tools-number-startNumber" label="Start at" hint="0 to 1,000,000">
              {numberInput('startNumber', PAGE_NUMBER_LIMITS.startNumber)}
            </Field>
            <div className="space-y-1.5">
              <p id="pdf-tools-number-pages-label" className="text-sm font-medium leading-none">
                Number these pages
              </p>
              <RadioGroup
                aria-labelledby="pdf-tools-number-pages-label"
                value={form.range}
                onValueChange={(value) => set('range', value as 'all' | 'some')}
                className="gap-2 pt-1"
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem id="pdf-tools-number-all" value="all" data-testid="pdf-tools-number-range-all" />
                  <Label htmlFor="pdf-tools-number-all" className="font-normal">
                    All {pageCount} pages
                  </Label>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <RadioGroupItem id="pdf-tools-number-some" value="some" data-testid="pdf-tools-number-range-some" />
                  <Label htmlFor="pdf-tools-number-some" className="font-normal">
                    From page
                  </Label>
                  <Input
                    aria-label="First page to number"
                    data-testid="pdf-tools-number-from"
                    {...marked('range')}
                    className={cn('h-8 w-20', INVALID_INPUT)}
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={pageCount}
                    disabled={form.range === 'all'}
                    value={form.fromPage}
                    onChange={(event) => set('fromPage', event.target.value)}
                  />
                  <span className="text-sm">to</span>
                  <Input
                    aria-label="Last page to number"
                    data-testid="pdf-tools-number-to"
                    {...marked('range')}
                    className={cn('h-8 w-20', INVALID_INPUT)}
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={pageCount}
                    disabled={form.range === 'all'}
                    value={form.toPage}
                    onChange={(event) => set('toPage', event.target.value)}
                  />
                </div>
              </RadioGroup>
              <p className="text-xs text-muted-foreground">Leave a cover page unnumbered by starting from page 2.</p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <Field id="pdf-tools-number-fontSize" label="Font size (pt)" hint="6 to 36">
              {numberInput('fontSize', PAGE_NUMBER_LIMITS.fontSize, 0.5)}
            </Field>
            <Field id="pdf-tools-number-color" label="Colour">
              <Input
                id="pdf-tools-number-color"
                data-testid="pdf-tools-number-color"
                {...marked('color')}
                type="color"
                className="h-10 w-full cursor-pointer p-1"
                value={form.color}
                onChange={(event) => set('color', event.target.value)}
              />
            </Field>
            <Field
              id="pdf-tools-number-marginPt"
              label="Margin (pt)"
              hint={Number.isFinite(margin) && margin > 0 ? `About ${Math.round(ptToMm(margin))} mm; 8 to 144` : '8 to 144'}
            >
              {numberInput('marginPt', PAGE_NUMBER_LIMITS.marginPt)}
            </Field>
          </div>

          <ResultNameField name={name} />
        </div>

        <section aria-label="Preview" className="space-y-2 self-start rounded-md border bg-muted/30 p-3" data-testid="pdf-tools-number-preview">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-foreground">{preview?.status === 'ready' ? `Preview of page ${preview.page}` : 'Preview'}</span>
            {pending && (
              <span className="inline-flex items-center gap-1 text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                Updating…
              </span>
            )}
          </div>
          {preview?.status === 'ready' ? (
            <>
              <div className="flex justify-center">
                <img
                  data-testid="pdf-tools-preview-page"
                  src={preview.url}
                  alt={`Page ${preview.page} with the number ${preview.label}`}
                  className="max-h-[220px] w-auto max-w-full border bg-white shadow-sm"
                />
              </div>
              <p className="pt-1 text-xs font-medium text-foreground">Close-up</p>
              <div className="overflow-hidden rounded border bg-white" style={{ width: CLOSE_UP.width, height: CLOSE_UP.height }}>
                <img
                  src={preview.url}
                  alt=""
                  className="h-full w-full max-w-none"
                  style={{ objectFit: 'none', objectPosition: offset ? `${offset.x}px ${offset.y}px` : 'center' }}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                This page shows <span className="font-medium text-foreground">{preview.label}</span>.
              </p>
            </>
          ) : (
            !problem && (
              <div className="flex h-[220px] items-center justify-center rounded border border-dashed text-xs text-muted-foreground">
                {preview?.status === 'error' ? preview.message : 'Drawing the preview…'}
              </div>
            )
          )}
          {problem && (
            <p id={PROBLEM_ID} role="alert" data-testid="pdf-tools-preview-error" className="flex gap-1.5 text-xs text-destructive">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {problem}
            </p>
          )}
        </section>
      </div>
    </ToolDialog>
  );
}
