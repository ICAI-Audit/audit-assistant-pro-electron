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
 * component's state: it goes once to unlockPdf, is cleared after every attempt, and disappears
 * when the dialog closes (it is mounted per file). It is never logged or shown.
 */
export default function PasswordDialog({ request, onAnswer, onFocusLost }: PasswordDialogProps) {
  const [password, setPassword] = useState('');
  const [attempts, setAttempts] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);
  // Taken on the first render, before the dialog moves focus into itself.
  const [opener] = useState(() => (document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null));

  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  const skip = () => {
    setPassword('');
    onAnswer(null);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || password === '') return;
    const attempt = password;
    setPassword('');
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
        requestAnimationFrame(() => inputRef.current?.focus());
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
              id="pdf-tools-password"
              ref={inputRef}
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
