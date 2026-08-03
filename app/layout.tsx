import type { Metadata, Viewport } from "next";
import { Fraunces, IBM_Plex_Mono, Inter, Oswald, Space_Grotesk } from "next/font/google";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});
// Athletic condensed display face for hero/marketing headlines (opt-in via the
// .text-condensed utility). Body + most UI stay on Inter/Space Grotesk.
const oswald = Oswald({
  variable: "--font-oswald",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});
// Editorial serif display face for the navy/gold redesign's signature
// headline moments (opt-in via the .text-editorial utility) — does not
// replace .text-condensed, which stays on Oswald for existing surfaces.
const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  weight: ["600", "900"],
  style: ["normal", "italic"],
});
// Technical/data face for the "Session Ledger" motif and other tabular
// readouts in the index.html-blueprint redesign — matches the static
// mockup's font stack exactly (Fraunces + Inter + IBM Plex Mono).
const ibmPlexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "S&C Performance Coaching",
  description: "Science-backed training, nutrition and recovery — all in one place.",
};

export const viewport: Viewport = {
  viewportFit: "cover",
  themeColor: "#1c1d22",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${spaceGrotesk.variable} ${oswald.variable} ${fraunces.variable} ${ibmPlexMono.variable} h-full`}>
      <body data-design="v6-liquid-glass" className="min-h-full text-zinc-50 antialiased">
        {children}
      </body>
    </html>
  );
}
