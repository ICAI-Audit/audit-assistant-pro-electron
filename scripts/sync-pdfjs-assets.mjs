// Copies the data files PDF Tools needs at run time from the installed pdfjs-dist into
// public/pdf-tools/pdfjs/, so that Vite ships them with the renderer and the packaged
// application (loaded from file://) can read them without any network access.
//
//   node scripts/sync-pdfjs-assets.mjs
//
// Run it again after changing the pdfjs-dist version. The copy is made in a staging folder and
// swapped in at the end, so a failed run leaves the previous copy as it was.
// src/components/pdf-tools/pdfjsAssets.test.ts checks that the copy matches the installed version.
import * as fs from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Swaps `staging` in for `target` by renaming, so the old copy is never deleted before the new one
 * is in place: on Windows a rename can fail (a file held open by an editor or a scanner), and then
 * the old copy is put back. Throws with what is true afterwards; returns a warning when only the
 * old copy could not be deleted, else null. Exported for the tests.
 */
export function swapIn(files, staging, target, previous) {
  files.rmSync(previous, { recursive: true, force: true });
  const hadTarget = files.existsSync(target);
  if (hadTarget) files.renameSync(target, previous);
  try {
    files.renameSync(staging, target);
  } catch (error) {
    if (!hadTarget) throw new Error(`Copy failed: ${error.message}`);
    try {
      files.renameSync(previous, target);
    } catch (restoreError) {
      throw new Error(
        `Copy failed, and the previous files could not be put back. They are in ${previous}: rename that folder to ${target}. (${error.message}; ${restoreError.message})`,
      );
    }
    throw new Error(`Copy failed, the previous files were left in place: ${error.message}`);
  }
  try {
    files.rmSync(previous, { recursive: true, force: true });
  } catch (error) {
    return `The new files are in place, but the old copy could not be deleted: ${previous} (${error.message})`;
  }
  return null;
}

function main() {
  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const source = join(projectRoot, 'node_modules', 'pdfjs-dist');
  const target = join(projectRoot, 'public', 'pdf-tools', 'pdfjs');
  const staging = `${target}.staging-${process.pid}`;
  // cmaps: character maps for CJK and other non-embedded encodings; standard_fonts: the 14
  // standard PDF fonts; wasm: image decoders (JPEG 2000) and colour management; iccs: the CMYK profile.
  const FOLDERS = ['cmaps', 'standard_fonts', 'wasm', 'iccs'];

  const fail = (message) => {
    fs.rmSync(staging, { recursive: true, force: true });
    console.error(message);
    process.exit(1);
  };

  if (!fs.existsSync(join(source, 'package.json'))) fail('pdfjs-dist is not installed. Run npm ci first.');
  const { version } = JSON.parse(fs.readFileSync(join(source, 'package.json'), 'utf8'));

  fs.rmSync(staging, { recursive: true, force: true });
  let warning = null;
  try {
    for (const folder of FOLDERS) {
      const from = join(source, folder);
      if (!fs.existsSync(from)) fail(`pdfjs-dist ${version} has no ${folder} folder.`);
      fs.cpSync(from, join(staging, folder), { recursive: true });
    }
    fs.writeFileSync(join(staging, 'VERSION'), `pdfjs-dist ${version}\n`);
  } catch (error) {
    fail(`Copy failed, the previous files were left in place: ${error.message}`);
  }
  try {
    warning = swapIn(fs, staging, target, `${target}.old`);
  } catch (error) {
    fail(error.message);
  }
  if (warning) console.warn(warning);
  console.log(`Copied ${FOLDERS.join(', ')} from pdfjs-dist ${version} to ${target}`);
}

/**
 * Whether this module was started as the script, rather than imported (by the tests). Both sides
 * are compared as real paths, so starting it through a junction or symbolic link still runs it;
 * Windows paths compare without case. Exported for the tests.
 */
export function isRunDirectly(argv1, moduleUrl, realpath = fs.realpathSync) {
  if (!argv1) return false;
  const real = (path) => {
    try {
      return realpath(path);
    } catch {
      return resolve(path);
    }
  };
  const a = real(resolve(argv1));
  const b = real(fileURLToPath(moduleUrl));
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

if (isRunDirectly(process.argv[1], import.meta.url)) main();
