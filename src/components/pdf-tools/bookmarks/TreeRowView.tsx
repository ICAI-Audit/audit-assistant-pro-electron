// One bookmark row, as the Bookmarks dialog and the list beside the page panel draw it: indented by its
// depth with a guide line per level, its title (bold or italic as the file says), and on the right its
// page, "Web link", or a greyed "Not carried".
import type { MouseEvent, ReactNode } from 'react';
import { Ban, Bookmark, ChevronDown, ChevronRight, Globe } from 'lucide-react';
import { cn } from '@/lib/utils';
import { notCarriedReason, type TreeRow } from './bookmarkView';

/** Pixels per level of nesting. */
export const INDENT = 16;

const pageCount = new Intl.NumberFormat('en-IN');

export interface TreeRowViewProps {
  row: TreeRow;
  /** The element id, for aria-activedescendant. */
  id: string;
  height: number;
  top: number;
  active: boolean;
  /** The tree has keyboard focus: the active row shows a focus ring. */
  focused: boolean;
  testId: string;
  onClick?: (event: MouseEvent<HTMLDivElement>) => void;
  onDoubleClick?: () => void;
  /** Shown before the icon in a tree that collapses (the list beside the page panel). */
  onToggle?: () => void;
  /** Replaces the title (the rename box). */
  children?: ReactNode;
}

export default function TreeRowView({ row, id, height, top, active, focused, testId, onClick, onDoubleClick, onToggle, children }: TreeRowViewProps) {
  const left = 8 + row.depth * INDENT;
  const Icon = row.notCarried ? Ban : row.uri !== undefined && row.page === null ? Globe : Bookmark;
  const reason = row.notCarried ? notCarriedReason(row.notCarried) : null;
  return (
    <div
      id={id}
      role="treeitem"
      aria-level={row.depth + 1}
      aria-setsize={row.setSize}
      aria-posinset={row.posInSet}
      aria-selected={active}
      aria-expanded={onToggle && row.hasChildren ? row.expanded : undefined}
      data-testid={testId}
      data-position={row.position}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      className={cn(
        'absolute inset-x-0 flex cursor-default select-none items-center gap-1.5 pr-2 text-sm',
        active ? 'bg-primary/10 text-foreground' : 'text-foreground hover:bg-muted/60',
        active && focused && 'ring-2 ring-inset ring-ring',
        row.notCarried && 'text-muted-foreground',
      )}
      style={{ top, height, paddingLeft: left }}
      title={reason ? `${row.label} (not carried: ${reason.toLowerCase()})` : row.label}
    >
      {/* one guide line per level above this one */}
      {Array.from({ length: row.depth }, (_, level) => (
        <span key={level} aria-hidden="true" className="absolute inset-y-0 w-px bg-border" style={{ left: 8 + level * INDENT + 6 }} />
      ))}
      {onToggle ? (
        row.hasChildren ? (
          <span
            aria-hidden="true"
            onClick={(event) => {
              event.stopPropagation();
              onToggle();
            }}
            className="-ml-1 flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            {row.expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </span>
        ) : (
          <span aria-hidden="true" className="-ml-1 w-5 shrink-0" />
        )
      ) : null}
      <Icon aria-hidden="true" className={cn('h-3.5 w-3.5 shrink-0', active ? 'text-primary' : 'text-muted-foreground', row.notCarried && 'text-muted-foreground/70')} />
      {children ?? <span className={cn('min-w-0 flex-1 truncate', row.bold && 'font-semibold', row.italic && 'italic')}>{row.label}</span>}
      {!children &&
        (row.notCarried ? (
          <span className="shrink-0 rounded border border-dashed border-muted-foreground/40 px-1.5 text-[11px] font-medium leading-4 text-muted-foreground">
            Not carried<span className="sr-only">: {reason}</span>
          </span>
        ) : row.page !== null ? (
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            <span aria-hidden="true">p. {pageCount.format(row.page + 1)}</span>
            <span className="sr-only">, page {row.page + 1}</span>
          </span>
        ) : row.uri !== undefined ? (
          <span className="shrink-0 text-xs text-muted-foreground">Web link</span>
        ) : null)}
    </div>
  );
}
