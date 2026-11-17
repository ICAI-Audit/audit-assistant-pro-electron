import { describe, expect, it } from 'vitest';
import type { DisplayedPage } from '@/lib/pdf-tools/marks';
import { emptyPageBoxReport, PAPERS, PT_PER_MM } from '@/lib/pdf-tools/pageBox';
import {
  defaultPageBoxForm,
  edgeAnnouncement,
  frameOf,
  moveEdge,
  moveFrame,
  onePageOptions,
  pageBoxRecord,
  pageBoxResultName,
  pageBoxRunLabel,
  pageBoxRunNotes,
  pageSizeText,
  paperLabelOf,
  readPageBoxForm,
  cropSummary,
  resizeSummary,
  sameNote,
  shapeOf,
  sizeLabel,
  type PageBoxForm,
} from './pageBoxForm';

const letter: DisplayedPage = { box: { x: 0, y: 0, width: 612, height: 792 }, rotation: 0, unit: 1, width: 612, height: 792 };
const a4: DisplayedPage = { box: { x: 0, y: 0, width: 595.28, height: 841.89 }, rotation: 0, unit: 1, width: 595.28, height: 841.89 };
const receipt: DisplayedPage = { box: { x: 0, y: 0, width: 226.77, height: 340.16 }, rotation: 0, unit: 1, width: 226.77, height: 340.16 };
const shapes = [letter, a4, letter, receipt];
const form = (over: Partial<PageBoxForm> = {}): PageBoxForm => ({ ...defaultPageBoxForm(4), ...over });
const read = (over: Partial<PageBoxForm> = {}, withShapes: readonly DisplayedPage[] | null = shapes) => readPageBoxForm(form(over), { pageCount: 4, shapes: withShapes });

describe('the Resize or crop pages form', () => {
  it('starts on Resize to A4, each page keeping its direction, small pages kept at their size, no margin, all pages; trim edges 10 mm', () => {
    const f = defaultPageBoxForm(4);
    expect(f).toMatchObject({ mode: 'resize', paper: 'a4', direction: 'keep', enlarge: false, margin: 'none', cropKind: 'trim', mirror: false, pages: 'all', from: '1', to: '4' });
    expect(f.edges).toEqual({ left: '10', top: '10', right: '10', bottom: '10' });
    const r = read();
    expect(r.first).toBeNull();
    expect(r.options).toEqual({ mode: 'resize', size: { width: PAPERS.a4.width, height: PAPERS.a4.height }, direction: 'keep', enlarge: false, margin: 0, pages: { from: 1, to: 4 } });
    // One page is A4 already: three change.
    expect(r.counts).toEqual({ chosen: 4, change: 3, same: 1 });
    expect(pageBoxRunLabel(form(), r, 4)).toBe('Resize 3 pages to A4');
  });

  it('maps a custom size, a margin and the page range to points, and refuses what cannot work in the library\'s words', () => {
    const custom = read({ paper: 'custom', width: '200', height: '300', margin: 'other', marginMm: '12.5', pages: 'range', from: '2', to: '3' });
    expect(custom.options).toMatchObject({ size: { width: 200 * PT_PER_MM, height: 300 * PT_PER_MM }, margin: 12.5 * PT_PER_MM, pages: { from: 2, to: 3 } });
    expect(sizeLabel(form({ paper: 'custom', width: '200', height: '300' }))).toBe('200 × 300 mm');
    expect(paperLabelOf({ width: 200 * PT_PER_MM, height: 300 * PT_PER_MM })).toBe('200 × 300 mm');
    expect(paperLabelOf({ width: PAPERS.a4.height, height: PAPERS.a4.width })).toBe('A4');
    expect(paperLabelOf({ width: 612, height: 1008 })).toBe('Legal');
    expect(pageSizeText(612, 792)).toBe('216 × 279 mm (Letter)');
    expect(pageSizeText(PAPERS.a4.height, PAPERS.a4.width)).toBe('297 × 210 mm (A4 landscape)');
    expect(pageSizeText(226.77, 340.16)).toBe('80 × 120 mm');
    expect(read({ margin: 'normal' }).options).toMatchObject({ margin: 10 * PT_PER_MM });
    expect(read({ paper: 'custom', width: '5', height: '300' }).errors.size).toBe('Enter a width and height from 10 to 5,080 mm.');
    expect(read({ paper: 'custom', width: 'abc', height: '300' }).first).toBe('Enter a width and height from 10 to 5,080 mm.');
    expect(read({ margin: 'other', marginMm: '110' }).errors.margin).toBe('The margin leaves less than 10 mm for the page content. Use a smaller margin.');
    expect(read({ margin: 'other', marginMm: '' }).errors.margin).toBe('Enter a margin in millimetres, from 0 to 200.');
    expect(read({ pages: 'range', from: '3', to: '2' }).errors.pages).toBe('Enter a page range between 1 and 4, with the first page not after the last.');
  });

  it('says when nothing would change, and counts a margin as a change for every page', () => {
    const allA4 = readPageBoxForm(form({ pages: 'range', from: '2', to: '2' }), { pageCount: 4, shapes });
    expect(allA4.counts).toEqual({ chosen: 1, change: 0, same: 1 });
    expect(allA4.first).toBe('Page 2 is already A4. Choose another size, add a margin, or choose other pages.');
    expect(allA4.options).toBeNull();
    const many = readPageBoxForm(form({ paper: 'a4' }), { pageCount: 2, shapes: [a4, a4] });
    expect(many.first).toBe('All 2 chosen pages are already A4. Choose another size, add a margin, or choose other pages.');
    expect(read({ margin: 'narrow' }).counts).toEqual({ chosen: 4, change: 4, same: 0 });
    // Before the page sizes are known nothing is counted, and Run is not held back for it.
    const early = read({}, null);
    expect(early.counts).toBeNull();
    expect(early.options).not.toBeNull();
    expect(pageBoxRunLabel(form(), early, 4)).toBe('Resize 4 pages to A4');
  });

  it('crop: trims or adds margins in mm, checks every chosen page, and names the page that cannot take it', () => {
    const t = read({ mode: 'crop', edges: { left: '10', top: '5', right: '0', bottom: '', } });
    expect(t.options).toEqual({ mode: 'trim', sides: { left: 10 * PT_PER_MM, top: 5 * PT_PER_MM, right: 0, bottom: 0 }, mirror: false, pages: { from: 1, to: 4 } });
    expect(pageBoxRunLabel(form({ mode: 'crop' }), t, 4)).toBe('Trim 4 pages');
    expect(read({ mode: 'crop', edges: { left: '0', top: '0', right: '0', bottom: '0' } }).errors.edges).toBe('Enter how much to trim from at least one edge.');
    expect(read({ mode: 'crop', edges: { left: '-2', top: '0', right: '0', bottom: '0' } }).errors.edges).toBe('Enter each edge as a number of millimetres, 0 or more.');
    // The receipt (page 4, 80 mm wide) cannot lose 36 mm on each side.
    expect(read({ mode: 'crop', edges: { left: '36', top: '0', right: '36', bottom: '0' } }).errors.edges).toBe('Trimming that much leaves less than 10 mm of page 4. Use smaller values.');
    const m = read({ mode: 'crop', cropKind: 'margin', mirror: true, pages: 'range', from: '1', to: '1' });
    expect(m.options).toMatchObject({ mode: 'margin', mirror: true, pages: { from: 1, to: 1 } });
    expect(pageBoxRunLabel(form({ mode: 'crop', cropKind: 'margin', pages: 'range', from: '1', to: '1' }), m, 4)).toBe('Add margins to page 1');
    expect(read({ mode: 'crop', cropKind: 'margin', edges: { left: '600', top: '0', right: '0', bottom: '0' } }).errors.edges).toBe('Enter a margin of at most 500 mm on each edge.');
    expect(read({ mode: 'crop', cropKind: 'margin', edges: { left: '0', top: '0', right: '0', bottom: '0' } }).errors.edges).toBe('Enter the width of the margin for at least one edge.');
    expect(pageBoxRunLabel(form({ mode: 'crop' }), read({ mode: 'crop' }), 1)).toBe('Trim the page');
  });

  it('turns the pages\' read geometry into the page as displayed', () => {
    expect(shapeOf({ view: [0, 0, 612, 792], rotate: 90, userUnit: 1 })).toEqual({ box: { x: 0, y: 0, width: 612, height: 792 }, rotation: 90, unit: 1, width: 792, height: 612 });
    expect(shapeOf({ view: [100, 110, 564, 774], rotate: -90, userUnit: 2 })).toEqual({ box: { x: 100, y: 110, width: 464, height: 664 }, rotation: 270, unit: 2, width: 1328, height: 928 });
  });

  it('summarises the folded choices, names the result and words the Run button', () => {
    expect(resizeSummary(form())).toBe('Each page keeps its direction, small pages keep their size, no margin');
    expect(resizeSummary(form({ enlarge: true, margin: 'normal', direction: 'portrait' }))).toBe('All pages portrait, small pages enlarged to fit, 10 mm margin');
    expect(resizeSummary(form({ paper: 'custom', width: '200', height: '300', direction: 'landscape' }))).toBe('Own size 200 × 300 mm, all pages landscape, small pages keep their size, no margin');
    expect(cropSummary(form({ mode: 'crop' }))).toBe('The same on every page');
    expect(cropSummary(form({ mode: 'crop', mirror: true, cropKind: 'margin' }))).toBe('Left and right swapped on even pages, white space added instead of trimming');
    expect(sameNote({ same: 1 }, 'A4')).toBe('1 page is already A4 and stays as it is.');
    expect(sameNote({ same: 3 }, 'A4')).toBe('3 pages are already A4 and stay as they are.');
    expect(pageBoxResultName('Bundle.pdf', form())).toBe('Bundle_resized.pdf');
    expect(pageBoxResultName('Bundle.pdf', form({ mode: 'crop' }))).toBe('Bundle_cropped.pdf');
    expect(pageBoxResultName('Bundle.pdf', form({ mode: 'crop', cropKind: 'margin' }))).toBe('Bundle_with_margins.pdf');
    expect(pageBoxResultName('...pdf', form())).toBe('document_resized.pdf');
    expect(pageBoxRunLabel(form({ paper: 'letter', pages: 'range', from: '4', to: '4' }), read({ paper: 'letter', pages: 'range', from: '4', to: '4' }), 4)).toBe('Resize page 4 to Letter');
  });
});

describe('the crop frame', () => {
  const edges = { left: 10, top: 20, right: 30, bottom: 40 };

  it('places the frame in percent of the page as displayed, mirrored on even pages', () => {
    expect(frameOf(edges, letter, false, 1)).toEqual({ left: (10 * PT_PER_MM * 100) / 612, top: (20 * PT_PER_MM * 100) / 792, right: (30 * PT_PER_MM * 100) / 612, bottom: (40 * PT_PER_MM * 100) / 792 });
    expect(frameOf(edges, letter, true, 2).left).toBeCloseTo((30 * PT_PER_MM * 100) / 612, 9);
    expect(frameOf(edges, letter, true, 3).left).toBeCloseTo((10 * PT_PER_MM * 100) / 612, 9);
  });

  it('moves one edge by a number of mm, never past 10 mm from the opposite edge or out of the page, and writes the mirrored value on even pages', () => {
    expect(moveEdge(edges, 'left', 5, letter, false, 1)).toEqual({ ...edges, left: 15 });
    expect(moveEdge(edges, 'left', -50, letter, false, 1)).toEqual({ ...edges, left: 0 });
    // Letter is 215.9 mm wide: the left edge stops 10 mm before the right one (30 mm in).
    expect(moveEdge(edges, 'left', 500, letter, false, 1).left).toBeCloseTo(215.9 - 30 - 10, 1);
    // On an even page, mirrored, the displayed left edge is the stored right value.
    expect(moveEdge(edges, 'left', 5, letter, true, 2)).toEqual({ ...edges, right: 35 });
    // Values are kept to a tenth of a millimetre.
    expect(moveEdge(edges, 'top', 1.234, letter, false, 1).top).toBe(21.2);
  });

  it('moves the whole frame without changing its size, within the page', () => {
    expect(moveFrame(edges, 5, -5, false, 1)).toEqual({ left: 15, top: 15, right: 25, bottom: 45 });
    expect(moveFrame(edges, -50, 0, false, 1)).toEqual({ ...edges, left: 0, right: 40 });
    // Mirrored, on an even page: the displayed left is the stored right.
    expect(moveFrame(edges, 5, 0, true, 2)).toEqual({ ...edges, left: 5, right: 35 });
  });

  it('announces an edge in words', () => {
    expect(edgeAnnouncement('left', 12)).toBe('Left edge: 12 mm trimmed');
    expect(edgeAnnouncement('bottom', 0)).toBe('Bottom edge: not trimmed');
    expect(edgeAnnouncement('top', 7.5)).toBe('Top edge: 7.5 mm trimmed');
  });

  it('gives the preview the options of one page copied out: page 1 of the copy, mirrored as the real page is', () => {
    const t = read({ mode: 'crop', mirror: true, edges: { left: '10', top: '0', right: '30', bottom: '0' } }).options!;
    expect(onePageOptions(t, 2)).toEqual({ mode: 'trim', mirror: false, sides: { left: 30 * PT_PER_MM, top: 0, right: 10 * PT_PER_MM, bottom: 0 }, pages: { from: 1, to: 1 } });
    expect(onePageOptions(t, 3)).toMatchObject({ sides: { left: 10 * PT_PER_MM }, pages: { from: 1, to: 1 } });
    expect(onePageOptions(read().options!, 3)).toMatchObject({ mode: 'resize', pages: { from: 1, to: 1 } });
  });
});

describe('what a run says and records', () => {
  it('resize: pages changed and already that size; counts and choices only in the record', () => {
    const report = { ...emptyPageBoxReport(), changed: [1, 3, 4], unchanged: [2] };
    const options = read().options!;
    const said = pageBoxRunNotes(report, options, 'A4');
    expect(said.done).toBe('3 pages resized to A4; 1 was already A4 and is unchanged.');
    expect(said.notes).toEqual([]);
    const record = pageBoxRecord(options, report, 4, 'A4');
    expect(record.summary).toBe('Resized 3 pages to A4, 1 already A4');
    expect(record.options).toEqual({ mode: 'resize', size: 'A4', direction: 'keep', enlarge: false, marginMm: 0, pages: 'all', changed: 3, unchanged: 1, pagesToCheck: 0 });
  });

  it('trim and margins: the edges in mm, mirrored or not, and the reminder that trimmed parts are hidden', () => {
    const t = read({ mode: 'crop', mirror: true, edges: { left: '10', top: '5', right: '0', bottom: '0' }, pages: 'range', from: '2', to: '3' }).options!;
    const report = { ...emptyPageBoxReport(), changed: [2, 3] };
    expect(pageBoxRunNotes(report, t, '').done).toBe('2 pages trimmed; the trimmed parts are hidden, not removed.');
    const record = pageBoxRecord(t, report, 4, '');
    expect(record.summary).toBe('Trimmed 2 pages: left 10 mm, top 5 mm, mirrored on even pages');
    expect(record.options).toEqual({ mode: 'trim', leftMm: 10, topMm: 5, rightMm: 0, bottomMm: 0, mirror: true, pages: '2-3', changed: 2, pagesToCheck: 0 });
    const m = read({ mode: 'crop', cropKind: 'margin', edges: { left: '15', top: '15', right: '15', bottom: '15' } }).options!;
    expect(pageBoxRunNotes({ ...emptyPageBoxReport(), changed: [1] }, m, '').done).toBe('Margins added to 1 page.');
    expect(pageBoxRecord(m, { ...emptyPageBoxReport(), changed: [1, 2, 3, 4] }, 4, '').summary).toBe('Added margins to 4 pages: 15 mm on every edge');
  });

  it('keeps and flags what could not be done exactly, each note one short sentence saying what to do and why', () => {
    const report = { ...emptyPageBoxReport(), changed: [1, 2, 3], damaged: [2], unverified: [3], approximate: [1], hiddenAnnotations: [1, 2] };
    const said = pageBoxRunNotes(report, read().options!, 'A4');
    expect(said.notes).toEqual([
      'Check pages 2-3: their content could not be read exactly, so they may look different.',
      'Check page 1: a comment or measurement on it may not have resized exactly.',
      'On pages 1-2 a link, comment or form field is now in the trimmed part, hidden but still in the file.',
    ]);
    for (const note of said.notes) expect(note.split(/(?<=\.)\s/).length).toBe(1);
    expect(pageBoxRunNotes({ ...report, damaged: [], unverified: [4], approximate: [] }, read().options!, 'A4').notes[0]).toBe('Check page 4: its content could not be read exactly, so it may look different.');
    const record = pageBoxRecord(read().options!, report, 4, 'A4');
    expect(record.summary).toBe('Resized 3 pages to A4; 3 pages to check');
    expect(record.options.pagesToCheck).toBe(3);
  });
});
