import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const requiredDocs = [
  'AGENTS.md', 'CLAUDE.md', '.agents/README.md', '.github/copilot-instructions.md', 'START_HERE.md',
  ...['README', 'PRODUCT_CONTEXT', 'ARCHITECTURE', 'DATA_MODEL', 'FEATURE_REGISTER',
    'SCREEN_MAP', 'CURRENT_STATUS', 'NEXT_TASKS', 'SESSION_HANDOFF', 'DECISIONS',
    'SECURITY_AND_AUDIT', 'DEVELOPMENT_GUIDE', 'TESTING', 'SOURCES_AND_RULES',
    'DOCUMENTATION_AUDIT', 'SKILLS_INDEX'].map(name => `docs/project/${name}.md`),
  'docs/project/templates/TASK.md', 'docs/project/templates/HANDOFF.md',
  ...['session-continuity', 'feature-change', 'financial-rules', 'statutory-content',
    'database-change', 'security-review', 'report-export', 'desktop-validation']
    .map(name => `docs/project/workflows/${name}.md`),
];
const read = (root, name) => fs.readFileSync(path.join(root, name), 'utf8');
const walk = (root, rel) => fs.readdirSync(path.join(root, rel), { withFileTypes: true })
  .flatMap(entry => entry.isDirectory()
    ? walk(root, `${rel}/${entry.name}`)
    : [`${rel}/${entry.name}`]).sort();

export function buildInventory(root) {
  const pkg = JSON.parse(read(root, 'package.json'));
  const app = read(root, 'src/App.tsx');
  const starts = [...app.matchAll(/<Route\b/g)].map(match => match.index);
  const routes = starts.map((start, i) => {
    const block = app.slice(start, starts[i + 1] ?? app.length);
    const route = block.match(/\bpath="([^"]+)"/)[1];
    const names = [...block.matchAll(/<([A-Z]\w*)\s*\/>/g)].map(match => match[1]);
    return {
      path: route,
      component: names.at(-1) ?? 'unknown',
      guard: block.match(/<(Protected\w+)/)?.[1] ?? 'public',
    };
  });
  const schema = walk(root, 'sqlite/schema').filter(name => name.endsWith('.sql')).map(name => ({
    path: name,
    declaredTables: [...read(root, name).matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([\w]+)/gi)]
      .map(match => match[1]).sort(),
  }));
  const mainHandlers = ['electron/main.cjs', 'electron/auto-updater.cjs'].map(name => ({
    path: name,
    channels: [...read(root, name).matchAll(/ipcMain\.handle\(\s*['"]([^'"]+)['"]/g)]
      .map(match => match[1]).sort(),
  }));
  const sourcePaths = ['src', 'electron', 'sqlite', 'tests'].flatMap(rel => walk(root, rel));
  return {
    formatVersion: 1,
    reviewedSourceCommit: 'c0ea50820094952b3bad9c83b45cc00cbff0381c',
    note: 'Lexical source inventory only. Declarations and file existence are not runtime or UAT evidence. Refreshing this snapshot does not advance the reviewed code baseline.',
    packageName: pkg.name,
    packageVersion: pkg.version,
    main: pkg.main,
    preload: 'electron/preload.cjs',
    routes,
    schema,
    mainHandlers,
    testFiles: sourcePaths.filter(name => /\.test\.[cm]?[jt]sx?$/.test(name)),
    sourcePaths,
  };
}

export function screenMap(inventory) {
  return '# Screen map\n\nGenerated from src/App.tsx by npm run docs:inventory. This maps route declarations and their guards, not verified end-to-end behaviour. See the [feature register](FEATURE_REGISTER.md) for implementation limits.\n\n'
    + '| Route | Component | Declared guard |\n| --- | --- | --- |\n'
    + inventory.routes.map(route => `| ${route.path} | ${route.component} | ${route.guard} |`).join('\n')
    + '\n\nBoth /trial-balance and /financial-review select FinancialReview. /programs-new aliases AuditExecution. /feedback is declared twice with different guards; resolve intent in a scoped route task rather than inferring permissions from its label. A public fallback is not an authentication guarantee for other screens.\n';
}

export function checkDocs(root = defaultRoot) {
  const errors = [];
  for (const name of requiredDocs) {
    if (!fs.existsSync(path.join(root, name))) {
      errors.push(`Missing required document: ${name}`);
      continue;
    }
    const text = read(root, name);
    if (text.trim().length < 80) errors.push(`Empty or insufficient document: ${name}`);
    // Inspect local Markdown links; external URLs and intra-page anchors are not fetched.
    for (const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      const target = match[1].split('#')[0];
      if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
      const resolved = path.resolve(path.dirname(path.join(root, name)), decodeURIComponent(target));
      if (!resolved.startsWith(`${root}${path.sep}`) && resolved !== root) {
        errors.push(`Link leaves repository: ${name} -> ${target}`);
      } else if (!fs.existsSync(resolved)) errors.push(`Broken local link: ${name} -> ${target}`);
    }
  }
  for (const name of ['CLAUDE.md', '.github/copilot-instructions.md']) {
    if (fs.existsSync(path.join(root, name)) && !read(root, name).includes('AGENTS.md')) {
      errors.push(`Adapter does not reference shared instructions: ${name}`);
    }
  }
  const inventoryPath = 'docs/project/inventory.json';
  try {
    const actual = buildInventory(root);
    const stored = JSON.parse(read(root, inventoryPath));
    if (JSON.stringify(actual) !== JSON.stringify(stored)) {
      errors.push('Source inventory is stale. Run npm run docs:inventory and review the diff.');
    }
    if (fs.existsSync(path.join(root, 'docs/project/SCREEN_MAP.md')) &&
        read(root, 'docs/project/SCREEN_MAP.md') !== screenMap(actual)) {
      errors.push('Screen map is stale. Run npm run docs:inventory and review the diff.');
    }
  } catch (error) {
    errors.push(`Cannot validate source inventory: ${error.message}`);
  }
  for (const name of ['docs/project/CURRENT_STATUS.md', 'docs/project/SESSION_HANDOFF.md']) {
    if (fs.existsSync(path.join(root, name)) && /pending final run/i.test(read(root, name))) {
      errors.push(`Unfinished validation record: ${name}`);
    }
  }
  return errors;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--refresh-inventory')) {
    const inventory = buildInventory(defaultRoot);
    fs.mkdirSync(path.join(defaultRoot, 'docs/project'), { recursive: true });
    fs.writeFileSync(path.join(defaultRoot, 'docs/project/inventory.json'), JSON.stringify(inventory, null, 2) + '\n');
    fs.writeFileSync(path.join(defaultRoot, 'docs/project/SCREEN_MAP.md'), screenMap(inventory));
    console.log(`Refreshed source inventory: ${inventory.routes.length} routes, ${inventory.schema.length} schema files, ${inventory.testFiles.length} test files. Review the diff; this does not verify behaviour.`);
  } else {
    const errors = checkDocs();
    if (errors.length) {
      for (const error of errors) console.error(error);
      process.exitCode = 1;
    } else {
      console.log(`Project documentation checks passed: ${requiredDocs.length} required documents, local links, shared adapters and source inventory. Content accuracy, IDE loading and application behaviour require separate review.`);
    }
  }
}
