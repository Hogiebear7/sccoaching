import type { Metadata } from "next";
import type { ReactNode } from "react";

// The page itself is a client component, so its metadata lives here.
export const metadata: Metadata = {
  title: "Create account — S&C Performance Coaching",
  description: "Create your S&C Performance Coaching member account.",
};

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
