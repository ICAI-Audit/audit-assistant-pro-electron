import { useState } from 'react';
import { Input } from '@/components/ui/input';
import type { ImagePageSize } from '@/lib/pdf-tools/imagesToPdf';
import { defaultResultName } from '@/lib/pdf-tools/resultNames';
import { formatBytes } from '../format';
import Thumb from '../Thumb';
import { IMAGE_MARGIN, ptToMm, readImageMargin } from '../toolOptions';
import { describedBy, INVALID_INPUT } from './fieldProps';
import { ChoiceCards, Field, ResultNameField, ToolDialog } from './ToolDialog';
import { useResultName, useToolRun, type ToolDialogProps } from './useToolRun';

export default function ImagesToPdfDialog(props: ToolDialogProps) {
  const { files, onClose } = props;
  const run = useToolRun('images-to-pdf', props);
  const [pageSize, setPageSize] = useState<ImagePageSize>('a4-auto');
  const [margin, setMargin] = useState(String(IMAGE_MARGIN.default));
  const name = useResultName(defaultResultName('images-to-pdf', files[0].name));
  const fit = pageSize === 'fit';
  const marginRead = readImageMargin(margin);
  const marginProblem = fit ? null : marginRead.error;
  const marginHint = fit
    ? 'No margin: each page is the size of its image.'
    : marginRead.marginPt !== null
      ? `About ${Math.round(ptToMm(marginRead.marginPt))} mm. ${IMAGE_MARGIN.min} to ${IMAGE_MARGIN.max} pt.`
      : undefined;
  const total = files.reduce((sum, f) => sum + f.size, 0);

  return (
    <ToolDialog
      tool="images-to-pdf"
      files={files}
      run={run}
      size="lg"
      description="Make one PDF with one image per page, in the order of the list. To change the order, close this and move the images in the list."
      runLabel="Make PDF"
      blocked={marginProblem !== null}
      busyNote="Large images can take a while."
      onRun={() => run.start({ pageSize, marginPt: fit ? 0 : (marginRead.marginPt ?? IMAGE_MARGIN.default), name: name.resolved })}
      onClose={onClose}
    >
      <div className="space-y-1.5">
        <p className="text-sm font-medium leading-none">
          {files.length === 1 ? '1 image' : `${files.length} images, in this order`}{' '}
          <span className="font-normal text-muted-foreground">· {formatBytes(total)}</span>
        </p>
        <ol className="flex gap-2 overflow-x-auto rounded-md border bg-muted/20 p-2" data-testid="pdf-tools-image-order">
          {files.map((file, i) => (
            <li key={file.id} className="flex w-[64px] shrink-0 flex-col items-center gap-1" title={file.name}>
              <Thumb file={file} width={56} alt={`Image ${i + 1}: ${file.name}`} className="h-[56px] bg-card" />
              <span className="w-full truncate text-center text-[11px] text-muted-foreground">
                {i + 1}. {file.name}
              </span>
            </li>
          ))}
        </ol>
      </div>

      <ChoiceCards<ImagePageSize>
        label="Page size"
        value={pageSize}
        onChange={setPageSize}
        columns={2}
        compact
        testIdPrefix="pdf-tools-page-size"
        choices={[
          { value: 'a4-auto', label: 'A4, turned to suit each image', description: 'Portrait or landscape, whichever fits the image.', badge: 'Default' },
          { value: 'fit', label: 'Same size as each image', description: 'Each page is exactly its image.' },
          { value: 'a4-portrait', label: 'A4 portrait', description: 'Every page upright.' },
          { value: 'a4-landscape', label: 'A4 landscape', description: 'Every page on its side.' },
        ]}
      />

      <Field id="pdf-tools-image-margin" label="Margin (pt)" error={marginProblem} hint={marginHint} className="max-w-xs">
        <Input
          {...describedBy('pdf-tools-image-margin', marginProblem, marginHint)}
          data-testid="pdf-tools-image-margin"
          className={`w-28 ${INVALID_INPUT}`}
          type="number"
          inputMode="decimal"
          min={IMAGE_MARGIN.min}
          max={IMAGE_MARGIN.max}
          step={1}
          disabled={fit}
          value={fit ? '0' : margin}
          onChange={(event) => setMargin(event.target.value)}
        />
      </Field>
      <p className="text-xs text-muted-foreground">Images are never enlarged; a smaller image sits in the middle of its page.</p>

      <ResultNameField name={name} />
    </ToolDialog>
  );
}
