// public/pdf-tools/ocr is a copy made by scripts/sync-ocr-assets.mjs (the recognition worker, the engine and the
// English data of Make searchable). It must match the installed packages, or the library in the application's
// code and the worker it starts would come from different versions. The three packages are pinned to exact
// versions under devDependencies: nothing of them is needed from node_modules when the application runs.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = (relative: string) => fileURLToPath(new URL(`../../../../${relative}`, import.meta.url));

interface SyncScript {
  OCR_PACKAGES: string[];
  OCR_FILES: [string, string, string][];
  versionText(versions: Record<string, string>): string;
}
const loadScript = async (): Promise<SyncScript> => (await import(/* @vite-ignore */ new URL('../../../../scripts/sync-ocr-assets.mjs', import.meta.url).href)) as SyncScript;

const manifest = () => JSON.parse(readFileSync(root('package.json'), 'utf8')) as { scripts: Record<string, string>; dependencies: Record<string, string>; devDependencies: Record<string, string> };
const installed = (name: string) => (JSON.parse(readFileSync(root(`node_modules/${name}/package.json`), 'utf8')) as { version: string }).version;

describe('text recognition files', () => {
  it('are pinned to exact versions as development dependencies, with a script to copy them', async () => {
    const { OCR_PACKAGES } = await loadScript();
    const { scripts, dependencies, devDependencies } = manifest();
    expect(OCR_PACKAGES).toEqual(['tesseract.js', 'tesseract.js-core', '@tesseract.js-data/eng']);
    expect(OCR_PACKAGES.map((name) => devDependencies[name])).toEqual(['7.0.0', '7.0.0', '1.0.0']);
    for (const name of OCR_PACKAGES) {
      expect(dependencies[name], name).toBeUndefined();
      expect(installed(name), name).toBe(devDependencies[name]);
    }
    expect(scripts['sync:ocr-assets']).toBe('node scripts/sync-ocr-assets.mjs');
  });

  it('were copied from the installed versions', async () => {
    const { OCR_PACKAGES, versionText } = await loadScript();
    const versions = Object.fromEntries(OCR_PACKAGES.map((name) => [name, installed(name)]));
    expect(versionText(versions)).toBe('tesseract.js 7.0.0\ntesseract.js-core 7.0.0\n@tesseract.js-data/eng 1.0.0\n');
    expect(readFileSync(root('public/pdf-tools/ocr/VERSION'), 'utf8')).toBe(versionText(versions));
  });

  it('hold the worker, the three engine files, the English data and the licence, each the size of its source', async () => {
    const { OCR_FILES } = await loadScript();
    expect(OCR_FILES.map(([to]) => to)).toEqual([
      'worker.min.js',
      'worker.min.js.LICENSE.txt',
      'core/tesseract-core-relaxedsimd-lstm.wasm.js',
      'core/tesseract-core-simd-lstm.wasm.js',
      'core/tesseract-core-lstm.wasm.js',
      'eng/eng.traineddata.gz',
      'LICENSE',
    ]);
    for (const [to, name, from] of OCR_FILES) {
      const copy = root(`public/pdf-tools/ocr/${to}`);
      expect(existsSync(copy), to).toBe(true);
      expect(statSync(copy).size, to).toBe(statSync(root(`node_modules/${name}/${from}`)).size);
    }
    // The engine reads the data file gzipped ("best, integer" English, 2.95 MB), from the folder the engine is pointed at.
    expect(statSync(root('public/pdf-tools/ocr/eng/eng.traineddata.gz')).size).toBe(2_952_873);
  });

  it('are where the engine points the library', () => {
    const engine = readFileSync(root('src/components/pdf-tools/ocr/ocrEngine.ts'), 'utf8');
    expect(engine).toContain('./pdf-tools/ocr/${path}');
    for (const path of ["asset('worker.min.js')", "asset('core')", "asset('eng')"]) expect(engine).toContain(path);
  });
});
