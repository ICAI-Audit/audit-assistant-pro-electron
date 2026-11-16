// The frame every tool dialog shares: title, the files it works on, the signed-file and
// protection notices, the options (disabled while running), messages, and a footer that shows
// Cancel and Run, or progress and Stop while the tool runs (UX audit C6.2: Cancel before a run, Stop
// during it, Keep running in the confirmation). Closing while running asks first.
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { AlertCircle, ChevronRight, FileSignature, Info, Loader2, ShieldCheck, type LucideIcon } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { cn } from '@/lib/utils';
import { forgetMatchedText } from '@/lib/pdf-tools/matchedText';
import type { ToolId, WorkingFile } from '@/lib/pdf-tools/types';
import { viewableFile } from '@/lib/pdf-tools/workingList';
import { elapsedText, formatBytes, plural } from '../format';
import Thumb from '../Thumb';
import HintButton from '../HintButton';
import MiddleName from '../MiddleName';
import { TOOL_ICONS } from '../toolIcons';
import { WHY_LINE_MS, WhyContext } from '../whyLine';
import { toolInfo } from '../toolRules';
import { describedBy, signedWarningText } from './fieldProps';
import { protectionNotice } from './protectionNotice';
import { stopQuestion, stopTitle, type ToolRun, type useResultName } from './useToolRun';
import { useDialogKeys } from '../useDialogKeys';
import { frameEscape, ignoreHeldKey } from '../dialogKeys';
import { focusQuietly } from '../quietFocus';

const SIZES = { md: 'sm:max-w-lg', lg: 'sm:max-w-2xl', xl: 'sm:max-w-3xl', '2xl': 'sm:max-w-4xl' } as const;
/** From this many seconds a run shows how long it has taken. */
const ELAPSED_FROM_S = 10;

// ---- small parts -------------------------------------------------------------------------------

type NoticeTone = 'warning' | 'info' | 'neutral' | 'error';

const NOTICE_TONES: Record<NoticeTone, { box: string; icon: string }> = {
  warning: { box: 'border-warning/40 bg-warning/10', icon: 'text-warning' },
  info: { box: 'border-primary/30 bg-primary/5', icon: 'text-primary' },
  neutral: { box: 'border-border bg-muted/40', icon: 'text-muted-foreground' },
  error: { box: 'border-destructive/40 bg-destructive/5', icon: 'text-destructive' },
};

export function Notice({
  tone,
  icon: Icon = Info,
  title,
  children,
  testId,
  role,
}: {
  tone: NoticeTone;
  icon?: typeof Info;
  title?: ReactNode;
  children?: ReactNode;
  testId?: string;
  role?: 'status' | 'alert';
}) {
  return (
    <div data-testid={testId} role={role} className={cn('flex gap-2.5 rounded-md border px-3 py-2.5 text-sm', NOTICE_TONES[tone].box)}>
      <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', NOTICE_TONES[tone].icon)} aria-hidden="true" />
      <div className="min-w-0 space-y-0.5 text-foreground">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className="text-xs leading-relaxed text-muted-foreground">{children}</div>}
      </div>
    </div>
  );
}

/** A labelled field with a hint, or its error in place of the hint. */
export function Field({
  id,
  label,
  hint,
  error,
  className,
  children,
}: {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn('min-w-0 space-y-1.5', className)}>
      <Label htmlFor={id}>{label}</Label>
      {children}
      {/* An error is inserted as an alert, so it is read out as soon as it appears; the key makes
          sure it is a new element, not the hint changing its role. */}
      {/* The hint's element is never removed when the hint goes (for example "Will be saved as..." when a
          name is cleaned on leaving the field): a node removed while focus moves between fields makes the
          dialog's focus trap pull focus back to the dialog, and Tab stops reaching the next field. */}
      {error ? (
        <p key="error" id={`${id}-message`} role="alert" className="text-xs text-destructive" data-testid="pdf-tools-field-error">
          {error}
        </p>
      ) : (
        <p key="hint" id={`${id}-message`} hidden={!hint} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  );
}

export interface Choice<T extends string> {
  value: T;
  label: string;
  description?: ReactNode;
  badge?: string;
  disabled?: boolean;
}

/** Radio options as cards with a line of explanation each. Arrow keys move between them. */
export function ChoiceCards<T extends string>({
  label,
  value,
  onChange,
  choices,
  columns = 1,
  testIdPrefix,
  compact = false,
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  choices: Choice<T>[];
  columns?: 1 | 2 | 3 | 4;
  testIdPrefix?: string;
  compact?: boolean;
}) {
  const id = useId();
  const grid = { 1: '', 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-3', 4: 'sm:grid-cols-2 lg:grid-cols-4' }[columns];
  return (
    <div className="space-y-1.5">
      <p id={`${id}-label`} className="text-sm font-medium leading-none">
        {label}
      </p>
      <RadioGroup aria-labelledby={`${id}-label`} value={value} onValueChange={(next) => onChange(next as T)} className={cn('grid gap-2', grid)}>
        {choices.map((choice) => {
          const checked = choice.value === value;
          return (
            <Label
              key={choice.value}
              htmlFor={`${id}-${choice.value}`}
              className={cn(
                'flex cursor-pointer items-start gap-2.5 rounded-md border font-normal leading-normal transition-colors',
                compact ? 'px-3 py-2' : 'p-3',
                checked ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-border hover:bg-muted/40',
                choice.disabled && 'cursor-not-allowed opacity-60 hover:bg-transparent',
              )}
            >
              <RadioGroupItem
                id={`${id}-${choice.value}`}
                value={choice.value}
                disabled={choice.disabled}
                className="mt-0.5 shrink-0"
                data-testid={testIdPrefix ? `${testIdPrefix}-${choice.value}` : undefined}
              />
              <span className="min-w-0 space-y-0.5">
                <span className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-foreground">
                  {choice.label}
                  {choice.badge && (
                    <span className="rounded-full border border-primary/30 bg-primary/10 px-1.5 text-[11px] font-medium leading-4 text-foreground">{choice.badge}</span>
                  )}
                </span>
                {choice.description && <span className="block text-xs leading-snug text-muted-foreground">{choice.description}</span>}
              </span>
            </Label>
          );
        })}
      </RadioGroup>
    </div>
  );
}

/**
 * "More options" (UX audit C6.4, principle 4): the choices most runs leave alone, folded under one line
 * that shows their current values, so nothing is hidden silently. It opens while a field inside has a
 * problem, so an error is never inside a closed fold, and stays open once the problem is fixed: closing
 * under the control just used would take that control, and the focus, away (REV-B S1). The one fold for
 * every tool dialog.
 */
export function MoreOptions({
  id,
  summary,
  label = 'More options',
  invalid = false,
  defaultOpen = false,
  children,
}: {
  /** Test id of the line that opens it; its summary is `${id}-summary`, its body `${id}-body`. */
  id: string;
  /** The current values in a few words, shown while it is closed. */
  summary: ReactNode;
  label?: string;
  /** A field inside has a problem: the fold is held open. */
  invalid?: boolean;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  // A problem opens the fold for good; while the problem lasts the fold cannot be closed.
  useEffect(() => {
    if (invalid) setOpen(true);
  }, [invalid]);
  const shown = open || invalid;
  return (
    <Collapsible open={shown} onOpenChange={(next) => setOpen(next || invalid)}>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          data-testid={id}
          aria-expanded={shown}
          className="flex w-full items-start gap-2 rounded-md border border-dashed px-3 py-2 text-left transition-colors ring-offset-background hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <ChevronRight className={cn('mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform', shown && 'rotate-90')} aria-hidden="true" />
          <span className="min-w-0">
            <span className="block text-sm font-medium text-foreground">{label}</span>
            {/* Kept in place (hidden when open, by class: `block` would beat the `hidden` attribute), never
                removed: see Field's note on the focus trap. */}
            <span aria-hidden={shown} className={cn('text-xs leading-snug text-muted-foreground', shown ? 'hidden' : 'block')} data-testid={`${id}-summary`}>
              {summary}
            </span>
          </span>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-4 pt-3" data-testid={`${id}-body`}>
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}

/** The editable result name, cleaned when the field is left. */
export function ResultNameField({
  name,
  label = 'Result name',
  hint,
  id = 'pdf-tools-result-name',
  testId = 'pdf-tools-result-name',
}: {
  name: ReturnType<typeof useResultName>;
  label?: string;
  hint?: ReactNode;
  id?: string;
  testId?: string;
}) {
  const shown = hint ?? (name.resolved !== name.value.trim() ? <>Will be saved as {name.resolved}</> : null);
  return (
    <Field id={id} label={label} hint={shown}>
      <Input
        {...describedBy(id, null, shown)}
        data-testid={testId}
        value={name.value}
        maxLength={200}
        spellCheck={false}
        autoComplete="off"
        onChange={(event) => name.change(event.target.value)}
        onBlur={name.commit}
      />
    </Field>
  );
}

/** The one PDF a single-file tool works on. */
export function FileChip({ file }: { file: WorkingFile }) {
  return (
    <div className="flex items-center gap-3 rounded-md border bg-muted/30 px-3 py-2">
      <Thumb file={viewableFile(file)} width={28} alt="" className="h-9 bg-card" />
      <div className="min-w-0">
        <MiddleName name={file.name} className="text-sm font-medium text-foreground" />
        <p className="text-xs text-muted-foreground">
          {file.pageCount === null ? 'Image' : plural(file.pageCount, 'page')} · {formatBytes(file.size)}
        </p>
      </div>
    </div>
  );
}

/** A bar that moves while the end cannot be measured (also used by the destination dialogs). */
export function IndeterminateBar({ label }: { label: string }) {
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = bar.current;
    if (!element || typeof element.animate !== 'function') return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const animation = element.animate([{ transform: 'translateX(-100%)' }, { transform: 'translateX(260%)' }], {
      duration: 1400,
      iterations: Infinity,
      easing: 'ease-in-out',
    });
    return () => animation.cancel();
  }, []);
  return (
    <div role="progressbar" aria-label={label} aria-busy="true" className="relative h-2 w-full overflow-hidden rounded-full bg-secondary">
      <div ref={bar} className="absolute inset-y-0 left-0 w-2/5 rounded-full bg-primary" />
    </div>
  );
}

// ---- the frame ---------------------------------------------------------------------------------

export interface ToolDialogShellProps<T extends ToolId> {
  tool: T;
  files: WorkingFile[];
  run: ToolRun<T>;
  description: ReactNode;
  size?: keyof typeof SIZES;
  runLabel: string;
  /** Run cannot be pressed: the options are incomplete or invalid. */
  blocked: boolean;
  /**
   * Why Run cannot be pressed (UX audit principle 8). Given, Run stays focusable while blocked and says it
   * on hover, on focus and on a click (tooltip, and a line in the footer); not given, Run is simply
   * disabled, as in phase 1.
   */
  blockedReason?: string | null;
  onRun: () => void;
  onClose: () => void;
  /** Overrides the general signed-file warning (Compress says more). */
  signedWarning?: string;
  /** Shown under the progress bar while running. */
  busyNote?: string;
  /** Show the single PDF the tool works on above the options. */
  showFile?: boolean;
  children: ReactNode;
}

export function ToolDialog<T extends ToolId>({
  tool,
  files,
  run,
  description,
  size = 'md',
  runLabel,
  blocked,
  blockedReason,
  onRun,
  onClose,
  signedWarning,
  busyNote,
  showFile = false,
  children,
}: ToolDialogShellProps<T>) {
  const info = toolInfo(tool);
  const Icon: LucideIcon = TOOL_ICONS[tool as ToolId];
  const [confirmStop, setConfirmStop] = useState(false);
  // A click on a blocked Run (or another unavailable control inside) says why in the footer, for a while.
  const [why, setWhy] = useState<{ text: string; key: number } | null>(null);
  const sayWhy = useCallback((text: string) => setWhy({ text, key: Date.now() }), []);
  useEffect(() => {
    if (!why) return;
    const timer = window.setTimeout(() => setWhy(null), WHY_LINE_MS);
    return () => window.clearTimeout(timer);
  }, [why]);
  // A reason that no longer holds goes at once: Run became available, or its reason changed.
  useEffect(() => {
    setWhy(null);
  }, [blocked, blockedReason]);
  // Closed without a run: the engine forgets the name typed last, which a pattern cleaned (matchedText.ts).
  useEffect(() => () => forgetMatchedText(), []);
  const content = useRef<HTMLDivElement>(null);
  // The application's shortcuts never act behind the dialog, wherever the focus is (useDialogKeys.ts). An
  // Escape that no layer took, because a tooltip (the blocked Run's) was appearing at that moment, is acted on
  // here as the top layer would have: the Stop question closes (Keep running), else the dialog closes or,
  // while a run goes on, asks to stop first.
  const lostEscape = useRef<() => void>(() => undefined);
  useDialogKeys(content, () => lostEscape.current());
  const runButton = useRef<HTMLButtonElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  // The Stop confirmation is opened from state (no trigger), so it returns focus here itself.
  const stopOpener = useRef<HTMLElement | null>(null);
  const busy = run.phase !== 'idle';
  // How long the run has taken, shown after a while so that a long step never looks hung (QA-FIX I).
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!busy) {
      setElapsed(0);
      return;
    }
    const started = Date.now();
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [busy]);
  const signed = files.filter((f) => f.hasSignature);
  const protection = protectionNotice(files);
  const progress = run.progress;
  const measured = progress !== null && progress.total > 0;
  const percent = measured ? Math.min(100, Math.round((progress.done / progress.total) * 100)) : 0;

  // Run disappears when a run starts and Stop disappears when it ends: move focus with them, so it
  // is never left on the page body. A run that ends by closing the dialog returns to the tool button.
  const previousPhase = useRef(run.phase);
  useEffect(() => {
    const before = previousPhase.current;
    previousPhase.current = run.phase;
    if (run.phase === 'running' && before === 'idle') cancelButton.current?.focus();
    if (run.phase === 'idle' && before !== 'idle') {
      setConfirmStop(false);
      // The Stop question is on screen or still closing (its exit animation keeps the rest of the page
      // aria-hidden): focusing Run now would put the focus inside a hidden tree, which Chromium blocks and
      // warns about. The question's own onCloseAutoFocus puts the focus on Run once it has gone.
      if (stopOpener.current) return;
      if (runButton.current && !runButton.current.disabled) runButton.current.focus();
      else content.current?.focus();
    }
  }, [run.phase]);

  // Every way of stopping a running tool asks first; only the confirmation's Stop ends the run.
  // The footer's Stop holds focus for the whole run, so one stray Enter or Space must not throw away minutes of
  // work. Stopping from the footer's Stop keeps the dialog open; from Escape or the close button it closes it.
  const stopCloses = useRef(true);
  const askToStop = (thenClose: boolean) => {
    stopOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    stopCloses.current = thenClose;
    setConfirmStop(true);
  };

  const requestClose = () => {
    if (run.phase === 'running') askToStop(true);
    else if (run.phase === 'idle') onClose();
  };
  lostEscape.current = () => {
    if (confirmStop) setConfirmStop(false);
    else requestClose();
  };

  return (
    // Inside the dialog, an unavailable control's reason goes to the footer line, not the screen's (behind the dialog).
    <WhyContext.Provider value={sayWhy}>
    <Dialog open onOpenChange={(open) => !open && requestClose()}>
      <DialogContent
        ref={content}
        data-testid="pdf-tools-dialog"
        data-tool={tool}
        className={cn('flex max-h-[90vh] flex-col gap-0 overflow-hidden p-0 focus:outline-none', SIZES[size])}
        onOpenAutoFocus={(event) => {
          // Focus the dialog itself: its title is read out and Tab reaches the first option. Focusing
          // the first field instead would open with that field's text selected.
          event.preventDefault();
          content.current?.focus();
        }}
        onInteractOutside={(event) => {
          if (busy) event.preventDefault();
        }}
        onEscapeKeyDown={(event) => {
          // The Stop question first, even while it is still appearing (dialogKeys.ts frameEscape).
          const what = frameEscape({ stopQuestionOpen: confirmStop, phase: run.phase });
          if (what === 'close') return;
          event.preventDefault();
          if (what === 'keep-running') setConfirmStop(false);
          else if (what === 'ask-to-stop') askToStop(true);
        }}
        onCloseAutoFocus={(event) => {
          // Back to the tool's button, without scrolling away from results just revealed in the list, and
          // without its tooltip: after a run the tool may be unavailable for the results now selected, and
          // its reason must not sit over the success message (QA-FIX F).
          event.preventDefault();
          focusQuietly(document.querySelector<HTMLElement>(`[data-testid="pdf-tools-tool-${tool}"]`), { preventScroll: true });
        }}
      >
        <DialogHeader className="space-y-1 border-b px-6 pb-3.5 pr-12 pt-5 text-left">
          <DialogTitle className="flex items-center gap-2.5 text-base">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10" aria-hidden="true">
              <Icon className="h-4 w-4 text-primary" />
            </span>
            {info.label}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4">
          {showFile && files.length === 1 && <FileChip file={files[0]} />}
          {signed.length > 0 && (
            <Notice tone="warning" icon={FileSignature} title="Digital signature" testId="pdf-tools-signed-warning">
              {signedWarning ?? signedWarningText(files)}
            </Notice>
          )}
          {protection && (
            <Notice tone="info" icon={ShieldCheck} title={protection.title} testId="pdf-tools-protection-notice">
              {protection.text}
            </Notice>
          )}
          <fieldset disabled={busy} className="min-w-0 space-y-4">
            {children}
          </fieldset>
        </div>

        {!busy && (run.error || run.notice) && (
          <div className="border-t px-6 py-2.5">
            {run.error ? (
              <Notice tone="error" icon={AlertCircle} role="alert" testId="pdf-tools-dialog-error" title={run.error} />
            ) : (
              <Notice tone="neutral" role="status" testId="pdf-tools-dialog-notice" title={run.notice!.title}>
                {run.notice!.detail}
              </Notice>
            )}
          </div>
        )}

        <DialogFooter className="items-center gap-2 border-t bg-muted/30 px-6 py-3 sm:space-x-0">
          {busy ? (
            <div className="flex w-full items-center gap-4" data-testid="pdf-tools-progress" data-phase={run.phase}>
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex items-baseline justify-between gap-3 text-xs">
                  <span className="flex min-w-0 items-center gap-1.5 font-medium text-foreground">
                    <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" aria-hidden="true" />
                    <span className="truncate">{progress?.label ?? 'Working…'}</span>
                  </span>
                  <span className="flex shrink-0 items-baseline gap-2 tabular-nums text-muted-foreground">
                    {elapsed >= ELAPSED_FROM_S && <span data-testid="pdf-tools-run-elapsed">{elapsedText(elapsed)}</span>}
                    {measured && <span>{percent}%</span>}
                  </span>
                </div>
                {measured ? <Progress value={percent} className="h-2" aria-label={`${info.label} progress`} /> : <IndeterminateBar label={`${info.label} in progress`} />}
                {busyNote && <p className="text-[11px] text-muted-foreground">{busyNote}</p>}
              </div>
              {/* aria-disabled, not disabled, while stopping: a disabled button would drop the focus. */}
              <Button
                ref={cancelButton}
                type="button"
                variant="outline"
                data-testid="pdf-tools-cancel-run"
                aria-disabled={run.phase === 'stopping' ? true : undefined}
                className={cn(run.phase === 'stopping' && 'cursor-default opacity-60 hover:bg-background')}
                onKeyDown={ignoreHeldKey}
                onClick={() => {
                  if (run.phase === 'running') askToStop(false);
                }}
              >
                {run.phase === 'stopping' ? 'Stopping…' : 'Stop'}
              </Button>
            </div>
          ) : (
            <>
              {/* Always present, so it is read out when it changes; empty, it takes no room. */}
              <p role="status" aria-live="polite" data-testid="pdf-tools-dialog-why" className={cn(why ? 'mr-auto min-w-0 text-xs text-foreground' : 'sr-only')}>
                {why?.text ?? ''}
              </p>
              <Button type="button" variant="outline" data-testid="pdf-tools-dialog-cancel" onClick={onClose}>
                Cancel
              </Button>
              {blockedReason !== undefined ? (
                <HintButton
                  ref={runButton}
                  type="button"
                  data-testid="pdf-tools-run"
                  enabled={!blocked}
                  hint={blocked ? (blockedReason ?? undefined) : undefined}
                  onKeyDown={ignoreHeldKey}
                  onClick={onRun}
                >
                  <Icon />
                  {runLabel}
                </HintButton>
              ) : (
                <Button ref={runButton} type="button" data-testid="pdf-tools-run" disabled={blocked} onKeyDown={ignoreHeldKey} onClick={onRun}>
                  <Icon />
                  {runLabel}
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>

      <AlertDialog open={confirmStop} onOpenChange={setConfirmStop}>
        <AlertDialogContent
          data-testid="pdf-tools-stop-confirm"
          onCloseAutoFocus={(event) => {
            // No trigger for Radix to return to: back to the control that asked (Stop, the close
            // button), else Stop, else Run (the run ended while this was closing: Stop from the footer
            // keeps the dialog open), else the dialog itself, so focus stays in the tool's dialog.
            event.preventDefault();
            const back = stopOpener.current;
            stopOpener.current = null;
            for (const target of [back, cancelButton.current, runButton.current, content.current]) {
              if (!target?.isConnected || (target instanceof HTMLButtonElement && target.disabled)) continue;
              target.focus();
              if (document.activeElement === target) return;
            }
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>{stopTitle(tool)}</AlertDialogTitle>
            <AlertDialogDescription>{stopQuestion(tool)}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onKeyDown={ignoreHeldKey}>Keep running</AlertDialogCancel>
            <AlertDialogAction data-testid="pdf-tools-stop-confirm-yes" onKeyDown={ignoreHeldKey} onClick={() => run.stop(stopCloses.current)}>
              Stop
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
    </WhyContext.Provider>
  );
}
