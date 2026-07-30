import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** Named so the message can say which part of the app stopped. */
  area: string;
}

interface State {
  error: Error | null;
}

/**
 * One broken panel should not take the drawing with it. A saved attempt from an
 * older version, a malformed model reply — the rest of the app keeps working and
 * you get a way back rather than a blank page.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[loadbearing] ${this.props.area} failed`, error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="pane-body">
        <div className="banner error">
          <strong>The {this.props.area} panel stopped.</strong>
          <div style={{ fontSize: 12, marginTop: 4 }}>{error.message}</div>
        </div>
        <button onClick={() => this.setState({ error: null })}>Try again</button>
      </div>
    );
  }
}
