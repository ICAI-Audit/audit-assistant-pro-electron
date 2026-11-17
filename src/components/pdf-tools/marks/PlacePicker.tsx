// Where a mark goes (design 5.16): one of nine anchors on a small page, or a point on the page, typed in
// percent or chosen by clicking the preview. The nine anchors are one radio group (arrow keys move);
// the point is its tenth choice.
import { Crosshair } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { cn } from '@/lib/utils';
import type { Anchor } from '@/lib/pdf-tools/watermark';
import { INVALID_INPUT } from '../dialogs/fieldProps';
import { mmText, MM_PER_PT } from './units';
import { ANCHOR_NAMES, choosePlace, MARK_PAD_PT, placeLabel, type PlaceForm } from './watermarkForm';

const GRID: Anchor[] = ['top-left', 'top-center', 'top-right', 'middle-left', 'center', 'middle-right', 'bottom-left', 'bottom-center', 'bottom-right'];

export interface PlacePickerProps {
  /** Test ids and element ids start with this, for example "pdf-tools-watermark-place". */
  id: string;
  /** "watermark", "stamp", "logo": used in the labels. */
  what: string;
  value: PlaceForm;
  onChange: (value: PlaceForm) => void;
  /** The preview waits for a click to place this mark. */
  picking: boolean;
  onPick: () => void;
  error?: string | null;
}

const capital = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

export default function PlacePicker({ id, what, value, onChange, picking, onPick, error }: PlacePickerProps) {
  const point = value.anchor === 'point';
  const messageId = `${id}-message`;
  const invalid = error ? { 'aria-invalid': true as const, 'aria-describedby': messageId } : {};
  return (
    <div className="space-y-1.5">
      <p id={`${id}-label`} className="text-sm font-medium leading-none">
        Position
      </p>
      <RadioGroup
        aria-labelledby={`${id}-label`}
        value={value.anchor}
        onValueChange={(next) => onChange(choosePlace(value, next as PlaceForm['anchor']))}
        className="flex flex-wrap items-start gap-x-4 gap-y-2"
      >
        <div className="grid h-[92px] w-[72px] shrink-0 grid-cols-3 grid-rows-3 place-items-center rounded-md border bg-background p-1.5 shadow-sm" role="presentation">
          {GRID.map((anchor) => (
            <RadioGroupItem key={anchor} value={anchor} aria-label={`${ANCHOR_NAMES[anchor]} of the page`} data-testid={`${id}-${anchor}`} className="h-3.5 w-3.5" />
          ))}
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-xs text-muted-foreground" aria-live="polite" data-testid={`${id}-current`}>
            {capital(placeLabel(value))}
            {value.anchor !== 'point' && value.anchor !== 'center' ? `, ${mmText(MARK_PAD_PT * MM_PER_PT)} from the edges` : ''}
          </p>
          <div className="flex items-center gap-2">
            <RadioGroupItem id={`${id}-point`} value="point" data-testid={`${id}-point`} />
            <Label htmlFor={`${id}-point`} className="font-normal">
              A point on the page
            </Label>
          </div>
          {point && (
            <div className="space-y-2 pl-6">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <label className="flex items-center gap-1.5">
                  <Input
                    {...invalid}
                    data-testid={`${id}-x`}
                    aria-label={`Where the ${what} goes, in percent from the left edge`}
                    className={cn('h-8 w-16 px-2 text-xs tabular-nums', INVALID_INPUT)}
                    inputMode="decimal"
                    value={value.x}
                    onChange={(event) => onChange({ ...value, x: event.target.value })}
                  />
                  % across
                </label>
                <label className="flex items-center gap-1.5">
                  <Input
                    {...invalid}
                    data-testid={`${id}-y`}
                    aria-label={`Where the ${what} goes, in percent from the top edge`}
                    className={cn('h-8 w-16 px-2 text-xs tabular-nums', INVALID_INPUT)}
                    inputMode="decimal"
                    value={value.y}
                    onChange={(event) => onChange({ ...value, y: event.target.value })}
                  />
                  % down
                </label>
              </div>
              <Button
                type="button"
                variant={picking ? 'default' : 'outline'}
                size="sm"
                className="h-8 gap-1.5 text-xs"
                aria-pressed={picking}
                data-testid={`${id}-pick`}
                onClick={onPick}
              >
                <Crosshair className="h-3.5 w-3.5" aria-hidden="true" />
                {picking ? 'Click the preview… (Esc to stop)' : 'Choose on the preview'}
              </Button>
            </div>
          )}
        </div>
      </RadioGroup>
      {error && (
        <p id={messageId} role="alert" className="text-xs text-destructive" data-testid="pdf-tools-field-error">
          {error}
        </p>
      )}
    </div>
  );
}
