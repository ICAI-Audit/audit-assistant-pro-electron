import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { partName, stripExtension } from '@/lib/pdf-tools/fileNames';
import { defaultResultName } from '@/lib/pdf-tools/resultNames';
import { plural } from '../format';
import PagePanel from '../PagePanel';
import { partCount, rangeError, splitSizeError } from '../toolOptions';
import { carryNotes } from './carryNotes';
import { describedBy, INVALID_INPUT } from './fieldProps';
import { ChoiceCards, Field, Notice, ResultNameField, ToolDialog } from './ToolDialog';
import { usePageList } from './usePageList';
import { useResultName, useToolRun, type ToolDialogProps } from './useToolRun';

type Mode = 'range' | 'every' | 'selected';

const PAGE_LIST_HINT = 'Pages in the order you want them, for example 1-5, 8, 10-12. Click pages below to add or remove them. A page typed twice is included twice.';

export default function SplitDialog(props: ToolDialogProps) {
  const { files, onClose } = props;
  const file = files[0];
  const pageCount = file.pageCount ?? 0;
  const run = useToolRun('split', props);
  const [mode, setMode] = useState<Mode>('range');
  const [from, setFrom] = useState('1');
  const [to, setTo] = useState(String(pageCount));
  const [every, setEvery] = useState('1');
  const selection = usePageList(pageCount, 'as-written');

  const rangeProblem = rangeError(from, to, pageCount);
  const everyProblem = splitSizeError(every, pageCount);
  const rangeDefault = defaultResultName('split', file.name, rangeProblem ? { from: 1, to: pageCount } : { from: Number(from), to: Number(to) });
  const name = useResultName(mode === 'range' ? rangeDefault : defaultResultName('split', file.name));
  const stem = useResultName(stripExtension(file.name), 'stem');

  const n = Number(every);
  const parts = everyProblem ? 0 : partCount(pageCount, n);
  const blocked = mode === 'range' ? rangeProblem !== null : mode === 'every' ? everyProblem !== null : selection.indices === null;

  const rangePages = rangeProblem ? [] : Array.from({ length: Number(to) - Number(from) + 1 }, (_, i) => Number(from) + i);
  const carried = carryNotes('split', files);

  const runSplit = () => {
    if (mode === 'range') run.start({ mode, from: Number(from), to: Number(to), name: name.resolved });
    else if (mode === 'every') run.start({ mode, every: n, stem: stem.resolved });
    else run.start({ mode, pages: selection.text, name: name.resolved });
  };

  return (
    <ToolDialog
      tool="split"
      files={files}
      run={run}
      size="xl"
      showFile
      description="Take pages out of this PDF into a new file, or cut it into parts. The original is not changed."
      runLabel={mode === 'every' && parts > 1 ? `Split into ${parts} files` : 'Split'}
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
        columns={3}
        compact
        testIdPrefix="pdf-tools-split-mode"
        choices={[
          { value: 'range', label: 'Page range', description: 'From one page to another, as one file.' },
          {
            value: 'every',
            label: 'Every N pages',
            description: pageCount < 2 ? 'This file has only one page.' : 'Consecutive parts, each its own file.',
            disabled: pageCount < 2,
          },
          { value: 'selected', label: 'Selected pages', description: 'The pages you choose, in your order.' },
        ]}
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
        <Field id="pdf-tools-page-list" label="Pages" error={selection.error} hint={PAGE_LIST_HINT}>
          <Input
            {...describedBy('pdf-tools-page-list', selection.error, PAGE_LIST_HINT)}
            data-testid="pdf-tools-page-list"
            className={INVALID_INPUT}
            placeholder="For example 1-5, 8"
            autoComplete="off"
            spellCheck={false}
            value={selection.text}
            onChange={(event) => selection.type(event.target.value)}
          />
        </Field>
      )}

      {mode === 'every' ? (
        <ResultNameField name={stem} label="Name the parts from" id="pdf-tools-result-stem" hint={`Each part is named ${partName(stem.resolved, 1, Math.max(parts, 1))} and so on.`} />
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
        selectedPages={mode === 'range' ? rangePages : mode === 'selected' ? selection.chosen : []}
        onTogglePage={mode === 'selected' ? selection.toggle : undefined}
        chosenLabel={mode === 'range' && rangePages.length > 0 ? `Pages ${from}–${to}` : undefined}
      />
    </ToolDialog>
  );
}
