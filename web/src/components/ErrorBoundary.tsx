import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props { children: ReactNode; }
interface State { error: Error | null; }

/** Root error boundary: catches render-time throws anywhere in the tree and shows a
 *  friendly fallback instead of blanking the whole app. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Surface to the console for diagnosis; the UI shows a recoverable fallback.
    console.error("Render error caught by ErrorBoundary:", error, info.componentStack);
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="auth-stage" role="alert">
        <div className="error-fallback card">
          <h1 className="error-fallback-title">Something went wrong</h1>
          <p className="error-fallback-msg">{error.message || "An unexpected error occurred."}</p>
          <button className="btn" onClick={() => window.location.reload()}>Reload</button>
        </div>
      </div>
    );
  }
}
