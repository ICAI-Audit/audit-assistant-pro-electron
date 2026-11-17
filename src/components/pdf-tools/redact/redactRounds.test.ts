// Redact's rounds (design 5.9 "The check", lead rulings 2 and E): a round marks a value dealt with only
// by a box over it; a value that is not drawn and cannot be boxed is flattened only on the user's word;
// anything else that cannot be covered, or still found after the allowed builds, adds nothing.
import { describe, expect, it, vi } from 'vitest';
import { buildPageText, type PageTextModel, type Rect } from '@/lib/pdf-tools/pageText';
import type { RebuiltPage } from '@/lib/pdf-tools/redactBuild';
import type { CheckHit } from '@/lib/pdf-tools/redactCheck';
import { PdfToolsError } from '@/lib/pdf-tools/types';
import type { PageWork } from './redactPages';
import { altTextSpans, clusterPart, clusterRule, fromCheckHits, INK_PAD_PT, inkBoxes, locatePlaces, locatePlacesPaced, loosePlaces, MAX_BUILDS, judgeInTurns, pagesLosingText, proofEdit, proofEditPaced, readerHits, redactInRounds, wholeRunsIn, type Placement, type RoundDeps, type RoundHit } from './redactRounds';
import type { RedactArea } from './reviewState';

const rect = (x0: number): Rect => ({ x0, y0: 700, x1: x0 + 50, y1: 712 });
const area = (page: number, x0 = 100, ranges: [number, number][] = [[0, 10]]): RedactArea => ({ page, rects: [rect(x0)], kind: 'pan', hidden: false, angle: 0, ranges });
const work = (page: number, areas: RedactArea[] = [area(page)]): PageWork => ({ page, areas });

/** Stub deps: each check call returns the next list of hits; `locate` answers by page. */
function stubs(checks: RoundHit[][], locate: (page: number) => RedactArea[] = () => [], extra: Partial<RoundDeps> = {}) {
  const drawnWorks: PageWork[] = [];
  const builds: RebuiltPage[][] = [];
  let call = 0;
  const deps: RoundDeps = {
    draw: async (w) => {
      drawnWorks.push(w);
      const rebuilt: RebuiltPage = w.flatten
        ? { pageIndex: w.page, picture: { bytes: new Uint8Array([1]), widthPx: 1, heightPx: 1, encoding: 'flate-gray' }, words: [], reason: 'flattened', boxes: [] }
        : { pageIndex: w.page, picture: { bytes: new Uint8Array([1]), widthPx: 1, heightPx: 1, encoding: 'flate-gray' }, words: [], reason: 'boxes', boxes: w.areas.flatMap((a) => a.rects) };
      return { rebuilt, replacementsNotFitted: 0, boxesWidened: 0, coveredMore: 0, unreadable: false };
    },
    build: async (pages) => {
      builds.push([...pages]);
      return { bytes: new Uint8Array([builds.length]), report: { textLayerCharsOmitted: 0, wordsLeftOut: 0, cleaned: {}, bookmarksRemoved: 0, bookmarksDropped: 0, sharedResourcesKept: false, pagesFlattened: [] } };
    },
    check: async () => ({ hits: checks[call++] ?? [], structure: [] }),
    locate,
    model: () => undefined,
    checkpoint: () => undefined,
    ...extra,
  };
  return { deps, drawnWorks, builds };
}

const first = new Map([[0, work(0)]]);

describe('redactInRounds', () => {
  it('a clean first check: one build, nothing added by the check', async () => {
    const { deps, builds } = stubs([[]]);
    const out = await redactInRounds(first, deps);
    expect(out.builds).toBe(1);
    expect(builds).toHaveLength(1);
    expect(out.pagesBoxedByCheck).toEqual([]);
    expect(out.pagesFlattened).toEqual([]);
  });

  it('a drawn hit on a copied page is placed by the find on that page, boxed and rebuilt', async () => {
    const { deps, drawnWorks, builds } = stubs([[{ pages: [3], elsewhere: [], drawn: true, remedy: 'find' }], []], (page) => (page === 3 ? [area(3, 300)] : []));
    const out = await redactInRounds(first, deps);
    expect(out.builds).toBe(2);
    expect(out.pagesBoxedByCheck).toEqual([3]);
    expect(drawnWorks.map((w) => w.page)).toEqual([0, 3]);
    expect(builds[1].map((p) => p.pageIndex)).toEqual([0, 3]);
    expect(builds[1][1].boxes).toEqual([rect(300)]);
  });

  it('wave 5, ruling S: the places on a page the check names are worked out in turns (locate may answer later), and boxed as before', async () => {
    const { deps, drawnWorks, builds } = stubs([[{ pages: [3], elsewhere: [], drawn: true, remedy: 'find' }], []], () => [], {
      locate: async (page: number) => {
        await new Promise((resolve) => setTimeout(resolve, 1));
        return page === 3 ? [area(3, 300)] : [];
      },
    } as unknown as Partial<RoundDeps>);
    const out = await redactInRounds(first, deps);
    expect(out.pagesBoxedByCheck).toEqual([3]);
    expect(drawnWorks.map((w) => w.page)).toEqual([0, 3]);
    expect(builds[1][1].boxes).toEqual([rect(300)]);
  });

  it('wave 4, ruling M: a page off the copy allow-list is drawn in the first build with no box of its own, as a page to rebuild, and named', async () => {
    const { deps, drawnWorks } = stubs([[]], () => [], { unsafeToCopy: new Set([2]) });
    const out = await redactInRounds(first, deps);
    expect(drawnWorks.map((w) => [w.page, w.safety === true, w.areas.length])).toEqual([[0, false, 1], [2, true, 0]]);
    expect(out.pagesNotCopied).toEqual([2]);
    expect(out.pagesBoxedByCheck).toEqual([]);
  });

  it("wave 4, ruling P: a value the check finds on a copied page where the find's reading shows nothing: the refusal never says to draw a box over it", async () => {
    const hit: RoundHit = { pages: [2], elsewhere: [], drawn: true, remedy: 'find' };
    const shown = (await redactInRounds(first, stubs([[hit]], () => [], { shows: () => true }).deps).catch((e: unknown) => e)) as Error;
    expect(shown.message).toMatch(/Draw a box over that text/);
    const hidden = (await redactInRounds(first, stubs([[hit]], () => [], { shows: () => false }).deps).catch((e: unknown) => e)) as Error;
    expect(hidden.message).toMatch(/\(page 3\)\. Nothing was added\. Untick that value, or print the file to a new PDF and redact that copy\.$/);
    expect(hidden.message).not.toMatch(/Draw a box/);
  });

  it('wave 4, K1: a glyph with no letter of its own is a cluster part only inside a word of a script no chosen value uses, away from Latin letters and digits', () => {
    const latin = clusterRule(['QWXPT4821K', 'Ramesh Kumar Gupta']);
    const deva = 'गु';
    // Inside a Devanagari word (H14's "gu?a"), after a space, after a line break: a cluster part.
    expect(clusterPart(1, `कुमार ${deva}`, 'ा / Ramesh', latin)).toBe(true);
    expect(clusterPart(1, 'हि क ', 'ी रम', latin)).toBe(true);
    expect(clusterPart(1, 'ा\n', 'ी र', latin)).toBe(true);
    // A Latin letter or a digit nearest on either side, past spaces and punctuation (H14's "Address", H15's account).
    expect(clusterPart(1, 'Address\t', 'ैट', latin)).toBe(false);
    expect(clusterPart(2, 'ಸಂ', '\t50100', latin)).toBe(false);
    expect(clusterPart(1, '01234। ', 'ાહ', latin)).toBe(false);
    // Nothing of another script right beside it; too long; a script a chosen value uses.
    expect(clusterPart(1, 'x ', ' y', latin)).toBe(false);
    expect(clusterPart(4, deva, 'ा', latin)).toBe(false);
    expect(clusterPart(1, deva, 'ा', clusterRule(['Ramesh', 'रमेश']))).toBe(false);
    expect(clusterPart(2, deva, 'ा', clusterRule(['Om']))).toBe(false);
    expect(clusterPart(1, deva, 'ा', clusterRule(['Om']))).toBe(true);
  });

  it('wave 5, ruling R: the scripts of typed values placed nowhere are covered whole where the text holds letters of them that cannot be read', () => {
    const rule = clusterRule(['Ramesh Kumar Gupta', 'रमेश कुमार गुप्ता'], ['रमेश कुमार गुप्ता']);
    expect([...rule.whole]).toEqual(['Devanagari']);
    expect(clusterRule(['Ramesh Kumar Gupta', 'रमेश']).whole.size).toBe(0);
    // H14's "gu?ta" (the conjunct's glyph has no letter of its own), past a space, and the same glyph in a Telugu word.
    expect(wholeRunsIn('रमेश कुमार गु\u0000ता', rule)).toBe(true);
    expect(wholeRunsIn('नाम: \u0000 ', rule)).toBe(true);
    expect(wholeRunsIn('మొ\u0000బైల్ 98450', rule)).toBe(false);
    expect(wholeRunsIn('रमेश कुमार गुप्ता', rule)).toBe(false);
    expect(wholeRunsIn('रमेश कुमार गु\u0000ता', clusterRule(['Ramesh Kumar Gupta', 'रमेश']))).toBe(false);
    // A Latin word typed and placed nowhere: a ligature with no letter in Latin text is covered whole too.
    expect(wholeRunsIn('Gri\u0000n & Co', clusterRule(['Griffin'], ['Griffin']))).toBe(true);
  });

  it('wave 4, K1: the pages that will lose letters Redact cannot read are known before the run (symbol bullets aside)', () => {
    const model = (text: string) => ({ text }) as unknown as PageTextModel;
    const models = [model('गु\u0000ा notice'), model('Address\t\u0000ैट'), model(' Point one'), model('\u0001\u0002\u0003\u0004 heading')];
    expect(pagesLosingText(models, [0, 1, 2, 3], ['QWXPT4821K'])).toEqual([1, 3]);
    expect(pagesLosingText(models, [0, 2], ['QWXPT4821K'])).toEqual([]);
  });

  it('a hit that gives its own boxes (a comment\'s rectangle) is boxed there, padded', async () => {
    const { deps, builds } = stubs([[{ pages: [2], elsewhere: [], boxes: [{ page: 2, rect: rect(50) }], drawn: true, remedy: 'boxes' }], []]);
    await redactInRounds(first, deps);
    const [box] = builds[1].find((p) => p.pageIndex === 2)!.boxes;
    expect(box.x0).toBeLessThan(50);
    expect(box.x1).toBeGreaterThan(100);
  });

  it('a value that is not drawn and cannot be boxed is flattened on the user\'s confirmation, then checked again', async () => {
    const confirmFlatten = vi.fn(async () => true);
    const { deps, drawnWorks, builds } = stubs([[{ pages: [4], elsewhere: [], drawn: false, remedy: 'flatten' }], []], () => [], { confirmFlatten });
    const out = await redactInRounds(first, deps);
    expect(confirmFlatten).toHaveBeenCalledWith([4], { mayShow: [] });
    expect(out.pagesFlattened).toEqual([4]);
    expect(drawnWorks.find((w) => w.page === 4)?.flatten).toBe(true);
    expect(builds[1].find((p) => p.pageIndex === 4)?.reason).toBe('flattened');
  });

  it('declined: nothing is made, and the message names the page only', async () => {
    const { deps } = stubs([[{ pages: [4], elsewhere: [], drawn: false, remedy: 'flatten' }]], () => [], { confirmFlatten: async () => false });
    const error = await redactInRounds(first, deps).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PdfToolsError);
    expect((error as Error).message).toBe('Page 5 still holds redacted text where no box can cover it, and it was not flattened. Nothing was added. If the text can be seen on the page, draw a box over it and run Redact again.');
  });

  it('without a way to ask, a value that is not drawn ends the run "not verified"', async () => {
    const { deps } = stubs([[{ pages: [4], elsewhere: [], drawn: false, remedy: 'flatten' }]]);
    await expect(redactInRounds(first, deps)).rejects.toMatchObject({ code: 'redact-check-failed', message: expect.stringMatching(/\(page 5\)/) });
  });

  it('a DRAWN value the find cannot place is never flattened: not verified', async () => {
    const confirmFlatten = vi.fn(async () => true);
    const { deps } = stubs([[{ pages: [4], elsewhere: [], drawn: true, remedy: 'find' }]], () => [], { confirmFlatten });
    await expect(redactInRounds(first, deps)).rejects.toMatchObject({ code: 'redact-check-failed' });
    expect(confirmFlatten).not.toHaveBeenCalled();
    // Nor a hit whose drawing is not known.
    const unknown = stubs([[{ pages: [4], elsewhere: [] }]], () => [], { confirmFlatten });
    await expect(redactInRounds(first, unknown.deps)).rejects.toMatchObject({ code: 'redact-check-failed' });
    expect(confirmFlatten).not.toHaveBeenCalled();
  });

  it('a hit in bookmarks, the document properties or no page cannot be covered: not verified, the places named', async () => {
    const { deps } = stubs([[{ pages: [], elsewhere: ['bookmarks'] }, { pages: [], elsewhere: ['document properties'] }]]);
    await expect(redactInRounds(first, deps)).rejects.toThrow('The redacted file could not be verified: redacted text was still found in it (bookmarks, document properties). Nothing was added.');
  });

  it('a hit the check says no rebuild removes is not verified', async () => {
    const { deps } = stubs([[{ pages: [0], elsewhere: [], remedy: 'none' }]]);
    await expect(redactInRounds(first, deps)).rejects.toMatchObject({ code: 'redact-check-failed' });
  });

  it('a value still found where its places are already boxed: not verified (no box can remove it)', async () => {
    const { deps } = stubs([[{ pages: [0], elsewhere: [], drawn: true, remedy: 'find' }]], (page) => (page === 0 ? [area(0)] : []));
    await expect(redactInRounds(first, deps)).rejects.toMatchObject({ code: 'redact-check-failed', message: expect.stringMatching(/page 1/) });
  });

  it(`at most ${MAX_BUILDS} builds: still found after them, nothing is added`, async () => {
    let n = 0;
    const hit: RoundHit = { pages: [1], elsewhere: [], drawn: true, remedy: 'find' };
    const { deps, builds } = stubs([[hit], [hit], [hit], [hit]], () => [area(1, 10 + 60 * n++)]);
    await expect(redactInRounds(first, deps)).rejects.toMatchObject({ code: 'redact-check-failed' });
    expect(builds).toHaveLength(MAX_BUILDS);
  });

  it('a structure problem is not verified, naming its page', async () => {
    const { deps } = stubs([]);
    deps.check = async () => ({ hits: [], structure: ['Page 2 has an entry a rebuilt page may not have.'] });
    await expect(redactInRounds(first, deps)).rejects.toThrow(/\(page 2\)/);
  });

  it('R2\'s hits keep their flag, remedy, part and object', () => {
    const hit = { pass: 'strict', pages: [1], elsewhere: [], part: 'content', object: '4 0 R', key: 'stream', drawn: false, remedy: 'flatten' } as CheckHit;
    expect(fromCheckHits([hit])).toEqual([{ pages: [1], elsewhere: [], drawn: false, remedy: 'flatten', part: 'content', object: '4 0 R' }]);
  });

  // ---- T-052 (redact-e2e-review.md B4, B5, non-blocking 6) ----

  it('B4: a page that gets boxes in a round is never flattened, whatever the order of its hits', async () => {
    const boxed: RoundHit = { pages: [1], elsewhere: [], boxes: [{ page: 1, rect: rect(330) }], drawn: true, remedy: 'boxes' };
    const dictionary: RoundHit = { pages: [1], elsewhere: [], drawn: false, remedy: 'flatten' };
    for (const hits of [[boxed, dictionary], [dictionary, boxed]]) {
      const confirmFlatten = vi.fn(async () => true);
      const { deps, builds } = stubs([hits, []], () => [], { confirmFlatten });
      const out = await redactInRounds(first, deps);
      expect(confirmFlatten).not.toHaveBeenCalled();
      expect(out.pagesFlattened).toEqual([]);
      expect(out.pagesBoxedByCheck).toEqual([1]);
      const page = builds[1].find((p) => p.pageIndex === 1)!;
      expect(page.reason).toBe('boxes');
      expect(page.boxes).toHaveLength(1);
    }
  });

  it('B4: a value that is not drawn on a page already being rebuilt is left to the rebuild (no question)', async () => {
    const confirmFlatten = vi.fn(async () => true);
    // Round 1 finds a drawn value on page 2 (boxed now) and a value that is not drawn on the same page.
    const hits: RoundHit[] = [{ pages: [2], elsewhere: [], drawn: true, remedy: 'find' }, { pages: [2], elsewhere: [], drawn: false, remedy: 'flatten' }];
    const { deps } = stubs([hits, []], (page) => (page === 2 ? [area(2, 300)] : []), { confirmFlatten });
    const out = await redactInRounds(first, deps);
    expect(confirmFlatten).not.toHaveBeenCalled();
    expect(out.pagesFlattened).toEqual([]);
  });

  it('B5: alternative text whose drawing can be placed is boxed there instead of flattened', async () => {
    const confirmFlatten = vi.fn(async () => true);
    const place = vi.fn(async () => ({ by: 'ink' as const, rects: [rect(400)] }));
    const { deps, builds } = stubs([[{ pages: [4], elsewhere: [], drawn: false, remedy: 'flatten', part: 'content', object: '7 0 R' }], []], () => [], { confirmFlatten, place });
    const out = await redactInRounds(first, deps);
    expect(confirmFlatten).not.toHaveBeenCalled();
    expect(out.pagesFlattened).toEqual([]);
    expect(out.pagesBoxedByCheck).toEqual([4]);
    const [box] = builds[1].find((p) => p.pageIndex === 4)!.boxes;
    // Where a drawing paints is measured on one renderer: its box keeps twice the find's margin (3 pt).
    expect(box.x0).toBeCloseTo(400 - INK_PAD_PT, 6);
    expect(box.y1).toBeCloseTo(712 + INK_PAD_PT, 6);
    expect(INK_PAD_PT).toBe(3);
  });

  it('B5: alternative text that cannot be placed asks with "may show", and says it for that page only', async () => {
    const confirmFlatten = vi.fn(async () => true);
    const place = vi.fn(async (_bytes: Uint8Array, page: number) => (page === 4 ? { by: 'none' as const, mayShow: true } : { by: 'none' as const }));
    const hits: RoundHit[] = [4, 6].map((p) => ({ pages: [p], elsewhere: [], drawn: false, remedy: 'flatten' as const, part: 'content', object: '7 0 R' }));
    const { deps } = stubs([hits, []], () => [], { confirmFlatten, place });
    const out = await redactInRounds(first, deps);
    expect(confirmFlatten).toHaveBeenCalledWith([4, 6], { mayShow: [4] });
    expect(out.pagesFlattened).toEqual([4, 6]);
  });

  it('B1: before the first build, what the source draws on a page to rebuild is boxed (a stamp\'s rectangle, a pattern\'s ink)', async () => {
    const stamp: RoundHit = { pages: [0], elsewhere: [], boxes: [{ page: 0, rect: rect(330) }], drawn: true, remedy: 'boxes', part: 'annotation', object: '9 0 R' };
    const pattern: RoundHit = { pages: [0], elsewhere: [], drawn: true, remedy: 'find', part: 'resources', object: '12 0 R' };
    const elsewhere: RoundHit = { pages: [3], elsewhere: [], drawn: true, remedy: 'find', part: 'resources', object: '13 0 R' };
    const place = vi.fn(async () => ({ by: 'ink' as const, rects: [rect(500)] }));
    const { deps, drawnWorks, builds } = stubs([[]], () => [], { place, source: { bytes: new Uint8Array([9]), hits: async () => [stamp, pattern, elsewhere] } });
    const out = await redactInRounds(first, deps);
    expect(out.builds).toBe(1);
    expect(drawnWorks.map((w) => w.page)).toEqual([0]);
    expect(place).toHaveBeenCalledTimes(1);
    expect(place.mock.calls[0]).toEqual([new Uint8Array([9]), 0, pattern]);
    // The user's box, the stamp's rectangle and the pattern's ink, each padded.
    const boxes = builds[0][0].boxes;
    expect(boxes).toHaveLength(3);
    expect(boxes.some((b) => b.x0 < 330 && b.x1 > 380)).toBe(true);
    expect(boxes.some((b) => b.x0 < 500 && b.x1 > 550)).toBe(true);
    expect(out.pagesBoxedByCheck).toEqual([]);
  });

  it('B1: a drawn source hit on a page to rebuild that cannot be placed ends the run before anything is drawn', async () => {
    const pattern: RoundHit = { pages: [0], elsewhere: [], drawn: true, remedy: 'find', part: 'resources', object: '12 0 R' };
    const { deps, drawnWorks } = stubs([[]], () => [], { place: async () => ({ by: 'none' }), source: { bytes: new Uint8Array([9]), hits: async () => [pattern] } });
    await expect(redactInRounds(first, deps)).rejects.toMatchObject({ code: 'redact-check-failed', message: expect.stringMatching(/\(page 1\)/) });
    expect(drawnWorks).toEqual([]);
  });

  it('B1: on a page to rebuild, a value that is not drawn, a font, and an object that paints nothing are left to the rebuild', async () => {
    const hits: RoundHit[] = [
      { pages: [0], elsewhere: [], drawn: false, remedy: 'flatten', part: 'resources', object: '5 0 R' },
      { pages: [0], elsewhere: [], drawn: true, remedy: 'find', part: 'resources', object: '6 0 R' },
      { pages: [0], elsewhere: [], drawn: true, remedy: 'find', part: 'resources', object: '7 0 R' },
    ];
    const place = vi.fn(async (_b: Uint8Array, _p: number, hit: RoundHit) => (hit.object === '6 0 R' ? { by: 'find' as const, font: true } : hit.object === '7 0 R' ? { by: 'ink' as const, rects: [] } : { by: 'none' as const }));
    const confirmFlatten = vi.fn(async () => true);
    const { deps, builds } = stubs([[]], () => [], { place, confirmFlatten, source: { bytes: new Uint8Array([9]), hits: async () => hits } });
    await redactInRounds(first, deps);
    expect(confirmFlatten).not.toHaveBeenCalled();
    expect(builds[0][0].boxes).toEqual([rect(100)]);
  });

  it('B1/B5: on a page to rebuild, alternative text that may show asks first; "no" adds nothing', async () => {
    const hit: RoundHit = { pages: [0], elsewhere: [], drawn: false, remedy: 'flatten', part: 'content', object: '4 0 R' };
    const confirmFlatten = vi.fn(async () => false);
    const { deps, drawnWorks } = stubs([[]], () => [], { place: async () => ({ by: 'none', mayShow: true }), confirmFlatten, source: { bytes: new Uint8Array([9]), hits: async () => [hit] } });
    await expect(redactInRounds(first, deps)).rejects.toMatchObject({ code: 'redact-check-failed' });
    expect(confirmFlatten).toHaveBeenCalledWith([0], { mayShow: [0] });
    expect(drawnWorks).toEqual([]);
  });

  describe('a comment drawn over the whole page (its box is left out of the review by the 95% rule)', () => {
    const view = { view: [0, 0, 595, 842] } as unknown as PageTextModel;
    const whole: RoundHit = { pages: [0], elsewhere: [], boxes: [{ page: 0, rect: { x0: 0, y0: 0, x1: 595, y1: 842 } }], drawn: true, remedy: 'boxes', part: 'annotation', object: '20 0 R' };
    const source = (hit: RoundHit) => ({ bytes: new Uint8Array([9]), hits: async () => [hit] });

    it('is boxed where its appearance paints, never by a page-sized box', async () => {
      const place = vi.fn(async () => ({ by: 'ink' as const, rects: [rect(200)] }));
      const { deps, builds } = stubs([[]], () => [], { place, model: () => view, source: source(whole) });
      await redactInRounds(first, deps);
      const boxes = builds[0][0].boxes;
      expect(boxes).toHaveLength(2);
      expect(boxes.every((b) => (b.x1 - b.x0) * (b.y1 - b.y0) < 0.5 * 595 * 842)).toBe(true);
    });

    it('when where it paints cannot be told: the run fails before anything is drawn (no box of the user\'s on that page)', async () => {
      const { deps, drawnWorks } = stubs([[]], () => [], { place: async () => ({ by: 'none' }), model: () => view, source: source(whole) });
      await expect(redactInRounds(first, deps)).rejects.toMatchObject({ code: 'redact-check-failed', message: expect.stringMatching(/\(page 1\)/) });
      expect(drawnWorks).toEqual([]);
    });

    it('a box the user drew elsewhere on that page never makes it acceptable (wave 2, R4 / ruling 3): the run stops, nothing is asked', async () => {
      const confirmFlatten = vi.fn(async () => true);
      const drawnBox: RedactArea = { page: 0, rects: [rect(300)], kind: 'drawn', hidden: false, angle: 0, ranges: [] };
      const { deps, drawnWorks } = stubs([[]], () => [], { place: async () => ({ by: 'none' }), model: () => view, source: source(whole), confirmFlatten });
      await expect(redactInRounds(new Map([[0, work(0, [area(0), drawnBox])]]), deps)).rejects.toMatchObject({ code: 'redact-check-failed' });
      expect(confirmFlatten).not.toHaveBeenCalled();
      expect(drawnWorks).toEqual([]);
    });

    it('a page-sized place that reached the review another way (a promoted value, "everywhere") is no box: placed where it paints, or the run fails', async () => {
      const pageSized: RedactArea = { page: 0, rects: [{ x0: 0, y0: 0, x1: 595, y1: 842 }], kind: 'pan', hidden: false, angle: 0, ranges: [] };
      const place = vi.fn(async () => ({ by: 'ink' as const, rects: [rect(200)] }));
      const placed = stubs([[]], () => [], { place, model: () => view, source: source(whole) });
      await redactInRounds(new Map([[0, work(0, [area(0), pageSized])]]), placed.deps);
      const drawnArea = placed.drawnWorks[0].areas.find((a) => a.rects.some((r) => r.x1 - r.x0 > 500))!;
      expect(drawnArea.hidden).toBe(true);
      expect(placed.drawnWorks[0].areas.some((a) => !a.hidden && a.rects.some((r) => r.x0 < 200 && r.x1 > 250 && r.x1 < 300))).toBe(true);
      // Nothing the source shows can be placed and no box of the user's: the run fails before any drawing.
      const failed = stubs([[]], () => [], { place: async () => ({ by: 'none' }), model: () => view, source: source(whole) });
      await expect(redactInRounds(new Map([[0, work(0, [area(0), pageSized])]]), failed.deps)).rejects.toMatchObject({ code: 'redact-check-failed' });
      expect(failed.drawnWorks).toEqual([]);
      // A box the user drew over the whole page is theirs: kept.
      const mine: RedactArea = { ...pageSized, kind: 'drawn' };
      const own = stubs([[]], () => [], { model: () => view });
      await redactInRounds(new Map([[0, work(0, [mine])]]), own.deps);
      expect(own.drawnWorks[0].areas[0].hidden).toBe(false);
    });

    it('on a copied page, found by the check: not a black page, not a pass', async () => {
      const onCopied: RoundHit = { ...whole, pages: [2], boxes: [{ page: 2, rect: { x0: 0, y0: 0, x1: 595, y1: 842 } }] };
      const { deps } = stubs([[onCopied]], () => [], { place: async () => ({ by: 'none' }), model: () => view });
      await expect(redactInRounds(first, deps)).rejects.toMatchObject({ code: 'redact-check-failed', message: expect.stringMatching(/\(page 3\)/) });
    });
  });

  it('B2: the places the check would find are boxed on every page to rebuild before it is drawn, whatever the output', async () => {
    const { deps, builds } = stubs([[]], (page) => (page === 0 ? [area(0, 300, [[40, 58]])] : []));
    await redactInRounds(first, deps);
    expect(builds[0][0].boxes).toEqual([rect(100), rect(300)]);
  });

  it('wave 2, ruling 3 (R4): a drawn value on a copied page that no box can place is never answered with "draw a small box anywhere"; the words given can help', async () => {
    // A font's name or map (the check calls it drawn), and a stream that paints nothing there.
    const font: RoundHit = { pages: [2], elsewhere: [], drawn: true, remedy: 'find', part: 'resources', object: '8 0 R' };
    const pattern: RoundHit = { pages: [2], elsewhere: [], drawn: true, remedy: 'find', part: 'resources', object: '9 0 R' };
    const cases: [RoundHit, Placement][] = [[font, { by: 'find', font: true }], [pattern, { by: 'ink', rects: [] }]];
    for (const [hit, placed] of cases) {
      const { deps } = stubs([[hit]], () => [], { place: async () => placed });
      const error = (await redactInRounds(first, deps).catch((e: unknown) => e)) as PdfToolsError;
      expect(error.code).toBe('redact-check-failed');
      expect(error.message).toMatch(/\(page 3\)/);
      expect(error.message).not.toMatch(/small box|anywhere|Draw a box over that text/);
      expect(error.message).toMatch(/Untick that value, or print the file to a new PDF and redact that copy\./);
    }
    // Drawn and not placed at all: a box of the user's would not help either.
    const unplaced: RoundHit = { pages: [2], elsewhere: [], drawn: true, remedy: 'find', part: 'resources', object: '10 0 R' };
    const { deps } = stubs([[unplaced]], () => [], { place: async () => ({ by: 'none' }) });
    const error = (await redactInRounds(first, deps).catch((e: unknown) => e)) as PdfToolsError;
    expect(error.message).not.toMatch(/Draw a box over that text/);
    expect(error.message).toMatch(/print the file to a new PDF/);
  });
});

describe('alternative text and ink (B5, B1)', () => {
  const holds = (t: string) => t.replace(/\s/g, '').includes('QWXPT4821K');

  it('finds the marked content whose /ActualText or /Alt holds a value: written in, named, hex, UTF-16; the outermost only', () => {
    const inline = 'q /Span <</ActualText (QWXPT4821K) /Lang (en)>> BDC BT (x) Tj ET EMC Q';
    const { spans } = altTextSpans(inline, holds);
    expect(spans).toHaveLength(1);
    expect(inline.slice(spans[0][0], spans[0][1])).toBe('/Span <</ActualText (QWXPT4821K) /Lang (en)>> BDC BT (x) Tj ET EMC');
    const utf16 = '<FEFF' + [...'QWXPT4821K'].map((c) => c.charCodeAt(0).toString(16).padStart(4, '0')).join('') + '>';
    expect(altTextSpans(`/Figure <</Alt ${utf16}>> BDC 0 0 1 1 re f EMC`, holds).spans).toHaveLength(1);
    expect(altTextSpans('/Span /MC0 BDC (x) Tj EMC', holds, (name) => (name === 'MC0' ? ['PAN QWXPT4821K'] : [])).spans).toHaveLength(1);
    // Nested: the outer one is cut, once.
    const nested = '/Div <</Alt (QWXPT 4821K)>> BDC /Span <</ActualText (QWXPT4821K)>> BDC (x) Tj EMC EMC (after) Tj';
    expect(altTextSpans(nested, holds).spans).toEqual([[0, nested.indexOf(' (after)')]]);
    // Other marked content, strings with brackets, and inline image data are passed over.
    expect(altTextSpans('/P <</MCID 3>> BDC (a \\) <</ActualText (QWXPT4821K)>> BDC) Tj EMC BI /W 1 ID EMC BDC EI', holds).spans).toEqual([]);
    // A sequence that does not end in this stream is counted, not cut.
    expect(altTextSpans('/Span <</ActualText (QWXPT4821K)>> BDC (x) Tj', holds)).toEqual({ spans: [], open: 1 });
  });

  it('joins the pixels where two drawings differ into blocks', () => {
    const w = 64;
    const h = 32;
    const a = new Uint8ClampedArray(w * h * 4).fill(255);
    const b = a.slice();
    const dot = (x: number, y: number) => (b[(y * w + x) * 4] = 0);
    dot(3, 3);
    dot(9, 5); // near the first: one block
    dot(60, 30); // far: another
    expect(inkBoxes(a, b, w, h, 8)).toEqual([
      { left: 3, top: 3, right: 10, bottom: 6 },
      { left: 60, top: 30, right: 61, bottom: 31 },
    ]);
    expect(inkBoxes(a, a, w, h, 8)).toEqual([]);
  });
});

describe('placing a value on a page\'s text', () => {
  const model = (text: string) => buildPageText(0, [{ str: text, transform: [10, 0, 0, 10, 72, 700], width: text.length * 5, height: 10, fontName: 'f', hasEOL: false }], { f: { fontFamily: 'sans-serif', ascent: 0.9, descent: -0.2, vertical: false } }, [0, 0, 595, 842], 0);
  const measure = () => 50;

  it('finds a code by the find\'s rule and by the looser net (any punctuation between its characters)', () => {
    expect(loosePlaces('ref BN..ZP/M--2501 F end', 'pan', 'BNZPM2501F')).toEqual([{ start: 4, end: 20 }]);
    const areas = locatePlaces(model('PAN B.N.Z.P.M.2.5.0.1.F here'), [{ kind: 'pan', forms: ['BNZPM2501F'], wholeWord: false }], measure);
    expect(areas).toHaveLength(1);
    expect(areas[0].ranges).toEqual([[4, 23]]);
    expect(areas[0].rects[0].x0).toBeLessThan(72 + 4 * 5);
  });

  it('wave 3, ruling C: a name broken by a hyphen across a page turn is placed on both pages (pageSeamPlaces), and not without the neighbour', () => {
    const at = (page: number, text: string) => ({ ...model(text), pageIndex: page });
    const first = at(0, 'Confirmation was received from Ramesh Ku-');
    const second = at(1, 'mar Gupta regarding the loan.');
    const targets = [{ kind: 'typed' as const, forms: ['Ramesh Kumar Gupta'], wholeWord: true }];
    expect(locatePlaces(first, targets, measure)).toHaveLength(0);
    const foot = locatePlaces(first, targets, measure, { next: second });
    const top = locatePlaces(second, targets, measure, { prev: first });
    expect(foot).toHaveLength(1);
    expect(top).toHaveLength(1);
    expect(first.text.slice(foot[0].ranges[0][0], foot[0].ranges[0][1])).toMatch(/^Ramesh Ku/);
    expect(second.text.slice(top[0].ranges[0][0], top[0].ranges[0][1])).toBe('mar Gupta');
    expect(foot[0].page).toBe(0);
    expect(top[0].page).toBe(1);
  });

  it('wave 4, J: the places of many chosen values on a page are worked out with a chance of a turn between the values, giving the same areas', async () => {
    const page = model('PAN B.N.Z.P.M.2.5.0.1.F and Ramesh Kumar Gupta of account 50100123456789 here');
    const targets = [
      { kind: 'pan' as const, forms: ['BNZPM2501F'], wholeWord: false },
      { kind: 'typed' as const, forms: ['Ramesh Kumar Gupta', 'RAMESH KUMAR GUPTA'], wholeWord: true },
      { kind: 'bank-account' as const, forms: ['50100123456789'], wholeWord: false },
    ];
    let asked = 0;
    const paced = await locatePlacesPaced(page, targets, measure, {}, () => {
      asked++;
      return undefined;
    });
    expect(paced).toEqual(locatePlaces(page, targets, measure));
    expect(paced.length).toBeGreaterThanOrEqual(3);
    expect(asked).toBeGreaterThanOrEqual(4);
  });

  it('wave 5, ruling S: a judge that asks many texts runs in turns, each answer worked out once, and its verdict is the same as at once', async () => {
    const texts = Array.from({ length: 30 }, (_, i) => `row ${i}${i % 7 === 0 ? ' Ramesh Kumar Gupta' : ''}`);
    const holds = (t: string) => t.includes('Ramesh');
    const spans = (t: string): [number, number][] => (t.includes('Ramesh') ? [[t.indexOf('Ramesh'), t.length]] : []);
    // Like flaggedOperations: every text asked, the places asked only of those that hold, and a joined text.
    const judge = (h: (t: string) => boolean, s: (t: string) => [number, number][]) => {
      const held = texts.filter(h).map((t) => [t, s(t)] as const);
      const joined = texts.join(' ');
      return { held, joined: h(joined) ? s(joined) : null };
    };
    let worked = 0;
    const slowHolds = (t: string) => {
      worked++;
      const until = performance.now() + 2;
      while (performance.now() < until);
      return holds(t);
    };
    let turns = 0;
    const verdict = await judgeInTurns(judge, { holds: slowHolds, spans }, () => {
      turns++;
      return undefined;
    }, undefined, 10);
    expect(verdict).toEqual(judge(holds, spans));
    expect(turns).toBeGreaterThan(3);
    expect(worked).toBe(31);
  });

  it('wave 5, ruling S: one value is placed with a chance of a turn between each reading of the page and each page turn (H33 held the window 0.9 s on one value), giving the same areas', async () => {
    const at = (page: number, text: string) => ({ ...model(text), pageIndex: page });
    const [first, second, third] = [at(0, 'Register page one for Ramesh Ku-'), at(1, 'mar Gupta and more here, then Ramesh Ku-'), at(2, 'mar Gupta again.')];
    const targets = [{ kind: 'typed' as const, forms: ['Ramesh Kumar Gupta'], wholeWord: true }];
    let asked = 0;
    const paced = await locatePlacesPaced(second, targets, measure, { prev: first, next: third }, () => {
      asked++;
      return undefined;
    });
    expect(paced).toEqual(locatePlaces(second, targets, measure, { prev: first, next: third }));
    expect(paced).toHaveLength(2);
    // Each of the page's own readings, then each page turn.
    expect(asked).toBeGreaterThanOrEqual(3);
  });

  it('wave 4, J: the reader-side check of a copied page gives the window a chance of a turn between its readings, and still finds the value', async () => {
    const page = model('Statement line one; account of Ramesh Kumar Gupta here');
    const reader = { pageTextContent: async () => ({ items: [], styles: {} }), pageGeometries: async () => [], pageAnnotationTexts: async () => [] } as unknown as Parameters<typeof readerHits>[5];
    let asked = 0;
    const pace = () => {
      asked++;
      return undefined;
    };
    const holds = (t: string) => /Ramesh Kumar Gupta/.test(t);
    const hits = await readerHits(new Uint8Array(), 1, new Set(), [page], holds, reader, undefined, undefined, pace);
    expect(hits).toEqual([{ pages: [0], elsewhere: [], drawn: true, remedy: 'find' }]);
    const none = await readerHits(new Uint8Array(), 1, new Set(), [page], () => false, reader, undefined, undefined, pace);
    expect(none).toEqual([]);
    expect(asked).toBeGreaterThanOrEqual(3);
  });

  it('a short number of a kind added in T-052 (8 digits or fewer) is a place only where no digit is joined to it; punctuation between its digits still counts', () => {
    // Inside an amount: not a place. Written with a space: a place.
    expect(loosePlaces('Total 1400001.00 paid; PIN 400 001 here', 'pin-code', '400001')).toEqual([{ start: 27, end: 34 }]);
    expect(loosePlaces('Cheque 123456 cleared, ref 91234567', 'cheque', '123456')).toEqual([{ start: 7, end: 13 }]);
    expect(loosePlaces('DIN 01234567 and 012345678', 'director-din', '01234567')).toEqual([{ start: 4, end: 12 }]);
    // An older kind keeps the old net: a MICR inside a longer run is still a place.
    expect(loosePlaces('ref 1123456789', 'micr', '123456789')).toEqual([{ start: 5, end: 14 }]);
  });

  it('finds words with anything but letters and digits between them, as whole words only', () => {
    expect(loosePlaces('Kestrel; Orchard and Kestrel-Orchards', 'typed', 'Kestrel Orchard')).toEqual([{ start: 0, end: 16 }]);
    expect(loosePlaces('an email r.kumar@ example.in here', 'email', 'r.kumar@example.in')).toEqual([{ start: 9, end: 28 }]);
    expect(loosePlaces('IP 10.0.0.12 and 10.0.0.1.', 'ip', '10.0.0.1')).toEqual([{ start: 17, end: 25 }]);
  });
});

describe('the proof hides what draws a value and nothing beside it (T-052 wave 2, ruling 6)', () => {
  const NAME = 'Ramesh Kumar Gupta';
  const holds = (s: string) => loosePlaces(s, 'typed', NAME).length > 0;
  const spans = (s: string) => loosePlaces(s, 'typed', NAME).map((p): [number, number] => [p.start, p.end]);
  const line = (y: number, s: string) => `BT /F1 9 Tf 40 ${y} Td (${s}) Tj ET`;
  const hidden = (cut: string, s: string) => new RegExp(`3 Tr \\(${s}\\) Tj`).test(cut);

  it('wave 4, ruling J: the paced reading of a long stream gives the window a turn between its shows and makes the same edit', async () => {
    // A printed report page: 300 lines, the name in some of them, one broken over two lines.
    const lines = Array.from({ length: 300 }, (_, k) => (k % 37 === 5 ? line(800 - k, `Confirmed by ${NAME} on file`) : k === 120 ? line(800 - k, 'Received from Ramesh Ku-') : k === 121 ? line(800 - k, 'mar Gupta today') : line(800 - k, `Ordinary narration line ${k}`)));
    const text = lines.join(' ');
    let asked = 0;
    const pace = () => {
      asked++;
      return undefined;
    };
    const paced = await proofEditPaced(text, holds, spans, new Set(), () => ({ texts: [] }), true, { strings: [], spans: [] }, pace);
    const once = proofEdit(text, holds, spans);
    expect(paced).toEqual(once);
    expect(once.changed).toBe(true);
    // Asked at least once a show (300 shows): no stretch longer than one show's reading between two chances.
    expect(asked).toBeGreaterThanOrEqual(300);
  }, 120_000);

  it('an ordinary line just before a line that holds the value is not hidden', () => {
    const edit = proofEdit(`${line(120, 'Employee code E1 UAN 102383876939')} ${line(100, `Signed by ${NAME}, Partner`)}`, holds, spans);
    expect(edit.changed).toBe(true);
    expect(edit.cut).toContain('Td (Employee code E1 UAN 102383876939) Tj');
    expect(hidden(edit.cut, 'Employee code E1 UAN 102383876939')).toBe(false);
    // The value's own characters are hidden, split out of its line.
    expect(edit.cut).toMatch(/3 Tr <[0-9a-f]+> Tj 0 Tr/);
  });

  it('the same in a stamp or form, where a string goes whole: only the string that holds the value', () => {
    const edit = proofEdit(`${line(30, 'TDS CELL')} ${line(18, `Checked by ${NAME}`)}`, holds, spans, new Set(), undefined, false);
    expect(hidden(edit.cut, 'TDS CELL')).toBe(false);
    expect(hidden(edit.cut, `Checked by ${NAME}`)).toBe(true);
  });

  it('a name wrapped over two lines is hidden in both, and the line before them is not', () => {
    const edit = proofEdit(`${line(140, 'Contact sheet')} ${line(120, 'Digitally signed by RAMESH')} ${line(100, 'KUMAR GUPTA')}`, holds, spans, new Set(), undefined, false);
    expect(hidden(edit.cut, 'Contact sheet')).toBe(false);
    expect(hidden(edit.cut, 'Digitally signed by RAMESH')).toBe(true);
    expect(hidden(edit.cut, 'KUMAR GUPTA')).toBe(true);
  });

  it("what RX-LIB's reading names goes from the cut copy: its strings' shows whole, its marked content cut, and it does not count as this reading's own find", () => {
    const text = `${line(120, 'Bullet text')} /Span <</MCID 4>> BDC ${line(100, 'Tagged words')} EMC ${line(80, 'Closing line')}`;
    const string = text.indexOf('(Bullet text)');
    const bdc = text.indexOf('BDC');
    const emcEnd = text.indexOf('EMC') + 3;
    const edit = proofEdit(text, holds, spans, new Set(), undefined, true, { strings: [[string, string + '(Bullet text)'.length]], spans: [[bdc, emcEnd]] });
    expect(edit.changed).toBe(false);
    expect(hidden(edit.cut, 'Bullet text')).toBe(true);
    expect(edit.cut).not.toContain('Tagged words');
    expect(hidden(edit.cut, 'Closing line')).toBe(false);
    expect(edit.base).toBe(text);
    // A sequence this tokenizer does not end at the same place: the shows inside it are made invisible.
    const off = proofEdit(text, holds, spans, new Set(), undefined, true, { strings: [], spans: [[bdc, emcEnd - 1]] });
    expect(hidden(off.cut, 'Tagged words')).toBe(true);
    expect(hidden(off.cut, 'Closing line')).toBe(false);
  });

  const hex = (s: string) => `<${Array.from(s, (c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('')}>`;
  /** The characters `s` are made invisible in `cut`, split out of their show (Tj or TJ). */
  const hiddenPart = (cut: string, s: string) => cut.includes(`3 Tr ${hex(s)} Tj`) || cut.includes(`3 Tr [${hex(s)}] TJ`);

  it('a second name that runs on from a line already holding one into the next line is hidden too, and only its characters', () => {
    const edit = proofEdit(`${line(120, `${NAME} and Ramesh`)} ${line(100, 'Kumar Gupta, Partner')} ${line(80, 'Closing line')}`, holds, spans);
    expect(hiddenPart(edit.cut, 'Ramesh')).toBe(true);
    expect(hiddenPart(edit.cut, 'Kumar Gupta')).toBe(true);
    expect(edit.cut).toContain(`${hex(', Partner')} Tj`);
    expect(edit.cut).not.toContain(`3 Tr ${hex(', Partner')}`);
    expect(hidden(edit.cut, 'Closing line')).toBe(false);
  });

  it('wave 3, ruling C: a name broken at a line end by a hyphen (or a soft hyphen) loses only its letters; a real hyphenated word is left', () => {
    for (const hyphen of ['-', '\\255']) {
      const edit = proofEdit(`BT /F1 10 Tf 60 700 Td (Received from Ramesh Ku${hyphen}) Tj 0 -12 Td (mar Gupta today) Tj ET`, holds, spans);
      // A soft hyphen is no character of the text (the loose rule drops it): it may go with the name.
      expect(hiddenPart(edit.cut, 'Ramesh Ku') || hiddenPart(edit.cut, 'Ramesh Ku\xad')).toBe(true);
      expect(hiddenPart(edit.cut, 'mar Gupta')).toBe(true);
      expect(edit.cut).toContain(`${hex('Received from ')} Tj`);
      expect(edit.cut).toContain(`${hex(' today')} Tj`);
    }
    // "Kumar-Gupta" written whole on one line is the loose rule's, not a broken word: unchanged behaviour.
    expect(proofEdit('BT /F1 10 Tf 60 700 Td (Co-operative) Tj 0 -12 Td (society) Tj ET', holds, spans).changed).toBe(false);
  });

  it('in page content a value split over two shows, or inside a kerned array, loses only its own characters (ruling 6: the words beside it stay)', () => {
    const PAN = 'BNZPM2501F';
    const holdsPan = (s: string) => loosePlaces(s, 'pan', PAN).length > 0;
    const spansPan = (s: string) => loosePlaces(s, 'pan', PAN).map((p): [number, number] => [p.start, p.end]);
    const two = proofEdit('BT /F1 10 Tf 72 670 Td (PAN: BNZPM) Tj (2501F, dated today) Tj ET', holdsPan, spansPan);
    expect(hiddenPart(two.cut, 'BNZPM')).toBe(true);
    expect(hiddenPart(two.cut, '2501F')).toBe(true);
    expect(two.cut).toContain(`${hex('PAN: ')} Tj`);
    expect(two.cut).toContain(`${hex(', dated today')} Tj`);
    expect(two.cut).not.toMatch(new RegExp(`3 Tr ${hex('PAN: ')}|3 Tr ${hex(', dated today')}`));
    // A kerned array: split into consecutive arrays at the cut's edges, numbers kept, in both copies.
    const kerned = proofEdit('BT /F1 10 Tf 72 640 Td [(PAN: BN) -120 (ZPM2) 80 (501F, dated)] TJ ET', holdsPan, spansPan);
    expect(kerned.base).toContain(`[${hex('PAN: ')}] TJ [${hex('BN')} -120 ${hex('ZPM2')} 80 ${hex('501F')}] TJ [${hex(', dated')}] TJ`);
    expect(kerned.cut).toContain(`[${hex('PAN: ')}] TJ 3 Tr [${hex('BN')} -120 ${hex('ZPM2')} 80 ${hex('501F')}] TJ 0 Tr [${hex(', dated')}] TJ`);
    // In a stamp or form the strings go whole, as before.
    expect(proofEdit('BT /F1 10 Tf 72 640 Td [(PAN: BN) -120 (ZPM2) 80 (501F, dated)] TJ ET', holdsPan, spansPan, new Set(), undefined, false).cut).toContain('3 Tr [(PAN: BN) -120 (ZPM2) 80 (501F, dated)] TJ 0 Tr');
  });
});
