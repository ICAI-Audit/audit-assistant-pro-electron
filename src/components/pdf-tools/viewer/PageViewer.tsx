// The page viewer (design section 4, "Page viewer"): a near-full-window dialog showing one page of
// a working-list file large and sharp, with zoom, fit, pan, page moves, a view-only turn and, when
// opened from a page panel that chooses pages, "Choose this page" in step with the panel. Find (the
// button or Ctrl + F) searches the file's text, with the matches highlighted on the page.
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Check, ChevronLeft, ChevronRight, FileText, ImageIcon, Info, Lock, MoveHorizontal, RotateCcw, RotateCw, Scan, Search, X, ZoomIn, ZoomOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DialogOverlay, DialogPortal } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { WorkingFile } from '@/lib/pdf-tools/types';
import type { ViewerSurface } from './pageGeometry';
import PageSurface from './PageSurface';
import SearchBar from './SearchBar';
import SearchHighlights from './SearchHighlights';
import { usePageJump } from './usePageJump';
import { usePageViewer } from './usePageViewer';
import { useViewerSearch } from './useViewerSearch';
import { attachViewerKeys, type GuardAction } from './viewerGuard';
import { imageSizeLabel, pageSizeLabel, sameShape, zoomPercent, ZOOM_STEPS } from './viewerMath';
import { chooseWords, drawingNotes, focusTargetAfterClose } from './viewerRules';
import { searchAnnouncement } from './viewerSearch';

export interface PageViewerProps {
  file: WorkingFile;
  /** Counted from 1. */
  startPage: number;
  /** The page panel's chosen pages (from 1), when it chooses pages. */
  chosenPages?: number[];
  /** Given when the viewer was opened from a page panel that chooses pages: "Choose this page" appears. */
  onTogglePage?: (pageNumber: number) => void;
  onClose: () => void;
  /** The tile, icon or row that opened the viewer: focus goes back to it on close. */
  returnFocusTo?: HTMLElement | null;
  /** 'destructive' when chosen pages are ones to remove (Delete pages). */
  tone?: 'primary' | 'destructive';
  /** Drawn over the page (the Redact review's boxes): see PageSurface. */
  overlay?: (surface: ViewerSurface) => ReactNode;
  /**
   * A smaller picture of the start page already on screen (its thumbnail's URL). A copy of it is
   * shown, enlarged, under "Drawing page…" until the sharp drawing arrives: a 300 dpi scan takes
   * seconds to draw the first time.
   */
  placeholder?: string | null;
}

// "Rotate" for the file, as Organise pages says it (the owner's word); the view itself is only turned.
const TURN_HINT = 'Turns the view only. The file is not changed. To rotate pages in the file, use Organise pages.';
const BAR_BUTTON = 'h-8 gap-1.5 px-2.5 text-xs';
const ICON_BUTTON = 'h-8 w-8';
// A control that cannot be used now keeps its focus (aria-disabled, not disabled): a disabled button
// drops focus to the page body, where Ctrl + minus then zoomed the whole application (lane V
// review, item 1). It does nothing when pressed and says why.
const UNAVAILABLE = 'cursor-not-allowed opacity-50 hover:bg-transparent';
const SMALLEST = Math.round(ZOOM_STEPS[0] * 100);
const LARGEST = Math.round(ZOOM_STEPS[ZOOM_STEPS.length - 1] * 100);

const isTextField = (target: unknown) => target instanceof HTMLElement && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');

/** The value after it has stayed the same for a moment: a status line is read out once per settled change. */
function useSettled<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

export default function PageViewer({ file, startPage, chosenPages, onTogglePage, onClose, returnFocusTo, tone = 'primary', overlay, placeholder }: PageViewerProps) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const model = usePageViewer({ fileId: file.id, startPage, onClose: () => onCloseRef.current() });
  const { isImage, page, pageCount, cssScale, info, drawn } = model;
  const whyId = useId();
  const shown = model.file;
  // The page number box: Enter goes there; a number not in the file says the range.
  const jump = usePageJump(page, pageCount, (n) => model.goTo(n));
  const search = useViewerSearch(model);
  // Where focus was when the search opened: it goes back there when the search closes.
  const searchOpener = useRef<HTMLElement | null>(null);
  const searchBar = useRef<HTMLDivElement>(null);
  const [barPlacement, setBarPlacement] = useState<'top' | 'bottom'>('top');

  // The viewer's own copy of the start page's thumbnail (the thumbnail itself may be let go by the
  // panel at any time); revoked when the viewer closes.
  const [under, setUnder] = useState<{ url: string; w: number; h: number } | null>(null);
  useEffect(() => {
    if (!placeholder) return;
    let live = true;
    let url: string | null = null;
    fetch(placeholder)
      .then((response) => response.blob())
      .then((blob) => {
        if (!live) return;
        url = URL.createObjectURL(blob);
        setUnder({ url, w: 0, h: 0 });
      })
      .catch(() => undefined); // only a nicety: without it the page box stays white while drawing
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
      setUnder(null);
    };
  }, [placeholder]);

  // The viewer's keys and Ctrl + wheel, wherever focus is, while the viewer is open: on the window,
  // in the capture phase (viewerGuard.ts). Ctrl + minus, plus and 0 never reach Electron's View menu.
  const actRef = useRef<(action: GuardAction) => void>(() => undefined);
  const hasPagesRef = useRef(false);
  const showing = Boolean(shown);
  useEffect(() => {
    if (!showing) return;
    return attachViewerKeys(
      window,
      () => {
        const scroller = model.scrollerRef.current;
        return { hasPages: hasPagesRef.current, fitsWidth: !scroller || scroller.scrollWidth <= scroller.clientWidth + 1, isTextField };
      },
      (action) => actRef.current(action),
    );
  }, [showing, model.scrollerRef]);

  // A blank page is named quietly; Try again belongs to a page that failed to draw (PageSurface).
  const notes = model.showsCurrent && !model.error ? drawingNotes(drawn) : [];
  // The current match, read out once it has settled: its number and page (never the words searched).
  const settledSearch = useSettled(search.open && search.state ? searchAnnouncement(search.state) : '', 500);

  // The current match is scrolled into view (centred when it is not already in view), and the box moves
  // to the other end of the page view when it would cover the match.
  const surfaceNow = model.surface;
  const reveal = search.reveal;
  const revealedFn = search.revealed;
  const scrollerRef = model.scrollerRef;
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (!reveal || !surfaceNow || !scroller) return;
    const pageBox = scroller.querySelector<HTMLElement>('[data-testid="pdf-tools-viewer-page"]');
    if (!pageBox) return;
    const css = surfaceNow.rectToCss(reveal.box);
    const frame = scroller.getBoundingClientRect();
    const at = pageBox.getBoundingClientRect();
    // The match in the scrolled content's coordinates.
    const left = at.left - frame.left + scroller.scrollLeft + css.left;
    const top = at.top - frame.top + scroller.scrollTop + css.top;
    const margin = 48;
    const fitsX = left >= scroller.scrollLeft + margin && left + css.width <= scroller.scrollLeft + scroller.clientWidth - margin;
    const fitsY = top >= scroller.scrollTop + margin && top + css.height <= scroller.scrollTop + scroller.clientHeight - margin;
    const nextLeft = fitsX ? scroller.scrollLeft : Math.max(0, left + css.width / 2 - scroller.clientWidth / 2);
    const nextTop = fitsY ? scroller.scrollTop : Math.max(0, top + css.height / 2 - scroller.clientHeight / 2);
    if (nextLeft !== scroller.scrollLeft || nextTop !== scroller.scrollTop) scroller.scrollTo({ left: nextLeft, top: nextTop });
    const bar = searchBar.current?.getBoundingClientRect();
    if (bar) {
      const hitLeft = frame.left + left - scroller.scrollLeft;
      const hitTop = frame.top + top - scroller.scrollTop;
      const under = hitLeft < bar.right && hitLeft + css.width > bar.left && hitTop < bar.bottom && hitTop + css.height > bar.top;
      if (under) setBarPlacement((p) => (p === 'top' ? 'bottom' : 'top'));
    }
    revealedFn(reveal.request);
  }, [reveal, surfaceNow, revealedFn, scrollerRef]);

  const settledStatus = useSettled(
    `Page ${page} of ${pageCount}${cssScale ? `, ${zoomPercent(cssScale)}%` : ''}${model.turn ? `, view turned ${model.turn}°` : ''}${notes.map((n) => `. ${n.text}`).join('')}`,
    400,
  );

  if (!shown) return null;

  const chosen = Boolean(chosenPages?.includes(page));
  const hasPages = !isImage;
  const percent = cssScale ? zoomPercent(cssScale) : null;
  const sizeLabel = info ? (isImage ? imageSizeLabel(info.widthPt, info.heightPt) : pageSizeLabel(info.widthPt, info.heightPt)) : null;
  const pageLabel = isImage ? `Image ${shown.name}` : `Page ${page} of ${pageCount}${model.turn ? `, view turned ${model.turn}°` : ''}`;
  const requestClose = () => model.close();
  const openSearch = () => {
    if (!search.available) return;
    const active = document.activeElement;
    if (!search.open) searchOpener.current = active instanceof HTMLElement && active.closest('[data-testid="pdf-tools-viewer"]') ? active : null;
    search.openSearch();
  };
  const closeSearch = () => {
    search.closeSearch();
    setBarPlacement('top');
    const back = searchOpener.current;
    searchOpener.current = null;
    (back?.isConnected ? back : model.scrollerRef.current)?.focus({ preventScroll: true });
  };
  // Escape closes the search first, the viewer second.
  const escape = () => {
    if (search.open) closeSearch();
    else requestClose();
  };

  hasPagesRef.current = hasPages;
  actRef.current = (action) => {
    // Out of range does nothing (goTo holds the page within the file; a zoom step stays at its end).
    if (action === 'zoom-in') model.zoomIn();
    else if (action === 'zoom-out') model.zoomOut();
    else if (action === 'fit-page') model.setZoom({ kind: 'fit-page' });
    else if (action === 'next') model.goTo(page + 1);
    else if (action === 'prev') model.goTo(page - 1);
    else if (action === 'first') model.goTo(1);
    else if (action === 'last') model.goTo(pageCount);
    else if (action === 'find') openSearch();
    else if (action === 'escape') escape();
  };

  // Why each control cannot be used now (null: it can).
  const why = {
    prev: page <= 1 ? 'This is the first page.' : null,
    next: page >= pageCount ? 'This is the last page.' : null,
    zoomOut: model.canZoomOut ? null : `The view is at its smallest zoom, ${SMALLEST}%.`,
    zoomIn: model.canZoomIn ? null : `The view is at its largest zoom, ${LARGEST}%.`,
  };
  const unavailable = (key: keyof typeof why, act: () => void) => ({
    'aria-disabled': why[key] ? true : undefined,
    'aria-describedby': why[key] ? `${whyId}-${key}` : undefined,
    onClick: () => {
      if (!why[key]) act();
    },
  });
  const words = chooseWords(tone);

  // A tooltip is a layer above the dialog: Escape on it would only close the tooltip. Here it
  // closes the viewer as well, in one press.
  const tip = (text: string, child: ReactElement) => (
    <Tooltip>
      <TooltipTrigger asChild>{child}</TooltipTrigger>
      <TooltipContent side="bottom" collisionPadding={8} className="max-w-[300px] text-xs" onEscapeKeyDown={escape}>
        {text}
      </TooltipContent>
    </Tooltip>
  );
  const fitWidth = model.zoom.kind === 'fit-width';
  const fitPage = model.zoom.kind === 'fit-page';
  const actual = model.zoom.kind === 'percent' && model.zoom.value === 1;

  return (
    <DialogPrimitive.Root open onOpenChange={(open) => !open && requestClose()}>
      <DialogPortal>
        <DialogOverlay className="bg-black/70" />
        <DialogPrimitive.Content
          data-testid="pdf-tools-viewer"
          data-file-kind={shown.kind}
          className="fixed inset-4 z-50 flex flex-col overflow-hidden rounded-lg border bg-background shadow-2xl focus:outline-none"
          onOpenAutoFocus={(event) => {
            // The page itself takes focus: the arrow keys scroll it and the viewer's keys work at once.
            event.preventDefault();
            model.scrollerRef.current?.focus({ preventScroll: true });
          }}
          onEscapeKeyDown={(event) => {
            // Escape is the viewer's own key (viewerGuard): the guard closes the search box first and the
            // viewer second, and keeps the key from this layer. Should it ever arrive here, the same rule.
            event.preventDefault();
            escape();
          }}
          onCloseAutoFocus={(event) => {
            // Opened from state, with no trigger: focus goes back to the opener here (not after a change
            // of engagement or user, see viewerRules).
            event.preventDefault();
            focusTargetAfterClose(model.closeReason(), [returnFocusTo])?.focus({ preventScroll: true });
          }}
        >
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b bg-card px-3 py-2 sm:px-4">
            <div className="flex min-w-0 flex-1 items-center gap-2.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10" aria-hidden="true">
                {isImage ? <ImageIcon className="h-4 w-4 text-primary" /> : <FileText className="h-4 w-4 text-primary" />}
              </span>
              <div className="min-w-0">
                <DialogPrimitive.Title className="truncate text-sm font-semibold leading-5 text-foreground" title={shown.name}>
                  {shown.name}
                </DialogPrimitive.Title>
                <DialogPrimitive.Description className="truncate text-xs leading-4 text-muted-foreground" data-testid="pdf-tools-viewer-size">
                  {sizeLabel ?? (isImage ? 'Image' : `Page ${page} of ${pageCount}`)}
                  <span className="sr-only">. The page is shown as a picture; its text cannot be read aloud here.</span>
                </DialogPrimitive.Description>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              {search.available &&
                tip(
                  'Find text (Ctrl + F)',
                  <Button
                    type="button"
                    variant={search.open ? 'secondary' : 'ghost'}
                    size="icon"
                    className={ICON_BUTTON}
                    data-testid="pdf-tools-viewer-find"
                    aria-label="Find text"
                    aria-pressed={search.open}
                    onClick={() => (search.open ? closeSearch() : openSearch())}
                  >
                    <Search />
                  </Button>,
                )}
              {hasPages && (
                <div className="flex items-center gap-1" role="group" aria-label="Pages">
                  {tip(
                    why.prev ? `Previous page: ${why.prev}` : 'Previous page (PgUp)',
                    <Button type="button" variant="ghost" size="icon" className={cn(ICON_BUTTON, why.prev && UNAVAILABLE)} data-testid="pdf-tools-viewer-prev" aria-label="Previous page" {...unavailable('prev', () => model.goTo(page - 1))}>
                      <ChevronLeft />
                    </Button>,
                  )}
                  <label className="relative flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span>Page</span>
                    <Input data-testid="pdf-tools-viewer-page-input" aria-label={`Page number, 1 to ${pageCount}`} {...jump.inputProps} onBlur={() => window.setTimeout(jump.inputProps.onBlur, 0)} className="h-8 w-14 px-1.5 text-center text-xs tabular-nums" />
                    <span className="whitespace-nowrap tabular-nums">of {pageCount}</span>
                    {jump.problem && (
                      <span
                        id={jump.problemId}
                        role="alert"
                        data-testid="pdf-tools-viewer-page-problem"
                        className="absolute left-0 top-full z-30 mt-1.5 w-max max-w-[280px] rounded-md border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md"
                      >
                        {jump.problem}
                      </span>
                    )}
                  </label>
                  {tip(
                    why.next ? `Next page: ${why.next}` : 'Next page (PgDn)',
                    <Button type="button" variant="ghost" size="icon" className={cn(ICON_BUTTON, why.next && UNAVAILABLE)} data-testid="pdf-tools-viewer-next" aria-label="Next page" {...unavailable('next', () => model.goTo(page + 1))}>
                      <ChevronRight />
                    </Button>,
                  )}
                </div>
              )}

              <div className="flex items-center gap-1" role="group" aria-label="Zoom">
                {tip(
                  why.zoomOut ? `Zoom out: ${why.zoomOut}` : 'Zoom out (Ctrl + minus)',
                  <Button type="button" variant="ghost" size="icon" className={cn(ICON_BUTTON, why.zoomOut && UNAVAILABLE)} data-testid="pdf-tools-viewer-zoom-out" aria-label="Zoom out" {...unavailable('zoomOut', () => model.zoomOut())}>
                    <ZoomOut />
                  </Button>,
                )}
                {/* The zoom is read out in the status line below; this is its visible reading. */}
                <span className="w-12 text-center text-xs font-medium tabular-nums text-foreground" data-testid="pdf-tools-viewer-zoom">
                  {percent ? `${percent}%` : '–'}
                </span>
                {tip(
                  why.zoomIn ? `Zoom in: ${why.zoomIn}` : 'Zoom in (Ctrl + plus)',
                  <Button type="button" variant="ghost" size="icon" className={cn(ICON_BUTTON, why.zoomIn && UNAVAILABLE)} data-testid="pdf-tools-viewer-zoom-in" aria-label="Zoom in" {...unavailable('zoomIn', () => model.zoomIn())}>
                    <ZoomIn />
                  </Button>,
                )}
                <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
                <Button type="button" variant={fitWidth ? 'secondary' : 'ghost'} size="sm" className={BAR_BUTTON} data-testid="pdf-tools-viewer-fit-width" aria-pressed={fitWidth} onClick={() => model.setZoom({ kind: 'fit-width' })}>
                  <MoveHorizontal />
                  Fit width
                </Button>
                {tip(
                  'Fit the whole page (Ctrl + 0)',
                  <Button type="button" variant={fitPage ? 'secondary' : 'ghost'} size="sm" className={BAR_BUTTON} data-testid="pdf-tools-viewer-fit-page" aria-pressed={fitPage} onClick={() => model.setZoom({ kind: 'fit-page' })}>
                    <Scan />
                    Fit page
                  </Button>,
                )}
                {tip(
                  'Show at 100%',
                  <Button type="button" variant={actual ? 'secondary' : 'ghost'} size="sm" className={BAR_BUTTON} data-testid="pdf-tools-viewer-actual-size" aria-pressed={actual} onClick={() => model.setZoom({ kind: 'percent', value: 1 })}>
                    Actual size
                  </Button>,
                )}
              </div>

              <div className="flex items-center gap-1" role="group" aria-label="Turn the view">
                {tip(
                  `Turn the view left. ${TURN_HINT}`,
                  <Button type="button" variant="ghost" size="icon" className={ICON_BUTTON} data-testid="pdf-tools-viewer-turn-left" aria-label={`Turn the view left. ${TURN_HINT}`} onClick={() => model.turnBy(-1)}>
                    <RotateCcw />
                  </Button>,
                )}
                {tip(
                  `Turn the view right. ${TURN_HINT}`,
                  <Button type="button" variant="ghost" size="icon" className={ICON_BUTTON} data-testid="pdf-tools-viewer-turn-right" aria-label={`Turn the view right. ${TURN_HINT}`} onClick={() => model.turnBy(1)}>
                    <RotateCw />
                  </Button>,
                )}
              </div>

              {onTogglePage &&
                hasPages &&
                tip(
                  chosen ? words.onHint : tone === 'destructive' ? 'Marks this page to be removed' : 'Adds this page to the chosen pages',
                  <Button
                    type="button"
                    variant={chosen ? 'default' : 'outline'}
                    size="sm"
                    className={cn(BAR_BUTTON, chosen && tone === 'destructive' && 'bg-destructive text-destructive-foreground hover:bg-destructive/90')}
                    data-testid="pdf-tools-viewer-choose"
                    aria-pressed={chosen}
                    onClick={() => onTogglePage(page)}
                  >
                    <Check className={cn(!chosen && 'opacity-40')} />
                    {chosen ? words.on : words.off}
                  </Button>,
                )}

              {tip(
                'Close (Esc)',
                <Button type="button" variant="ghost" size="icon" className={ICON_BUTTON} data-testid="pdf-tools-viewer-close" aria-label="Close" onClick={requestClose}>
                  <X />
                </Button>,
              )}
            </div>
          </div>

          {shown.protectedOutput && (
            <p className="flex items-center gap-2 border-b bg-primary/5 px-4 py-1.5 text-xs text-foreground" data-testid="pdf-tools-viewer-protected">
              <Lock className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
              Preview of the content. The saved file asks for its password.
            </p>
          )}

          <PageSurface
            model={model}
            label={pageLabel}
            overlay={overlay}
            textLayer={search.open && search.highlights.length > 0 ? (surface) => <SearchHighlights surface={surface} highlights={search.highlights} /> : undefined}
            underlay={
              under && page === startPage && model.turn === 0 && model.box && (under.w === 0 || sameShape(under.w, under.h, model.box.width, model.box.height)) ? (
                <img
                  src={under.url}
                  alt=""
                  aria-hidden="true"
                  draggable={false}
                  data-testid="pdf-tools-viewer-underlay"
                  onLoad={(event) => {
                    const { naturalWidth: w, naturalHeight: h } = event.currentTarget;
                    setUnder((u) => (u && u.w !== w ? { ...u, w, h } : u));
                  }}
                  className="absolute inset-0 h-full w-full opacity-80"
                />
              ) : null
            }
          >
            {search.open && <SearchBar search={search} placement={barPlacement} tip={tip} onClose={closeSearch} barRef={searchBar} />}
            {notes.length > 0 && (
              <div className="pointer-events-none absolute inset-x-0 bottom-3 flex flex-col items-center gap-2 px-4">
                {notes.map((n) =>
                  n.kind === 'blank' ? (
                    // A caption, not an alert: no icon, no button.
                    <p key={n.kind} data-testid="pdf-tools-viewer-blank" className="rounded-full bg-background/80 px-3 py-0.5 text-xs text-muted-foreground">
                      {n.text}
                    </p>
                  ) : (
                    <p key={n.kind} data-testid="pdf-tools-viewer-reduced" className="flex items-center gap-1.5 rounded-full border bg-background/95 px-3 py-1 text-xs text-foreground shadow-md">
                      <Info className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                      {n.text}
                    </p>
                  ),
                )}
              </div>
            )}
          </PageSurface>

          {/* Why a control cannot be used now, for screen readers (aria-describedby). */}
          {(Object.keys(why) as (keyof typeof why)[]).map((key) =>
            why[key] ? (
              <span key={key} id={`${whyId}-${key}`} className="sr-only">
                {why[key]}
              </span>
            ) : null,
          )}

          <p className="sr-only" role="status" aria-live="polite">
            {settledStatus}
          </p>
          <p className="sr-only" role="status" aria-live="polite" data-testid="pdf-tools-viewer-search-status">
            {settledSearch}
          </p>
        </DialogPrimitive.Content>
      </DialogPortal>
    </DialogPrimitive.Root>
  );
}
