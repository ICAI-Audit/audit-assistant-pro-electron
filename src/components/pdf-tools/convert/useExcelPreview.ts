// The PDF to Excel dialog's preview (contract decisions 10 and 14; T-064): the file is opened once when the
// dialog opens; the first page with text is found (pages under 20 characters count as having none, design
// 13) and shown as its sheet will hold it (excelForm.ts previewGrid, the run's own plan); Previous and
// Next read further pages, one at a time, each read once while the dialog is open. When no page has text
// the dialog blocks Run: the file looks scanned.
//
// Confidentiality: `isCurrent` (the dialog's scope, captured when it opened) is checked after every await,
// before anything is shown; the reader and the pages read go when the dialog closes. Nothing is logged.
import { useCallback, useEffect, useRef, useState } from 'react';
import { countsAsScanned, pageLayout, type PageLayout } from '@/lib/pdf-tools/layout';
import { pacer } from '@/lib/pdf-tools/pace';
import { previewGrid, type PreviewGrid } from './excelForm';
import type { OpenWords } from './excelRun';
import { openWordsReader, type WordsReader } from './pageWordsReader';

export type PreviewState =
  /** Opening the file, or looking for the first page with text (`checked` pages so far). */
  | { status: 'reading'; checked: number; pageCount: number }
  /** `loading` while another page is being read (the shown one stays until it is ready). */
  | { status: 'ready'; pageIndex: number; pageCount: number; grid: PreviewGrid; loading: boolean }
  /** No page has text. */
  | { status: 'scanned'; pageCount: number }
  | { status: 'error'; message: string };

export const PREVIEW_UNREADABLE = 'The preview could not be read from this file. You can still make the workbook.';

/** Pages kept while the dialog is open (a page's layout is small; this bounds a long walk through a file). */
const KEEP_PAGES = 40;

export interface PreviewSession {
  /** Shows page `pageIndex` (counted from 0); ignored outside the file or before the first page is shown. */
  show(pageIndex: number): void;
  close(): void;
}

/** The preview's work, apart from React (the test seam). */
export function createPreviewSession(
  file: Uint8Array,
  open: OpenWords,
  onState: (state: PreviewState) => void,
  options: { isCurrent: () => boolean },
): PreviewSession {
  const controller = new AbortController();
  const { signal } = controller;
  const live = () => !signal.aborted && options.isCurrent();
  const kept = new Map<number, PageLayout>();
  let reader: WordsReader | null = null;
  let pageCount = 0;
  let shown: Extract<PreviewState, { status: 'ready' }> | null = null;
  // One page read at a time; a newer request replaces one still waiting.
  let queue: Promise<void> = Promise.resolve();
  let wanted = -1;

  const say = (state: PreviewState) => {
    if (live()) onState(state);
  };
  const letGo = () => {
    reader?.close();
    reader = null;
  };

  const layoutOf = async (i: number): Promise<{ layout: PageLayout; scanned: boolean }> => {
    const known = kept.get(i);
    if (known) return { layout: known, scanned: !known.hasText };
    const { words, segments, extras } = await reader!.page(i);
    const layout = pageLayout(words, segments, extras);
    const scanned = countsAsScanned(words);
    if (kept.size >= KEEP_PAGES) kept.delete(kept.keys().next().value as number);
    kept.set(i, layout);
    return { layout, scanned };
  };

  const display = (i: number, layout: PageLayout) => {
    shown = { status: 'ready', pageIndex: i, pageCount, grid: previewGrid(layout), loading: false };
    say(shown);
  };

  const failed = () => {
    if (!live()) return;
    letGo();
    onState({ status: 'error', message: PREVIEW_UNREADABLE });
  };

  queue = (async () => {
    try {
      reader = await open(file, { signal });
      if (!live()) return letGo();
      pageCount = reader.pageCount;
      const pace = pacer();
      for (let i = 0; i < pageCount; i++) {
        say({ status: 'reading', checked: i, pageCount });
        const { layout, scanned } = await layoutOf(i);
        if (!live()) return letGo();
        if (!scanned) return display(i, layout);
        const turn = pace();
        if (turn) await turn;
        if (!live()) return letGo();
      }
      say({ status: 'reading', checked: pageCount, pageCount });
      letGo();
      say({ status: 'scanned', pageCount });
    } catch {
      failed();
    }
  })();

  return {
    show(i) {
      if (!shown || !reader || !Number.isInteger(i) || i < 0 || i >= pageCount || i === shown.pageIndex) return;
      wanted = i;
      shown = { ...shown, loading: true };
      say(shown);
      queue = queue.then(async () => {
        if (wanted !== i || !reader || !live()) return;
        try {
          const { layout } = await layoutOf(i);
          if (wanted === i && live()) display(i, layout);
        } catch {
          failed();
        }
      });
    },
    close() {
      controller.abort();
      letGo();
      kept.clear();
    },
  };
}

/** The preview for the dialog: opens the file once (when `enabled`), lets it go when the dialog closes. */
export function useExcelPreview(file: Uint8Array, pageCount: number, isCurrent: () => boolean, enabled = true, open: OpenWords = openWordsReader) {
  const [state, setState] = useState<PreviewState>({ status: 'reading', checked: 0, pageCount });
  const session = useRef<PreviewSession | null>(null);
  const current = useRef(isCurrent);
  current.current = isCurrent;

  useEffect(() => {
    if (!enabled) return;
    const made = createPreviewSession(file, open, setState, { isCurrent: () => current.current() });
    session.current = made;
    return () => {
      made.close();
      if (session.current === made) session.current = null;
    };
  }, [file, enabled, open]);

  const show = useCallback((pageIndex: number) => session.current?.show(pageIndex), []);
  return { state, show };
}
