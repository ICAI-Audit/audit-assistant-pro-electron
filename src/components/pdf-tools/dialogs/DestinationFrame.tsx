// The frame the three destination dialogs share (Add from Evidence Vault, Add to Evidence Vault,
// Attach to working paper) and the vault form fields that the vault and working-paper dialogs both
// show. Like ToolDialog: the dialog itself takes focus when it opens, focus goes back to the
// control that opened it when it closes, and it cannot be closed while files are being sent (Stop
// finishes the file being sent and leaves the rest). The hooks are in useDestinationDialog.ts.
import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import { AlertCircle, AlertTriangle, FileText, Image as ImageIcon, Loader2, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import type { WorkingFile } from '@/lib/pdf-tools/types';
import { batchNames, EVIDENCE_TYPES, sameNameInVault, vaultName, type EvidenceType } from '../destinations';
import { formatBytes } from '../format';
import type { VaultFileRow } from '../vaultBytes';
import { Field, FileChip, IndeterminateBar, Notice } from './ToolDialog';
import { describedBy } from './fieldProps';
import type { BatchRun, VaultFormState } from './useDestinationDialog';

// ---- the frame ---------------------------------------------------------------------------------

const SIZES = { md: 'sm:max-w-lg', lg: 'sm:max-w-2xl' } as const;

export interface DestinationFrameProps {
  testId: string;
  icon: LucideIcon;
  title: string;
  description: ReactNode;
  size?: keyof typeof SIZES;
  batch?: BatchRun;
  /** "Adding", "Attaching": the verb shown with the progress. */
  progressVerb?: string;
  confirmLabel: ReactNode;
  confirmTestId: string;
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onClose: () => void;
  /** Where focus goes when the dialog closes (it has no trigger for Radix to return to). */
  onReturnFocus: () => void;
  /** Focused when the dialog opens; the dialog itself when absent. */
  initialFocus?: RefObject<HTMLElement>;
  /** Left of the footer buttons (for example how many files are chosen). */
  footerNote?: ReactNode;
  children: ReactNode;
}

export function DestinationFrame({
  testId,
  icon: Icon,
  title,
  description,
  size = 'md',
  batch,
  progressVerb = 'Sending',
  confirmLabel,
  confirmTestId,
  confirmDisabled = false,
  onConfirm,
  onClose,
  onReturnFocus,
  initialFocus,
  footerNote,
  children,
}: DestinationFrameProps) {
  const content = useRef<HTMLDivElement>(null);
  const stopButton = useRef<HTMLButtonElement>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);
  const busy = batch?.busy ?? false;
  const progress = batch?.progress ?? null;
  const percent = progress && progress.total > 0 ? Math.min(100, Math.round((progress.done / progress.total) * 100)) : 0;

  // The buttons change when a batch starts and ends: keep focus on a control, never on the body.
  const wasBusy = useRef(busy);
  useEffect(() => {
    if (busy && !wasBusy.current) stopButton.current?.focus();
    if (!busy && wasBusy.current) {
      if (confirmButton.current && !confirmButton.current.disabled) confirmButton.current.focus();
      else content.current?.focus();
    }
    wasBusy.current = busy;
  }, [busy]);

  const message = batch?.message ?? null;
  const progressText =
    batch?.phase === 'stopping'
      ? 'Stopping after this file…'
      : progress && progress.total > 0 && progress.done < progress.total
        ? `${progressVerb} ${progress.done + 1} of ${progress.total}: ${progress.name}`
        : `${progressVerb}…`;

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent
        ref={content}
        data-testid={testId}
        aria-busy={busy || undefined}
        className={cn(
          'flex max-h-[90vh] flex-col gap-0 overflow-hidden p-0 focus:outline-none',
          SIZES[size],
          // The corner close button does nothing while files are being sent: it looks so too.
          busy && '[&>button:last-child]:pointer-events-none [&>button:last-child]:opacity-30',
        )}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          (initialFocus?.current ?? content.current)?.focus();
        }}
        onInteractOutside={(event) => {
          if (busy) event.preventDefault();
        }}
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onReturnFocus();
        }}
      >
        <DialogHeader className="space-y-1 border-b px-6 pb-3.5 pr-12 pt-5 text-left">
          <DialogTitle className="flex items-center gap-2.5 text-base">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10" aria-hidden="true">
              <Icon className="h-4 w-4 text-primary" />
            </span>
            {title}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          <fieldset disabled={busy} className="min-w-0 space-y-4">
            {children}
          </fieldset>
        </div>

        {/* Always present, so each change of file is read out politely while a batch runs. */}
        <p className="sr-only" role="status" aria-live="polite" data-testid="pdf-tools-dest-live">
          {busy ? progressText : ''}
        </p>

        {!busy && message && (
          <div className="border-t px-6 py-2.5">
            <Notice tone="error" icon={AlertCircle} role="alert" testId="pdf-tools-dest-error" title={message.title}>
              {message.description}
            </Notice>
          </div>
        )}

        <DialogFooter className="items-center gap-2 border-t bg-muted/30 px-6 py-3 sm:space-x-0">
          {busy ? (
            <div className="flex w-full items-center gap-4" data-testid="pdf-tools-dest-progress">
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex items-baseline justify-between gap-3 text-xs">
                  <span className="flex min-w-0 items-center gap-1.5 font-medium text-foreground">
                    <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" aria-hidden="true" />
                    <span className="truncate" aria-hidden="true">
                      {progressText}
                    </span>
                  </span>
                  {progress && progress.total > 1 && <span className="shrink-0 tabular-nums text-muted-foreground">{percent}%</span>}
                </div>
                {/* One file cannot show how far it has gone: the bar moves instead of sitting at 0 %. */}
                {progress && progress.total > 1 ? (
                  <Progress value={percent} className="h-2" aria-label={`${title} progress`} />
                ) : (
                  <IndeterminateBar label={`${title} in progress`} />
                )}
              </div>
              {/* aria-disabled, not disabled, while stopping: a disabled button would drop the focus. */}
              <Button
                ref={stopButton}
                type="button"
                variant="outline"
                data-testid="pdf-tools-dest-stop"
                aria-disabled={batch?.phase === 'stopping' ? true : undefined}
                className={cn(batch?.phase === 'stopping' && 'cursor-default opacity-60 hover:bg-background')}
                onClick={() => batch?.phase === 'running' && batch.stop()}
              >
                {batch?.phase === 'stopping' ? 'Stopping…' : 'Stop'}
              </Button>
            </div>
          ) : (
            <>
              {footerNote && <div className="mr-auto min-w-0 text-xs text-muted-foreground">{footerNote}</div>}
              <Button type="button" variant="outline" data-testid="pdf-tools-dest-cancel" onClick={onClose}>
                Cancel
              </Button>
              <Button ref={confirmButton} type="button" data-testid={confirmTestId} disabled={confirmDisabled} onClick={onConfirm}>
                {confirmLabel}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---- the vault form ----------------------------------------------------------------------------

const KIND_ICON = { pdf: FileText, image: ImageIcon } as const;

/** Name(s), evidence type and working-paper reference, with a warning for names the vault already has. */
export function VaultFormFields({
  files,
  state,
  vaultRows,
  engagementId,
  showAlreadyInVault = false,
}: {
  files: readonly WorkingFile[];
  state: VaultFormState;
  vaultRows: readonly VaultFileRow[];
  engagementId: string | null;
  /** In "Add to Evidence Vault": say so when a result is in the vault already (another copy is made). */
  showAlreadyInVault?: boolean;
}) {
  const final = batchNames(files, state.form);
  const one = files.length === 1;
  // When every file of a batch is in the vault already, one notice says so instead of a line each.
  const allInVault = showAlreadyInVault && files.length > 1 && files.every((f) => f.vaultRecord);

  const warnings = (file: WorkingFile) => {
    const name = final[file.id];
    const lines: string[] = [];
    if (showAlreadyInVault && file.vaultRecord) {
      if (!allInVault) lines.push(`Already in the Evidence Vault as ${file.vaultRecord.name}. Adding it again keeps a second copy.`);
    } else if (sameNameInVault(vaultRows, engagementId, name)) {
      lines.push(`A file named ${name} is already in this engagement's Evidence Vault. Both will be kept.`);
    }
    if (name !== vaultName(file, state.form.names[file.id])) lines.push(`Another file in this batch has this name, so this one is saved as ${name}.`);
    return lines;
  };

  const nameInput = (file: WorkingFile, id: string, label?: string) => {
    const lines = warnings(file);
    const typed = state.form.names[file.id] ?? '';
    const cleaned = vaultName(file, typed);
    const hint = lines.length === 0 && typed.trim() !== cleaned ? `Will be saved as ${cleaned}` : null;
    return (
      <div key={file.id} className="space-y-1">
        <Input
          {...describedBy(id, null, lines.length > 0 ? lines[0] : hint)}
          aria-label={label}
          data-testid="pdf-tools-vault-name"
          data-file-id={file.id}
          value={typed}
          maxLength={200}
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => state.setName(file.id, event.target.value)}
          onBlur={() => state.commitName(file)}
        />
        {(lines.length > 0 || hint) && (
          <div id={`${id}-message`} className="space-y-0.5">
            {lines.map((line) => (
              <p key={line} data-testid="pdf-tools-vault-same-name" className="flex items-start gap-1.5 text-xs text-warning">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                {line}
              </p>
            ))}
            {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {one ? (
        <div className="space-y-1.5">
          <FileChip file={files[0]} />
          <Label htmlFor="pdf-tools-vault-name-0" className="block pt-2">
            Name in the Evidence Vault
          </Label>
          {nameInput(files[0], 'pdf-tools-vault-name-0')}
        </div>
      ) : (
        <div className="space-y-1.5">
          {allInVault && (
            <Notice tone="warning" icon={AlertTriangle} title="These results are in the Evidence Vault already">
              Adding them again keeps a second copy of each.
            </Notice>
          )}
          <p className="text-sm font-medium leading-none">Names in the Evidence Vault</p>
          <ol className="max-h-64 space-y-2 overflow-y-auto rounded-md border bg-muted/20 p-2.5">
            {files.map((file, index) => {
              const Kind = KIND_ICON[file.kind];
              return (
                <li key={file.id} className="flex items-start gap-2.5">
                  <span className="mt-2.5 w-5 shrink-0 text-right text-xs tabular-nums text-muted-foreground" aria-hidden="true">
                    {index + 1}
                  </span>
                  <Kind className="mt-3 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <div className="min-w-0 flex-1">{nameInput(file, `pdf-tools-vault-name-${index}`, `Name of file ${index + 1} in the Evidence Vault`)}</div>
                  <span className="mt-2.5 w-14 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{formatBytes(file.size)}</span>
                </li>
              );
            })}
          </ol>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="pdf-tools-vault-type" label="Evidence type">
          <Select value={state.form.fileType} onValueChange={(value) => state.setFileType(value as EvidenceType)}>
            <SelectTrigger id="pdf-tools-vault-type" data-testid="pdf-tools-vault-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EVIDENCE_TYPES.map((type) => (
                <SelectItem key={type.value} value={type.value} data-testid={`pdf-tools-vault-type-${type.value}`}>
                  {type.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field id="pdf-tools-vault-ref" label="Working-paper reference" hint="Optional, for example A.1.1">
          <Input
            {...describedBy('pdf-tools-vault-ref', null, 'Optional')}
            data-testid="pdf-tools-vault-ref"
            value={state.form.workpaperRef}
            maxLength={100}
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => state.setWorkpaperRef(event.target.value)}
          />
        </Field>
      </div>
    </div>
  );
}
