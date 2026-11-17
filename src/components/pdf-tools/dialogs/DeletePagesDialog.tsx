import { Input } from '@/components/ui/input';
import { defaultResultName } from '@/lib/pdf-tools/resultNames';
import { plural } from '../format';
import PagePanel from '../PagePanel';
import { deleteError, pagesLeft } from '../toolOptions';
import { carryNotes } from './carryNotes';
import { describedBy, INVALID_INPUT } from './fieldProps';
import { Field, Notice, ResultNameField, ToolDialog } from './ToolDialog';
import { usePageList } from './usePageList';
import { useResultName, useToolRun, type ToolDialogProps } from './useToolRun';

const HINT = 'Click the pages to remove, or type them, for example 2, 5-7.';

export default function DeletePagesDialog(props: ToolDialogProps) {
  const { files, onClose } = props;
  const file = files[0];
  const pageCount = file.pageCount ?? 0;
  const run = useToolRun('delete-pages', props);
  const pages = usePageList(pageCount, 'sorted');
  const name = useResultName(defaultResultName('delete-pages', file.name));

  const carried = carryNotes('delete-pages', files);
  const allPages = pages.indices ? deleteError(pages.indices, pageCount) : null;
  const problem = pages.error ?? allPages;
  const removing = pages.indices?.length ?? 0;
  const left = pages.indices ? pagesLeft(pages.indices, pageCount) : pageCount;
  const status = pages.empty
    ? HINT
    : problem ?? `${plural(removing, 'page')} will be removed; ${plural(left, 'page')} ${left === 1 ? 'remains' : 'remain'}, in their original order.`;

  return (
    <ToolDialog
      tool="delete-pages"
      files={files}
      run={run}
      size="xl"
      showFile
      description="Make a copy of this PDF without the pages you mark. The original is not changed."
      runLabel={removing > 0 && !problem ? `Delete ${plural(removing, 'page')}` : 'Delete pages'}
      blocked={pages.indices === null || problem !== null}
      onRun={() => run.start({ pages: pages.text, name: name.resolved })}
      onClose={onClose}
    >
      <Field id="pdf-tools-page-list" label="Pages to remove" error={problem} hint={problem ? undefined : status}>
        <Input
          {...describedBy('pdf-tools-page-list', problem, status)}
          data-testid="pdf-tools-page-list"
          className={INVALID_INPUT}
          placeholder="For example 2, 5-7"
          autoComplete="off"
          spellCheck={false}
          value={pages.text}
          onChange={(event) => pages.type(event.target.value)}
        />
      </Field>

      <ResultNameField name={name} />

      {carried.notes.length > 0 && (
        <Notice tone="neutral" title="What is not carried over" testId="pdf-tools-not-carried">
          {carried.notes.join(' ')}
        </Notice>
      )}

      <PagePanel
        file={file}
        tone="destructive"
        listClassName="max-h-[280px]"
        selectedPages={pages.chosen}
        onTogglePage={pages.toggle}
        chosenLabel={pages.chosen.length > 0 ? `${plural(pages.chosen.length, 'page')} marked for removal` : undefined}
      />
    </ToolDialog>
  );
}
