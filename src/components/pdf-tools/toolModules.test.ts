import { describe, expect, it, vi } from 'vitest';
import { createToolFlags, PHASE_TWO_TOOLS, RUN_MODULES, useBuiltTools } from './toolModules';
import { TOOLS } from './toolRules';

const module = (built: unknown) => async () => ({ BUILT: built });

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
    });
    expect([...(await flags.load())]).toEqual(['bookmarks']);
  });

  it('suspends the screen until the flags are known, then answers at once', async () => {
    const flags = createToolFlags({ bookmarks: module(true), 'organise-pages': module(false), watermark: module(false), protect: module(false), redact: module(false), 'resize-crop': module(false) });
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

  it('has a run module for every phase 2 tool of the toolbar, and no other', () => {
    const phaseTwo = TOOLS.map((t) => t.id).filter((id) => !['merge', 'split', 'delete-pages', 'compress', 'page-numbers', 'images-to-pdf', 'pdf-to-images'].includes(id));
    expect([...PHASE_TWO_TOOLS].sort()).toEqual(phaseTwo.sort());
    expect(Object.keys(RUN_MODULES).sort()).toEqual(phaseTwo.sort());
  });

  it('every run module in the tree exports a boolean BUILT and a step function (stub or real)', async () => {
    for (const tool of PHASE_TWO_TOOLS) {
      const loaded = await RUN_MODULES[tool]();
      expect(typeof loaded.BUILT, tool).toBe('boolean');
      expect(typeof loaded.step, tool).toBe('function');
    }
  }, 60_000);
});
