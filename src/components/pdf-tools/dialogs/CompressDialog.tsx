import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { COMPRESS_LEVELS, type CompressLevel } from '@/lib/pdf-tools/compress';
import { defaultResultName } from '@/lib/pdf-tools/resultNames';
import { formatBytes, plural } from '../format';
import { resolveResultName } from '../toolOptions';
import { ChoiceCards, Field, ToolDialog } from './ToolDialog';
import { useToolRun, type ToolDialogProps } from './useToolRun';

const QUALITY: Record<CompressLevel, string> = { low: 'high', recommended: 'medium', extreme: 'low' };

// "Meant for" from spec section 5.5.
const MEANT_FOR: Record<CompressLevel, string> = {
  low: 'For documents that will be printed or read closely.',
  recommended: 'For the audit file; clear on screen.',
  extreme: 'For emailing; small text in scans may become hard to read.',
};

const LEVELS: CompressLevel[] = ['low', 'recommended', 'extreme'];

export default function CompressDialog(props: ToolDialogProps) {
  const { files, onClose } = props;
  const run = useToolRun('compress', props);
  const [level, setLevel] = useState<CompressLevel>('recommended');
  const defaults = files.map((f) => defaultResultName('compress', f.name));
  const [names, setNames] = useState(defaults);
  const total = files.reduce((sum, f) => sum + f.size, 0);

  const setName = (i: number, value: string) => setNames((current) => current.map((n, j) => (j === i ? value : n)));
  const cleanName = (i: number) => setNames((current) => current.map((n, j) => (j === i ? resolveResultName(n, defaults[i], 'pdf') : n)));

  return (
    <ToolDialog
      tool="compress"
      files={files}
      run={run}
      size="lg"
      showFile
      description={
        files.length === 1
          ? `Make a smaller copy of this PDF (${formatBytes(total)}) by reducing the images inside it.`
          : `Make a smaller copy of each of these ${files.length} PDFs (${formatBytes(total)} in all). Each gets its own result.`
      }
      signedWarning="Compressing re-saves the file, which invalidates its digital signature: the result will not carry a valid signature."
      runLabel={files.length === 1 ? 'Compress' : `Compress ${files.length} files`}
      blocked={false}
      onRun={() => run.start({ level, names: names.map((n, i) => resolveResultName(n, defaults[i], 'pdf')) })}
      onClose={onClose}
    >
      <ChoiceCards<CompressLevel>
        label="Level"
        value={level}
        onChange={(next) => {
          setLevel(next);
          run.clearMessages();
        }}
        testIdPrefix="pdf-tools-level"
        choices={LEVELS.map((key) => ({
          value: key,
          label: COMPRESS_LEVELS[key].label,
          badge: key === 'recommended' ? 'Default' : undefined,
          description: `Images up to ${COMPRESS_LEVELS[key].dpi} dpi, ${QUALITY[key]} quality. ${MEANT_FOR[key]}`,
        }))}
      />
      <p className="text-xs leading-relaxed text-muted-foreground" data-testid="pdf-tools-compress-note">
        Image quality is reduced to make the file smaller. Text, fonts and line drawings are not touched and stay sharp. The original file is not
        changed.
      </p>

      {files.length === 1 ? (
        <Field id="pdf-tools-result-name" label="Result name">
          <Input
            id="pdf-tools-result-name"
            data-testid="pdf-tools-result-name"
            value={names[0]}
            maxLength={200}
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => setName(0, event.target.value)}
            onBlur={() => cleanName(0)}
          />
        </Field>
      ) : (
        <div className="space-y-1.5">
          <p className="text-sm font-medium leading-none">Result names</p>
          <ul className="max-h-[200px] space-y-2 overflow-y-auto rounded-md border p-2.5">
            {files.map((file, i) => (
              <li key={file.id} className="grid gap-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] sm:items-center sm:gap-3">
                <label htmlFor={`pdf-tools-result-name-${i}`} className="truncate text-xs text-muted-foreground" title={file.name}>
                  {file.name} · {plural(file.pageCount ?? 0, 'page')}
                </label>
                <Input
                  id={`pdf-tools-result-name-${i}`}
                  data-testid="pdf-tools-result-name"
                  className="h-8"
                  value={names[i]}
                  maxLength={200}
                  spellCheck={false}
                  autoComplete="off"
                  onChange={(event) => setName(i, event.target.value)}
                  onBlur={() => cleanName(i)}
                />
              </li>
            ))}
          </ul>
        </div>
      )}
    </ToolDialog>
  );
}
