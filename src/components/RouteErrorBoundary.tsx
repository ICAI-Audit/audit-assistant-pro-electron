import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertCircle } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

interface Props {
  title: string;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Keeps a failure inside one routed screen (for example a lazily loaded page
 * whose code could not be loaded) from unmounting the rest of the application.
 */
export class RouteErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`${this.props.title} failed:`, error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="p-6">
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>{this.props.title} could not be displayed</AlertTitle>
            <AlertDescription>{this.state.error.message}</AlertDescription>
          </Alert>
        </div>
      );
    }
    return this.props.children;
  }
}
