export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-6 px-4 py-16">
      <p className="text-sm font-medium uppercase tracking-wide text-accent">
        In development
      </p>
      <h1 className="text-4xl font-semibold tracking-tight">DecampWatch NG</h1>
      <p className="text-lg text-muted">
        A real-time tracker of party defections by members of Nigeria&apos;s
        10th National Assembly: the Senate and the House of Representatives.
      </p>
      <p className="border-t border-border pt-6 text-sm text-muted">
        The dashboard, live alerts and legislator profiles arrive in later
        milestones. No defection data is shown until the roster and the
        detection agent are in place.
      </p>
    </main>
  );
}
