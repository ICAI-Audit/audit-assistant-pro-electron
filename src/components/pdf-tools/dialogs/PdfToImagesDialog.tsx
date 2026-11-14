import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { pageImageName, stripExtension } from '@/lib/pdf-tools/fileNames';
import { LIST_MAX_BYTES } from '@/lib/pdf-tools/workingList';
import { formatBytes, plural } from '../format';
import PagePanel from '../PagePanel';
import { estimateImageBytes, imageBudgetWarning } from '../toolOptions';
import { describedBy, INVALID_INPUT } from './fieldProps';
import { ChoiceCards, Field, Notice, ResultNameField, ToolDialog } from './ToolDialog';
import { usePageList } from './usePageList';
import { useResultName, useToolRun, type ToolDialogProps } from './useToolRun';

type Dpi = 100 | 150 | 300;
type Format = 'png' | 'jpg';

const HINT = 'Click pages below or type them, for example 1-3, 7. Each page becomes one image.';

export default function PdfToImagesDialog(props: ToolDialogProps) {
  const { files, onClose, listBytes } = props;
  const file = files[0];
  const pageCount = file.pageCount ?? 0;
  const run = useToolRun('pdf-to-images', props);
  const [which, setWhich] = useState<'all' | 'selected'>('all');
  const [format, setFormat] = useState<Format>('png');
  const [dpi, setDpi] = useState<Dpi>(150);
  const pages = usePageList(pageCount, 'sorted');
  const stem = useResultName(stripExtension(file.name), 'stem');

  const count = which === 'all' ? pageCount : (pages.indices?.length ?? 0);
  const estimate = estimateImageBytes(count, dpi, format);
  // Only a warning: the estimate is a planning figure; the real sizes are checked as images are made.
  const mayNotFit = count > 0 ? imageBudgetWarning(estimate, listBytes, LIST_MAX_BYTES, { dpi, format }) : null;
  const listProblem = which === 'selected' ? pages.error : null;
  const blocked = count === 0 || listProblem !== null;
  const firstPage = which === 'all' ? 1 : (pages.chosen[0] ?? 1);

  return (
    <ToolDialog
      tool="pdf-to-images"
      files={files}
      run={run}
      size="xl"
      showFile
      description="Save pages of this PDF as images, one image per page. They appear in the list as one group."
      runLabel={count > 0 ? `Make ${plural(count, 'image')}` : 'Make images'}
      blocked={blocked}
      onRun={() => run.start({ pages: which === 'all' ? 'all' : pages.text, format, dpi, stem: stem.resolved })}
      onClose={onClose}
    >
      <ChoiceCards<'all' | 'selected'>
        label="Pages"
        value={which}
        onChange={(next) => {
          setWhich(next);
          run.clearMessages();
        }}
        columns={2}
        compact
        testIdPrefix="pdf-tools-image-pages"
        choices={[
          { value: 'all', label: `All ${plural(pageCount, 'page')}` },
          { value: 'selected', label: 'Selected pages' },
        ]}
      />

      {which === 'selected' && (
        <Field id="pdf-tools-page-list" label="Pages to save" error={listProblem} hint={HINT}>
          <Input
            {...describedBy('pdf-tools-page-list', listProblem, HINT)}
            data-testid="pdf-tools-page-list"
            className={INVALID_INPUT}
            placeholder="For example 1-3, 7"
            autoComplete="off"
            spellCheck={false}
            value={pages.text}
            onChange={(event) => pages.type(event.target.value)}
          />
        </Field>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <ChoiceCards<Format>
          label="Image type"
          value={format}
          onChange={setFormat}
          compact
          testIdPrefix="pdf-tools-image-format"
          choices={[
            { value: 'png', label: 'PNG', description: 'Sharp text and lines; larger files.' },
            { value: 'jpg', label: 'JPG', description: 'Smaller files; best for scans and photos.' },
          ]}
        />
        <ChoiceCards<'100' | '150' | '300'>
          label="Resolution"
          value={String(dpi) as '100' | '150' | '300'}
          onChange={(value) => setDpi(Number(value) as Dpi)}
          compact
          testIdPrefix="pdf-tools-image-dpi"
          choices={[
            { value: '100', label: '100 dpi', description: 'For viewing on screen.' },
            { value: '150', label: '150 dpi', description: 'Clear on screen and in print drafts.', badge: 'Default' },
            { value: '300', label: '300 dpi', description: 'For printing; much larger files.' },
          ]}
        />
      </div>

      <ResultNameField
        name={stem}
        label="Name the images from"
        id="pdf-tools-result-stem"
        hint={`Images are named ${pageImageName(stem.resolved, firstPage, pageCount, format)} and so on.`}
      />

      {mayNotFit ? (
        <Notice tone="warning" icon={AlertTriangle} role="status" testId="pdf-tools-image-estimate-warning" title="These images may not fit">
          {mayNotFit}
        </Notice>
      ) : (
        <p className="text-xs text-muted-foreground" data-testid="pdf-tools-image-estimate">
          {count > 0 ? `About ${formatBytes(estimate)} for ${plural(count, 'image')}; the list holds ${formatBytes(LIST_MAX_BYTES)} at most.` : ''}
        </p>
      )}

      {which === 'selected' && (
        <PagePanel file={file} listClassName="max-h-[240px]" selectedPages={pages.chosen} onTogglePage={pages.toggle} />
      )}
    </ToolDialog>
  );
}
