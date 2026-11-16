import { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { partName, stripExtension } from '@/lib/pdf-tools/fileNames';
import { outlineOverLimits, type OutlineItem } from '@/lib/pdf-tools/outline';
import { defaultResultName } from '@/lib/pdf-tools/resultNames';
import { bookmarkPartName, bookmarkPlan, bookmarkSplitError, rangePartName, uniqueNames, type BookmarkPlan, type PagePart } from '@/lib/pdf-tools/splitPlan';
import type { WorkingFile } from '@/lib/pdf-tools/types';
import type { WorkingListStore } from '@/lib/pdf-tools/workingList';
import { cachedBookmarkSource } from '../bookmarks/bookmarkSource';
import { plural } from '../format';
import PagePanel from '../PagePanel';
import {
  BOOKMARKS_DESCRIPTION,
  BOOKMARKS_LABEL,
  BOOKMARKS_READING,
  BOOKMARKS_UNREADABLE,
  bookmarkNotes,
  plannedFiles,
  PREVIEW_SHOWN,
  previewHeading,
  rangeNotes,
  readRanges,
  SEPARATE_FILES_HINT,
  SEPARATE_FILES_LABEL,
  type PlannedFile,
} from '../splitForm';
import { partCount, rangeError, splitSizeError } from '../toolOptions';
import { carryNotes } from './carryNotes';
import { describedBy, INVALID_INPUT } from './fieldProps';
import { ChoiceCards, Field, Notice, ResultNameField, ToolDialog, type Choice } from './ToolDialog';
import { usePageList } from './usePageList';
import { useResultName, useToolRun, type ToolDialogProps } from './useToolRun';

type Mode = 'range' | 'every' | 'selected' | 'bookmarks';

const PAGE_LIST_HINT = 'Pages in the order you want them, for example 1-5, 8, 10-12. Click pages below to add or remove them. A page typed twice is included twice.';

type BookmarkReading = { status: 'none' } | { status: 'reading' } | { status: 'failed' } | { status: 'ready'; plan: BookmarkPlan; problem: string | null };

const countItems = (items: readonly OutlineItem[]): number => items.reduce((sum, item) => sum + 1 + countItems(item.children), 0);

/**
 * Where a file with bookmarks would be cut at them, read once when the dialog opens (the reading is shared
 * with the bookmark list beside the page panel). The titles are shown only while the list is still the one
 * the dialog was opened in.
 */
function useBookmarkReading(file: WorkingFile, store: WorkingListStore): BookmarkReading {
  const usable = file.hasBookmarks === true && file.kind === 'pdf';
  const [reading, setReading] = useState<BookmarkReading>(usable ? { status: 'reading' } : { status: 'none' });
  useEffect(() => {
    if (!usable) return;
    const { contextKey, session } = store.getState();
    const ending = new AbortController();
    const stillHere = () => {
      const now = store.getState();
      return !ending.signal.aborted && contextKey !== null && now.contextKey === contextKey && now.session === session;
    };
    const unsubscribe = store.subscribe(() => {
      if (!stillHere()) ending.abort();
    });
    cachedBookmarkSource(file.bytes, ending.signal).then(
      (source) => {
        if (!stillHere()) return;
        const plan = bookmarkPlan(source.items, file.pageCount ?? 0);
        setReading({ status: 'ready', plan, problem: bookmarkSplitError({ count: countItems(source.items), overLimits: outlineOverLimits(source.problems) }, plan) });
      },
      () => {
        if (stillHere()) setReading({ status: 'failed' });
      },
    );
    return () => {
      unsubscribe();
      ending.abort();
    };
  }, [usable, file, store]);
  return reading;
}

/** What will be made, as a short plain list: the first few files, and the rest on request. */
function PlannedList({ files }: { files: PlannedFile[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? files : files.slice(0, PREVIEW_SHOWN);
  return (
    <div className="space-y-1.5" data-testid="pdf-tools-split-plan">
      <p id="pdf-tools-split-plan-heading" className="text-sm font-medium leading-none">
        {previewHeading(files.length)}
      </p>
      <ul aria-labelledby="pdf-tools-split-plan-heading" className={cn('divide-y rounded-md border bg-muted/20 text-xs', all && files.length > 12 && 'max-h-60 overflow-y-auto')}>
        {shown.map((file, i) => (
          <li key={`${i}-${file.name}`} data-testid="pdf-tools-split-plan-item" className="flex items-baseline justify-between gap-3 px-3 py-1.5">
            <span className="min-w-0 truncate font-medium text-foreground" title={file.name}>
              {file.name}
            </span>
            <span className="shrink-0 tabular-nums text-muted-foreground">{file.pages}</span>
          </li>
        ))}
      </ul>
      {files.length > PREVIEW_SHOWN && (
        <button
          type="button"
          data-testid="pdf-tools-split-plan-more"
          aria-expanded={all}
          className="rounded-sm text-xs font-medium text-primary underline-offset-2 ring-offset-background hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          onClick={() => setAll((open) => !open)}
        >
          {all ? 'Show fewer' : `Show all ${files.length} files`}
        </button>
      )}
    </div>
  );
}

/** One short sentence per thing to know before running; never a reason not to run. */
function Notes({ notes, tone }: { notes: string[]; tone: 'warning' | 'neutral' }) {
  if (notes.length === 0) return null;
  return (
    <Notice
      tone={tone}
      testId="pdf-tools-split-notes"
      title={notes.map((note) => (
        <span key={note} className="block">
          {note}
        </span>
      ))}
    />
  );
}

export default function SplitDialog(props: ToolDialogProps) {
  const { files, onClose, store } = props;
  const file = files[0];
  const pageCount = file.pageCount ?? 0;
  const run = useToolRun('split', props);
  const [mode, setMode] = useState<Mode>('range');
  const [from, setFrom] = useState('1');
  const [to, setTo] = useState(String(pageCount));
  const [every, setEvery] = useState('1');
  // Chosen pages: one file (as before), or a separate file for each range typed.
  const [separate, setSeparate] = useState(false);
  const selection = usePageList(pageCount, 'as-written');
  const bookmarks = useBookmarkReading(file, store);

  const rangeProblem = rangeError(from, to, pageCount);
  const everyProblem = splitSizeError(every, pageCount);
  const rangeDefault = defaultResultName('split', file.name, rangeProblem ? { from: 1, to: pageCount } : { from: Number(from), to: Number(to) });
  const name = useResultName(mode === 'range' ? rangeDefault : defaultResultName('split', file.name));
  const stem = useResultName(stripExtension(file.name), 'stem');

  const n = Number(every);
  const parts = everyProblem ? 0 : partCount(pageCount, n);

  // Several files, from the ranges typed or from the bookmarks: what will be made, named as the run names them.
  const ranges = useMemo(() => readRanges(selection.text, pageCount), [selection.text, pageCount]);
  const separateFiles = mode === 'selected' && separate;
  const bookmarkReady = bookmarks.status === 'ready' && bookmarks.problem === null ? bookmarks.plan : null;
  const planned = useMemo((): { parts: PagePart[]; names: string[] } | null => {
    if (separateFiles && ranges.parts) return { parts: ranges.parts, names: uniqueNames(ranges.parts.map((part) => rangePartName(stem.resolved, part))) };
    if (mode === 'bookmarks' && bookmarkReady) {
      const sections = bookmarkReady.sections;
      return { parts: sections, names: uniqueNames(sections.map((section, i) => bookmarkPartName(stem.resolved, i + 1, sections.length, section.title))) };
    }
    return null;
  }, [separateFiles, ranges.parts, mode, bookmarkReady, stem.resolved]);
  const notes = separateFiles && ranges.parts ? rangeNotes(ranges.parts, pageCount) : mode === 'bookmarks' && bookmarkReady ? bookmarkNotes(bookmarkReady) : [];

  const blocked =
    mode === 'range' ? rangeProblem !== null : mode === 'every' ? everyProblem !== null : mode === 'bookmarks' || separateFiles ? planned === null : selection.indices === null;

  const rangePages = rangeProblem ? [] : Array.from({ length: Number(to) - Number(from) + 1 }, (_, i) => Number(from) + i);
  const carried = carryNotes('split', files);

  const runSplit = () => {
    if (mode === 'range') run.start({ mode, from: Number(from), to: Number(to), name: name.resolved });
    else if (mode === 'every') run.start({ mode, every: n, stem: stem.resolved });
    else if (mode === 'bookmarks') run.start({ mode: 'bookmarks', stem: stem.resolved });
    else if (separate) run.start({ mode: 'ranges', pages: selection.text, stem: stem.resolved });
    else run.start({ mode, pages: selection.text, name: name.resolved });
  };

  const fileCount = mode === 'every' ? parts : (planned?.parts.length ?? 0);
  const choices: Choice<Mode>[] = [
    { value: 'range', label: 'One range of pages', description: 'From one page to another, as one file.' },
    {
      value: 'every',
      label: 'Equal parts',
      description: pageCount < 2 ? 'This file has only one page.' : 'Consecutive parts, each its own file.',
      disabled: pageCount < 2,
    },
    { value: 'selected', label: 'Chosen pages', description: 'The pages you choose, in your order.' },
  ];
  // Only for a file that has bookmarks; one that cannot be split at them says why.
  if (bookmarks.status !== 'none') {
    const why = bookmarks.status === 'failed' ? BOOKMARKS_UNREADABLE : bookmarks.status === 'ready' ? bookmarks.problem : null;
    choices.push({ value: 'bookmarks', label: BOOKMARKS_LABEL, description: why ?? BOOKMARKS_DESCRIPTION, disabled: why !== null });
  }

  // The page panel: chosen pages can be clicked only while they make one file.
  const sectionStarts = mode === 'bookmarks' && bookmarkReady ? bookmarkReady.sections.map((section, i) => (i === 0 ? section.from + bookmarkReady.before : section.from)) : [];
  const panelPages = mode === 'range' ? rangePages : mode === 'selected' ? selection.chosen : sectionStarts;
  const panelLabel =
    mode === 'range' && rangePages.length > 0
      ? `Pages ${from}–${to}`
      : separateFiles && planned
        ? plural(planned.parts.length, 'file')
        : mode === 'bookmarks' && bookmarkReady
          ? 'Each file starts at a marked page'
          : undefined;

  return (
    <ToolDialog
      tool="split"
      files={files}
      run={run}
      size="xl"
      showFile
      description="Take pages out of this PDF into a new file, or cut it into parts. The original is not changed."
      runLabel={fileCount > 1 ? `Split into ${fileCount} files` : 'Split'}
      blocked={blocked}
      onRun={runSplit}
      onClose={onClose}
    >
      <ChoiceCards<Mode>
        label="How to split"
        value={mode}
        onChange={(next) => {
          setMode(next);
          run.clearMessages();
        }}
        columns={choices.length === 4 ? 4 : 3}
        compact
        testIdPrefix="pdf-tools-split-mode"
        choices={choices}
      />

      {mode === 'range' && (
        <div className="flex flex-wrap items-start gap-3">
          <Field id="pdf-tools-split-from" label="From page" className="w-28">
            <Input
              id="pdf-tools-split-from"
              aria-invalid={rangeProblem ? true : undefined}
              aria-describedby="pdf-tools-split-range-message"
              type="number"
              inputMode="numeric"
              min={1}
              max={pageCount}
              step={1}
              value={from}
              data-testid="pdf-tools-split-from"
              className={INVALID_INPUT}
              onChange={(event) => setFrom(event.target.value)}
            />
          </Field>
          <Field id="pdf-tools-split-to" label="To page" className="w-28">
            <Input
              id="pdf-tools-split-to"
              aria-invalid={rangeProblem ? true : undefined}
              aria-describedby="pdf-tools-split-range-message"
              type="number"
              inputMode="numeric"
              min={1}
              max={pageCount}
              step={1}
              value={to}
              data-testid="pdf-tools-split-to"
              className={INVALID_INPUT}
              onChange={(event) => setTo(event.target.value)}
            />
          </Field>
          {rangeProblem ? (
            <p key="error" id="pdf-tools-split-range-message" role="alert" className="mt-7 min-w-0 flex-1 text-xs text-destructive" data-testid="pdf-tools-field-error">
              {rangeProblem}
            </p>
          ) : (
            <p key="hint" id="pdf-tools-split-range-message" className="mt-7 min-w-0 flex-1 text-xs text-muted-foreground">
              {`${plural(rangePages.length, 'page')} of ${pageCount}, as one file.`}
            </p>
          )}
        </div>
      )}

      {mode === 'every' && (
        <div className="flex flex-wrap items-start gap-3">
          <Field id="pdf-tools-split-every" label="Pages in each part" className="w-36" error={everyProblem}>
            <Input
              {...describedBy('pdf-tools-split-every', everyProblem)}
              type="number"
              inputMode="numeric"
              min={1}
              max={Math.max(1, pageCount - 1)}
              step={1}
              value={every}
              data-testid="pdf-tools-split-every"
              className={INVALID_INPUT}
              onChange={(event) => setEvery(event.target.value)}
            />
          </Field>
          {!everyProblem && (
            <p className="mt-7 min-w-0 flex-1 text-xs text-muted-foreground" data-testid="pdf-tools-split-parts">
              {parts} files: {partName(stem.resolved, 1, parts)} to {partName(stem.resolved, parts, parts)}
              {pageCount % n !== 0 && ` (the last has ${plural(pageCount % n, 'page')})`}.
            </p>
          )}
        </div>
      )}

      {mode === 'selected' && (
        <div className="space-y-2.5">
          <Field id="pdf-tools-page-list" label="Pages" error={separate ? ranges.error : selection.error} hint={separate ? SEPARATE_FILES_HINT : PAGE_LIST_HINT}>
            <Input
              {...describedBy('pdf-tools-page-list', separate ? ranges.error : selection.error, separate ? SEPARATE_FILES_HINT : PAGE_LIST_HINT)}
              data-testid="pdf-tools-page-list"
              className={INVALID_INPUT}
              placeholder={separate ? 'For example 1-32, 65-96' : 'For example 1-5, 8'}
              autoComplete="off"
              spellCheck={false}
              value={selection.text}
              onChange={(event) => selection.type(event.target.value)}
            />
          </Field>
          <div className="flex items-center gap-2.5">
            <Checkbox
              id="pdf-tools-split-separate"
              data-testid="pdf-tools-split-separate"
              checked={separate}
              onCheckedChange={(next) => {
                setSeparate(next === true);
                run.clearMessages();
              }}
            />
            <Label htmlFor="pdf-tools-split-separate" className="font-medium leading-snug">
              {SEPARATE_FILES_LABEL}
            </Label>
          </div>
        </div>
      )}

      {mode === 'bookmarks' && bookmarks.status === 'reading' && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground" role="status" data-testid="pdf-tools-split-bookmarks-status">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          {BOOKMARKS_READING}
        </p>
      )}
      {mode === 'bookmarks' && (bookmarks.status === 'failed' || (bookmarks.status === 'ready' && bookmarks.problem)) && (
        <Notice tone="neutral" role="status" testId="pdf-tools-split-bookmarks-status" title={bookmarks.status === 'failed' ? BOOKMARKS_UNREADABLE : bookmarks.problem} />
      )}

      {planned && <PlannedList key={`${mode}-${planned.parts.length}`} files={plannedFiles(planned.names, planned.parts)} />}
      <Notes notes={notes} tone={mode === 'bookmarks' ? 'neutral' : 'warning'} />

      {mode === 'every' ? (
        <ResultNameField name={stem} label="Name the parts from" id="pdf-tools-result-stem" hint={`Each part is named ${partName(stem.resolved, 1, Math.max(parts, 1))} and so on.`} />
      ) : mode === 'bookmarks' || separateFiles ? (
        <ResultNameField name={stem} label="Name the files from" id="pdf-tools-result-stem" />
      ) : (
        <ResultNameField name={name} />
      )}

      {carried.notes.length > 0 && (
        <Notice tone="neutral" title="What is not carried over" testId="pdf-tools-not-carried">
          {carried.notes.join(' ')}
        </Notice>
      )}

      <PagePanel
        file={file}
        listClassName="max-h-[260px]"
        selectedPages={panelPages}
        onTogglePage={mode === 'selected' && !separate ? selection.toggle : undefined}
        chosenLabel={panelLabel}
      />
    </ToolDialog>
  );
}
