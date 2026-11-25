import { PDFName } from 'pdf-lib';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { BOOKMARKS_NOT_EDITABLE_MESSAGE, readBookmarks } from '@/lib/pdf-tools/bookmarks';
import type { OutlineItem } from '@/lib/pdf-tools/outline';
import { operationSummary, summaryWithNotes } from '@/lib/pdf-tools/resultNames';
import { rawHaystack } from '@/lib/pdf-tools/testLeakPdf';
import { baseDoc, buildOutline, dictAt, fit, makeOutlinePdf, pdfjsOutline, titleForms } from '@/lib/pdf-tools/testOutlinePdf';
import { makePdf, pageTexts } from '@/lib/pdf-tools/testPdf';
import { createWorkingListStore } from '@/lib/pdf-tools/workingList';
import type { WorkingFile } from '@/lib/pdf-tools/types';
import { bookmarkEditReducer, initialBookmarkState, toOutline, type BookmarkEditAction, type BookmarkEditState } from '../bookmarkEdit';
import { BUILT, step, verifySavedOutline, type BookmarksRunOptions } from '../bookmarksRun';
import { runTool, type RunContext, type RunDeps } from '../runTool';
import { editCounts } from './bookmarkView';
import { newBookmarkView, readBookmarkSource } from './bookmarkSource';

vi.setConfig({ testTimeout: 120_000 });
beforeAll(async () => {
  await import('pdfjs-dist/legacy/build/pdf.mjs');
}, 120_000); // a hang guard only: a cold import takes seconds alone and passed 30 s on a loaded machine

let seq = 0;
function pdf(name: string, bytes: Uint8Array, pageCount: number, extra: Partial<WorkingFile> = {}): WorkingFile {
  return {
    id: `in-${++seq}`,
    name,
    kind: 'pdf',
    mimeType: 'application/pdf',
    origin: 'computer',
    bytes,
    size: bytes.byteLength,
    pageCount,
    wasProtected: false,
    hasRestrictions: false,
    hasSignature: false,
    hasBookmarks: true,
    sentTo: [],
    ...extra,
  };
}

function setup() {
  const store = createWorkingListStore();
  store.setContext('u1:A');
  const controller = new AbortController();
  const labels: string[] = [];
  const ctx: RunContext = {
    contextKey: 'u1:A',
    session: store.getState().session,
    store,
    signal: controller.signal,
    onProgress: (_done, _total, label) => {
      if (label) labels.push(label);
    },
  };
  const deps: Partial<RunDeps> = {
    paint: async () => undefined,
    yieldToUi: async () => undefined,
  };
  return { store, controller, ctx, deps, labels };
}

const run = (state: BookmarkEditState, ...actions: BookmarkEditAction[]) => actions.reduce(bookmarkEditReducer, state);
const HINDI_ZWJ = 'अध्याय क्\u200Dष: परिचय';

/**
 * The trial outline file edited through the dialog's model: "1 Introduction" renamed (Hindi with a
 * zero-width joiner), "1.2 Named, by GoTo" deleted with its child, "5 Page index as a number" moved
 * up, a bookmark added for page 3, nested under "4 Page five" and renamed. "3 Script" is not carried.
 */
async function editedTrialFile() {
  const bytes = await makeOutlinePdf();
  const source = await readBookmarkSource(bytes);
  const start = initialBookmarkState(source.items);
  const added = run(
    start,
    { type: 'rename', id: 'b1', title: HINDI_ZWJ },
    { type: 'delete', id: 'b3' },
    { type: 'select', id: 'b8' },
    { type: 'move', id: 'b8', direction: 'up' },
    { type: 'select', id: 'b7' },
    { type: 'add', page: 2, view: newBookmarkView(source, 2) },
  );
  const id = added.selected!;
  const end = run(added, { type: 'indent', id }, { type: 'rename', id, title: 'Annexure A' });
  const { bookmarks: _total, ...edits } = editCounts(start.items, end.items);
  const options: BookmarksRunOptions = {
    items: toOutline(end),
    name: '',
    edits,
  };
  return { bytes, options, edits };
}

describe('the Bookmarks run module', () => {
  it('says it is built', () => {
    expect(BUILT).toBe(true);
  });

  it('saves add, rename (Hindi), reorder, nest and delete: pdf.js and the library read the new tree from the bytes', async () => {
    const { store, ctx, deps, labels } = setup();
    const { bytes, options, edits } = await editedTrialFile();
    const source = pdf('outline.pdf', bytes, 6);
    store.addFiles('u1:A', [source], ctx.session);
    const result = await runTool('bookmarks', [source], options, ctx, deps);

    expect(result).toMatchObject({
      status: 'added',
      added: 1,
      message: 'Bookmarks saved: outline_bookmarked.pdf',
      detail: 'It has 6 bookmarks.',
    });
    const [made] = store.getState().files.filter((f) => f.origin === 'result');
    expect(made.name).toBe('outline_bookmarked.pdf');
    expect(made.pageCount).toBe(6);
    expect(made.hasBookmarks).toBe(true);
    expect(labels).toEqual(expect.arrayContaining(['Saving the bookmarks…', 'Checking the saved bookmarks…']));

    const expected: [number, string, number | null][] = [
      [0, HINDI_ZWJ, 0],
      [1, '1.1 करदाता (Hindi)', 1],
      [0, '2 Web link', null],
      [0, '5 Page index as a number', 3],
      [0, '4 Page five', 4],
      [1, 'Annexure A', 2],
    ];
    expect(await pdfjsOutline(made.bytes)).toEqual(expected);
    const library = await readBookmarks(made.bytes);
    expect(library.editable).toBe(true);
    expect(library.notCarried).toBe(0);
    const flat: [number, string, number | null][] = [];
    const walk = (items: OutlineItem[], depth: number) => items.forEach((i) => (flat.push([depth, i.title, i.page]), walk(i.children, depth + 1)));
    walk(library.items, 0);
    expect(flat).toEqual(expected);
    expect(library.items[1].uri).toBe('https://example.in/');

    // what the user deleted, renamed away, and what was not carried is gone from the raw bytes
    const haystack = rawHaystack(made.bytes).toLowerCase();
    for (const gone of ['1 Introduction', '1.2 Named, by GoTo', '1.2.1 Deep, old Dests', '3 Script']) {
      for (const form of titleForms(gone)) expect(haystack.includes(form.toLowerCase()), gone).toBe(false);
    }
    expect(haystack.includes('app.alert')).toBe(false);
    const sourceHaystack = rawHaystack(bytes).toLowerCase();
    expect(sourceHaystack.includes('1.2 named, by goto')).toBe(true); // control: the source has them

    expect(await pageTexts(made.bytes)).toEqual(await pageTexts(bytes));
    expect(made.operation?.tool).toBe('bookmarks');
    expect(made.operation?.options).toEqual({ bookmarks: 6, ...edits });
    expect(edits).toEqual({
      added: 1,
      renamed: 1,
      moved: 1,
      removed: 2,
      notCarried: 1,
    });
    // "3 Script" was not the user's to keep: the record says some bookmarks were not carried
    expect(made.operation?.flags).toEqual({ bookmarksDropped: true });
    expect(made.operation?.summary).toBe(
      summaryWithNotes('Bookmarks edited: 6 bookmarks', {
        bookmarksDropped: true,
      }),
    );
    expect(Object.values(made.operation!.options).every((v) => typeof v === 'number')).toBe(true);
  });

  it('a file whose bookmarks were all carried: summary "Bookmarks edited: 2 bookmarks", no flag', async () => {
    const { store, ctx, deps } = setup();
    const { doc } = await baseDoc(3);
    buildOutline(doc, [{ title: 'One', dest: fit(doc, 0) }]);
    const bytes = await doc.save();
    const source = await readBookmarkSource(bytes);
    const end = run(initialBookmarkState(source.items), {
      type: 'add',
      page: 2,
      view: newBookmarkView(source, 2),
    });
    const file = pdf('two.pdf', bytes, 3);
    store.addFiles('u1:A', [file], ctx.session);
    const result = await runTool('bookmarks', [file], { items: toOutline(end), name: 'Chosen name' }, ctx, deps);
    expect(result.status).toBe('added');
    const [made] = store.getState().files.filter((f) => f.origin === 'result');
    expect(made.name).toBe('Chosen name.pdf');
    expect(made.operation?.summary).toBe('Bookmarks edited: 2 bookmarks');
    expect(made.operation?.flags).toBeUndefined();
    expect(await pdfjsOutline(made.bytes)).toEqual([
      [0, 'One', 0],
      [0, 'Page 3', 2],
    ]);
  });

  // REV-A B5 / INT3: old bookmarks the save could not remove with certainty stay, unlinked; the result says so.
  it('old bookmarks that could not be removed safely: flagged, noted in the record, said in one sentence', async () => {
    const { store, ctx, deps } = setup();
    const { doc } = await baseDoc(2);
    const { items } = buildOutline(doc, [
      { title: 'Kept one', dest: fit(doc, 0) },
      { title: 'Orphan title', dest: fit(doc, 1) },
    ]);
    dictAt(doc, items[1]).delete(PDFName.of('Parent')); // not provably the outline's own: kept, unlinked
    const bytes = await doc.save({ useObjectStreams: false });
    const file = pdf('damaged outline.pdf', bytes, 2);
    store.addFiles('u1:A', [file], ctx.session);
    const result = await runTool('bookmarks', [file], { items: [{ title: 'New one', page: 0, open: false, children: [] }] }, ctx, deps);
    expect(result).toMatchObject({
      status: 'added',
      tone: 'warning',
      detail: 'It has 1 bookmark. Some old bookmarks could not be removed safely; their titles may still be in the file’s data, though no reader shows them.',
    });
    const [made] = store.getState().files.filter((f) => f.origin === 'result');
    expect(made.operation?.flags).toEqual({ oldBookmarksKept: true });
    expect(made.operation?.summary).toBe('Bookmarks edited: 1 bookmark; some old bookmark titles may remain in the file');
    expect(await pdfjsOutline(made.bytes)).toEqual([[0, 'New one', 0]]);
    // a healthy file says nothing of the kind (the other tests: no flag, a success tone)
  });

  it('a signed source: the result is marked "Signature no longer valid"', async () => {
    const { store, ctx, deps } = setup();
    const { bytes, options } = await editedTrialFile();
    const source = pdf('signed.pdf', bytes, 6, { hasSignature: true });
    store.addFiles('u1:A', [source], ctx.session);
    await runTool('bookmarks', [source], options, ctx, deps);
    const [made] = store.getState().files.filter((f) => f.origin === 'result');
    expect(made.signatureInvalid).toBe(true);
    expect(made.hasSignature).toBe(false);
    expect(made.operation?.flags).toMatchObject({ signatureInvalid: true });
    expect(made.operation?.summary).toContain('signature no longer valid');
  });

  it('refuses an empty title, naming the bookmark by its place; nothing is added', async () => {
    const { store, ctx, deps } = setup();
    const bytes = await makePdf('E', 2);
    const file = pdf('e.pdf', bytes, 2, { hasBookmarks: false });
    store.addFiles('u1:A', [file], ctx.session);
    const items: OutlineItem[] = [
      { title: 'Fine', page: 0, open: false, children: [] },
      { title: ' \u200B ', page: 1, open: false, children: [] },
    ];
    await expect(runTool('bookmarks', [file], { items }, ctx, deps)).rejects.toMatchObject({
      code: 'bookmark-title-invalid',
      message: 'A bookmark needs a title. (Bookmark 2 in the list has none.)',
    });
    expect(store.getState().files).toHaveLength(1);
  });

  it('refuses a file over the limits with the plain message; nothing is added', async () => {
    const { store, ctx, deps } = setup();
    const { doc } = await baseDoc(1);
    buildOutline(
      doc,
      Array.from({ length: 10_001 }, (_, i) => ({
        title: `B${i}`,
        dest: fit(doc, 0),
      })),
    );
    const file = pdf('big.pdf', await doc.save(), 1);
    store.addFiles('u1:A', [file], ctx.session);
    await expect(runTool('bookmarks', [file], { items: [] }, ctx, deps)).rejects.toMatchObject({
      code: 'bookmarks-not-editable',
      message: BOOKMARKS_NOT_EDITABLE_MESSAGE,
    });
    expect(store.getState().files).toHaveLength(1);
  });

  it('a list without room for the copy refuses before the slow save (the step contract)', async () => {
    const { store, ctx, deps, labels } = setup();
    const bytes = await makeOutlinePdf();
    const file = pdf('outline.pdf', bytes, 6);
    store.addFiles('u1:A', [file], ctx.session);
    const items: OutlineItem[] = [{ title: 'One', page: 0, open: false, children: [] }];
    await expect(runTool('bookmarks', [file], { items }, ctx, { ...deps, maxBytes: Math.floor(bytes.byteLength * 1.5) })).rejects.toMatchObject({
      code: 'list-full',
      message: expect.stringContaining('The bookmarked copy would take the list over'),
    });
    expect(labels).not.toContain('Saving the bookmarks…');
    expect(store.getState().files).toHaveLength(1);
  });

  it('refuses anything but exactly one PDF', async () => {
    const { store, ctx, deps } = setup();
    const bytes = await makePdf('E', 1);
    const a = pdf('a.pdf', bytes, 1);
    const b = pdf('b.pdf', bytes, 1);
    store.addFiles('u1:A', [a, b], ctx.session);
    await expect(runTool('bookmarks', [a, b], { items: [] }, ctx, deps)).rejects.toMatchObject({ code: 'wrong-input' });
  });

  it('a Stop while saving adds nothing; a change of engagement adds nothing and says nothing', async () => {
    const stopped = setup();
    const { bytes, options } = await editedTrialFile();
    const file = pdf('outline.pdf', bytes, 6);
    stopped.store.addFiles('u1:A', [file], stopped.ctx.session);
    const ctx = {
      ...stopped.ctx,
      onProgress: (_d: number, _t: number, label?: string) => label === 'Saving the bookmarks…' && stopped.controller.abort(),
    };
    expect(await runTool('bookmarks', [file], options, ctx, stopped.deps)).toEqual({ status: 'cancelled', added: 0, ids: [] });
    expect(stopped.store.getState().files).toHaveLength(1);

    const moved = setup();
    moved.store.addFiles('u1:A', [file], moved.ctx.session);
    const away = {
      ...moved.ctx,
      onProgress: (_d: number, _t: number, label?: string) => label === 'Checking the saved bookmarks…' && moved.store.setContext('u1:B'),
    };
    expect(await runTool('bookmarks', [file], options, away, moved.deps)).toEqual({ status: 'stale', added: 0, ids: [] });
    moved.store.setContext('u1:A');
    expect(moved.store.getState().files.some((f) => f.origin === 'result')).toBe(false);
  });

  it('the step itself is the module’s `step` export (the contract runTool calls)', () => {
    expect(typeof step).toBe('function');
  });

  it('a 2,000-bookmark, 500-page file: rename one and add one, saved and verified', async () => {
    const { store, ctx, deps } = setup();
    const { doc } = await baseDoc(500);
    buildOutline(
      doc,
      Array.from({ length: 400 }, (_, i) => ({
        title: `Section ${i + 1}`,
        dest: fit(doc, i),
        children: Array.from({ length: 4 }, (_, k) => ({
          title: `Section ${i + 1}.${k + 1}`,
          dest: fit(doc, (i + k) % 500),
        })),
      })),
    );
    const bytes = await doc.save();
    const source = await readBookmarkSource(bytes);
    const end = run(
      { ...initialBookmarkState(source.items), selected: 'b1' },
      { type: 'rename', id: 'b1', title: 'Opening section' },
      { type: 'add', page: 499, view: newBookmarkView(source, 499) },
    );
    const file = pdf('ledger.pdf', bytes, 500);
    store.addFiles('u1:A', [file], ctx.session);
    const started = performance.now();
    const result = await runTool('bookmarks', [file], { items: toOutline(end) }, ctx, deps);
    const took = performance.now() - started;
    console.log(`Bookmarks save, 500 pages, 2,001 bookmarks: ${took.toFixed(0)} ms`);
    expect(result.status).toBe('added');
    const [made] = store.getState().files.filter((f) => f.origin === 'result');
    const read = await readBookmarks(made.bytes);
    // added after the selected bookmark, at its level
    expect(read.items).toHaveLength(401);
    expect(read.items[0].title).toBe('Opening section');
    expect(read.items[0].children).toHaveLength(4);
    expect(read.items[1]).toMatchObject({ title: 'Page 500', page: 499 });
    expect(made.operation?.summary).toBe(operationSummary('bookmarks', { bookmarks: 2_001 }));
    // A hang guard only: no time is asserted. It took over the file's 120 s in INT3's full run on a machine at about
    // twenty times its idle load (reads and saves give the window a turn by the clock, pace.ts).
  }, 600_000);
});

describe('verifySavedOutline', () => {
  const tree = (): OutlineItem[] => [
    {
      title: 'A',
      page: 0,
      open: true,
      children: [{ title: 'A1', page: 1, open: false, children: [] }],
    },
    {
      title: 'Web',
      page: null,
      uri: 'https://x.in',
      open: false,
      children: [],
    },
  ];

  it('accepts the same tree, and titles as the reader cleans them', () => {
    const read = tree();
    expect(verifySavedOutline(tree(), read)).toBe(true);
    const spaced = tree();
    spaced[0].title = '  A  ';
    expect(verifySavedOutline(spaced, read)).toBe(true);
  });

  it('refuses a different title, page, web address, depth or count', () => {
    const cases: ((t: OutlineItem[]) => void)[] = [
      (t) => (t[0].title = 'B'),
      (t) => (t[0].children[0].page = 2),
      (t) => (t[1].uri = 'https://y.in'),
      (t) => t[0].children.pop(),
      (t) => t.push({ title: 'Extra', page: 0, open: false, children: [] }),
      (t) => (t[1].children = [t[0].children[0]]),
    ];
    for (const change of cases) {
      const read = tree();
      change(read);
      expect(verifySavedOutline(tree(), read)).toBe(false);
    }
  });
});
