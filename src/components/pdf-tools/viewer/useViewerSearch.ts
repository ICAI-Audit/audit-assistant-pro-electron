// The page viewer's search box, as React state: opening and closing it, the query (searched 250 ms after
// the last key, or at once on Enter), next and previous, going to the current match's page, and the
// matches on the page shown, ready to draw. The searching itself is viewerSearch.ts.
//
// Confidentiality: the query typed lives only in the search box's field and, folded, in the search
// engine; it is never put into a message, a name or a log. Closing the box (Escape, its close button,
// the viewer closing) cancels the reading, lets every page text go, empties the character measure and
// clears what the JavaScript engine keeps of the last regular-expression match. The box's field is
// wiped by the box itself (SearchBar).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PdfRect } from './pageGeometry';
import { createCanvasMeasure, type CanvasMeasure } from './canvasMeasure';
import { hitQuads, quadsBounds, type Quad } from './searchGeometry';
import type { PageViewerModel } from './usePageViewer';
import { createViewerSearch, type SearchState, type ViewerSearch } from './viewerSearch';

/** How long after the last key a query is searched. */
export const SEARCH_TYPING_DELAY_MS = 250;
/** How often the box shows progress while pages are read. */
const PUBLISH_MS = 120;

export interface SearchHighlight {
  quads: Quad[];
  current: boolean;
}

export interface ViewerSearchModel {
  /** The file is a PDF: there is text to search. */
  available: boolean;
  open: boolean;
  /** Changes each time the box should take the focus (opened, or Ctrl + F again). */
  focusRequest: number;
  openSearch(): void;
  closeSearch(): void;
  state: SearchState | null;
  /** Something other than spaces is typed. */
  typed: boolean;
  setQuery(text: string): void;
  /** Enter (back: Shift + Enter): searches what is typed at once, or moves to the next (previous) match. */
  submit(back: boolean): void;
  next(): void;
  prev(): void;
  /** The matches on the page shown, ready to draw over it. */
  highlights: SearchHighlight[];
  /** The current match on the page shown, when it is still to be scrolled into view. */
  reveal: { box: PdfRect; request: number } | null;
  revealed(request: number): void;
}

export function useViewerSearch(model: PageViewerModel): ViewerSearchModel {
  const available = Boolean(model.file && model.file.kind === 'pdf');
  const [open, setOpen] = useState(false);
  const [focusRequest, setFocusRequest] = useState(0);
  const [state, setState] = useState<SearchState | null>(null);
  const [typed, setTyped] = useState(false);
  // Counts every new query and every next or previous asked for: the current match is shown again.
  const [moves, setMoves] = useState(0);
  const [revealRequest, setRevealRequest] = useState(0);
  const [revealDone, setRevealDone] = useState(0);

  const engine = useRef<ViewerSearch | null>(null);
  const measure = useRef<CanvasMeasure | null>(null);
  const publishTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingQuery = useRef<string | null>(null);
  const modelRef = useRef(model);
  modelRef.current = model;

  const publish = useCallback(() => {
    if (publishTimer.current !== null) {
      clearTimeout(publishTimer.current);
      publishTimer.current = null;
    }
    setState(engine.current ? engine.current.state() : null);
  }, []);

  /** Ends the search: the reading, the page texts, the query, the measure. */
  const stop = useCallback(() => {
    if (publishTimer.current !== null) clearTimeout(publishTimer.current);
    if (queryTimer.current !== null) clearTimeout(queryTimer.current);
    publishTimer.current = null;
    queryTimer.current = null;
    pendingQuery.current = null;
    engine.current?.close();
    engine.current = null;
    measure.current?.clear();
    measure.current = null;
    // The engine-wide statics of the last regular-expression match (viewerSearch clears them too).
    /(?:)/.exec('');
  }, []);

  // The viewer closing (or this file's viewer unmounting) ends the search.
  useEffect(() => stop, [stop]);

  const openSearch = useCallback(() => {
    if (!available) return;
    if (!engine.current) {
      const m = modelRef.current;
      engine.current = createViewerSearch({
        pageCount: m.pageCount,
        read: (pageIndex, signal) => modelRef.current.readText(pageIndex, signal),
        inScope: () => modelRef.current.inScope(),
        onChange: () => {
          // At most a few times a second while pages are read.
          if (publishTimer.current !== null) return;
          publishTimer.current = setTimeout(() => {
            publishTimer.current = null;
            setState(engine.current ? engine.current.state() : null);
          }, PUBLISH_MS);
        },
      });
      measure.current = createCanvasMeasure();
      setState(engine.current.state());
    }
    setOpen(true);
    setFocusRequest((n) => n + 1);
  }, [available]);

  const closeSearch = useCallback(() => {
    stop();
    setOpen(false);
    setState(null);
    setTyped(false);
  }, [stop]);

  const apply = useCallback(
    (text: string) => {
      if (!engine.current) return;
      engine.current.setQuery(text, modelRef.current.page - 1);
      setMoves((n) => n + 1);
      publish();
    },
    [publish],
  );

  const setQuery = useCallback(
    (text: string) => {
      setTyped(text.trim().length > 0);
      pendingQuery.current = text;
      if (queryTimer.current !== null) clearTimeout(queryTimer.current);
      queryTimer.current = setTimeout(() => {
        queryTimer.current = null;
        const q = pendingQuery.current;
        pendingQuery.current = null;
        if (q !== null) apply(q);
      }, SEARCH_TYPING_DELAY_MS);
    },
    [apply],
  );

  const move = useCallback(
    (back: boolean) => {
      if (!engine.current) return;
      if (back) engine.current.prev(modelRef.current.page - 1);
      else engine.current.next(modelRef.current.page - 1);
      setMoves((n) => n + 1);
      publish();
    },
    [publish],
  );

  const submit = useCallback(
    (back: boolean) => {
      if (pendingQuery.current !== null) {
        if (queryTimer.current !== null) clearTimeout(queryTimer.current);
        queryTimer.current = null;
        const q = pendingQuery.current;
        pendingQuery.current = null;
        apply(q);
        return;
      }
      move(back);
    },
    [apply, move],
  );

  // Ended from inside (the engagement or user changed): the box closes with nothing shown.
  const endedInside = state?.status === 'closed';
  useEffect(() => {
    if (endedInside && open) closeSearch();
  }, [endedInside, open, closeSearch]);

  // A new current match (or the same one asked for again): go to its page and show it.
  const current = state?.current ?? null;
  const currentRef = useRef(current);
  currentRef.current = current;
  const currentKey = current ? `${moves}:${current.pageIndex}:${current.index}` : null;
  useEffect(() => {
    const now = currentRef.current;
    if (!currentKey || !now) return;
    if (now.pageIndex + 1 !== modelRef.current.page) modelRef.current.goTo(now.pageIndex + 1);
    setRevealRequest((n) => n + 1);
  }, [currentKey]);

  const shownIndex = model.page - 1;
  const highlights = useMemo<SearchHighlight[]>(() => {
    const e = engine.current;
    if (!open || !e || !state || state.found === 0) return [];
    const hits = e.hitsOn(shownIndex);
    if (!hits) return [];
    const out: SearchHighlight[] = [];
    for (let k = 0; k < hits.ranges.length; k += 2) {
      const quads = hitQuads(hits.page, hits.ranges[k], hits.ranges[k + 1], measure.current?.measure);
      if (quads.length === 0) continue;
      out.push({ quads, current: Boolean(state.current && state.current.pageIndex === shownIndex && state.current.index === k / 2) });
    }
    return out;
  }, [open, state, shownIndex]);

  const currentBox = useMemo(() => {
    const hit = highlights.find((h) => h.current);
    return hit ? quadsBounds(hit.quads) : null;
  }, [highlights]);
  const reveal = revealRequest > revealDone && currentBox ? { box: currentBox, request: revealRequest } : null;
  const revealed = useCallback((request: number) => setRevealDone((done) => Math.max(done, request)), []);

  return {
    available,
    open,
    focusRequest,
    openSearch,
    closeSearch,
    state,
    typed,
    setQuery,
    submit,
    next: () => move(false),
    prev: () => move(true),
    highlights,
    reveal,
    revealed,
  };
}
