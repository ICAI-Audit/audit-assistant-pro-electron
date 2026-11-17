import { useState } from 'react';
import { Input } from '@/components/ui/input';
import type { ImagePageSize } from '@/lib/pdf-tools/imagesToPdf';
import { defaultResultName } from '@/lib/pdf-tools/resultNames';
import { formatBytes } from '../format';
import Thumb from '../Thumb';
import { IMAGE_MARGIN, ptToMm, readImageMargin } from '../toolOptions';
import { describedBy, INVALID_INPUT } from './fieldProps';
import OrderList from './OrderList';
import { ChoiceCards, Field, MoreOptions, ResultNameField, ToolDialog } from './ToolDialog';
import { useResultName, useToolRun, type ToolDialogProps } from './useToolRun';

export default function ImagesToPdfDialog(props: ToolDialogProps) {
  const { onClose } = props;
  // The order shown is the order run (UX audit T2-6): the run takes `files` from these props when Run is pressed.
  const [files, setFiles] = useState(props.files);
  const run = useToolRun('images-to-pdf', { ...props, files });
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
  const marginSummary = fit
    ? 'No margin: each page is the size of its image.'
    : marginRead.marginPt !== null
      ? `Margin ${marginRead.marginPt} pt (about ${Math.round(ptToMm(marginRead.marginPt))} mm). Images are never enlarged.`
      : 'Margin: check the value.';

  return (
    <ToolDialog
      tool="images-to-pdf"
      files={files}
      run={run}
      size="lg"
      description="Make one PDF with one image per page, in the order shown below. The originals are not changed."
      runLabel="Make PDF"
      blocked={marginProblem !== null}
      busyNote="Large images can take a while."
      onRun={() => run.start({ pageSize, marginPt: fit ? 0 : (marginRead.marginPt ?? IMAGE_MARGIN.default), name: name.resolved })}
      onClose={onClose}
    >
      <OrderList
        files={files}
        onChange={setFiles}
        testId="pdf-tools-image-order"
        className="max-h-[188px]"
        label={
          <>
            {files.length === 1 ? '1 image' : `${files.length} images, in this order`} <span className="font-normal text-muted-foreground">· {formatBytes(total)}</span>
          </>
        }
        leading={(file) => <Thumb file={file} width={32} alt="" className="h-8 bg-card" />}
        meta={(file) => formatBytes(file.size)}
      />

      <ChoiceCards<ImagePageSize>
        label="Page size"
        value={pageSize}
        onChange={setPageSize}
        columns={2}
        compact
        testIdPrefix="pdf-tools-page-size"
        choices={[
          { value: 'a4-auto', label: 'A4, turned to suit each image', description: 'Portrait or landscape, whichever fits the image.', badge: 'Recommended' },
          { value: 'fit', label: 'Same size as each image', description: 'Each page is exactly its image.' },
          { value: 'a4-portrait', label: 'A4 portrait', description: 'Every page upright.' },
          { value: 'a4-landscape', label: 'A4 landscape', description: 'Every page on its side.' },
        ]}
      />

      <ResultNameField name={name} />

      {/* UX audit C6.4: the margin is a choice most runs leave alone; its line shows the current value. */}
      <MoreOptions id="pdf-tools-images-more" summary={marginSummary} invalid={marginProblem !== null}>
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
      </MoreOptions>
    </ToolDialog>
  );
}
