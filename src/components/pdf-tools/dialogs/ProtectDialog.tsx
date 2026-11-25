// Protect with password (design 5.18; plan Task B5): a copy of one PDF that opens only with a password.
//
// Two decisions in view, the password typed twice (one Show button for both), with the library's own
// messages at the fields as the user types (protect/protectForm.ts), a plain strength hint, the
// library's warnings (spaces at either end, characters not on an English keyboard), and a calm warning
// that a forgotten password cannot be recovered. The result name is under "More options" (ux-audit E4).
// A file marked PDF/A is said so before the run when its bytes show it (protect/archivalClaim.ts); the
// run's report says so in any case. A file over the size cap is refused here in the library's words.
//
// The password lives only in this component's state while the dialog is open. It goes to the run once
// (protectRun.ts, which hands it to the library and never records it) and is cleared when the run ends
// in any way; closing the dialog, a change of engagement or user, or a result (the screen closes the
// dialog) unmount it. It is never logged, put in a message, a toast, an error, a prop that outlives the
// dialog, or the record.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { AlertCircle, AlertTriangle, Archive, Eye, EyeOff, Info, KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { NO_LONGER_ARCHIVAL_NOTE, PROTECT_MAX_BYTES } from '@/lib/pdf-tools/protect';
import { defaultResultName } from '@/lib/pdf-tools/resultNames';
import { scanForPdfA } from '../protect/archivalClaim';
import {
  blockedReason,
  busyNote,
  fieldMessages,
  FORGOTTEN_WARNING,
  liveWarnings,
  SIGNED_WARNING,
  strengthHint,
  tooLargeMessage,
  WAS_PROTECTED_NOTE,
  type StrengthHint,
} from '../protect/protectForm';
import { describedBy, INVALID_INPUT } from './fieldProps';
import { fieldRef, wipeFields } from './secretFields';
import { Field, MoreOptions, Notice, ToolDialog } from './ToolDialog';
import { useResultName, useToolRun, type ToolDialogProps } from './useToolRun';

const PASSWORD_ID = 'pdf-tools-protect-password';
const CONFIRM_ID = 'pdf-tools-protect-confirm';
const STRENGTH_ID = 'pdf-tools-protect-strength';
const WARNINGS_ID = 'pdf-tools-protect-password-warnings';

const METER: Record<StrengthHint['level'], string> = {
  weak: 'bg-muted-foreground/70',
  fair: 'bg-primary/70',
  strong: 'bg-success',
};

/** The hint or the error under a field (an error is a new alert element, so it is read out as it appears). */
function FieldMessage({ id, error, hint, testId }: { id: string; error: string | null; hint: string | null; testId?: string }) {
  if (error) {
    return (
      <p key="error" id={`${id}-message`} role="alert" className="text-xs text-destructive" data-testid="pdf-tools-field-error">
        {error}
      </p>
    );
  }
  if (!hint) return null;
  return (
    <p key="hint" id={`${id}-message`} className="text-xs text-muted-foreground" data-testid={testId}>
      {hint}
    </p>
  );
}

/**
 * The result name (ToolDialog's ResultNameField, with the clean-up done after the focus has moved: done
 * during the blur, its "Will be saved as" hint going away would send Tab to the dialog; see `leave`).
 */
function NameField({ name }: { name: ReturnType<typeof useResultName> }) {
  const id = 'pdf-tools-result-name';
  const hint = name.resolved !== name.value.trim() ? `Will be saved as ${name.resolved}` : null;
  return (
    <Field id={id} label="Result name" hint={hint}>
      <Input
        {...describedBy(id, null, hint)}
        data-testid="pdf-tools-result-name"
        value={name.value}
        maxLength={200}
        spellCheck={false}
        autoComplete="off"
        onChange={(event) => name.change(event.target.value)}
        onBlur={() => window.setTimeout(name.commit, 0)}
      />
    </Field>
  );
}

export default function ProtectDialog(props: ToolDialogProps) {
  const { files, onClose } = props;
  const file = files[0];
  const run = useToolRun('protect', props);
  const busy = run.phase !== 'idle';
  const name = useResultName(defaultResultName('protect', file.name));

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [left, setLeft] = useState({ password: false, confirm: false });
  const [shown, setShown] = useState(false);
  const passwordInput = useRef<HTMLInputElement | null>(null);

  // When the dialog goes, the password must go with it. React DOM keeps the last focused text field and
  // its fiber (its select-event tracking) until the next focusout, and a field removed while focused
  // (Enter to run, Escape, a change of engagement) never gets one. Seen in heap snapshots in the drive:
  // the detached field held the password in its value and value attribute, and the fiber's `ref` (which
  // React does not clear) led to this dialog's state. So the fields are wiped as they leave, and their
  // refs are made outside this component (fieldRef), so they hold the field nodes only.
  const [refs] = useState(() => {
    const nodes = new Set<HTMLInputElement>();
    return { nodes, password: fieldRef(nodes, passwordInput), confirm: fieldRef(nodes) };
  });
  useLayoutEffect(() => {
    const { nodes } = refs;
    return () => wipeFields(nodes);
  }, [refs]);

  const tooLarge = file.size > PROTECT_MAX_BYTES;
  const fields = { password, confirm, passwordLeft: left.password, confirmLeft: left.confirm };
  const messages = fieldMessages(fields);
  const blocked = blockedReason(file, fields);
  const strength = strengthHint(password);
  const warnings = liveWarnings(password);

  // The frame's "Protection removed: the result will not have a password" is untrue here: this result
  // gets a new password. A file that came in with one is told in this dialog's own words instead.
  const frameFiles = useMemo(() => files.map((f) => (f.wasProtected ? { ...f, wasProtected: false } : f)), [files]);

  // PDF/A, said before the run when the bytes show it; scanned in slices, so a large file never holds the dialog.
  const [archival, setArchival] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void scanForPdfA(file.bytes, controller.signal).then((found) => {
      if (found) setArchival(true);
    });
    return () => controller.abort();
  }, [file.bytes]);

  // Clearing the state alone leaves the password in React's previous copy of each field (its alternate
  // fiber's props) until the next keystroke. So the fields themselves are emptied and then rebuilt under
  // a new key: React drops a removed field's props, and the fresh fields have never held the password.
  const [generation, setGeneration] = useState(0);
  const clearPasswords = useCallback(() => {
    wipeFields(refs.nodes);
    refs.nodes.clear();
    setGeneration((g) => g + 1);
    setPassword('');
    setConfirm('');
    setLeft({ password: false, confirm: false });
    setShown(false);
  }, [refs]);

  // The password goes when the run ends in any way that keeps the dialog open (an error, a stop, nothing
  // made); focus then waits in the password field for the next attempt.
  const previousPhase = useRef(run.phase);
  useEffect(() => {
    const before = previousPhase.current;
    previousPhase.current = run.phase;
    if (run.phase !== 'idle' || before === 'idle') return;
    clearPasswords();
    const toField = () => passwordInput.current?.focus();
    const frame = requestAnimationFrame(toField);
    // A Stop confirmation closing a moment later hands focus back to Run (waiting now, the fields being
    // empty) or to the dialog itself (ToolDialog): take it on to the field.
    const dialog = passwordInput.current?.closest<HTMLElement>('[role="dialog"]') ?? null;
    const onDialogFocus = (event: FocusEvent) => {
      const target = event.target as HTMLElement | null;
      if (target === dialog || target?.dataset.testid === 'pdf-tools-run') toField();
    };
    dialog?.addEventListener('focusin', onDialogFocus);
    const timer = window.setTimeout(() => dialog?.removeEventListener('focusin', onDialogFocus), 1500);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
      dialog?.removeEventListener('focusin', onDialogFocus);
    };
  }, [run.phase, clearPasswords]);

  const start = () => {
    if (blocked !== null || busy) return;
    run.start({ password, name: name.resolved });
  };

  // A field left: its "too short" hint becomes an error. Done after the focus has moved, never during the
  // blur: Radix's focus trap moves focus to the dialog when a node inside it is removed while nothing has
  // focus, which is the moment of a blur, and Tab would then land on the dialog instead of the next field.
  const leave = (field: 'password' | 'confirm') => {
    window.setTimeout(() => setLeft((l) => (l[field] ? l : { ...l, [field]: true })), 0);
  };

  // A message from an earlier run goes once the user types again.
  const type = (setter: (value: string) => void, value: string) => {
    setter(value);
    if (run.error || run.notice) run.clearMessages();
  };

  // Enter in either field runs, once the two agree (a held key does not repeat it).
  const onEnter = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (!event.repeat) start();
  };

  const describe = (...ids: (string | false)[]) => ids.filter(Boolean).join(' ') || undefined;
  const inputProps = {
    type: shown ? 'text' : 'password',
    autoComplete: shown ? 'off' : 'new-password',
    autoCorrect: 'off',
    autoCapitalize: 'off',
    spellCheck: false,
    disabled: tooLarge,
    onKeyDown: onEnter,
  } as const;

  return (
    <ToolDialog
      tool="protect"
      files={frameFiles}
      run={run}
      size="lg"
      showFile
      description="Make a copy of this PDF that opens only with a password; without it, only the number and size of its pages can be seen. The original is not changed."
      signedWarning={SIGNED_WARNING}
      runLabel="Make protected copy"
      blocked={blocked !== null}
      blockedReason={blocked}
      busyNote={busyNote(file.size)}
      onRun={start}
      onClose={onClose}
    >
      {tooLarge && (
        <Notice tone="error" icon={AlertCircle} title="Too large to protect" testId="pdf-tools-protect-too-large">
          {tooLargeMessage()}
        </Notice>
      )}
      {archival && (
        <Notice tone="neutral" icon={Archive} title="The copy cannot be PDF/A" testId="pdf-tools-protect-archival">
          {NO_LONGER_ARCHIVAL_NOTE}
        </Notice>
      )}
      {file.wasProtected && (
        <p className="flex gap-1.5 text-xs leading-relaxed text-muted-foreground" data-testid="pdf-tools-protect-was-protected">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {WAS_PROTECTED_NOTE}
        </p>
      )}

      <div className="space-y-2">
        <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2 sm:items-start">
          <div className="min-w-0 space-y-1.5">
            <Label htmlFor={PASSWORD_ID}>Password</Label>
            <div className="relative">
              <Input
                {...inputProps}
                key={`password-${generation}`}
                id={PASSWORD_ID}
                ref={refs.password}
                data-testid="pdf-tools-protect-password"
                className={cn('pr-20', INVALID_INPUT)}
                value={password}
                aria-invalid={messages.passwordError ? true : undefined}
                aria-describedby={describe((messages.passwordError || messages.passwordHint) && `${PASSWORD_ID}-message`, strength !== null && STRENGTH_ID, warnings.length > 0 && WARNINGS_ID)}
                onChange={(event) => type(setPassword, event.target.value)}
                onBlur={() => password !== '' && leave('password')}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                data-testid="pdf-tools-protect-show"
                data-state={shown ? 'shown' : 'hidden'}
                aria-label={shown ? 'Hide passwords' : 'Show passwords'}
                aria-controls={`${PASSWORD_ID} ${CONFIRM_ID}`}
                disabled={tooLarge}
                className="absolute right-1 top-1/2 h-8 -translate-y-1/2 gap-1.5 px-2.5 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => setShown((s) => !s)}
              >
                {shown ? <EyeOff className="h-3.5 w-3.5" aria-hidden="true" /> : <Eye className="h-3.5 w-3.5" aria-hidden="true" />}
                {shown ? 'Hide' : 'Show'}
              </Button>
            </div>
            <FieldMessage id={PASSWORD_ID} error={messages.passwordError} hint={messages.passwordHint} testId="pdf-tools-protect-password-hint" />
          </div>

          <div className="min-w-0 space-y-1.5">
            <Label htmlFor={CONFIRM_ID}>Type it again</Label>
            <Input
              {...inputProps}
              key={`confirm-${generation}`}
              id={CONFIRM_ID}
              ref={refs.confirm}
              data-testid="pdf-tools-protect-confirm"
              className={INVALID_INPUT}
              value={confirm}
              aria-invalid={messages.confirmError ? true : undefined}
              aria-describedby={messages.confirmError || messages.confirmHint ? `${CONFIRM_ID}-message` : undefined}
              onChange={(event) => type(setConfirm, event.target.value)}
              onBlur={() => confirm !== '' && leave('confirm')}
            />
            <FieldMessage id={CONFIRM_ID} error={messages.confirmError} hint={messages.confirmHint} testId="pdf-tools-protect-confirm-hint" />
          </div>
        </div>

        {strength && (
          <div className="flex items-center gap-2.5" data-testid="pdf-tools-protect-strength" data-level={strength.level}>
            <span className="flex shrink-0 gap-1" aria-hidden="true">
              {[1, 2, 3].map((segment) => (
                <span key={segment} className={cn('h-1.5 w-7 rounded-full', segment <= strength.filled ? METER[strength.level] : 'bg-muted')} />
              ))}
            </span>
            <p id={STRENGTH_ID} className="text-xs text-muted-foreground">
              {strength.text}
            </p>
          </div>
        )}
        <div id={WARNINGS_ID} role="status" aria-live="polite" data-testid="pdf-tools-protect-password-warnings" className={cn(warnings.length > 0 && 'space-y-1 pt-0.5')}>
          {warnings.map((warning) => (
            <p key={warning} className="flex gap-1.5 text-xs leading-relaxed text-foreground">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" aria-hidden="true" />
              {warning}
            </p>
          ))}
        </div>
      </div>

      <Notice tone="neutral" icon={KeyRound} title="Keep the password safe" testId="pdf-tools-protect-warning">
        {FORGOTTEN_WARNING}
      </Notice>

      <MoreOptions id="pdf-tools-protect-more" summary={<>Result name: {name.resolved}</>}>
        <NameField name={name} />
      </MoreOptions>
    </ToolDialog>
  );
}
