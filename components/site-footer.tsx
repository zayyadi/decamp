import { ThemeToggle } from "./theme";

export function SiteFooter() {
  return (
    <footer className="mt-16 bg-ink text-ink-foreground">
      <div className="mx-auto grid w-full max-w-7xl gap-8 px-4 py-12 sm:px-6 md:grid-cols-[2fr_1fr]">
        <div className="space-y-3">
          <p className="font-heading text-2xl font-bold text-white">
            DecampWatch<span className="text-[#ff8a7a]"> NG</span>
          </p>
          <p className="max-w-prose text-sm leading-relaxed">
            Tracks party defections by sitting members of Nigeria&apos;s 10th National Assembly. An automated agent reads
            the news; party counts change only when a defection is <strong className="text-white">confirmed</strong> by
            our scoring or by an editor. Reports still under review are labelled <strong className="text-white">unverified</strong>{" "}
            and never change the counts. Every confirmed defection links to its sources.
          </p>
        </div>
        <div className="space-y-3 text-sm md:justify-self-end">
          <p className="font-medium text-white">Theme</p>
          <ThemeToggle />
        </div>
      </div>
      <div className="border-t border-white/10">
        <p className="mx-auto w-full max-w-7xl px-4 py-5 text-xs sm:px-6">
          State boundaries: geoBoundaries (GRID3, 2022), CC BY 4.0.
        </p>
      </div>
    </footer>
  );
}
