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
      className={`block rounded-2xl border px-4 py-3 text-sm font-medium transition ${
        isActive
          ? "border-teal-500 bg-zinc-900 text-zinc-100"
          : "border-zinc-800 bg-zinc-950 text-zinc-300 hover:border-teal-500 hover:bg-zinc-900 hover:text-zinc-100"
      }`}
    >
      {children}
    </Link>
  );
}
