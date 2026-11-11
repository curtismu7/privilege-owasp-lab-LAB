import { Component } from "react";

// A render failure inside a panel shows an inert error card and leaves the rest of the page (shell bar, banner, mode
// toggle) working. The message is shown as text, never markup. resetKey: a new value (a new run, a mode switch) retries.
export default class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null, key: props.resetKey }; }
  static getDerivedStateFromError(error) { return { error }; }
  static getDerivedStateFromProps(props, state) {
    return props.resetKey !== state.key ? { error: null, key: props.resetKey } : null;
  }
  componentDidCatch() { /* nothing to log: the card says what happened */ }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="card card--neutral" role="alert" data-testid={this.props.testId || "panel-error"}>
        <h3>{this.props.title || "This panel could not be shown"}</h3>
        <p><span className="chip chip--danger"><span className="dot" aria-hidden="true" />Error</span> {String(this.state.error?.message || this.state.error).slice(0, 300)}</p>
        <p className="hint">The rest of the lab still works. Run another command, switch mode or press Reset.</p>
      </div>
    );
  }
}
