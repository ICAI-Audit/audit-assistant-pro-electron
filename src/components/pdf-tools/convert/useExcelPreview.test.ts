// The PDF to Excel dialog's preview session (useExcelPreview.ts): it opens the file once, finds the first
// page with text, shows a page on request, says when no page has text, and shows nothing once the list
// has moved on. Words from FND's fixtures; layout by FND's pageLayout.
import { describe, expect, it, vi } from 'vitest';
import type { PageWords, Segment } from '@/lib/pdf-tools/layout';
import { convertFixture } from '@/lib/pdf-tools/testConvertPdf';
import type { WordsReader } from './pageWordsReader';
import { createPreviewSession, PREVIEW_UNREADABLE, type PreviewState } from './useExcelPreview';

vi.setConfig({ testTimeout: 60_000 });

const blank = (i: number): PageWords => ({ pageIndex: i, width: 595, height: 842, words: [] });

function readerOf(pages: PageWords[], segments: Segment[][] = []) {
  const reads: number[] = [];
  const close = vi.fn();
  const open = vi.fn(
    async (): Promise<WordsReader> => ({
      pageCount: pages.length,
      async page(i) {
        reads.push(i);
        return { words: pages[i], segments: segments[i] ?? [] };
      },
      close,
    }),
  );
  return { open, close, reads };
}

/** Runs a session until `done` says its latest state is final. */
async function settle(states: PreviewState[], done: (s: PreviewState) => boolean) {
  for (let i = 0; i < 500 && !(states.length > 0 && done(states[states.length - 1])); i++) await new Promise((r) => setTimeout(r, 0));
  return states[states.length - 1];
}

describe('the preview session', () => {
  it('shows the first page that has text, skipping empty ones, with its table', async () => {
    const f = await convertFixture('trial-balance');
    const { open, close, reads } = readerOf([blank(0), f.pages[0]], [[], f.segments[0]]);
    const states: PreviewState[] = [];
    const session = createPreviewSession(new Uint8Array([1]), open, (s) => states.push(s), { isCurrent: () => true });
    const last = await settle(states, (s) => s.status === 'ready');
    expect(last).toMatchObject({ status: 'ready', pageIndex: 1, pageCount: 2, loading: false });
    if (last.status !== 'ready') throw new Error('not ready');
    expect(last.grid.kind).toBe('aligned');
    expect(last.grid.cells.flat().some((c) => c.number && c.text === '(1,25,000.00)')).toBe(true);
    expect(reads).toEqual([0, 1]);
    session.close();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('pages on request (previous, next), reading each page once', async () => {
    const f = await convertFixture('statement-ruled');
    const { open, reads } = readerOf(f.pages, f.segments);
    const states: PreviewState[] = [];
    const session = createPreviewSession(new Uint8Array([1]), open, (s) => states.push(s), { isCurrent: () => true });
    await settle(states, (s) => s.status === 'ready');
    session.show(2);
    const third = await settle(states, (s) => s.status === 'ready' && s.pageIndex === 2 && !s.loading);
    expect(third).toMatchObject({ pageIndex: 2, grid: { kind: 'ruled' } });
    session.show(0);
    await settle(states, (s) => s.status === 'ready' && s.pageIndex === 0 && !s.loading);
    expect(reads).toEqual([0, 2]); // page 1 was kept from the first look
    session.show(-1);
    session.show(3);
    expect(states[states.length - 1]).toMatchObject({ pageIndex: 0 });
    session.close();
  });

  it('says so when no page has text: the file looks scanned', async () => {
    const { open, close } = readerOf([blank(0), blank(1), blank(2)]);
    const states: PreviewState[] = [];
    createPreviewSession(new Uint8Array([1]), open, (s) => states.push(s), { isCurrent: () => true });
    expect(await settle(states, (s) => s.status === 'scanned')).toEqual({ status: 'scanned', pageCount: 3 });
    expect(states.some((s) => s.status === 'reading' && s.checked === 2)).toBe(true);
    expect(close).toHaveBeenCalled();
  });

  it('a file whose text cannot be read: a plain note, Run not blocked', async () => {
    const open = vi.fn(async () => {
      throw new Error('raw library words');
    });
    const states: PreviewState[] = [];
    createPreviewSession(new Uint8Array([1]), open, (s) => states.push(s), { isCurrent: () => true });
    expect(await settle(states, (s) => s.status === 'error')).toEqual({ status: 'error', message: PREVIEW_UNREADABLE });
  });

  it('shows nothing more once the list has moved on, or once closed, and lets the reader go', async () => {
    const f = await convertFixture('trial-balance');
    const { open, close } = readerOf([f.pages[0]], [f.segments[0]]);
    const states: PreviewState[] = [];
    let current = true;
    const session = createPreviewSession(new Uint8Array([1]), open, (s) => states.push(s), { isCurrent: () => current });
    current = false;
    await new Promise((r) => setTimeout(r, 50));
    expect(states.filter((s) => s.status === 'ready')).toEqual([]);
    session.close();
    expect(close).toHaveBeenCalled();
  });
});
