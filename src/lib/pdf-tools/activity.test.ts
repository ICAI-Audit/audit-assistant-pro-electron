import { describe, expect, it } from 'vitest';
import { buildActivityEntry } from './activity';
import { PdfToolsError, type WorkingFile } from './types';

// Built from code points so the pattern holds no literal control characters.
const UNSAFE_RANGES: [number, number][] = [
  [0x00, 0x1f], [0x7f, 0x9f], [0x61c, 0x61c], [0x200b, 0x200f], [0x2028, 0x2029], [0x202a, 0x202e], [0x2066, 0x2069],
];
const UNSAFE = new RegExp(`[${UNSAFE_RANGES.map(([a, b]) => `${String.fromCharCode(a)}-${String.fromCharCode(b)}`).join('')}]`);

function result(over: Partial<WorkingFile> = {}): WorkingFile {
  return {
    id: 'r1',
    name: 'A_merged.pdf',
    kind: 'pdf',
    mimeType: 'application/pdf',
    origin: 'result',
    bytes: new Uint8Array([1, 2, 3]),
    size: 3,
    pageCount: 5,
    wasProtected: false,
    hasRestrictions: false,
    hasSignature: false,
    sentTo: [],
    operation: {
      tool: 'merge',
      summary: 'Merged 2 files',
      sources: [
        { name: 'A.pdf', origin: 'computer' },
        { name: 'B.pdf', origin: 'vault', evidenceId: 'ev0' },
      ],
      options: {},
    },
    ...over,
  };
}
const SHA = 'ab'.repeat(32);

describe('buildActivityEntry', () => {
  it('builds the vault entry exactly as specified', () => {
    const e = buildActivityEntry({ file: result(), destination: 'vault', sha256: SHA, vaultRecordId: 'ev1' });
    expect(e.action).toBe('Added to Evidence Vault');
    expect(e.entity).toBe('PDF Tools');
    expect(e.details).toBe(
      'Merged 2 files → A_merged.pdf (5 pages, SHA-256 abababababab…). Sources: A.pdf [computer]; B.pdf [vault]. Destination: Evidence Vault.',
    );
    expect(e.metadata).toMatchObject({
      tool: 'merge',
      resultName: 'A_merged.pdf',
      pageCount: 5,
      size: 3,
      sha256: SHA,
      destination: 'vault',
      vaultRecordId: 'ev1',
      sources: [
        { name: 'A.pdf', origin: 'computer' },
        { name: 'B.pdf', origin: 'vault', evidenceId: 'ev0' },
      ],
    });
    expect(JSON.stringify(e)).not.toMatch(/password/i);
    expect(JSON.parse(JSON.stringify(e))).toEqual(e);
  });

  it('uses the other action names and destination texts', () => {
    const c = buildActivityEntry({ file: result(), destination: 'computer', sha256: SHA });
    expect(c.action).toBe('Saved to computer');
    expect(c.details.endsWith('Destination: Computer.')).toBe(true);
    expect(c.metadata).not.toHaveProperty('vaultRecordId');
    expect(c.metadata).not.toHaveProperty('workingPaper');
    const w = buildActivityEntry({
      file: result(),
      destination: 'working-paper',
      sha256: SHA,
      vaultRecordId: 'ev1',
      workingPaper: { programName: 'Synthetic Sales programme', sectionName: 'Cut-off', boxHeader: 'Box 3' },
    });
    expect(w.action).toBe('Attached to working paper');
    expect(w.details.endsWith('Destination: Working paper Synthetic Sales programme, section Cut-off, box Box 3.')).toBe(true);
    expect(w.metadata.workingPaper).toEqual({ programName: 'Synthetic Sales programme', sectionName: 'Cut-off', boxHeader: 'Box 3' });
    const p = buildActivityEntry({ file: result(), destination: 'working-paper', sha256: SHA, workingPaper: { programName: 'P' } });
    expect(p.details.endsWith('Destination: Working paper P.')).toBe(true);
  });

  it('says "1 page" for a single page and omits the clause when the count is unknown', () => {
    const one = buildActivityEntry({ file: result({ pageCount: 1 }), destination: 'computer', sha256: SHA });
    expect(one.details).toContain('(1 page, SHA-256 abababababab…)');
    const none = buildActivityEntry({ file: result({ pageCount: null }), destination: 'computer', sha256: SHA });
    expect(none.details).toContain('A_merged.pdf (SHA-256 abababababab…).');
    expect(none.metadata.pageCount).toBeNull();
  });

  it('abbreviates a very long source list in the details but keeps all in metadata', () => {
    const sources = Array.from({ length: 40 }, (_, i) => ({ name: `Synthetic file ${i + 1}.pdf`, origin: 'computer' as const }));
    const e = buildActivityEntry({
      file: result({ operation: { tool: 'merge', summary: 'Merged 40 files', sources, options: {} } }),
      destination: 'computer',
      sha256: SHA,
    });
    expect(e.details).toContain('Synthetic file 1.pdf [computer]');
    expect(e.details).not.toContain('Synthetic file 40.pdf');
    expect(e.details).toMatch(/and 30 more/);
    expect(e.details.length).toBeLessThan(1500);
    expect((e.metadata.sources as unknown[]).length).toBe(40);
  });

  it('truncates very long names in the details', () => {
    const long = `${'x'.repeat(300)}.pdf`;
    const e = buildActivityEntry({ file: result({ name: long }), destination: 'computer', sha256: SHA });
    expect(e.details).not.toContain('x'.repeat(150));
    expect(e.details).toContain('…');
  });

  it('never carries a password, bytes or an absolute local path', () => {
    const e = buildActivityEntry({
      file: result({
        name: 'C:\\Users\\Someone\\Desktop\\Synthetic out.pdf',
        operation: {
          tool: 'merge',
          summary: 'Unlocked',
          sources: [{ name: '/home/someone/docs/Synthetic in.pdf', origin: 'computer' }],
          options: { password: 'hunter2', Passphrase: 'x', level: 'Recommended', pages: 3 },
        },
      }),
      destination: 'computer',
      sha256: SHA,
    });
    const text = JSON.stringify(e);
    expect(text).not.toMatch(/hunter2|password|passphrase/i);
    expect(text).not.toMatch(/Users|home|Desktop|[A-Z]:\\|\/docs/);
    expect(text).toContain('Synthetic out.pdf');
    expect(text).toContain('Synthetic in.pdf');
    expect(text).not.toContain('bytes');
    expect(e.metadata.options).toEqual({ level: 'Recommended', pages: 3 });
  });

  it('cleans control characters, separators and bidi marks in names and summary', () => {
    const e = buildActivityEntry({
      file: result({
        name: 'Syn\nthetic\tout\u202Etxt.pdf',
        operation: {
          tool: 'merge',
          summary: 'Merged\r\n  2\u2028files\u0000',
          sources: [{ name: 'A\u2066\u200Fb.pdf', origin: 'computer' }],
          options: {},
        },
      }),
      destination: 'computer',
      sha256: SHA,
    });
    expect(e.details).not.toMatch(UNSAFE);
    expect(JSON.stringify(e.metadata)).not.toMatch(/\\n|\\t|\\r|\\u202e|\\u2066|\\u2028|\u202E/i);
    expect(e.details.startsWith('Merged 2 files → Syn thetic out txt.pdf (')).toBe(true);
    expect(e.metadata.resultName).toBe('Syn thetic out txt.pdf');
    expect((e.metadata.sources as { name: string }[])[0].name).toBe('A b.pdf');
  });

  it('also cleans the Arabic letter mark, C1 controls and the zero-width space', () => {
    const e = buildActivityEntry({
      file: result({
        name: 'a؜b\u0085c\u009Fd​e.pdf',
        operation: {
          tool: 'merge',
          summary: 'x؜y\u0080z​!',
          sources: [{ name: 'p؜q\u0090r​s.pdf', origin: 'computer' }],
          options: { note: 'n؜o\u0095p​q' },
        },
      }),
      destination: 'computer',
      sha256: SHA,
    });
    expect(`${e.details}${JSON.stringify(e.metadata)}`).not.toMatch(UNSAFE);
    expect(e.metadata.resultName).toBe('a b c d e.pdf');
    expect(e.details.startsWith('x y z ! → a b c d e.pdf (')).toBe(true);
    expect((e.metadata.sources as { name: string }[])[0].name).toBe('p q r s.pdf');
    expect((e.metadata.options as Record<string, unknown>).note).toBe('n o p q');
  });

  it('caps the summary at 120 and metadata names at 255, by code point', () => {
    const e = buildActivityEntry({
      file: result({ name: 'y'.repeat(300), operation: { tool: 'merge', summary: 's'.repeat(300), sources: [], options: {} } }),
      destination: 'computer',
      sha256: SHA,
    });
    const summary = e.details.split(' → ')[0];
    expect(Array.from(summary).length).toBeLessThanOrEqual(120);
    expect(Array.from(e.metadata.resultName as string).length).toBeLessThanOrEqual(255);
    // emoji straddling the cut: never a lone surrogate
    const emoji = '😀';
    const cut = buildActivityEntry({
      file: result({
        name: emoji.repeat(300),
        operation: { tool: 'merge', summary: `${'s'.repeat(119)}${emoji}${emoji}`, sources: [], options: {} },
      }),
      destination: 'computer',
      sha256: SHA,
    });
    const text = JSON.stringify(cut);
    expect(text).not.toMatch(/\\ud[89ab][0-9a-f]{2}(?!\\ud[c-f])/i);
    expect(cut.details.split(' → ')[0]).toBe(`${'s'.repeat(119)}${emoji}`);
    for (const s of [cut.details, cut.metadata.resultName as string]) {
      expect(s).toBe(Buffer.from(s, 'utf8').toString('utf8'));
    }
  });

  it('baseName strips trailing separators and never falls back to the full path', () => {
    const e = buildActivityEntry({
      file: result({
        name: 'C:\\x\\dir\\',
        operation: {
          tool: 'merge',
          summary: 'S',
          sources: [
            { name: '/home/u/dir/', origin: 'computer' },
            { name: '///', origin: 'computer' },
          ],
          options: {},
        },
      }),
      destination: 'computer',
      sha256: SHA,
    });
    expect(e.metadata.resultName).toBe('dir');
    expect((e.metadata.sources as { name: string }[]).map((s) => s.name)).toEqual(['dir', 'file']);
    expect(JSON.stringify(e)).not.toMatch(/home|C:|\\\\x/);
  });

  it('keeps only primitive options and drops secret-looking keys', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const options = {
      level: 'Recommended',
      pages: 3,
      flag: true,
      nan: NaN,
      inf: Infinity,
      nested: { a: 1 },
      bytes: new Uint8Array([1]),
      fn: () => 1,
      undef: undefined,
      circ: circular,
      pass: 'p1',
      pwd: 'p2',
      authToken: 't',
      secretKey: 's',
      longText: `${'l'.repeat(300)}\n`,
    } as unknown as Record<string, string | number | boolean>;
    const e = buildActivityEntry({
      file: result({ operation: { tool: 'merge', summary: 'S', sources: [], options } }),
      destination: 'computer',
      sha256: SHA,
    });
    const o = e.metadata.options as Record<string, unknown>;
    expect(Object.keys(o).sort()).toEqual(['flag', 'level', 'longText', 'pages']);
    expect((o.longText as string).length).toBeLessThanOrEqual(200);
    expect(() => JSON.stringify(e)).not.toThrow();
    expect(JSON.stringify(e)).not.toMatch(/p1|p2|"t"|"s"/);
  });

  it('drops options whose key means a secret, and keeps innocent look-alikes', () => {
    const secret = ['password', 'Password', 'userPassword', 'ownerPassword', 'owner_password', 'ownerpassword', 'passphrase', 'pass', 'pwd',
      'secret', 'clientSecret', 'token', 'authToken', 'apiKey', 'API_KEY', 'APIKey', 'api-key', 'key', 'secretKey', 'encryptionKey'];
    const innocent = ['keepBookmarks', 'monkey', 'keywords', 'keyboard', 'passes', 'bypass', 'compassion', 'tokenize', 'author', 'turkey'];
    const options: Record<string, string> = {};
    for (const k of [...secret, ...innocent]) options[k] = 'v';
    const e = buildActivityEntry({
      file: result({ operation: { tool: 'merge', summary: 'S', sources: [], options } }),
      destination: 'computer',
      sha256: SHA,
    });
    expect(Object.keys(e.metadata.options as object).sort()).toEqual([...innocent].sort());
  });

  it('lower-cases the SHA-256 and rejects anything that is not 64 hex characters', () => {
    const e = buildActivityEntry({ file: result(), destination: 'computer', sha256: 'AB'.repeat(32) });
    expect(e.metadata.sha256).toBe(SHA);
    expect(e.details).toContain('SHA-256 abababababab…');
    for (const bad of ['zz', '', 'ab'.repeat(31), `${'ab'.repeat(32)}0`, 'xy'.repeat(32)]) {
      let err: unknown;
      try {
        buildActivityEntry({ file: result(), destination: 'computer', sha256: bad });
      } catch (x) {
        err = x;
      }
      expect(err).toBeInstanceOf(PdfToolsError);
      expect((err as PdfToolsError).code).toBe('bad-hash');
    }
  });

  it('words a download truthfully: its completion is not confirmed', () => {
    const d = buildActivityEntry({ file: result(), destination: 'download', sha256: SHA });
    expect(d.action).toBe('Sent to download');
    expect(d.details.endsWith('Destination: Computer, by download (completion not confirmed).')).toBe(true);
    expect(d.metadata).toMatchObject({ destination: 'download' });
    expect(d.metadata).not.toHaveProperty('zip');
    const dz = buildActivityEntry({ file: result(), destination: 'download', sha256: SHA, zip: true });
    expect(dz.details.endsWith('Destination: Computer, in one zip file, by download (completion not confirmed).')).toBe(true);
    expect(dz.metadata).toMatchObject({ destination: 'download', zip: true });
  });

  it('says when a save to the computer was one zip file', () => {
    const z = buildActivityEntry({ file: result(), destination: 'computer', sha256: SHA, zip: true });
    expect(z.action).toBe('Saved to computer');
    expect(z.details.endsWith('Destination: Computer, in one zip file.')).toBe(true);
    expect(z.metadata).toMatchObject({ zip: true });
    // zip means nothing for the vault or a working paper
    const v = buildActivityEntry({ file: result(), destination: 'vault', sha256: SHA, zip: true });
    expect(v.details.endsWith('Destination: Evidence Vault.')).toBe(true);
    expect(v.metadata).not.toHaveProperty('zip');
  });

  it('takes a summary and sources from the caller for a file no tool made, cleaned like the rest', () => {
    const e = buildActivityEntry({
      file: result({ operation: undefined, origin: 'vault', evidenceId: 'ev5', name: 'Letter.pdf' }),
      destination: 'computer',
      sha256: SHA,
      summary: 'Copy of a file from the Evidence Vault,\nwithout its password',
      sources: [{ name: 'C:\\x\\Letter.pdf', origin: 'vault', evidenceId: 'ev5' }],
    });
    expect(e.details.startsWith('Copy of a file from the Evidence Vault, without its password → Letter.pdf')).toBe(true);
    expect(e.details).toContain('Sources: Letter.pdf [vault].');
    expect(e.metadata).toMatchObject({ tool: null, sources: [{ name: 'Letter.pdf', origin: 'vault', evidenceId: 'ev5' }] });
  });

  it('names the earlier steps and the original sources of a result made from results', () => {
    const e = buildActivityEntry({
      file: result({
        name: 'x_compressed_numbered.pdf',
        operation: {
          tool: 'page-numbers',
          summary: 'Added page numbers',
          sources: [{ name: 'x_compressed.pdf', origin: 'result' }],
          options: { position: 'bottom-center' },
          earlier: [{ tool: 'compress', summary: 'Compressed, Recommended (74% smaller: 4.7 MB → 1.2 MB)', resultName: 'x_compressed.pdf', options: { level: 'recommended' }, resultId: 'r0' }],
          originalSources: [{ name: 'x.pdf', origin: 'vault', evidenceId: 'ev-9' }],
        },
      }),
      destination: 'vault',
      sha256: SHA,
      vaultRecordId: 'ev-10',
    });
    expect(e.details).toBe(
      'Added page numbers → x_compressed_numbered.pdf (5 pages, SHA-256 abababababab…). Sources: x_compressed.pdf [result]. ' +
        'Earlier steps: Compressed, Recommended (74% smaller: 4.7 MB → 1.2 MB) → x_compressed.pdf. Original sources: x.pdf [vault]. Destination: Evidence Vault.',
    );
    expect(e.metadata).toMatchObject({
      tool: 'page-numbers',
      sources: [{ name: 'x_compressed.pdf', origin: 'result' }],
      earlierSteps: [{ tool: 'compress', summary: 'Compressed, Recommended (74% smaller: 4.7 MB → 1.2 MB)', resultName: 'x_compressed.pdf', options: { level: 'recommended' } }],
      originalSources: [{ name: 'x.pdf', origin: 'vault', evidenceId: 'ev-9' }],
    });
    expect(JSON.stringify(e.metadata)).not.toContain('r0'); // the internal result id is not logged
    const withIds = buildActivityEntry({
      file: result({ operation: { tool: 'merge', summary: 'Merged 2 files', sources: [{ name: 'a.pdf', origin: 'computer', fileId: 'FILE-ID-1' }], options: {}, earlier: [], originalSources: [{ name: 'a.pdf', origin: 'computer', fileId: 'FILE-ID-2' }] } }),
      destination: 'computer',
      sha256: SHA,
    });
    expect(JSON.stringify(withIds)).not.toMatch(/FILE-ID|fileId/); // nor the working files' ids
    expect(e.metadata).not.toHaveProperty('earlierStepsNotListed');
  });

  it('lists the last ten earlier steps and counts the rest, in the details and the metadata', () => {
    const earlier = Array.from({ length: 12 }, (_, i) => ({ tool: 'page-numbers' as const, summary: `Step ${i + 1}`, resultName: `s${i + 1}.pdf`, options: {}, resultId: `r${i}` }));
    const e = buildActivityEntry({
      file: result({ operation: { tool: 'merge', summary: 'Merged 2 files', sources: [], options: {}, earlier, earlierNotListed: 3, originalSources: [{ name: 'a.pdf', origin: 'computer' }] } }),
      destination: 'computer',
      sha256: SHA,
    });
    expect(e.details).toContain('Earlier steps: Step 3 → s3.pdf; Step 4 → s4.pdf;');
    expect(e.details).toContain('Step 12 → s12.pdf (and 5 earlier steps). Original sources: a.pdf [computer].');
    expect(e.details).not.toContain('Step 2 →');
    expect((e.metadata.earlierSteps as unknown[]).length).toBe(10);
    expect(e.metadata.earlierStepsNotListed).toBe(5);
  });

  it('cleans the earlier steps like the rest: names, summaries and secret options', () => {
    const e = buildActivityEntry({
      file: result({
        operation: {
          tool: 'merge',
          summary: 'Merged 2 files',
          sources: [],
          options: {},
          earlier: [{ tool: 'split', summary: 'Split\n pages\u2028 1-2', resultName: 'C:\\Users\\Someone\\x\u202E.pdf', options: { password: 'hunter2', pages: '1-2' }, resultId: 'r1' }],
          originalSources: [{ name: '/home/someone/in\u0000.pdf', origin: 'computer' }],
        },
      }),
      destination: 'computer',
      sha256: SHA,
    });
    const text = JSON.stringify(e);
    expect(text).not.toMatch(/hunter2|password|Users|home|Someone/);
    expect(`${e.details}${JSON.stringify(e.metadata)}`).not.toMatch(UNSAFE);
    expect(e.details).toContain('Earlier steps: Split pages 1-2 → x .pdf. Original sources: in .pdf [computer].');
    expect((e.metadata.earlierSteps as { options: unknown }[])[0].options).toEqual({ pages: '1-2' });
  });

  it('records what a step did not carry over as flags', () => {
    const e = buildActivityEntry({
      file: result({ operation: { tool: 'merge', summary: 'Merged 2 files; form fields not carried', sources: [], options: {}, flags: { formFieldsDropped: true, signatureInvalid: true } } }),
      destination: 'computer',
      sha256: SHA,
    });
    expect(e.details.startsWith('Merged 2 files; form fields not carried → A_merged.pdf')).toBe(true);
    expect(e.metadata).toMatchObject({ formFieldsDropped: true, signatureInvalid: true });
    expect(e.metadata).not.toHaveProperty('bookmarksDropped');
    const plain = buildActivityEntry({ file: result(), destination: 'computer', sha256: SHA });
    expect(Object.keys(plain.metadata).sort()).toEqual(['destination', 'options', 'pageCount', 'resultName', 'sha256', 'size', 'sources', 'tool']);
  });

  it('keeps what was not carried in a long summary that is cut, in the entry and in an earlier step', () => {
    const pages = Array.from({ length: 60 }, (_, i) => String(i * 2 + 1)).join(', ');
    const summary = `Extracted pages ${pages}; bookmarks not carried; signature no longer valid`;
    const e = buildActivityEntry({
      file: result({
        operation: {
          tool: 'split',
          summary,
          sources: [],
          options: {},
          flags: { bookmarksDropped: true },
          earlier: [{ tool: 'split', summary, resultName: 'x.pdf', options: {}, resultId: 'r1' }],
          originalSources: [{ name: 'a.pdf', origin: 'computer' }],
        },
      }),
      destination: 'computer',
      sha256: SHA,
    });
    const first = e.details.split(' → ')[0];
    expect(Array.from(first).length).toBeLessThanOrEqual(120);
    expect(first).toMatch(/^Extracted pages 1, 3, 5, .+…; bookmarks not carried; signature no longer valid$/);
    expect(e.details).toMatch(/Earlier steps: Extracted pages 1, 3, .+…; bookmarks not carried; signature no longer valid → x\.pdf\./);
    // a long summary without notes is cut as before
    const plain = buildActivityEntry({ file: result({ operation: { tool: 'split', summary: `Extracted pages ${pages}`, sources: [], options: {} } }), destination: 'computer', sha256: SHA });
    expect(plain.details.split(' → ')[0]).toBe(Array.from(`Extracted pages ${pages}`).slice(0, 120).join(''));
  });

  it('copes with a file that has no operation record', () => {
    const e = buildActivityEntry({ file: result({ operation: undefined, origin: 'computer' }), destination: 'vault', sha256: SHA });
    expect(e.details).toContain('→ A_merged.pdf');
    expect(e.details).toContain('Sources: none.');
    expect(e.metadata.sources).toEqual([]);
  });
});
