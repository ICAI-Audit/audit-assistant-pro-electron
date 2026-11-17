import { useEffect, useRef, useState, type FormEvent } from 'react';
import { KeyRound, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { unlockPdf } from '@/lib/pdf-tools/unlock';
import { PdfToolsError } from '@/lib/pdf-tools/types';
import { nextPaint } from '../canvasUtils';
import type { PasswordAnswer, PasswordRequest } from '../useFileIntake';
import { useDialogKeys } from '../useDialogKeys';
import { fieldRef, useSecretFields } from './secretFields';

interface PasswordDialogProps {
  request: PasswordRequest;
  onAnswer: (answer: PasswordAnswer) => void;
  /**
   * Called on close when the control focused before the dialog opened has gone (the first file
   * arrived meanwhile and the empty area with its buttons was replaced), so focus is not left on
   * the page body.
   */
  onFocusLost?: () => void;
}

/**
 * Asks for the password of one protected PDF and opens it. The password lives only in this
 * component's state: it goes once to unlockPdf, and is cleared after every attempt and when the
 * dialog closes (it is mounted per file). It is never logged or shown. As in Protect with password
 * (secretFields.ts), clearing the state is not enough: the field itself is wiped as it leaves, and on
 * every attempt and on Skip it is wiped and rebuilt under a new key, so neither the detached field nor
 * React's previous copy of it keeps the password.
 */
export default function PasswordDialog({ request, onAnswer, onFocusLost }: PasswordDialogProps) {
  const [password, setPassword] = useState('');
  const [attempts, setAttempts] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const field = useSecretFields();
  // Made once, outside this component's scope (fieldRef): the field's ref holds the node only.
  const [passwordRef] = useState(() => fieldRef(field.nodes, inputRef));
  const mounted = useRef(true);
  const content = useRef<HTMLDivElement>(null);
  // The application's shortcuts never act behind it (useDialogKeys.ts); an Escape no layer took skips, as Escape does.
  useDialogKeys(content, () => {
    if (!busy) skip();
  });
  // Taken on the first render, before the dialog moves focus into itself.
  const [opener] = useState(() => (document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null));

  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  // After a wrong password the field (made afresh, and enabled again only by this render) takes the focus for
  // the next try. Done once the render is committed: the field is still disabled before it.
  const wasBusy = useRef(false);
  useEffect(() => {
    if (wasBusy.current && !busy) inputRef.current?.focus();
    wasBusy.current = busy;
  }, [busy]);

  /** The password goes from the state and from the field, which is made afresh. */
  const clearPassword = () => {
    field.clear();
    setPassword('');
  };

  const skip = () => {
    clearPassword();
    onAnswer(null);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || password === '') return;
    const attempt = password;
    clearPassword();
    setMessage(null);
    setBusy(true);
    // Unlocking a large file blocks the window for a while: let "Unlocking…" paint first.
    await nextPaint();
    // Closed meanwhile (engagement changed, screen left): the file is no longer wanted.
    if (!mounted.current) return;
    try {
      const unlocked = await unlockPdf(request.bytes, attempt);
      if (mounted.current) onAnswer(unlocked);
    } catch (error) {
      if (!mounted.current) return;
      if (error instanceof PdfToolsError && error.code === 'wrong-password') {
        const count = attempts + 1;
        setAttempts(count);
        setMessage(count >= 3 ? `${error.message} If you do not have the password, skip this file.` : error.message);
        setBusy(false);
        return;
      }
      onAnswer(error instanceof PdfToolsError ? error : new PdfToolsError('unlock-failed', 'This file could not be unlocked.'));
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) skip();
      }}
    >
      <DialogContent
        ref={content}
        className="sm:max-w-md"
        onInteractOutside={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => {
          // Radix returns focus to the control focused before; when that control has gone, it
          // would land on the page body.
          event.preventDefault();
          if (opener?.isConnected) opener.focus({ preventScroll: true });
          else onFocusLost?.();
        }}
      >
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="h-5 w-5 text-primary" aria-hidden="true" />
              Password needed
            </DialogTitle>
            <DialogDescription>
              <span className="font-medium text-foreground break-all">{request.name}</span> is protected with a password. Enter it to
              open the file here. The password is not stored, and the copy in your list will not be password-protected.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-2">
            <Label htmlFor="pdf-tools-password">Password</Label>
            <Input
              key={`password-${field.generation}`}
              id="pdf-tools-password"
              ref={passwordRef}
              data-testid="pdf-tools-password-input"
              type="password"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              autoFocus
              value={password}
              disabled={busy}
              aria-invalid={message ? true : undefined}
              aria-describedby={message ? 'pdf-tools-password-message' : undefined}
              onChange={(event) => setPassword(event.target.value)}
            />
            <p id="pdf-tools-password-message" role="alert" aria-live="assertive" className="min-h-[1.25rem] text-sm text-destructive">
              {message}
            </p>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={skip} disabled={busy}>
              Skip this file
            </Button>
            <Button type="submit" data-testid="pdf-tools-password-submit" disabled={busy || password === ''}>
              {busy ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Unlocking…
                </>
              ) : (
                'Open file'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
