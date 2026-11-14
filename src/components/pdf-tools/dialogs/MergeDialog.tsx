import { FileImage, FileText, TextCursorInput } from 'lucide-react';
import { defaultResultName } from '@/lib/pdf-tools/resultNames';
import { formatBytes, plural } from '../format';
import { MERGE_IMAGE_OPTIONS } from '../runTool';
import { ptToMm } from '../toolOptions';
import { carryNotes } from './carryNotes';
import { Notice, ResultNameField, ToolDialog } from './ToolDialog';
import { useResultName, useToolRun, type ToolDialogProps } from './useToolRun';

/** Merge needs only a name: the files are merged in the order of the list. */
export default function MergeDialog(props: ToolDialogProps) {
  const { files, onClose } = props;
  const run = useToolRun('merge', props);
  const name = useResultName(defaultResultName('merge', files[0].name));
  const images = files.filter((f) => f.kind === 'image').length;
  const pages = files.reduce((sum, f) => sum + (f.kind === 'image' ? 1 : (f.pageCount ?? 0)), 0);
  const carried = carryNotes('merge', files);

  return (
    <ToolDialog
      tool="merge"
      files={files}
      run={run}
      description="The files are combined in the order they have in the list. To change the order, close this and move them in the list."
      runLabel="Merge"
      blocked={files.length < 2}
      onRun={() => run.start({ name: name.resolved })}
      onClose={onClose}
    >
      <div className="space-y-1.5">
        <p className="text-sm font-medium leading-none">
          In this order <span className="font-normal text-muted-foreground">· {plural(pages, 'page')} in all</span>
        </p>
        <ol className="max-h-[220px] divide-y overflow-y-auto rounded-md border" data-testid="pdf-tools-merge-order">
          {files.map((file, i) => {
            const Icon = file.kind === 'image' ? FileImage : FileText;
            return (
              <li key={file.id} className="flex items-center gap-2.5 px-3 py-1.5 text-sm">
                <span className="w-5 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{i + 1}</span>
                <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate" title={file.name}>
                  {file.name}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {file.kind === 'image' ? 'Image → 1 page' : plural(file.pageCount ?? 0, 'page')} · {formatBytes(file.size)}
                </span>
              </li>
            );
          })}
        </ol>
      </div>

      <ResultNameField name={name} />

      {carried.forms && (
        <Notice tone="warning" icon={TextCursorInput} title="Form fields" testId="pdf-tools-forms-warning">
          {carried.forms}
        </Notice>
      )}

      {(carried.notes.length > 0 || images > 0) && (
        <Notice tone="neutral" title={carried.notes.length > 0 ? 'What is not carried over' : 'Images'} testId="pdf-tools-not-carried">
          {[
            ...carried.notes,
            ...(images > 0
              ? [
                  `${images === 1 ? 'The image becomes an A4 page' : 'Each image becomes an A4 page'}, turned to suit it, with a ${MERGE_IMAGE_OPTIONS.marginPt} pt (${Math.round(ptToMm(MERGE_IMAGE_OPTIONS.marginPt))} mm) margin.`,
                ]
              : []),
          ].join(' ')}
        </Notice>
      )}
    </ToolDialog>
  );
}
