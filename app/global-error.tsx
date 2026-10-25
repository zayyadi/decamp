"use client";

export default function GlobalError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "sans-serif", padding: "3rem", maxWidth: "40rem", margin: "auto" }}>
        <h1>DecampWatch NG is temporarily unavailable</h1>
        <p>We couldn&apos;t load the service. Please try again shortly.</p>
        <button onClick={() => retry()}>Try again</button>
      </body>
    </html>
  );
}
