// Redact's find through the renderer (plan A9 redactFindRun): pages read with progress and Stop, text from
// the enlarged-view copy with each page's own visible box, proposals with every occurrence of the values
// chosen at once, possibles expanded only when ticked, and a typed word searched again without reading.
import { PDFDocument, PDFName, StandardFonts } from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { REDACT_GROUPS, type RedactGroup } from '@/lib/pdf-tools/redactPatterns';
import { makePositionsPdf, OUTSIDE_PAN, PAN } from '@/lib/pdf-tools/testRedactPdf';
import { enlargedViewCopy } from '@/lib/pdf-tools/pageText';
import { everyOccurrence } from '@/lib/pdf-tools/redactFind';
import { RenderTimeoutError } from '../renderQueue';
import { ALL_GROUPS, enlargedCopyInTurns, everyOccurrenceInTurns, expandValue, findInFile, findInModels, FindStopped, type FindReader } from './redactFindRun';
import { initialReview, reviewReducer, type ReviewProfile } from './reviewState';
import { nodeEnv, type NodeEnv } from './testRedactRun';

vi.setConfig({ testTimeout: 120_000 });

let env: NodeEnv;
let positions: Uint8Array;
beforeAll(async () => {
  env = await nodeEnv();
  positions = (await makePositionsPdf()).bytes;
}, 120_000);
afterAll(async () => {
  await env?.close();
});

const base = () => ({ signal: new AbortController().signal, live: () => true, onProgress: () => undefined, terms: [], measure: env.measure });

/** An invented payment card number: 15 digits and the Luhn check digit. */
function luhnCard(first15: string): string {
  let sum = 0;
  for (let i = 0; i < 15; i++) {
    let d = Number(first15[14 - i]);
    if (i % 2 === 0) d = d * 2 > 9 ? d * 2 - 9 : d * 2;
    sum += d;
  }
  const digits = first15 + String((10 - (sum % 10)) % 10);
  return digits.replace(/(\d{4})(?=\d)/g, '$1 ');
}

describe('every group of data reaches the find (RX-PAT widened the groups, T-048)', () => {
  it('ALL_GROUPS is every group the patterns know; a card, a CIN and a UAN are proposed; Business is ticked by no profile, DPDP ticks the UAN', async () => {
    expect([...ALL_GROUPS].sort()).toEqual([...REDACT_GROUPS].sort());
    const card = luhnCard('453201511283036');
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([595, 842]);
    [`Card No. ${card}`, 'CIN U72900MH2015PTC123456', 'UAN 100123456789', 'Ordinary closing words'].forEach((line, i) => page.drawText(line, { x: 60, y: 780 - i * 24, size: 11, font }));
    const found = await findInFile(await doc.save(), { ...base(), reader: env.renderer });
    const kinds = new Set(found.proposals.map((p) => p.kind));
    for (const kind of ['card', 'cin', 'uan'] as const) expect(kinds.has(kind), kind).toBe(true);
    const ticked = (profile: ReviewProfile, groups?: RedactGroup[]) => {
      let state = reviewReducer(initialReview(profile), { type: 'loaded', proposals: found.proposals, held: found.held });
      for (const group of groups ?? []) state = reviewReducer(state, { type: 'tick-group', group, on: true });
      return new Set(state.proposals.filter((p) => state.ticked[p.id]).map((p) => p.kind));
    };
    expect(ticked('balanced').has('card')).toBe(true);
    for (const profile of ['balanced', 'strict', 'identity', 'dpdp'] as const) expect(ticked(profile).has('cin'), profile).toBe(false);
    expect(ticked('balanced', ['business']).has('cin')).toBe(true);
    expect(ticked('dpdp').has('uan')).toBe(true);
    expect(ticked('balanced').has('uan')).toBe(false);
  });
});

describe('findInFile', () => {
  it('reads every page with progress, keeps each page\'s own visible box, and finds text outside the crop box', async () => {
    const progress: number[] = [];
    const found = await findInFile(positions, { ...base(), reader: env.renderer, onProgress: (p) => progress.push(p.done) });
    expect(found.models).toHaveLength(5);
    expect(found.models[4].view).toEqual([36, 36, 400, 700]);
    expect(found.models[1].rotate).toBe(90);
    expect(progress[progress.length - 1]).toBe(10); // 5 pages of annotations, 5 of text
    expect(found.proposals.some((p) => p.key === PAN && p.page === 3)).toBe(true);
    const outside = found.proposals.find((p) => p.key === OUTSIDE_PAN);
    expect(outside?.outsideView).toBe(true);
    expect(outside?.hidden).toBe(true);
    expect(found.pagesWithoutText).toEqual([]);
  });

  it('stops quietly on Stop and when the scope moves on', async () => {
    const controller = new AbortController();
    const stopped = findInFile(positions, { ...base(), reader: env.renderer, signal: controller.signal, onProgress: (p) => p.done === 3 && controller.abort() });
    await expect(stopped).rejects.toBeInstanceOf(FindStopped);
    let live = true;
    const moved = findInFile(positions, { ...base(), reader: env.renderer, live: () => live, onProgress: (p) => (live = p.done < 2) });
    await expect(moved).rejects.toBeInstanceOf(FindStopped);
  });

  it('a page that is only a picture has no text: listed so the dialog can say only drawn boxes work there', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    doc.addPage([300, 300]).drawText('Some text', { x: 20, y: 200, size: 12, font });
    const blank = doc.addPage([300, 300]);
    blank.node.set(PDFName.of('Contents'), doc.context.register(doc.context.flateStream('0 0 1 rg 10 10 100 100 re f')));
    const found = await findInFile(await doc.save(), { ...base(), reader: env.renderer });
    expect(found.pagesWithoutText).toEqual([1]);
  });
});

describe('findInModels', () => {
  it('searches a typed word again without reading the file', async () => {
    const found = await findInFile(positions, { ...base(), reader: env.renderer });
    const calls = env.calls.pageTextContent;
    const again = await findInModels(found, [{ text: 'assessee', reason: 'Typed' }], env.measure);
    expect(env.calls.pageTextContent).toBe(calls);
    expect(again.proposals.filter((p) => p.kind === 'typed').length).toBeGreaterThanOrEqual(5);
  });

  it('pauses between slices of pages on a long file (the window stays responsive)', async () => {
    const found = await findInFile(positions, { ...base(), reader: env.renderer });
    const long = { ...found, models: Array.from({ length: 30 }, (_, i) => ({ ...found.models[i % 5], pageIndex: i })), annotations: Array.from({ length: 30 }, () => []), geometries: Array.from({ length: 30 }, (_, i) => found.geometries[i % 5]) };
    let pauses = 0;
    // Wave 6 (T-048): turns come by the clock; with no time between them every chance is taken.
    await findInModels(
      long,
      [],
      env.measure,
      async () => {
        pauses++;
      },
      0,
    );
    expect(pauses).toBeGreaterThanOrEqual(30);
  });

  it('wave 6 (T-048): the whole find gives the window a chance of a turn at every page (models, page search, every value), and finds the same', async () => {
    const plain = await findInFile(positions, { ...base(), reader: env.renderer, terms: [{ text: 'assessee', reason: 'Typed' }] });
    let pauses = 0;
    const paced = await findInFile(positions, {
      ...base(),
      reader: env.renderer,
      terms: [{ text: 'assessee', reason: 'Typed' }],
      pause: async () => {
        pauses++;
      },
      turnEveryMs: 0,
    });
    const ids = (r: { proposals: { id: string }[] }) => r.proposals.map((p) => p.id).sort();
    expect(ids(paced)).toEqual(ids(plain));
    expect(paced.models.map((m) => m.text)).toEqual(plain.models.map((m) => m.text));
    // Five pages: five models, five page searches, and at least one piece for each value searched everywhere.
    expect(pauses).toBeGreaterThanOrEqual(11);
  });

  it('wave 6 (T-048): every other place of a value is searched a few pages at a time, over a page turn too, and gives exactly the places of one search over every page', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const lines = [
      ['Account holder Ramesh Kumar Gupta', 'Statement of account'],
      ['Opening balance carried', 'Confirmation was received from Ramesh Ku-'],
      ['mar Gupta regarding the loan', 'Closing balance'],
      ['Nominee: none', 'Signed for Ramesh Kumar Gupta'],
      ['Nothing here', 'Ramesh Kumar Gupta once more'],
    ];
    for (const [top, bottom] of lines) {
      const page = doc.addPage([400, 300]);
      page.drawText(top, { x: 20, y: 260, size: 12, font });
      page.drawText(bottom, { x: 20, y: 30, size: 12, font });
    }
    const found = await findInFile(await doc.save(), { ...base(), reader: env.renderer, terms: [{ text: 'Ramesh Kumar Gupta', reason: 'Typed' }] });
    const first = found.proposals.filter((p) => p.kind === 'typed' && p.page === 0);
    expect(first.length).toBeGreaterThan(0);
    const atOnce = everyOccurrence(found.models, first, env.measure, found.annotations);
    let turns = 0;
    const inTurns = await everyOccurrenceInTurns(found, first, env.measure, () => {
      turns++;
      return undefined;
    });
    expect(inTurns.map((p) => p.id).sort()).toEqual(atOnce.map((p) => p.id).sort());
    expect(new Set(atOnce.map((p) => p.page)).size).toBeGreaterThanOrEqual(4);
    expect(turns).toBeGreaterThanOrEqual(1);
  });

  it('wave 6 (T-048, ruling Q): a typed word whose only mention is broken by the page end gets a place on both pages', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const one = doc.addPage([400, 300]);
    one.drawText('Statement of account', { x: 20, y: 260, size: 12, font });
    one.drawText('Confirmation was received from Ramesh Ku-', { x: 20, y: 30, size: 12, font });
    const two = doc.addPage([400, 300]);
    two.drawText('mar Gupta regarding the loan', { x: 20, y: 260, size: 12, font });
    const found = await findInFile(await doc.save(), { ...base(), reader: env.renderer, terms: [{ text: 'Ramesh Kumar Gupta', reason: 'Typed' }] });
    const typed = found.proposals.filter((p) => p.kind === 'typed');
    expect(typed.map((p) => p.page).sort()).toEqual([0, 1]);
    expect(typed.every((p) => p.confidence === 'sure')).toBe(true);
  });

  it('wave 6 (T-048): the enlarged-view copy is read and written in turns, byte for byte the library\'s own', async () => {
    const own = await enlargedViewCopy(positions);
    const paced = await enlargedCopyInTurns(positions, () => undefined);
    expect(Buffer.from(paced).equals(Buffer.from(own))).toBe(true);
    await expect(enlargedCopyInTurns(new TextEncoder().encode('not a pdf'), () => undefined)).rejects.toMatchObject({ code: 'redact-find-failed' });
  });

  it('wave 6 (T-048): a read the busy renderer could not finish is tried again; if it never can, the find says the computer was busy, not that the file may be damaged', async () => {
    let fails = 2;
    const flaky: FindReader = {
      ...env.renderer,
      pageGeometries: (file, options) => (fails-- > 0 ? Promise.reject(new RenderTimeoutError()) : env.renderer.pageGeometries(file, options)),
    };
    const found = await findInFile(positions, { ...base(), reader: flaky });
    expect(found.models).toHaveLength(5);
    const busy: FindReader = { ...env.renderer, pageTextContent: () => Promise.reject(new RenderTimeoutError()) };
    const error = (await findInFile(positions, { ...base(), reader: busy }).catch((e: unknown) => e)) as Error;
    expect(error.message).toBe('The computer was too busy to search this file. Close other programs, then search again.');
    expect(error.message).not.toMatch(/damaged/);
  });

  it('a value that is only possible is expanded when ticked, not at once', async () => {
    // "BNZPK..." with an O as its fourth letter: a PAN-shaped code that is only possible.
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    doc.addPage([400, 300]).drawText('Code BNZOM2501F here', { x: 20, y: 200, size: 12, font });
    doc.addPage([400, 300]).drawText('Again BNZOM-2501-F there', { x: 20, y: 200, size: 12, font });
    const found = await findInFile(await doc.save(), { ...base(), reader: env.renderer });
    const places = found.proposals.filter((p) => p.key === 'BNZOM2501F');
    expect(places.length).toBeGreaterThanOrEqual(1);
    expect(places.every((p) => p.confidence === 'possible')).toBe(true);
    const known = new Set(found.proposals.map((p) => p.id));
    const extra = expandValue(found, places, known, env.measure);
    expect(extra.every((p) => !known.has(p.id) && p.key === 'BNZOM2501F')).toBe(true);
    expect(places.length + extra.length).toBe(2);
  });
});
