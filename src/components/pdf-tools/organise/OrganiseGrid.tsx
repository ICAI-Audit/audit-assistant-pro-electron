// The Organise pages grid (design 5.15): a tile per page in its new order, 200 at a time as in the page
// panel, each with its thumbnail (rotated as planned), its page number in the result and, when moved,
// its original number; removed pages greyed and struck through with Restore. A multi-select list box:
// one tile is in the Tab order (roving focus) and keeps a visible focus ring; the keys are those of
// organiseKeys.ts; tiles can also be dragged (the browser's own drag and drop). Enter, a double-click
// or the expand icon opens the page viewer at that page.
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent, type RefObject } from 'react';
import { ArchiveRestore, Check, ChevronLeft, ChevronRight, FileText, Maximize2, RotateCcw, RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { Turn } from '@/lib/pdf-tools/pageOrder';
import type { WorkingFile } from '@/lib/pdf-tools/types';
import MiddleName from '../MiddleName';
import Thumb from '../Thumb';
import type { OrganiseEditAction, OrganiseEditState } from '../organiseEdit';
import { dropGap, GRID_WINDOW, shownNumbers, shownTiles, windowLabel, windowOf } from './gridLayout';
import { tileLabel } from './organiseAnnounce';
import { gridKey } from './organiseKeys';

const THUMB_WIDTH = 104;
const THUMB_HEIGHT = 136;
/** Square, so a turned thumbnail (136 × 104) fits as well as an upright one. */
const STAGE = 148;
const DRAG_TYPE = 'application/x-vera-organise-pages';
/** A window button that cannot move now: it looks unavailable and keeps the focus. */
const UNAVAILABLE = 'cursor-default opacity-50 hover:bg-background';
/**
 * The grid scrolls with the dialog's body (one scroll area; the toolbar above stays in view), so the
 * thumbnails are drawn lazily against the viewport: Thumb's observer with no root element.
 */
const VIEWPORT: RefObject<HTMLOListElement> = { current: null };

export interface OrganiseGridProps {
  file: WorkingFile;
  state: OrganiseEditState;
  current: () => OrganiseEditState;
  apply: (actions: readonly OrganiseEditAction[]) => OrganiseEditState;
  disabled: boolean;
  /** Brings a page (by source index) into view after a toolbar edit; `n` lets the same page be shown again. */
  reveal: { source: number; n: number } | null;
  /** Opens the page viewer at a page (source index), returning focus to `opener`. */
  onView: (source: number, opener: HTMLElement | null, placeholder: string | null) => void;
  /** The id of the keys hint under the grid. */
  hintId: string;
}

type DropMark = { gap: number; over: number } | null;

const columnsOf = (list: HTMLElement | null) => (list ? getComputedStyle(list).gridTemplateColumns.split(' ').filter(Boolean).length || 1 : 1);
const thumbOf = (element: Element | null) => element?.closest('li')?.querySelector<HTMLImageElement>('img[data-testid="pdf-tools-thumb"]')?.src ?? null;

export default function OrganiseGrid({ file, state, current, apply, disabled, reveal, onView, hintId }: OrganiseGridProps) {
  const listRef = useRef<HTMLOListElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const total = state.tiles.length;
  const [focusSource, setFocusSource] = useState<number | null>(null);
  const focusPlace = focusSource === null ? -1 : state.tiles.findIndex((tile) => tile.source === focusSource);
  const [start, setStart] = useState(0);
  const win = windowOf(start, total);
  const numbers = useMemo(() => shownNumbers(state.tiles), [state.tiles]);
  // Focus follows the focused tile after a key: each key the grid handles asks once (a counter), and the
  // request is done after that key's render. A flag left set by a key that moved nothing (Space, R, Delete)
  // would pull the focus back from the toolbar at its next move (REV-B S5).
  const [focusRequest, setFocusRequest] = useState(0);
  const focusDone = useRef(0);
  const [drop, setDrop] = useState<DropMark>(null);
  const dropRef = useRef<DropMark>(null);
  const [dragging, setDragging] = useState(false);
  const dragBadge = useRef<HTMLDivElement>(null);
  const [dragCount, setDragCount] = useState(1);

  const tabbable = focusPlace >= win.start && focusPlace < win.end ? focusPlace : win.start;

  // Keep the focused tile in the window, then focus it (after a key moved it or moved focus).
  useLayoutEffect(() => {
    if (focusDone.current === focusRequest) return;
    if (focusPlace < 0) {
      focusDone.current = focusRequest;
      return;
    }
    if (focusPlace < win.start || focusPlace >= win.end) {
      setStart(windowOf(focusPlace, total).start);
      return;
    }
    focusDone.current = focusRequest;
    const element = listRef.current?.querySelector<HTMLElement>(`[data-source="${focusSource}"]`);
    if (!element) return;
    element.focus({ preventScroll: true });
    element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [focusRequest, focusPlace, focusSource, win.start, win.end, total]);

  // A toolbar edit: show the first chosen page where it went, without taking focus from the toolbar.
  useEffect(() => {
    if (!reveal) return;
    const place = current().tiles.findIndex((tile) => tile.source === reveal.source);
    if (place < 0) return;
    const shown = windowOf(place, total);
    setStart(shown.start);
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>(`[data-source="${reveal.source}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
  }, [reveal, current, total]);

  const showWindow = (from: number) => {
    setStart(from);
    panelRef.current?.scrollIntoView({ block: 'start' });
  };

  // ---- keys ------------------------------------------------------------------------------------
  const onKeyDown = (event: KeyboardEvent<HTMLOListElement>) => {
    if (disabled) return;
    const tile = (event.target as HTMLElement).closest<HTMLElement>('[data-place]');
    if (!tile || !event.currentTarget.contains(tile)) return;
    const place = Number(tile.dataset.place);
    const now = current();
    const out = gridKey(event, now, place, columnsOf(listRef.current));
    if (!out.handled) return;
    event.preventDefault();
    event.stopPropagation();
    if (out.view) {
      if (!event.repeat) onView(now.tiles[place].source, tile, thumbOf(tile));
      return;
    }
    const followed = now.tiles[out.focus ?? place]?.source;
    if (out.actions.length > 0) apply(out.actions);
    if (followed !== undefined) {
      setFocusSource(followed);
      setFocusRequest((n) => n + 1);
    }
  };

  // ---- pointer ---------------------------------------------------------------------------------
  const placeOf = (element: HTMLElement) => Number(element.closest<HTMLElement>('[data-place]')?.dataset.place ?? -1);

  const onTileClick = useCallback(
    (event: MouseEvent<HTMLLIElement>) => {
      if (disabled) return;
      const place = placeOf(event.currentTarget);
      const tile = current().tiles[place];
      if (!tile) return;
      const mode = event.shiftKey ? 'range' : event.ctrlKey || event.metaKey ? 'toggle' : 'only';
      apply([{ type: 'choose', index: place, mode }]);
      setFocusSource(tile.source);
    },
    [apply, current, disabled],
  );

  const onTileDoubleClick = useCallback(
    (event: MouseEvent<HTMLLIElement>) => {
      if (disabled) return;
      const tile = current().tiles[placeOf(event.currentTarget)];
      if (tile) onView(tile.source, event.currentTarget, thumbOf(event.currentTarget));
    },
    [current, disabled, onView],
  );

  const onExpand = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      const tile = current().tiles[placeOf(event.currentTarget)];
      // Focus comes back to the page itself: the icon is for the mouse and hidden from screen readers.
      const page = event.currentTarget.closest<HTMLElement>('[data-place]');
      if (tile) onView(tile.source, page, thumbOf(event.currentTarget));
    },
    [current, onView],
  );

  const onRestore = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      if (disabled) return;
      const place = placeOf(event.currentTarget);
      const tile = current().tiles[place];
      if (!tile) return;
      // The button goes with the restore: the page itself takes the focus first, so Delete, R and Ctrl+Z
      // still act on it (REV-B S7).
      event.currentTarget.closest<HTMLElement>('[data-place]')?.focus({ preventScroll: true });
      apply([{ type: 'choose', index: place, mode: 'only' }, { type: 'restore' }]);
      setFocusSource(tile.source);
    },
    [apply, current, disabled],
  );

  // ---- drag and drop ---------------------------------------------------------------------------
  const setMark = (mark: DropMark) => {
    const was = dropRef.current;
    if (was?.gap === mark?.gap && was?.over === mark?.over) return;
    dropRef.current = mark;
    setDrop(mark);
  };
  const endDrag = useCallback(() => {
    dropRef.current = null;
    setDrop(null);
    setDragging(false);
  }, []);

  const onDragStart = useCallback(
    (event: DragEvent<HTMLLIElement>) => {
      if (disabled) {
        event.preventDefault();
        return;
      }
      const place = placeOf(event.currentTarget);
      const now = current();
      const tile = now.tiles[place];
      if (!tile) return;
      const count = now.chosen.has(tile.source) ? now.chosen.size : 1;
      if (!now.chosen.has(tile.source)) apply([{ type: 'choose', index: place, mode: 'only' }]);
      setFocusSource(tile.source);
      event.dataTransfer.setData(DRAG_TYPE, 'pages');
      event.dataTransfer.effectAllowed = 'move';
      setDragCount(count);
      if (count > 1 && dragBadge.current) {
        dragBadge.current.textContent = `Moving ${count} pages`;
        event.dataTransfer.setDragImage(dragBadge.current, 12, 12);
      }
      setDragging(true);
    },
    [apply, current, disabled],
  );

  const ours = (event: DragEvent) => Array.from(event.dataTransfer.types).includes(DRAG_TYPE);

  const onTileDragOver = useCallback((event: DragEvent<HTMLLIElement>) => {
    if (!ours(event)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';
    const place = placeOf(event.currentTarget);
    const box = event.currentTarget.getBoundingClientRect();
    setMark({ gap: dropGap(place, event.clientX, box.left, box.width), over: place });
  }, []);

  const onListDragOver = (event: DragEvent<HTMLOListElement>) => {
    if (!ours(event) || event.target !== event.currentTarget) return;
    // Over the empty end of the grid: after the last tile shown.
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setMark({ gap: win.end, over: win.end - 1 });
  };

  const onDrop = (event: DragEvent<HTMLOListElement>) => {
    if (!ours(event)) return;
    event.preventDefault();
    event.stopPropagation();
    const mark = dropRef.current;
    endDrag();
    if (!mark || disabled) return;
    apply([{ type: 'drop', at: mark.gap }]);
  };

  const onDragLeave = (event: DragEvent<HTMLOListElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setMark(null);
  };

  const shown = shownTiles(state.tiles, win);
  return (
    <section ref={panelRef} aria-label={`Pages of ${file.name}`} className="scroll-mt-44 rounded-lg border bg-card shadow-sm" data-testid="pdf-tools-organise-panel">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-t-lg border-b bg-muted/30 px-3 py-1.5">
        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <MiddleName name={file.name} className="text-xs font-medium text-foreground" />
        {total > GRID_WINDOW && (
          <span className="ml-auto text-xs tabular-nums text-muted-foreground" data-testid="pdf-tools-organise-window">
            {windowLabel(win, total)}
          </span>
        )}
        {total > GRID_WINDOW && (
          <div className="flex items-center gap-1.5">
          {/* aria-disabled, not disabled, at either end: a disabled button would drop the focus (REV-B S7). */}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={cn('h-7 px-2 text-xs', win.start === 0 && UNAVAILABLE)}
            data-testid="pdf-tools-organise-window-prev"
            aria-disabled={win.start === 0 || undefined}
            onClick={() => win.start > 0 && showWindow(Math.max(0, win.start - GRID_WINDOW))}
          >
            <ChevronLeft />
            Previous {GRID_WINDOW}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={cn('h-7 px-2 text-xs', win.end >= total && UNAVAILABLE)}
            data-testid="pdf-tools-organise-window-next"
            aria-disabled={win.end >= total || undefined}
            onClick={() => win.end < total && showWindow(win.end)}
          >
            Next {Math.min(GRID_WINDOW, total - win.end) || GRID_WINDOW}
            <ChevronRight />
          </Button>
          </div>
        )}
      </div>
      <ol
        ref={listRef}
        role="listbox"
        aria-multiselectable="true"
        aria-label="Pages in their new order"
        aria-describedby={hintId}
        aria-disabled={disabled || undefined}
        data-testid="pdf-tools-organise-grid"
        className="grid gap-x-2 gap-y-3 p-3"
        style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${STAGE + 12}px, 1fr))` }}
        onKeyDown={onKeyDown}
        onDragOver={onListDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        {shown.map(({ tile, place }) => {
          const isChosen = state.chosen.has(tile.source);
          return (
            <Tile
              key={tile.source}
              file={file}
              source={tile.source}
              place={place}
              number={numbers[place]}
              turn={tile.turn}
              removed={tile.removed}
              chosen={isChosen}
              lifted={dragging && isChosen}
              tabbable={place === tabbable}
              label={tileLabel(state, place, numbers[place])}
              dropSide={drop && drop.over === place ? (drop.gap === place ? 'before' : 'after') : null}
              disabled={disabled}
              scrollRoot={VIEWPORT}
              onClick={onTileClick}
              onDoubleClick={onTileDoubleClick}
              onExpand={onExpand}
              onRestore={onRestore}
              onDragStart={onDragStart}
              onDragOver={onTileDragOver}
              onDragEnd={endDrag}
            />
          );
        })}
      </ol>
      {/* The picture under the pointer while several pages are dragged (setDragImage needs it in the page). */}
      <div ref={dragBadge} aria-hidden="true" className="pointer-events-none fixed -left-[9999px] top-0 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground shadow">
        {`Moving ${dragCount} pages`}
      </div>
    </section>
  );
}

interface TileProps {
  file: WorkingFile;
  source: number;
  place: number;
  number: number | null;
  turn: Turn;
  removed: boolean;
  chosen: boolean;
  lifted: boolean;
  tabbable: boolean;
  label: string;
  dropSide: 'before' | 'after' | null;
  disabled: boolean;
  scrollRoot: RefObject<HTMLOListElement>;
  onClick: (event: MouseEvent<HTMLLIElement>) => void;
  onDoubleClick: (event: MouseEvent<HTMLLIElement>) => void;
  onExpand: (event: MouseEvent<HTMLButtonElement>) => void;
  onRestore: (event: MouseEvent<HTMLButtonElement>) => void;
  onDragStart: (event: DragEvent<HTMLLIElement>) => void;
  onDragOver: (event: DragEvent<HTMLLIElement>) => void;
  onDragEnd: () => void;
}

const Tile = memo(function Tile({
  file,
  source,
  place,
  number,
  turn,
  removed,
  chosen,
  lifted,
  tabbable,
  label,
  dropSide,
  disabled,
  scrollRoot,
  onClick,
  onDoubleClick,
  onExpand,
  onRestore,
  onDragStart,
  onDragOver,
  onDragEnd,
}: TileProps) {
  const original = source + 1;
  const moved = number !== null && number !== original;
  return (
    <li
      role="option"
      aria-selected={chosen}
      aria-label={`${label}. Press Enter to view it larger.`}
      tabIndex={tabbable ? 0 : -1}
      data-place={place}
      data-source={source}
      data-testid={`pdf-tools-organise-tile-${original}`}
      data-chosen={chosen || undefined}
      data-removed={removed || undefined}
      data-turn={turn}
      draggable={!disabled}
      // Off-screen tiles are not laid out (review S1: a move on 300 pages, 120 ms to 67 ms); the size keeps the grid steady.
      style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 160px auto 186px' }}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      className={cn(
        // scroll-mt: a tile brought into view by the keys is not left under the sticky toolbar.
        'group relative flex scroll-mb-3 scroll-mt-48 cursor-pointer select-none flex-col items-center gap-1.5 rounded-lg p-1 outline-none ring-offset-background transition-opacity',
        'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        lifted && 'opacity-50',
        disabled && 'cursor-default',
      )}
    >
      {dropSide && (
        <span
          aria-hidden="true"
          data-testid="pdf-tools-organise-drop-mark"
          className={cn('absolute bottom-7 top-1 w-[3px] rounded-full bg-primary', dropSide === 'before' ? '-left-[5px]' : '-right-[5px]')}
        />
      )}
      <div
        className={cn(
          'relative flex items-center justify-center rounded-md border transition-colors',
          chosen ? 'border-primary bg-primary/10 ring-2 ring-primary' : 'border-transparent bg-muted/40 group-hover:bg-muted/70',
        )}
        style={{ width: STAGE, height: STAGE }}
      >
        <div
          className={cn('transition-transform duration-150 motion-reduce:transition-none', removed && 'opacity-35 grayscale')}
          style={{ transform: turn ? `rotate(${turn}deg)` : undefined }}
        >
          {/* 'dialog': the grid's pages come before the page panel's behind it, and a page the panel has drawn at
              this size shows at once (QA-FIX C). */}
          <Thumb file={file} pageIndex={source} width={THUMB_WIDTH} scrollRoot={scrollRoot} priority="dialog" alt="" className="h-[136px] bg-white shadow-sm" />
        </div>
        {removed && (
          <>
            <svg aria-hidden="true" className="pointer-events-none absolute inset-2 h-[calc(100%-1rem)] w-[calc(100%-1rem)] text-destructive/80" viewBox="0 0 100 100" preserveAspectRatio="none">
              <line x1="4" y1="96" x2="96" y2="4" stroke="currentColor" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
            </svg>
            <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-destructive px-2 py-0.5 text-[11px] font-semibold text-destructive-foreground shadow">
              Removed
            </span>
          </>
        )}
        {chosen && (
          <span aria-hidden="true" className="absolute left-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground shadow">
            <Check className="h-3.5 w-3.5" strokeWidth={3} />
          </span>
        )}
        {turn !== 0 && !removed && (
          <span
            aria-hidden="true"
            data-testid={`pdf-tools-organise-turn-badge-${original}`}
            className="absolute bottom-1.5 left-1.5 flex items-center gap-0.5 rounded-full bg-foreground px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-background shadow"
          >
            {turn === 270 ? <RotateCcw className="h-3 w-3" strokeWidth={2.5} /> : <RotateCw className="h-3 w-3" strokeWidth={2.5} />}
            {turn === 90 ? 'Right' : turn === 270 ? 'Left' : `${turn}°`}
          </span>
        )}
        {/* For the mouse: Enter opens the viewer from the keyboard, so these are not in the Tab order. */}
        <button
          type="button"
          tabIndex={-1}
          aria-hidden="true"
          title="View larger"
          data-testid={`pdf-tools-organise-expand-${original}`}
          onClick={onExpand}
          onDoubleClick={(event) => event.stopPropagation()}
          className={cn(
            'absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-md border bg-background/95 text-foreground shadow-sm transition-opacity hover:bg-accent',
            'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100',
          )}
        >
          <Maximize2 className="h-3.5 w-3.5" />
        </button>
        {removed && (
          <button
            type="button"
            tabIndex={-1}
            aria-hidden="true"
            disabled={disabled}
            data-testid={`pdf-tools-organise-tile-restore-${original}`}
            onClick={onRestore}
            onDoubleClick={(event) => event.stopPropagation()}
            className="absolute bottom-1.5 right-1.5 flex items-center gap-1 rounded-md border bg-background px-1.5 py-0.5 text-[11px] font-medium text-foreground shadow-sm hover:bg-accent disabled:opacity-50"
          >
            <ArchiveRestore className="h-3 w-3" />
            Restore
          </button>
        )}
      </div>
      <span className="flex items-baseline gap-1 text-xs tabular-nums" aria-hidden="true">
        {removed ? (
          <>
            <span className="font-medium text-foreground">Removed</span>
            <span className="text-muted-foreground">· was {original}</span>
          </>
        ) : (
          <>
            <span className="font-semibold text-foreground">{number}</span>
            {moved && <span className="text-muted-foreground">· was {original}</span>}
          </>
        )}
      </span>
    </li>
  );
});
