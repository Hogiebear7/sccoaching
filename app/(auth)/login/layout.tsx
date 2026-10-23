import type { Metadata } from "next";
import type { ReactNode } from "react";

// The page itself is a client component, so its metadata lives here.
export const metadata: Metadata = {
  title: "Member login — S&C Performance Coaching",
  description: "Sign in to your S&C Performance Coaching member account.",
  // Kept out of search results: the sitemap lists only the public pages.
  robots: { index: false, follow: true },
};

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
