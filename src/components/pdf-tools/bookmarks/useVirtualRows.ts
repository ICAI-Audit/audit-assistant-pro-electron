// Rows of a fixed height in a scrolling box, of which only those in view (and a margin) are rendered,
// so a list of thousands of bookmarks or pages costs what a screenful costs. The arithmetic is
// bookmarkView.ts rowWindow / scrollToShow.
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { rowWindow, scrollToShow } from './bookmarkView';

export interface VirtualRows {
  /** The rows to render, `end` exclusive. */
  start: number;
  end: number;
  /** The height of all rows together (the inner box's height). */
  total: number;
  onScroll: () => void;
  /** Scrolls row `index` fully into view, if it is not already. */
  show: (index: number, align?: 'nearest' | 'start') => void;
}

export function useVirtualRows(box: RefObject<HTMLElement>, count: number, rowHeight: number, overscan = 8): VirtualRows {
  const [view, setView] = useState({ top: 0, height: 0 });
  const frame = useRef<number | null>(null);

  const measure = useCallback(() => {
    const element = box.current;
    if (!element) return;
    setView((was) => (was.top === element.scrollTop && was.height === element.clientHeight ? was : { top: element.scrollTop, height: element.clientHeight }));
  }, [box]);

  // The box may appear only once there are rows (a list that is read first): watch it from then.
  const hasRows = count > 0;
  useEffect(() => {
    const element = box.current;
    if (!element) return;
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => measure());
    observer.observe(element);
    return () => observer.disconnect();
  }, [box, measure, hasRows]);

  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );

  // One measure per frame however fast the wheel turns.
  const onScroll = useCallback(() => {
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      measure();
    });
  }, [measure]);

  const show = useCallback(
    (index: number, align: 'nearest' | 'start' = 'nearest') => {
      const element = box.current;
      if (!element || index < 0) return;
      const top = align === 'start' ? index * rowHeight : scrollToShow(index, rowHeight, element.scrollTop, element.clientHeight);
      if (top === null) return;
      element.scrollTop = top;
      measure();
    },
    [box, rowHeight, measure],
  );

  const { start, end } = rowWindow(view.top, view.height, rowHeight, count, overscan);
  return { start, end, total: count * rowHeight, onScroll, show };
}
