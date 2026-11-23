// Prepared / Reviewed / Approve on a Form No. 26 clause: the present Tax Audit controls rebuilt with the
// same words, look and order (TaxAudit.tsx, ClauseEditor header), and its "Edit approved clause" dialog
// for reopening an approved clause with a reason. As today, a clause with answers to fill can still be
// marked; the bar says how many are left. A button stays put while its change is being saved.
import * as React from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { isRowLocked } from '@/lib/taxAuditForm26Review';
import type { Form26ClauseRow } from '@/lib/taxAuditForm26Store';
import type { TaxAuditReviewStatus } from '@/types/taxAudit';

export type Form26ReviewBarProps = {
  row: Form26ClauseRow;
  unfilled: number;
  /** Resolves true when the new state is stored (the hook says why when it is not). */
  onStatus(status: TaxAuditReviewStatus, options?: { unlockReason?: string }): Promise<boolean | void>;
  /** Decision A6: every assigned user may approve; one switch if the owner decides otherwise. */
  canApprove?: boolean;
};

export function Form26ReviewBar({ row, unfilled, onStatus, canApprove = true }: Form26ReviewBarProps): JSX.Element {
  const locked = isRowLocked(row);
  const [busy, setBusy] = React.useState<TaxAuditReviewStatus | null>(null);
  const [unlockOpen, setUnlockOpen] = React.useState(false);
  const [reason, setReason] = React.useState('');
  const [unlocking, setUnlocking] = React.useState(false);
  const reasonId = `f26-unlock-reason-${row.id}`;
  const barRef = React.useRef<HTMLDivElement>(null);
  // Approving swaps the buttons for "Edit" (and reopening swaps them back): the keyboard stays in the bar.
  const keepFocus = React.useRef(false);
  React.useEffect(() => {
    if (!keepFocus.current) return;
    keepFocus.current = false;
    const bar = barRef.current;
    if (bar && !bar.contains(document.activeElement)) bar.querySelector<HTMLButtonElement>('button')?.focus();
  }, [locked]);

  React.useEffect(() => {
    setUnlockOpen(false);
    setReason('');
  }, [row.id]);

  const mark = async (status: TaxAuditReviewStatus) => {
    if (busy) return;
    keepFocus.current = Boolean(barRef.current?.contains(document.activeElement));
    setBusy(status);
    try {
      await onStatus(status);
    } finally {
      setBusy(null);
    }
  };

  const unlock = async () => {
    const text = reason.trim();
    if (!text) return;
    setUnlocking(true);
    try {
      const done = await onStatus('reviewed', { unlockReason: text });
      if (done !== false) {
        keepFocus.current = true;
        setUnlockOpen(false);
        setReason('');
        toast.success('Clause reopened for editing', { description: 'The clause is now editable. Approval history is retained.' });
      }
    } finally {
      setUnlocking(false);
    }
  };

  return (
    <div ref={barRef} className="flex shrink-0 flex-wrap items-center justify-end gap-1">
      {unfilled > 0 && !locked && <span className="mr-1 text-xs tabular-nums text-subtle">{unfilled} unfilled</span>}
      {locked ? (
        <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setUnlockOpen(true)}>
          Edit
        </Button>
      ) : (
        <>
          <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-xs" aria-busy={busy === 'prepared'} aria-disabled={busy !== null} onClick={() => void mark('prepared')}>
            Prepared
          </Button>
          <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-xs" aria-busy={busy === 'reviewed'} aria-disabled={busy !== null} onClick={() => void mark('reviewed')}>
            Reviewed
          </Button>
          <Button
            type="button"
            size="sm"
            className="h-7 px-2 text-xs"
            aria-busy={busy === 'approved'}
            aria-disabled={busy !== null}
            disabled={!canApprove}
            title={canApprove ? undefined : 'Only a partner or a manager can approve a clause.'}
            onClick={() => void mark('approved')}
          >
            Approve
          </Button>
        </>
      )}

      <Dialog open={unlockOpen} onOpenChange={setUnlockOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit approved clause</DialogTitle>
            <DialogDescription>
              Enter remarks explaining why this approved clause is being reopened. The reason will be stored with the clause.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor={reasonId}>Remarks for editing</Label>
            <Textarea
              id={reasonId}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Example: Approved by mistake; correcting client master value."
              rows={4}
            />
            {row.unlock_reason && <p className="text-xs text-subtle">Previous edit reason: {row.unlock_reason}</p>}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setUnlockOpen(false)} disabled={unlocking}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void unlock()} disabled={unlocking || !reason.trim()}>
              {unlocking ? 'Enabling...' : 'Enable Edit'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
