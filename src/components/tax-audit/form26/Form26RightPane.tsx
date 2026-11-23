// The right pane of the Form No. 26 workspace: "Sources, Evidence and Review", the page's own EvidenceRail
// (passed in, so evidence works exactly as on Form 3CD and in the Evidence Vault), given the selected
// clause's row. Folded, it is the present narrow strip with the count of linked files. Esc inside the pane
// folds it and puts the keyboard on the button that opens it again. While the comparison with Form 3CD is
// on (task 25) the pane has two tabs, "Evidence" and "Last year"; off, it is the evidence alone. The tabs sit
// in the pane's own title row beside its fold button (POLISH-2: no band above the title at 1280 x 720); the
// page's rail then draws its body only (its own title row is the pane's). In an audit brought across from a
// Form 3CD draft that holds answers (task 26) there is a tab "3CD draft" too: the earlier answer, read only.
import * as React from 'react';
import { PanelRightClose, PanelRightOpen, Paperclip } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { Form26ClauseRow } from '@/lib/taxAuditForm26Store';
import type { TaxAuditClauseEvidence, TaxAuditClauseResponse } from '@/types/taxAudit';

/** What the page passes in: its private parts that can be reused as they are (L6). */
export type Form26SharedParts = {
  EvidenceRail: React.ComponentType<{
    clause: TaxAuditClauseResponse;
    evidenceLinks: TaxAuditClauseEvidence[];
    onLink: (evidenceFileId: string) => Promise<void>;
    onUnlink: (linkId: string) => Promise<void>;
    onCollapse?: () => void;
  }>;
};

export type Form26RightPaneProps = {
  parts: Form26SharedParts;
  /** The selected clause unit's row (a schedule's evidence goes on its clause). */
  row: Form26ClauseRow;
  evidence: TaxAuditClauseEvidence[];
  open: boolean;
  onOpenChange(open: boolean): void;
  onLink(evidenceFileId: string): Promise<void>;
  onUnlink(linkId: string): Promise<void>;
  /**
   * The "Last year" tab's content (task 25). Given, the pane has the tabs "Evidence" and "Last year" in its
   * title row, with the fold button there (`fold` is passed for a content that wants to fold the pane too).
   */
  lastYear?: (fold: () => void) => React.ReactNode;
  /** The "3CD draft" tab's content (task 26): the earlier Form 3CD answer of the selected clause. */
  threeCdDraft?: (fold: () => void) => React.ReactNode;
  tab?: Form26PaneTab;
  onTabChange?(tab: Form26PaneTab): void;
};

export type Form26PaneTab = 'evidence' | 'last-year' | 'three-cd-draft';
export const FORM26_PANE_OPEN_BUTTON_ID = 'f26-evidence-pane-open';
/** The pane's name, as the page's rail titles it. */
export const FORM26_PANE_TITLE = 'Sources, Evidence and Review';
/** Compact tabs in a title row: 28 px high, triggers of 24 px (the header's views use the same). */
export const FORM26_COMPACT_TABS = 'h-7 gap-0.5 rounded-md p-px';
export const FORM26_COMPACT_TAB = 'h-6 rounded-[5px] px-2.5 py-0 text-xs data-[state=active]:shadow-sm';
// Inside the Evidence tab: the rail's own frame and title row give way to the pane's (the rail is the page's
// component; its first child is its title row "Sources, Evidence and Review", count and fold).
const RAIL_BODY_ONLY = '[&>div]:rounded-none [&>div]:border-0 [&>div>div:first-child]:hidden';

export function Form26RightPane({ parts, row, evidence, open, onOpenChange, onLink, onUnlink, lastYear, threeCdDraft, tab = 'evidence', onTabChange }: Form26RightPaneProps): JSX.Element {
  const paneRef = React.useRef<HTMLElement>(null);
  const linked = evidence.filter((link) => link.clause_response_id === row.id).length;
  const EvidenceRail = parts.EvidenceRail;

  const fold = React.useCallback(() => {
    onOpenChange(false);
    // The pane's own button is gone; the keyboard goes to the one that opens it again.
    requestAnimationFrame(() => document.getElementById(FORM26_PANE_OPEN_BUTTON_ID)?.focus());
  }, [onOpenChange]);

  if (!open) {
    return (
      <div className="flex h-full flex-col items-center gap-3 rounded-md border bg-background p-2">
        <Button id={FORM26_PANE_OPEN_BUTTON_ID} type="button" size="icon" variant="ghost" className="h-8 w-8" onClick={() => onOpenChange(true)} aria-label="Show sources, evidence and review" title="Show sources, evidence and review">
          <PanelRightOpen aria-hidden="true" className="h-4 w-4" />
        </Button>
        <div className="flex flex-col items-center gap-1 text-subtle">
          <Paperclip aria-hidden="true" className="h-4 w-4" />
          <Badge variant={linked > 0 ? 'default' : 'outline'} className="px-1.5 text-[10px]">
            {linked}
            <span className="sr-only"> evidence {linked === 1 ? 'file' : 'files'} linked</span>
          </Badge>
        </div>
      </div>
    );
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    // Only keys pressed in the pane itself (a menu opened from it lives elsewhere and closes on its own).
    if (event.key !== 'Escape' || event.defaultPrevented || !paneRef.current?.contains(event.target as Node)) return;
    event.preventDefault();
    fold();
  };

  if (!lastYear && !threeCdDraft) {
    return (
      // `relative`: anything placed out of the flow in the page's evidence pane stays inside it.
      <div ref={paneRef as React.RefObject<HTMLDivElement>} className="relative h-full min-h-0" onKeyDown={onKeyDown}>
        <EvidenceRail clause={row} evidenceLinks={evidence} onLink={onLink} onUnlink={onUnlink} onCollapse={fold} />
      </div>
    );
  }

  // A tab that is not there (the notes switched off, no answer in the draft) shows the evidence.
  const shown: Form26PaneTab = (tab === 'last-year' && !lastYear) || (tab === 'three-cd-draft' && !threeCdDraft) ? 'evidence' : tab;
  const tabsLabel = lastYear && threeCdDraft ? 'Evidence, last year or 3CD draft' : lastYear ? 'Evidence or last year' : 'Evidence or 3CD draft';
  return (
    // One frame; its first line is the title row: the tabs and the fold button. `overflow-clip`, never hidden.
    <section aria-label={FORM26_PANE_TITLE} ref={paneRef} className="relative flex h-full min-h-0 flex-col overflow-clip rounded-md border bg-background" onKeyDown={onKeyDown}>
      {/* An inactive tab keeps Radix's `hidden`: no display class on a TabsContent, only its size in the column. */}
      <Tabs value={shown} onValueChange={(next) => onTabChange?.(next as Form26PaneTab)} className="flex min-h-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center justify-between gap-2 border-b bg-muted/30 px-2 py-1.5" data-f26-pane-title="">
          <TabsList aria-label={tabsLabel} className={FORM26_COMPACT_TABS}>
            <TabsTrigger value="evidence" className={FORM26_COMPACT_TAB} data-f26-pane-tab="evidence">
              Evidence
            </TabsTrigger>
            {lastYear && (
              <TabsTrigger value="last-year" className={FORM26_COMPACT_TAB} data-f26-pane-tab="last-year">
                Last year
              </TabsTrigger>
            )}
            {threeCdDraft && (
              <TabsTrigger value="three-cd-draft" className={FORM26_COMPACT_TAB} data-f26-pane-tab="three-cd-draft">
                3CD draft
              </TabsTrigger>
            )}
          </TabsList>
          <Button type="button" size="icon" variant="ghost" className="h-8 w-8 shrink-0" onClick={fold} title="Collapse evidence pane" aria-label="Collapse evidence pane">
            <PanelRightClose aria-hidden="true" className="h-4 w-4" />
          </Button>
        </div>
        <TabsContent value="evidence" className={`mt-0 min-h-0 flex-1 ${RAIL_BODY_ONLY}`}>
          <EvidenceRail clause={row} evidenceLinks={evidence} onLink={onLink} onUnlink={onUnlink} onCollapse={fold} />
        </TabsContent>
        {lastYear && (
          <TabsContent value="last-year" className="mt-0 min-h-0 flex-1">
            {lastYear(fold)}
          </TabsContent>
        )}
        {threeCdDraft && (
          <TabsContent value="three-cd-draft" className="mt-0 min-h-0 flex-1">
            {threeCdDraft(fold)}
          </TabsContent>
        )}
      </Tabs>
    </section>
  );
}
