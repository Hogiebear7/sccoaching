import type { Metadata, Viewport } from "next";
import { Inter, Space_Grotesk } from "next/font/google";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

export const metadata: Metadata = {
  title: "S&C Performance Coaching",
  description: "Training, programmes, and bookings — all in one place.",
};

export const viewport: Viewport = {
  viewportFit: "cover",
  themeColor: "#1c1d22",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${spaceGrotesk.variable} h-full`}>
      <body data-design="v6-liquid-glass" className="min-h-full text-zinc-50 antialiased">
        {children}
      </body>
    </html>
  );
}
