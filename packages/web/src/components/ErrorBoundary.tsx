import { Component, type ErrorInfo, type ReactNode } from "react";
import { colors, fonts } from "../lib/theme";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[trove] Uncaught error:", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div
        style={{
          height: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: colors.bg,
          color: colors.text,
          fontFamily: fonts.sans,
          gap: "16px",
          padding: "24px",
          textAlign: "center",
        }}
      >
        <span style={{ fontSize: "48px" }}>💎</span>
        <h1 style={{ fontSize: "20px", fontWeight: 600, margin: 0 }}>
          Something went wrong
        </h1>
        <p style={{ fontSize: "14px", color: colors.textMuted, margin: 0, maxWidth: "400px" }}>
          {this.state.error.message}
        </p>
        <button
          onClick={() => {
            this.setState({ error: null });
            window.location.reload();
          }}
          style={{
            marginTop: "8px",
            padding: "8px 20px",
            background: colors.brand,
            color: "#fff",
            border: "none",
            borderRadius: "8px",
            fontSize: "14px",
            fontWeight: 500,
            fontFamily: fonts.sans,
            cursor: "pointer",
          }}
        >
          Reload
        </button>
      </div>
    );
  }
}
