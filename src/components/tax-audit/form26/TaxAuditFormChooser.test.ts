import { readFileSync, existsSync } from 'node:fs';
import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

// The application's contexts make their database client when they are imported; nothing here sends a request.
vi.hoisted(() => {
  const holder = globalThis as { window?: unknown };
  if (!holder.window) holder.window = { electronAPI: { sqliteQuery: async () => ({ data: null, error: { message: 'No database in this test.' } }) } };
});

import { TaxAuditFormChooserView } from '@/components/tax-audit/form26/TaxAuditFormChooser';
import type { Form26SharedParts } from '@/components/tax-audit/form26/Form26RightPane';
import { expectFinished, visibleText } from '@/lib/__fixtures__/taxAuditForm26/renderCheck';

const ThreeCd: ComponentType = () => createElement('section', { 'data-page': '3cd' }, 'The Form 3CD page as today');
const parts: Form26SharedParts = { EvidenceRail: () => null };
const draw = (view: 'three-cd' | 'form26' | 'checking' | 'year-unknown', financialYear = '2026-27') =>
  renderToStaticMarkup(createElement(MemoryRouter, null, createElement(TaxAuditFormChooserView, { view, ThreeCd, parts, financialYear })));

describe('TaxAuditFormChooser (task 19)', () => {
  it('Form 3CD: the page exactly as it is, with no element around it', () => {
    expect(draw('three-cd')).toBe(renderToStaticMarkup(createElement(ThreeCd)));
  });

  it('while the Form 3CD check of a year not understood runs: the opening state, not the Form 3CD page', () => {
    const markup = draw('checking');
    expect(visibleText(markup)).toContain('Opening Form No. 26.');
    expect(markup).not.toContain('data-page="3cd"');
    expectFinished(markup);
  });

  it('Form No. 26: the workspace is loaded lazily; until it is there the opening state is shown', () => {
    const markup = draw('form26');
    expect(visibleText(markup)).toContain('Opening Form No. 26.');
    expect(markup).not.toContain('data-page="3cd"');
  });

  it('a year not understood and no Form 3CD audit: the plain message and a link to Engagements', async () => {
    draw('year-unknown', 'Year 26');
    await import('@/components/tax-audit/form26/Form26States');
    await new Promise((resolve) => setTimeout(resolve, 0));
    const markup = draw('year-unknown', 'Year 26');
    const text = visibleText(markup);
    expect(text).toContain('The tax audit form cannot be chosen');
    expect(text).toContain('The financial year of this engagement ("Year 26") is not in the form 2026-27, so the tax audit form cannot be chosen. Correct it in Engagements.');
    expect(markup).toContain('href="/engagements"');
    expect(markup).not.toContain('data-page="3cd"');
    expectFinished(markup);
  });

  it('an earlier-year engagement pays nothing: the chooser reaches neither the Form No. 26 definition nor the workspace by a static import', () => {
    const root = new URL('../../../', import.meta.url);
    const seen = new Set<string>();
    const resolve = (from: string, spec: string): string | null => {
      let base: URL;
      if (spec.startsWith('@/')) base = new URL(spec.slice(2), root);
      else if (spec.startsWith('.')) base = new URL(spec, new URL(from));
      else return null;                                     // a package
      for (const ext of ['', '.ts', '.tsx', '/index.ts', '/index.tsx']) {
        const url = new URL(base.href + ext);
        if (existsSync(url) && !url.pathname.endsWith('/')) return url.href;
      }
      return null;
    };
    const walk = (file: string) => {
      if (seen.has(file)) return;
      seen.add(file);
      const source = readFileSync(new URL(file), 'utf8');
      // Static imports and re-exports only; `import type` and `import()` are not part of the bundle's start.
      for (const match of source.matchAll(/^\s*(?:import|export)\s+(?!type\s)(?:[^'";]*?\sfrom\s+)?['"]([^'"]+)['"]/gm)) {
        const target = resolve(file, match[1]);
        if (target) walk(target);
      }
    };
    walk(new URL('TaxAuditFormChooser.tsx', import.meta.url).href);
    const reached = [...seen].map((file) => file.slice(root.href.length));
    expect(reached).toContain('components/tax-audit/form26/TaxAuditFormChooser.tsx');
    expect(reached.filter((file) => /taxAuditForm26(Definition|Clauses|Workspace|Store|Session)|Form26(Workspace|States)\.tsx/.test(file))).toEqual([]);
  });
});
