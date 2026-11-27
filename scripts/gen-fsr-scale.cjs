#!/usr/bin/env node
// Generates src/modules/fsg/fsr-scale.css (T-088, UI only).
//
//   node scripts/gen-fsr-scale.cjs            write the file
//   node scripts/gen-fsr-scale.cjs --check    exit 1 if the file is out of date (used by lint:fsr-ui)
//
// Why this exists: the Financial Statement Review screens are styled with Tailwind utilities (text-xs, p-2, h-8, ...)
// whose sizes are fixed rem values relative to <html>. The root font-size is shared by every VERA module and must not
// change, so the FSR scale (--fsr-scale, set per breakpoint in fsr-tokens.css) is applied here instead: for every
// size-bearing utility the module really uses, this file re-declares the same rem value multiplied by --fsr-scale, but
// only under .fsg-root (which is also the dialog/menu portal root). At --fsr-scale: 1 every rule is a no-op.
// Utilities that are not size-bearing, and values that are not rem based (%, vh, calc), are left alone.
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const OUT = path.join(root, 'src/modules/fsg/fsr-scale.css');
const SCAN = ['src/modules/fsg/components', 'src/modules/fsg/App.jsx', 'src/modules/fsg/ErrorBoundary.jsx'];

const files = [];
const walk = (p) => {
  const abs = path.join(root, p);
  const st = fs.statSync(abs);
  if (st.isDirectory()) { for (const e of fs.readdirSync(abs)) walk(path.join(p, e)); return; }
  if (/\.(jsx|tsx)$/.test(abs)) files.push(abs);
};
SCAN.forEach(walk);

// Tailwind class token: [variants:][-]utility-value
const CLASS_RE = /(?<![\w\-/:.\[])((?:[a-z0-9\-\[\]=&>*_]+:)*)(-?)(text|leading|p|px|py|pt|pr|pb|pl|m|mx|my|mt|mr|mb|ml|gap|gap-x|gap-y|space-x|space-y|w|h|min-w|max-w|min-h|max-h|size|top|right|bottom|left|inset|inset-x|inset-y)-(\[[^\]\s]+\]|[A-Za-z0-9.]+)(?![\w\-/])/g;

const SPACING = {
  p: ['padding'], px: ['padding-left', 'padding-right'], py: ['padding-top', 'padding-bottom'],
  pt: ['padding-top'], pr: ['padding-right'], pb: ['padding-bottom'], pl: ['padding-left'],
  m: ['margin'], mx: ['margin-left', 'margin-right'], my: ['margin-top', 'margin-bottom'],
  mt: ['margin-top'], mr: ['margin-right'], mb: ['margin-bottom'], ml: ['margin-left'],
  gap: ['gap'], 'gap-x': ['column-gap'], 'gap-y': ['row-gap'],
  w: ['width'], h: ['height'], size: ['width', 'height'],
  'min-w': ['min-width'], 'max-w': ['max-width'], 'min-h': ['min-height'], 'max-h': ['max-height'],
  top: ['top'], right: ['right'], bottom: ['bottom'], left: ['left'],
  inset: ['inset'], 'inset-x': ['left', 'right'], 'inset-y': ['top', 'bottom'],
  leading: ['line-height'],
};
// Order mirrors Tailwind's output so that, for example, px-3 still beats p-2 when both are on one element.
const ORDER = ['inset', 'inset-x', 'inset-y', 'top', 'right', 'bottom', 'left', 'm', 'mx', 'my', 'mt', 'mr', 'mb', 'ml',
  'size', 'h', 'max-h', 'min-h', 'w', 'min-w', 'max-w', 'p', 'px', 'py', 'pt', 'pr', 'pb', 'pl', 'text', 'leading',
  'gap', 'gap-x', 'gap-y', 'space-x', 'space-y'];
const NAMED_MAX_W = { xs: 20, sm: 24, md: 28, lg: 32, xl: 36, '2xl': 42, '3xl': 48, '4xl': 56, '5xl': 64, '6xl': 72, '7xl': 80 };
const TEXT = {
  // class -> [font-size token, line-height in rem]
  xs: ['var(--fsr-text-sm)', 1], sm: ['var(--fsr-text-md)', 1.25], base: ['var(--fsr-text-lead)', 1.5],
  lg: ['var(--fsr-text-lg)', 1.75], xl: ['var(--fsr-text-xl)', 1.75], '2xl': ['calc(1.5rem * var(--fsr-scale))', 2],
  '3xl': ['var(--fsr-icon-xl)', 2.25], '4xl': ['var(--fsr-icon-2xl)', 2.5],
};
const TEXT_PX = { 9: 'xs', 10: 'xs', 11: 'xs', 11.5: 'xs', 12: 'sm', 13: 'base', 14: 'md', 16: 'lead', 18: 'lg', 20: 'xl' };
const BREAKPOINTS = { sm: 640, md: 768, lg: 1024, xl: 1280, '2xl': 1536 };
const PSEUDO = { hover: ':hover', focus: ':focus', 'focus-visible': ':focus-visible', disabled: ':disabled', first: ':first-child', last: ':last-child', odd: ':nth-child(odd)', even: ':nth-child(even)' };

const f = (n) => String(+n.toFixed(4));
const scaled = (rem, neg) => `calc(${neg ? '-' : ''}${f(rem)}rem * var(--fsr-scale))`;
const esc = (s) => s.replace(/([.\[\]%/:()#,])/g, '\\$1');

function remOf(util, val) {
  if (/^\d+(\.\d+)?$/.test(val)) return parseFloat(val) * 0.25;
  if (util === 'max-w' && NAMED_MAX_W[val]) return NAMED_MAX_W[val];
  let m = val.match(/^\[(\d+(\.\d+)?)px\]$/);
  if (m) return parseFloat(m[1]) / 16;
  m = val.match(/^\[(\d+(\.\d+)?)rem\]$/);
  if (m) return parseFloat(m[1]);
  return null;
}

const seen = new Map();
const skippedVariants = new Map();
for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  for (const m of text.matchAll(CLASS_RE)) {
    const [, variants, neg, util, val] = m;
    const key = `${variants}|${neg}|${util}|${val}`;
    if (!seen.has(key)) seen.set(key, { variants, neg, util, val });
  }
}

const rules = [];
for (const { variants, neg, util, val } of seen.values()) {
  const vs = variants ? variants.split(':').filter(Boolean) : [];
  let media = null; let pseudo = '';
  let ok = true;
  for (const v of vs) {
    if (BREAKPOINTS[v]) media = BREAKPOINTS[v];
    else if (PSEUDO[v]) pseudo += PSEUDO[v];
    else { ok = false; skippedVariants.set(v, (skippedVariants.get(v) || 0) + 1); }
  }
  if (!ok) continue;
  const cls = `${variants}${neg}${util}-${val}`;
  let body = null; let sel = `.fsg-root .${esc(cls)}${pseudo}`; let rank = ORDER.indexOf(util);

  if (util === 'text') {
    let named = null; let tok = null;
    if (TEXT[val]) named = val;
    else { const px = val.match(/^\[(\d+(\.\d+)?)px\]$/); if (px && TEXT_PX[parseFloat(px[1])]) tok = TEXT_PX[parseFloat(px[1])]; }
    if (named) body = `font-size: ${TEXT[named][0]}; line-height: ${scaled(TEXT[named][1])};`;
    else if (tok) body = `font-size: var(--fsr-text-${tok});` + (tok === 'xs' ? ` line-height: ${scaled(1)};` : '');
    else continue;
  } else if (util === 'space-x' || util === 'space-y') {
    const rem = remOf(util, val); if (rem == null || rem === 0) continue;
    const v = scaled(rem, neg);
    sel = `.fsg-root .${esc(cls)}${pseudo} > :not([hidden]) ~ :not([hidden])`;
    body = util === 'space-x'
      ? `margin-left: calc(${v} * calc(1 - var(--tw-space-x-reverse))); margin-right: calc(${v} * var(--tw-space-x-reverse));`
      : `margin-top: calc(${v} * calc(1 - var(--tw-space-y-reverse))); margin-bottom: calc(${v} * var(--tw-space-y-reverse));`;
  } else if (SPACING[util]) {
    const rem = remOf(util, val);
    if (rem == null || rem === 0) continue;
    if (util === 'leading' && neg) continue;
    body = SPACING[util].map((p) => `${p}: ${scaled(rem, neg)};`).join(' ');
  } else continue;
  rules.push({ sel, body, media, pseudo: pseudo ? 1 : 0, rank, cls });
}
rules.sort((a, b) => (a.media || 0) - (b.media || 0) || a.pseudo - b.pseudo || a.rank - b.rank || (a.cls < b.cls ? -1 : 1));

const out = [];
out.push(`/* GENERATED by scripts/gen-fsr-scale.cjs: do not edit. Re-run the script (npm run gen:fsr-scale) after changing class names. */
/* Financial Statement Review scale layer (T-088). UI only.
 *
 * Each rule re-declares a Tailwind utility the module uses, with its rem value multiplied by --fsr-scale (fsr-tokens.css:
 * 0.9375 up to 1366px, 1 by default, 1.0625 from 1920px, 1.125 from 2560px). Scoped to .fsg-root and its portal root, so
 * no other VERA module is affected, and <html> font-size is untouched. At scale 1 every rule equals the original value.
 * ${rules.length} rules from ${seen.size} distinct utility classes in ${files.length} files.
 * Variants not handled (left unscaled): ${[...skippedVariants.keys()].sort().join(', ') || 'none'}.
 */`);
let curMedia;
for (const r of rules) {
  if (r.media !== curMedia) {
    if (curMedia) out.push('}');
    if (r.media) out.push(`@media (min-width: ${r.media}px) {`);
    curMedia = r.media;
  }
  out.push(`${r.media ? '  ' : ''}${r.sel} { ${r.body} }`);
}
if (curMedia) out.push('}');
const css = out.join('\n') + '\n';

if (process.argv.includes('--check')) {
  const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8').replace(/\r\n/g, '\n') : '';
  if (current !== css) { console.error('fsr-scale.css is out of date: run npm run gen:fsr-scale'); process.exit(1); }
  console.log(`fsr-scale.css is up to date (${rules.length} rules).`);
} else {
  fs.writeFileSync(OUT, css);
  console.log(`wrote ${path.relative(root, OUT)}: ${rules.length} rules from ${seen.size} classes in ${files.length} files`);
  if (skippedVariants.size) console.log('unscaled variants:', [...skippedVariants.entries()].map(([k, v]) => `${k}×${v}`).join(', '));
}
