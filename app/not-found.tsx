import Link from "next/link";

// Global 404 — Next.js renders this for any unmatched route. Kept minimal and
// on-brand rather than the framework's bare default page, which would leak
// zero context to a real visitor who followed a stale/broken link.
export default function NotFound() {
  return (
    <main
      data-theme="navy"
      data-palette="gold"
      className="flex min-h-screen flex-col items-center justify-center px-6 py-16 text-center text-zinc-100"
    >
      <p className="text-mono text-[11px] uppercase tracking-[0.24em] text-gold">404</p>
      <h1 className="text-editorial mt-3 text-[32px] leading-[1.05] text-zinc-50 sm:text-[36px]">
        Page not found.
      </h1>
      <p className="mt-3 max-w-sm text-sm leading-relaxed text-zinc-400">
        The page you&rsquo;re looking for doesn&rsquo;t exist or may have moved.
      </p>
      <Link href="/" className="btn-primary mt-8 inline-flex px-5 py-3">
        Back to home
      </Link>
    </main>
  );
}
