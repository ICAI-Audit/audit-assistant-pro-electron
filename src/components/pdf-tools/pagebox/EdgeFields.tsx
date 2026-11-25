// The four edges of the crop or margin, in mm, laid out as the page is: top above, left and right at the
// sides, bottom below. They stay in step with the crop frame on the preview (the dialog holds one value).
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { INVALID_INPUT } from '../dialogs/fieldProps';
import type { EdgeName } from './pageBoxForm';

const LABEL: Record<EdgeName, string> = { left: 'Left', top: 'Top', right: 'Right', bottom: 'Bottom' };

export default function EdgeFields({ id, label, values, onChange, error, hint }: {
  /** Test id prefix: each field adds -left, -top, -right, -bottom. */
  id: string;
  label: string;
  values: Record<EdgeName, string>;
  onChange: (edge: EdgeName, value: string) => void;
  error?: string | null;
  hint?: string;
}) {
  const field = (edge: EdgeName) => (
    <div className="flex items-center gap-1.5">
      <Label htmlFor={`${id}-${edge}`} className="w-12 shrink-0 text-right text-xs font-normal text-muted-foreground">
        {LABEL[edge]}
      </Label>
      <div className="relative w-[92px]">
        <Input
          id={`${id}-${edge}`}
          data-testid={`${id}-${edge}`}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-message` : hint ? `${id}-hint` : undefined}
          className={cn('h-8 pr-9 tabular-nums', INVALID_INPUT)}
          inputMode="decimal"
          autoComplete="off"
          value={values[edge]}
          onChange={(event) => onChange(edge, event.target.value)}
        />
        <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground" aria-hidden="true">
          mm
        </span>
      </div>
    </div>
  );
  return (
    <div className="space-y-1.5" role="group" aria-labelledby={`${id}-label`}>
      <p id={`${id}-label`} className="text-sm font-medium leading-none">
        {label}
      </p>
      <div className="grid w-fit grid-cols-[auto_auto] gap-x-4 gap-y-1.5 pt-1">
        <div className="col-span-2 flex justify-center">{field('top')}</div>
        {field('left')}
        {field('right')}
        <div className="col-span-2 flex justify-center">{field('bottom')}</div>
      </div>
      {/* As the shared Field: a new alert element for an error, and a hint element that is hidden, never removed. */}
      {error ? (
        <p key="error" id={`${id}-message`} role="alert" className="text-xs text-destructive" data-testid="pdf-tools-field-error">
          {error}
        </p>
      ) : (
        <p key="hint" id={`${id}-hint`} hidden={!hint} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  );
}
