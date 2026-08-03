"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { describePackageAllowance } from "@/lib/catalog";
import type { MembershipPackageRecord, SubscriptionStatus } from "@/lib/db";
import {
  formatMembershipDate,
  isPeriodLapsed,
  SUBSCRIPTION_STATUS_LABEL,
  SUBSCRIPTION_STATUS_STYLE,
} from "@/lib/membership-status";
import { formatRemainingSessions } from "@/lib/scheduling-status";

export type MemberRow = {
  userId: string;
  email: string;
  fullName: string | null;
  joinedAt: string;
  archivedAt: string | null;
  currentPackageId: string | null;
  currentPlanName: string | null;
  currentStatus: SubscriptionStatus | null;
  currentPeriodEnd: string | null;
  currentRemainingSessions: number | null;
};

type SortOrder = "name-asc" | "name-desc" | "joined-desc" | "joined-asc";
type ExpiryFilter = "all" | "expiring-30" | "expired" | "no-expiry";

const SORT_LABEL: Record<SortOrder, string> = {
  "name-asc": "Name A–Z",
  "name-desc": "Name Z–A",
  "joined-desc": "Newest joined",
  "joined-asc": "Oldest joined",
};

const EXPIRY_LABEL: Record<ExpiryFilter, string> = {
  all: "Any expiry",
  "expiring-30": "Expiring within 30 days",
  expired: "Period ended",
  "no-expiry": "No expiry set",
};

function rowDisplayName(row: MemberRow): string {
  return row.fullName ?? row.email;
}

function matchesExpiry(row: MemberRow, filter: ExpiryFilter): boolean {
  const nowMs = Date.now();
  switch (filter) {
    case "all":
      return true;
    case "no-expiry":
      return row.currentPeriodEnd === null;
    case "expired":
      return (
        row.currentPeriodEnd !== null && new Date(row.currentPeriodEnd).getTime() < nowMs
      );
    case "expiring-30": {
      if (row.currentPeriodEnd === null) return false;
      const endMs = new Date(row.currentPeriodEnd).getTime();
      return endMs >= nowMs && endMs <= nowMs + 30 * 86_400_000;
    }
  }
}

export function MembersActivationView({
  rows,
  packages,
  canManageBilling,
  ageBreakdown,
}: {
  rows: MemberRow[];
  packages: MembershipPackageRecord[];
  /** Admin+ only. Coaches see the member list but can't activate memberships. */
  canManageBilling: boolean;
  /** Active-member headcount by age bracket — demographics, not billing. */
  ageBreakdown: { bracket: string; label: string; count: number }[];
}) {
  const [search, setSearch] = useState("");
  const [sortOrder, setSortOrder] = useState<SortOrder>("name-asc");
  const [expiryFilter, setExpiryFilter] = useState<ExpiryFilter>("all");
  const [showArchived, setShowArchived] = useState(false);

  const archivedCount = rows.filter((row) => row.archivedAt !== null).length;

  const visibleRows = useMemo(() => {
    const query = search.trim().toLowerCase();

    const filtered = rows.filter((row) => {
      if (!showArchived && row.archivedAt !== null) return false;
      if (!matchesExpiry(row, expiryFilter)) return false;
      if (!query) return true;
      // First name, last name, or email — a plain substring match covers all
      // three without needing to split names.
      return (
        (row.fullName ?? "").toLowerCase().includes(query) ||
        row.email.toLowerCase().includes(query)
      );
    });

    return filtered.sort((a, b) => {
      switch (sortOrder) {
        case "name-asc":
          return rowDisplayName(a).localeCompare(rowDisplayName(b));
        case "name-desc":
          return rowDisplayName(b).localeCompare(rowDisplayName(a));
        case "joined-desc":
          return b.joinedAt.localeCompare(a.joinedAt);
        case "joined-asc":
          return a.joinedAt.localeCompare(b.joinedAt);
      }
    });
  }, [rows, search, sortOrder, expiryFilter, showArchived]);

  return (
    <div className="space-y-5">
      <div>
        <p className="label-caps">Staff</p>
        <h1 className="text-display mt-1 text-[28px] leading-tight">Members</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          {rows.length} member{rows.length === 1 ? "" : "s"} · use the detail link for full profile
          and coach notes.
        </p>
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-300">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="mt-px h-3.5 w-3.5 shrink-0"
          >
            <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <span>
            Manual override — sets provider to &ldquo;none&rdquo;, resets session count to 0. Use
            for cash payments, comps, or local testing. If the member has a live Stripe
            subscription, it&rsquo;s cancelled automatically as part of this — you&rsquo;ll see a
            warning here if that fails and needs a manual follow-up in Stripe.
          </span>
        </div>
      </div>

      {/* Age breakdown — active members only */}
      {ageBreakdown.length > 0 ? (
        <div className="panel p-4">
          <p className="text-sm font-medium">Active members by age</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {ageBreakdown.map((row) => (
              <span
                key={row.bracket}
                className="rounded-full bg-secondary px-3 py-1 text-xs font-medium text-secondary-foreground"
              >
                {row.label} · {row.count}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {/* Search + filters */}
      {rows.length > 0 ? (
        <div className="panel flex flex-wrap items-center gap-2 p-3">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or email"
            aria-label="Search members by name or email"
            className="min-w-[180px] flex-1 input-field px-3 py-2 text-sm"
          />
          <select
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value as SortOrder)}
            aria-label="Sort members"
            className="input-field px-3 py-2 text-sm"
          >
            {(Object.keys(SORT_LABEL) as SortOrder[]).map((value) => (
              <option key={value} value={value}>
                {SORT_LABEL[value]}
              </option>
            ))}
          </select>
          <select
            value={expiryFilter}
            onChange={(e) => setExpiryFilter(e.target.value as ExpiryFilter)}
            aria-label="Filter by membership expiry"
            className="input-field px-3 py-2 text-sm"
          >
            {(Object.keys(EXPIRY_LABEL) as ExpiryFilter[]).map((value) => (
              <option key={value} value={value}>
                {EXPIRY_LABEL[value]}
              </option>
            ))}
          </select>
          {archivedCount > 0 ? (
            <label className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(e) => setShowArchived(e.target.checked)}
                className="h-4 w-4 accent-primary"
              />
              Show archived ({archivedCount})
            </label>
          ) : null}
        </div>
      ) : null}

      {packages.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/[0.12] bg-white/[0.02] p-6 text-center">
          <p className="text-sm font-medium">No packages yet</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Create a package in the{" "}
            <Link href="/staff/catalog" className="text-gold transition hover:text-gold/80">
              Catalog
            </Link>{" "}
            before activating memberships.
          </p>
        </div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No member accounts yet.</p>
      ) : visibleRows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No members match the current search and filters.
        </p>
      ) : (
        <div className="space-y-3">
          {visibleRows.map((row) => (
            <MemberCard key={row.userId} row={row} packages={packages} canManageBilling={canManageBilling} />
          ))}
        </div>
      )}
    </div>
  );
}

function MemberCard({
  row,
  packages,
  canManageBilling,
}: {
  row: MemberRow;
  packages: MembershipPackageRecord[];
  canManageBilling: boolean;
}) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  // Seed from the current package only when it's in the selectable list — a
  // hidden package isn't, and the select would show one but submit another.
  const [selectedPackageId, setSelectedPackageId] = useState(
    row.currentPackageId && packages.some((p) => p.id === row.currentPackageId)
      ? row.currentPackageId
      : packages[0]?.id ?? ""
  );
  const [periodEnd, setPeriodEnd] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const periodLapsed =
    row.currentStatus !== null &&
    isPeriodLapsed({ status: row.currentStatus, currentPeriodEnd: row.currentPeriodEnd });

  const isCurrentlyActive = row.currentStatus === "active" && !periodLapsed;

  async function handleActivate() {
    if (!selectedPackageId) {
      setError("Select a package first.");
      return;
    }

    setError(null);
    setSuccessMsg(null);
    setIsSubmitting(true);

    try {
      const res = await fetch("/api/admin/membership/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: row.userId,
          packageId: selectedPackageId,
          periodEndIso: periodEnd || undefined,
        }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        setError(data?.message ?? "Could not activate membership.");
        return;
      }

      setSuccessMsg(data?.message ?? "Activated.");
      setShowForm(false);
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="panel p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">
            {row.fullName ?? row.email}
          </p>
          {row.fullName ? (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{row.email}</p>
          ) : null}

          <div className="mt-2 flex flex-wrap items-center gap-2">
            {row.archivedAt ? (
              <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-semibold text-muted-foreground">
                Archived
              </span>
            ) : null}
            {row.currentStatus ? (
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                  periodLapsed
                    ? "bg-destructive/10 text-destructive"
                    : SUBSCRIPTION_STATUS_STYLE[row.currentStatus]
                }`}
              >
                {periodLapsed
                  ? "Period ended"
                  : SUBSCRIPTION_STATUS_LABEL[row.currentStatus]}
              </span>
            ) : (
              <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground">
                No subscription
              </span>
            )}

            {row.currentPlanName ? (
              <span className="text-xs text-muted-foreground">{row.currentPlanName}</span>
            ) : null}

            {isCurrentlyActive && row.currentRemainingSessions !== null ? (
              <span className="text-xs text-muted-foreground">
                {formatRemainingSessions(row.currentRemainingSessions)}
              </span>
            ) : null}

            {row.currentPeriodEnd ? (
              <span className="text-xs text-muted-foreground">
                Period ends {formatMembershipDate(row.currentPeriodEnd)}
              </span>
            ) : isCurrentlyActive ? (
              <span className="text-xs text-muted-foreground/50">No expiry set</span>
            ) : null}

            <span className="text-xs text-muted-foreground/50">
              Joined {formatMembershipDate(row.joinedAt)}
            </span>
          </div>
        </div>

        <div className="flex shrink-0 gap-2">
          <Link
            href={`/staff/members/${row.userId}`}
            className="rounded-xl border border-border px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-accent"
          >
            Details →
          </Link>
          {canManageBilling && packages.length > 0 && row.archivedAt === null ? (
            <button
              type="button"
              onClick={() => {
                setShowForm(!showForm);
                setError(null);
                setSuccessMsg(null);
              }}
              className="btn-primary px-3 py-1.5 text-xs"
            >
              {showForm ? "Cancel" : isCurrentlyActive ? "Re-activate" : "Activate"}
            </button>
          ) : null}
        </div>
      </div>

      {successMsg ? (
        <p className="mt-3 rounded-xl border border-primary/30 bg-primary/10 px-3 py-2 text-xs text-primary">
          {successMsg}
        </p>
      ) : null}

      {showForm ? (
        <div className="mt-3 space-y-3 border-t border-border pt-3">
          {error ? (
            <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          ) : null}

          <div className="flex flex-col gap-2 sm:flex-row">
            <select
              value={selectedPackageId}
              onChange={(e) => setSelectedPackageId(e.target.value)}
              className="flex-1 rounded-xl border border-border bg-input px-3 py-2 text-xs text-foreground outline-none transition focus:border-teal-600/60 focus:ring-2 focus:ring-teal-600/15"
            >
              {packages.map((pkg) => (
                <option key={pkg.id} value={pkg.id}>
                  {pkg.name} — {describePackageAllowance(pkg)}
                </option>
              ))}
            </select>

            <input
              type="date"
              value={periodEnd}
              onChange={(e) => setPeriodEnd(e.target.value)}
              aria-label="Period end date (optional)"
              className="rounded-xl border border-border bg-input px-3 py-2 text-xs text-foreground outline-none transition focus:border-teal-600/60 focus:ring-2 focus:ring-teal-600/15"
            />

            <button
              type="button"
              onClick={handleActivate}
              disabled={isSubmitting}
              className="btn-primary px-4 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? "Activating…" : "Confirm"}
            </button>
          </div>

          <p className="text-[11px] text-muted-foreground/60">
            Period end is optional — leave blank for no expiry. Session count resets to 0.
          </p>
        </div>
      ) : null}
    </div>
  );
}
