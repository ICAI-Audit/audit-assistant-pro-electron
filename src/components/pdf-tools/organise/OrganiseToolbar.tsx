// The Organise pages actions on the chosen pages (design 5.15), as buttons with their keys: Move to
// start / earlier / later / end, Move to position…, Rotate left / right (the owner's word), Remove,
// Restore, Undo, Redo and Reset. An action that cannot be used now stays focusable (aria-disabled) and
// says why (ux-audit E8): on hover and on focus in the hint line under the buttons, in its accessible
// name, and on click as an announcement. No tooltip layer: inside a dialog it would take Escape.
import { useId, useState, type ReactNode } from 'react';
import { ArchiveRestore, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Info, ListRestart, Redo2, RotateCcw, RotateCw, Trash2, Undo2, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { OrganiseEditAction, OrganiseEditState } from '../organiseEdit';
import { INVALID_INPUT } from '../dialogs/fieldProps';
import { moveTargetForPage, readPosition } from './gridLayout';
import { unavailableReasons, type ToolbarActionId } from './toolbarRules';

export interface OrganiseToolbarProps {
  state: OrganiseEditState;
  /** A run is in progress: every action is off (the dialog's fieldset disables the buttons). */
  disabled: boolean;
  /** Applies an edit from a button; the dialog announces it and shows the moved page. */
  onAction: (action: OrganiseEditAction) => void;
  /** An unavailable action was pressed: the dialog reads its reason out. */
  onUnavailable: (reason: string) => void;
}

interface ActionSpec {
  id: ToolbarActionId;
  icon: LucideIcon;
  label: string;
  /** For aria-keyshortcuts and the hint. */
  keys?: string;
  shown?: string;
  action: OrganiseEditAction;
}

const MOVES: ActionSpec[] = [
  { id: 'start', icon: ChevronsLeft, label: 'To start', keys: 'Alt+Home', shown: 'Alt+Home', action: { type: 'move', to: 'start' } },
  { id: 'earlier', icon: ChevronLeft, label: 'Earlier', keys: 'Alt+ArrowLeft', shown: 'Alt+Left', action: { type: 'move', to: 'earlier' } },
  { id: 'later', icon: ChevronRight, label: 'Later', keys: 'Alt+ArrowRight', shown: 'Alt+Right', action: { type: 'move', to: 'later' } },
  { id: 'end', icon: ChevronsRight, label: 'To end', keys: 'Alt+End', shown: 'Alt+End', action: { type: 'move', to: 'end' } },
];
const ROTATE: ActionSpec[] = [
  { id: 'rotate-left', icon: RotateCcw, label: 'Rotate left', keys: 'Shift+R', shown: 'Shift+R', action: { type: 'turn', by: -90 } },
  { id: 'rotate-right', icon: RotateCw, label: 'Rotate right', keys: 'R', shown: 'R', action: { type: 'turn', by: 90 } },
];
const REMOVE: ActionSpec[] = [
  { id: 'remove', icon: Trash2, label: 'Remove', keys: 'Delete', shown: 'Delete', action: { type: 'remove' } },
  { id: 'restore', icon: ArchiveRestore, label: 'Restore', keys: 'Delete', shown: 'Delete on a removed page', action: { type: 'restore' } },
];
const HISTORY: ActionSpec[] = [
  { id: 'undo', icon: Undo2, label: 'Undo', keys: 'Control+Z', shown: 'Ctrl+Z', action: { type: 'undo' } },
  { id: 'redo', icon: Redo2, label: 'Redo', keys: 'Control+Y', shown: 'Ctrl+Y', action: { type: 'redo' } },
  { id: 'reset', icon: ListRestart, label: 'Reset', action: { type: 'reset' } },
];

function Group({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div role="group" aria-label={label} className={cn('flex flex-wrap items-center gap-1', className)}>
      {children}
    </div>
  );
}

export default function OrganiseToolbar({ state, disabled, onAction, onUnavailable }: OrganiseToolbarProps) {
  const id = useId();
  const [position, setPosition] = useState('');
  const [hint, setHint] = useState<{ owner: ToolbarActionId; text: string } | null>(null);
  // Move to position counts the pages of the result (the numbers under the tiles), not removed tiles.
  const count = state.tiles.filter((tile) => !tile.removed).length;
  const reasons = unavailableReasons(state, position);
  const typed = readPosition(position, count);

  const show = (owner: ToolbarActionId) => {
    const reason = reasons[owner];
    setHint(reason ? { owner, text: reason } : null);
  };
  // Cleared only after focus has landed on the next control. Removing the hint's nodes during the blur,
  // while nothing has focus, makes the dialog's focus trap pull focus back to the dialog (seen in the
  // drive: Tab never left the first button).
  const hide = (owner: ToolbarActionId) => {
    setTimeout(() => setHint((current) => (current?.owner === owner ? null : current)), 0);
  };

  const press = (owner: ToolbarActionId, run: () => void) => {
    const reason = reasons[owner];
    if (reason) {
      setHint({ owner, text: reason });
      onUnavailable(reason);
      return;
    }
    run();
  };

  const button = (spec: ActionSpec) => {
    const reason = reasons[spec.id];
    const name = spec.shown ? `${spec.label} (${spec.shown})` : spec.label;
    return (
      <Button
        key={spec.id}
        type="button"
        variant="outline"
        size="sm"
        className={cn('h-8 gap-1.5 px-2.5 text-xs', reason && 'cursor-not-allowed opacity-50 hover:bg-background')}
        title={reason ? `${spec.label}: ${reason}` : name}
        aria-keyshortcuts={spec.keys}
        aria-disabled={reason ? true : undefined}
        data-testid={`pdf-tools-organise-${spec.id === 'rotate-left' ? 'turn-left' : spec.id === 'rotate-right' ? 'turn-right' : spec.id}`}
        data-unavailable={reason ? 'true' : undefined}
        onClick={() => press(spec.id, () => onAction(spec.action))}
        onFocus={() => show(spec.id)}
        onBlur={() => hide(spec.id)}
        onMouseEnter={() => show(spec.id)}
        onMouseLeave={() => hide(spec.id)}
      >
        <spec.icon className="!size-3.5" aria-hidden="true" />
        {spec.label}
        {reason && <span className="sr-only">{`. ${reason}`}</span>}
      </Button>
    );
  };

  const moveTo = () =>
    press('position', () => {
      if (typed.place === null) return;
      onAction({ type: 'move', to: moveTargetForPage(state, typed.place) });
      setPosition('');
    });

  const positionReason = reasons.position;
  return (
    <div className="space-y-1.5" data-testid="pdf-tools-organise-toolbar">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Group label="Move the chosen pages">{MOVES.map(button)}</Group>
        <div role="group" aria-label="Move the chosen pages to a position" className="flex items-center gap-1">
          <label htmlFor={`${id}-position`} className="sr-only">
            Move the chosen pages to page, 1 to {count} of the result (removed pages not counted)
          </label>
          <Input
            id={`${id}-position`}
            data-testid="pdf-tools-organise-position"
            inputMode="numeric"
            autoComplete="off"
            spellCheck={false}
            placeholder={`Page 1–${count}`}
            aria-invalid={typed.error ? true : undefined}
            aria-describedby={typed.error ? `${id}-position-error` : undefined}
            className={cn('h-8 w-[8.5rem] text-xs', INVALID_INPUT)}
            value={position}
            disabled={disabled}
            onChange={(event) => setPosition(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              moveTo();
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={cn('h-8 px-2.5 text-xs', positionReason && 'cursor-not-allowed opacity-50 hover:bg-background')}
            title={positionReason ? `Move: ${positionReason}` : 'Move the chosen pages to this page of the result'}
            aria-disabled={positionReason ? true : undefined}
            data-testid="pdf-tools-organise-position-move"
            data-unavailable={positionReason ? 'true' : undefined}
            onClick={moveTo}
            onFocus={() => show('position')}
            onBlur={() => hide('position')}
            onMouseEnter={() => show('position')}
            onMouseLeave={() => hide('position')}
          >
            Move
            {positionReason && <span className="sr-only">{`. ${positionReason}`}</span>}
          </Button>
          <span className="text-xs text-foreground/75" data-testid="pdf-tools-organise-position-rule">
            page of the result; removed pages not counted
          </span>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Group label="Rotate the chosen pages">{ROTATE.map(button)}</Group>
        <Group label="Remove or restore the chosen pages">{REMOVE.map(button)}</Group>
        <Group label="History" className="sm:ml-auto">
          {HISTORY.map(button)}
        </Group>
      </div>
      {typed.error ? (
        <p id={`${id}-position-error`} role="alert" className="text-xs font-medium text-foreground" data-testid="pdf-tools-field-error">
          {typed.error}
        </p>
      ) : (
        <p className="flex min-h-[1rem] items-center gap-1.5 text-xs text-muted-foreground" data-testid="pdf-tools-organise-hint" aria-hidden="true">
          {hint && (
            <>
              <Info className="h-3.5 w-3.5 shrink-0" />
              {hint.text}
            </>
          )}
        </p>
      )}
    </div>
  );
}
