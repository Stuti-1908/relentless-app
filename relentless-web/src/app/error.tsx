"use client";

// App-wide error boundary — shown if any page throws, instead of a blank screen.
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="auth-center">
      <div className="auth-card" style={{ textAlign: "center" }}>
        <div className="brand">
          RELENTLESS<span className="dot"> AI</span>
        </div>
        <h2 style={{ fontSize: 20, margin: "16px 0 8px" }}>Something went wrong</h2>
        <p style={{ color: "var(--muted)", fontSize: 14, margin: "0 0 20px" }}>
          A hiccup on this screen — your data is safe. Try again.
        </p>
        <button className="btn btn-primary btn-block" onClick={() => reset()}>
          Try again
        </button>
        {process.env.NODE_ENV === "development" && (
          <pre
            style={{
              marginTop: 16,
              textAlign: "left",
              fontSize: 11,
              color: "#b91c1c",
              background: "#fef2f2",
              border: "1px solid #fecaca",
              borderRadius: 8,
              padding: 10,
              overflow: "auto",
              maxHeight: 160,
            }}
          >
            {error.message}
          </pre>
        )}
      </div>
    </div>
  );
}
