// The first thing the Tax Audit page does (task 19; ruling L1): choose the form from the engagement's year,
// BEFORE any Form 3CD hook runs. Form 3CD years get the present page exactly as it is (no element around
// it); Form No. 26 years get the Form No. 26 workspace, loaded only then; a year that is not understood gets
// the Form 3CD page when a Form 3CD audit already exists (decision A10), else a plain message — and nothing
// is created. An engagement whose year was changed back to before 2026-27 and that holds a Form No. 26 draft
// gets the Form 3CD page with a notice above it that the draft is kept (task 26; it reads, never writes).
// This file is loaded with the page: it brings nothing of Form No. 26 but this choice and that notice.
import * as React from 'react';

import { Form26DraftNotice } from '@/components/tax-audit/form26/Form26DraftNotice';
import { Form26LoadingState } from '@/components/tax-audit/form26/Form26Loading';
import type { Form26SharedParts } from '@/components/tax-audit/form26/Form26RightPane';
import { useEngagement } from '@/contexts/EngagementContext';
import { getSQLiteClient } from '@/integrations/sqlite/client';
import { hasForm26Audit, hasThreeCdAudit, taxAuditChooserView, type TaxAuditChooserView, type ThreeCdAuditCheck } from '@/lib/taxAuditForm26Chooser';
import { chooseTaxAuditForm } from '@/lib/taxAuditForm26Year';

const Form26Workspace = React.lazy(() => import('@/components/tax-audit/form26/Form26Workspace'));
const Form26YearUnknownState = React.lazy(() =>
  import('@/components/tax-audit/form26/Form26States').then((module) => ({ default: module.Form26YearUnknownState })),
);

export type TaxAuditFormChooserProps = { ThreeCd: React.ComponentType; parts: Form26SharedParts };

export function TaxAuditFormChooser({ ThreeCd, parts }: TaxAuditFormChooserProps): JSX.Element {
  const { currentEngagement } = useEngagement();
  const engagementId = currentEngagement?.id ?? null;
  const financialYear = currentEngagement?.financial_year ?? '';
  const choice = chooseTaxAuditForm(currentEngagement?.financial_year);
  const [threeCdCheck, setThreeCdCheck] = React.useState<ThreeCdAuditCheck | null>(null);
  const [form26Check, setForm26Check] = React.useState<{ engagementId: string; found: boolean } | null>(null);

  // Only a year that is not understood needs to look in the database, and then only to read.
  React.useEffect(() => {
    if (!engagementId || choice !== 'unknown') return undefined;
    let current = true;
    void hasThreeCdAudit(getSQLiteClient(), engagementId).then((found) => {
      if (current) setThreeCdCheck({ engagementId, found });
    });
    return () => {
      current = false;
    };
  }, [engagementId, choice]);

  // The Form 3CD screens may open for an engagement that holds a Form No. 26 draft (its year changed back):
  // read, once per engagement, whether there is one. The Form 3CD page does not wait for the answer.
  React.useEffect(() => {
    if (!engagementId || choice === 'form26') return undefined;
    let current = true;
    void hasForm26Audit(getSQLiteClient(), engagementId).then((found) => {
      if (current) setForm26Check({ engagementId, found });
    });
    return () => {
      current = false;
    };
  }, [engagementId, choice]);

  const view = taxAuditChooserView({ engagementId, choice, threeCdCheck });
  const form26Draft = Boolean(engagementId && form26Check?.engagementId === engagementId && form26Check.found);
  return <TaxAuditFormChooserView view={view} ThreeCd={ThreeCd} parts={parts} financialYear={financialYear} form26DraftOf={form26Draft ? engagementId : null} />;
}

/** What the chooser draws for each answer (drawn by the static-render test). */
export function TaxAuditFormChooserView(props: {
  view: TaxAuditChooserView;
  ThreeCd: React.ComponentType;
  parts: Form26SharedParts;
  financialYear: string;
  /** The engagement whose Form No. 26 draft is kept (a year changed back): the notice above the Form 3CD page. */
  form26DraftOf?: string | null;
}): JSX.Element {
  const { view, ThreeCd } = props;
  // Always the same two places, so the Form 3CD page is never mounted again when the notice appears.
  if (view === 'three-cd') {
    return (
      <>
        {props.form26DraftOf ? <Form26DraftNotice engagementId={props.form26DraftOf} /> : null}
        <ThreeCd />
      </>
    );
  }
  if (view === 'checking') return <Form26LoadingState />;
  return (
    <React.Suspense fallback={<Form26LoadingState />}>
      {view === 'form26' ? <Form26Workspace parts={props.parts} /> : <Form26YearUnknownState financialYear={props.financialYear} />}
    </React.Suspense>
  );
}
