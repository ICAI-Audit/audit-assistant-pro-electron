// Where the phase 2 tools' run modules are, loaded lazily (each is its own chunk), and which of them are
// built. A run module says so with `export const BUILT` (toolStep.ts); a tool whose module is still the
// integration stub stays a "Soon" button. `createToolFlags` reads the flags from the modules (used by the
// tests, which hold every module to BUILT); the screen itself is told at once (`toolFlags`, below).
import type { PhaseThreeToolId, PhaseTwoToolId, ToolId } from '@/lib/pdf-tools/types';
import type { BookmarksRunOptions } from './bookmarksRun';
import type { ExcelRunOptions } from './convert/excelRun';
import type { WordRunOptions } from './convert/wordRun';
import type { OcrRunOptions } from './ocr/ocrRun';
import type { CompareRunOptions } from './review/compareRun';
import type { DocumentCheckRunOptions } from './review/documentCheckRun';
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

export interface PhaseThreeRunOptions {
  'pdf-to-excel': ExcelRunOptions;
  'pdf-to-word': WordRunOptions;
  'document-check': DocumentCheckRunOptions;
  compare: CompareRunOptions;
  ocr: OcrRunOptions;
}

/** The tools that have a run module (phase 2 and phase 3). */
export type ModuleToolId = PhaseTwoToolId | PhaseThreeToolId;
export type ModuleRunOptions = PhaseTwoRunOptions & PhaseThreeRunOptions;

export type RunModuleLoaders = { [T in ModuleToolId]: () => Promise<RunModule<ModuleRunOptions[T]>> };

/** The paths the dialog lanes own (wave2-rules.md); runTool.ts runs `step`, the toolbar reads `BUILT`. */
export const RUN_MODULES: RunModuleLoaders = {
  bookmarks: () => import('./bookmarksRun'),
  'organise-pages': () => import('./organiseRun'),
  'resize-crop': () => import('./pageBoxRun'),
  watermark: () => import('./watermarkRun'),
  protect: () => import('./protectRun'),
  redact: () => import('./redact/redactRun'),
  'pdf-to-excel': () => import('./convert/excelRun'),
  'pdf-to-word': () => import('./convert/wordRun'),
  'document-check': () => import('./review/documentCheckRun'),
  compare: () => import('./review/compareRun'),
  ocr: () => import('./ocr/ocrRun'),
};

export const PHASE_TWO_TOOLS: readonly PhaseTwoToolId[] = ['organise-pages', 'resize-crop', 'watermark', 'redact', 'bookmarks', 'protect'];

export const PHASE_THREE_TOOLS: readonly PhaseThreeToolId[] = ['pdf-to-excel', 'pdf-to-word', 'ocr', 'document-check', 'compare'];

/** Every tool whose built state is read from its run module. */
export const MODULE_TOOLS: readonly ModuleToolId[] = [...PHASE_TWO_TOOLS, ...PHASE_THREE_TOOLS];

export interface ToolFlags {
  /** Starts reading the flags (once); resolves with the built tools of phase 2 and 3. Never rejects. */
  load(): Promise<ReadonlySet<ToolId>>;
  /** The built phase 2 tools, or null while they are being read. */
  current(): ReadonlySet<ToolId> | null;
}

/**
 * A module that cannot be loaded counts as built: the button stays usable and the run (or the dialog)
 * then says that the tool could not be loaded, instead of a built tool hiding behind "Soon".
 */
export function createToolFlags(loaders: { [T in ModuleToolId]: () => Promise<{ BUILT?: unknown }> }): ToolFlags {
  let built: ReadonlySet<ToolId> | null = null;
  let pending: Promise<ReadonlySet<ToolId>> | null = null;
  return {
    load() {
      pending ??= Promise.all(
        MODULE_TOOLS.map(async (tool) => {
          try {
            return (await loaders[tool]()).BUILT === true ? tool : null;
          } catch {
            return tool;
          }
        }),
      ).then((tools) => {
        built = new Set(tools.filter((tool): tool is ModuleToolId => tool !== null));
        return built;
      });
      return pending;
    },
    current: () => built,
  };
}

// Every module tool is built (phase 2 since T-052, phase 3 since T-064), and toolModules.test.ts holds each run
// module to BUILT === true. So the screen is told at once and loads no tool code to find out: reading the
// flags from the modules made the whole section wait for the code of every tool (Redact, the converters, the
// text reader for scans) before it could show. A tool's code is loaded when the tool is first opened.
const ALL_BUILT: ReadonlySet<ToolId> = new Set<ToolId>(MODULE_TOOLS);
export const toolFlags: ToolFlags = { load: () => Promise.resolve(ALL_BUILT), current: () => ALL_BUILT };

/** Whether a tool can be used: phase 1's always, a phase 2 or 3 tool once its run module says BUILT. */
export function toolIsBuilt(tool: ToolId, built: ReadonlySet<ToolId>): boolean {
  return (MODULE_TOOLS as readonly ToolId[]).includes(tool) ? built.has(tool) : true;
}

/**
 * The built phase 2 and 3 tools, for the screen. Until they are known it suspends (the screen's own Suspense
 * shows "Loading PDF Tools…"); call it first in the component, before any other hook.
 */
export function useBuiltTools(flags: ToolFlags = toolFlags): ReadonlySet<ToolId> {
  const known = flags.current();
  if (known) return known;
  throw flags.load();
}
