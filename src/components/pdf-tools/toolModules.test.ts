import { describe, expect, it, vi } from 'vitest';
import { createToolFlags, MODULE_TOOLS, PHASE_THREE_TOOLS, PHASE_TWO_TOOLS, RUN_MODULES, toolFlags, useBuiltTools } from './toolModules';
import { TOOLS } from './toolRules';

const module = (built: unknown) => async () => ({ BUILT: built });
// The phase 3 tools, all still stubs (BUILT false) in these cases.
const PHASE_THREE_UNBUILT = { 'pdf-to-excel': module(false), 'pdf-to-word': module(false), 'document-check': module(false), compare: module(false), ocr: module(false) };

describe('which phase 2 tools are built', () => {
  it('reads BUILT from each run module once, and counts only a module that says true', async () => {
    const watermark = vi.fn(module(true));
    const flags = createToolFlags({
      bookmarks: module(false),
      'organise-pages': module('true'),
      watermark,
      protect: module(undefined),
      redact: module(true),
      'resize-crop': module(false),
      ...PHASE_THREE_UNBUILT,
    });
    expect(flags.current()).toBeNull();
    const first = flags.load();
    expect(flags.load()).toBe(first);
    expect([...(await first)].sort()).toEqual(['redact', 'watermark']);
    expect([...flags.current()!].sort()).toEqual(['redact', 'watermark']);
    await flags.load();
    expect(watermark).toHaveBeenCalledTimes(1);
  });

  it('treats a module that cannot be loaded as built, so a built tool never hides behind "Soon"', async () => {
    const flags = createToolFlags({
      bookmarks: () => Promise.reject(new Error('Failed to fetch dynamically imported module')),
      'organise-pages': module(false),
      watermark: module(false),
      protect: module(false),
      redact: module(false),
      'resize-crop': module(false),
      ...PHASE_THREE_UNBUILT,
    });
    expect([...(await flags.load())]).toEqual(['bookmarks']);
  });

  it('suspends the screen until the flags are known, then answers at once', async () => {
    const flags = createToolFlags({ bookmarks: module(true), 'organise-pages': module(false), watermark: module(false), protect: module(false), redact: module(false), 'resize-crop': module(false), ...PHASE_THREE_UNBUILT });
    let thrown: unknown;
    try {
      useBuiltTools(flags);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Promise);
    await thrown;
    expect([...useBuiltTools(flags)]).toEqual(['bookmarks']);
  });

  it('the screen knows at once that every module tool is built, without loading any tool code (the section must not wait for every tool before it shows)', () => {
    // Read synchronously, before anything could have been loaded: the screen's own flags never suspend it.
    const known = toolFlags.current();
    expect(known).not.toBeNull();
    expect([...(known ?? [])].sort()).toEqual([...MODULE_TOOLS].sort());
  });

  it('has a run module for every phase 2 and phase 3 tool of the toolbar, and no other', () => {
    const phaseOne = ['merge', 'split', 'delete-pages', 'compress', 'page-numbers', 'images-to-pdf', 'pdf-to-images'];
    const withModule = TOOLS.map((t) => t.id).filter((id) => !phaseOne.includes(id));
    expect([...PHASE_TWO_TOOLS, ...PHASE_THREE_TOOLS].sort()).toEqual(withModule.sort());
    expect([...MODULE_TOOLS].sort()).toEqual(withModule.sort());
    expect(Object.keys(RUN_MODULES).sort()).toEqual(withModule.sort());
  });

  it('every run module in the tree exports a boolean BUILT and a step function (stub or real)', async () => {
    for (const tool of MODULE_TOOLS) {
      const loaded = await RUN_MODULES[tool]();
      expect(typeof loaded.BUILT, tool).toBe('boolean');
      expect(typeof loaded.step, tool).toBe('function');
    }
  }, 60_000);

  it('the five phase 3 run modules are built (T-064): PDF to Excel, PDF to Word, Make searchable, Document check and Compare are usable, none is "soon"', async () => {
    expect([...PHASE_THREE_TOOLS].sort()).toEqual(['compare', 'document-check', 'ocr', 'pdf-to-excel', 'pdf-to-word']);
    for (const tool of PHASE_THREE_TOOLS) {
      expect((await RUN_MODULES[tool]()).BUILT, tool).toBe(true);
    }
  }, 60_000);

  it('every phase 2 run module in the tree is built too', async () => {
    for (const tool of PHASE_TWO_TOOLS) expect((await RUN_MODULES[tool]()).BUILT, tool).toBe(true);
  }, 60_000);
});
