// Redact: boxes the user draws (design 5.9 "Boxes"): a random id, and moving or resizing a box being
// placed with the keyboard. Plain functions, tested in Node.
import type { Rect } from '@/lib/pdf-tools/pageText';
import { MIN_DRAWN_PT } from './reviewState';

/** A random id for a drawn box: never derived from anything on the page. */
export function newBoxId(): string {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `d-${random}`;
}

const NUDGE_PT = 1;
const NUDGE_FAST_PT = 10;

/** Moves or resizes a pending box by a key; null when the key is not one of them. */
export function nudge(rect: Rect, key: string, shift: boolean, alt: boolean, turn: number): Rect | null {
  const step = shift ? NUDGE_FAST_PT : NUDGE_PT;
  // Screen directions in PDF points for the page's own turn (the box sits on the page as displayed).
  const right: [number, number] = turn === 90 ? [0, 1] : turn === 180 ? [-1, 0] : turn === 270 ? [0, -1] : [1, 0];
  const down: [number, number] = turn === 90 ? [1, 0] : turn === 180 ? [0, 1] : turn === 270 ? [-1, 0] : [0, -1];
  const dir: Record<string, [number, number]> = { ArrowRight: right, ArrowLeft: [-right[0], -right[1]], ArrowDown: down, ArrowUp: [-down[0], -down[1]] };
  const d = dir[key];
  if (!d) return null;
  const [dx, dy] = [d[0] * step, d[1] * step];
  if (!alt) return { x0: rect.x0 + dx, y0: rect.y0 + dy, x1: rect.x1 + dx, y1: rect.y1 + dy };
  // Alt: the box's far edge as displayed (its right edge for Left and Right, its bottom edge for Up and
  // Down) moves out (Right, Down) or in (Left, Up), never below MIN_DRAWN_PT.
  const horizontal = key === 'ArrowRight' || key === 'ArrowLeft';
  const axis = horizontal ? right : down;
  const edge: keyof Rect = axis[0] === 1 ? 'x1' : axis[0] === -1 ? 'x0' : axis[1] === 1 ? 'y1' : 'y0';
  const outward = edge === 'x1' || edge === 'y1' ? 1 : -1;
  const grow = key === 'ArrowRight' || key === 'ArrowDown';
  const next = { ...rect, [edge]: rect[edge] + (grow ? step : -step) * outward };
  if (next.x1 - next.x0 < MIN_DRAWN_PT || next.y1 - next.y0 < MIN_DRAWN_PT) return rect;
  return next;
}
