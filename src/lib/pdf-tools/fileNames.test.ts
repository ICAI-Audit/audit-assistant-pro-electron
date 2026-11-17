import { describe, expect, it, vi } from 'vitest';
import { cleanFileName, cutMiddle, pageImageName, partName, stripExtension } from './fileNames';

// One property-style test takes most of a second on a loaded machine; the default 5 s is too close.
vi.setConfig({ testTimeout: 20_000 });

describe('cleanFileName', () => {
  it('replaces illegal characters and separators', () => {
    expect(cleanFileName('a:b*c?d"e<f>g|h/i\\j', 'pdf')).toBe('a_b_c_d_e_f_g_h_i_j.pdf');
  });
  it('replaces control characters', () => {
    expect(cleanFileName('a\u0000b\u0007c\u001fd\u007fe\nf', 'pdf')).toBe('a_b_c_d_e_f.pdf');
  });
  it('replaces the line and paragraph separators', () => {
    expect(cleanFileName('a\u2028b\u2029c.pdf', 'pdf')).toBe('a_b_c.pdf');
  });
  it('normalises the extension', () => {
    expect(cleanFileName('report.PDF', 'pdf')).toBe('report.pdf');
    expect(cleanFileName('report', 'pdf')).toBe('report.pdf');
  });
  it('trims leading and trailing dots and spaces', () => {
    expect(cleanFileName('name. . ', 'pdf')).toBe('name.pdf');
    expect(cleanFileName('  ..name', 'pdf')).toBe('name.pdf');
    expect(cleanFileName('name.pdf. ', 'pdf')).toBe('name.pdf');
  });
  it('falls back to "document" for empty or all-illegal names', () => {
    expect(cleanFileName('', 'pdf')).toBe('document.pdf');
    expect(cleanFileName('...', 'pdf')).toBe('document.pdf');
    expect(cleanFileName('   ', 'pdf')).toBe('document.pdf');
    expect(cleanFileName('.pdf', 'pdf')).toBe('document.pdf');
    expect(cleanFileName('???', 'pdf')).toBe('___.pdf');
  });
  it('avoids Windows reserved names', () => {
    expect(cleanFileName('CON.pdf', 'pdf')).toBe('CON_.pdf');
    for (const n of ['con', 'PRN', 'Aux', 'NUL', 'COM1', 'com9', 'LPT1', 'lpt9']) {
      expect(cleanFileName(n, 'pdf')).toBe(`${n}_.pdf`);
    }
    expect(cleanFileName('CONSOLE', 'pdf')).toBe('CONSOLE.pdf');
    expect(cleanFileName('COM10', 'pdf')).toBe('COM10.pdf');
  });
  it('keeps non-Latin text', () => {
    expect(cleanFileName('बैंक विवरण', 'pdf')).toBe('बैंक विवरण.pdf');
    expect(cleanFileName('बैंक विवरण.pdf', 'pdf')).toBe('बैंक विवरण.pdf');
  });
  it('caps the total length at 120 characters', () => {
    expect(cleanFileName('x'.repeat(300), 'pdf')).toHaveLength(120);
    // A long name keeps its start and its end; the middle is cut (QA-FIX G).
    expect(cleanFileName('x'.repeat(300), 'pdf')).toBe(`${'x'.repeat(58)}…${'x'.repeat(57)}.pdf`);
    expect(cleanFileName('x'.repeat(116), 'pdf')).toBe(`${'x'.repeat(116)}.pdf`);
    expect(cleanFileName('x'.repeat(120), 'png')).toHaveLength(120);
    expect(cleanFileName('ब'.repeat(200), 'pdf').length).toBeLessThanOrEqual(120);
  });
  it('does not leave dots or spaces at the cut or at the end', () => {
    // The cut falls on the dots and spaces: they go, on both sides of it.
    const out = cleanFileName(`${'x'.repeat(56)}. . . .${'y'.repeat(70)}. `, 'pdf');
    expect(out).toBe(`${'x'.repeat(56)}…${'y'.repeat(57)}.pdf`);
  });
  it('keeps reserved-name handling inside the 120 limit', () => {
    expect(cleanFileName('CON.backup', 'pdf')).toBe('CON_.backup.pdf');
    expect(cleanFileName('CON.' + 'x'.repeat(200), 'pdf').length).toBeLessThanOrEqual(120);
    expect(cleanFileName('aux.' + 'y'.repeat(113) + ' .z', 'pdf').length).toBeLessThanOrEqual(120);
    const out = cleanFileName('NUL.' + 'z'.repeat(300), 'pdf');
    expect(out.length).toBeLessThanOrEqual(120);
    expect(out.startsWith('NUL_.')).toBe(true);
  });
  it('does not let a reserved name reappear after trimming', () => {
    // A middle cut keeps the end, so these are no longer only "CON" (QA-FIX G); the start that stays is
    // still never a reserved name on its own.
    expect(cleanFileName('CON' + ' '.repeat(200) + '.x', 'pdf')).toBe('CON…x.pdf');
    expect(cleanFileName('CON' + ' '.repeat(200) + 'y', 'pdf')).toBe('CON…y.pdf');
    expect(cleanFileName('CON' + ' '.repeat(113) + '_xxxxx', 'pdf')).toBe('CON…_xxxxx.pdf');
    expect(cleanFileName('CON' + ' '.repeat(200) + '.', 'pdf')).toBe('CON_.pdf');
  });
  it('keeps both invariants for generated hostile names', () => {
    const reserved = ['CON', 'PRN', 'AUX', 'NUL', 'COM1', 'COM9', 'LPT1', 'LPT9', 'con', 'Nul'];
    const tails = [' ', '.', 'x', ' .', '. ', '_', '.x', ' y'];
    const lengths = [0, 1, 110, 113, 114, 115, 116, 117, 118, 119, 120, 121, 125, 300];
    for (const r of reserved) {
      for (const tail of tails) {
        for (const len of lengths) {
          const input = r + tail.repeat(len);
          for (const candidate of [input, input + '.x', input + '.pdf']) {
            const out = cleanFileName(candidate, 'pdf');
            expect(out.length).toBeLessThanOrEqual(120);
            const stem = out.split('.')[0].trimEnd();
            expect(stem).not.toMatch(/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i);
          }
        }
      }
    }
    // 3,360 names: 8-13 s on a loaded machine, more than half the file's 20 s. A hang guard only.
  }, 60_000);
  it('handles a long name ending in .PDF', () => {
    const out = cleanFileName('x'.repeat(300) + '.PDF', 'pdf');
    expect(out).toBe(`${'x'.repeat(58)}…${'x'.repeat(57)}.pdf`);
  });
  it('replaces lone surrogates but keeps paired ones', () => {
    expect(cleanFileName('a\uD800b', 'pdf')).toBe('a_b.pdf');
    expect(cleanFileName('a\uDC00b', 'pdf')).toBe('a_b.pdf');
    expect(cleanFileName('a\uD800', 'pdf')).toBe('a_.pdf');
    expect(cleanFileName('a\u{1F600}b', 'pdf')).toBe('a\u{1F600}b.pdf');
  });
  it('never splits an emoji at the cut', () => {
    // The emoji sits where the head ends, then where the tail starts.
    for (const input of ['x'.repeat(57) + '\u{1F600}' + 'y'.repeat(100), 'x'.repeat(100) + '\u{1F600}' + 'y'.repeat(56)]) {
      const out = cleanFileName(input, 'pdf');
      expect(out.length).toBeLessThanOrEqual(120);
      expect(out.replace(/\u{1F600}/gu, '')).not.toMatch(/[\uD800-\uDFFF]/);
    }
  });
  it('stays safe for a long hostile name', () => {
    const out = cleanFileName(`..${'a/b:c*'.repeat(40)}  `, 'pdf');
    expect(out.length).toBeLessThanOrEqual(120);
    // Built from code points so the pattern holds no control characters.
    const illegal = new RegExp(`[\\\\/:*?"<>|${String.fromCharCode(0)}-${String.fromCharCode(0x1f)}]`);
    expect(out).not.toMatch(illegal);
    expect(out.endsWith('.pdf')).toBe(true);
  });
});

describe('stripExtension', () => {
  it('removes only the last extension', () => {
    expect(stripExtension('report.pdf')).toBe('report');
    expect(stripExtension('a.b.pdf')).toBe('a.b');
    expect(stripExtension('noext')).toBe('noext');
    expect(stripExtension('.hidden')).toBe('.hidden');
  });
});

describe('part and page names', () => {
  it('pads part numbers to the width of the total, minimum two', () => {
    expect(partName('stmt', 2, 12)).toBe('stmt_part_02.pdf');
    expect(partName('stmt', 7, 120)).toBe('stmt_part_007.pdf');
  });
  it('pads page numbers to at least three digits', () => {
    expect(pageImageName('stmt', 3, 40, 'png')).toBe('stmt_page_003.png');
    expect(pageImageName('stmt', 12, 1200, 'jpg')).toBe('stmt_page_0012.jpg');
  });
  it('shortens a 200-character stem, never the number or the extension, and keeps names unique', () => {
    const stem = 'x'.repeat(200);
    const parts = Array.from({ length: 150 }, (_, i) => partName(stem, i + 1, 150));
    for (const [i, name] of parts.entries()) {
      expect(name.length).toBeLessThanOrEqual(120);
      expect(name.endsWith(`_part_${String(i + 1).padStart(3, '0')}.pdf`)).toBe(true);
    }
    expect(new Set(parts).size).toBe(150);
    const images = Array.from({ length: 1200 }, (_, i) => pageImageName(stem, i + 1, 1200, 'jpg'));
    for (const [i, name] of images.entries()) {
      expect(name.length).toBeLessThanOrEqual(120);
      expect(name.endsWith(`_page_${String(i + 1).padStart(4, '0')}.jpg`)).toBe(true);
    }
    expect(new Set(images).size).toBe(1200);
  });
  it('falls back to the usual stem for an empty or dots-only name', () => {
    expect(partName('', 1, 3)).toBe('document_part_01.pdf');
    expect(partName(' . ', 2, 3)).toBe('document_part_02.pdf');
    expect(pageImageName('', 1, 3, 'png')).toBe('document_page_001.png');
  });
  it('keeps the name valid after the cut: no trailing dot or space, no split emoji', () => {
    // 108 characters fit before "_part_01.pdf"; the cut falls right after the dots and spaces
    expect(partName(`${'x'.repeat(103)}. . .${'y'.repeat(50)}`, 1, 2)).toBe(`${'x'.repeat(54)}…${'y'.repeat(50)}_part_01.pdf`);
    const emoji = pageImageName(`${'x'.repeat(53)}\u{1F600}${'y'.repeat(60)}tail`, 1, 5, 'png');
    expect(emoji.endsWith('tail_page_001.png')).toBe(true);
    expect(emoji).not.toMatch(/[\uD800-\uDFFF]/);
  });
});

describe('cutMiddle (QA-FIX G: a long name keeps its end)', () => {
  it('leaves a name that fits alone', () => {
    expect(cutMiddle('Bank statement', 20)).toBe('Bank statement');
  });
  it('keeps the start and the end, with one "…" in the middle', () => {
    const name = 'Synthetic M-s Gamma Traders Private Limited - Tax Audit Report u-s 44AB - Form 3CA 3CD with Annexures for AY 2025-26 - final copy v3 revised';
    const cut = cutMiddle(name, 106);
    expect(cut.length).toBeLessThanOrEqual(106);
    expect(cut.startsWith('Synthetic M-s Gamma Traders')).toBe(true);
    expect(cut.endsWith('AY 2025-26 - final copy v3 revised')).toBe(true);
    expect(cut.match(/…/g)).toHaveLength(1);
  });
  it('cuts again at the same place, never adding a second "…"', () => {
    const once = cutMiddle('a'.repeat(100) + 'b'.repeat(100), 120);
    const twice = cutMiddle(once, 110);
    expect(twice).toHaveLength(110);
    expect(twice.match(/…/g)).toHaveLength(1);
    expect(twice.endsWith('b'.repeat(59))).toBe(true);
  });
});
