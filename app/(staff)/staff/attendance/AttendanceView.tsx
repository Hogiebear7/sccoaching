"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { DataTable, type DataTableColumn } from "@/components/staff/DataTable";

type LeaderboardRow = {
  userId: string;
  name: string;
  email: string;
  classesAttended: number;
  last30Days: number;
  lastAttended: string | null;
};

const DAY_MS = 86_400_000;
const daysSince = (date: string | null) => (date ? Math.floor((Date.now() - new Date(`${date}T00:00:00Z`).getTime()) / DAY_MS) : null);

const COLUMNS: DataTableColumn<LeaderboardRow>[] = [
  {
    key: "name",
    header: "Member",
    value: (r) => r.name,
    render: (r) => (
      <Link href={`/staff/members/${r.userId}`} className="text-gold transition hover:text-gold/80">
        {r.name}
      </Link>
    ),
  },
  { key: "email", header: "Email", value: (r) => r.email },
  { key: "last30", header: "Last 30 days", value: (r) => r.last30Days, numeric: true },
  { key: "total", header: "All time", value: (r) => r.classesAttended, numeric: true },
  {
    key: "last",
    header: "Last class",
    value: (r) => r.lastAttended,
    render: (r) => (r.lastAttended ? new Date(`${r.lastAttended}T00:00:00Z`).toLocaleDateString("en-IE", { day: "numeric", month: "short", year: "numeric" }) : "Never"),
  },
];

const CHIPS = [
  { key: "all", label: "Everyone", match: () => true },
  { key: "quiet", label: "No class in 14 days", match: (r: LeaderboardRow) => (daysSince(r.lastAttended) ?? Infinity) > 14 },
  { key: "never", label: "Never attended", match: (r: LeaderboardRow) => r.classesAttended === 0 },
];

type WatchlistRow = {
  id: string;
  userId: string;
  name: string;
  email: string | null;
  monthKey: string;
  missCount: number;
  addedAt: string;
};

function monthLabel(monthKey: string): string {
  const [year, month] = monthKey.split("-").map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString("en-IE", { month: "long", year: "numeric" });
}

export function AttendanceView({
  leaderboard,
  watchlist,
  canManageWatchlist,
}: {
  leaderboard: LeaderboardRow[];
  watchlist: WatchlistRow[];
  canManageWatchlist: boolean;
}) {
  const router = useRouter();
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleRemoveFromWatchlist(id: string) {
    setRemovingId(id);
    setError(null);
    try {
      const res = await fetch("/api/staff/attendance/watchlist/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.message ?? "Could not remove this entry.");
        return;
      }
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="label-caps">Staff</p>
        <h2 className="text-display mt-1 text-[28px] leading-tight">Attendance</h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Members are flagged automatically an hour after a booked class ends if nobody checked
          them in. A second missed class in a calendar month adds them to the watchlist below —
          members are told about the 3-miss policy from their first miss, but nothing here
          suspends a membership automatically; that decision stays with staff.
        </p>
      </div>

      {error ? (
        <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</p>
      ) : null}

      {/* Watchlist */}
      <div className="panel p-5">
        <h3 className="text-base font-semibold">Watchlist</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Members who&apos;ve missed 2 or more classes in a single calendar month. Staff-only —
          members never see this list.
        </p>

        {watchlist.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">Nobody is on the watchlist right now.</p>
        ) : (
          <div className="mt-4 space-y-2">
            {watchlist.map((entry) => (
              <div key={entry.id} className="well flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <Link href={`/staff/members/${entry.userId}`} className="text-sm font-medium text-gold transition hover:text-gold/80">
                    {entry.name}
                  </Link>
                  {entry.email ? <span className="text-xs text-muted-foreground"> · {entry.email}</span> : null}
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {entry.missCount} missed classes in {monthLabel(entry.monthKey)}
                  </p>
                </div>
                {canManageWatchlist ? (
                  <button
                    type="button"
                    onClick={() => handleRemoveFromWatchlist(entry.id)}
                    disabled={removingId === entry.id}
                    className="shrink-0 rounded-xl border border-border px-3 py-1 text-xs font-medium text-foreground transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {removingId === entry.id ? "Removing…" : "Remove from watchlist"}
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Attendance by member */}
      <div className="panel p-5">
        <h3 className="text-base font-semibold">Attendance by member</h3>
        <p className="mt-1 mb-4 text-xs text-muted-foreground">Classes attended, last 30 days and all time. Sort any column; export exactly what you see.</p>
        <DataTable
          rows={leaderboard}
          columns={COLUMNS}
          rowKey={(r) => r.userId}
          searchText={(r) => `${r.name} ${r.email}`}
          searchPlaceholder="Search members"
          chips={CHIPS}
          defaultSort={{ key: "last30", dir: "desc" }}
          exportName="sc-attendance"
          empty="No members match."
        />
      </div>
    </div>
  );
}
