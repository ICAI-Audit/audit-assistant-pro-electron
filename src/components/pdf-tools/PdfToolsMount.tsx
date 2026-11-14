import { Component, lazy, Suspense, useState, type ErrorInfo, type ReactNode } from 'react';
import { AlertCircle, RotateCw } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { failureMessage, retryUrl } from './chunkRetry';

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
    console.error('PDF Tools failed:', error, info.componentStack);
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

/** What VERA Tools mounts for its PDF Tools tab: the screen, loaded on first use. */
export default function PdfToolsMount() {
  // A failed lazy component stays failed, so "Try again" makes a fresh one.
  const [Screen, setScreen] = useState(() => lazy(loadPdfTools));
  return (
    <PdfToolsBoundary onRetry={() => setScreen(() => lazy(loadPdfTools))}>
      <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading PDF Tools…</div>}>
        <Screen />
      </Suspense>
    </PdfToolsBoundary>
  );
}
