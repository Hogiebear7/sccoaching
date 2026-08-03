"use client";

import Link from "next/link";
import { useEffect } from "react";

// Global error boundary — Next.js renders this for any uncaught error thrown
// while rendering. Must be a client component. Kept minimal and on-brand
// rather than the framework's bare default "Application error" page.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[error boundary]", error);
  }, [error]);

  return (
    <main
      data-theme="navy"
      data-palette="gold"
      className="flex min-h-screen flex-col items-center justify-center px-6 py-16 text-center text-zinc-100"
    >
      <p className="text-mono text-[11px] uppercase tracking-[0.24em] text-gold">Something went wrong</p>
      <h1 className="text-editorial mt-3 text-[32px] leading-[1.05] text-zinc-50 sm:text-[36px]">
        That didn&rsquo;t work.
      </h1>
      <p className="mt-3 max-w-sm text-sm leading-relaxed text-zinc-400">
        Something went wrong on our end. Try again, or head back to the homepage.
      </p>
      <div className="mt-8 flex items-center gap-3">
        <button type="button" onClick={() => reset()} className="btn-primary px-5 py-3">
          Try again
        </button>
        <Link
          href="/"
          className="rounded-lg border border-white/[0.12] px-5 py-3 text-sm font-medium text-zinc-300 transition hover:border-white/[0.24] hover:text-zinc-100"
        >
          Back to home
        </Link>
      </div>
    </main>
  );
}
