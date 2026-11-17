import {
  Component,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ComponentType,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { toast } from 'sonner';
import { Archive, FilePlus2, Info, Loader2, Save, ShieldCheck, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { stripExtension } from '@/lib/pdf-tools/fileNames';
import { sha256Hex } from '@/lib/pdf-tools/hash';
import { forgetMatchedText } from '@/lib/pdf-tools/matchedText';
import { contextKeyFor, LIST_MAX_BYTES, LIST_WARN_BYTES, listHeldBytes, selectedInOrder, viewableFile } from '@/lib/pdf-tools/workingList';
import type { ToolId, WorkingFile } from '@/lib/pdf-tools/types';
import CompressDialog from './dialogs/CompressDialog';
import DeletePagesDialog from './dialogs/DeletePagesDialog';
import ImagesToPdfDialog from './dialogs/ImagesToPdfDialog';
import MergeDialog from './dialogs/MergeDialog';
import PageNumbersDialog from './dialogs/PageNumbersDialog';
import PasswordDialog from './dialogs/PasswordDialog';
import PdfToImagesDialog from './dialogs/PdfToImagesDialog';
import SplitDialog from './dialogs/SplitDialog';
import type { RunScope, ToolDialogProps } from './dialogs/useToolRun';
import VaultPickerDialog from './dialogs/VaultPickerDialog';
import VaultSaveDialog from './dialogs/VaultSaveDialog';
import WorkingPaperDialog from './dialogs/WorkingPaperDialog';
import {
  addToVault,
  attachSummary,
  attachToWorkingPaper,
  dropMissingVaultRecords,
  isUnsavedResult,
  LOG_FAILED,
  recordComputerSave,
  resultsOf,
  shouldCloseAfter,
  vaultSummary,
  type BatchResult,
  type DestinationScope,
  type SummaryToast,
} from './destinations';
import FileList from './FileList';
import { fileMessageId, RESULT_MESSAGE } from './fileMessages';
import { formatBytes, plainMessage } from './format';
import HintButton from './HintButton';
import PagePanel from './PagePanel';
import { clearThumbnails, releasePdfRenderer } from './pdfRenderer';
import type { RunResult } from './runTool';
import { FOCUS_GRACE_MS, FOLDER_NOT_CHOSEN, PICKER_STALL_MS, planSaveResult, watchSave, type SaveReport } from './savePlan';
import { cleanedName, saveAsZip, saveManyToFolder, saveOne, SaveFailedError, type SaveOutcome } from './saveToComputer';
import ToolBar from './ToolBar';
import { toolFlags, toolIsBuilt, useBuiltTools } from './toolModules';
import { shouldDropContext } from './contextGuard';
import { delayedBusy } from './delayedBusy';
import { focusAfterListChange } from './listFocus';
import { ENGAGEMENT_STORAGE_KEY } from './engagementWatch';
import { useDestinationServices } from './useDestinationServices';
import { useFileIntake, type IntakeStage } from './useFileIntake';
import { useWorkingList } from './useWorkingList';
import { selectionAfterAdding, startBatch, type AddBatch } from './addedSelection';
import { WHY_LINE_MS, whyLineText, WhyContext } from './whyLine';
import { focusQuietly } from './quietFocus';
import { vaultChoices, vaultFileLike } from './vaultBytes';
import PageViewer from './viewer/PageViewer';

const ACCEPT = '.pdf,application/pdf,.jpg,.jpeg,image/jpeg,.png,image/png,.tif,.tiff,image/tiff,.webp,image/webp,.bmp,image/bmp,.gif,image/gif';

const STAGE_TEXT: Record<IntakeStage, string> = {
  reading: 'Reading',
  checking: 'Checking',
  unlocking: 'Unlocking',
  converting: 'Converting',
  password: 'Waiting for the password of',
};

function zipNameFor(files: WorkingFile[]): string {
  const first = stripExtension(files[0].name);
  return files.length === 1 ? first : `${first} and ${files.length - 1} more`;
}

// Messages that name a file carry an id from fileMessages.ts: they go when the list does (REV-B S3).
const RESULT_TOAST = RESULT_MESSAGE;
/** Long enough to reach its buttons (UX audit C6.10). */
const RESULT_TOAST_MS = 10_000;

// Which phase 2 tools are built is read as soon as this screen's code loads (toolModules.ts).
void toolFlags.load();

/**
 * Each tool's dialog. Phase 2's are loaded when first opened (each is its own chunk, owned by its dialog
 * lane); until its run module says BUILT, a tool is "Soon" on the toolbar and its dialog never opens.
 */
const TOOL_DIALOGS: Record<ToolId, ComponentType<ToolDialogProps>> = {
  merge: MergeDialog,
  split: SplitDialog,
  'delete-pages': DeletePagesDialog,
  compress: CompressDialog,
  'page-numbers': PageNumbersDialog,
  'images-to-pdf': ImagesToPdfDialog,
  'pdf-to-images': PdfToImagesDialog,
  bookmarks: lazy(() => import('./dialogs/BookmarksDialog')),
  'organise-pages': lazy(() => import('./dialogs/OrganisePagesDialog')),
  'resize-crop': lazy(() => import('./dialogs/PageBoxDialog')),
  watermark: lazy(() => import('./dialogs/WatermarkDialog')),
  protect: lazy(() => import('./dialogs/ProtectDialog')),
  redact: lazy(() => import('./dialogs/RedactDialog')),
};

/** The read-only bookmark list beside the page panel (lane W2-B's), loaded with the first file that has bookmarks. */
const BookmarkList = lazy(() => import('./BookmarkList'));

/**
 * In place of a tool's dialog while its code loads (UX audit C7, T1-10): nothing at first, so a quick load
 * never flashes; after a moment (delayedBusy) the tool's button shows a spinner, until the dialog opens or
 * fails to.
 */
function DialogLoading({ tool, onBusy }: { tool: ToolId; onBusy: (tool: ToolId | null) => void }) {
  useEffect(
    () =>
      delayedBusy(
        () => onBusy(tool),
        () => onBusy(null),
      ),
    [tool, onBusy],
  );
  return null;
}

/**
 * A tool's dialog that fails (its code could not be loaded, or it broke while showing) closes and says so,
 * instead of taking the screen and the list with it. Nothing about the files is said or logged.
 */
class ToolDialogBoundary extends Component<{ onFailed: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    this.props.onFailed();
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/** The open destination dialog. The files are the selection as it was when the dialog opened. */
type DestinationDialog =
  | { kind: 'picker'; key: number }
  | { kind: 'vault' | 'attach'; key: number; files: WorkingFile[]; leftOut: number };

const NOT_RESULTS_VAULT = 'Only results can be added to the Evidence Vault from here. Upload originals in the Evidence Vault itself.';
const NOT_RESULTS_ATTACH = 'Only results can be attached from here. Select a file made by a tool.';
const NO_PROGRAMME = 'This engagement has no audit programme yet. Create one in Audit Execution (New Execution).';

function showSummary(summary: SummaryToast | null): void {
  if (!summary) return;
  toast[summary.tone](summary.title, { id: RESULT_TOAST, description: summary.description });
}

/** One note at a time, however many times the folder window ends without a folder. */
const FOLDER_NOTE = 'pdf-tools-folder-not-chosen';
function showFolderNotChosen(): void {
  toast.info(FOLDER_NOT_CHOSEN.title, { id: FOLDER_NOTE, description: FOLDER_NOT_CHOSEN.description });
}

export default function PdfTools() {
  // First, before any hook: the screen waits (its Suspense) until it knows which tools are built.
  const builtTools = useBuiltTools();
  const { state, contextKey, store } = useWorkingList();
  const selected = useMemo(() => selectedInOrder(state), [state]);
  const { progress, passwordRequest, addFiles, settlePassword, summary } = useFileIntake(contextKey);
  const services = useDestinationServices();
  const [activeTool, setActiveTool] = useState<{ tool: ToolId; files: WorkingFile[]; key: number } | null>(null);
  // The tool whose dialog's code is still loading after a moment (its button shows a spinner).
  const [dialogLoading, setDialogLoading] = useState<ToolId | null>(null);
  const [destination, setDestination] = useState<DestinationDialog | null>(null);
  // The page viewer opened from a row's View action, and the control that opened it.
  const [viewing, setViewing] = useState<{ fileId: string; opener: HTMLElement | null; placeholder: string | null; key: number } | null>(null);
  // Which destination button is waiting for its vault check (shown only after a moment).
  const [checking, setChecking] = useState<'vault' | 'attach' | null>(null);
  const [reveal, setReveal] = useState<{ id: string; token: number } | null>(null);
  const [saving, setSaving] = useState(false);
  // Which click's save holds the Save button: a newer one takes over from one that stalled.
  const saveRun = useRef(0);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const stripAddButton = useRef<HTMLButtonElement>(null);
  const stripVaultButton = useRef<HTMLButtonElement>(null);
  const lastAddedFrom = useRef<'computer' | 'vault'>('computer');
  // Destination dialogs open from state, with no trigger for Radix to return focus to.
  const destinationOpener = useRef<HTMLElement | null>(null);

  // What a tool run is tied to: read from the guarded state the moment Run is pressed. A list
  // that is not this engagement's has session -1, which the store never accepts.
  const scope = useRef<RunScope>({ contextKey, session: state.session });
  scope.current = { contextKey, session: state.session };
  const getScope = useCallback(() => scope.current, []);
  // The hooks' functions of the latest render: taken at the click that confirms a destination.
  const latestServices = useRef(services);
  latestServices.current = services;
  // What the list holds, preview bytes of protected results included (workingList.ts heldBytes).
  const listBytes = useMemo(() => listHeldBytes(state.files), [state.files]);

  /**
   * The scope a destination is tied to, taken at the confirming click before anything is awaited:
   * null unless the screen's list, the store, the user and the engagement all agree.
   */
  const destinationScope = useCallback((): DestinationScope | null => {
    const { contextKey: key, session } = scope.current;
    const { engagementId, userId } = latestServices.current;
    if (!key || session < 0 || !engagementId || !userId || key !== contextKeyFor(userId, engagementId)) return null;
    const live = store.getState();
    return live.contextKey === key && live.session === session ? { contextKey: key, session, engagementId, userId } : null;
  }, [store]);

  // Whether what the screen shows is still the store's (checked before a message names a file). The
  // engagement saved by EngagementContext is read too: with the screen closed, the watcher can take
  // up to a second to notice a change.
  const stillCurrent = useCallback(() => {
    const live = store.getState();
    if (scope.current.session < 0 || live.contextKey !== scope.current.contextKey || live.session !== scope.current.session) return false;
    let saved: string | null = null;
    try {
      saved = window.localStorage.getItem(ENGAGEMENT_STORAGE_KEY);
    } catch {
      saved = null;
    }
    return !shouldDropContext(live.contextKey, saved);
  }, [store]);

  useEffect(
    () => () => {
      releasePdfRenderer();
      clearThumbnails(); // the previews drawn for this screen's files go with it
      toast.dismiss(RESULT_TOAST); // its buttons act on this screen's list
    },
    [],
  );

  // A tool or destination dialog, and the page viewer, belong to the engagement and session they
  // were opened in.
  useEffect(() => {
    setActiveTool(null);
    setDestination(null);
    setViewing(null);
    toast.dismiss(RESULT_TOAST);
    addBatch.current = null;
    clearThumbnails(); // another engagement's (or user's) previews are not kept
  }, [contextKey, state.session]);

  const closeTool = useCallback(() => setActiveTool(null), []);
  // A page the bookmark list asked the page panel to show.
  const [showPage, setShowPage] = useState<{ fileId: string; page: number; token: number } | null>(null);
  const toolFailed = useCallback(() => {
    setActiveTool(null);
    toast.error('The tool could not be opened', { description: 'Try again; if this keeps happening, restart the application.' });
  }, []);
  const viewFile = useCallback((fileId: string, opener: HTMLElement) => {
    toast.dismiss(RESULT_TOAST); // it would sit over the viewer
    // The row's first-page thumbnail, if drawn, is shown enlarged until the sharp drawing arrives.
    const thumb = opener.closest('[data-testid="pdf-tools-row"]')?.querySelector<HTMLImageElement>('img[data-testid="pdf-tools-thumb"]');
    setViewing({ fileId, opener, placeholder: thumb?.src ?? null, key: Date.now() });
  }, []);
  const closeViewer = useCallback(() => setViewing(null), []);
  // The page panel's viewer (a click on a page, T1-11): the result message would sit over it too.
  const dismissResultToast = useCallback(() => toast.dismiss(RESULT_TOAST), []);
  // Looked up in the guarded list: a file that has left it (or another engagement's) is never shown.
  const viewed = viewing ? (state.files.find((f) => f.id === viewing.fileId) ?? null) : null;
  useEffect(() => {
    if (viewing && !viewed) setViewing(null);
  }, [viewing, viewed]);
  const closeDestination = useCallback(() => setDestination(null), []);

  // Results are added by then; show them selected, in view, and say what was made.
  const finishRun = useCallback(
    (result: RunResult, session: number) => {
      setActiveTool(null);
      if (result.status !== 'added' || store.getState().session !== session) return;
      store.setSelected(result.ids);
      setReveal({ id: result.ids[0], token: Date.now() });
      // One result toast at a time: a newer one replaces it, and opening a tool dismisses it. It offers
      // the next step for the results just made (UX audit C6.10): the buttons act on those rows, looked
      // up again when clicked, through the same paths (and checks) as the list bar's buttons.
      const ids = result.ids;
      const { contextKey: key } = scope.current;
      const act = (what: 'save' | 'vault') => () => {
        toast.dismiss(RESULT_TOAST);
        resultActions.current[what](ids, key, session);
      };
      // The buttons sit under the message (Sonner's own action buttons squeeze a long file name into a column).
      const description = (
        <div className="space-y-2">
          {result.detail && <p>{result.detail}</p>}
          <div className="flex flex-wrap gap-1.5">
            <Button type="button" size="sm" variant="outline" className="h-7 gap-1.5 px-2 text-xs text-foreground" data-testid="pdf-tools-result-save" onClick={act('save')}>
              <Save />
              Save to computer
            </Button>
            <Button type="button" size="sm" variant="outline" className="h-7 gap-1.5 px-2 text-xs text-foreground" data-testid="pdf-tools-result-vault" onClick={act('vault')}>
              <Archive />
              Add to Evidence Vault
            </Button>
          </div>
        </div>
      );
      if (result.message) {
        toast[result.tone === 'warning' ? 'warning' : 'success'](result.message, { id: RESULT_TOAST, description, duration: RESULT_TOAST_MS });
      }
      // Spec 5.14: say so when results take the list past the warning size (intake says the same).
      if (result.listLarge) {
        toast.warning('The file list is getting large', {
          description: `The files now come to more than ${formatBytes(LIST_WARN_BYTES)}. PDF Tools may slow down; the limit is ${formatBytes(LIST_MAX_BYTES)}.`,
        });
      }
    },
    [store],
  );

  // An adding in progress (addedSelection.ts): the files it brings become the selection as they arrive.
  const addBatch = useRef<AddBatch | null>(null);
  const addAndSelect: typeof addFiles = (files) => {
    if (files.length === 0) return;
    addBatch.current ??= startBatch(store.getState().files);
    addFiles(files);
  };
  useEffect(() => {
    const batch = addBatch.current;
    if (!batch) return;
    const live = store.getState();
    const next = selectionAfterAdding(batch, live.files, live.selectedIds);
    if (next) {
      addBatch.current = next.batch;
      store.setSelected(next.selectedIds);
    }
    // The batch ends when the adding has stopped.
    if (!progress) addBatch.current = null;
  }, [state.files, progress, store]);

  const chooseFiles = () => {
    lastAddedFrom.current = 'computer';
    inputRef.current?.click();
  };

  const onInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    addAndSelect(files);
  };

  const onDrag = (event: DragEvent<HTMLDivElement>) => {
    if (!Array.from(event.dataTransfer.types).includes('Files')) return;
    event.preventDefault();
    if (event.type === 'dragleave') {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
    } else {
      event.dataTransfer.dropEffect = 'copy';
      setDragging(true);
    }
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    lastAddedFrom.current = 'computer';
    // A dropped folder arrives as an empty "file"; it can only be recognised during the drop.
    const fileItems = Array.from(event.dataTransfer.items ?? []).filter((item) => item.kind === 'file');
    const isFolder = fileItems.map((item) => Boolean(item.webkitGetAsEntry?.()?.isDirectory));
    if (isFolder.some(Boolean)) toast.error('Folders cannot be added', { description: 'Select the files inside instead.' });
    addAndSelect(Array.from(event.dataTransfer.files).filter((_, i) => !isFolder[i]));
  };

  // The dialog works on the selection, in list order, as it was when the tool was chosen.
  const onToolSelected = useCallback(
    (tool: ToolId) => {
      if (!toolIsBuilt(tool, builtTools)) return;
      toast.dismiss(RESULT_TOAST); // it would sit over the dialog's Run button
      // A second click while the same dialog is still loading, for the same files, waits for it (no restart).
      const same = (files: WorkingFile[]) => files.length === selected.length && files.every((f, i) => f.id === selected[i].id);
      setActiveTool((open) => (open && open.tool === tool && same(open.files) ? open : { tool, files: selected, key: Date.now() }));
    },
    [selected, builtTools],
  );
  const isBuilt = useCallback((tool: ToolId) => toolIsBuilt(tool, builtTools), [builtTools]);
  const ActiveDialog = activeTool ? TOOL_DIALOGS[activeTool.tool] : null;

  // Runs from the click itself: the save dialogs only open in response to the user's click.
  const saveToComputer = (asZip: boolean, chosen?: WorkingFile[]) => {
    const files = chosen ?? selected;
    if (files.length === 0 || saving) return;
    // Taken before anything is awaited: the marks and the activity entries belong to this scope.
    const { session } = store.getState();
    const target = destinationScope();
    const deps = latestServices.current.deps;
    const entries = files.map((f) => ({ name: f.name, bytes: f.bytes, mimeType: f.mimeType }));
    const mode: SaveReport['mode'] = asZip ? 'zip' : files.length === 1 ? 'one' : 'folder';
    // The fingerprints for the activity record are worked out while the user picks where to save.
    const hashing = Promise.all(files.map((f) => sha256Hex(f.bytes).catch(() => null)));
    const report = async (result: Pick<SaveReport, 'outcome' | 'written' | 'errorMessage'>) => {
      try {
        const hashes = await hashing;
        const planned = (sameSession: boolean) =>
          planSaveResult({
            mode,
            files: files.map((f, i) => ({ id: f.id, intendedName: cleanedName(entries[i]), wasProtected: f.wasProtected })),
            sameSession,
            ...result,
          });
        const plan = planned(store.getState().session === session);
        if (plan.toast) toast[plan.toast.tone](plan.toast.title, { id: fileMessageId(), ...(plan.toast.description ? { description: plan.toast.description } : {}) });
        // The files written, whether or not the scope has moved on: recordComputerSave marks them only
        // while it is current, and writes their entries (silently after a change) for the same user.
        const written = planned(true).markIds;
        if (written.length === 0 || !target) return;
        const logged = await recordComputerSave({ files, markIds: written, download: result.outcome === 'downloaded', zip: mode === 'zip', hashes }, target, deps);
        if (logged.status === 'done' && logged.logFailures > 0) toast.warning(LOG_FAILED);
      } finally {
        forgetMatchedText(); // the save batch has settled, written or not (matchedText.ts)
      }
    };

    // "Saving…" and the folder note follow watchSave (savePlan.ts). Only this click's save may change
    // the button or give the note: a newer click takes over from a save whose window never answered.
    const run = ++saveRun.current;
    const watch = watchSave({
      folder: mode === 'folder',
      stallMs: PICKER_STALL_MS,
      graceMs: FOCUS_GRACE_MS,
      hold: (on) => {
        if (saveRun.current === run) setSaving(on);
      },
      notChosen: () => {
        if (saveRun.current === run) showFolderNotChosen();
      },
      withdrawNote: () => toast.dismiss(FOLDER_NOTE),
      hasFocus: () => document.hasFocus(),
      onWindowFocus: (listener) => {
        window.addEventListener('focus', listener);
        return () => window.removeEventListener('focus', listener);
      },
    });
    const onPicked = () => watch.picked();
    const save: Promise<{ outcome: SaveOutcome; written: string[] }> =
      mode === 'zip'
        ? saveAsZip(zipNameFor(files), entries, { onPicked }).then((outcome) => ({ outcome, written: [] }))
        : mode === 'one'
          ? saveOne(entries[0], { onPicked }).then((outcome) => ({ outcome, written: [] }))
          : saveManyToFolder(entries, { onPicked });
    save.then(
      ({ outcome, written }) => {
        watch.settled(outcome);
        return report({ outcome, written });
      },
      (error) => {
        const failure: Pick<SaveReport, 'outcome' | 'written' | 'errorMessage'> =
          error instanceof SaveFailedError
            ? { outcome: 'partial', written: error.written, errorMessage: error.message }
            : { outcome: 'failed', written: [], errorMessage: plainMessage(error, 'The files could not be saved. Try again.') };
        watch.settled(failure.outcome);
        return report(failure);
      },
    );
  };

  // ---- destinations ----------------------------------------------------------------------------

  const openDestination = (next: DestinationDialog) => {
    destinationOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    toast.dismiss(RESULT_TOAST); // it would sit over the dialog's buttons
    setDestination(next);
  };

  /** Back to the control that opened the dialog; else the same control by its test id; else "Add from computer". */
  const returnFocusTo = (testId: string) => () => {
    const back = destinationOpener.current;
    destinationOpener.current = null;
    for (const target of [back, document.querySelector<HTMLElement>(`[data-testid="${testId}"]`), addButton.current, stripAddButton.current]) {
      if (!target?.isConnected) continue;
      focusQuietly(target, { preventScroll: true }); // no tooltip on focus given back (QA-FIX F)
      if (document.activeElement === target) return;
    }
  };

  const results = useMemo(() => resultsOf(selected), [selected]);
  const vaultHint = selected.length > 0 && results.length === 0 ? NOT_RESULTS_VAULT : null;
  const attachHint = services.programmesLoading
    ? 'Loading the audit programmes…'
    : services.programmes.length === 0
      ? NO_PROGRAMME
      : selected.length > 0 && results.length === 0
        ? NOT_RESULTS_ATTACH
        : null;
  const choices = useMemo(() => vaultChoices(services.vaultRows, services.engagementId), [services.vaultRows, services.engagementId]);
  const inList = useMemo(() => new Set(state.files.flatMap((f) => (f.origin === 'vault' && f.evidenceId ? [f.evidenceId] : []))), [state.files]);

  const addChosenFromVault = (chosen: { id: string; name: string; filePath: string; size: number }[]) => {
    if (!destinationScope()) return;
    setDestination(null);
    lastAddedFrom.current = 'vault';
    // Read one at a time when its turn comes, with the same checks and password prompt as files from the computer.
    addAndSelect(chosen.map((choice) => vaultFileLike(choice)));
  };

  /**
   * The rows as the screen shows them now, from the guarded state (a row added to the vault since
   * the dialog opened carries its record). Called right after destinationScope() agreed with the store.
   */
  const latestState = useRef(state);
  latestState.current = state;
  const currentRows = (files: WorkingFile[]) =>
    files.flatMap((f) => {
      const row = latestState.current.files.find((r) => r.id === f.id);
      return row ? [row] : [];
    });

  /**
   * Add to Evidence Vault / Attach to working paper. Rows whose vault record has gone since it was
   * made (deleted in the Evidence Vault, or with its last attachment in Audit Execution) lose their
   * vault mark first, so the dialog offers the vault form for them and never reuses a dead record.
   */
  const opening = useRef(false);
  const openSendDialog = (kind: 'vault' | 'attach', chosen?: WorkingFile[]) => {
    const target = destinationScope();
    if (!target || opening.current) return;
    const picked = chosen ? resultsOf(chosen) : results;
    const leftOut = chosen ? chosen.length - picked.length : selected.length - results.length;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const open = (files: WorkingFile[]) => {
      destinationOpener.current = opener;
      toast.dismiss(RESULT_TOAST); // it would sit over the dialog's buttons
      setDestination({ kind, key: Date.now(), files, leftOut });
    };
    if (!picked.some((f) => f.vaultRecord)) {
      open(picked);
      return;
    }
    opening.current = true;
    // A check that takes longer than a moment shows on the button (spinner, busy, no second click).
    const checked = delayedBusy(
      () => setChecking(kind),
      () => setChecking(null),
    );
    // The check has a time limit (an unanswered one keeps the marks), and `opening` is always
    // released, so the buttons never stay dead until the screen is opened again.
    void dropMissingVaultRecords(picked, latestServices.current.checkVaultRecord, target, store)
      .then(({ status }) => {
        if (status === 'stale' || !stillCurrent()) return;
        // The scope was taken before the check and still holds: the rows as the store has them now.
        const now = store.getState().files;
        open(picked.flatMap((f) => now.filter((row) => row.id === f.id)));
      })
      .catch(() => {
        if (stillCurrent()) open(picked);
      })
      .finally(() => {
        opening.current = false;
        checked();
      });
  };

  const resultRows = (ids: string[], key: string | null, session: number): WorkingFile[] | null => {
    const live = store.getState();
    if (!key || live.contextKey !== key || live.session !== session || !stillCurrent()) return null;
    const rows = live.files.filter((f) => ids.includes(f.id));
    return rows.length > 0 ? rows : null;
  };
  type ResultAction = (ids: string[], key: string | null, session: number) => void;
  const resultActions = useRef<{ save: ResultAction; vault: ResultAction }>({ save: () => undefined, vault: () => undefined });
  resultActions.current = {
    save: (ids, key, session) => {
      const rows = resultRows(ids, key, session);
      if (rows) saveToComputer(false, rows);
    },
    vault: (ids, key, session) => {
      const rows = resultRows(ids, key, session);
      if (rows) openSendDialog('vault', rows);
    },
  };

  const finishBatch = (result: BatchResult, summary: SummaryToast | null): SummaryToast | null => {
    // Another engagement or session: the dialog has gone with it, and nothing is said. The vault
    // list is fetched again for the engagement now shown: an upload started in the old one ends by
    // refreshing the list with the old engagement's rows, after the new one's own fetch.
    if (result.status === 'stale') {
      latestServices.current.refreshVault();
      return null;
    }
    if (!stillCurrent()) return null;
    if (!shouldCloseAfter(result)) return summary; // nothing was written: the dialog stays, with the form as typed
    setDestination(null);
    showSummary(summary);
    if (result.logFailures > 0) toast.warning(LOG_FAILED);
    return null;
  };

  const [why, setWhy] = useState<{ text: string; key: number } | null>(null);
  const sayWhy = useCallback((text: string) => setWhy({ text, key: Date.now() }), []);
  useEffect(() => {
    if (!why) return;
    const timer = window.setTimeout(() => setWhy(null), WHY_LINE_MS);
    return () => window.clearTimeout(timer);
  }, [why]);
  const whyText = whyLineText(why?.text ?? null, state.files.length, selected.length);

  const empty = state.files.length === 0;
  const single = selected.length === 1 && selected[0].kind === 'pdf' ? selected[0] : null;

  // When the last rows go, the list (and the button that removed them) goes too: focus "Add from
  // computer" instead of leaving it on the page body. A confirmation's own close does the same.
  // When the first rows arrive, the empty area (and the button that added them) goes: focus the
  // same button in the strip that takes its place.
  const focusAddButton = useCallback(() => addButton.current?.focus(), []);
  /** The button the user added files with, wherever it is now (the empty area or the strip). */
  const focusAddedFrom = useCallback(() => {
    const candidates =
      lastAddedFrom.current === 'vault'
        ? [stripVaultButton.current, document.querySelector<HTMLElement>('[data-testid="pdf-tools-add-from-vault"]')]
        : [stripAddButton.current, addButton.current];
    candidates.find((el) => el?.isConnected)?.focus({ preventScroll: true });
  }, []);
  // Where focus last was: inside PDF Tools or elsewhere (a removed element gives no new focusin).
  const root = useRef<HTMLDivElement>(null);
  const focusWasInside = useRef(false);
  useEffect(() => {
    const onFocusIn = (event: FocusEvent) => {
      focusWasInside.current = Boolean(root.current && event.target instanceof Node && root.current.contains(event.target));
    };
    document.addEventListener('focusin', onFocusIn);
    return () => document.removeEventListener('focusin', onFocusIn);
  }, []);
  const wasEmpty = useRef(empty);
  const lastSession = useRef(state.session);
  useLayoutEffect(() => {
    // Only after the user's own removal or addition inside PDF Tools (listFocus.ts): never when a
    // change of engagement or sign-out cleared the list (the header's menu may still be closing).
    const target = focusAfterListChange({
      wasEmpty: wasEmpty.current,
      empty,
      sameSession: lastSession.current === state.session,
      focusLost: !document.activeElement || document.activeElement === document.body,
      focusWasInside: focusWasInside.current,
      dialogOpen: Boolean(document.querySelector('[role="dialog"], [role="alertdialog"]')),
      lastAddedFrom: lastAddedFrom.current,
    });
    if (target === 'add') focusAddButton();
    else if (target) focusAddedFrom();
    wasEmpty.current = empty;
    lastSession.current = state.session;
  }, [empty, state.session, focusAddButton, focusAddedFrom]);
  const percent = progress ? Math.round((progress.done / Math.max(1, progress.total)) * 100) : 0;

  // Not a live region: stages change quickly. The polite summary below is announced once a run ends.
  const progressLine = progress && (
    <>
      <span className="min-w-0 truncate text-sm font-medium text-foreground">
        {STAGE_TEXT[progress.stage]} {progress.current}
        {progress.stage === 'password' ? '' : '…'}
      </span>
      <Progress value={percent} className="h-1.5 w-24 shrink-0" aria-label="Adding files" />
      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
        {progress.done + 1} of {progress.total}
      </span>
    </>
  );

  // `compact`: the list bar's icon half of "Add files"; its name stays "Add from Evidence Vault" (tooltip and screen readers).
  const vaultButton = (className?: string, ref?: typeof stripVaultButton, compact = false) => {
    const button = (
      <HintButton
        ref={ref}
        type="button"
        variant="outline"
        data-testid="pdf-tools-add-from-vault"
        className={className}
        enabled={Boolean(contextKey)}
        hint="Choose an engagement first."
        aria-label={compact ? 'Add from Evidence Vault' : undefined}
        onClick={() => openDestination({ kind: 'picker', key: Date.now() })}
      >
        <Archive />
        {compact ? null : 'Add from Evidence Vault'}
      </HintButton>
    );
    if (!compact || !contextKey) return button;
    return (
      <Tooltip>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          Add from Evidence Vault
        </TooltipContent>
      </Tooltip>
    );
  };

  return (
    <WhyContext.Provider value={sayWhy}>
    <div ref={root} data-testid="pdf-tools-root" className="space-y-2.5">
      <div className="space-y-1">
        <ToolBar selected={selected} onToolSelected={onToolSelected} built={isBuilt} onUnavailable={sayWhy} loading={dialogLoading} />
        {/* Always present, so it is read out when its text changes; empty, it takes no room. */}
        <p
          role="status"
          aria-live="polite"
          data-testid="pdf-tools-why"
          className={cn(whyText ? 'flex items-center gap-1.5 px-1 text-xs text-foreground' : 'sr-only')}
        >
          {whyText && <Info className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />}
          {whyText}
        </p>
      </div>

      {empty ? (
        // One block: the whole area takes dropped files and a click on its background opens the
        // file chooser; the buttons inside do the same for keyboard users.
        <div
          role="region"
          aria-label="Add files"
          onClick={(event) => {
            if (!(event.target as HTMLElement).closest('button')) chooseFiles();
          }}
          onDragEnter={onDrag}
          onDragOver={onDrag}
          onDragLeave={onDrag}
          onDrop={onDrop}
          className={cn(
            'flex cursor-pointer flex-col items-center gap-3 rounded-lg border-2 border-dashed px-6 py-6 text-center transition-colors',
            dragging ? 'border-primary bg-primary/5' : 'border-border bg-card hover:border-primary/40',
          )}
        >
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/10" aria-hidden="true">
            {progress ? <Loader2 className="h-5 w-5 animate-spin text-primary" /> : <Upload className="h-5 w-5 text-primary" />}
          </span>
          <div id="pdf-tools-add-status" className="w-full max-w-lg">
            {progress ? (
              <p className="flex items-center justify-center gap-2.5">{progressLine}</p>
            ) : (
              <>
                <p className="text-sm font-semibold text-foreground">Drop PDFs or images here, or click to choose them</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  PDF, JPG, PNG, TIFF, WebP, BMP or GIF. Then tick the files you want and pick a tool above. Password-protected PDFs open
                  once you give the password.
                </p>
              </>
            )}
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            <Button ref={addButton} type="button" onClick={chooseFiles}>
              <FilePlus2 />
              Add from computer
            </Button>
            {vaultButton()}
          </div>
          <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5 text-success" aria-hidden="true" />
            Everything runs on this computer. Nothing is uploaded or saved until you choose where.
          </p>
        </div>
      ) : (
        // With files in the list (UX audit C13, T2-5): no drop strip; "Add files" sits in the list bar, and the
        // whole list takes dropped files. While files are being added, their progress shows here.
        progress && (
          <div id="pdf-tools-add-status" className="flex h-9 items-center gap-2.5 rounded-md border border-dashed border-primary/40 bg-card px-3">
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" aria-hidden="true" />
            {progressLine}
          </div>
        )
      )}

      <p className="sr-only" role="status" aria-live="polite">
        {summary}
      </p>

      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPT}
        data-testid="pdf-tools-file-input"
        className="hidden"
        tabIndex={-1}
        aria-hidden="true"
        onChange={onInputChange}
      />

      {!empty && (
        <div
          onDragEnter={onDrag}
          onDragOver={onDrag}
          onDragLeave={onDrag}
          onDrop={onDrop}
          className={cn('rounded-lg transition-[outline-color]', dragging && 'outline-dashed outline-2 outline-offset-2 outline-primary')}
        >
        <FileList
          addControls={
            <div className="flex items-center">
              <Button
                ref={stripAddButton}
                type="button"
                size="sm"
                className="h-8 gap-1.5 rounded-r-none px-2.5 text-xs"
                aria-label="Add files from your computer (or drop them on the list)"
                onClick={chooseFiles}
              >
                <FilePlus2 />
                Add files
              </Button>
              {vaultButton('h-8 rounded-l-none border-l-0 px-2', stripVaultButton, true)}
            </div>
          }
          files={state.files}
          selectedIds={state.selectedIds}
          onSelectionChange={(ids) => store.setSelected(ids)}
          onMove={(id, direction) => store.move(id, direction)}
          onRemove={(ids) => store.remove(ids)}
          saving={saving}
          onSaveToComputer={saveToComputer}
          onSendToVault={() => openSendDialog('vault')}
          onAttachToWorkingPaper={() => openSendDialog('attach')}
          vaultHint={vaultHint}
          attachHint={attachHint}
          checking={checking}
          reveal={reveal}
          onListEmptied={focusAddButton}
          onView={viewFile}
          // The list bar's "N not saved": one click saves them all (QA-FIX K).
          onSaveUnsaved={() => saveToComputer(false, state.files.filter(isUnsavedResult))}
        />
        </div>
      )}

      {single && (
        // The read-only bookmark list sits beside the page panel when the file has bookmarks (design section 4);
        // choosing one shows its page in the panel.
        <div className="flex flex-col gap-2.5 lg:flex-row lg:items-start">
          <PagePanel
            key={single.id}
            file={viewableFile(single)}
            className="min-w-0 lg:flex-1"
            showPage={showPage?.fileId === single.id ? showPage : null}
            onViewerOpen={dismissResultToast}
          />
          {single.hasBookmarks && toolIsBuilt('bookmarks', builtTools) && (
            <Suspense fallback={null}>
              <BookmarkList
                key={single.id}
                file={viewableFile(single)}
                className="lg:w-[300px] lg:shrink-0"
                onChoosePage={(page) => setShowPage({ fileId: single.id, page, token: Date.now() })}
              />
            </Suspense>
          )}
        </div>
      )}

      {viewing && viewed && (
        <PageViewer
          key={viewing.key}
          file={viewableFile(viewed)}
          startPage={1}
          onClose={closeViewer}
          returnFocusTo={viewing.opener}
          placeholder={viewed.kind === 'pdf' ? viewing.placeholder : null}
        />
      )}

      {passwordRequest && <PasswordDialog key={passwordRequest.id} request={passwordRequest} onAnswer={settlePassword} onFocusLost={focusAddedFrom} />}

      {activeTool && ActiveDialog && (
        <ToolDialogBoundary key={activeTool.key} onFailed={toolFailed}>
          {/* A phase 2 dialog's code arrives in a moment: nothing is shown meanwhile, then a spinner on its button. */}
          <Suspense fallback={<DialogLoading tool={activeTool.tool} onBusy={setDialogLoading} />}>
            <ActiveDialog
              files={activeTool.files}
              scope={getScope}
              store={store}
              listBytes={listBytes}
              onFinished={finishRun}
              onClose={closeTool}
            />
          </Suspense>
        </ToolDialogBoundary>
      )}

      {destination?.kind === 'picker' && (
        <VaultPickerDialog
          key={destination.key}
          choices={choices}
          loading={services.vaultLoading}
          inList={inList}
          listBytes={listBytes}
          onAdd={addChosenFromVault}
          onClose={closeDestination}
          onReturnFocus={returnFocusTo('pdf-tools-add-from-vault')}
        />
      )}

      {destination?.kind === 'vault' && (
        <VaultSaveDialog
          key={destination.key}
          files={destination.files}
          leftOut={destination.leftOut}
          vaultRows={services.vaultRows}
          engagementId={services.engagementId}
          run={(form, options) => {
            const target = destinationScope();
            return target ? addToVault(currentRows(destination.files), form, target, latestServices.current.deps, options) : null;
          }}
          onFinished={(result) => finishBatch(result, vaultSummary(result))}
          onClose={closeDestination}
          onReturnFocus={returnFocusTo('pdf-tools-dest-vault')}
        />
      )}

      {destination?.kind === 'attach' && (
        <WorkingPaperDialog
          key={destination.key}
          files={destination.files}
          leftOut={destination.leftOut}
          programmes={services.programmes}
          vaultRows={services.vaultRows}
          engagementId={services.engagementId}
          run={(form, place, options) => {
            const target = destinationScope();
            return target ? attachToWorkingPaper(currentRows(destination.files), form, place, target, latestServices.current.deps, options) : null;
          }}
          onFinished={(result, place) => finishBatch(result, attachSummary(result, place))}
          onClose={closeDestination}
          onReturnFocus={returnFocusTo('pdf-tools-dest-working-paper')}
        />
      )}
    </div>
    </WhyContext.Provider>
  );
}
