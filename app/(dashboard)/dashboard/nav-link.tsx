"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

export function NavLink({
  href,
  children,
  tag,
}: {
  href: string;
  children: ReactNode;
  /** Optional right-aligned badge. Opt-in — omit it and the link renders as before. */
  tag?: { label: string; tone: "primary" | "legacy" };
}) {
  const pathname = usePathname();
  const isActive = pathname === href;

  return (
    <Link
      href={href}
      className={`block rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors duration-150 ${
        isActive
          ? "border-blue-400/40 bg-white/[0.06] text-zinc-50"
          : "border-transparent text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-100"
      }`}
    >
      {tag ? (
        <span className="flex items-center justify-between gap-2">
          <span>{children}</span>
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
              tag.tone === "primary"
                ? "bg-blue-400/15 text-blue-300"
                : "bg-zinc-800 text-zinc-500"
            }`}
          >
            {tag.label}
          </span>
        </span>
      ) : (
        children
      )}
    </Link>
  );
}
