import { useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Bookmark, EyeOff, FileSearch, FileSpreadsheet, FileText, FileType, ScanText, Stamp } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { ToolId, WorkingFile } from '@/lib/pdf-tools/types';
import { TOOL_ICONS } from './toolIcons';
import { COMING_SOON, TOOL_GROUPS, TOOLS, toolAvailability } from './toolRules';

const SOON_ICONS: Record<string, LucideIcon> = {
  redact: EyeOff,
  bookmarks: Bookmark,
  watermark: Stamp,
  'pdf-to-excel': FileSpreadsheet,
  'pdf-to-word': FileText,
  ocr: ScanText,
  'word-to-pdf': FileType,
  'excel-to-pdf': FileSpreadsheet,
  review: FileSearch,
};

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
  icon: LucideIcon;
  hint: string;
  enabled: boolean;
  /** Not built yet: shown quieter, with a "Soon" badge, and never runs. */
  soon?: boolean;
  testId?: string;
  soonKey?: string;
  onSelect?: () => void;
}

// Unavailable tools stay focusable (aria-disabled, not disabled) so keyboard users can reach them
// and hear why; the tooltip opens on focus as well as on hover.
function ToolButton({ label, icon: Icon, hint, enabled, soon, testId, soonKey, onSelect }: ToolButtonProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<Placement>({ side: 'bottom', offset: TIP_GAP });

  return (
    <Tooltip
      open={open}
      onOpenChange={(next) => {
        // Never while a dialog is open: an open tooltip is a layer above the dialog and would take
        // the dialog's Escape, so Escape could not close it.
        if (next && document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
        if (next) setPlacement(placementFor(ref.current));
        setOpen(next);
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
          onClick={() => {
            if (!enabled) return;
            setOpen(false); // the tool's dialog opens next; its tooltip must not stay above it
            onSelect?.();
          }}
          className={cn(
            'inline-flex h-9 shrink-0 items-center whitespace-nowrap rounded-md border font-medium transition-colors',
            'ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
            soon
              ? 'cursor-not-allowed gap-1.5 border-dashed border-border bg-transparent px-2 text-xs text-muted-foreground'
              : enabled
                ? 'gap-2 border-border bg-background px-2.5 text-[13px] text-foreground shadow-sm hover:border-primary/60 hover:bg-accent hover:text-accent-foreground'
                : 'cursor-not-allowed gap-2 border-border/70 bg-muted/30 px-2.5 text-[13px] text-muted-foreground',
          )}
        >
          <Icon className={cn('h-4 w-4 shrink-0', enabled ? 'text-primary' : soon ? 'opacity-50' : 'opacity-70')} aria-hidden="true" />
          {label}
          {soon && (
            <span className="rounded-full bg-muted px-1.5 text-[9px] font-semibold uppercase leading-4 tracking-wide text-muted-foreground">Soon</span>
          )}
          <span className="sr-only">{`. ${hint}`}</span>
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
}

/**
 * Every tool of the design, grouped Organise / Prepare / Convert / Review. Tools of a later release
 * stay on screen as "Coming soon" (owner decision T-022: no visible placeholder is removed).
 * The buttons of all groups flow as one line that wraps, so the bar stays short; each group's
 * caption is kept together with its first button.
 */
export default function ToolBar({ selected, onToolSelected }: ToolBarProps) {
  return (
    <div role="group" aria-label="PDF Tools" data-pdf-toolbar className="rounded-lg border bg-card px-3 py-2 shadow-sm">
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1.5">
        {TOOL_GROUPS.map((group, groupIndex) => {
          const buttons = [
            ...TOOLS.filter((tool) => tool.group === group).map((tool) => {
              const availability = toolAvailability(tool.id, selected);
              return (
                <ToolButton
                  key={tool.id}
                  testId={`pdf-tools-tool-${tool.id}`}
                  label={tool.label}
                  icon={TOOL_ICONS[tool.id]}
                  enabled={availability.enabled}
                  hint={availability.reason ?? tool.description}
                  onSelect={() => onToolSelected(tool.id)}
                />
              );
            }),
            ...COMING_SOON.filter((tool) => tool.group === group).map((tool) => (
              <ToolButton
                key={tool.key}
                soonKey={tool.key}
                label={tool.label}
                icon={SOON_ICONS[tool.key] ?? FileText}
                enabled={false}
                soon
                hint={`${tool.description} Coming soon.`}
              />
            )),
          ];
          const [first, ...rest] = buttons;
          return (
            <div key={group} role="group" aria-label={group} className="contents">
              <span className={cn('inline-flex shrink-0 items-center gap-1.5', groupIndex > 0 && 'ml-3')}>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground" aria-hidden="true">
                  {group}
                </span>
                {first}
              </span>
              {rest}
            </div>
          );
        })}
      </div>
    </div>
  );
}
