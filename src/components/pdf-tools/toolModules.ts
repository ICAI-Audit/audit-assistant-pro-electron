// Where the phase 2 tools' run modules are, loaded lazily (each is its own chunk), and which of them are
// built. A run module says so with `export const BUILT` (toolStep.ts); a tool whose module is still the
// integration stub stays a "Soon" button. The screen reads the flags once, before it first shows the
// toolbar (useBuiltTools suspends until they are known), so a button never flickers from "Soon" to usable.
import type { PhaseTwoToolId, ToolId } from '@/lib/pdf-tools/types';
import type { BookmarksRunOptions } from './bookmarksRun';
import type { OrganisePagesRunOptions } from './organiseRun';
import type { PageBoxRunOptions } from './pageBoxRun';
import type { ProtectRunOptions } from './protectRun';
import type { RedactRunOptions } from './redact/redactRun';
import type { RunModule } from './toolStep';
import type { WatermarkRunOptions } from './watermarkRun';

export interface PhaseTwoRunOptions {
  bookmarks: BookmarksRunOptions;
  'organise-pages': OrganisePagesRunOptions;
  'resize-crop': PageBoxRunOptions;
  watermark: WatermarkRunOptions;
  protect: ProtectRunOptions;
  redact: RedactRunOptions;
}

export type RunModuleLoaders = { [T in PhaseTwoToolId]: () => Promise<RunModule<PhaseTwoRunOptions[T]>> };

/** The paths the dialog lanes own (wave2-rules.md); runTool.ts runs `step`, the toolbar reads `BUILT`. */
export const RUN_MODULES: RunModuleLoaders = {
  bookmarks: () => import('./bookmarksRun'),
  'organise-pages': () => import('./organiseRun'),
  'resize-crop': () => import('./pageBoxRun'),
  watermark: () => import('./watermarkRun'),
  protect: () => import('./protectRun'),
  redact: () => import('./redact/redactRun'),
};

export const PHASE_TWO_TOOLS: readonly PhaseTwoToolId[] = ['organise-pages', 'resize-crop', 'watermark', 'redact', 'bookmarks', 'protect'];

export interface ToolFlags {
  /** Starts reading the flags (once); resolves with the built phase 2 tools. Never rejects. */
  load(): Promise<ReadonlySet<ToolId>>;
  /** The built phase 2 tools, or null while they are being read. */
  current(): ReadonlySet<ToolId> | null;
}

/**
 * A module that cannot be loaded counts as built: the button stays usable and the run (or the dialog)
 * then says that the tool could not be loaded, instead of a built tool hiding behind "Soon".
 */
export function createToolFlags(loaders: { [T in PhaseTwoToolId]: () => Promise<{ BUILT?: unknown }> }): ToolFlags {
  let built: ReadonlySet<ToolId> | null = null;
  let pending: Promise<ReadonlySet<ToolId>> | null = null;
  return {
    load() {
      pending ??= Promise.all(
        PHASE_TWO_TOOLS.map(async (tool) => {
          try {
            return (await loaders[tool]()).BUILT === true ? tool : null;
          } catch {
            return tool;
          }
        }),
      ).then((tools) => {
        built = new Set(tools.filter((tool): tool is PhaseTwoToolId => tool !== null));
        return built;
      });
      return pending;
    },
    current: () => built,
  };
}

export const toolFlags: ToolFlags = createToolFlags(RUN_MODULES);

/** Whether a tool can be used: phase 1's always, a phase 2 tool once its run module says BUILT. */
export function toolIsBuilt(tool: ToolId, built: ReadonlySet<ToolId>): boolean {
  return (PHASE_TWO_TOOLS as readonly ToolId[]).includes(tool) ? built.has(tool) : true;
}

/**
 * The built phase 2 tools, for the screen. Until they are known it suspends (the screen's own Suspense
 * shows "Loading PDF Tools…"); call it first in the component, before any other hook.
 */
export function useBuiltTools(flags: ToolFlags = toolFlags): ReadonlySet<ToolId> {
  const known = flags.current();
  if (known) return known;
  throw flags.load();
}
