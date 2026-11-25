// The Form No. 26 workspace, in the present Tax Audit layout (ruling R4): the header with the form's
// badges, "Next unfilled" and, beside the title, the page's views ("Clauses · What changed"), then the clause
// list on the left, the clause editor in the centre (review
// bar, the clause in the form's own words, review remarks and qualification) and "Sources, Evidence and
// Review" on the right, on the same grid as the 3CD clause workspace. Every state has its own screen.
// An audit brought across from a Form 3CD draft (task 26) has the notice at the top until dismissed, the
// earlier draft read only ("View the earlier 3CD draft"), and its answer beside each clause it ties to (the
// pane's "3CD draft" tab); an engagement whose year moved on offers "Update" under item 8.
// Task 19's chooser mounts it (lazily) with the page's shared parts:
//   <Form26Workspace parts={{ EvidenceRail }} />
import * as React from 'react';
import { toast } from 'sonner';

import { Form26ClauseEditor } from '@/components/tax-audit/form26/Form26ClauseEditor';
import { Form26ClauseFooter } from '@/components/tax-audit/form26/Form26ClauseFooter';
import { Form26ClauseList } from '@/components/tax-audit/form26/Form26ClauseList';
import { Form26ConversionNotice } from '@/components/tax-audit/form26/Form26ConversionNotice';
import { Form26Header } from '@/components/tax-audit/form26/Form26Header';
import { Form26LastYear } from '@/components/tax-audit/form26/Form26LastYear';
import { Form26ReviewBar } from '@/components/tax-audit/form26/Form26ReviewBar';
import { Form26ReviewSummary } from '@/components/tax-audit/form26/Form26ReviewSummary';
import {
  FORM26_COMPACT_TAB,
  FORM26_COMPACT_TABS,
  Form26RightPane,
  type Form26PaneTab,
  type Form26SharedParts,
} from '@/components/tax-audit/form26/Form26RightPane';
import { Form26WhatChanged } from '@/components/tax-audit/form26/Form26WhatChanged';
import { ThreeCdDraftDialog } from '@/components/tax-audit/form26/ThreeCdDraftReadOnly';
import {
  Form26ConflictBanner,
  Form26ConversionState,
  Form26ErrorState,
  Form26LoadingState,
  Form26NoAccessState,
  Form26NoEngagementState,
  FORM26_PANES_FOLDED,
  FORM26_PANES_GRID,
  FORM26_PANES_OPEN,
} from '@/components/tax-audit/form26/Form26States';
import { FORM26_WORKSPACE_COLUMN } from '@/components/tax-audit/form26/Form26Loading';
import { useForm26Keyboard } from '@/components/tax-audit/form26/useForm26Keyboard';
import { useForm26LastYear } from '@/components/tax-audit/form26/useForm26LastYear';
import { useForm26ThreeCdDraft } from '@/components/tax-audit/form26/useForm26ThreeCdDraft';
import { useTaxAuditForm26, type UseTaxAuditForm26Result } from '@/components/tax-audit/form26/useTaxAuditForm26';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/contexts/AuthContext';
import { registerEngagementLeaveGuard, useEngagement } from '@/contexts/EngagementContext';
import { FORM26_CLAUSE_UNITS } from '@/data/taxAuditForm26Clauses';
import { comparisonOnByDefault, form26ComparisonStorageKey, readComparisonSetting, writeComparisonSetting } from '@/lib/taxAuditForm26Compare';
import {
  besideClauses,
  conversionNoticeText,
  form26ConversionNoticeKey,
  form26TaxYearUpdate,
  FORM26_THREE_CD_DRAFT_TEXT,
  isThreeCdUntouched,
  readNoticeDismissed,
  threeCdDraftView,
  writeNoticeDismissed,
  type ThreeCdSnapshot,
} from '@/lib/taxAuditForm26Conversion';
import { buildEditorModel, editorTitle, FORM26_REVIEW_LABEL, form26SaveStatus, form26ScheduleDomId } from '@/lib/taxAuditForm26EditorModel';
import { rowLimitText } from '@/lib/taxAuditForm26Layout';
import { buildListModel, type Form26ListEntry, type Form26ListFilter } from '@/lib/taxAuditForm26ListModel';
import { canApproveForm26, isRowLocked, isTableLocked, observationRows, qualificationRow } from '@/lib/taxAuditForm26Review';
import type { Form26LastYearResult } from '@/lib/taxAuditForm26Store';
import { lastYearView } from '@/lib/taxAuditForm26ThreeCdText';
import type { Form26UnfilledItem } from '@/lib/taxAuditForm26Unfilled';
import {
  adjacentClause,
  form26CloseDecision,
  form26HeldCloseOutcome,
  form26EditorWidth,
  form26FieldKeyOfElement,
  form26HeaderModel,
  form26LeaveGuardText,
  form26SaveStateLocked,
  form26TableConflictLine,
  form26Tabs,
  form26UnfilledStep,
  FORM26_CLOSE_WARNING,
  listedClauseKeys,
  type Form26KeyCommand,
  type Form26TabId,
} from '@/lib/taxAuditForm26Workspace';
import { cn } from '@/lib/utils';
import type { TaxAuditReviewStatus } from '@/types/taxAudit';

export type { Form26SharedParts } from '@/components/tax-audit/form26/Form26RightPane';
export type Form26WorkspaceProps = { parts: Form26SharedParts };

/**
 * What a tab of the workspace other than "Clauses" is given (Review Summary, task 24; What changed, task 25):
 * the audit, a way to open a clause in "Clauses", and the engagement's client name and year (for the pack).
 */
export type Form26TabPanelProps = {
  form26: UseTaxAuditForm26Result;
  openClause(clauseKey: string): void;
  clientName?: string;
  financialYear?: string;
  /** Given when the engagement holds an earlier Form 3CD draft (task 26): opens it, read only. */
  onViewThreeCdDraft?(): void;
};
// The tabs beside "Clauses". Each is added by the task that builds its content; the tabs appear with the first.
const TAB_PANELS: Partial<Record<Exclude<Form26TabId, 'clauses'>, React.ComponentType<Form26TabPanelProps>>> = {
  'what-changed': Form26WhatChanged,
  summary: Form26ReviewSummary,
};

// The page's own storage for a per-viewer convenience (the switch "Show Form 3CD notes"); none when blocked.
const viewerStorage = () => {
  try {
    return typeof window !== 'undefined' ? window.localStorage ?? null : null;
  } catch {
    return null;
  }
};

const NO_TABLES: ReadonlySet<string> = new Set();
const FIRST_CLAUSE = FORM26_CLAUSE_UNITS[0].key;
const UNIT_BY_KEY = new Map(FORM26_CLAUSE_UNITS.map((unit) => [unit.key, unit]));
const clock = (ms: number) => {
  const date = new Date(ms);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
};
const prefersReducedMotion = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const NOT_MOVED = 'Your last change is not saved yet. Try again, or choose which entry to keep, before moving on.';

export default function Form26Workspace({ parts }: Form26WorkspaceProps): JSX.Element {
  const { currentEngagement } = useEngagement();
  const { role, user } = useAuth();
  const form26 = useTaxAuditForm26(
    currentEngagement ? { id: currentEngagement.id, client_id: currentEngagement.client_id, financial_year: currentEngagement.financial_year } : null,
  );
  if (!currentEngagement || form26.status === 'no-engagement') return <Form26NoEngagementState />;
  if (form26.status === 'loading') return <Form26LoadingState />;
  if (form26.status === 'no-access') return <Form26NoAccessState />;
  if (form26.status === 'needs-conversion') return <Form26ConversionState onRetry={form26.retry} />;
  if (form26.status === 'error') return <Form26ErrorState message={form26.errorMessage} onRetry={form26.retry} />;
  return (
    <Form26WorkspaceBody
      key={currentEngagement.id}
      parts={parts}
      form26={form26}
      canApprove={canApproveForm26(role)}
      clientName={currentEngagement.client_name}
      financialYear={currentEngagement.financial_year}
      clientId={currentEngagement.client_id ?? null}
      userId={user?.id ?? null}
    />
  );
}

/** The workspace once the audit is open (drawn by the static-render test with a session's state). */
export function Form26WorkspaceBody(props: {
  parts: Form26SharedParts;
  form26: UseTaxAuditForm26Result;
  canApprove: boolean;
  clientName: string;
  financialYear: string;
  /** The clause open at first (the form's first entry, the category, unless given). */
  initialClauseKey?: string;
  /** The engagement's client (last year is read for the same client) and the signed-in user (the switch is theirs). */
  clientId?: string | null;
  userId?: string | null;
  /** Last year as read already (the static-render test); without it the workspace reads it when the tab opens. */
  lastYear?: Form26LastYearResult | null;
  initialPaneTab?: Form26PaneTab;
  /** The earlier Form 3CD draft as read already (the static-render test); without it the workspace reads it. */
  threeCdDraft?: ThreeCdSnapshot | null;
}): JSX.Element {
  const { parts, form26, canApprove, clientName, financialYear } = props;
  const firstKey = props.initialClauseKey && UNIT_BY_KEY.has(props.initialClauseKey) ? props.initialClauseKey : FIRST_CLAUSE;
  const { def, values, setup, rowsByKey, evidence } = form26;

  const [selectedKey, setSelectedKey] = React.useState(firstKey);
  const [selectedEntryId, setSelectedEntryId] = React.useState(firstKey);
  const [filter, setFilter] = React.useState<Form26ListFilter>('all');
  const [search, setSearch] = React.useState('');
  const [highlight, setHighlight] = React.useState(true);
  const [paneOpen, setPaneOpen] = React.useState(true);
  const [tab, setTab] = React.useState<Form26TabId>('clauses');
  const [focusTarget, setFocusTarget] = React.useState<{ field?: string; table?: string; row?: number; column?: string } | null>(null);
  const [scrollToSchedule, setScrollToSchedule] = React.useState<{ id: string } | null>(null);
  const [headerMessage, setHeaderMessage] = React.useState<string | null>(null);
  const [live, setLive] = React.useState('');
  const [editorWidth, setEditorWidth] = React.useState(600);
  const [closeWarning, setCloseWarning] = React.useState(false);

  const rootRef = React.useRef<HTMLDivElement>(null);
  const editorRef = React.useRef<HTMLDivElement>(null);
  const searchRef = React.useRef<HTMLInputElement>(null);
  const lastVisited = React.useRef<Form26UnfilledItem | null>(null);
  const latest = React.useRef(form26);
  latest.current = form26;

  const announce = React.useCallback((message: string) => {
    setLive('');
    requestAnimationFrame(() => setLive(message));
  }, []);

  const view = React.useMemo(() => ({ showAllSchedules: setup.showAllSchedules }), [setup.showAllSchedules]);
  const listModel = React.useMemo(
    () => buildListModel({ def, values, view, rowsByKey, evidence, unconfirmed: form26.unconfirmed, filter, search }),
    [def, values, view, rowsByKey, evidence, form26.unconfirmed, filter, search],
  );
  const unit = UNIT_BY_KEY.get(selectedKey) ?? FORM26_CLAUSE_UNITS[0];
  const row = rowsByKey.get(unit.key);

  // ---- the comparison with Form 3CD (task 25): on at first for 2026-27 only; the user's own switch,
  // remembered on this computer for this engagement (the application has no per-user preference store).
  const engagementId = form26.audit?.engagement_id ?? '';
  const comparisonKey = form26ComparisonStorageKey(props.userId, engagementId);
  const [comparison, setComparison] = React.useState(() => readComparisonSetting(viewerStorage(), comparisonKey, financialYear));
  const [paneTab, setPaneTab] = React.useState<Form26PaneTab>(props.initialPaneTab ?? 'evidence');

  // ---- the earlier Form 3CD draft (task 26): the one this audit was brought from, or any the engagement holds.
  const conversion = setup.conversion;
  const draftRead = useForm26ThreeCdDraft(engagementId ? { engagementId, fromTaxAuditId: conversion?.fromTaxAuditId ?? null } : null, props.threeCdDraft);
  const draft = draftRead.snapshot;
  const draftHasAnswers = draft !== null && !isThreeCdUntouched(draft);
  const beside = React.useMemo(() => (draft && draftHasAnswers ? besideClauses(draft) : []), [draft, draftHasAnswers]);
  const [draftOpen, setDraftOpen] = React.useState(false);
  const noticeKey = form26ConversionNoticeKey(props.userId, engagementId);
  const [noticeDismissed, setNoticeDismissed] = React.useState(() => readNoticeDismissed(viewerStorage(), noticeKey));
  const showNotice = Boolean(conversion && !conversion.untouched && draftHasAnswers && !noticeDismissed);

  const shownPaneTab: Form26PaneTab =
    (paneTab === 'last-year' && !comparison) || (paneTab === 'three-cd-draft' && !draftHasAnswers) ? 'evidence' : paneTab;
  const lastYearRead = useForm26LastYear(
    engagementId ? { engagementId, clientId: props.clientId ?? form26.audit?.client_id ?? null, financialYear } : null,
    comparison && shownPaneTab === 'last-year' && props.lastYear === undefined,
  );
  const lastYear = props.lastYear !== undefined ? props.lastYear : lastYearRead.result;
  const lastYearShown = React.useMemo(() => lastYearView(unit.key, lastYear, def), [unit.key, lastYear, def]);

  const blocks = React.useMemo(() => buildEditorModel(def, unit.key, values, view, { comparison }), [def, unit.key, values, view, comparison]);

  // ---- moving: every move first saves what waits; a save that cannot finish keeps the user where he is.
  const select = React.useCallback(
    async (clauseKey: string, options: { entryId?: string; scheduleId?: string | null; focus?: typeof focusTarget } = {}) => {
      if (clauseKey !== selectedKey && !(await latest.current.flush())) {
        toast.warning(NOT_MOVED);
        announce(NOT_MOVED);
        return false;
      }
      setHeaderMessage(null);
      setSelectedKey(clauseKey);
      setSelectedEntryId(options.entryId ?? options.scheduleId ?? clauseKey);
      setFocusTarget(options.focus ? { ...options.focus } : null);
      setScrollToSchedule(!options.focus && options.scheduleId ? { id: options.scheduleId } : null);
      return true;
    },
    [selectedKey, announce],
  );

  const goUnfilled = React.useCallback(
    async (direction: 1 | -1) => {
      // The answer being typed is committed first, so it no longer counts.
      const active = document.activeElement;
      if (active instanceof HTMLElement && editorRef.current?.contains(active)) active.blur();
      const step = form26UnfilledStep(def, latest.current.unfilledNow(), lastVisited.current, direction);
      if (!step) {
        setHeaderMessage('Nothing left to fill.');
        announce('Nothing left to fill.');
        return;
      }
      lastVisited.current = step.item;
      await select(step.target.clauseKey, { scheduleId: step.target.scheduleId ?? null, focus: step.target.focus });
    },
    [def, select, announce],
  );

  const goClause = React.useCallback(
    async (direction: 1 | -1) => {
      const next = adjacentClause(listedClauseKeys(listModel), selectedKey, direction);
      if (!next) return;
      if (await select(next)) requestAnimationFrame(() => rootRef.current?.querySelector<HTMLElement>(`[data-entry-id="${next}"]`)?.focus());
    },
    [listModel, selectedKey, select],
  );

  const onCommand = React.useCallback(
    (command: Form26KeyCommand) => {
      if (command === 'next-unfilled') void goUnfilled(1);
      else if (command === 'previous-unfilled') void goUnfilled(-1);
      else if (command === 'next-clause') void goClause(1);
      else if (command === 'previous-clause') void goClause(-1);
      else if (command === 'focus-search') searchRef.current?.focus();
    },
    [goUnfilled, goClause],
  );
  useForm26Keyboard(onCommand, tab === 'clauses');

  // ---- the editor's room: its scrolling body, measured as it changes (the pane opening, the window).
  React.useLayoutEffect(() => {
    const body = editorRef.current?.querySelector<HTMLElement>('[data-f26-editor-body]');
    if (!body) return undefined;
    const measure = () => setEditorWidth(form26EditorWidth(body.clientWidth));
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(body);
    return () => observer.disconnect();
  }, [unit.key, paneOpen, tab]);

  // A schedule chosen in the list: brought into view under its clause, and the keyboard put there.
  React.useEffect(() => {
    if (!scrollToSchedule) return;
    const element = document.getElementById(form26ScheduleDomId(scrollToSchedule.id));
    element?.scrollIntoView({ block: 'start', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    element?.focus({ preventScroll: true });
  }, [scrollToSchedule, unit.key]);

  // "Nothing left to fill." stays only while it is true.
  React.useEffect(() => {
    if (form26.counts.total > 0) setHeaderMessage((message) => (message === 'Nothing left to fill.' ? null : message));
  }, [form26.counts.total]);

  // Failures and clashes are said aloud once (the header shows them all along). A clash whose clause was approved
  // meanwhile (an approval that landed while the user typed) has its own sentence: there is no entry to choose.
  const saveKind = form26.saveState.kind;
  const saveLocked = form26SaveStateLocked(def, form26.saveState, rowsByKey);
  const saveAnnouncement =
    saveKind === 'failed' || saveKind === 'changed-elsewhere' ? form26SaveStatus(form26.saveState, clock, { locked: saveLocked }).text : '';
  React.useEffect(() => {
    if (saveAnnouncement) announce(saveAnnouncement);
  }, [saveAnnouncement, announce]);

  // ---- leaving: the engagement (asks only when changes could not be saved) and the window (F6).
  React.useEffect(() => registerEngagementLeaveGuard(() => form26LeaveGuardText(latest.current.hasUnresolved())), []);
  const closeAllowed = React.useRef(false);
  const closeWarned = React.useRef(false);
  const closeHolding = React.useRef(false);
  React.useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      // The answer being typed is committed (with what the user saw at focus) before anything is judged.
      const active = document.activeElement;
      if (active instanceof HTMLElement && rootRef.current?.contains(active)) active.blur();
      const form = latest.current;
      const decision = form26CloseDecision({
        allowed: closeAllowed.current,
        pending: form.hasPending(),
        unresolved: form.hasUnresolved(),
        warned: closeWarned.current,
        holding: closeHolding.current,
      });
      if (decision === 'allow') return;
      event.preventDefault();
      event.returnValue = 'Form No. 26 has changes that are not saved yet.';
      if (decision === 'warn') {
        closeWarned.current = true;
        setCloseWarning(true);
        return;
      }
      if (decision === 'wait') return;
      // The close (or a reload: the two cannot be told apart) is held for the save. The window is not closed
      // from here afterwards; the user is told that everything is saved and closes it again.
      closeHolding.current = true;
      void form.flush().then((saved) => {
        closeHolding.current = false;
        const outcome = form26HeldCloseOutcome(saved);
        if (outcome.kind === 'warn') {
          closeWarned.current = true;
          setCloseWarning(true);
          return;
        }
        toast.success(outcome.message);
        announce(outcome.message);
      });
    };
    const onPageHide = () => {
      void latest.current.flush();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [announce]);

  // ---- what the user saw when a box took focus (F3).
  const onEditorFocus = (event: React.FocusEvent<HTMLDivElement>) => {
    const key = form26FieldKeyOfElement(event.target);
    if (key) form26.fieldFocused(key);
  };
  const onEditorBlur = (event: React.FocusEvent<HTMLDivElement>) => {
    const key = form26FieldKeyOfElement(event.target);
    if (key && form26FieldKeyOfElement(event.relatedTarget as HTMLElement | null) !== key) form26.fieldBlurred(key);
  };

  const onSelectEntry = (entry: Form26ListEntry) => {
    void select(entry.clauseKey, { entryId: entry.id, scheduleId: entry.scheduleId ?? null });
  };

  const onTabChange = async (next: string) => {
    if (next === tab) return;
    if (!(await form26.flush())) {
      toast.warning(NOT_MOVED);
      return;
    }
    setTab(next as Form26TabId);
  };

  const setComparisonShown = (on: boolean) => {
    setComparison(on);
    writeComparisonSetting(viewerStorage(), comparisonKey, on);
    if (!on) setPaneTab((current) => (current === 'last-year' ? 'evidence' : current));
    announce(on ? 'Form 3CD notes are shown.' : 'Form 3CD notes are hidden.');
  };

  // "Last year" on a clause's line: the pane opens on its "Last year" tab and the keyboard goes to that tab.
  const openLastYear = () => {
    setPaneOpen(true);
    setPaneTab('last-year');
    requestAnimationFrame(() => rootRef.current?.querySelector<HTMLElement>('[data-f26-pane-tab="last-year"]')?.focus());
  };

  // "See it" beside a clause the earlier Form 3CD draft has an answer for: the pane's "3CD draft" tab.
  const openThreeCdDraftTab = () => {
    setPaneOpen(true);
    setPaneTab('three-cd-draft');
    requestAnimationFrame(() => rootRef.current?.querySelector<HTMLElement>('[data-f26-pane-tab="three-cd-draft"]')?.focus());
  };
  const dismissNotice = () => {
    writeNoticeDismissed(viewerStorage(), noticeKey);
    setNoticeDismissed(true);
    announce('The notice is dismissed. The earlier Form 3CD draft can still be seen from the Review Summary.');
  };

  const openClause = (clauseKey: string) => {
    void select(clauseKey).then((moved) => {
      if (moved) setTab('clauses');
    });
  };

  const setStatus = async (status: TaxAuditReviewStatus, options?: { unlockReason?: string }) => {
    const done = await form26.setStatus(unit.key, status, options);
    if (done) {
      const title = editorTitle(unit);
      announce(`${title.prefix ?? title.label}: ${FORM26_REVIEW_LABEL[options?.unlockReason ? 'reviewed' : status]}.`);
    }
    return done;
  };

  // The observations table of the report's Part for the chosen category, and whether that Part is approved.
  const category = setup.category;
  const observationTable = category === '1' ? 'A5' : category === '2' ? 'B5' : null;
  const partRow = category === '1' ? rowsByKey.get('f26_part_a') : category === '2' ? rowsByKey.get('f26_part_b') : undefined;
  const addObservation = (table: 'A5' | 'B5', plainText: string) => {
    const tableDef = def.tables.find((entry) => entry.id === table);
    const target = qualificationRow(unit.no, plainText, category);
    if (!tableDef || !target) return;
    const next = observationRows(tableDef, values.t[table] ?? [], target.row);
    if (!next) {
      toast.error(rowLimitText());
      return;
    }
    form26.setTable(table, next);
    form26.tableLeft(table);
    const message = `Clause ${unit.no} was added to the report's observations (${table === 'A5' ? 'Part A' : 'Part B'}).`;
    toast.success(message);
    announce(message);
  };

  const conflictLines = Object.entries(form26.tableConflicts).map(([tableId, conflict]) => ({
    id: tableId,
    ...form26TableConflictLine(def, tableId, conflict, isTableLocked(def, tableId, rowsByKey)),
  }));

  const header = form26HeaderModel({
    clientName,
    financialYear,
    category,
    saveState: form26.saveState,
    clock,
    unfilled: form26.counts.total,
    message: headerMessage,
    saveLocked,
  });
  const tabs = form26Tabs({ whatChanged: Boolean(TAB_PANELS['what-changed']), reviewSummary: Boolean(TAB_PANELS.summary) });

  // Item 8 after the engagement's year moved on within Form No. 26 years (2026-27 -> 2027-28): "Update".
  const yearUpdate = form26TaxYearUpdate(values, financialYear);
  const yearRow = rowsByKey.get('f26_p8');
  const yearNote =
    yearUpdate && !(yearRow && isRowLocked(yearRow))
      ? {
          'C.ty': (
            <p className="mt-1 flex flex-wrap items-baseline gap-x-2 text-xs leading-5 text-subtle" data-f26-year-update="">
              <span>{yearUpdate.text}</span>
              <Button type="button" variant="link" className="h-4 p-0 text-xs" onClick={() => form26.setField('C.ty', yearUpdate.year)} data-f26-year-update-button="">
                {yearUpdate.action}
              </Button>
            </p>
          ),
        }
      : undefined;

  // From 1280 px the clause view takes the height the header leaves; each pane scrolls inside itself.
  const clauses = (
    <div className="flex min-h-0 flex-col gap-3 xl:flex-1">
      <Form26ConflictBanner lines={conflictLines} onResolve={(tableId, keep) => void form26.resolveTableConflict(tableId, keep)} />
      <div className={cn(FORM26_PANES_GRID, paneOpen ? FORM26_PANES_OPEN : FORM26_PANES_FOLDED)} data-f26-panes="">
        <Form26ClauseList
          model={listModel}
          selectedId={selectedEntryId}
          filter={filter}
          onFilter={setFilter}
          search={search}
          onSearch={setSearch}
          highlightUnfilled={highlight}
          onHighlightUnfilled={setHighlight}
          showAllSchedules={setup.showAllSchedules}
          onShowAllSchedules={(on) => void form26.setShowAllSchedules(on)}
          onSelect={onSelectEntry}
          searchRef={searchRef}
          showComparison={comparison}
          onShowComparison={setComparisonShown}
          comparisonUsual={comparisonOnByDefault(financialYear)}
        />
        {row ? (
          <>
            <div ref={editorRef} className="min-h-0" onFocus={onEditorFocus} onBlur={onEditorBlur}>
              <Form26ClauseEditor
                key={unit.key}
                def={def}
                unit={unit}
                blocks={blocks}
                values={values}
                row={row}
                lockedTables={NO_TABLES}
                unfilled={form26.unfilled}
                highlightUnfilled={highlight}
                availableWidth={editorWidth}
                onField={form26.setField}
                onTable={form26.setTable}
                onTableLeft={form26.tableLeft}
                onStatus={async (status, options) => {
                  await setStatus(status, options);
                }}
                onRowUpdate={async (patch) => {
                  await form26.updateRow(unit.key, patch);
                }}
                onOpenLastYear={openLastYear}
                focusTarget={focusTarget}
                conflicts={form26.fieldConflicts}
                onResolve={(key, keep) => void form26.resolveConflict(key, keep)}
                onConfirm={(key) => void form26.confirmBrought(key)}
                onAnnounce={announce}
                fieldNotes={yearNote}
                bodyNotice={
                  beside.some((entry) => entry.clauseKey === unit.key) ? (
                    <p className="flex flex-wrap items-baseline gap-x-2 text-xs leading-5 text-subtle" data-f26-3cd-answer-line="">
                      <span>{FORM26_THREE_CD_DRAFT_TEXT.hasAnswer}</span>
                      <Button type="button" variant="link" className="h-4 p-0 text-xs" onClick={openThreeCdDraftTab} data-f26-3cd-answer-link="">
                        {FORM26_THREE_CD_DRAFT_TEXT.openTab}
                      </Button>
                    </p>
                  ) : undefined
                }
                reviewBar={<Form26ReviewBar row={row} unfilled={form26.counts.clause[unit.key] ?? 0} onStatus={setStatus} canApprove={canApprove} />}
                footer={
                  <Form26ClauseFooter
                    row={row}
                    unit={unit}
                    category={category}
                    observationRows={observationTable ? values.t[observationTable] : undefined}
                    partLocked={partRow ? isRowLocked(partRow) : false}
                    onUpdate={(patch) => form26.updateRow(unit.key, patch)}
                    onAddObservation={addObservation}
                  />
                }
              />
            </div>
            <div className="min-h-[320px] lg:col-start-2 xl:col-start-auto xl:min-h-0">
              <Form26RightPane
                parts={parts}
                row={row}
                evidence={evidence}
                open={paneOpen}
                onOpenChange={setPaneOpen}
                onLink={(fileId) => form26.linkEvidence(unit.key, fileId)}
                onUnlink={form26.unlinkEvidence}
                tab={shownPaneTab}
                onTabChange={setPaneTab}
                threeCdDraft={
                  draft && draftHasAnswers
                    ? () => {
                        const title = editorTitle(unit);
                        return <Form26LastYear view={threeCdDraftView(unit.key, draft, def)} clauseTitle={title.prefix ? `${title.prefix} · ${title.label}` : title.label} onRetry={draftRead.retry} />;
                      }
                    : undefined
                }
                lastYear={
                  comparison
                    ? () => {
                        // Under the pane's title row (its tab and fold are there): no title row of its own.
                        const title = editorTitle(unit);
                        return <Form26LastYear view={lastYearShown} clauseTitle={title.prefix ? `${title.prefix} · ${title.label}` : title.label} onRetry={lastYearRead.retry} />;
                      }
                    : undefined
                }
              />
            </div>
          </>
        ) : (
          <div className="rounded-md border p-6 text-sm text-subtle">No clause selected.</div>
        )}
      </div>
    </div>
  );

  // "Clauses · What changed": a compact control beside the title, in its line (POLISH-2: no band of its own).
  const views =
    tabs.length > 1 ? (
      <TabsList aria-label="Form No. 26 views" className={FORM26_COMPACT_TABS}>
        {tabs.map((entry) => (
          <TabsTrigger key={entry.id} value={entry.id} className={FORM26_COMPACT_TAB}>
            {entry.label}
          </TabsTrigger>
        ))}
      </TabsList>
    ) : null;

  return (
    // `relative`: the hidden live region and labels stay inside the page's own scrolling area (the window never scrolls).
    // A column as tall as the page's room from 1280 px: the header in the flow, then the panes (never under it).
    // The workspace is the tabs' root, so the header can hold the switch between the views.
    <Tabs ref={rootRef} value={tab} onValueChange={(next) => void onTabChange(next)} className={cn('relative', FORM26_WORKSPACE_COLUMN)} data-f26-workspace="">
      <Form26Header model={header} onNext={() => void goUnfilled(1)} onRetry={() => void form26.flush()} views={views} />
      {showNotice && (
        <Form26ConversionNotice
          text={conversionNoticeText({ waiting: form26.unconfirmed.size, brought: conversion?.carried.length ?? 0, beside: beside.length })}
          onView={() => setDraftOpen(true)}
          onDismiss={dismissNotice}
        />
      )}
      {/* The active view fills the rest (an inactive one keeps Radix's `hidden`: no display class on it). */}
      <TabsContent value="clauses" className="mt-0 min-h-0 xl:flex-1 xl:data-[state=active]:flex xl:data-[state=active]:flex-col">
        {clauses}
      </TabsContent>
      {tabs
        .filter((entry) => entry.id !== 'clauses')
        .map((entry) => {
          const Panel = TAB_PANELS[entry.id as Exclude<Form26TabId, 'clauses'>];
          return (
            <TabsContent key={entry.id} value={entry.id} className="relative mt-0 min-h-0 xl:flex-1 xl:overflow-y-auto">
              {Panel && (
                <Panel form26={form26} openClause={openClause} clientName={clientName} financialYear={financialYear} onViewThreeCdDraft={draft ? () => setDraftOpen(true) : undefined} />
              )}
            </TabsContent>
          );
        })}
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {live}
      </div>
      <ThreeCdDraftDialog open={draftOpen} onOpenChange={setDraftOpen} snapshot={draft} failed={draftRead.state === 'error'} onRetry={draftRead.retry} />
      <AlertDialog open={closeWarning} onOpenChange={setCloseWarning}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{FORM26_CLOSE_WARNING.title}</AlertDialogTitle>
            <AlertDialogDescription>{FORM26_CLOSE_WARNING.text}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              autoFocus
              onClick={() => {
                closeWarned.current = false;
              }}
            >
              {FORM26_CLOSE_WARNING.stay}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                closeAllowed.current = true;
                window.close();
              }}
            >
              {FORM26_CLOSE_WARNING.close}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Tabs>
  );
}
