// The step reads the saved bookmarks back and refuses a file whose bookmarks are not the ones asked for
// (W2-B review, mutation M1). The library is wrapped so that it saves something else on purpose.
import { describe, expect, it, vi } from 'vitest';
import type { OutlineItem } from '@/lib/pdf-tools/outline';
import { baseDoc, buildOutline, fit } from '@/lib/pdf-tools/testOutlinePdf';
import { createWorkingListStore } from '@/lib/pdf-tools/workingList';
import type { WorkingFile } from '@/lib/pdf-tools/types';
import { runTool, type RunContext } from '../runTool';

const mode = { corrupt: 'none' as 'none' | 'title' | 'page' | 'drop' | 'depth' };
vi.mock('@/lib/pdf-tools/bookmarks', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/pdf-tools/bookmarks')>();
  return {
    ...real,
    applyBookmarks: async (file: Uint8Array, items: readonly OutlineItem[]) => {
      const changed = structuredClone(items) as OutlineItem[];
      if (mode.corrupt === 'title') changed[0].title = 'Something else';
      if (mode.corrupt === 'page') changed[0].page = 1;
      if (mode.corrupt === 'drop') changed.pop();
      if (mode.corrupt === 'depth') changed[0].children.push(changed.pop()!);
      return real.applyBookmarks(file, changed);
    },
  };
});
vi.setConfig({ testTimeout: 120_000 });

describe('the read-back check of the Bookmarks step', () => {
  for (const corrupt of ['none', 'title', 'page', 'drop', 'depth'] as const) {
    it(corrupt === 'none' ? 'a save of what was asked is added' : `a save with a different ${corrupt} is refused as unverified; nothing is added`, async () => {
      mode.corrupt = corrupt;
      const { doc } = await baseDoc(3);
      buildOutline(doc, [
        { title: 'One', dest: fit(doc, 0) },
        { title: 'Two', dest: fit(doc, 2) },
      ]);
      const bytes = await doc.save();
      const store = createWorkingListStore();
      store.setContext('u1:A');
      const file: WorkingFile = {
        id: 'x',
        name: 'x.pdf',
        kind: 'pdf',
        mimeType: 'application/pdf',
        origin: 'computer',
        bytes,
        size: bytes.byteLength,
        pageCount: 3,
        wasProtected: false,
        hasRestrictions: false,
        hasSignature: false,
        hasBookmarks: true,
        sentTo: [],
      };
      store.addFiles('u1:A', [file], store.getState().session);
      const ctx: RunContext = { contextKey: 'u1:A', session: store.getState().session, store, signal: new AbortController().signal, onProgress: () => undefined };
      const items: OutlineItem[] = [
        { title: 'One renamed', page: 0, open: false, children: [] },
        { title: 'Two', page: 2, open: false, children: [] },
      ];
      const running = runTool('bookmarks', [file], { items }, ctx, { paint: async () => undefined, yieldToUi: async () => undefined });
      if (corrupt === 'none') {
        expect((await running).status).toBe('added');
      } else {
        await expect(running).rejects.toMatchObject({ code: 'unverified' });
        expect(store.getState().files).toHaveLength(1);
      }
    });
  }
});
