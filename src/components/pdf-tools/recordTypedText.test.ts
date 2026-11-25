// What the user types never reaches the activity record (lead's ruling on REV-B B1, REV-A B7: "the record
// holds counts and choices only"). One recognisable marker is typed into every place a tool takes text that is
// not a file name, run through the real run steps, and looked for in the activity entry of each result (its
// options, summary, details and sources) and of a later result that lists it as an earlier step. A file name
// is a name: Split at bookmarks names its files from the titles (an earlier ruling), so there only the record
// and the summary are checked. Redact has its own record tests (redact/redactRecord.test.ts).
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { buildActivityEntry } from '@/lib/pdf-tools/activity';
import { defaultPageNumberOptions } from '@/lib/pdf-tools/pageNumbers';
import { solidPng } from '@/lib/pdf-tools/testMarksPdf';
import { baseDoc, buildOutline, fit } from '@/lib/pdf-tools/testOutlinePdf';
import { makePdf, pageTexts } from '@/lib/pdf-tools/testPdf';
import { createWorkingListStore } from '@/lib/pdf-tools/workingList';
import { WATERMARK_DEFAULTS } from '@/lib/pdf-tools/watermark';
import type { WorkingFile } from '@/lib/pdf-tools/types';
import { runTool, type RunContext, type RunDeps } from './runTool';

vi.setConfig({ testTimeout: 120_000 });

const MARKER = 'Qxzmarker';
const CLIENT = 'Qxzclient Pvt Ltd';
const FOUND = /qxz/i;

let three: Uint8Array;
let outlined: Uint8Array;
beforeAll(async () => {
  three = await makePdf('T', 3);
  const { doc } = await baseDoc(4, 'B');
  buildOutline(doc, [
    { title: `${MARKER} one`, dest: fit(doc, 0) },
    { title: `${MARKER} two`, dest: fit(doc, 2) },
  ]);
  outlined = await doc.save();
  await pageTexts(three); // pays the cold pdf.js import once
}, 120_000);

let seq = 0;
const pdf = (name: string, bytes: Uint8Array, pageCount: number, extra: Partial<WorkingFile> = {}): WorkingFile => ({
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
  sentTo: [],
  ...extra,
});

function setup() {
  const store = createWorkingListStore();
  store.setContext('u1:A');
  const ctx: RunContext = { contextKey: 'u1:A', session: store.getState().session, store, signal: new AbortController().signal, onProgress: vi.fn() };
  const deps: Partial<RunDeps> = { paint: async () => undefined, yieldToUi: async () => undefined };
  return { ctx, deps, files: () => store.getState().files };
}

const entryOf = (file: WorkingFile) => buildActivityEntry({ file, destination: 'vault', sha256: 'ab'.repeat(32), vaultRecordId: 'ev-1' });

describe('a typed text never reaches the activity record', () => {
  it('Watermark, Page numbers, Bookmarks and Protect, and a later result that lists them as earlier steps', async () => {
    const { ctx, deps, files } = setup();
    const tokens = { date: '14-11-2026', client: CLIENT };
    await runTool(
      'watermark',
      [pdf('Ledger.pdf', three, 3)],
      {
        options: {
          pages: { from: 1, to: 3 },
          tokens,
          watermark: { ...WATERMARK_DEFAULTS.watermark, text: `${MARKER} {client}`, placement: { anchor: 'center', padPt: 20 } },
          stamp: { ...WATERMARK_DEFAULTS.stamp, text: MARKER, placement: { anchor: 'top-right', padPt: 20 } },
          logo: { image: solidPng(30, 10, [0, 0, 200]), format: 'png', ...WATERMARK_DEFAULTS.logo, placement: { anchor: 'top-left', padPt: 20 } },
        },
      },
      ctx,
      deps,
    );
    await runTool(
      'page-numbers',
      [pdf('Ledger.pdf', three, 3)],
      {
        numbers: {
          ...defaultPageNumberOptions(3),
          format: 'custom',
          prefix: `${MARKER} / `,
          suffix: ` ${MARKER}`,
          texts: { 'top-left': `${MARKER} {client}`, 'bottom-left': '{fy}' },
          tokens: { file: 'Ledger.pdf', client: CLIENT, fy: '2025-26', today: new Date(2026, 10, 14) },
        },
      },
      ctx,
      deps,
    );
    await runTool('bookmarks', [pdf('Ledger.pdf', three, 3)], { items: [{ title: `${MARKER} notes`, page: 1, open: false, children: [] }], edits: { added: 1, renamed: 0, moved: 0, removed: 0, notCarried: 0 } }, ctx, deps);
    await runTool('protect', [pdf('Ledger.pdf', three, 3)], { password: `${MARKER}-pass-2026` }, ctx, deps);
    const [watermarked, numbered, bookmarked, protectedCopy] = files();
    expect([watermarked, numbered, bookmarked, protectedCopy].map((f) => f.operation?.tool)).toEqual(['watermark', 'page-numbers', 'bookmarks', 'protect']);
    // Before the marker is looked for: the runs really did use it (on the pages, in the outline).
    expect((await pageTexts(watermarked.bytes))[0]).toContain(MARKER);
    expect((await pageTexts(numbered.bytes))[0]).toContain(MARKER);

    for (const made of [watermarked, numbered, bookmarked, protectedCopy]) {
      const entry = entryOf(made);
      expect(JSON.stringify(entry), made.operation!.tool).not.toMatch(FOUND);
      expect(JSON.stringify(made.operation), made.operation!.tool).not.toMatch(FOUND);
    }

    // A result made from those results lists them as earlier steps: nothing typed there either.
    await runTool('merge', [watermarked, numbered, bookmarked], { fileBookmarks: false, keepOwnBookmarks: false }, ctx, deps);
    const merged = files()[4];
    const entry = entryOf(merged);
    expect((entry.metadata.earlierSteps as unknown[]).length).toBe(3);
    expect(JSON.stringify(entry)).not.toMatch(FOUND);
  });

  it('Split at bookmarks: the titles name the files (an earlier ruling) but never reach the record or its summary', async () => {
    const { ctx, deps, files } = setup();
    await runTool('split', [pdf('Bundle.pdf', outlined, 4, { hasBookmarks: true })], { mode: 'bookmarks' }, ctx, deps);
    const parts = files();
    expect(parts.length).toBe(2);
    expect(parts[0].name).toMatch(FOUND); // the file name carries the title, as ruled
    for (const part of parts) {
      const entry = entryOf(part);
      expect(JSON.stringify({ options: entry.metadata.options, summary: part.operation!.summary, sources: entry.metadata.sources })).not.toMatch(FOUND);
      expect(entry.details.split(' → ')[0]).not.toMatch(FOUND);
    }
  });
});
