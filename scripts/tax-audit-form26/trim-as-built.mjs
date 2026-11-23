// Makes scripts/tax-audit-form26/as-built.json: the input of generate-definition.mjs.
// It is the exact extraction of the office's fillable Form No. 26 WITHOUT the entries that hold
// that file's own code or are not needed to build the definition.
//
// Run: node scripts/tax-audit-form26/trim-as-built.mjs <path to the full as-built.json>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Entries removed from the full extraction (top-level names, or a dotted path one level down). */
export const REMOVED_ENTRIES = ['functionSource', 'css', 'behaviourProbes', 'wordExport.headStart', 'states'];

export function trimAsBuilt(full) {
  const out = { ...full };
  for (const entry of REMOVED_ENTRIES) {
    const [top, inner] = entry.split('.');
    if (inner === undefined) {
      delete out[top];
    } else if (out[top] && typeof out[top] === 'object') {
      out[top] = { ...out[top] };
      delete out[top][inner];
    }
  }
  return out;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const source = process.argv[2];
  if (!source) {
    console.error('Usage: node scripts/tax-audit-form26/trim-as-built.mjs <path to the full as-built.json>');
    process.exit(2);
  }
  const full = JSON.parse(fs.readFileSync(source, 'utf8'));
  const target = path.join(here, 'as-built.json');
  fs.writeFileSync(target, JSON.stringify(trimAsBuilt(full), null, 1) + '\n');
  console.log(`Wrote ${target} (${fs.statSync(target).size} bytes)`);
}
