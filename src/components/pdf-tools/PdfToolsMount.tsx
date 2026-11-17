import { Component, lazy, Suspense, useEffect, useState, type ErrorInfo, type ReactNode } from 'react';
import { AlertCircle, RotateCw } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { failureMessage, retryUrl } from './chunkRetry';
import { delayedBusy } from './delayedBusy';

type PdfToolsModule = typeof import('./PdfTools');

// Shared by every mount: once the screen's code has loaded (under whichever URL), every later
// visit uses that same module, and so the same file list. After a failure the next attempt asks
// for the chunk under a fresh URL (see chunkRetry.ts), because the failed URL stays failed.
let loading: Promise<PdfToolsModule> | null = null;
let lastFailure: Error | null = null;
let retries = 0;

function loadPdfTools(): Promise<PdfToolsModule> {
  if (loading) return loading;
  const url = lastFailure ? retryUrl(lastFailure.message, retries + 1) : null;
  if (url) retries += 1;
  const attempt: Promise<PdfToolsModule> = url ? import(/* @vite-ignore */ url) : import('./PdfTools');
  loading = attempt.catch((error: unknown) => {
    loading = null;
    lastFailure = error instanceof Error ? error : new Error(String(error));
    throw error;
  });
  return loading;
}

interface BoundaryProps {
  onRetry: () => void;
  children: ReactNode;
}

/** Keeps a failure of PDF Tools (for example its code not loading) inside the tab. */
class PdfToolsBoundary extends Component<BoundaryProps, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // The kind of failure only: an error's message can carry text from the page (REV-B minor 14).
    console.error('PDF Tools failed:', error.name, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    const message = failureMessage(this.state.error, lastFailure);
    return (
      <div className="p-6" data-testid="pdf-tools-error">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>{message.title}</AlertTitle>
          <AlertDescription className="space-y-3">
            <p>{message.text}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                this.setState({ error: null });
                this.props.onRetry();
              }}
            >
              <RotateCw />
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  }
}

// Widths of the toolbar's placeholder buttons: three rows, about as the real toolbar wraps at 1280 px.
const TOOL_ROWS = [
  ['w-16', 'w-20', 'w-14', 'w-28', 'w-32', 'w-24', 'w-20'],
  ['w-24', 'w-28', 'w-20', 'w-24', 'w-20', 'w-28'],
  ['w-24', 'w-28', 'w-24', 'w-20', 'w-24'],
];

/**
 * Shown while the screen's code loads (UX audit C15, T1-10): nothing at first, so a quick load never
 * flashes; after a moment (delayedBusy) a quiet outline of the toolbar and the drop area, in the shared
 * Skeleton blocks the Evidence Vault uses, and "Loading PDF Tools…" for screen readers.
 */
function LoadingSkeleton() {
  const [shown, setShown] = useState(false);
  useEffect(() => delayedBusy(() => setShown(true), () => undefined), []);
  return (
    <div data-testid="pdf-tools-loading" data-shown={shown ? 'true' : 'false'} role="status" aria-live="polite" className="space-y-2.5">
      <span className="sr-only">{shown ? 'Loading PDF Tools…' : ''}</span>
      {shown && (
        <>
          <div className="space-y-1 rounded-lg border bg-card px-3 py-1.5 shadow-sm" aria-hidden="true">
            {TOOL_ROWS.map((row, r) => (
              <div key={r} className="flex flex-wrap items-center gap-1">
                <Skeleton className="mr-1 h-3 w-14" />
                {row.map((width, i) => (
                  <Skeleton key={i} className={`h-8 ${width}`} />
                ))}
              </div>
            ))}
          </div>
          <div className="flex flex-col items-center gap-3 rounded-lg border-2 border-dashed border-border bg-card px-6 py-6" aria-hidden="true">
            <Skeleton className="h-11 w-11 rounded-full" />
            <div className="flex w-full max-w-lg flex-col items-center gap-2">
              <Skeleton className="h-4 w-80 max-w-full" />
              <Skeleton className="h-3 w-[28rem] max-w-full" />
            </div>
            <div className="flex gap-2">
              <Skeleton className="h-10 w-40" />
              <Skeleton className="h-10 w-48" />
            </div>
            <Skeleton className="h-3 w-96 max-w-full" />
          </div>
        </>
      )}
    </div>
  );
}

/** What VERA Tools mounts for its PDF Tools tab: the screen, loaded on first use. */
export default function PdfToolsMount() {
  // A failed lazy component stays failed, so "Try again" makes a fresh one.
  const [Screen, setScreen] = useState(() => lazy(loadPdfTools));
  return (
    <PdfToolsBoundary onRetry={() => setScreen(() => lazy(loadPdfTools))}>
      <Suspense fallback={<LoadingSkeleton />}>
        <Screen />
      </Suspense>
    </PdfToolsBoundary>
  );
}
