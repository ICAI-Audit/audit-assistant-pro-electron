import { describe, expect, it } from 'vitest';
import type { ToolId, WorkingFile } from '@/lib/pdf-tools/types';
import { TOOLS, toolAvailability } from './toolRules';

const file = (kind: 'pdf' | 'image'): WorkingFile => ({
  id: Math.random().toString(36),
  name: kind === 'pdf' ? 'a.pdf' : 'a.png',
  kind,
  mimeType: kind === 'pdf' ? 'application/pdf' : 'image/png',
  origin: 'computer',
  bytes: new Uint8Array(1),
  size: 1,
  pageCount: kind === 'pdf' ? 2 : null,
  wasProtected: false,
  hasRestrictions: false,
  hasSignature: false,
  sentTo: [],
});

const pdf = () => file('pdf');
const img = () => file('image');
const enabled = (tool: ToolId, selection: WorkingFile[]) => toolAvailability(tool, selection).enabled;

describe('toolAvailability', () => {
  it('lists every phase-1 tool once', () => {
    expect(TOOLS.map((t) => t.id).sort()).toEqual(['compress', 'delete-pages', 'images-to-pdf', 'merge', 'page-numbers', 'pdf-to-images', 'split']);
  });

  it('merge needs two or more files of any kind', () => {
    expect(enabled('merge', [])).toBe(false);
    expect(enabled('merge', [pdf()])).toBe(false);
    expect(enabled('merge', [pdf(), img()])).toBe(true);
    expect(toolAvailability('merge', [pdf()])).toEqual({ enabled: false, reason: 'Select at least two files to merge. Images are added as pages.' });
  });

  it.each(['split', 'delete-pages', 'page-numbers', 'pdf-to-images'] as const)('%s needs exactly one PDF', (tool) => {
    expect(enabled(tool, [pdf()])).toBe(true);
    expect(enabled(tool, [])).toBe(false);
    expect(enabled(tool, [pdf(), pdf()])).toBe(false);
    expect(enabled(tool, [img()])).toBe(false);
    const result = toolAvailability(tool, [pdf(), pdf()]);
    expect(result.enabled === false && result.reason).toMatch(/^Select exactly one PDF/);
  });

  it('compress needs one or more PDFs and nothing else', () => {
    expect(enabled('compress', [pdf()])).toBe(true);
    expect(enabled('compress', [pdf(), pdf()])).toBe(true);
    expect(enabled('compress', [])).toBe(false);
    expect(enabled('compress', [pdf(), img()])).toBe(false);
  });

  it('images to PDF needs one or more images and nothing else', () => {
    expect(enabled('images-to-pdf', [img()])).toBe(true);
    expect(enabled('images-to-pdf', [img(), img()])).toBe(true);
    expect(enabled('images-to-pdf', [])).toBe(false);
    expect(enabled('images-to-pdf', [img(), pdf()])).toBe(false);
  });
});
