import { describe, expect, it } from 'vitest';
import type { ToolId, WorkingFile } from '@/lib/pdf-tools/types';
import { TOOL_ICONS } from './toolIcons';
import { COMING_SOON, TOOLS, toolAvailability, toolbarMove, toolInfo } from './toolRules';

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
  it('lists every tool once, in the toolbar order of design section 4', () => {
    expect(TOOLS.map((t) => `${t.group}: ${t.id}`)).toEqual([
      'Organise: merge',
      'Organise: split',
      'Organise: delete-pages',
      'Organise: organise-pages',
      'Organise: resize-crop',
      'Organise: compress',
      'Prepare: page-numbers',
      'Prepare: watermark',
      'Prepare: redact',
      'Prepare: bookmarks',
      'Prepare: protect',
      'Convert: images-to-pdf',
      'Convert: pdf-to-images',
    ]);
    for (const tool of TOOLS) expect(TOOL_ICONS[tool.id], tool.id).toBeTruthy();
  });

  it('keeps the four tools of a later phase as "Soon", and no phase 2 tool among them', () => {
    expect(COMING_SOON.map((t) => `${t.group}: ${t.label}`)).toEqual([
      'Convert: PDF to Excel',
      'Convert: PDF to Word',
      'Convert: Make searchable',
      'Review: Review',
    ]);
    const built = new Set<string>(TOOLS.map((t) => t.id));
    expect(COMING_SOON.filter((t) => built.has(t.key))).toEqual([]);
  });

  it('moves along the toolbar with the arrow keys, Home and End, and stops at its ends (UX audit C11)', () => {
    expect(toolbarMove('ArrowRight', 0, 18)).toBe(1);
    expect(toolbarMove('ArrowDown', 17, 18)).toBe(17);
    expect(toolbarMove('ArrowLeft', 0, 18)).toBe(0);
    expect(toolbarMove('ArrowUp', 5, 18)).toBe(4);
    expect(toolbarMove('Home', 9, 18)).toBe(0);
    expect(toolbarMove('End', 2, 18)).toBe(17);
    expect(toolbarMove('Enter', 2, 18)).toBeNull();
    expect(toolbarMove('ArrowRight', 0, 0)).toBeNull();
  });

  it('Page numbers says it adds headers and footers too (design 5.17)', () => {
    expect(toolInfo('page-numbers').description).toBe('Add page numbers, headers and footers.');
  });

  it('Organise pages is described with its own word, "rotate" (the owner\'s word; its dialog says Rotate)', () => {
    expect(toolInfo('organise-pages').description).toBe('Reorder, rotate and remove the pages of one PDF.');
  });

  it('merge needs two or more files of any kind', () => {
    expect(enabled('merge', [])).toBe(false);
    expect(enabled('merge', [pdf()])).toBe(false);
    expect(enabled('merge', [pdf(), img()])).toBe(true);
    expect(toolAvailability('merge', [pdf()])).toEqual({ enabled: false, reason: 'Select at least two files to merge. Images are added as pages.' });
  });

  it.each(['split', 'delete-pages', 'page-numbers', 'pdf-to-images', 'organise-pages', 'resize-crop', 'watermark', 'redact', 'bookmarks', 'protect'] as const)('%s needs exactly one PDF', (tool) => {
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

  it('refuses a result of Protect as the input of every tool, with the reason of design 5.18', () => {
    const locked = { ...pdf(), origin: 'result' as const, protectedOutput: true };
    for (const tool of TOOLS.map((t) => t.id)) {
      expect(toolAvailability(tool, [locked]), tool).toEqual({ enabled: false, reason: 'This file is protected by PDF Tools. Use the file it was made from.' });
      expect(toolAvailability(tool, [pdf(), locked]).enabled, tool).toBe(false);
    }
    // the file it was made from is fine
    expect(enabled('protect', [pdf()])).toBe(true);
  });

  it('images to PDF needs one or more images and nothing else', () => {
    expect(enabled('images-to-pdf', [img()])).toBe(true);
    expect(enabled('images-to-pdf', [img(), img()])).toBe(true);
    expect(enabled('images-to-pdf', [])).toBe(false);
    expect(enabled('images-to-pdf', [img(), pdf()])).toBe(false);
  });
});
