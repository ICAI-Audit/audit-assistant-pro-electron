// The crop frame over the preview of a page: what stays is inside the frame, the trimmed edges are shaded.
// Each edge is a slider: drag it with the mouse, or focus it and use the arrow keys (1 mm, with Shift
// 10 mm; Home: not trimmed; End: as far as it goes). The arrows move the edge the way they point. Dragging
// inside the frame moves the whole frame. Every change goes to the dialog's four mm fields, which stay in
// step, and is announced ("Left edge: 12 mm trimmed"; a drag once, when it ends). Escape during a drag puts
// the frame back and keeps the dialog open. The arithmetic is in pageBoxForm.ts.
import { useEffect, useRef, type KeyboardEvent, type PointerEvent } from 'react';
import type { DisplayedPage } from '@/lib/pdf-tools/marks';
import { PT_PER_MM } from '@/lib/pdf-tools/pageBox';
import { cn } from '@/lib/utils';
import { edgeAnnouncement, frameOf, moveEdge, moveFrame, shownEdges, type EdgeName, type EdgesMm } from './pageBoxForm';

export interface CropFrameProps {
  /** Test id prefix: the edges add -left, -top, -right, -bottom; the frame -body. */
  id: string;
  edges: EdgesMm;
  mirror: boolean;
  /** The page shown (from 1): on even pages, mirrored, left and right swap. */
  page: number;
  shape: Pick<DisplayedPage, 'width' | 'height'>;
  onChange: (edges: EdgesMm, announcement: string) => void;
  disabled?: boolean;
}

const LABEL: Record<EdgeName, string> = { left: 'Left edge', top: 'Top edge', right: 'Right edge', bottom: 'Bottom edge' };
const HORIZONTAL: Record<EdgeName, boolean> = { left: true, right: true, top: false, bottom: false };

/** How many mm inward an arrow key moves an edge (outward is negative), or null for another key. */
function keyStep(edge: EdgeName, key: string, big: boolean): number | null {
  const step = big ? 10 : 1;
  const towards: Record<EdgeName, Record<string, number>> = {
    left: { ArrowRight: step, ArrowLeft: -step },
    right: { ArrowLeft: step, ArrowRight: -step },
    top: { ArrowDown: step, ArrowUp: -step },
    bottom: { ArrowUp: step, ArrowDown: -step },
  };
  return towards[edge][key] ?? null;
}

export default function CropFrame({ id, edges, mirror, page, shape, onChange, disabled = false }: CropFrameProps) {
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ edge: EdgeName | 'body'; x: number; y: number; start: EdgesMm; pointer: number } | null>(null);
  const frame = frameOf(edges, shape, mirror, page);
  const shown = shownEdges(edges, mirror, page);
  const widthMm = shape.width / PT_PER_MM;
  const heightMm = shape.height / PT_PER_MM;
  const maxOf = (edge: EdgeName) => Math.max(0, Math.round(((HORIZONTAL[edge] ? widthMm - shown[edge === 'left' ? 'right' : 'left'] : heightMm - shown[edge === 'top' ? 'bottom' : 'top']) - 10) * 10) / 10);

  // `quiet` while a drag goes on: the edges follow the pointer, and what they came to is said once, at the end
  // (a live region read on every pointer move says nothing useful; REV-B minor 7).
  const say = (next: EdgesMm, edge: EdgeName | null, quiet = false) => {
    const after = shownEdges(next, mirror, page);
    const text = quiet ? '' : edge ? edgeAnnouncement(edge, after[edge]) : `Frame moved. ${(['left', 'top', 'right', 'bottom'] as EdgeName[]).map((e) => edgeAnnouncement(e, after[e])).join(', ')}`;
    onChange(next, text);
  };

  // Escape during a drag ends the drag and puts the frame back, instead of closing the dialog: taken on the
  // window in the capture phase, before the dialog sees it, and only while the drag lasts (REV-B minor 7).
  const stopEscape = useRef<(() => void) | null>(null);
  const endDrag = () => {
    drag.current = null;
    stopEscape.current?.();
    stopEscape.current = null;
  };
  useEffect(() => () => stopEscape.current?.(), []);
  const takeEscape = () => {
    stopEscape.current?.();
    const onEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      const d = drag.current;
      endDrag();
      if (d) onChange(d.start, 'The frame is back where it was.');
    };
    window.addEventListener('keydown', onEscape, true);
    stopEscape.current = () => window.removeEventListener('keydown', onEscape, true);
  };

  const onKey = (edge: EdgeName) => (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled || event.altKey || event.ctrlKey || event.metaKey) return;
    let next: EdgesMm | null = null;
    const step = keyStep(edge, event.key, event.shiftKey);
    if (step !== null) next = moveEdge(edges, edge, step, shape, mirror, page);
    else if (event.key === 'Home') next = moveEdge(edges, edge, -shown[edge], shape, mirror, page);
    else if (event.key === 'End') next = moveEdge(edges, edge, 10_000, shape, mirror, page);
    if (!next) return;
    event.preventDefault();
    event.stopPropagation();
    say(next, edge);
  };

  const begin = (edge: EdgeName | 'body') => (event: PointerEvent<HTMLDivElement>) => {
    if (disabled || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    drag.current = { edge, x: event.clientX, y: event.clientY, start: edges, pointer: event.pointerId };
    takeEscape();
    if (edge !== 'body') (event.currentTarget as HTMLElement).focus();
  };
  const move = (event: PointerEvent<HTMLDivElement>, quiet = true) => {
    const d = drag.current;
    const area = box.current?.getBoundingClientRect();
    if (!d || d.pointer !== event.pointerId || !area || area.width <= 0 || area.height <= 0) return;
    const du = ((event.clientX - d.x) / area.width) * widthMm;
    const dv = ((event.clientY - d.y) / area.height) * heightMm;
    if (d.edge === 'body') {
      say(moveFrame(d.start, du, dv, mirror, page), null, quiet);
      return;
    }
    const inward = d.edge === 'left' ? du : d.edge === 'right' ? -du : d.edge === 'top' ? dv : -dv;
    say(moveEdge(d.start, d.edge, inward, shape, mirror, page), d.edge, quiet);
  };
  // Released: the release point counts too (a quick flick may end before its last move is drawn), and what the
  // edges came to is said.
  const finish = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointer !== event.pointerId) return;
    move(event, false);
    endDrag();
  };
  const cancel = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointer === event.pointerId) endDrag();
  };

  const handle = (edge: EdgeName) => {
    const horizontal = HORIZONTAL[edge];
    const value = Math.round(shown[edge] * 10) / 10;
    const place =
      edge === 'left' ? { left: `${frame.left}%`, top: `${frame.top}%`, bottom: `${frame.bottom}%` }
      : edge === 'right' ? { right: `${frame.right}%`, top: `${frame.top}%`, bottom: `${frame.bottom}%` }
      : edge === 'top' ? { top: `${frame.top}%`, left: `${frame.left}%`, right: `${frame.right}%` }
      : { bottom: `${frame.bottom}%`, left: `${frame.left}%`, right: `${frame.right}%` };
    return (
      <div
        key={edge}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={LABEL[edge]}
        aria-orientation={horizontal ? 'horizontal' : 'vertical'}
        aria-valuemin={0}
        aria-valuemax={maxOf(edge)}
        aria-valuenow={value}
        aria-valuetext={value > 0 ? `${value} mm trimmed` : 'not trimmed'}
        aria-disabled={disabled || undefined}
        data-testid={`${id}-${edge}`}
        onKeyDown={onKey(edge)}
        onPointerDown={begin(edge)}
        onPointerMove={move}
        onPointerUp={finish}
        onPointerCancel={cancel}
        style={place}
        className={cn(
          'group absolute z-10 flex items-center justify-center outline-none',
          horizontal ? '-ml-[7px] w-[14px] cursor-ew-resize' : '-mt-[7px] h-[14px] cursor-ns-resize',
          edge === 'right' && '-mr-[7px] ml-0',
          edge === 'bottom' && '-mb-[7px] mt-0',
          disabled && 'cursor-default',
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            'rounded-full border border-primary-foreground bg-primary shadow transition-transform group-focus-visible:scale-125 group-focus-visible:ring-2 group-focus-visible:ring-ring group-focus-visible:ring-offset-1',
            horizontal ? 'h-7 w-[6px]' : 'h-[6px] w-7',
          )}
        />
      </div>
    );
  };

  return (
    <div ref={box} className="absolute inset-0 overflow-hidden" data-testid={id}>
      {/* The frame: what stays. The shade around it is the frame's own shadow, cut off at the page's edge. */}
      <div
        data-testid={`${id}-body`}
        aria-hidden="true"
        onPointerDown={begin('body')}
        onPointerMove={move}
        onPointerUp={finish}
        onPointerCancel={cancel}
        className={cn('absolute border-2 border-primary', disabled ? 'cursor-default' : 'cursor-move')}
        style={{ left: `${frame.left}%`, top: `${frame.top}%`, right: `${frame.right}%`, bottom: `${frame.bottom}%`, boxShadow: '0 0 0 9999px rgba(15, 23, 42, 0.45)' }}
      />
      {(['top', 'bottom', 'left', 'right'] as EdgeName[]).map(handle)}
    </div>
  );
}
