"use client";

import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { ThemeProvider as NextThemes, useTheme } from "next-themes";
import { useSyncExternalStore, type ReactNode } from "react";

export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemes attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      {children}
    </NextThemes>
  );
}

const OPTIONS = [
  { value: "light", label: "Light", Icon: SunIcon },
  { value: "dark", label: "Dark", Icon: MoonIcon },
  { value: "system", label: "System", Icon: MonitorIcon },
] as const;

const noop = () => () => {};

/** Segmented pill, in the style of Promise Tracker's tabs. */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  // The stored theme is only known in the browser; mark nothing until hydrated so markup matches the server's.
  const mounted = useSyncExternalStore(noop, () => true, () => false);
  return (
    <div role="radiogroup" aria-label="Colour theme" className="flex items-center gap-0.5 rounded-full border bg-muted p-0.5">
      {OPTIONS.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={mounted && theme === value}
          aria-label={label}
          title={label}
          onClick={() => setTheme(value)}
          className="grid size-7 place-items-center rounded-full text-muted-foreground transition-colors hover:text-foreground aria-checked:bg-primary aria-checked:text-primary-foreground"
        >
          <Icon className="size-3.5" aria-hidden />
        </button>
      ))}
    </div>
  );
}
