// Copies the files Make searchable (PDF Tools, text recognition) needs at run time from the installed
// packages into public/pdf-tools/ocr/, so that Vite ships them with the renderer and the packaged
// application (loaded from file://) reads them without any network access.
//
//   node scripts/sync-ocr-assets.mjs        (npm run sync:ocr-assets)
//
// Run it again after changing the version of tesseract.js, tesseract.js-core or @tesseract.js-data/eng.
// The copy is made in a staging folder and swapped in at the end, so a failed run leaves the previous
// copy as it was (the swap is the one scripts/sync-pdfjs-assets.mjs uses).
// src/components/pdf-tools/ocr/ocrAssets.test.ts checks that the copy matches the installed versions.
//
// What is copied (about 14.8 MB):
//   worker.min.js (+ its licence note)        the recognition worker                  tesseract.js/dist
//   core/tesseract-core-*-lstm.wasm.js (3)    the engine, one file per processor      tesseract.js-core
//                                             ability; the worker picks one
//   eng/eng.traineddata.gz                    English, "best, integer" data           @tesseract.js-data/eng/4.0.0_best_int
//   LICENSE                                   Apache-2.0, the engine's licence        tesseract.js-core
//   VERSION                                   the three versions
import * as fs from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isRunDirectly, swapIn } from './sync-pdfjs-assets.mjs';

/** The three packages, in the order of the VERSION file's lines. */
export const OCR_PACKAGES = ['tesseract.js', 'tesseract.js-core', '@tesseract.js-data/eng'];

/** Every file of the copy: [path under public/pdf-tools/ocr, package, path inside the package]. VERSION is written, not copied. */
export const OCR_FILES = [
  ['worker.min.js', 'tesseract.js', 'dist/worker.min.js'],
  ['worker.min.js.LICENSE.txt', 'tesseract.js', 'dist/worker.min.js.LICENSE.txt'],
  ['core/tesseract-core-relaxedsimd-lstm.wasm.js', 'tesseract.js-core', 'tesseract-core-relaxedsimd-lstm.wasm.js'],
  ['core/tesseract-core-simd-lstm.wasm.js', 'tesseract.js-core', 'tesseract-core-simd-lstm.wasm.js'],
  ['core/tesseract-core-lstm.wasm.js', 'tesseract.js-core', 'tesseract-core-lstm.wasm.js'],
  ['eng/eng.traineddata.gz', '@tesseract.js-data/eng', '4.0.0_best_int/eng.traineddata.gz'],
  ['LICENSE', 'tesseract.js-core', 'LICENSE'],
];

/** The VERSION file's text for the given versions (package name to version). */
export function versionText(versions) {
  return OCR_PACKAGES.map((name) => `${name} ${versions[name]}\n`).join('');
}

function main() {
  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const modules = join(projectRoot, 'node_modules');
  const target = join(projectRoot, 'public', 'pdf-tools', 'ocr');
  const staging = `${target}.staging-${process.pid}`;

  const fail = (message) => {
    fs.rmSync(staging, { recursive: true, force: true });
    console.error(message);
    process.exit(1);
  };

  const versions = {};
  for (const name of OCR_PACKAGES) {
    const manifest = join(modules, name, 'package.json');
    if (!fs.existsSync(manifest)) fail(`${name} is not installed. Run npm ci first.`);
    versions[name] = JSON.parse(fs.readFileSync(manifest, 'utf8')).version;
  }

  fs.rmSync(staging, { recursive: true, force: true });
  let bytes = 0;
  try {
    for (const [to, name, from] of OCR_FILES) {
      const source = join(modules, name, from);
      if (!fs.existsSync(source)) fail(`${name} ${versions[name]} has no ${from}.`);
      const destination = join(staging, to);
      fs.mkdirSync(dirname(destination), { recursive: true });
      fs.copyFileSync(source, destination);
      bytes += fs.statSync(destination).size;
    }
    fs.writeFileSync(join(staging, 'VERSION'), versionText(versions));
  } catch (error) {
    fail(`Copy failed, the previous files were left in place: ${error.message}`);
  }
  let warning = null;
  try {
    warning = swapIn(fs, staging, target, `${target}.old`);
  } catch (error) {
    fail(error.message);
  }
  if (warning) console.warn(warning);
  console.log(`Copied ${OCR_FILES.length} files (${(bytes / 1048576).toFixed(1)} MB) from ${OCR_PACKAGES.map((name) => `${name} ${versions[name]}`).join(', ')} to ${target}`);
}

if (isRunDirectly(process.argv[1], import.meta.url)) main();
