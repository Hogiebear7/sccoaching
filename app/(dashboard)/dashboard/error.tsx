"use client";

import Link from "next/link";
import { useEffect } from "react";

// Member-app error boundary: keeps the app bar and tab bar (the layout stays
// mounted) and offers a retry, instead of dropping to the full-page global
// error screen.
export default function DashboardError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error("[dashboard error boundary]", error);
  }, [error]);

  return (
    <section className="space-y-6">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">Something went wrong</p>
        <h1 className="mt-1.5 text-headline text-[44px] text-zinc-50">That didn&rsquo;t load.</h1>
        <p className="mt-2 max-w-xl text-[15px] leading-relaxed text-zinc-300">
          This screen hit a problem. Your data is safe. Try again, or head back to Home.
        </p>
      </header>
      <div className="flex flex-col gap-3 sm:flex-row">
        <button type="button" onClick={() => retry()} className="btn-primary px-6 text-sm">
          Try again
        </button>
        <Link
          href="/dashboard"
          className="inline-flex min-h-11 items-center justify-center rounded-[3px] border border-white/[0.16] px-6 text-sm font-semibold text-zinc-100 transition-colors duration-150 hover:border-primary/50"
        >
          Go to Home
        </Link>
      </div>
      {error.digest ? <p className="text-xs text-zinc-500">Reference: {error.digest}</p> : null}
    </section>
  );
}
