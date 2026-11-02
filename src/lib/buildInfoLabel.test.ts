import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BuildInfoLabel } from '@/components/layout/BuildInfoLabel';
import { BUILD_MESSAGE } from '@/config/buildMessage';

describe('build information label', () => {
  const html = renderToStaticMarkup(createElement(BuildInfoLabel));

  it('renders the central message lines and the build commit', () => {
    for (const line of BUILD_MESSAGE.lines) expect(html).toContain(line);
    expect(html).toContain('Welcome to ICAI Audit Tool');
    expect(html).toContain('Developer handover baseline: 2 November 2026');
    expect(html).toContain(`Build: ${__BUILD_COMMIT__}`);
    expect(__BUILD_COMMIT__).toMatch(/^([0-9a-f]{7,}|unknown)$/);
  });

  it('shows "Local changes present" only when the build flagged modified tracked files', () => {
    expect(html.includes('Local changes present')).toBe(__BUILD_DIRTY__);
  });

  it('makes no claim about being current or about new commits', () => {
    expect(html).not.toMatch(/latest|up to date|new commits/i);
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
