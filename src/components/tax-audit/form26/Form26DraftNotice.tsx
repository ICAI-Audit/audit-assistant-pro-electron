// Above the Form 3CD screens of an engagement that holds a Form No. 26 draft (its year was changed back to
// before 2026-27; BUILD-PLAN task 26): the draft is kept, and "View it" shows it read only. Light on purpose:
// it is part of the Tax Audit page's start-up bundle, so the read-only view (and the Form No. 26 definition
// with it) is loaded only when the user asks for it. Nothing here writes.
import * as React from 'react';
import { FileText } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

const Form26ReadOnlyView = React.lazy(() => import('@/components/tax-audit/form26/Form26ReadOnlyView'));

export const FORM26_DRAFT_NOTICE_TEXT = 'This engagement holds a Form No. 26 draft made when its year was 2026-27 or later. It is kept.';
export const FORM26_DRAFT_NOTICE_ACTION = 'View it';

export function Form26DraftNotice({ engagementId }: { engagementId: string }): JSX.Element {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <section aria-label="Form No. 26 draft" className="mb-4 flex items-center gap-2.5 rounded-md border border-info/30 bg-info-soft px-3 py-2 text-sm text-info-ink" data-f26-draft-notice="">
        <FileText aria-hidden="true" className="h-4 w-4 shrink-0" />
        <p className="min-w-0 flex-1 leading-5">
          {FORM26_DRAFT_NOTICE_TEXT}{' '}
          <Button type="button" variant="link" className="h-auto p-0 text-sm font-medium text-info-ink underline" onClick={() => setOpen(true)} data-f26-draft-view="">
            {FORM26_DRAFT_NOTICE_ACTION}
          </Button>
        </p>
      </section>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[85vh] flex-col gap-3 sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>The Form No. 26 draft</DialogTitle>
            <DialogDescription>Shown read only, as it was kept. Its answers can be saved as a file.</DialogDescription>
          </DialogHeader>
          <div className="relative min-h-0 flex-1 overflow-y-auto pr-1">
            {open && (
              <React.Suspense fallback={<p className="text-sm text-subtle" role="status">Opening the Form No. 26 draft.</p>}>
                <Form26ReadOnlyView engagementId={engagementId} />
              </React.Suspense>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
