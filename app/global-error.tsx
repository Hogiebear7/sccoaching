"use client";

// Catches errors thrown by the root layout itself (app/layout.tsx) — the one
// case app/error.tsx can't cover, since it renders inside that layout. Must
// render its own <html>/<body> (it replaces the root layout entirely when it
// fires) and can't assume the layout's fonts/providers are available.
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "4rem 1.5rem",
          textAlign: "center",
          background: "#0a0e17",
          color: "#f4f4f5",
          fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        }}
      >
        <p style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.24em", color: "#e4c55a", margin: 0 }}>
          Something went wrong
        </p>
        <h1 style={{ marginTop: 12, fontSize: 28, fontWeight: 700, color: "#fafafa" }}>That didn&rsquo;t work.</h1>
        <p style={{ marginTop: 12, maxWidth: 360, fontSize: 14, lineHeight: 1.6, color: "#a1a1aa" }}>
          Something went wrong loading the page. Try again.
        </p>
        <button
          type="button"
          onClick={() => reset()}
          style={{
            marginTop: 28,
            padding: "12px 20px",
            borderRadius: 10,
            border: "none",
            background: "#e4c55a",
            color: "#1c1d22",
            fontSize: 14,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
