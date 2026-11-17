import { useState } from 'react';
import { Bookmark, FileImage, FileText, TextCursorInput } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { defaultResultName } from '@/lib/pdf-tools/resultNames';
import { formatBytes, plural } from '../format';
import { MERGE_IMAGE_OPTIONS } from '../runTool';
import { ptToMm } from '../toolOptions';
import { carryNotes } from './carryNotes';
import OrderList from './OrderList';
import { Notice, ResultNameField, ToolDialog } from './ToolDialog';
import { useResultName, useToolRun, type ToolDialogProps } from './useToolRun';

/** One tick box with its line of explanation; `indent` sets an option that depends on the one above. */
function BookmarkOption({
  id,
  label,
  hint,
  checked,
  disabled = false,
  indent = false,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  checked: boolean;
  disabled?: boolean;
  indent?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className={cn('flex items-start gap-2.5', indent && 'pl-6')}>
      <Checkbox
        id={id}
        data-testid={id}
        className="mt-0.5"
        checked={checked}
        disabled={disabled}
        aria-describedby={`${id}-hint`}
        onCheckedChange={(next) => onChange(next === true)}
      />
      <div className="min-w-0 space-y-0.5">
        <Label htmlFor={id} className={cn('font-medium leading-snug', disabled && 'text-muted-foreground')}>
          {label}
        </Label>
        <p id={`${id}-hint`} className="text-xs leading-snug text-muted-foreground">
          {hint}
        </p>
      </div>
    </div>
  );
}

/**
 * Merge: the files are merged in the order shown, which starts as the list's and can be changed here (UX
 * audit T2-6; the list itself is left as it is). Design 5.2: a bookmark for each file (on by default) and,
 * while that is on, each file's own bookmarks kept under it (on by default).
 */
export default function MergeDialog(props: ToolDialogProps) {
  const { onClose } = props;
  // The order shown is the order run: the run takes `files` from these props when Run is pressed.
  const [files, setFiles] = useState(props.files);
  const run = useToolRun('merge', { ...props, files });
  // The default name follows the first file until a name is typed (design 5.2).
  const name = useResultName(defaultResultName('merge', files[0].name));
  const [fileBookmarks, setFileBookmarks] = useState(true);
  const [keepOwn, setKeepOwn] = useState(true);
  // "Keep each file's own bookmarks" is available only while "a bookmark for each file" is on.
  const keepOwnBookmarks = fileBookmarks && keepOwn;
  const images = files.filter((f) => f.kind === 'image').length;
  const pages = files.reduce((sum, f) => sum + (f.kind === 'image' ? 1 : (f.pageCount ?? 0)), 0);
  const marked = files.filter((f) => f.hasBookmarks).length;
  const carried = carryNotes('merge', files, { keepOwnBookmarks });

  return (
    <ToolDialog
      tool="merge"
      files={files}
      run={run}
      description="The files are combined into one PDF, in the order shown below. The originals are not changed."
      runLabel="Merge"
      blocked={files.length < 2}
      onRun={() => run.start({ name: name.resolved, fileBookmarks, keepOwnBookmarks })}
      onClose={onClose}
    >
      <OrderList
        files={files}
        onChange={setFiles}
        testId="pdf-tools-merge-order"
        label={
          <>
            In this order <span className="font-normal text-muted-foreground">· {plural(pages, 'page')} in all</span>
          </>
        }
        leading={(file) => {
          const Icon = file.kind === 'image' ? FileImage : FileText;
          return <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />;
        }}
        meta={(file) => `${file.kind === 'image' ? 'Image → 1 page' : plural(file.pageCount ?? 0, 'page')} · ${formatBytes(file.size)}`}
      />

      <ResultNameField name={name} />

      <div className="space-y-1.5" role="group" aria-labelledby="pdf-tools-merge-bookmarks-label">
        <p id="pdf-tools-merge-bookmarks-label" className="flex items-center gap-1.5 text-sm font-medium leading-none">
          <Bookmark className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
          Bookmarks
        </p>
        <div className="space-y-2.5 rounded-md border px-3 py-2.5">
          <BookmarkOption
            id="pdf-tools-merge-file-bookmarks"
            label="Add a bookmark for each file"
            hint="One bookmark per file, named after the file, at its first page."
            checked={fileBookmarks}
            onChange={setFileBookmarks}
          />
          <BookmarkOption
            id="pdf-tools-merge-keep-bookmarks"
            indent
            label="Keep each file's own bookmarks under it"
            hint={
              !fileBookmarks
                ? 'Available when a bookmark is added for each file.'
                : marked === 0
                  ? 'None of these files has bookmarks of its own.'
                  : `${marked === 1 ? 'One file has' : `${marked} files have`} bookmarks. A file's bookmark with bookmarks under it starts closed.`
            }
            checked={keepOwnBookmarks}
            disabled={!fileBookmarks}
            onChange={setKeepOwn}
          />
        </div>
      </div>

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
                  // In millimetres only: points are not a word for the user (REV-B minor 15).
                  `${images === 1 ? 'The image becomes an A4 page' : 'Each image becomes an A4 page'}, turned to suit it, with a ${Math.round(ptToMm(MERGE_IMAGE_OPTIONS.marginPt))} mm margin.`,
                ]
              : []),
          ].join(' ')}
        </Notice>
      )}
    </ToolDialog>
  );
}
