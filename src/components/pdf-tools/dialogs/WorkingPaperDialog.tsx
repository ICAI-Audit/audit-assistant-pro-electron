import { useEffect, useMemo, useState } from 'react';
import { Archive, Lock, Paperclip } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuditExecutionSections, useWorkingSectionBoxes } from '@/hooks/useAuditExecution';
import { cn } from '@/lib/utils';
import type { WorkingFile } from '@/lib/pdf-tools/types';
import { boxOptions, sectionOptions, type AttachTarget, type BatchOptions, type BatchResult, type SummaryToast, type TargetOption, type VaultForm } from '../destinations';
import { plural } from '../format';
import type { VaultFileRow } from '../vaultBytes';
import { DestinationFrame, VaultFormFields } from './DestinationFrame';
import { FileChip, Notice } from './ToolDialog';
import { useBatchRun, useVaultForm } from './useDestinationDialog';

export interface ProgrammeChoice {
  id: string;
  name: string;
  workpaper_reference: string | null;
}

export interface WorkingPaperDialogProps {
  /** The selected results, in list order. */
  files: WorkingFile[];
  leftOut: number;
  /** This engagement's audit programmes (at least one: the button is unavailable otherwise). */
  programmes: ProgrammeChoice[];
  vaultRows: readonly VaultFileRow[];
  engagementId: string | null;
  /** Starts the batch from the confirm click (the scope is captured there); null when it may not run. */
  run: (form: VaultForm | null, target: AttachTarget, options: BatchOptions) => Promise<BatchResult> | null;
  onFinished: (result: BatchResult, target: AttachTarget) => SummaryToast | null;
  onClose: () => void;
  onReturnFocus: () => void;
}

const WHOLE_PROGRAMME = '__programme__';
const WHOLE_SECTION = '__section__';

function TargetSelect({
  className,
  id,
  label,
  value,
  onChange,
  placeholder,
  wholeValue,
  wholeLabel,
  options,
  loading,
  disabled,
  testId,
}: {
  className?: string;
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  wholeValue?: string;
  wholeLabel?: string;
  options: TargetOption[];
  loading?: boolean;
  disabled?: boolean;
  testId: string;
}) {
  return (
    <div className={cn('min-w-0 space-y-1.5', className)}>
      <Label htmlFor={id}>{label}</Label>
      {/* Always controlled: '' shows the placeholder. */}
      <Select value={value} onValueChange={onChange} disabled={disabled || loading}>
        <SelectTrigger id={id} data-testid={testId}>
          <SelectValue placeholder={loading ? 'Loading…' : placeholder} />
        </SelectTrigger>
        <SelectContent>
          {wholeValue && (
            <SelectItem value={wholeValue} data-testid="pdf-tools-wp-option" data-locked="false">
              {wholeLabel}
            </SelectItem>
          )}
          {options.map((option) => (
            // Plain text, so that the chosen one is cut to one line in the box. A locked one can never be chosen.
            <SelectItem key={option.id} value={option.id} disabled={option.locked} data-testid="pdf-tools-wp-option" data-locked={option.locked ? 'true' : 'false'}>
              {option.locked ? (
                <>
                  <Lock className="mr-1.5 inline h-3 w-3 align-[-1px] text-muted-foreground" aria-hidden="true" />
                  {option.label}
                </>
              ) : (
                option.label
              )}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/**
 * Attach to working paper: programme, then optionally a section, then optionally a box. Results not
 * yet in the Evidence Vault are added there first (an attachment always points at a vault file);
 * a result already in the vault is attached from its one record. Locked sections and boxes are
 * listed but cannot be chosen.
 */
export default function WorkingPaperDialog({ files, leftOut, programmes, vaultRows, engagementId, run, onFinished, onClose, onReturnFocus }: WorkingPaperDialogProps) {
  const needVault = useMemo(() => files.filter((f) => !f.vaultRecord), [files]);
  const inVault = files.length - needVault.length;
  const state = useVaultForm(needVault);
  const batch = useBatchRun();
  const [programId, setProgramId] = useState(programmes.length === 1 ? programmes[0].id : '');
  const [sectionId, setSectionId] = useState(WHOLE_PROGRAMME);
  const [boxId, setBoxId] = useState(WHOLE_SECTION);

  const programme = programmes.find((p) => p.id === programId) ?? null;
  const { sections, loading: sectionsLoading } = useAuditExecutionSections(programme?.id ?? null);
  const realSection = sectionId !== WHOLE_PROGRAMME ? sectionId : null;
  const { boxes, loading: boxesLoading } = useWorkingSectionBoxes(realSection);
  // The hooks keep the previous programme's or section's rows until the new ones arrive.
  const sectionChoices = useMemo(() => sectionOptions(sections.filter((s) => s.audit_program_id === programId)), [sections, programId]);
  const boxChoices = useMemo(() => boxOptions(boxes.filter((b) => b.section_id === realSection)), [boxes, realSection]);
  const section = sectionChoices.find((s) => s.id === realSection) ?? null;
  const realBox = boxId !== WHOLE_SECTION ? boxId : null;
  const box = boxChoices.find((b) => b.id === realBox) ?? null;

  // The programme's own working-paper reference is a sensible default for the vault records.
  const { suggestRef } = state;
  useEffect(() => {
    if (programme?.workpaper_reference) suggestRef(programme.workpaper_reference);
  }, [programme, suggestRef]);

  const chooseProgramme = (id: string) => {
    setProgramId(id);
    setSectionId(WHOLE_PROGRAMME);
    setBoxId(WHOLE_SECTION);
  };
  const chooseSection = (id: string) => {
    setSectionId(id);
    setBoxId(WHOLE_SECTION);
  };

  // A section or box that turns out locked (or gone) when its list arrives is not kept.
  const blocked = !programme || (realSection !== null && (!section || section.locked)) || (realBox !== null && (!box || box.locked));
  const target: AttachTarget | null = programme
    ? {
        programId: programme.id,
        programName: programme.name,
        sectionId: section && !section.locked ? section.id : null,
        sectionName: section ? section.name : undefined,
        boxId: section && box && !box.locked ? box.id : null,
        boxHeader: box ? box.name : undefined,
      }
    : null;

  const count = files.length;
  const confirmLabel = needVault.length > 0 ? (count > 1 ? `Add to Evidence Vault and attach ${count}` : 'Add to Evidence Vault and attach') : count > 1 ? `Attach ${count} files` : 'Attach';

  return (
    <DestinationFrame
      testId="pdf-tools-wp-dialog"
      icon={Paperclip}
      title="Attach to working paper"
      description={
        <>
          {count > 1 ? `${plural(count, 'result')} are` : 'The result is'} attached to an Audit Execution programme, or to one of its sections or boxes. An
          attachment always points at an Evidence Vault file.
        </>
      }
      size="lg"
      batch={batch}
      progressVerb="Attaching"
      confirmLabel={confirmLabel}
      confirmTestId="pdf-tools-wp-confirm"
      confirmDisabled={blocked}
      onConfirm={() => {
        if (!target || blocked) return;
        batch.start((options) => run(needVault.length > 0 ? state.form : null, target, options), (result) => onFinished(result, target));
      }}
      onClose={onClose}
      onReturnFocus={onReturnFocus}
    >
      {leftOut > 0 && (
        <Notice tone="neutral" title={`${plural(leftOut, 'selected file')} ${leftOut === 1 ? 'is' : 'are'} left out`}>
          Only results made by a tool are attached from here. Files from your computer or the Evidence Vault are attached in Audit Execution.
        </Notice>
      )}

      {needVault.length > 0 && (
        <section aria-labelledby="pdf-tools-wp-vault-heading" className="space-y-3">
          <h3 id="pdf-tools-wp-vault-heading" className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground" aria-hidden="true">
              1
            </span>
            Add to the Evidence Vault first
          </h3>
          {inVault > 0 && (
            <p className="text-xs text-muted-foreground">
              {plural(inVault, 'other result')} {inVault === 1 ? 'is' : 'are'} in the Evidence Vault already and {inVault === 1 ? 'is' : 'are'} attached from there, with no
              second copy.
            </p>
          )}
          <VaultFormFields files={needVault} state={state} vaultRows={vaultRows} engagementId={engagementId} />
        </section>
      )}

      {needVault.length === 0 && (
        <div className="space-y-2.5">
          {count === 1 && <FileChip file={files[0]} />}
          <Notice tone="info" icon={Archive} title={count > 1 ? `All ${count} are in the Evidence Vault already` : `Already in the Evidence Vault as ${files[0].vaultRecord?.name}`}>
            {count > 1 ? 'They are' : 'It is'} attached from {count > 1 ? 'their' : 'its'} Evidence Vault record. No second copy is uploaded.
          </Notice>
          {count > 1 && (
            <ul aria-label="Results to attach" className="max-h-40 divide-y overflow-y-auto rounded-md border bg-muted/20 text-sm">
              {files.map((file) => (
                <li key={file.id} className="flex items-center gap-2 px-3 py-1.5">
                  <Archive className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate" title={file.vaultRecord?.name}>
                    {file.vaultRecord?.name}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <section aria-labelledby="pdf-tools-wp-target-heading" className="space-y-3">
        <h3 id="pdf-tools-wp-target-heading" className="flex items-center gap-2 text-sm font-semibold text-foreground">
          {needVault.length > 0 && (
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground" aria-hidden="true">
              2
            </span>
          )}
          Where to attach
        </h3>
        <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
          <TargetSelect
            className="sm:col-span-2"
            id="pdf-tools-wp-programme"
            testId="pdf-tools-wp-programme"
            label="Programme"
            value={programId}
            onChange={chooseProgramme}
            placeholder="Choose a programme"
            options={programmes.map((p) => ({ id: p.id, name: p.name, label: p.name, locked: false }))}
          />
          <TargetSelect
            id="pdf-tools-wp-section"
            testId="pdf-tools-wp-section"
            label="Section (optional)"
            value={sectionId}
            onChange={chooseSection}
            placeholder="Whole programme"
            wholeValue={WHOLE_PROGRAMME}
            wholeLabel="Whole programme"
            options={sectionChoices}
            loading={Boolean(programme) && sectionsLoading}
            disabled={!programme}
          />
          <TargetSelect
            id="pdf-tools-wp-box"
            testId="pdf-tools-wp-box"
            label="Box (optional)"
            value={boxId}
            onChange={setBoxId}
            placeholder="Whole section"
            wholeValue={WHOLE_SECTION}
            wholeLabel="Whole section"
            options={boxChoices}
            loading={realSection !== null && boxesLoading}
            disabled={realSection === null}
          />
        </div>
        <p className="text-xs text-muted-foreground">Locked sections and boxes are shown but cannot be chosen. Unlock them in Audit Execution first.</p>
      </section>
    </DestinationFrame>
  );
}
