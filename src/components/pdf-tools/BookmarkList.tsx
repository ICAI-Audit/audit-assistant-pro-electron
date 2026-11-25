// The "Bookmarks" list beside the page panel (design section 4): the selected PDF's bookmarks as a tree,
// read-only; choosing one scrolls the page panel to its page. Read with PDF Tools' own reader, never
// pdf.js (pdf.js reports page 1 for a page that is not in the file). Built for files with thousands of
// bookmarks: the reading waits until the page panel has started, is done once per file (shared with
// the Bookmarks dialog), and only the rows in view exist. Editing is the Bookmarks tool's.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Bookmark, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { OutlineItem } from '@/lib/pdf-tools/outline';
import { workingListStore, type WorkingListStore } from '@/lib/pdf-tools/workingList';
import type { WorkingFile } from '@/lib/pdf-tools/types';
import { cachedBookmarkSource, type BookmarkSource } from './bookmarks/bookmarkSource';
import { countLabel, notCarriedReason, treeRows } from './bookmarks/bookmarkView';
import TreeRowView from './bookmarks/TreeRowView';
import { useVirtualRows } from './bookmarks/useVirtualRows';

const ROW = 30;
/** The list is never taller than the page panel beside it. */
const MAX_HEIGHT = 456;
/** How long the reading waits for the page panel's first thumbnails to be asked for. */
const START_AFTER_MS = 250;

export interface BookmarkListProps {
  /** The one PDF the page panel shows; its bookmarks are read with PDF Tools' reader, never with pdf.js. */
  file: WorkingFile;
  /** Choosing a bookmark scrolls the page panel to its page (counted from 1). */
  onChoosePage?: (pageNumber: number) => void;
  className?: string;
  /** The working list, for the scope a reading belongs to (the screen's store; tests may give another). */
  store?: Pick<WorkingListStore, 'getState' | 'subscribe'>;
}

type Reading = { status: 'waiting' } | { status: 'failed' } | { status: 'ready'; source: BookmarkSource };

const pathKey = (_: OutlineItem, path: readonly number[]) => path.join('.');

function countItems(items: readonly OutlineItem[]): number {
  return items.reduce((sum, item) => sum + 1 + countItems(item.children), 0);
}

/** Bookmarks the file has closed start collapsed, as a reader would show them. */
function closedKeys(items: readonly OutlineItem[]): Set<string> {
  const out = new Set<string>();
  const walk = (list: readonly OutlineItem[], prefix: string) =>
    list.forEach((item, index) => {
      const key = prefix ? `${prefix}.${index}` : String(index);
      if (item.children.length > 0) {
        if (!item.open) out.add(key);
        walk(item.children, key);
      }
    });
  walk(items, '');
  return out;
}

export default function BookmarkList({ file, onChoosePage, className, store = workingListStore }: BookmarkListProps) {
  const [reading, setReading] = useState<Reading>({ status: 'waiting' });
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const [active, setActive] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  // Why choosing a bookmark showed no page (a web address, or a bookmark that goes to no page of this file).
  const [noPage, setNoPage] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const storeRef = useRef(store);
  storeRef.current = store;

  // The scope is taken before anything is awaited; what was read is shown only while the list is still
  // that scope's and still holds the file. The reading is ended (its worker terminated) when the list goes
  // or the scope changes, and gives up only when the reading stops answering for 30 seconds (a reading that
  // works says so every second, however large the file; "Try again" starts it afresh).
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!file.hasBookmarks || file.kind !== 'pdf') return;
    let live = true;
    const { contextKey, session } = storeRef.current.getState();
    const stillHere = () => {
      const now = storeRef.current.getState();
      return live && contextKey !== null && now.contextKey === contextKey && now.session === session && now.files.some((f) => f.id === file.id);
    };
    const ending = new AbortController();
    const unsubscribe = storeRef.current.subscribe(() => {
      if (!stillHere()) ending.abort();
    });
    setReading({ status: 'waiting' });
    // Let the page panel ask for its first thumbnails before the file is parsed here.
    const timer = window.setTimeout(() => {
      if (!live) return;
      cachedBookmarkSource(file.bytes, ending.signal).then(
        (source) => {
          if (!stillHere()) return;
          setCollapsed(closedKeys(source.items));
          setReading({ status: 'ready', source });
        },
        () => {
          if (stillHere() && !ending.signal.aborted) setReading({ status: 'failed' });
        },
      );
    }, START_AFTER_MS);
    return () => {
      live = false;
      window.clearTimeout(timer);
      unsubscribe();
      ending.abort();
    };
  }, [file, attempt]);

  const source = reading.status === 'ready' ? reading.source : null;
  const rows = useMemo(() => (source ? treeRows(source.items, pathKey, collapsed) : []), [source, collapsed]);
  const virtual = useVirtualRows(box, rows.length, ROW);
  const activeIndex = active === null ? -1 : rows.findIndex((r) => r.key === active);
  const { show } = virtual;
  useEffect(() => {
    if (activeIndex >= 0) show(activeIndex);
  }, [activeIndex, show]);

  if (!file.hasBookmarks || file.kind !== 'pdf') return null;

  const choose = (index: number) => {
    const row = rows[index];
    if (!row) return;
    setActive(row.key);
    if (row.page !== null && !row.notCarried) {
      setNoPage(null);
      onChoosePage?.(row.page + 1);
    } else {
      setNoPage(
        row.notCarried
          ? `'${row.label}' goes to no page of this file: ${notCarriedReason(row.notCarried).toLowerCase()}.`
          : `'${row.label}' goes to a web address. PDF Tools does not open web links.`,
      );
    }
  };
  const toggle = (key: string, open?: boolean) =>
    setCollapsed((was) => {
      const next = new Set(was);
      const shut = open === undefined ? !next.has(key) : !open;
      if (shut) next.add(key);
      else next.delete(key);
      return next;
    });

  // The tree pattern: Up and Down move, Right opens or goes in, Left closes or goes out, Enter shows the page.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey || rows.length === 0) return;
    const at = activeIndex;
    const go = (index: number) => setActive(rows[Math.max(0, Math.min(rows.length - 1, index))].key);
    const row = at >= 0 ? rows[at] : null;
    switch (event.key) {
      case 'ArrowDown':
        go(at + 1);
        break;
      case 'ArrowUp':
        go(at < 0 ? 0 : at - 1);
        break;
      case 'Home':
        go(0);
        break;
      case 'End':
        go(rows.length - 1);
        break;
      case 'PageDown':
        go(at + 10);
        break;
      case 'PageUp':
        go(at - 10);
        break;
      case 'ArrowRight':
        if (row?.hasChildren) {
          if (!row.expanded) toggle(row.key, true);
          else go(at + 1);
        }
        break;
      case 'ArrowLeft':
        if (row?.hasChildren && row.expanded) toggle(row.key, false);
        else if (row && row.depth > 0) {
          for (let i = at - 1; i >= 0; i--) {
            if (rows[i].depth === row.depth - 1) {
              go(i);
              break;
            }
          }
        }
        break;
      case 'Enter':
      case ' ':
        if (at >= 0 && !event.repeat) choose(at);
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  const total = source ? countItems(source.items) : 0;
  const height = Math.min(MAX_HEIGHT, Math.max(ROW * 3, rows.length * ROW));
  const windowRows = [];
  for (let i = virtual.start; i < virtual.end; i++) windowRows.push(i);

  return (
    <section
      aria-label={`Bookmarks of ${file.name}`}
      data-testid="pdf-tools-bookmark-list"
      className={cn('flex min-w-0 flex-col overflow-hidden rounded-lg border bg-card shadow-sm', className)}
    >
      <div className="flex items-center gap-2 border-b bg-muted/30 px-3 py-2">
        <Bookmark className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <h3 className="text-sm font-medium text-foreground">Bookmarks</h3>
        {source && <span className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">{countLabel(total, 'bookmark')}</span>}
        <span className="ml-auto whitespace-nowrap rounded-full border px-1.5 text-[11px] font-medium leading-4 text-muted-foreground">Read-only</span>
      </div>
      {reading.status === 'waiting' && (
        <div className="flex items-center gap-2 px-3 py-4 text-xs text-muted-foreground" role="status" data-testid="pdf-tools-bookmark-list-reading">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" aria-hidden="true" />
          Reading the bookmarks…
        </div>
      )}
      {reading.status === 'failed' && (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-4 text-xs text-muted-foreground" data-testid="pdf-tools-bookmark-list-error">
          The bookmarks of this file could not be read.
          <button
            type="button"
            className="font-medium text-primary underline-offset-2 hover:underline"
            data-testid="pdf-tools-bookmark-list-retry"
            onClick={() => setAttempt((n) => n + 1)}
          >
            Try again
          </button>
        </p>
      )}
      {source && rows.length === 0 && <p className="px-3 py-4 text-xs text-muted-foreground">No bookmarks could be read from this file.</p>}
      {source && rows.length > 0 && (
        <div
          ref={box}
          role="tree"
          tabIndex={0}
          aria-label={`Bookmarks of ${file.name}. Enter shows a bookmark's page.`}
          aria-activedescendant={activeIndex >= 0 ? `pdf-tools-bookmark-row-${rows[activeIndex].key}` : undefined}
          onScroll={virtual.onScroll}
          onKeyDown={onKeyDown}
          onFocus={(event) => {
            if (event.target !== event.currentTarget) return;
            setFocused(true);
            if (activeIndex < 0) setActive(rows[0].key);
          }}
          onBlur={() => setFocused(false)}
          className="relative overflow-y-auto focus-visible:outline-none"
          style={{ height }}
        >
          <div className="relative" style={{ height: virtual.total }}>
            {windowRows.map((index) => {
              const row = rows[index];
              return (
                <TreeRowView
                  key={row.key}
                  row={row}
                  id={`pdf-tools-bookmark-row-${row.key}`}
                  height={ROW}
                  top={index * ROW}
                  active={active === row.key}
                  focused={focused}
                  testId={`pdf-tools-bookmark-item-${row.position}`}
                  onClick={() => {
                    choose(index);
                    box.current?.focus({ preventScroll: true });
                  }}
                  onToggle={() => toggle(row.key)}
                />
              );
            })}
          </div>
        </div>
      )}
      {source && (!source.editable || source.notCarried > 0) && (
        <p className="border-t px-3 py-1.5 text-[11px] leading-snug text-muted-foreground" data-testid="pdf-tools-bookmark-list-note">
          {!source.editable ? `Showing the first ${countLabel(Math.min(total, 10_000), 'bookmark')}: the file has more, or deeper levels, than PDF Tools reads.` : ''}
          {!source.editable && source.notCarried > 0 ? ' ' : ''}
          {source.notCarried > 0 ? `${countLabel(source.notCarried, 'bookmark')} ${source.notCarried === 1 ? 'goes' : 'go'} to no page of this file (greyed).` : ''}
        </p>
      )}
      <p role="status" className={cn('px-3 text-[11px] leading-snug text-foreground', noPage && 'border-t py-1.5')} data-testid="pdf-tools-bookmark-list-no-page">
        {noPage}
      </p>
    </section>
  );
}
