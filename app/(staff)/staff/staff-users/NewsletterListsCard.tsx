"use client";

import { useEffect, useState } from "react";

// The newsletter opt-in lists: how many people have opted in, and the downloads. Counts come from the same function as the downloads, so they match the files.
export function NewsletterListsCard() {
  const [counts, setCounts] = useState<{ gym: number; app: number; total: number } | null>(null);

  useEffect(() => {
    fetch("/api/staff/comms/marketing-export?count=1")
      .then((r) => r.json())
      .then((d) => (d?.data ? setCounts(d.data) : null))
      .catch(() => null);
  }, []);

  const link = "rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent";
  return (
    <div className="panel space-y-2 p-4">
      <p className="text-sm font-semibold">Newsletter lists</p>
      <p className="text-sm">
        {counts === null ? "Counting…" : `${counts.total} opted in (${counts.gym} gym, ${counts.app} app)`}
      </p>
      <p className="text-xs text-muted-foreground">
        Members who have opted in to news and offers. Download one list per group and import each into the matching Resend segment (Audience). You&apos;ll get a
        reminder here and by email when the list passes 10 people, and on 10 December for the first newsletter.
      </p>
      <div className="flex flex-wrap gap-2">
        <a href="/api/staff/comms/marketing-export?type=gym" className={link}>
          Download gym members
        </a>
        <a href="/api/staff/comms/marketing-export?type=app" className={link}>
          Download app members
        </a>
        <a href="/api/staff/comms/marketing-export" className={link}>
          Download everyone
        </a>
      </div>
    </div>
  );
}
