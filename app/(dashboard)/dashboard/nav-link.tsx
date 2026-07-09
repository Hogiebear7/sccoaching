"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

export function NavLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const isActive = pathname === href;

  return (
    <Link
      href={href}
      className={`block rounded-xl border px-4 py-2.5 text-sm font-medium transition-colors duration-150 ${
        isActive
          ? "border-blue-400/40 bg-white/[0.06] text-zinc-50"
          : "border-transparent text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-100"
      }`}
    >
      {children}
    </Link>
  );
}
