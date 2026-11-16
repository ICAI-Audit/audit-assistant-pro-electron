// Organise pages (design 5.15; plan Task B1): reorder, rotate and remove the pages of one PDF in one
// dialog. A grid of the pages (organise/OrganiseGrid.tsx) with the actions on the chosen pages as
// buttons (organise/OrganiseToolbar.tsx) and keys, drag and drop, a line saying what changed (also the
// activity summary), what the result will not carry, and the page viewer for any page. The toolbar
// actions are the decisions in view; the result name is under "More options" (ux-audit E4). The
// primary button names the result ("Save 12 pages in the new order"); it is enabled only after a
// change, and never when every page is removed, and the reason is shown when it is not. "Rotate" is
// the owner's word for what the code calls a turn. The edit holds page numbers only; the run
// (organiseRun.ts) checks the plan again.
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Info } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { defaultResultName } from '@/lib/pdf-tools/resultNames';
import { plural } from '../format';
import { toPagePlan, type OrganiseEditAction } from '../organiseEdit';
import OrganiseGrid from '../organise/OrganiseGrid';
import { carryNotesBeforeRun } from '../organise/organiseNotes';
import { changeLine, countsOfTiles, runBlockedReason, runLabel } from '../organise/organiseSummary';
import OrganiseToolbar from '../organise/OrganiseToolbar';
import { useOrganiseEditor, type Announcement } from '../organise/useOrganiseEditor';
import PageViewer from '../viewer/PageViewer';
import { MoreOptions, Notice, ResultNameField, ToolDialog } from './ToolDialog';
import { useResultName, useToolRun, type ToolDialogProps } from './useToolRun';

const KEYS_HINT =
  'In the grid: arrow keys move between pages, Space chooses, Shift extends the choice, Ctrl+A chooses all. Alt+Left, Alt+Right, Alt+Home and Alt+End move the chosen pages; R and Shift+R rotate them; Delete or Backspace removes or restores; Ctrl+Z and Ctrl+Y undo and redo; Enter shows a page larger. Pages can also be dragged.';

/** Two polite regions taking turns, so that the same sentence is read out again. */
function LiveRegion({ announcement }: { announcement: Announcement }) {
  const odd = announcement.n % 2 === 1;
  return (
    <div className="sr-only" data-testid="pdf-tools-organise-announce" data-count={announcement.n}>
      <p role="status" aria-live="polite" aria-atomic="true">
        {odd ? announcement.text : ''}
      </p>
      <p role="status" aria-live="polite" aria-atomic="true">
        {odd ? '' : announcement.text}
      </p>
    </div>
  );
}

export default function OrganisePagesDialog(props: ToolDialogProps) {
  const { files, onClose } = props;
  const file = files[0];
  const pageCount = file.pageCount ?? 0;
  const run = useToolRun('organise-pages', props);
  const name = useResultName(defaultResultName('organise-pages', file.name));
  const editor = useOrganiseEditor(pageCount);
  const { state, apply, current, say } = editor;
  const busy = run.phase !== 'idle';
  const hintId = useId();

  const counts = useMemo(() => countsOfTiles(state.tiles), [state.tiles]);
  const blocked = runBlockedReason(state);
  const notes = carryNotesBeforeRun(file, counts);
  const chosenCount = state.chosen.size;

  // A message from an earlier run goes once the pages are edited again.
  const { clearMessages } = run;
  const firstTiles = useRef(state.tiles);
  useEffect(() => {
    if (state.tiles !== firstTiles.current) clearMessages();
  }, [state.tiles, clearMessages]);

  // After a toolbar edit, the grid shows the first chosen page where it went.
  const [reveal, setReveal] = useState<{ source: number; n: number } | null>(null);
  const onAction = useCallback(
    (action: OrganiseEditAction) => {
      const after = apply([action]);
      const first = after.tiles.find((tile) => after.chosen.has(tile.source));
      if (first) setReveal((last) => ({ source: first.source, n: (last?.n ?? 0) + 1 }));
    },
    [apply],
  );

  // The page viewer, opened from a tile; it chooses pages in step with the grid.
  const [viewing, setViewing] = useState<{ source: number; opener: HTMLElement | null; placeholder: string | null; key: number } | null>(null);
  const onView = useCallback((source: number, opener: HTMLElement | null, placeholder: string | null) => {
    setViewing({ source, opener, placeholder, key: Date.now() });
  }, []);
  const chosenPages = useMemo(() => [...state.chosen].map((source) => source + 1), [state.chosen]);
  const toggleFromViewer = useCallback(
    (pageNumber: number) => {
      const place = current().tiles.findIndex((tile) => tile.source === pageNumber - 1);
      if (place >= 0) apply([{ type: 'choose', index: place, mode: 'toggle' }]);
    },
    [apply, current],
  );

  const start = () => {
    if (blocked) return;
    run.start({ plan: toPagePlan(current()), name: name.resolved });
  };

  // Closing with changes not saved asks first, as Bookmarks does (REV-B S4): Escape, Cancel, the corner X or a
  // stray click outside must not throw a long arrangement away. "Keep editing" goes back to the control that asked.
  const changed = counts.moved + counts.turned + counts.removed > 0;
  const [confirmClose, setConfirmClose] = useState(false);
  const closeAskedFrom = useRef<HTMLElement | null>(null);
  const requestClose = () => {
    if (changed && !busy) {
      closeAskedFrom.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setConfirmClose(true);
    } else onClose();
  };

  return (
    <>
    <ToolDialog
      tool="organise-pages"
      files={files}
      run={run}
      size="2xl"
      description="Put the pages in a new order, rotate them, or remove the ones you do not need. The original is not changed."
      runLabel={runLabel(counts)}
      blocked={blocked !== null}
      blockedReason={blocked}
      onRun={start}
      onClose={requestClose}
    >
      {/* Positioned, so the screen-reader-only live regions and hidden texts are contained here and the
          dialog frame never gets overflow to scroll (review F2: Next / Previous scrolled the frame). */}
      <div className="relative space-y-4">
        {/* The actions and what changed stay in view while the pages scroll (one scroll area: the body). -top-4: the body's top padding, so nothing shows above it. */}
        <div className="sticky -top-4 z-10 -mx-6 -mt-4 space-y-2 border-b bg-background px-6 pb-2.5 pt-3" data-testid="pdf-tools-organise-sticky">
          <OrganiseToolbar state={state} disabled={busy} onAction={onAction} onUnavailable={say} />
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-xs">
            <p className="font-medium text-foreground">
              <span data-testid="pdf-tools-organise-summary">{changeLine(counts)}</span>
              <span className="font-normal text-muted-foreground"> · {plural(counts.kept, 'page')} in the result</span>
            </p>
            <p className="text-muted-foreground" data-testid="pdf-tools-organise-chosen">
              {chosenCount === 0 ? 'Click a page to choose it; Ctrl+click or Shift+click to choose more.' : `${plural(chosenCount, 'page')} chosen`}
            </p>
          </div>
        </div>


        {notes && (
          <Notice tone={notes.kind === 'kept' ? 'info' : 'neutral'} title={notes.title} testId={notes.kind === 'kept' ? 'pdf-tools-organise-kept' : 'pdf-tools-not-carried'}>
            {notes.text}
            {notes.kept && (
              <span className="mt-1 block" data-testid="pdf-tools-organise-attachments-kept">
                {notes.kept}
              </span>
            )}
          </Notice>
        )}

        <p className="flex gap-1.5 text-[11px] leading-relaxed text-foreground/75" data-testid="pdf-tools-organise-keys">
          <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
          <span id={hintId}>{KEYS_HINT}</span>
        </p>
        <OrganiseGrid file={file} state={state} current={current} apply={apply} disabled={busy} reveal={reveal} onView={onView} hintId={hintId} />

        {/* At the end, as in the other dialogs: the pages come first (REV-B minor 5). */}
        <MoreOptions id="pdf-tools-organise-more" summary={`Result name: ${name.resolved}`}>
          <ResultNameField name={name} />
        </MoreOptions>

        <LiveRegion announcement={editor.announcement} />

        {viewing && (
          <PageViewer
            key={viewing.key}
            file={file}
            startPage={viewing.source + 1}
            chosenPages={chosenPages}
            onTogglePage={busy ? undefined : toggleFromViewer}
            onClose={() => setViewing(null)}
            returnFocusTo={viewing.opener}
            placeholder={viewing.placeholder}
          />
        )}
      </div>
    </ToolDialog>

    <AlertDialog open={confirmClose} onOpenChange={setConfirmClose}>
      <AlertDialogContent
        data-testid="pdf-tools-organise-close-confirm"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          const back = closeAskedFrom.current;
          closeAskedFrom.current = null;
          if (back?.isConnected && back !== document.body) back.focus({ preventScroll: true });
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>Discard your changes?</AlertDialogTitle>
          <AlertDialogDescription>Your changes to the pages have not been saved. If you leave now, they are lost and nothing is added.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep editing</AlertDialogCancel>
          <AlertDialogAction data-testid="pdf-tools-organise-close-confirm-yes" onClick={onClose}>
            Discard changes
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}
