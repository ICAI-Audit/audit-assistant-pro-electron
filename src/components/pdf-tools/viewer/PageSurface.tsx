// The large page: a scrolling view with the page box in it. The page box holds, in layers, the
// drawing (a canvas for a PDF page, an <img> for an image file), a text layer (the search's
// highlights), and an optional overlay that a later tool (the Redact review) draws over the page with
// the mapping of `ViewerSurface`. The page moves with the scroll bars, the wheel, or by dragging.
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { AlertCircle, Loader2, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { ViewerSurface } from './pageGeometry';
import type { PageViewerModel } from './usePageViewer';
import { VIEWER_PAD } from './usePageViewer';
import { wheelZoom } from './viewerKeys';

export interface PageSurfaceProps {
  model: PageViewerModel;
  /** The page box's name for screen readers, for example "Page 3 of 12". */
  label: string;
  /**
   * Drawn over the page box, in its CSS pixels (top-left origin, `surface.width` × `surface.height`).
   * Pointer presses inside an element marked `data-viewer-no-pan` do not drag the page.
   */
  overlay?: (surface: ViewerSurface) => ReactNode;
  /**
   * Drawn between the drawing and the overlay, in the page box's CSS pixels, never taking the pointer
   * (the search's highlights). Shown only while the drawing on screen is the page and turn shown.
   */
  textLayer?: (surface: ViewerSurface) => ReactNode;
  /** Notes laid over the bottom of the view (for example the reduced-sharpness note). */
  children?: ReactNode;
  /** Shown under the drawing, filling the page box, while the page shown is not yet drawn. */
  underlay?: ReactNode;
  className?: string;
}

/** True once `on` has stayed true for `ms`, so quick drawings do not flash a busy state. */
function useDelayed(on: boolean, ms: number): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!on) {
      setShown(false);
      return;
    }
    const timer = setTimeout(() => setShown(true), ms);
    return () => clearTimeout(timer);
  }, [on, ms]);
  return shown;
}

export default function PageSurface({ model, label, overlay, textLayer, children, underlay, className }: PageSurfaceProps) {
  const { box, status, error, isImage, imageUrl, info, cssScale, turn, drawn, showsCurrent, surface } = model;
  const [overflow, setOverflow] = useState(false);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const busy = useDelayed(status === 'loading', 200);

  // Ctrl + wheel zooms around the pointer. The listener must not be passive, or the browser scrolls.
  const zoomAt = useRef(model.zoomIn);
  const zoomOutAt = useRef(model.zoomOut);
  zoomAt.current = model.zoomIn;
  zoomOutAt.current = model.zoomOut;
  const scroller = model.scrollerRef;
  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    let rest = 0;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const step = wheelZoom(rest, event);
      rest = step.rest;
      if (!step.direction) return;
      const bounds = element.getBoundingClientRect();
      const anchor = { x: event.clientX - bounds.left - element.clientLeft, y: event.clientY - bounds.top - element.clientTop };
      if (step.direction === 1) zoomAt.current(anchor);
      else zoomOutAt.current(anchor);
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [scroller]);

  // Whether there is anything to pan.
  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    setOverflow(element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1);
  }, [scroller, box?.width, box?.height]);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const element = scroller.current;
    if (!element || event.button !== 0 || !overflow) return;
    if ((event.target as HTMLElement).closest('[data-viewer-no-pan]')) return;
    drag.current = { x: event.clientX, y: event.clientY, left: element.scrollLeft, top: element.scrollTop };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    const element = scroller.current;
    if (!start || !element) return;
    element.scrollLeft = start.left - (event.clientX - start.x);
    element.scrollTop = start.top - (event.clientY - start.y);
  };
  const endDrag = () => {
    drag.current = null;
    setDragging(false);
  };

  // An image is laid out at its own size and turned inside the page box.
  const imageStyle =
    isImage && info && cssScale
      ? {
          width: info.widthPt * cssScale,
          height: info.heightPt * cssScale,
          transform: `translate(-50%, -50%) rotate(${turn}deg)`,
        }
      : undefined;

  return (
    <div className={cn('relative flex min-h-0 flex-1 flex-col', className)}>
      <div
        ref={model.frameRef}
        tabIndex={0}
        role="group"
        aria-label={`${label}. Use the arrow keys or the scroll bars to move around the page.`}
        data-testid="pdf-tools-viewer-scroll"
        className="relative min-h-0 flex-1 overflow-auto bg-slate-200 [scrollbar-gutter:stable] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring dark:bg-black/40"
      >
        <div
          className={cn('flex min-h-full w-max min-w-full select-none', overflow && (dragging ? 'cursor-grabbing' : 'cursor-grab'))}
          style={{ padding: VIEWER_PAD }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onLostPointerCapture={endDrag}
        >
          <div
            role="img"
            aria-label={label}
            aria-busy={status === 'loading' || undefined}
            data-testid="pdf-tools-viewer-page"
            data-css-scale={cssScale ?? undefined}
            data-transform={surface ? surface.transform.join(',') : undefined}
            className={cn('relative isolate m-auto shrink-0 overflow-hidden bg-white shadow-lg ring-1 ring-black/10', !box && 'invisible')}
            style={{ width: box?.width ?? 0, height: box?.height ?? 0 }}
          >
            {!showsCurrent && underlay}
            {!isImage && (
              <canvas
                ref={model.canvasRef}
                data-testid="pdf-tools-viewer-canvas"
                data-page={drawn ? drawn.pageIndex + 1 : undefined}
                data-turn={drawn?.turn}
                data-scale={drawn?.scale}
                aria-hidden="true"
                className={cn('absolute inset-0 block h-full w-full', !showsCurrent && 'invisible')}
              />
            )}
            {isImage && imageUrl && (
              <img
                src={imageUrl}
                alt=""
                draggable={false}
                data-testid="pdf-tools-viewer-image"
                onLoad={(event) => model.onImageLoad(event.currentTarget)}
                onError={model.onImageError}
                className="absolute left-1/2 top-1/2 max-w-none"
                style={imageStyle}
              />
            )}
            {/* The text layer, between the drawing and the overlay. */}
            {textLayer && surface && showsCurrent && (
              <div className="pointer-events-none absolute inset-0" data-testid="pdf-tools-viewer-text-layer">
                {textLayer(surface)}
              </div>
            )}
            {overlay && surface && showsCurrent && (
              <div className="absolute inset-0" data-testid="pdf-tools-viewer-overlay">
                {overlay(surface)}
              </div>
            )}
            {status === 'failed' && (
              <div role="alert" className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/95 p-6 text-center">
                <AlertCircle className="h-6 w-6 text-destructive" aria-hidden="true" />
                <p className="max-w-xs text-sm text-foreground">{error}</p>
                <Button type="button" size="sm" variant="outline" onClick={model.retry} data-testid="pdf-tools-viewer-retry">
                  <RotateCcw />
                  Try again
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
      {busy && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden="true">
          <span className="flex items-center gap-2 rounded-full border bg-background/95 px-3.5 py-1.5 text-xs font-medium text-foreground shadow-md">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
            Drawing page…
          </span>
        </div>
      )}
      {children}
    </div>
  );
}
