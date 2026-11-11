import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BuildInfoLabel } from '@/components/layout/BuildInfoLabel';
import { buildDetailLines } from '@/config/buildMessage';
import { BUILD_MESSAGE } from '@/config/buildMessage';

describe('build information label', () => {
  const html = renderToStaticMarkup(createElement(BuildInfoLabel));

  it('renders the central message lines and the build commit', () => {
    for (const line of BUILD_MESSAGE.lines) expect(html).toContain(line);
    expect(html).toContain('Update:');
    expect(html).toContain(BUILD_MESSAGE.updateNote);
    expect(html).not.toContain(__BUILD_COMMIT__);
    expect(html).toContain('border-2 border-solid border-red-600');
    expect(__BUILD_COMMIT__).toMatch(/^([0-9a-f]{7,}|unknown)$/);
  });

  it('shows "Local changes present" only when the build flagged modified tracked files', () => {
    expect(buildDetailLines().includes('Local changes present')).toBe(__BUILD_DIRTY__);
    expect(buildDetailLines()).toContain(`Commit: ${__BUILD_COMMIT__}`);
    expect(html).not.toContain('Local changes present');
  });

  it('makes no claim about being current or about new commits', () => {
    expect(html).not.toMatch(/latest|up to date|new commits/i);
  });

  it('identifies the merged GSTIN update on the startup label', () => {
    expect(html).toContain('Code baseline: 11 November 2026');
    expect(html).toContain('Update: GSTIN normalization and validation (PR #108)');
    expect(html).not.toContain('Initial developer handover');
    expect(buildDetailLines()).toContain('Source branch: main');
  });

  it('is the only source of the text for both the login page and the header', () => {
    for (const file of ['src/pages/Auth.tsx', 'src/components/layout/Header.tsx']) {
      const source = readFileSync(file, 'utf8');
      expect(source).toContain("import { BuildInfoLabel } from '@/components/layout/BuildInfoLabel'");
      expect(source).toContain('<BuildInfoLabel');
      expect(source).not.toContain('Developer handover baseline');
    }
  });
});
