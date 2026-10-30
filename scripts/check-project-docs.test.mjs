import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkDocs, requiredDocs } from './check-project-docs.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('documentation checker detects broken handoffs, links, adapters and source drift', () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'vera-docs-'));
  try {
    for (const rel of ['src', 'electron', 'sqlite', 'tests', 'docs', '.agents', 'package.json', 'AGENTS.md', 'CLAUDE.md', 'START_HERE.md', '.github/copilot-instructions.md']) {
      const dest = path.join(fixture, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.cpSync(path.join(root, rel), dest, { recursive: true });
    }
    assert.deepEqual(checkDocs(fixture), []);
    const handoff = path.join(fixture, 'docs/project/SESSION_HANDOFF.md');
    const content = fs.readFileSync(handoff, 'utf8');
    fs.unlinkSync(handoff);
    assert.ok(checkDocs(fixture).some(error => error.includes('Missing required document: docs/project/SESSION_HANDOFF.md')));
    fs.writeFileSync(handoff, content + '\n[Broken](missing.md)\n');
    assert.ok(checkDocs(fixture).some(error => error.includes('Broken local link')));
    fs.writeFileSync(handoff, content);
    const adapter = path.join(fixture, 'CLAUDE.md');
    fs.writeFileSync(adapter, 'This adapter no longer points at the shared instruction file. '.repeat(3));
    assert.ok(checkDocs(fixture).some(error => error.includes('Adapter does not reference')));
    fs.copyFileSync(path.join(root, 'CLAUDE.md'), adapter);
    const app = path.join(fixture, 'src/App.tsx');
    fs.appendFileSync(app, '\n<Route path="/fixture-only" element={<Dashboard />} />\n');
    assert.ok(checkDocs(fixture).some(error => error.includes('Source inventory is stale')));
    assert.ok(checkDocs(fixture).some(error => error.includes('Screen map is stale')));
    assert.ok(requiredDocs.length > 20);
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});
