// Redact's page surface (design 5.9 "What the user sees", "Boxes", "The list and the review"): the page
// viewer's surface (viewer/PageSurface.tsx, its single mapping of PDF points to the page box) with the
// review's boxes drawn over it, a box chosen by clicking it, and boxes drawn by dragging ("Add a box" with the
// mouse) or with the keyboard ("Add a box" with the keyboard: arrow keys move it, Shift+arrows 10 pt, Alt+arrows resize it,
// Enter adds it, Escape drops it).
//
// On the page: a proposal is an outlined box (blue for sure, dashed amber for possible, grey when
// unticked); a ticked box is filled half-transparent black; a place removed without a box (hidden) is
// dotted; a drawn box is filled black with a red outline; the selected box has a thick outline.
//
// Confidentiality: the boxes carry ids only (page, offsets, kind; drawn boxes a random id). No value is
// put into an attribute, a title or a label here.
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { Rect } from '@/lib/pdf-tools/pageText';
import { cn } from '@/lib/utils';
import type { ViewerSurface } from '../viewer/pageGeometry';
import PageSurface from '../viewer/PageSurface';
import type { PageViewerModel } from '../viewer/usePageViewer';
import { newBoxId, nudge } from './drawnBoxes';
import { MIN_DRAWN_PT, type ReviewAction, type ReviewState } from './reviewState';

/** A box being placed with the keyboard, in PDF points. */
export interface PendingBox {
  page: number;
  rect: Rect;
  /** Set once the user has moved or resized it: a placed box is kept when the user goes back to the mouse. */
  placed?: boolean;
}

export interface RedactPageSurfaceProps {
  model: PageViewerModel;
  state: ReviewState;
  dispatch: (action: ReviewAction) => void;
  /** Drag on the page draws a box (else a drag moves the page). */
  drawMode: boolean;
  pending: PendingBox | null;
  setPending: (box: PendingBox | null) => void;
  disabled: boolean;
  /** A box on the page was chosen: its row is selected and shown. */
  onChoose: (id: string) => void;
}

function Overlay({ surface, props }: { surface: ViewerSurface; props: RedactPageSurfaceProps }) {
  const { state, dispatch, drawMode, pending, setPending, disabled, onChoose } = props;
  const page = surface.pageIndex;
  const layer = useRef<HTMLDivElement>(null);
  const pendingRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const local = (event: PointerEvent) => {
    const bounds = layer.current!.getBoundingClientRect();
    return [Math.max(0, Math.min(surface.width, event.clientX - bounds.left)), Math.max(0, Math.min(surface.height, event.clientY - bounds.top))] as const;
  };

  // A box placed with the keyboard takes focus, so its keys work at once.
  useEffect(() => {
    if (pending && pending.page === page) pendingRef.current?.focus({ preventScroll: false });
  }, [pending, page]);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!drawMode || disabled || event.button !== 0) return;
    event.preventDefault();
    const [x, y] = local(event);
    setDrag({ x0: x, y0: y, x1: x, y1: y });
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    const [x, y] = local(event);
    setDrag({ ...drag, x1: x, y1: y });
  };
  const onPointerUp = () => {
    if (!drag) return;
    const box = { left: Math.min(drag.x0, drag.x1), top: Math.min(drag.y0, drag.y1), width: Math.abs(drag.x1 - drag.x0), height: Math.abs(drag.y1 - drag.y0) };
    setDrag(null);
    const rect = surface.rectToPdf(box);
    // Under 2 x 2 pt: a click, not a box (the reducer ignores it too).
    if (rect.x1 - rect.x0 < MIN_DRAWN_PT || rect.y1 - rect.y0 < MIN_DRAWN_PT) return;
    dispatch({ type: 'draw', box: { id: newBoxId(), page, rect, angle: surface.geometry.rotate } });
  };

  const onPendingKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!pending) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      dispatch({ type: 'draw', box: { id: newBoxId(), page: pending.page, rect: pending.rect, angle: surface.geometry.rotate } });
      setPending(null);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setPending(null);
      return;
    }
    const moved = nudge(pending.rect, event.key, event.shiftKey, event.altKey, surface.geometry.rotate);
    if (!moved) return;
    event.preventDefault();
    event.stopPropagation();
    setPending({ ...pending, rect: moved, placed: true });
  };

  const places = state.proposals.filter((p) => p.page === page);
  const drawn = state.drawn.filter((d) => d.page === page);
  const css = (r: Rect) => surface.rectToCss(r);

  return (
    <div
      ref={layer}
      data-viewer-no-pan={drawMode ? '' : undefined}
      data-testid="pdf-tools-redact-surface"
      className={cn('absolute inset-0', drawMode && !disabled && 'cursor-crosshair')}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => setDrag(null)}
    >
      {places.map((p) => {
        const ticked = state.ticked[p.id] === true;
        const selected = state.selected === p.id;
        return p.rects.map((r, i) => {
          const c = css(r);
          return (
            <button
              type="button"
              key={`${p.id}-${i}`}
              tabIndex={-1}
              aria-hidden="true"
              data-viewer-no-pan=""
              disabled={disabled}
              onPointerDown={(event) => {
                if (drawMode) return;
                event.stopPropagation();
              }}
              onClick={() => onChoose(p.id)}
              className={cn(
                'absolute rounded-[1px] border p-0',
                p.hidden
                  ? 'border-dotted border-slate-500'
                  : ticked
                    ? 'border-blue-700 bg-black/50'
                    : p.confidence === 'possible'
                      ? 'border-dashed border-amber-500 bg-amber-300/10'
                      : 'border-slate-400 bg-transparent',
                ticked && p.confidence === 'possible' && 'border-dashed border-amber-600',
                selected && 'z-10 border-[3px] border-primary ring-2 ring-primary/40',
                drawMode && 'pointer-events-none',
              )}
              style={{ left: c.left, top: c.top, width: Math.max(2, c.width), height: Math.max(2, c.height) }}
            />
          );
        });
      })}
      {drawn.map((d) => {
        const c = css(d.rect);
        const selected = state.selected === d.id;
        return (
          <button
            type="button"
            key={d.id}
            tabIndex={-1}
            aria-hidden="true"
            data-viewer-no-pan=""
            disabled={disabled}
            onPointerDown={(event) => {
              if (drawMode) return;
              event.stopPropagation();
            }}
            onClick={() => onChoose(d.id)}
            className={cn('absolute border-2 border-red-600 bg-black/70 p-0', selected && 'z-10 border-[3px] border-primary ring-2 ring-primary/40', drawMode && 'pointer-events-none')}
            style={{ left: c.left, top: c.top, width: Math.max(2, c.width), height: Math.max(2, c.height) }}
          />
        );
      })}
      {drag && (
        <div
          className="pointer-events-none absolute border-2 border-dashed border-red-600 bg-black/40"
          style={{ left: Math.min(drag.x0, drag.x1), top: Math.min(drag.y0, drag.y1), width: Math.abs(drag.x1 - drag.x0), height: Math.abs(drag.y1 - drag.y0) }}
        />
      )}
      {pending && pending.page === page && (
        <div
          ref={pendingRef}
          tabIndex={0}
          role="application"
          aria-label="New box. Arrow keys move it, Shift with an arrow moves it 10 points, Alt with an arrow changes its size. Enter adds it, Escape drops it."
          data-testid="pdf-tools-redact-pending-box"
          data-viewer-no-pan=""
          onKeyDown={onPendingKey}
          className="absolute border-2 border-dashed border-red-600 bg-black/40 outline-none ring-2 ring-primary ring-offset-1"
          style={(() => {
            const c = css(pending.rect);
            return { left: c.left, top: c.top, width: c.width, height: c.height };
          })()}
        />
      )}
    </div>
  );
}

export default function RedactPageSurface(props: RedactPageSurfaceProps) {
  const { model } = props;
  return (
    <PageSurface model={model} label={`Page ${model.page} of ${model.pageCount}`} overlay={(surface) => <Overlay surface={surface} props={props} />} />
  );
}
