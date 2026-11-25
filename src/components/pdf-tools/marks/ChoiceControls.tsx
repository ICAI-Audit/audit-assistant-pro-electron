// Small controls the marks dialogs share (UX audit C6.5, C6.6): colours as swatches that stay visible in
// the dark theme (the system colour picker only behind "Other"), and sizes as presets labelled in mm,
// the advised one marked "Recommended", with a typed size in mm behind "Other".
import { useId, type ReactNode } from 'react';
import { Check } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';
import { INVALID_INPUT } from '../dialogs/fieldProps';
import { letterMm, mmText, SWATCHES, type SizePreset } from './units';

const kebab = (text: string) => text.toLowerCase().replace(/\s+/g, '-');

function FieldMessage({ id, error, hint }: { id: string; error?: string | null; hint?: ReactNode }) {
  if (error) {
    return (
      <p id={`${id}-message`} role="alert" className="text-xs text-destructive" data-testid="pdf-tools-field-error">
        {error}
      </p>
    );
  }
  return hint ? (
    <p id={`${id}-message`} className="text-xs text-muted-foreground">
      {hint}
    </p>
  ) : null;
}

export function ColourSwatches({ id, label, value, onChange, error }: { id: string; label: string; value: string; onChange: (value: string) => void; error?: string | null }) {
  const custom = !SWATCHES.some((s) => s.value === value.toLowerCase());
  const labelId = useId();
  return (
    <div className="space-y-1.5">
      <p id={labelId} className="text-sm font-medium leading-none">
        {label}
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        <ToggleGroup
          type="single"
          aria-labelledby={labelId}
          value={custom ? 'other' : value.toLowerCase()}
          onValueChange={(next) => {
            if (next && next !== 'other') onChange(next);
          }}
          className="justify-start gap-1.5"
        >
          {SWATCHES.map((s) => {
            const on = !custom && value.toLowerCase() === s.value;
            return (
              <ToggleGroupItem
                key={s.value}
                value={s.value}
                aria-label={s.label}
                title={s.label}
                data-testid={`${id}-${kebab(s.label)}`}
                className={cn('h-8 w-8 rounded-full border-2 p-0', on ? 'border-primary' : 'border-border')}
              >
                <span className="flex h-5 w-5 items-center justify-center rounded-full ring-1 ring-black/10 dark:ring-white/40" style={{ backgroundColor: s.value }}>
                  {on && <Check className="h-3 w-3 text-white" aria-hidden="true" />}
                </span>
              </ToggleGroupItem>
            );
          })}
        </ToggleGroup>
        {/* "Other": the system picker, with its colour and code shown beside it so it is never an invisible bar. */}
        <label className={cn('flex h-8 cursor-pointer items-center gap-1.5 rounded-full border-2 px-2 text-xs', custom ? 'border-primary' : 'border-border')}>
          <span className="relative h-5 w-5 overflow-hidden rounded-full ring-1 ring-black/10 dark:ring-white/40" style={{ backgroundColor: custom ? value : 'transparent' }}>
            <input
              type="color"
              data-testid={`${id}-other`}
              aria-label={`${label}: other colour`}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${id}-message` : undefined}
              value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#000000'}
              onChange={(event) => onChange(event.target.value)}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            />
          </span>
          <span className="text-foreground">{custom ? value.toUpperCase() : 'Other…'}</span>
        </label>
      </div>
      <FieldMessage id={id} error={error} />
    </div>
  );
}

export interface SizeChoiceProps {
  id: string;
  label: string;
  presets: readonly SizePreset[];
  /** The preset id, 'auto' or 'other'. */
  value: string;
  onChange: (value: string) => void;
  /** Offer "Auto" first, as the recommended choice. */
  auto?: { label: string; hint: string };
  /** The typed size in mm for "Other". */
  mm: string;
  onMm: (mm: string) => void;
  /** What the mm measures: a letter's height, or a distance from the edge. */
  measure: 'letter' | 'distance';
  error?: string | null;
}

/** Presets with their size in mm, the advised one marked "Recommended", and "Other" for a typed size in mm. */
export function SizeChoice({ id, label, presets, value, onChange, auto, mm, onMm, measure, error }: SizeChoiceProps) {
  const labelId = useId();
  const mmOf = (pt: number) => mmText(measure === 'letter' ? letterMm(pt) : (pt * 25.4) / 72);
  const item = (key: string, title: string, detail: string | null, recommended?: boolean) => (
    <ToggleGroupItem
      key={key}
      value={key}
      data-testid={`${id}-${key}`}
      className="h-auto min-h-9 flex-col items-start gap-0 rounded-md border px-2.5 py-1 text-left data-[state=on]:border-primary data-[state=on]:bg-primary/10 data-[state=on]:text-foreground"
    >
      <span className="text-xs font-medium">
        {title}
        {detail && <span className="font-normal text-muted-foreground"> {detail}</span>}
      </span>
      {recommended && <span className="text-[11px] font-normal leading-4 text-muted-foreground">Recommended</span>}
    </ToggleGroupItem>
  );
  return (
    <div className="space-y-1.5">
      <p id={labelId} className="text-sm font-medium leading-none">
        {label}
      </p>
      <ToggleGroup type="single" aria-labelledby={labelId} value={value} onValueChange={(next) => next && onChange(next)} className="flex-wrap justify-start gap-1.5">
        {auto && item('auto', auto.label, null, true)}
        {presets.map((p) => item(p.id, p.label, mmOf(p.pt), p.recommended))}
        {item('other', 'Other', null)}
      </ToggleGroup>
      {value === 'auto' && auto && <p className="text-xs text-muted-foreground">{auto.hint}</p>}
      {value === 'other' && (
        <div className="flex items-center gap-2">
          <div className="relative w-28">
            <Input
              id={`${id}-mm`}
              data-testid={`${id}-mm`}
              aria-label={`${label}, ${measure === 'letter' ? 'height of the capital letters' : 'distance from the edge'} in millimetres`}
              aria-invalid={error ? true : undefined}
              aria-describedby={`${id}-mm-message`}
              className={cn('pr-10 tabular-nums', INVALID_INPUT)}
              inputMode="decimal"
              value={mm}
              onChange={(event) => onMm(event.target.value)}
            />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground" aria-hidden="true">
              mm
            </span>
          </div>
          {!error && (
            <span id={`${id}-mm-message`} className="text-xs text-muted-foreground">
              {measure === 'letter' ? 'Height of the capital letters' : 'From the edge of the page'}
            </span>
          )}
        </div>
      )}
      {error && <FieldMessage id={`${id}-mm`} error={error} />}
    </div>
  );
}
