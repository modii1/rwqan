"use client";

export const dynamic = "force-dynamic";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html>
      <body>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "100vh", fontFamily: "sans-serif" }}>
          <h2>Something went wrong</h2>
          <button onClick={reset} style={{ marginTop: "1rem", padding: "0.5rem 1rem", cursor: "pointer" }}>
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
