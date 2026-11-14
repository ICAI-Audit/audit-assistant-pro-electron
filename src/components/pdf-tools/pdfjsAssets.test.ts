import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = (relative: string) => fileURLToPath(new URL(`../../../${relative}`, import.meta.url));

// public/pdf-tools/pdfjs is a copy made by scripts/sync-pdfjs-assets.mjs; it must match the
// installed pdfjs-dist, or the worker and its data files would come from different versions.
describe('pdfjs data files', () => {
  it('were copied from the installed pdfjs-dist version', () => {
    const { version } = JSON.parse(readFileSync(root('node_modules/pdfjs-dist/package.json'), 'utf8')) as { version: string };
    expect(readFileSync(root('public/pdf-tools/pdfjs/VERSION'), 'utf8').trim()).toBe(`pdfjs-dist ${version}`);
  });

  it('include the folders the renderer points pdfjs at', () => {
    for (const folder of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
      expect(existsSync(root(`public/pdf-tools/pdfjs/${folder}`))).toBe(true);
    }
  });
});
