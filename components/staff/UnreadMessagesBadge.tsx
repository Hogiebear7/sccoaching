"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

// Client-fetched (not server-rendered) so it stays accurate across Next's
// client router cache reusing a stale layout render on soft navigation — see
// app/api/staff/messages/unread-count/route.ts for the full explanation.
// Re-fetches on every route change, which also covers "just marked read by
// opening a member's thread" since that's itself a navigation.
export function UnreadMessagesBadge() {
  const pathname = usePathname();
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/staff/messages/unread-count")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && typeof data?.count === "number") setCount(data.count);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [pathname]);

  if (!count) return null;

  return (
    <span className="rounded-full bg-blue-400/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-blue-300">
      {count}
    </span>
  );
}
