import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Loader2, type LucideIcon } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { ToolId, WorkingFile } from '@/lib/pdf-tools/types';
import { endQuietFocus, isQuietlyFocused } from './quietFocus';
import { TOOL_ICONS } from './toolIcons';
import { COMING_SOON, soonLabel, TOOL_GROUPS, TOOLS, toolAvailability, toolbarMove } from './toolRules';

type Placement = { side: 'top' | 'bottom'; offset: number };

const TIP_GAP = 6;
const TIP_ROOM = 72; // height a two-line tooltip needs

// The tooltip is pushed just outside the toolbar (above for the upper rows, below for the lower
// ones), so it never covers another tool's label.
function placementFor(tile: HTMLElement | null): Placement {
  const bar = tile?.closest('[data-pdf-toolbar]');
  if (!tile || !bar) return { side: 'bottom', offset: TIP_GAP };
  const t = tile.getBoundingClientRect();
  const b = bar.getBoundingClientRect();
  const above = { side: 'top' as const, offset: t.top - b.top + TIP_GAP };
  const below = { side: 'bottom' as const, offset: b.bottom - t.bottom + TIP_GAP };
  const upperHalf = (t.top + t.bottom) / 2 < (b.top + b.bottom) / 2;
  const roomAbove = b.top > TIP_ROOM;
  const roomBelow = window.innerHeight - b.bottom > TIP_ROOM;
  if (upperHalf) return roomAbove || !roomBelow ? above : below;
  return roomBelow || !roomAbove ? below : above;
}

interface ToolButtonProps {
  label: string;
  icon?: LucideIcon;
  hint: string;
  enabled: boolean;
  /** Not built yet: shown as quiet text, never runs. */
  soon?: boolean;
  testId?: string;
  soonKey?: string;
  onSelect?: () => void;
  /** An unavailable tool was clicked: the screen shows its reason (whyLine.ts). */
  onUnavailable?: (reason: string) => void;
  /** The toolbar's one Tab stop is the item last focused (roving focus, UX audit C11); the others are -1. */
  tabIndex: 0 | -1;
  onFocusItem: () => void;
  /** Its dialog's code is still loading after a moment (UX audit C7, T1-10): a spinner in place of the icon. */
  busy?: boolean;
}

// Unavailable tools stay focusable (aria-disabled, not disabled) so keyboard users can reach them
// and hear why; the tooltip opens on hover, on focus and on a click.
function ToolButton({ label, icon: Icon, hint, enabled, soon, testId, soonKey, onSelect, onUnavailable, tabIndex, onFocusItem, busy = false }: ToolButtonProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<Placement>({ side: 'bottom', offset: TIP_GAP });
  // Never while a dialog is open: an open tooltip is a layer above the dialog and would take the
  // dialog's Escape, so Escape could not close it.
  const show = () => {
    if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
    setPlacement(placementFor(ref.current));
    setOpen(true);
  };

  return (
    <Tooltip
      open={open}
      onOpenChange={(next) => {
        // Focus given back by a closing dialog opens no tooltip (quietFocus.ts): after a run, the tool
        // may be unavailable for the results now selected, and its reason would sit over the success message.
        if (next && isQuietlyFocused(ref.current)) return;
        if (next) show();
        else setOpen(false);
      }}
    >
      <TooltipTrigger asChild>
        <button
          ref={ref}
          type="button"
          data-testid={testId}
          data-soon-tool={soonKey}
          aria-disabled={!enabled}
          data-enabled={enabled ? 'true' : 'false'}
          data-loading={busy ? 'true' : undefined}
          aria-busy={busy || undefined}
          data-toolbar-item
          tabIndex={tabIndex}
          onFocus={onFocusItem}
          onBlur={() => endQuietFocus(ref.current)}
          onPointerMove={() => endQuietFocus(ref.current)}
          onKeyDown={() => endQuietFocus(ref.current)}
          onClick={() => {
            endQuietFocus(ref.current);
            if (!enabled) {
              // A click says why, as hover and focus do (UX audit C1.2).
              show();
              onUnavailable?.(hint);
              return;
            }
            setOpen(false); // the tool's dialog opens next; its tooltip must not stay above it
            onSelect?.();
          }}
          className={cn(
            'inline-flex shrink-0 items-center whitespace-nowrap rounded-md font-medium transition-colors',
            'ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
            soon
              ? 'h-8 cursor-default px-1 text-[11px] font-normal text-muted-foreground hover:text-foreground'
              : enabled
                ? 'h-8 gap-1.5 border border-border bg-card px-2 text-xs text-foreground shadow-sm hover:border-primary/60 hover:bg-accent hover:text-accent-foreground'
                : 'h-8 cursor-not-allowed gap-1.5 border border-border/70 bg-muted/30 px-2 text-xs text-muted-foreground',
          )}
        >
          {busy ? (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" aria-hidden="true" />
          ) : (
            Icon && !soon && <Icon className={cn('h-4 w-4 shrink-0', enabled ? 'text-primary' : 'opacity-70')} aria-hidden="true" />
          )}
          {soon ? soonLabel(label) : label}
          <span className="sr-only">{busy ? '. Opening…' : `. ${hint}`}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent side={placement.side} sideOffset={placement.offset} collisionPadding={8} className="max-w-[280px] text-xs">
        {hint}
      </TooltipContent>
    </Tooltip>
  );
}

interface ToolBarProps {
  selected: WorkingFile[];
  onToolSelected: (tool: ToolId) => void;
  /** The tools that can run; any other is shown in its place as "Soon" (a phase 2 tool whose run module is still a stub). */
  built: (tool: ToolId) => boolean;
  /** An unavailable tool was clicked; its reason is shown under the toolbar. */
  onUnavailable?: (reason: string) => void;
  /** The tool whose dialog is still loading after a moment: its button shows a spinner (null: none). */
  loading?: ToolId | null;
}

/**
 * Every tool of the design, grouped Organise / Prepare / Convert / Review. Tools of a later release
 * stay on screen as quiet "· soon" text in their group (owner decision T-022: no visible placeholder is
 * removed; UX audit C2.2). A group wraps as a whole where it can (C2.4), so the eye can tell where a
 * group ends; each group's caption is kept with its first tool.
 */
export default function ToolBar({ selected, onToolSelected, built, onUnavailable, loading = null }: ToolBarProps) {
  // Roving focus (UX audit C11, T2-4): the toolbar is one Tab stop; the arrow keys move along it, Home and
  // End jump to its ends. "Soon" items are reached too and say they are not available yet.
  const [active, setActive] = useState<string | null>(null);
  // The items in the order they are shown: per group its usable tools, then its "soon" ones.
  const order = TOOL_GROUPS.flatMap((group) => [
    ...TOOLS.filter((t) => t.group === group && built(t.id)).map((t) => t.id as string),
    ...TOOLS.filter((t) => t.group === group && !built(t.id)).map((t) => t.id as string),
    ...COMING_SOON.filter((t) => t.group === group).map((t) => t.key),
  ]);
  // Until an item has had focus (or if it has gone), the first one is the Tab stop.
  const stop = active !== null && order.includes(active) ? active : order[0];
  const item = (key: string) => ({ tabIndex: (stop === key ? 0 : -1) as 0 | -1, onFocusItem: () => setActive(key) });
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Alt + an arrow, Ctrl + Home and the like belong to the application (VERA Tools changes tab on Alt + arrows).
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[data-toolbar-item]'));
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    const next = toolbarMove(event.key, at, items.length);
    if (next === null) return;
    event.preventDefault();
    items[next].focus();
  };

  const groups = TOOL_GROUPS.map((group, groupIndex) => {
          const usable: ReactNode[] = [];
          const later: ReactNode[] = [];
          for (const tool of TOOLS.filter((t) => t.group === group)) {
            if (!built(tool.id)) {
              later.push(
                <ToolButton key={tool.id} soonKey={tool.id} label={tool.label} enabled={false} soon hint={`${tool.description} Coming soon.`} onUnavailable={onUnavailable} {...item(tool.id)} />,
              );
              continue;
            }
            const availability = toolAvailability(tool.id, selected);
            usable.push(
              <ToolButton
                key={tool.id}
                testId={`pdf-tools-tool-${tool.id}`}
                label={tool.label}
                icon={TOOL_ICONS[tool.id]}
                enabled={availability.enabled}
                hint={availability.reason ?? tool.description}
                onSelect={() => onToolSelected(tool.id)}
                onUnavailable={onUnavailable}
                busy={loading === tool.id}
                {...item(tool.id)}
              />,
            );
          }
          for (const tool of COMING_SOON.filter((t) => t.group === group)) {
            later.push(
              <ToolButton key={tool.key} soonKey={tool.key} label={tool.label} enabled={false} soon hint={`${tool.description} Coming soon.`} onUnavailable={onUnavailable} {...item(tool.key)} />,
            );
          }
          // A group's caption and its usable tools stay on one row (UX audit C2.4); the quiet "soon" items
          // after them flow on, so the bar does not grow a row for them. A group of only "soon" items keeps
          // its caption with the first.
          const together = usable.length > 0 ? usable : later.splice(0, 1);
          return (
            <div key={group} role="group" aria-label={group} className="contents">
              <span className={cn('inline-flex max-w-full flex-wrap items-center gap-1', groupIndex > 0 && 'ml-2.5')}>
                <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground" aria-hidden="true">
                  {group}
                </span>
                {together}
              </span>
              {later}
            </div>
          );
  });

  return (
    <div role="toolbar" aria-label="PDF Tools" aria-orientation="horizontal" data-pdf-toolbar onKeyDown={onKeyDown} className="rounded-lg border bg-card px-3 py-1.5 shadow-sm">
      <div className="flex flex-wrap items-center gap-x-1 gap-y-1">{groups}</div>
    </div>
  );
}
