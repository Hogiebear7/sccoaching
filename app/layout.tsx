import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";

import { ChunkErrorRecovery } from "@/components/ChunkErrorRecovery";
import { SplashIntro } from "@/components/SplashIntro";

// Self-hosted via next/font/local — see app/fonts/README.md for provenance
// (fetched from Google's own font-serving API, the same source next/font/google
// used) and each family's app/fonts/<family>/OFL.txt license. This removes the
// build-time fetch to Google's servers that next/font/google performed on every
// build (and which failed once on the Hostinger build host). Weight/style
// coverage, the latin-only subset and every CSS variable name are unchanged
// from the previous next/font/google configuration.
const inter = localFont({
  variable: "--font-inter",
  src: "./fonts/inter/Inter-Variable.woff2",
  weight: "100 900",
  style: "normal",
});
// A single variable file backs all three weights below — confirmed
// byte-identical to what Google's own API served for wght 500/600/700 (that
// family ships one variable binary on Google Fonts, not separate static
// instances), so one file is reused across three font-face declarations
// rather than storing the same bytes three times.
const spaceGrotesk = localFont({
  variable: "--font-space-grotesk",
  src: [
    { path: "./fonts/space-grotesk/SpaceGrotesk-Variable.woff2", weight: "500", style: "normal" },
    { path: "./fonts/space-grotesk/SpaceGrotesk-Variable.woff2", weight: "600", style: "normal" },
    { path: "./fonts/space-grotesk/SpaceGrotesk-Variable.woff2", weight: "700", style: "normal" },
  ],
});
// Athletic condensed display face for hero/marketing headlines (opt-in via the
// .text-condensed utility). Body + most UI stay on Inter/Space Grotesk.
// Same one-file-three-weights situation as Space Grotesk above.
const oswald = localFont({
  variable: "--font-oswald",
  src: [
    { path: "./fonts/oswald/Oswald-Variable.woff2", weight: "500", style: "normal" },
    { path: "./fonts/oswald/Oswald-Variable.woff2", weight: "600", style: "normal" },
    { path: "./fonts/oswald/Oswald-Variable.woff2", weight: "700", style: "normal" },
  ],
});
// Editorial serif display face for the navy/gold redesign's signature
// headline moments (opt-in via the .text-editorial utility) — does not
// replace .text-condensed, which stays on Oswald for existing surfaces.
// One variable file per style (Google serves the same binary for weight 600
// and 900 within each style), so two files cover all four weight/style
// combinations.
const fraunces = localFont({
  variable: "--font-fraunces",
  src: [
    { path: "./fonts/fraunces/Fraunces-Variable-Normal.woff2", weight: "600", style: "normal" },
    { path: "./fonts/fraunces/Fraunces-Variable-Normal.woff2", weight: "900", style: "normal" },
    { path: "./fonts/fraunces/Fraunces-Variable-Italic.woff2", weight: "600", style: "italic" },
    { path: "./fonts/fraunces/Fraunces-Variable-Italic.woff2", weight: "900", style: "italic" },
  ],
});
// Technical/data face for the "Session Ledger" motif and other tabular
// readouts in the index.html-blueprint redesign — matches the static
// mockup's font stack exactly (Fraunces + Inter + IBM Plex Mono). IBM Plex
// Mono ships genuinely distinct static files per weight (no shared binary).
const ibmPlexMono = localFont({
  variable: "--font-plex-mono",
  src: [
    { path: "./fonts/ibm-plex-mono/IBMPlexMono-Regular.woff2", weight: "400", style: "normal" },
    { path: "./fonts/ibm-plex-mono/IBMPlexMono-Medium.woff2", weight: "500", style: "normal" },
    { path: "./fonts/ibm-plex-mono/IBMPlexMono-SemiBold.woff2", weight: "600", style: "normal" },
  ],
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
        <ChunkErrorRecovery />
        <SplashIntro />
        {children}
      </body>
    </html>
  );
}
