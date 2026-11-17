// Redact (design 5.9 "What the user sees"; plan Task A10): one PDF, reviewed before anything is removed.
// The dialog fills most of the window: the page on the left (the page viewer's surface, with the
// review's boxes over it, drawn boxes by dragging or with the keyboard), the list and the choices on the
// right, and the footer of every tool (Cancel and Redact, or progress and Stop). The file is searched as
// the dialog opens (progress, Stop); Redact first shows a confirmation with its warnings; the run
// (redact/redactRun.ts) may ask to flatten pages that hold a value no box can cover.
//
// Confidentiality: values, typed words and replacements live in this component's state only, gone when
// it closes (and it closes on a change of engagement or user: the page viewer it holds says so). The
// list shows values (its purpose); nothing else does: no value in a toast, an error, the console,
// storage, a key, a test id, a title or an accessible name. Only the profile's name is remembered
// (localStorage `pdfTools.redact.profile`).
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { AlertCircle, ChevronLeft, ChevronRight, EyeOff, FileSignature, Info, Keyboard, Loader2, Mouse, Redo2, SquarePlus, Undo2, ZoomIn, ZoomOut } from 'lucide-react';
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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { DialogOverlay, DialogPortal } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { defaultResultName } from '@/lib/pdf-tools/resultNames';
import { pageDrawingsAndVerdicts, targetMatcher } from '@/lib/pdf-tools/redactCheck';
import { everyOccurrence, materializeHeld, sameTextProposals, tokenUnderBox, type Proposal } from '@/lib/pdf-tools/redactFind';
import type { RedactKind } from '@/lib/pdf-tools/redactPatterns';
import { yieldToUi } from '../canvasUtils';
import { formatBytes, plainMessage } from '../format';
import * as renderer from '../pdfRenderer';
import RedactList from '../redact/RedactList';
import { FindControls, OutputControls } from '../redact/RedactOptions';
import { newBoxId } from '../redact/drawnBoxes';
import RedactPageSurface, { type PendingBox } from '../redact/RedactPageSurface';
import { canvasMeasure, expandValueInTurns, findInFile, findInModels, FindStopped, type FileText, type FindReader, type FindResult } from '../redact/redactFindRun';
import { choicesError, confirmFacts, confirmSentence, DEFAULT_CHOICES, runOptionsFrom, type RedactChoices } from '../redact/redactChoices';
import { flattenQuestion, pagesInWords, REDACT_LIMITS, REDACTED_NAME, safeResultName, textCoveredSentence } from '../redact/redactRecord';
import { pagesLosingText, type FlattenInfo } from '../redact/redactRounds';
import { notFoundLine, noTextNotice, omitsHindi, PAGE_WITHOUT_TEXT, searchableNote, textLayerWouldOmit, valueRows } from '../redact/redactView';
import { checkTargets, confirmSummary, disposeReview, heldGroups, heldRows, initialReview, PROFILE_STORAGE_KEY, profileFrom, reviewReducer, termsNotFound, type DrawnBox, type ReviewProfile, type ReviewState } from '../redact/reviewState';
import { CSS_PX_PER_PT } from '../viewer/viewerMath';
import { usePageViewer } from '../viewer/usePageViewer';
import { focusQuietly } from '../quietFocus';
import { useDialogKeys } from '../useDialogKeys';
import { signedWarningText } from './fieldProps';
import { Notice } from './ToolDialog';
import { stopQuestion, stopTitle, useToolRun, type ToolDialogProps } from './useToolRun';

const reader: FindReader = {
  pageTextContent: (file, page, options) => renderer.pageTextContent(file, page, { ...options, priority: 'run' }),
  pageGeometries: (file, options) => renderer.pageGeometries(file, { ...options, priority: 'run' }),
  pageAnnotationTexts: (file, page, options) => renderer.pageAnnotationTexts(file, page, { ...options, priority: 'run' }),
};

function storedProfile(): ReviewProfile {
  try {
    return profileFrom(window.localStorage.getItem(PROFILE_STORAGE_KEY));
  } catch {
    return 'balanced';
  }
}

function storeProfile(profile: ReviewProfile): void {
  try {
    window.localStorage.setItem(PROFILE_STORAGE_KEY, profile);
  } catch {
    // Private mode or blocked storage: the profile is simply not remembered.
  }
}

const isTextField = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

type Found = FileText & FindResult;

export default function RedactDialog(props: ToolDialogProps) {
  const { files, onClose } = props;
  const file = files[0];
  const pageCount = file.pageCount ?? 0;
  const run = useToolRun('redact', props);
  const busy = run.phase !== 'idle';
  const contentRef = useRef<HTMLDivElement>(null);

  // ---- the find --------------------------------------------------------------------------------------
  const [found, setFound] = useState<Found | null>(null);
  const [finding, setFinding] = useState<{ done: number; total: number } | null>({ done: 0, total: 0 });
  const [findError, setFindError] = useState<string | null>(null);
  const [findAgain, setFindAgain] = useState(0);
  // Wave 6 (T-052): the pages that may not be copied (ruling M), or null while they are being read.
  const [notPlain, setNotPlain] = useState<number[] | null>(null);
  const findStop = useRef<AbortController | null>(null);
  const [state, dispatch] = useReducer(reviewReducer, undefined, () => initialReview(storedProfile()));
  const loadedTerms = useRef(state.terms);

  useEffect(() => {
    const controller = new AbortController();
    findStop.current = controller;
    let mounted = true;
    const scope = props.scope();
    const inScope = () => {
      const now = props.store.getState();
      return now.contextKey === scope.contextKey && now.session === scope.session;
    };
    const live = () => !controller.signal.aborted && inScope();
    setFinding({ done: 0, total: 0 });
    setFindError(null);
    setNotPlain(null);
    findInFile(file.bytes, { reader, signal: controller.signal, live, onProgress: (p) => live() && setFinding(p), terms: [], measure: canvasMeasure, pause: yieldToUi }).then(
      (result) => {
        if (!mounted || !live()) return;
        loadedTerms.current = [];
        setFound(result);
        setFinding(null);
        dispatch({ type: 'loaded', proposals: result.proposals, held: result.held });
        // Wave 6 (T-052, ruling M): which pages may not be copied, read now so the confirmation can name them and
        // count them in the size (in turns for the window; until it is known, the confirmation says pages may be).
        void pageDrawingsAndVerdicts(file.bytes, Array.from({ length: result.models.length }, (_, i) => i), { signal: controller.signal, onProgress: () => yieldToUi() }).then(
          ({ verdicts }) => {
            if (mounted && live()) setNotPlain(verdicts.filter((v) => !v.plain).map((v) => v.page));
          },
          () => undefined,
        );
      },
      (error: unknown) => {
        // Gone, or the engagement moved on: nothing is shown. Stopped by the user: say so, offer to search again.
        if (!mounted || !inScope()) return;
        setFinding(null);
        setFindError(error instanceof FindStopped || controller.signal.aborted ? null : plainMessage(error, 'The file could not be searched. It may be damaged.'));
      },
    );
    return () => {
      mounted = false;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the find runs once per opening (and on "Search again")
  }, [file.id, findAgain]);

  // A typed word added or removed: search what was read again (quick: no file reading). Places of held
  // values the user ticked, and "same text" places of drawn boxes, are kept.
  const [researching, setResearching] = useState(false);
  // Ruling R (wave 5): the words the last search was for; a typed word is named "not found" only once it was searched.
  const [searchedTerms, setSearchedTerms] = useState<ReviewState['terms'] | null>(null);
  const proposalsRef = useRef(state.proposals);
  proposalsRef.current = state.proposals;
  useEffect(() => {
    if (!found || loadedTerms.current === state.terms) return;
    loadedTerms.current = state.terms;
    const terms = state.terms;
    let current = true;
    setResearching(true);
    void findInModels(found, terms, canvasMeasure, yieldToUi).then((result) => {
      if (!current) return;
      setResearching(false);
      setSearchedTerms(terms);
      const ids = new Set(result.proposals.map((p) => p.id));
      const kept = proposalsRef.current.filter((p) => !ids.has(p.id) && p.kind !== 'typed');
      setFound((f) => (f ? { ...f, ...result } : f));
      dispatch({ type: 'loaded', proposals: [...result.proposals, ...kept], held: result.held });
    });
    return () => {
      current = false;
    };
  }, [state.terms, found]);

  // ---- choices -----------------------------------------------------------------------------------------
  const [choices, setChoices] = useState<RedactChoices>(DEFAULT_CHOICES);
  // The custom token lives in this holder, never in `choices` or any prop: React keeps a page element's
  // props until one of its attributes changes, so a token passed down stayed reachable after it was
  // cleared (heap snapshot after a failed run, drive 6). `choices.token` stays the default.
  const tokenHolder = useRef<string>(DEFAULT_CHOICES.token);
  const [, setTokenTick] = useState(0);
  const onToken = useCallback((token: string) => {
    tokenHolder.current = token;
    setTokenTick((n) => n + 1);
  }, []);
  const onProfile = (profile: ReviewProfile) => {
    dispatch({ type: 'profile', profile });
    storeProfile(profile);
  };

  // ---- the page -----------------------------------------------------------------------------------------
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const viewer = usePageViewer({ fileId: file.id, startPage: 1, onClose: () => closeRef.current() });
  const page = viewer.page - 1;
  const [drawMode, setDrawMode] = useState(false);
  // "Add a box" works with the mouse (drag on the page) unless the user picks the keyboard.
  const [boxBy, setBoxBy] = useState<'mouse' | 'keys'>('mouse');
  const [pending, setPending] = useState<PendingBox | null>(null);

  const show = useCallback(
    (target: number, id: string) => {
      dispatch({ type: 'select', id });
      if (target + 1 !== viewer.page) viewer.goTo(target + 1);
    },
    [viewer],
  );

  const addBoxWithKeys = () => {
    const g = found?.geometries[page];
    if (!g) return;
    const [x0, y0, x1, y1] = g.view;
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    setPending({ page, rect: { x0: cx - 60, y0: cy - 8, x1: cx + 60, y1: cy + 8 } });
  };
  // "Add a box" is on while the mouse draws or a keyboard box waits to be placed. Choosing the other way
  // while it is on carries on in that way at once: no half state with both.
  const addingBox = drawMode || pending !== null;
  // A keyboard box the user has moved or resized is added, as Enter would, when the user leaves it for the
  // mouse or switches "Add a box" off: nothing placed is lost. One never touched is dropped. (Escape drops.)
  const keepPlacedBox = () => {
    const g = pending?.placed ? found?.geometries[pending.page] : undefined;
    if (pending && g) dispatch({ type: 'draw', box: { id: newBoxId(), page: pending.page, rect: pending.rect, angle: g.rotate } });
    setPending(null);
  };
  const stopAddingBox = () => {
    setDrawMode(false);
    keepPlacedBox();
  };
  const startAddingBox = (by: 'mouse' | 'keys') => {
    if (by === 'mouse') {
      keepPlacedBox();
      setDrawMode(true);
    } else {
      setDrawMode(false);
      // a box already waiting stays where the user put it
      if (!pending) addBoxWithKeys();
    }
  };
  const chooseBoxBy = (by: 'mouse' | 'keys') => {
    setBoxBy(by);
    if (addingBox) startAddingBox(by);
  };

  // ---- the list ------------------------------------------------------------------------------------------
  const rows = useMemo(() => valueRows(state), [state]);
  const held = useMemo(() => heldGroups(state), [state]);
  const boxTokens = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const d of state.drawn) {
      const model = found?.models[d.page];
      map.set(d.id, model ? tokenUnderBox(model, d.rect, canvasMeasure) : null);
    }
    return map;
  }, [state.drawn, found]);
  const onBoxEverywhere = (box: DrawnBox, on: boolean) => {
    if (!found) return;
    const token = boxTokens.get(box.id);
    if (!on || !token) {
      dispatch({ type: 'box-everywhere', id: box.id, on: false });
      return;
    }
    dispatch({ type: 'box-everywhere', id: box.id, on: true, proposals: sameTextProposals(found.models, token, box.id, canvasMeasure, found.annotations) });
  };
  // Ticking a value that is only possible: its other places are searched now (redactFindRun.ts expandsAtOnce).
  const onTickValue = (places: readonly Proposal[], on: boolean) => {
    dispatch({ type: 'tick', ids: places.map((p) => p.id), on });
    if (!on || !found || places.some((p) => p.confidence === 'sure')) return;
    // Wave 6 (T-052): searched in turns for the window (a value over every page of a long file held it over 1 s).
    void expandValueInTurns(found, places, new Set(state.proposals.map((p) => p.id)), canvasMeasure, yieldToUi).then((extras) => {
      const now = new Set(proposalsRef.current.map((p) => p.id));
      const fresh = extras.filter((p) => !now.has(p.id));
      if (fresh.length > 0) dispatch({ type: 'loaded', proposals: [...proposalsRef.current, ...fresh] });
    });
  };
  const onPromote = (index: number) => {
    if (!found) return;
    const places = everyOccurrence(found.models, materializeHeld(state.held, index, found.models, canvasMeasure), canvasMeasure, found.annotations);
    dispatch({ type: 'promote', index, proposals: places, on: true });
  };

  // ---- confirmation, run, flatten question ----------------------------------------------------------------------
  const [step, setStep] = useState<'review' | 'confirm'>('review');
  const [ask, setAsk] = useState<{ pages: number[]; mayShow: number[]; answer: (yes: boolean) => void } | null>(null);
  const [confirmStop, setConfirmStop] = useState(false);
  // Wave 6 (T-052): Redact waits while a typed word is still being searched (from the moment it is added).
  const searchingWords = researching || (searchedTerms !== null ? searchedTerms !== state.terms : state.terms.length > 0);
  const problem = found ? choicesError({ ...choices, token: tokenHolder.current }, state, searchingWords) : null;
  const facts = useMemo(
    () => (found ? confirmFacts(state, pageCount, found.pagesWithoutText, choices.dpi, (p) => (found.models[p]?.text ?? '').replace(/\s/g, '').length, notPlain) : null),
    [found, state, pageCount, choices.dpi, notPlain],
  );
  const summary = useMemo(() => confirmSummary(state), [state]);
  // Ruling R (wave 5): Hindi is named only where the redacted pages have Devanagari.
  const omitNote = useMemo(
    () => (choices.output === 'searchable' && found !== null && summary.pages.some((p) => textLayerWouldOmit(found.models[p]?.text ?? '')) ? searchableNote(omitsHindi(summary.pages.map((p) => found.models[p]?.text ?? ''))) : null),
    [choices.output, found, summary.pages],
  );
  // Ruling R (wave 5): typed words the find placed nowhere, named before the run (never dropped silently).
  const notFound = useMemo(() => (found && searchedTerms === state.terms ? termsNotFound(state) : []), [found, searchedTerms, state]);
  // K1 (wave 4): pages where text Redact cannot read will be covered, said before the run (one sentence, only when it applies).
  const coveredText = useMemo(
    () => (step === 'confirm' && found ? textCoveredSentence(pagesLosingText(found.models, summary.pages, checkTargets(state).flatMap((t) => t.forms))) : null),
    [step, found, summary.pages, state],
  );
  // B6: the result's usual name would show a chosen value (a Form 16 named with the PAN): the run names it
  // "Redacted document.pdf", and the confirmation says so first. Worked out only on the confirmation step.
  const usualName = defaultResultName('redact', file.name);
  const resultName = useMemo(() => (step === 'confirm' ? safeResultName(usualName, targetMatcher(checkTargets(state))) : usualName), [step, usualName, state]);

  // Each run that ends with the dialog still open clears the word and token fields' copies (RedactOptions.tsx),
  // and a custom token goes back to the default, like the other typed fields (it could hold a value).
  const [runs, setRuns] = useState(0);
  const lastPhase = useRef(run.phase);
  useEffect(() => {
    const before = lastPhase.current;
    lastPhase.current = run.phase;
    if (run.phase !== 'idle' || before === 'idle') return;
    setRuns((n) => n + 1);
    tokenHolder.current = DEFAULT_CHOICES.token;
  }, [run.phase]);

  // A question left open when the run stops or the dialog goes is answered "no", so the run never waits for ever.
  const askRef = useRef(ask);
  askRef.current = ask;
  useEffect(() => {
    if (run.phase !== 'running' && askRef.current) {
      askRef.current.answer(false);
      setAsk(null);
    }
  }, [run.phase]);
  useEffect(
    () => () => {
      askRef.current?.answer(false);
      // Page texts the find's modules hold go with the dialog (R1 fix round 2); the review state goes with React's.
      disposeReview();
    },
    [],
  );
  useEffect(() => {
    if (run.phase === 'idle') disposeReview();
  }, [run.phase]);

  const start = () => {
    if (!found || problem) return;
    // The run checks the name again against the values chosen (redactRun.ts, B6).
    const name = defaultResultName('redact', file.name);
    const confirmFlatten = (pages: number[], info?: FlattenInfo) =>
      new Promise<boolean>((resolve) => {
        setAsk({
          pages,
          mayShow: info?.mayShow ?? [],
          answer: (yes) => {
            setAsk(null);
            resolve(yes);
          },
        });
        // The page is shown at once: the one that may show a value first (B5).
        const first = info?.mayShow?.[0] ?? pages[0];
        if (first !== undefined) viewerRef.current.goTo(first + 1);
      });
    run.start(runOptionsFrom(state, found, { ...choices, token: tokenHolder.current }, file.id, { confirmFlatten, name }));
  };

  // A message from an earlier run goes once the review changes again.
  const { clearMessages } = run;
  const firstState = useRef(state);
  useEffect(() => {
    if (state !== firstState.current) clearMessages();
  }, [state, clearMessages]);

  // ---- keys -------------------------------------------------------------------------------------------------------
  const onKeyDown = (event: ReactKeyboardEvent) => {
    if (busy || isTextField(event.target)) return;
    const ctrl = event.ctrlKey || event.metaKey;
    if (ctrl && event.key.toLowerCase() === 'z' && !event.shiftKey) {
      event.preventDefault();
      dispatch({ type: 'undo' });
    } else if (ctrl && (event.key.toLowerCase() === 'y' || (event.key.toLowerCase() === 'z' && event.shiftKey))) {
      event.preventDefault();
      dispatch({ type: 'redo' });
    } else if ((event.key === 'Delete' || event.key === 'Backspace') && state.selected && state.drawn.some((d) => d.id === state.selected)) {
      event.preventDefault();
      dispatch({ type: 'delete-drawn', ids: [state.selected] });
    }
  };
  // Ctrl + plus, minus and 0 zoom the page here, never the whole application (lane V review, item 1).
  const viewerRef = useRef(viewer);
  viewerRef.current = viewer;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      if (['=', '+', '-', '_', '0'].includes(event.key)) {
        event.preventDefault();
        event.stopPropagation();
        const v = viewerRef.current;
        if (event.key === '-' || event.key === '_') v.zoomOut();
        else if (event.key === '0') v.setZoom({ kind: 'fit-page' });
        else v.zoomIn();
      }
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, []);

  // ---- the Stop question and the focus: the shared frame's rules (ToolDialog.tsx) on this dialog's own frame -----------
  // The Stop question is opened from state (no trigger), so it returns the focus itself. Stop always keeps this
  // dialog open, from the footer or from Escape: the review would be lost with it.
  const runButton = useRef<HTMLButtonElement>(null);
  const stopButton = useRef<HTMLButtonElement>(null);
  const stopOpener = useRef<HTMLElement | null>(null);
  const askToStop = () => {
    stopOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setConfirmStop(true);
  };
  const requestClose = () => {
    if (run.phase === 'running') askToStop();
    else if (run.phase === 'idle') onClose();
  };
  // The application's shortcuts never act behind the dialog, wherever the focus is (useDialogKeys.ts). An Escape that
  // no layer took (pressed while a layer was appearing: Radix counts neither as the top one then) is acted on as the top
  // layer would have: the Stop question closes (Keep running), else a box being placed is dropped, else the dialog
  // closes or, while a run goes on, asks to stop first.
  const lostEscape = useRef<() => void>(() => undefined);
  useDialogKeys(contentRef, () => lostEscape.current());
  lostEscape.current = () => {
    if (confirmStop) setConfirmStop(false);
    else if (pending) setPending(null);
    else requestClose();
  };
  // Redact disappears when a run starts and Stop when it ends: the focus moves with them, so it is never left on the
  // page body. A run that ends on its own closes the question.
  const framePhase = useRef(run.phase);
  useEffect(() => {
    const before = framePhase.current;
    framePhase.current = run.phase;
    if (run.phase === 'running' && before === 'idle') stopButton.current?.focus();
    if (run.phase === 'idle' && before !== 'idle') {
      setConfirmStop(false);
      // The Stop question is on screen or still closing (its exit animation keeps the rest of the page aria-hidden):
      // focusing now would put the focus inside a hidden tree, which Chromium blocks and warns about. The question's
      // own onCloseAutoFocus places it once the question has gone.
      if (stopOpener.current) return;
      // Left where the user put it (the page's buttons stay usable during a run); moved only if it went with Stop.
      const focused = document.activeElement;
      if (focused && focused !== document.body && focused !== contentRef.current) return;
      if (runButton.current && !runButton.current.disabled) runButton.current.focus();
      else contentRef.current?.focus();
    }
  }, [run.phase]);
  // A held key repeats: the repeats must not press Redact, Stop or the question's buttons again.
  const ignoreRepeat = (event: ReactKeyboardEvent) => {
    if (event.repeat && (event.key === 'Enter' || event.key === ' ')) event.preventDefault();
  };

  // ---- what is shown -------------------------------------------------------------------------------------------------
  const noText = found ? noTextNotice(found.pagesWithoutText, pageCount) : null;
  const percent = viewer.cssScale ? Math.round((viewer.cssScale / CSS_PX_PER_PT) * 100) : null;
  const signed = file.hasSignature;
  const measured = run.progress !== null && run.progress.total > 0;
  const runPercent = measured ? Math.min(100, Math.round((run.progress!.done / run.progress!.total) * 100)) : 0;
  const areas = summary.areas;
  const findLabel = !finding || finding.total === 0
    ? 'Opening the file…'
    : finding.done < pageCount
      ? `Reading comments and fields (page ${finding.done + 1} of ${pageCount})…`
      : finding.done < 2 * pageCount
        ? `Searching page ${Math.min(pageCount, finding.done - pageCount + 1)} of ${pageCount}…`
        : 'Listing what was found…';
  const runLabel = areas > 0 ? `Redact ${areas.toLocaleString('en-IN')} ${areas === 1 ? 'area' : 'areas'}` : 'Redact';

  return (
    <DialogPrimitive.Root open onOpenChange={(open) => !open && requestClose()}>
      <DialogPortal>
        <DialogOverlay className="bg-black/70" />
        <DialogPrimitive.Content
          data-testid="pdf-tools-redact-dialog"
          aria-describedby={undefined}
          className="fixed inset-2 z-50 flex flex-col overflow-hidden rounded-lg border bg-background shadow-2xl focus:outline-none sm:inset-4"
          onKeyDown={onKeyDown}
          ref={contentRef}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            contentRef.current?.focus();
          }}
          onEscapeKeyDown={(event) => {
            // Just after Stop, Radix still counts this dialog as the top layer until the question has rendered
            // again: the Escape meant for the question arrives here. It closes the question (Keep running).
            if (confirmStop) {
              event.preventDefault();
              setConfirmStop(false);
              return;
            }
            if (pending) {
              event.preventDefault();
              setPending(null);
              return;
            }
            if (busy) {
              event.preventDefault();
              if (run.phase === 'running') askToStop();
            }
          }}
          onInteractOutside={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => {
            // Back to the tool's button without its tooltip (as the shared frame does, QA-FIX F).
            event.preventDefault();
            focusQuietly(document.querySelector<HTMLElement>('[data-testid="pdf-tools-tool-redact"]'), { preventScroll: true });
          }}
          tabIndex={-1}
        >
          <header className="flex items-center gap-3 border-b px-4 py-2.5">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10" aria-hidden="true">
              <EyeOff className="h-4 w-4 text-primary" />
            </span>
            <div className="min-w-0 flex-1">
              <DialogPrimitive.Title className="text-base font-semibold leading-tight text-foreground">Redact</DialogPrimitive.Title>
              <p className="truncate text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{file.name}</span> · Black out personal data and anything you choose, in a copy. The original is not changed.
              </p>
            </div>
          </header>

          <div className="flex min-h-0 flex-1">
            {/* The page */}
            <section aria-label="Page" className="flex min-w-0 flex-1 flex-col border-r">
              <div className="flex flex-wrap items-center gap-1 border-b bg-card px-2 py-1.5">
                <Button type="button" size="icon" variant="ghost" className="h-8 w-8" aria-label="Previous page" aria-disabled={viewer.page <= 1 || undefined} onClick={() => viewer.page > 1 && viewer.goTo(viewer.page - 1)}>
                  <ChevronLeft />
                </Button>
                <span className="min-w-[88px] text-center text-xs tabular-nums text-foreground" data-testid="pdf-tools-redact-page">
                  Page {viewer.page} of {viewer.pageCount}
                </span>
                <Button type="button" size="icon" variant="ghost" className="h-8 w-8" aria-label="Next page" aria-disabled={viewer.page >= viewer.pageCount || undefined} onClick={() => viewer.page < viewer.pageCount && viewer.goTo(viewer.page + 1)}>
                  <ChevronRight />
                </Button>
                <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
                <Button type="button" size="icon" variant="ghost" className="h-8 w-8" aria-label="Zoom out" aria-disabled={!viewer.canZoomOut || undefined} onClick={() => viewer.canZoomOut && viewer.zoomOut()}>
                  <ZoomOut />
                </Button>
                <span className="w-11 text-center text-xs tabular-nums text-muted-foreground">{percent ? `${percent}%` : ''}</span>
                <Button type="button" size="icon" variant="ghost" className="h-8 w-8" aria-label="Zoom in" aria-disabled={!viewer.canZoomIn || undefined} onClick={() => viewer.canZoomIn && viewer.zoomIn()}>
                  <ZoomIn />
                </Button>
                <Button type="button" size="sm" variant="ghost" className="h-8 px-2 text-xs" aria-pressed={viewer.zoom.kind === 'fit-width'} onClick={() => viewer.setZoom({ kind: 'fit-width' })}>
                  Fit width
                </Button>
                <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
                <Button
                  type="button"
                  size="sm"
                  variant={addingBox ? 'default' : 'outline'}
                  className="h-8 px-2 text-xs"
                  aria-pressed={addingBox}
                  disabled={busy || !found}
                  data-testid="pdf-tools-redact-add-box"
                  onClick={() => (addingBox ? stopAddingBox() : startAddingBox(boxBy))}
                >
                  <SquarePlus />
                  Add a box
                </Button>
                <span className="flex items-center rounded-md border" role="group" aria-label="How to add a box">
                  <Button
                    type="button"
                    size="icon"
                    variant={boxBy === 'mouse' ? 'secondary' : 'ghost'}
                    className="h-8 w-8 rounded-r-none"
                    aria-label="With the mouse: drag on the page"
                    title="With the mouse: drag on the page"
                    aria-pressed={boxBy === 'mouse'}
                    disabled={busy || !found}
                    data-testid="pdf-tools-redact-box-by-mouse"
                    onClick={() => chooseBoxBy('mouse')}
                  >
                    <Mouse />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant={boxBy === 'keys' ? 'secondary' : 'ghost'}
                    className="h-8 w-8 rounded-l-none"
                    aria-label="With the keyboard: arrow keys place the box"
                    title="With the keyboard: arrow keys place the box"
                    aria-pressed={boxBy === 'keys'}
                    disabled={busy || !found}
                    data-testid="pdf-tools-redact-box-by-keys"
                    onClick={() => chooseBoxBy('keys')}
                  >
                    <Keyboard />
                  </Button>
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-8 px-2 text-xs"
                  disabled={busy || !state.drawn.some((d) => d.page === page)}
                  data-testid="pdf-tools-redact-clear-page"
                  onClick={() => dispatch({ type: 'clear-page', page })}
                >
                  Clear page boxes
                </Button>
                <span className="ml-auto flex items-center">
                  <Button type="button" size="icon" variant="ghost" className="h-8 w-8" aria-label="Undo (Ctrl+Z)" disabled={busy || state.past.length === 0} data-testid="pdf-tools-redact-undo" onClick={() => dispatch({ type: 'undo' })}>
                    <Undo2 />
                  </Button>
                  <Button type="button" size="icon" variant="ghost" className="h-8 w-8" aria-label="Redo (Ctrl+Y)" disabled={busy || state.future.length === 0} data-testid="pdf-tools-redact-redo" onClick={() => dispatch({ type: 'redo' })}>
                    <Redo2 />
                  </Button>
                </span>
              </div>
              {pending && (
                <p className="border-b bg-primary/5 px-3 py-1 text-[11px] text-foreground" role="status">
                  New box: arrow keys move it (Shift: 10 pt), Alt with an arrow changes its size, Enter adds it, Escape drops it.
                </p>
              )}
              {drawMode && !pending && (
                <p className="border-b bg-primary/5 px-3 py-1 text-[11px] text-foreground" role="status">
                  Drag on the page to draw a box. A box removes what is under it, and only that.
                </p>
              )}
              {found?.pagesWithoutText.includes(page) && !pending && !drawMode && (
                <p className="border-b bg-warning/10 px-3 py-1 text-[11px] text-foreground" role="status" data-testid="pdf-tools-redact-page-no-text">
                  {PAGE_WITHOUT_TEXT}
                </p>
              )}
              <RedactPageSurface model={viewer} state={state} dispatch={dispatch} drawMode={drawMode} pending={pending} setPending={setPending} disabled={busy} onChoose={(id) => dispatch({ type: 'select', id })} />
            </section>

            {/* The review */}
            <aside aria-label="Review" className="flex w-[380px] shrink-0 flex-col lg:w-[420px]">
              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
                {signed && (
                  <Notice tone="warning" icon={FileSignature} title="Digital signature" testId="pdf-tools-signed-warning">
                    {signedWarningText(files)}
                  </Notice>
                )}
                {finding && (
                  <div className="space-y-1.5 rounded-md border px-3 py-2.5" role="status" data-testid="pdf-tools-redact-finding">
                    <p className="flex items-center gap-2 text-xs font-medium text-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" aria-hidden="true" />
                      {findLabel}
                    </p>
                    <Progress value={finding.total > 0 ? Math.round((finding.done / finding.total) * 100) : 0} className="h-1.5" aria-label="Searching" />
                    <Button type="button" size="sm" variant="outline" className="h-7 text-xs" data-testid="pdf-tools-redact-find-stop" onClick={() => findStop.current?.abort()}>
                      Stop searching
                    </Button>
                  </div>
                )}
                {!finding && !found && (
                  <Notice tone={findError ? 'error' : 'neutral'} icon={AlertCircle} role={findError ? 'alert' : 'status'} title={findError ?? 'Searching was stopped. Nothing has been found yet.'} testId="pdf-tools-redact-find-error">
                    <Button type="button" size="sm" variant="outline" className="mt-1.5 h-7 text-xs" onClick={() => setFindAgain((n) => n + 1)}>
                      Search again
                    </Button>
                  </Notice>
                )}
                {found && step === 'review' && (
                  <>
                    {researching && (
                      <p className="flex items-center gap-1.5 text-xs text-muted-foreground" role="status">
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" aria-hidden="true" />
                        Searching for your words…
                      </p>
                    )}
                    {noText && (
                      <Notice tone="info" title={noText.title} testId="pdf-tools-redact-no-text">
                        {noText.body}
                      </Notice>
                    )}
                    {/* A file without any text: nothing can be found or typed; only drawn boxes work. */}
                    {found.pagesWithoutText.length < pageCount && <FindControls state={state} dispatch={dispatch} onProfile={onProfile} disabled={busy} runs={runs} notFound={notFound} />}
                    <RedactList
                      state={state}
                      dispatch={dispatch}
                      rows={rows}
                      held={held}
                      heldRows={(kind: RedactKind, from, count) => heldRows(state, kind, from, count)}
                      onPromote={onPromote}
                      onTickValue={onTickValue}
                      onShow={show}
                      boxTokens={boxTokens}
                      onBoxEverywhere={onBoxEverywhere}
                      currentPage={page}
                      disabled={busy}
                    />
                    <div className="border-t pt-3">
                      <OutputControls choices={choices} onChange={setChoices} token={tokenHolder} onToken={onToken} disabled={busy} estimate={facts?.estimate ?? 0} runs={runs} />
                    </div>
                  </>
                )}
                {found && step === 'confirm' && facts && (
                  <div className="space-y-3" data-testid="pdf-tools-redact-confirm">
                    <p className="text-sm font-medium text-foreground">Check before redacting</p>
                    <p className="text-sm text-foreground">{confirmSentence(facts)}</p>
                    <p className="text-xs text-muted-foreground">
                      {choices.mode === 'remove' ? 'Black boxes' : 'Black boxes with a replacement'}; the pages become {choices.output === 'searchable' ? 'pictures with the remaining words searchable' : 'pictures only'}, at {choices.dpi} dpi. The new
                      file is {facts.alsoUnknown ? 'at least about' : 'about'} {formatBytes(facts.estimate + Math.round((file.size * facts.pagesUnchanged) / Math.max(1, pageCount)))}. The original stays in the list, unchanged.
                    </p>
                    {resultName === REDACTED_NAME && (
                      <Notice tone="neutral" title={`The new file will be named "${REDACTED_NAME}"`} testId="pdf-tools-redact-neutral-name">
                        The file&apos;s own name holds a value you chose to redact, so the copy is not named after it.
                      </Notice>
                    )}
                    {summary.leftVisible.length > 0 && (
                      <Notice tone="warning" title="Some chosen values stay visible" testId="pdf-tools-redact-left-visible">
                        <ul className="space-y-0.5">
                          {summary.leftVisible.slice(0, 20).map((v, i) => (
                            <li key={i}>
                              <span className="font-mono text-foreground">{state.proposals.find((p) => p.kind === v.kind && p.key === v.key)?.value ?? ''}</span> stays visible in{' '}
                              {v.pages.length === 1 ? '1 place' : `${v.pages.length} places`} you unticked ({pagesInWords(v.pages)}). The redacted file will still contain it there.
                            </li>
                          ))}
                          {summary.leftVisible.length > 20 && <li>And {summary.leftVisible.length - 20} more values.</li>}
                        </ul>
                      </Notice>
                    )}
                    {found.autoBoxesDropped > 0 && (
                      <Notice tone="neutral" title={`${found.autoBoxesDropped} automatic ${found.autoBoxesDropped === 1 ? 'box' : 'boxes'} covered almost the whole page and ${found.autoBoxesDropped === 1 ? 'was' : 'were'} left out.`}>
                        Draw a box if you mean it.
                      </Notice>
                    )}
                    {facts.pagesWithoutText.length > 0 && (
                      <Notice tone="info" title={`${pagesInWords(facts.pagesWithoutText).replace(/^p/, 'P')} ${facts.pagesWithoutText.length === 1 ? 'has' : 'have'} no text`}>
                        Only the boxes you drew remove anything there; text drawn as pictures is not searched.
                      </Notice>
                    )}
                    {omitNote && (
                      <Notice tone="neutral" title="Some text cannot be made searchable">
                        {omitNote}
                      </Notice>
                    )}
                    {notFound.length > 0 && <Notice tone="warning" title={notFoundLine(notFound.length)} testId="pdf-tools-redact-confirm-not-found" />}
                    {coveredText && <Notice tone="neutral" title={coveredText} testId="pdf-tools-redact-text-covered" />}
                  </div>
                )}
              </div>

              {ask && (
                <div className="space-y-2 border-t bg-warning/10 px-3 py-3" role="alertdialog" aria-labelledby="pdf-tools-redact-flatten-title" data-testid="pdf-tools-redact-flatten">
                  <p id="pdf-tools-redact-flatten-title" className="text-sm font-medium text-foreground">
                    {flattenQuestion(ask.pages, ask.mayShow).title}
                  </p>
                  <p className="text-xs text-foreground" data-testid="pdf-tools-redact-flatten-body">
                    {flattenQuestion(ask.pages, ask.mayShow).body}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {ask.pages.slice(0, 8).map((p) => (
                      <Button key={p} type="button" size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => viewer.goTo(p + 1)}>
                        Show page {p + 1}
                      </Button>
                    ))}
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button type="button" size="sm" variant="outline" data-testid="pdf-tools-redact-flatten-no" onClick={() => ask.answer(false)}>
                      Do not flatten
                    </Button>
                    <Button type="button" size="sm" data-testid="pdf-tools-redact-flatten-yes" onClick={() => ask.answer(true)}>
                      Flatten {ask.pages.length === 1 ? 'this page' : 'these pages'}
                    </Button>
                  </div>
                </div>
              )}

              {!busy && (run.error || run.notice) && (
                <div className="border-t px-3 py-2">
                  {run.error ? (
                    <Notice tone="error" icon={AlertCircle} role="alert" testId="pdf-tools-dialog-error" title={run.error} />
                  ) : (
                    <Notice tone="neutral" role="status" testId="pdf-tools-dialog-notice" title={run.notice!.title}>
                      {run.notice!.detail}
                    </Notice>
                  )}
                </div>
              )}
              {!busy && problem && found && step === 'review' && (state.proposals.length > 0 || state.drawn.length > 0) && (
                <p className="border-t px-3 py-1.5 text-xs text-muted-foreground" data-testid="pdf-tools-redact-blocked">
                  {problem}
                </p>
              )}
              {/* What Redact cannot see (end-to-end review, "Limits"): one plain sentence above the button, the rest folded. */}
              {!busy && found && (
                <Collapsible className="border-t px-3 py-1.5" data-testid="pdf-tools-redact-limits">
                  <p className="flex items-start gap-1.5 text-[11px] leading-snug text-muted-foreground">
                    <Info className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span>
                      {REDACT_LIMITS.short}{' '}
                      <CollapsibleTrigger
                        data-testid="pdf-tools-redact-limits-more"
                        className="rounded-sm font-medium text-foreground underline underline-offset-2 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        What it cannot see
                      </CollapsibleTrigger>
                    </span>
                  </p>
                  <CollapsibleContent>
                    <p className="pl-5 pt-1 text-[11px] leading-snug text-muted-foreground">{REDACT_LIMITS.more}</p>
                  </CollapsibleContent>
                </Collapsible>
              )}

              <footer className="flex items-center gap-2 border-t bg-muted/30 px-3 py-2.5">
                {busy ? (
                  <div className="flex w-full items-center gap-3" data-testid="pdf-tools-progress" data-phase={run.phase}>
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="flex items-center gap-1.5 truncate text-xs font-medium text-foreground">
                        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" aria-hidden="true" />
                        {run.progress?.label ?? 'Working…'}
                      </p>
                      <Progress value={measured ? runPercent : 0} className={cn('h-1.5', !measured && 'opacity-50')} aria-label="Redact progress" />
                    </div>
                    <Button
                      ref={stopButton}
                      type="button"
                      variant="outline"
                      data-testid="pdf-tools-cancel-run"
                      aria-disabled={run.phase === 'stopping' ? true : undefined}
                      onKeyDown={ignoreRepeat}
                      onClick={() => run.phase === 'running' && askToStop()}
                    >
                      {run.phase === 'stopping' ? 'Stopping…' : 'Stop'}
                    </Button>
                  </div>
                ) : step === 'confirm' ? (
                  <>
                    <Button type="button" variant="outline" className="ml-auto" data-testid="pdf-tools-redact-confirm-back" onClick={() => setStep('review')}>
                      Back
                    </Button>
                    <Button type="button" data-testid="pdf-tools-redact-confirm-redact" disabled={Boolean(problem)} onKeyDown={ignoreRepeat} onClick={() => {
                      setStep('review');
                      start();
                    }}>
                      <EyeOff />
                      Redact
                    </Button>
                  </>
                ) : (
                  <>
                    <Button type="button" variant="outline" className="ml-auto" data-testid="pdf-tools-dialog-cancel" onClick={onClose}>
                      Cancel
                    </Button>
                    <Button ref={runButton} type="button" data-testid="pdf-tools-run" disabled={!found || Boolean(problem)} onClick={() => setStep('confirm')}>
                      <EyeOff />
                      {runLabel}
                    </Button>
                  </>
                )}
              </footer>
            </aside>
          </div>
        </DialogPrimitive.Content>
      </DialogPortal>

      <AlertDialog open={confirmStop} onOpenChange={setConfirmStop}>
        <AlertDialogContent
          data-testid="pdf-tools-stop-confirm"
          onCloseAutoFocus={(event) => {
            // No trigger for Radix to return to: back to the control that asked, else Stop, else Redact (the run
            // ended while this was closing), else the dialog itself, so the focus stays in the dialog.
            event.preventDefault();
            const back = stopOpener.current;
            stopOpener.current = null;
            for (const target of [back, stopButton.current, runButton.current, contentRef.current]) {
              if (!target || !contentRef.current?.contains(target) || (target instanceof HTMLButtonElement && target.disabled)) continue;
              target.focus();
              if (document.activeElement === target) return;
            }
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>{stopTitle('redact')}</AlertDialogTitle>
            <AlertDialogDescription>{stopQuestion('redact')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onKeyDown={ignoreRepeat}>Keep running</AlertDialogCancel>
            <AlertDialogAction data-testid="pdf-tools-stop-confirm-yes" onKeyDown={ignoreRepeat} onClick={() => run.stop(false)}>
              Stop
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DialogPrimitive.Root>
  );
}
