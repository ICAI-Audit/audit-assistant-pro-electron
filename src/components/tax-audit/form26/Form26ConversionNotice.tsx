// The notice at the top of a converted Form No. 26 audit (BUILD-PLAN task 26): in two sentences what
// happened, that the earlier Form 3CD draft is kept with its evidence in the Evidence Vault, and where to see
// it. Shown until the user dismisses it (remembered on this computer for the user and engagement).
import { FileStack, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { FORM26_THREE_CD_DRAFT_TEXT } from '@/lib/taxAuditForm26Conversion';

export type Form26ConversionNoticeProps = { text: string; onView(): void; onDismiss(): void };

export function Form26ConversionNotice({ text, onView, onDismiss }: Form26ConversionNoticeProps): JSX.Element {
  return (
    // Compact (task 27): at 1280 x 720 every pixel above the panes is taken from the list and the editor, so small
    // type, small padding and half the column's gaps; the whole text stays on screen.
    <section aria-label="Form 3CD draft brought across" className="-my-2 flex shrink-0 items-start gap-2 rounded-md border border-info/30 bg-info-soft px-2.5 py-1 text-xs leading-4 text-info-ink" data-f26-conversion-notice="">
      <FileStack aria-hidden="true" className="mt-px h-3.5 w-3.5 shrink-0" />
      <p className="min-w-0 flex-1">
        {text}{' '}
        <Button type="button" variant="link" className="h-auto whitespace-normal p-0 text-left text-xs font-medium leading-4 text-info-ink underline" onClick={onView} data-f26-view-3cd-draft="">
          {FORM26_THREE_CD_DRAFT_TEXT.view}
        </Button>
      </p>
      <Button type="button" size="icon" variant="ghost" className="-my-0.5 h-5 w-5 shrink-0 text-info-ink" onClick={onDismiss} aria-label="Dismiss this notice" title="Dismiss this notice" data-f26-dismiss-notice="">
        <X aria-hidden="true" className="h-3.5 w-3.5" />
      </Button>
    </section>
  );
}
