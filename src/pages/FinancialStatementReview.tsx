import { useEffect, useState } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useEngagement } from '@/contexts/EngagementContext';
import FsgApp from '@/modules/fsg/App';
import FsgErrorBoundary from '@/modules/fsg/ErrorBoundary';
import { getModuleStatus, openEngagementContext } from '@/modules/fsg/api';
import '@/modules/fsg/fsg.css';

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; context: unknown };

/**
 * Audit Execution → Financial Statement Review (T-019).
 *
 * Hosts the FSG_Bharat financial statement generator for the selected
 * engagement. The engagement's client is the FSG Auditee and its financial
 * year is the FSG financial period; both are opened (and created on first use)
 * by the main process through fsg:context:open.
 */
export default function FinancialStatementReview() {
  const { currentEngagement } = useEngagement();
  const engagementId = currentEngagement?.id;
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    if (!engagementId) return undefined;
    setState({ status: 'loading' });
    (async () => {
      const status = await getModuleStatus();
      if (!status?.ok) {
        if (!cancelled) setState({ status: 'error', message: status?.error || 'Financial Statement Review is not available.' });
        return;
      }
      try {
        const context = await openEngagementContext(engagementId);
        if (!cancelled) setState({ status: 'ready', context });
      } catch (error) {
        if (!cancelled) {
          setState({ status: 'error', message: error instanceof Error ? error.message : String(error) });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [engagementId]);

  if (state.status === 'loading') {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Opening Financial Statement Review…
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="p-6">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Financial Statement Review could not be opened</AlertTitle>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="h-full">
      <FsgErrorBoundary>
        <FsgApp key={engagementId} context={state.context} />
      </FsgErrorBoundary>
    </div>
  );
}
