import { StrictMode, Component, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import "@thru/design/tokens/css";
import "./gallery.css";
import { App } from "./App";

class ErrorBoundary extends Component<{ children: ReactNode }, { err: Error | null; stack: string }> {
  state = { err: null as Error | null, stack: "" };
  componentDidCatch(err: Error, info: { componentStack?: string | null }) {
    this.setState({ err, stack: info.componentStack ?? "" });
  }
  render() {
    if (this.state.err) {
      return (
        <pre id="gallery-error" style={{ padding: 24, color: "#d33c43", whiteSpace: "pre-wrap", fontFamily: "monospace", fontSize: 13 }}>
          {String(this.state.err?.message)}
          {"\n\n--- component stack ---"}
          {this.state.stack}
        </pre>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
