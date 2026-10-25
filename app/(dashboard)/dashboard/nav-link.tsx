"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

export function NavLink({
  href,
  children,
  tag,
  variant = "default",
}: {
  href: string;
  children: ReactNode;
  /** Optional right-aligned badge. Opt-in — omit it and the link renders as before. */
  tag?: { label: string; tone: "primary" | "legacy" };
  /** "member": the member-app sidebar style (gold left rule when current). Staff keep "default". */
  variant?: "default" | "member";
}) {
  const pathname = usePathname();
  const isActive = pathname === href;

  if (variant === "member") {
    return (
      <Link
        href={href}
        aria-current={isActive ? "page" : undefined}
        className={`flex min-h-10 items-center border-l-2 pl-[22px] pr-6 text-sm font-medium transition-colors duration-150 ${
          isActive
            ? "border-primary bg-white/[0.04] text-zinc-50"
            : "border-transparent text-zinc-400 hover:bg-white/[0.03] hover:text-zinc-100"
        }`}
      >
        {children}
      </Link>
    );
  }

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
