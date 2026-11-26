#!/usr/bin/env node
// Financial Statement Review typography and layout guard (T-088, UI only).  Run with: npm run lint:fsr-ui
//
// Fails when the module drifts away from the tokens in src/modules/fsg/fsr-tokens.css:
//   1. src/modules/fsg/fsr-scale.css is stale (a Tailwind size class was added and the generator was not re-run);
//   2. a raw-pixel text class (text-[Npx]) has no token mapping, so it would not follow the FSR scale;
//   3. an inline style sets fontSize in px or sets fontFamily;
//   4. a viewport unit (vh, vw, h-screen, w-screen) is used anywhere except the token file;
//   5. module CSS declares a px font-size, or a font family other than Inter, outside the token file, the generated scale
//      layer and the print/export blocks.
// Exempt by design: ErrorBoundary.jsx (renders outside .fsg-root, where the tokens do not exist), HTML strings written to
// exported files (they contain "<html"), print/export CSS (.print-view), AG Grid numeric sizes (decision D6: fixed px).
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const rel = (p) => path.relative(root, p).replace(/\\/g, '/');
const MOD = path.join(root, 'src/modules/fsg');
const MAPPED_TEXT_PX = new Set([9, 10, 11, 11.5, 12, 13, 14, 16, 18, 20]); // must match TEXT_PX in gen-fsr-scale.cjs
const EXEMPT_FILES = new Set(['src/modules/fsg/ErrorBoundary.jsx']);
const TOKEN_CSS = new Set(['src/modules/fsg/fsr-tokens.css', 'src/modules/fsg/fsr-scale.css']);

const problems = [];
const report = (file, line, msg) => problems.push(`${rel(file)}:${line}  ${msg}`);

// 1. generated layer is current
const gen = spawnSync(process.execPath, [path.join(__dirname, 'gen-fsr-scale.cjs'), '--check'], { encoding: 'utf8' });
if (gen.status !== 0) problems.push(`src/modules/fsg/fsr-scale.css  ${(gen.stderr || gen.stdout).trim()}`);

const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
};
const files = walk(MOD);

// 2-4. component source
for (const file of files.filter((f) => /\.(jsx|tsx|js)$/.test(f) && !/\.test\./.test(f))) {
  if (EXEMPT_FILES.has(rel(file))) continue;
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  lines.forEach((text, i) => {
    if (text.includes('<html')) return; // exported document template
    for (const m of text.matchAll(/(?<![\w-])text-\[(\d+(?:\.\d+)?)px\]/g)) {
      if (!MAPPED_TEXT_PX.has(parseFloat(m[1]))) report(file, i + 1, `text-[${m[1]}px] has no token; use text-xs/text-sm or a mapped size`);
    }
    if (/fontSize:\s*['"`]?\d+(\.\d+)?(px)?['"`]?/.test(text)) report(file, i + 1, 'inline px fontSize; use var(--fsr-text-*)');
    if (/fontFamily\s*:/.test(text)) report(file, i + 1, 'inline fontFamily; the module typeface comes from fsr-tokens.css');
    if (/\b\d+(\.\d+)?v[hw]\b|(?<![\w-])[hw]-screen\b|\b(min|max)-[hw]-screen\b/.test(text)) report(file, i + 1, 'viewport unit; size against the layout, or use --fsr-viewport-h');
  });
}

// 5. module CSS
for (const file of files.filter((f) => f.endsWith('.css'))) {
  if (TOKEN_CSS.has(rel(file))) continue;
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  let depth = 0; let printDepth = -1;
  lines.forEach((text, i) => {
    const code = text.replace(/\/\*.*?\*\//g, '');
    if (printDepth < 0 && /print-view|@media\s+print|@page/.test(code) && code.includes('{')) printDepth = depth;
    const inPrint = printDepth >= 0 || /print-view/.test(code);
    if (!inPrint) {
      if (/font-size\s*:\s*\d+(\.\d+)?px/.test(code)) report(file, i + 1, 'px font-size; use var(--fsr-text-*)');
      const fam = code.match(/font-family\s*:\s*([^;]+)/);
      if (fam && !/^\s*['"]?Inter['"]?/.test(fam[1]) && !/inherit/.test(fam[1])) report(file, i + 1, `font family ${fam[1].trim()}; the module uses Inter`);
      if (/\b\d+(\.\d+)?v[hw]\b/.test(code)) report(file, i + 1, 'viewport unit; use --fsr-viewport-h');
    }
    depth += (code.match(/\{/g) || []).length - (code.match(/\}/g) || []).length;
    if (printDepth >= 0 && depth <= printDepth) printDepth = -1;
  });
}

if (problems.length) {
  console.error(`lint:fsr-ui found ${problems.length} problem(s):\n  ` + problems.join('\n  '));
  process.exit(1);
}
console.log('lint:fsr-ui passed: Financial Statement Review uses the FSR tokens.');
