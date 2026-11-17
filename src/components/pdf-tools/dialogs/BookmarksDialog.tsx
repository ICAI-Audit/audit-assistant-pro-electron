// The Bookmarks tool (design 5.10, plan A3): the page thumbnails on the left, the bookmark tree on the
// right. Add a bookmark for the current page, rename it in place, move it up or down, indent it one
// level or out again, remove it, undo and redo: every action by keyboard as well as by mouse, and each
// read out. The file's own deeper nesting is shown at its depth and kept. Bookmarks that open another
// file or run a script are greyed "Not carried" and are not saved. A file over the reading limits opens
// read-only. "Save 12 bookmarks" makes `<name>_bookmarked.pdf` once something has changed.
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  BookmarkPlus,
  FileWarning,
  IndentDecrease,
  IndentIncrease,
  Loader2,
  PencilLine,
  Redo2,
  Trash2,
  Undo2,
  type LucideIcon,
} from 'lucide-react';
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
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { BOOKMARKS_NOT_EDITABLE_MESSAGE } from '@/lib/pdf-tools/bookmarks';
import { defaultResultName } from '@/lib/pdf-tools/resultNames';
import { PdfToolsError } from '@/lib/pdf-tools/types';
import {
  bookmarkCount,
  bookmarkEditReducer,
  initialBookmarkState,
  notCarriedCount,
  toOutline,
  type BookmarkEditAction,
  type BookmarkEditState,
  type EditableBookmark,
} from '../bookmarkEdit';
import { bookmarkKeyAction, type BookmarkKeyAction } from '../bookmarks/bookmarkKeys';
import { attachDialogKeys, ignoreHeldKey, type KeyTarget } from '../dialogKeys';
import { framePlace } from '../useDialogKeys';
import { cachedBookmarkSource, newBookmarkView, type BookmarkSource } from '../bookmarks/bookmarkSource';
import {
  countLabel,
  deleteQuestion,
  describeEdit,
  editCounts,
  limitTyped,
  longTitlesNotice,
  notCarriedNotice,
  renameProblem,
  titleCounter,
  treeRows,
  treesDiffer,
  whyUnavailable,
  type EditCommand,
} from '../bookmarks/bookmarkView';
import PageStrip, { type PageStripHandle } from '../bookmarks/PageStrip';
import TreeRowView from '../bookmarks/TreeRowView';
import { useVirtualRows } from '../bookmarks/useVirtualRows';
import { Notice, ResultNameField, ToolDialog } from './ToolDialog';
import { useResultName, useToolRun, type ToolDialogProps } from './useToolRun';

const ROW = 32;
// What happens and what to do, in two sentences (ux-audit E6, C6.9).
const SIGNED_WARNING =
  'Saving changes the file, so its digital signature will no longer be valid. The signed original stays unchanged in the list: keep it as the evidence.';
const EMPTY_HINT = 'Add a bookmark for the page shown.';

type Loaded = { status: 'reading' } | { status: 'failed'; title: string; message: string } | { status: 'ready'; source: BookmarkSource; start: BookmarkEditState };

/** After this long, the reading line says how long it has taken, so a large file never looks stuck (QA-FIX B). */
const READING_SAYS_TIME_AFTER_S = 5;

interface Editing {
  id: string;
  text: string;
  error: string | null;
}

/** A bookmark and the bookmark above it at its level. */
function find(items: readonly EditableBookmark[], id: string): { item: EditableBookmark; above: EditableBookmark | null } | null {
  for (const [index, item] of items.entries()) {
    if (item.id === id) return { item, above: index > 0 ? items[index - 1] : null };
    const below = find(item.children, id);
    if (below) return below;
  }
  return null;
}

function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-border bg-background px-1 font-sans text-[11px] font-medium text-foreground">{children}</kbd>;
}

/**
 * Runs `change` once the focus has moved on. A node taken out of the dialog while the focus is between two
 * controls (in a blur handler) makes the dialog's focus trap (Radix FocusScope) put the focus on the dialog
 * itself, so the Tab or click that moved it is lost (seen in the application drive).
 */
function afterFocusSettles(change: () => void): void {
  window.setTimeout(change, 0);
}

interface ToolAction {
  /** The test id is `pdf-tools-bookmarks-<id>`. */
  id: string;
  icon: LucideIcon;
  label: string;
  /** For aria-keyshortcuts, as "Alt+ArrowUp". */
  keys?: string;
  /** Why it does nothing now, or null when it works. */
  why: string | null;
  onPress: () => void;
  /** Starts a group (a divider before it). */
  group?: boolean;
  accent?: boolean;
  /** Shown as its icon only; the label is its name for screen readers. */
  iconOnly?: boolean;
}

/**
 * The bookmark actions: one Tab stop, the arrow keys move along it (ux-audit C11). A button that does
 * nothing now is never `disabled` (pressing "Up" until the bookmark is first would drop the focus on
 * the page body): it is marked unavailable and says why on hover, on focus and when pressed.
 */
function ActionBar({
  actions,
  onWhy,
  busy,
}: {
  actions: ToolAction[];
  /** `only`: change the line only while it still says that (another button may have set it since). */
  onWhy: (text: string | null, pressed?: boolean, only?: string | null) => void;
  busy: boolean;
}) {
  const [at, setAt] = useState(0);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const keys: Record<string, number> = {
      ArrowRight: at + 1,
      ArrowLeft: at - 1,
      Home: 0,
      End: actions.length - 1,
    };
    if (!(event.key in keys) || event.altKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    const next = (keys[event.key] + actions.length) % actions.length;
    setAt(next);
    buttons.current[next]?.focus();
  };
  const explain = (action: ToolAction) => (action.why ? `${action.label}: ${action.why}` : null);
  return (
    <div role="toolbar" aria-label="Bookmark actions" aria-controls="pdf-tools-bookmarks-tree" onKeyDown={move} className="flex flex-wrap items-center gap-1.5">
      {actions.map((action, index) => {
        const Icon = action.icon;
        const unavailable = action.why !== null;
        return (
          <span key={action.id} className="flex items-center gap-1.5">
            {action.group && <span className="mx-0.5 h-5 w-px bg-border" aria-hidden="true" />}
            <Button
              ref={(element) => (buttons.current[index] = element)}
              type="button"
              size="sm"
              variant="outline"
              tabIndex={index === at ? 0 : -1}
              data-testid={`pdf-tools-bookmarks-${action.id}`}
              aria-disabled={unavailable ? true : undefined}
              aria-describedby={unavailable ? `pdf-tools-bookmarks-${action.id}-why` : undefined}
              aria-keyshortcuts={action.keys}
              aria-label={action.iconOnly ? action.label : undefined}
              title={action.iconOnly && !unavailable ? action.label : undefined}
              onFocus={() => {
                setAt(index);
                onWhy(explain(action));
              }}
              onBlur={() => afterFocusSettles(() => onWhy(null, false, explain(action)))}
              onMouseEnter={() => onWhy(explain(action))}
              onMouseLeave={() => onWhy(null, false, explain(action))}
              // A held Enter acts once: "Remove" held down must not remove a bookmark per repeat (REV-B S9).
              onKeyDown={ignoreHeldKey}
              onClick={() => {
                if (busy) return;
                if (unavailable) onWhy(explain(action), true);
                else action.onPress();
              }}
              className={cn(
                'h-8 gap-1.5 text-xs',
                action.iconOnly ? 'w-8 px-0' : 'px-2',
                unavailable && 'cursor-default opacity-60 hover:bg-background hover:text-foreground',
              )}
            >
              <Icon className={cn('h-3.5 w-3.5', action.accent && !unavailable && 'text-primary')} aria-hidden="true" />
              {!action.iconOnly && action.label}
            </Button>
            {unavailable && (
              <span id={`pdf-tools-bookmarks-${action.id}-why`} className="sr-only">
                {action.why}
              </span>
            )}
          </span>
        );
      })}
    </div>
  );
}

export default function BookmarksDialog(props: ToolDialogProps) {
  const { files, onClose } = props;
  const file = files[0];
  const pageCount = file.pageCount ?? 0;
  const run = useToolRun('bookmarks', props);
  const busy = run.phase !== 'idle';
  const name = useResultName(defaultResultName('bookmarks', file.name));
  const latest = useRef(props);
  latest.current = props;

  const [loaded, setLoaded] = useState<Loaded>({ status: 'reading' });
  const [state, setState] = useState<BookmarkEditState | null>(null);
  // The state as last set, for actions that follow each other faster than a render.
  const current = useRef<BookmarkEditState | null>(null);
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [said, setSaid] = useState<{ text: string; n: number }>({
    text: '',
    n: 0,
  });
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{
    id: string;
    question: string;
  } | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const [treeFocused, setTreeFocused] = useState(false);
  const tree = useRef<HTMLDivElement>(null);
  const strip = useRef<PageStripHandle>(null);
  const renameInput = useRef<HTMLInputElement>(null);
  // The control that asked to remove (the tree or the Remove button): focus goes back to it.
  const askedFrom = useRef<HTMLElement | null>(null);

  // Read with PDF Tools' own reader (one reading shared with the list beside the page panel). The scope
  // is taken before the first await; what was read is shown only if the list is still that scope's and
  // still holds the file. Otherwise nothing is said (the screen closes the dialog on such a change).
  // The reading is ended (its worker terminated) when the dialog closes, and as soon as the list leaves
  // this scope; it gives up only when the reading stops answering for READ_TIME_LIMIT_MS ("Try again"
  // starts it afresh). After a few seconds the line says how long it has taken.
  const [attempt, setAttempt] = useState(0);
  // Seconds the reading has taken so far (shown after READING_SAYS_TIME_AFTER_S).
  const [readingFor, setReadingFor] = useState(0);
  useEffect(() => {
    let live = true;
    const { contextKey, session } = latest.current.scope();
    if (!contextKey) return;
    const store = latest.current.store;
    const stillHere = () => {
      const now = store.getState();
      return live && now.contextKey === contextKey && now.session === session && now.files.some((f) => f.id === file.id);
    };
    const reading = new AbortController();
    const unsubscribe = store.subscribe(() => {
      if (!stillHere()) reading.abort();
    });
    setLoaded({ status: 'reading' });
    setReadingFor(0);
    const startedAt = Date.now();
    const clock = window.setInterval(() => setReadingFor(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    cachedBookmarkSource(file.bytes, reading.signal).finally(() => window.clearInterval(clock)).then(
      (source) => {
        if (!stillHere()) return;
        const start = initialBookmarkState(source.items);
        current.current = start;
        setState(start);
        setLoaded({ status: 'ready', source, start });
      },
      (error: unknown) => {
        if (!stillHere() || reading.signal.aborted) return;
        // A file that intake found without bookmarks is never said to have bookmarks that "could not be
        // read" (QA-FIX B): it is the file that could not be read, so none can be added yet.
        const none = file.hasBookmarks === false;
        setLoaded({
          status: 'failed',
          title: none ? 'Bookmarks cannot be added yet' : 'The bookmarks could not be read',
          message:
            error instanceof PdfToolsError && error.code === 'bookmarks-read-timeout'
              ? `${error.message} Nothing was changed.`
              : error instanceof PdfToolsError
                ? `${error.message} Nothing was changed.`
                : 'Nothing was changed.',
        });
      },
    );
    return () => {
      live = false;
      window.clearInterval(clock);
      unsubscribe();
      reading.abort();
    };
  }, [file, attempt]);

  const ready = loaded.status === 'ready' ? loaded : null;
  const editable = ready?.source.editable === true;
  // What depends on the tree only is worked out again only when the tree changes, not when the chosen
  // bookmark does (every arrow key; REV-B minor 3).
  const items = state?.items ?? null;
  const rows = useMemo(() => (items ? treeRows(items, (b) => b.id) : []), [items]);
  // Why each action does nothing now (null when it works): shown on hover and focus, said when pressed.
  const reasons = useMemo(() => {
    const out = {} as Record<EditCommand | 'add', string | null>;
    const reading = loaded.status === 'failed' ? 'failed' : 'reading';
    for (const which of ['add', 'rename', 'up', 'down', 'indent', 'outdent', 'delete', 'undo', 'redo'] as const) out[which] = whyUnavailable(state, editable, which, reading);
    if (pageCount === 0) out.add = 'This file has no pages to point a bookmark at.';
    return out;
  }, [state, editable, pageCount, loaded.status]);
  const edited = useMemo(() => (ready && items ? treesDiffer(ready.start.items, items) : false), [ready, items]);
  const notCarriedLine = useMemo(() => (items ? notCarriedNotice(items) : null), [items]);
  const total = useMemo(() => (items ? bookmarkCount(items) : 0), [items]);
  const notCarriedTotal = useMemo(() => (items ? notCarriedCount(items) : 0), [items]);
  const kept = total - notCarriedTotal;
  const selectedIndex = state?.selected ? rows.findIndex((r) => r.key === state.selected) : -1;
  const editingIndex = editing ? rows.findIndex((r) => r.key === editing.id) : -1;
  const [why, setWhy] = useState<string | null>(null);

  const virtual = useVirtualRows(tree, rows.length, ROW);
  const { show } = virtual;
  useEffect(() => {
    if (selectedIndex >= 0) show(selectedIndex);
  }, [selectedIndex, show]);

  const announce = useCallback((text: string) => setSaid((was) => ({ text, n: was.n + 1 })), []);
  const focusTree = () => requestAnimationFrame(() => tree.current?.focus({ preventScroll: true }));

  /** Applies an action, reads out what it did, and makes the bookmark's page the current one. */
  const perform = useCallback(
    (action: BookmarkEditAction, quiet = false) => {
      const before = current.current;
      if (!before) return before;
      const after = bookmarkEditReducer(before, action);
      current.current = after;
      setState(after);
      setWhy(null);
      // Choosing a bookmark (quiet) keeps the notice: "Its title was not changed" would otherwise show only for
      // the length of the click that left the rename box (REV-B S9).
      if (!quiet) {
        setNotice(null);
        announce(describeEdit(before, after, action));
      }
      return after;
    },
    [announce],
  );

  const select = (id: string | null) => {
    perform({ type: 'select', id }, true);
    const row = id ? rows.find((r) => r.key === id) : undefined;
    if (row && row.page !== null) {
      setPage(row.page + 1);
      // Also when it is already the current page and the strip was scrolled away from it.
      strip.current?.show(row.page + 1);
    }
  };

  // ---- rename in place ----

  const startRename = (id: string, text?: string) => {
    const now = current.current;
    const at = now ? find(now.items, id) : null;
    if (!at) return;
    setNotice(null);
    setEditing({ id, text: text ?? at.item.title, error: null });
  };
  useEffect(() => {
    if (!editing) return;
    renameInput.current?.focus();
    renameInput.current?.select();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when a new rename starts
  }, [editing?.id]);

  const finishRename = (how: 'enter' | 'blur') => {
    const now = current.current;
    if (!editing || !now) return;
    const problem = renameProblem(now.items, editing.id, editing.text);
    const id = editing.id;
    if (problem && how === 'enter') {
      setEditing({ ...editing, error: problem });
      return;
    }
    const action: BookmarkEditAction = { type: 'rename', id, title: editing.text };
    if (how === 'enter') {
      if (!problem) perform(action);
      setEditing(null);
      focusTree();
      return;
    }
    // Left by Tab or a click: the title is kept at once in `current` (Save and the next action read it), but
    // nothing on the screen changes until the focus has landed (afterFocusSettles): a re-render now (the
    // frame's Save losing its reason, say) takes nodes out and the focus trap pulls the focus back (fix
    // round 1, seen in the app). Left with no title, the old one stays and the reason is shown.
    const after = problem ? null : bookmarkEditReducer(now, action);
    if (after) current.current = after;
    afterFocusSettles(() => {
      setEditing((was) => (was?.id === id ? null : was));
      if (problem) setNotice(`${problem} Its title was not changed.`);
      else if (after && after !== now) {
        // Unless a later action has already shown a newer state.
        if (current.current === after) setState(after);
        setNotice(null);
        setWhy(null);
        announce(describeEdit(now, after, action));
      }
    });
  };

  // Escape in the rename box ends the rename, and must not reach the dialog (which would close).
  useEffect(() => {
    if (!editing) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || event.target !== renameInput.current) return;
      event.preventDefault();
      event.stopPropagation();
      setEditing(null);
      focusTree();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [editing]);

  // ---- commands ----

  /** Says why an action does nothing now, on screen and to a screen reader; true when it does something. */
  const allowed = (which: EditCommand | 'add'): boolean => {
    if (busy) return false;
    const reason = pageCount === 0 && which === 'add' ? reasons.add : whyUnavailable(current.current, editable, which);
    if (reason === null) return true;
    announce(reason);
    setWhy(reason);
    return false;
  };

  const add = () => {
    if (!ready || !allowed('add')) return;
    const after = perform(
      {
        type: 'add',
        page: page - 1,
        view: newBookmarkView(ready.source, page - 1),
      },
      true,
    );
    if (after?.selected) {
      announce(`Added a bookmark for page ${page}. Type its title, then press Enter.`);
      startRename(after.selected, `Page ${page}`);
    }
  };

  const command = (which: EditCommand) => {
    const now = current.current;
    if (!now || !allowed(which)) return;
    if (which === 'undo' || which === 'redo') {
      perform({ type: which });
      return;
    }
    const at = now.selected ? find(now.items, now.selected) : null;
    if (!at) return;
    const id = at.item.id;
    if (which === 'rename') {
      startRename(id);
      return;
    }
    if (which === 'delete') {
      // A bookmark with others under it is removed only after asking.
      const question = deleteQuestion(at.item);
      if (question) {
        askedFrom.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        setConfirmDelete({ id, question });
      } else perform({ type: 'delete', id });
      return;
    }
    perform(which === 'up' || which === 'down' ? { type: 'move', id, direction: which } : which === 'indent' ? { type: 'indent', id } : { type: 'outdent', id });
  };

  // ---- keys ----

  const onTreeKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (busy || !state || event.target !== event.currentTarget) return;
    const { key } = event;
    // Alt + the arrows, Ctrl+Z and Ctrl+Y never get here: the window guard below acts on them.
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const at = selectedIndex;
    const go = (index: number) => {
      if (rows.length === 0) return;
      select(rows[Math.max(0, Math.min(rows.length - 1, index))].key);
    };
    switch (key) {
      case 'ArrowDown':
        event.preventDefault();
        go(at < 0 ? 0 : at + 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        go(at < 0 ? 0 : at - 1);
        break;
      case 'Home':
        event.preventDefault();
        go(0);
        break;
      case 'End':
        event.preventDefault();
        go(rows.length - 1);
        break;
      case 'PageDown':
        event.preventDefault();
        go(at + 10);
        break;
      case 'PageUp':
        event.preventDefault();
        go(at - 10);
        break;
      case 'ArrowRight':
        // To the first bookmark under this one.
        event.preventDefault();
        if (at >= 0 && rows[at + 1]?.depth === rows[at].depth + 1) go(at + 1);
        break;
      case 'ArrowLeft': {
        // To the bookmark this one is under.
        event.preventDefault();
        if (at < 0) break;
        const depth = rows[at].depth;
        for (let i = at - 1; i >= 0 && depth > 0; i--) {
          if (rows[i].depth === depth - 1) {
            go(i);
            break;
          }
        }
        break;
      }
      case 'Enter':
      case 'F2':
        event.preventDefault();
        if (!event.repeat) command('rename');
        break;
      case 'Delete':
        event.preventDefault();
        if (!event.repeat) command('delete');
        break;
      case 'Insert':
        event.preventDefault();
        if (!event.repeat) add();
        break;
    }
  };

  // Undo and redo from anywhere in the bookmark pane, except a text box (which has its own).
  // The dialog's shortcuts from wherever its focus is (tree, page strip, a toolbar button, the footer), and
  // the application's kept away (review F1: Alt+Right on the strip remounted PDF Tools, Ctrl+Y opened My
  // Tasks, both throwing the edits away). The one shared guard (dialogKeys.ts; REV-B S13), on the window in
  // the capture phase: before any other listener. Where a key was pressed is the frame's rule (framePlace): a
  // text box first, wherever it is, so Ctrl+Z in the page viewer's boxes is still their own undo; then the
  // dialog; anything else (a question over it, the viewer, the focus nowhere) is held.
  const commandRef = useRef(command);
  commandRef.current = command;
  useEffect(
    () =>
      attachDialogKeys<BookmarkKeyAction>(window as unknown as KeyTarget, (target) => framePlace(tree.current?.closest('[role="dialog"]') ?? null, target), {
        phase: 'capture',
        own: bookmarkKeyAction,
        act: (action) => commandRef.current(action),
      }),
    [],
  );

  // ---- closing ----

  // Closing with unsaved changes asks first; a run that is stopped or goes stale closes through useToolRun.
  // "Keep editing" goes back to the control that asked (REV-B minor 2).
  const closeAskedFrom = useRef<HTMLElement | null>(null);
  const requestClose = () => {
    if (edited && !busy) {
      closeAskedFrom.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setConfirmClose(true);
    } else onClose();
  };

  const save = () => {
    const now = current.current;
    if (!ready || !now || !editable || !treesDiffer(ready.start.items, now.items)) return;
    const { bookmarks: _saved, ...edits } = editCounts(ready.start.items, now.items);
    run.start({ items: toOutline(now), name: name.resolved, edits });
  };

  // ---- drawing ----

  const windowRows: number[] = [];
  for (let i = virtual.start; i < virtual.end; i++) windowRows.push(i);
  if (editingIndex >= 0 && (editingIndex < virtual.start || editingIndex >= virtual.end)) windowRows.push(editingIndex);
  const counter = editing ? titleCounter(editing.text) : null;
  const longTitles = ready ? longTitlesNotice(ready.source.problems.longTitles) : null;
  const selectedRow = selectedIndex >= 0 ? rows[selectedIndex] : null;
  const keysHelpId = 'pdf-tools-bookmarks-keys';

  return (
    <>
      <ToolDialog
        tool="bookmarks"
        files={files}
        run={run}
        size="2xl"
        showFile
        description="Add, rename, arrange or remove the bookmarks of a copy of this PDF. The original is not changed."
        runLabel={!ready || !editable ? 'Save bookmarks' : kept === 0 ? 'Save with no bookmarks' : `Save ${countLabel(kept, 'bookmark')}`}
        blocked={!ready || !editable || !edited}
        blockedReason={
          loaded.status === 'failed'
            ? 'The file has to be read again first: press Try again.'
            : !ready
              ? 'The bookmarks are still being read.'
              : !editable
                ? 'This file has too many bookmarks, or levels, to edit here.'
                : !edited
                  ? 'Nothing has changed yet, so there is nothing to save.'
                  : null
        }
        onRun={save}
        onClose={requestClose}
        signedWarning={SIGNED_WARNING}
        busyNote="Saving re-writes the whole file; a large file takes a few seconds."
      >
        {loaded.status === 'failed' && (
          <Notice tone="error" icon={AlertCircle} role="alert" title={loaded.title} testId="pdf-tools-bookmarks-read-error">
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span>{loaded.message}</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 px-2.5 text-xs"
                data-testid="pdf-tools-bookmarks-read-retry"
                onClick={() => setAttempt((n) => n + 1)}
              >
                Try again
              </Button>
            </span>
          </Notice>
        )}
        {ready && !editable && (
          <Notice tone="warning" icon={FileWarning} role="alert" title="Read-only: too many bookmarks to edit" testId="pdf-tools-bookmarks-not-editable">
            {BOOKMARKS_NOT_EDITABLE_MESSAGE}
          </Notice>
        )}
        {notCarriedLine && (
          <Notice tone="neutral" title="Not carried" testId="pdf-tools-bookmarks-not-carried">
            {notCarriedLine}
          </Notice>
        )}
        {longTitles && (
          <Notice tone="neutral" title="Long titles" testId="pdf-tools-bookmarks-long-titles">
            {longTitles}
          </Notice>
        )}

        <div className="grid h-[min(440px,44vh)] min-h-[260px] grid-cols-[132px_minmax(0,1fr)] gap-3 sm:grid-cols-[148px_minmax(0,1fr)]">
          <PageStrip ref={strip} file={file} current={page} onChoose={setPage} running={busy} className="h-full" />

          <div className="flex min-h-0 min-w-0 flex-col gap-2">
            {/* A file that cannot be edited shows its bookmarks only: no actions to explain away. */}
            {(!ready || editable) && (
              <ActionBar
                busy={busy}
                onWhy={(text, pressed, only) => {
                  setWhy((was) => (only === undefined || was === only ? text : was));
                  if (pressed && text) announce(text);
                }}
                actions={[
                  {
                    id: 'add',
                    icon: BookmarkPlus,
                    label: `Add for page ${page}`,
                    keys: 'Insert',
                    why: reasons.add,
                    onPress: add,
                    accent: true,
                  },
                  {
                    id: 'rename',
                    icon: PencilLine,
                    label: 'Rename',
                    keys: 'F2',
                    why: reasons.rename,
                    onPress: () => command('rename'),
                    group: true,
                  },
                  {
                    id: 'up',
                    icon: ArrowUp,
                    label: 'Move up',
                    keys: 'Alt+ArrowUp',
                    why: reasons.up,
                    onPress: () => command('up'),
                    iconOnly: true,
                  },
                  {
                    id: 'down',
                    icon: ArrowDown,
                    label: 'Move down',
                    keys: 'Alt+ArrowDown',
                    why: reasons.down,
                    onPress: () => command('down'),
                    iconOnly: true,
                  },
                  {
                    id: 'indent',
                    icon: IndentIncrease,
                    label: 'Indent',
                    keys: 'Alt+ArrowRight',
                    why: reasons.indent,
                    onPress: () => command('indent'),
                  },
                  {
                    id: 'outdent',
                    icon: IndentDecrease,
                    label: 'Outdent',
                    keys: 'Alt+ArrowLeft',
                    why: reasons.outdent,
                    onPress: () => command('outdent'),
                  },
                  {
                    id: 'delete',
                    icon: Trash2,
                    label: 'Remove',
                    keys: 'Delete',
                    why: reasons.delete,
                    onPress: () => command('delete'),
                  },
                  {
                    id: 'undo',
                    icon: Undo2,
                    label: 'Undo',
                    keys: 'Control+Z',
                    why: reasons.undo,
                    onPress: () => command('undo'),
                    group: true,
                    iconOnly: true,
                  },
                  {
                    id: 'redo',
                    icon: Redo2,
                    label: 'Redo',
                    keys: 'Control+Y',
                    why: reasons.redo,
                    onPress: () => command('redo'),
                    iconOnly: true,
                  },
                ]}
              />
            )}

            <div className="relative min-h-0 flex-1 overflow-hidden rounded-md border bg-card">
              {loaded.status === 'reading' && (
                <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground" role="status" data-testid="pdf-tools-bookmarks-reading">
                  <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden="true" />
                  {readingFor >= READING_SAYS_TIME_AFTER_S ? `Reading the bookmarks… ${readingFor} s. A large file takes longer.` : 'Reading the bookmarks…'}
                </div>
              )}
              {ready && rows.length === 0 && (
                <div className="flex h-full flex-col items-center justify-center gap-1 px-6 text-center" data-testid="pdf-tools-bookmarks-empty">
                  <p className="text-sm font-medium text-foreground">This file has no bookmarks yet.</p>
                  <p className="text-xs text-muted-foreground">{editable ? `${EMPTY_HINT} Choose a page on the left first.` : ''}</p>
                </div>
              )}
              <div
                ref={tree}
                id="pdf-tools-bookmarks-tree"
                role="tree"
                tabIndex={ready && rows.length > 0 ? 0 : -1}
                aria-label={`Bookmarks of ${file.name}`}
                aria-describedby={ready && !editable ? undefined : keysHelpId}
                aria-activedescendant={selectedRow && !editing ? `pdf-tools-bookmarks-row-${selectedRow.key}` : undefined}
                aria-busy={loaded.status === 'reading' || undefined}
                data-testid="pdf-tools-bookmarks-tree"
                onScroll={virtual.onScroll}
                onKeyDown={onTreeKey}
                onFocus={(event) => {
                  if (event.target !== event.currentTarget) return;
                  setTreeFocused(true);
                  // Focus with nothing chosen yet: the first bookmark is chosen, so the keys have a place to
                  // start (the current page is left as the user chose it).
                  if (state && !state.selected && rows.length > 0) perform({ type: 'select', id: rows[0].key }, true);
                }}
                onBlur={() => setTreeFocused(false)}
                className={cn('absolute inset-0 overflow-y-auto focus-visible:outline-none', rows.length === 0 && 'pointer-events-none')}
              >
                <div className="relative" style={{ height: virtual.total }}>
                  {windowRows.map((index) => {
                    const row = rows[index];
                    const isEditing = editing?.id === row.key;
                    return (
                      <TreeRowView
                        key={row.key}
                        row={row}
                        id={`pdf-tools-bookmarks-row-${row.key}`}
                        height={ROW}
                        top={index * ROW}
                        active={state?.selected === row.key}
                        focused={treeFocused}
                        testId={`pdf-tools-bookmarks-node-${row.position}`}
                        onClick={() => {
                          if (busy) return;
                          select(row.key);
                          tree.current?.focus({ preventScroll: true });
                        }}
                        onDoubleClick={() => !busy && command('rename')}
                      >
                        {isEditing && editing ? (
                          <input
                            ref={renameInput}
                            value={editing.text}
                            spellCheck={false}
                            autoComplete="off"
                            aria-label={`Title of bookmark ${row.position}`}
                            aria-invalid={editing.error ? true : undefined}
                            aria-describedby={editing.error ? 'pdf-tools-bookmarks-title-error' : 'pdf-tools-bookmarks-title-hint'}
                            data-testid="pdf-tools-bookmarks-title-input"
                            onChange={(event) =>
                              setEditing({
                                ...editing,
                                text: limitTyped(event.target.value),
                                error: null,
                              })
                            }
                            onKeyDown={(event) => {
                              event.stopPropagation();
                              if (event.key === 'Enter') {
                                event.preventDefault();
                                if (!event.repeat) finishRename('enter');
                              }
                            }}
                            onBlur={() => finishRename('blur')}
                            onClick={(event) => event.stopPropagation()}
                            onDoubleClick={(event) => event.stopPropagation()}
                            className={cn(
                              'h-7 min-w-0 flex-1 rounded border border-input bg-background px-2 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                              editing.error && 'border-destructive focus-visible:ring-destructive',
                            )}
                          />
                        ) : null}
                      </TreeRowView>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="min-h-[2.25rem] space-y-1 text-xs">
              {editing?.error ? (
                <p key="error" id="pdf-tools-bookmarks-title-error" role="alert" className="text-destructive" data-testid="pdf-tools-field-error">
                  {editing.error}
                </p>
              ) : notice ? (
                <p key="notice" role="alert" className="text-destructive" data-testid="pdf-tools-bookmarks-notice">
                  {notice}
                </p>
              ) : editing ? (
                <p key="typing" id="pdf-tools-bookmarks-title-hint" className="text-muted-foreground">
                  Enter keeps the title; Escape leaves it as it was.{' '}
                  {counter && (
                    <span className={cn('tabular-nums', counter.startsWith('256') && 'font-medium text-foreground')} data-testid="pdf-tools-bookmarks-title-counter">
                      {counter}
                    </span>
                  )}
                </p>
              ) : why ? (
                <p key="why" className="text-foreground" data-testid="pdf-tools-bookmarks-why">
                  {why}
                </p>
              ) : ready && !editable ? null : (
                <p key="keys" id={keysHelpId} className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-muted-foreground">
                  <span>
                    <Kbd>↑↓</Kbd> choose
                  </span>
                  <span>
                    <Kbd>Alt ↑↓</Kbd> move
                  </span>
                  <span>
                    <Kbd>Alt →←</Kbd> indent, outdent
                  </span>
                  <span>
                    <Kbd>F2</Kbd> rename
                  </span>
                  <span>
                    <Kbd>Del</Kbd> remove
                  </span>
                  <span>
                    <Kbd>Ctrl Z</Kbd> <Kbd>Ctrl Y</Kbd> undo, redo
                  </span>
                </p>
              )}
              {/* Why Save cannot be pressed is said by Save itself (the frame's blockedReason). */}
              <p className="text-muted-foreground" data-testid="pdf-tools-bookmarks-status">
                {ready ? (
                  <>
                    {countLabel(total, 'bookmark')}
                    {notCarriedTotal > 0 ? ` (${countLabel(notCarriedTotal, 'not carried', 'not carried')})` : ''}
                    {!editable ? (
                      ' · read-only'
                    ) : edited ? (
                      <>
                        {' · '}
                        <span className="font-medium text-foreground">Changed. Save to make the new copy.</span>
                      </>
                    ) : null}
                  </>
                ) : (
                  ' '
                )}
              </p>
            </div>
            {/* What each action did, for a screen reader. A new element each time, so a repeat is read again. */}
            <div aria-live="polite" className="sr-only" data-testid="pdf-tools-bookmarks-announce">
              {said.text && <p key={said.n}>{said.text}</p>}
            </div>
          </div>
        </div>

        {/* A file that cannot be edited makes no copy: no name to give it. */}
        {(!ready || editable) && <ResultNameField name={name} />}
      </ToolDialog>

      <AlertDialog open={confirmDelete !== null} onOpenChange={(open) => !open && setConfirmDelete(null)}>
        <AlertDialogContent
          data-testid="pdf-tools-bookmarks-delete-confirm"
          onCloseAutoFocus={(event) => {
            // Opened from state: no trigger for Radix to return to. Back to the tree or the Remove button.
            event.preventDefault();
            const back = askedFrom.current;
            askedFrom.current = null;
            (back?.isConnected ? back : tree.current)?.focus({
              preventScroll: true,
            });
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Remove bookmarks?</AlertDialogTitle>
            <AlertDialogDescription>{confirmDelete?.question} Undo brings them back.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep</AlertDialogCancel>
            <AlertDialogAction
              data-testid="pdf-tools-bookmarks-delete-confirm-yes"
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (confirmDelete) perform({ type: 'delete', id: confirmDelete.id });
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmClose} onOpenChange={setConfirmClose}>
        <AlertDialogContent
          data-testid="pdf-tools-bookmarks-close-confirm"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const back = closeAskedFrom.current;
            closeAskedFrom.current = null;
            const inDialog = back?.isConnected && back !== document.body && back.closest('[role="dialog"]') !== null;
            (inDialog ? back : tree.current)?.focus({ preventScroll: true });
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Discard your changes?</AlertDialogTitle>
            <AlertDialogDescription>Your changes to the bookmarks have not been saved. If you leave now, they are lost and nothing is added.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction data-testid="pdf-tools-bookmarks-close-confirm-yes" onClick={onClose}>
              Discard changes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
