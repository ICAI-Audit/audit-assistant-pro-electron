import { useId, useState } from 'react';
import { Input } from '@/components/ui/input';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';
import type { CompressLevel } from '@/lib/pdf-tools/compress';
import { alreadyUnder, compressResultName, defaultFitTarget, fitBlockedReason, fitRunLabel, QUICK_SIZES_MB, readTargetSize } from '../compressFit';
import { formatBytes, plural } from '../format';
import { resolveResultName } from '../toolOptions';
import { INVALID_INPUT } from './fieldProps';
import { ChoiceCards, Field, ToolDialog } from './ToolDialog';
import { useToolRun, type ToolDialogProps } from './useToolRun';

// How the images come out, in plain words (owner, 15 November 2026: no technical words such as "dpi" on screen).
const IMAGES: Record<CompressLevel, string> = { low: 'Images stay sharp.', recommended: 'Images a little softer.', extreme: 'Images softer and smallest.' };

// "Meant for" from spec section 5.5.
const MEANT_FOR: Record<CompressLevel, string> = {
  low: 'For documents that will be printed or read closely.',
  recommended: 'For the audit file; clear on screen.',
  extreme: 'For emailing; small text in scans may become hard to read.',
};

const LEVELS: CompressLevel[] = ['low', 'recommended', 'extreme'];

// Plain names (UX audit C6.3): what each level is for, in the words of the choice.
const LEVEL_NAMES: Record<CompressLevel, string> = { low: 'Light: best quality', recommended: 'Balanced', extreme: 'Strong: smallest file' };

/** The three levels, or Fit to a size (lane CT, owner decision 15 November 2026). */
type Mode = CompressLevel | 'fit';

export default function CompressDialog(props: ToolDialogProps) {
  const { files, onClose } = props;
  const run = useToolRun('compress', props);
  const [mode, setMode] = useState<Mode>('recommended');
  // A name the user typed, or null to follow the suggestion, which names the level or the size (user Q&A 1.24).
  const [typedNames, setTypedNames] = useState<(string | null)[]>(() => files.map(() => null));
  const total = files.reduce((sum, f) => sum + f.size, 0);
  // The size (owner, 15 November 2026: four quick picks and one box, nothing else): the box holds the size in MB;
  // a quick pick fills it, and "500 KB" typed in it is read as KB.
  const [sizeText, setSizeText] = useState(() => String(defaultFitTarget(files.map((f) => f.size)).value));
  const sizeLabelId = useId();

  const fitting = mode === 'fit';
  const reading = readTargetSize(sizeText, 'MB');
  const target = reading.target;
  const picked = target && target.unit === 'MB' && QUICK_SIZES_MB.some((mb) => mb === target.value) ? String(target.value) : '';
  // Said under the box once something unreadable has been typed; an empty box only holds Run back (its reason).
  const sizeError = fitting && sizeText.trim() !== '' ? reading.error : null;
  const blockedReason = fitting ? fitBlockedReason(files, reading) : null;
  const under = fitting && target ? alreadyUnder(files, target) : [];
  // Every file already under: the line under the size says so instead of the general note (one sentence, once).
  const allUnder = under.length > 0 && under.length === files.length;
  const underNote = under.length === 0 || allUnder ? null : `Already under ${target!.label}, so nothing will be made for ${under.map((f) => f.name).join(', ')}.`;

  const defaults = files.map((f) => compressResultName(f.name, mode, target));
  const names = typedNames.map((typedName, i) => typedName ?? defaults[i]);
  const setName = (i: number, value: string) => setTypedNames((current) => current.map((n, j) => (j === i ? value : n)));
  // Cleaned on leaving the field; back to following the suggestion when it holds the suggestion.
  const cleanName = (i: number) =>
    setTypedNames((current) =>
      current.map((n, j) => {
        if (j !== i || n === null) return n;
        const cleaned = resolveResultName(n, defaults[i], 'pdf');
        return cleaned === defaults[i] ? null : cleaned;
      }),
    );
  const resolvedNames = () => names.map((n, i) => resolveResultName(n, defaults[i], 'pdf'));
  const changed = <T,>(set: (value: T) => void) => (value: T) => {
    set(value);
    run.clearMessages();
  };

  const runLabel = fitting && target ? fitRunLabel(files.length, target) : files.length === 1 ? 'Compress' : `Compress ${files.length} files`;

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
      signedWarning="Compressing re-saves the file, which invalidates its digital signature: the result will not carry a valid signature. Keep the signed original as the evidence; use this copy only where a signature is not needed."
      runLabel={runLabel}
      blocked={blockedReason !== null}
      blockedReason={blockedReason}
      onRun={() => {
        if (!fitting) run.start({ level: mode, names: resolvedNames() });
        else if (target) run.start({ fit: { value: target.value, unit: target.unit }, names: resolvedNames() });
      }}
      onClose={onClose}
    >
      <ChoiceCards<Mode>
        label="Level"
        value={mode}
        onChange={changed(setMode)}
        testIdPrefix="pdf-tools-level"
        choices={[
          ...LEVELS.map((key) => ({
            value: key,
            label: LEVEL_NAMES[key],
            badge: key === 'recommended' ? 'Recommended' : undefined,
            description: `${IMAGES[key]} ${MEANT_FOR[key]}`,
          })),
          {
            value: 'fit' as const,
            label: 'Fit to a size',
            description: 'For a size limit, such as a portal’s: the best quality that fits, without going below readable.',
          },
        ]}
      />

      {fitting && (
        <div className="space-y-1.5" data-testid="pdf-tools-fit">
          <p id={sizeLabelId} className="text-sm font-medium leading-none">
            Size limit
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            <ToggleGroup
              type="single"
              aria-labelledby={sizeLabelId}
              value={picked}
              onValueChange={(next) => next && changed(setSizeText)(next)}
              className="flex-wrap justify-start gap-1.5"
            >
              {QUICK_SIZES_MB.map(String).map((mb) => (
                <ToggleGroupItem
                  key={mb}
                  value={mb}
                  data-testid={`pdf-tools-fit-size-${mb}`}
                  className="h-8 rounded-md border px-3 text-xs font-medium data-[state=on]:border-primary data-[state=on]:bg-primary/10 data-[state=on]:text-foreground"
                >
                  {mb} MB
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <div className="relative w-28">
              <Input
                id="pdf-tools-fit-size-value"
                data-testid="pdf-tools-fit-size-value"
                aria-label="Size limit in MB"
                aria-invalid={sizeError ? true : undefined}
                aria-describedby="pdf-tools-fit-size-value-message"
                className={cn('h-8 pr-10 tabular-nums', INVALID_INPUT)}
                inputMode="decimal"
                autoComplete="off"
                spellCheck={false}
                value={sizeText}
                onChange={(event) => changed(setSizeText)(event.target.value)}
              />
              {!/[a-z]/i.test(sizeText) && (
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground" aria-hidden="true">
                  MB
                </span>
              )}
            </div>
          </div>
          {sizeError ? (
            <p key="error" id="pdf-tools-fit-size-value-message" role="alert" className="text-xs text-destructive" data-testid="pdf-tools-field-error">
              {sizeError}
            </p>
          ) : (
            <p key="hint" id="pdf-tools-fit-size-value-message" className={cn('text-xs', allUnder ? 'text-foreground' : 'text-muted-foreground')} data-testid="pdf-tools-fit-note">
              {allUnder ? blockedReason : 'How small a file can go depends on its images; that is known only by trying.'}
            </p>
          )}
          {underNote && (
            <p className="text-xs text-foreground" data-testid="pdf-tools-fit-under">
              {underNote}
            </p>
          )}
        </div>
      )}

      <p className="text-xs leading-relaxed text-muted-foreground" data-testid="pdf-tools-compress-note">
        Only the images inside are made smaller. Text, fonts and line drawings are not touched and stay sharp. The original file is not changed.
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
