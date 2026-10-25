import type { Metadata } from "next";
import { Bodoni_Moda, Geist_Mono, Inter } from "next/font/google";
import { Suspense } from "react";
import { LiveUpdates } from "@/components/alerts/live-updates";
import { DemoBanner } from "@/components/demo-banner";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { ThemeProvider } from "@/components/theme";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

// Promise Tracker pairs a bold Bodoni display face with a neutral sans.
const display = Bodoni_Moda({ variable: "--font-display", subsets: ["latin"], weight: ["600", "700", "800"] });
const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "DecampWatch NG", template: "%s · DecampWatch NG" },
  description: "Real-time tracker of party defections in Nigeria's National Assembly.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      // next-themes sets the class before hydration.
      suppressHydrationWarning
      className={`${display.variable} ${inter.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <ThemeProvider>
          <LiveUpdates>
            <a
              href="#main"
              className="sr-only z-50 rounded-md bg-primary px-3 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
            >
              Skip to content
            </a>
            <SiteHeader />
            <Suspense fallback={null}>
              <DemoBanner />
            </Suspense>
            <div id="main" className="flex flex-1 flex-col">
              {children}
            </div>
            <SiteFooter />
          </LiveUpdates>
          <Toaster position="bottom-right" />
        </ThemeProvider>
      </body>
    </html>
  );
}
