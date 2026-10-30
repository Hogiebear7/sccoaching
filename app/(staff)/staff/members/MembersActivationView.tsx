"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { InvitePanel } from "@/components/staff/InvitePanel";
import { describePackageAllowance } from "@/lib/catalog";
import { csvText, downloadCsv } from "@/lib/csv";
import type { MembershipPackageRecord, SubscriptionStatus } from "@/lib/db";
import {
  formatMembershipDate,
  isPeriodLapsed,
  SUBSCRIPTION_STATUS_LABEL,
  SUBSCRIPTION_STATUS_STYLE,
} from "@/lib/membership-status";
import { STAFF_ROLE_LABEL, type StaffRole } from "@/lib/permissions";
import type { UserRole } from "@/lib/profile-schema";
import { formatRemainingSessions } from "@/lib/scheduling-status";

export type MemberRow = {
  userId: string;
  email: string;
  fullName: string | null;
  joinedAt: string;
  archivedAt: string | null;
  role: UserRole;
  currentPackageId: string | null;
  currentPlanName: string | null;
  currentStatus: SubscriptionStatus | null;
  currentPeriodEnd: string | null;
  currentRemainingSessions: number | null;
  /** Members only (null for staff rows): which list group they are in (lib/member-list-group.ts). */
  membershipGroup: "current" | "paused" | "past" | "none" | null;
  starred: boolean;
};

// Which members the list shows (owner request 2026-10-29). By default only the gym's own members (current and paused); the rest are a filter
// away, starred members have their own view, and a search always looks through everyone. Staff accounts are always listed.
type GroupFilter = "current" | "past" | "none" | "starred" | "all";
const GROUP_FILTER_LABEL: Record<GroupFilter, string> = {
  current: "Current & paused",
  past: "Past members",
  none: "Non-members",
  starred: "Starred",
  all: "Everyone",
};
function inGroupFilter(row: MemberRow, filter: GroupFilter): boolean {
  if (row.role !== "member" || filter === "all") return true;
  if (filter === "starred") return row.starred;
  if (filter === "current") return row.membershipGroup === "current" || row.membershipGroup === "paused";
  return row.membershipGroup === filter;
}

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

// Gym Membership and COMPLIMENTARY digital access are independent (owner decision D1). A paid store subscription is never
// created or ended from here: only Google Play or the App Store can do that.
type BulkAction = "membership" | "free" | "app_subscription" | "digital_revoke";
const BULK_TIER_LABEL: Record<BulkAction, string> = {
  membership: "Grant gym Membership",
  free: "End gym Membership",
  app_subscription: "Grant complimentary digital access",
  digital_revoke: "Withdraw complimentary digital access",
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
  canGrantTier,
  ageBreakdown,
}: {
  rows: MemberRow[];
  packages: MembershipPackageRecord[];
  /** Admin+ only. Coaches see the member list but can't activate memberships. */
  canManageBilling: boolean;
  /** Admin+ only. Gates the bulk/plan-filter "grant tier" tooling below. */
  canGrantTier: boolean;
  /** Active-member headcount by age bracket — demographics, not billing. */
  ageBreakdown: { bracket: string; label: string; count: number }[];
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [sortOrder, setSortOrder] = useState<SortOrder>("name-asc");
  const [expiryFilter, setExpiryFilter] = useState<ExpiryFilter>("all");
  const [planFilter, setPlanFilter] = useState<string>("all");
  const [showArchived, setShowArchived] = useState(false);
  const [groupFilter, setGroupFilter] = useState<GroupFilter>("current");
  const [pageSize, setPageSize] = useState<10 | 20 | 50>(10);
  const [page, setPage] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkTier, setBulkTier] = useState<BulkAction>("membership");
  const [isBulkSubmitting, setIsBulkSubmitting] = useState(false);
  const [bulkSummary, setBulkSummary] = useState<string | null>(null);

  const archivedCount = rows.filter((row) => row.archivedAt !== null).length;
  const memberCount = rows.filter((row) => row.role === "member").length;
  const staffCount = rows.length - memberCount;

  const planOptions = useMemo(() => {
    const names = new Set<string>();
    for (const row of rows) {
      if (row.role === "member" && row.currentPlanName) names.add(row.currentPlanName);
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [rows]);

  const visibleRows = useMemo(() => {
    const query = search.trim().toLowerCase();

    const filtered = rows.filter((row) => {
      if (!showArchived && row.archivedAt !== null) return false;
      // None of the expiry/plan filters mean anything for a staff row (no
      // subscription period to expire) — excluded rather than silently
      // falling into "No expiry set", which would misleadingly imply they
      // once had a subscription.
      if (row.role !== "member" && (expiryFilter !== "all" || planFilter !== "all")) return false;
      if (!matchesExpiry(row, expiryFilter)) return false;
      if (planFilter !== "all" && row.currentPlanName !== planFilter) return false;
      // A search looks through everyone; without one, the group filter decides.
      if (!query) return inGroupFilter(row, groupFilter);
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
  }, [rows, search, sortOrder, expiryFilter, planFilter, showArchived, groupFilter]);

  const selectableVisibleIds = useMemo(
    () => visibleRows.filter((row) => row.role === "member").map((row) => row.userId),
    [visibleRows]
  );
  const allVisibleSelected =
    selectableVisibleIds.length > 0 && selectableVisibleIds.every((id) => selectedIds.has(id));

  // "Export this view": exactly the members the current search, group, plan and expiry filters show (every page), as CSV.
  function exportView() {
    const groupLabel: Record<string, string> = { current: "Current", paused: "Paused", past: "Past member", none: "Non-member" };
    downloadCsv(
      `sc-members-${new Date().toISOString().slice(0, 10)}.csv`,
      csvText(
        ["Name", "Email", "Group", "Plan", "Status", "Ends", "Joined", "Archived", "Starred"],
        visibleRows.map((r) => [
          r.fullName,
          r.email,
          r.membershipGroup ? groupLabel[r.membershipGroup] ?? r.membershipGroup : null,
          r.currentPlanName,
          r.currentStatus,
          r.currentPeriodEnd?.slice(0, 10) ?? null,
          r.joinedAt.slice(0, 10),
          r.archivedAt ? r.archivedAt.slice(0, 10) : null,
          r.starred ? "Yes" : null,
        ])
      )
    );
  }

  function toggleSelected(userId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  function toggleSelectAllVisible() {
    setSelectedIds((prev) => {
      if (allVisibleSelected) {
        const next = new Set(prev);
        for (const id of selectableVisibleIds) next.delete(id);
        return next;
      }
      return new Set([...prev, ...selectableVisibleIds]);
    });
  }

  async function handleBulkGrant() {
    setIsBulkSubmitting(true);
    setBulkSummary(null);

    try {
      const res = await fetch("/api/staff/members/bulk-tier", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userIds: Array.from(selectedIds), tier: bulkTier }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        setBulkSummary(data?.message ?? "Could not update members. Please try again.");
        return;
      }

      const results: { userId: string; ok: boolean; message: string }[] = data?.data?.results ?? [];
      const okCount = results.filter((r) => r.ok).length;
      const failed = results.filter((r) => !r.ok);
      setBulkSummary(
        failed.length === 0
          ? `${BULK_TIER_LABEL[bulkTier]}: ${okCount} member${okCount === 1 ? "" : "s"} updated.`
          : `Updated ${okCount} member${okCount === 1 ? "" : "s"} — ${failed.length} failed: ${failed[0].message}${failed.length > 1 ? ` (+${failed.length - 1} more)` : ""}`
      );
      setSelectedIds(new Set());
      router.refresh();
    } catch {
      setBulkSummary("Something went wrong. Please try again.");
    } finally {
      setIsBulkSubmitting(false);
    }
  }

  // Reset back to page 1 whenever the underlying result set could have
  // shifted out from under the current page (new search, filter, or size).
  const resultsKey = `${search}|${sortOrder}|${expiryFilter}|${planFilter}|${showArchived}|${groupFilter}|${pageSize}`;
  const [lastResultsKey, setLastResultsKey] = useState(resultsKey);
  if (resultsKey !== lastResultsKey) {
    setLastResultsKey(resultsKey);
    setPage(0);
  }

  const pageCount = Math.max(1, Math.ceil(visibleRows.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const pagedRows = visibleRows.slice(currentPage * pageSize, currentPage * pageSize + pageSize);

  return (
    <div className="space-y-5">
      <div>
        <p className="label-caps">Staff</p>
        <h1 className="text-display mt-1 text-[28px] leading-tight">Members</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          {memberCount} member{memberCount === 1 ? "" : "s"}
          {staffCount > 0 ? ` · ${staffCount} staff` : ""} · use the detail link for full profile
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

      {canManageBilling ? <InvitePanel /> : null}

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
            value={groupFilter}
            onChange={(e) => setGroupFilter(e.target.value as GroupFilter)}
            aria-label="Which members to show"
            className="input-field px-3 py-2 text-sm"
          >
            {(Object.keys(GROUP_FILTER_LABEL) as GroupFilter[]).map((value) => (
              <option key={value} value={value}>
                {GROUP_FILTER_LABEL[value]}
              </option>
            ))}
          </select>
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
          {canGrantTier && planOptions.length > 0 ? (
            <select
              value={planFilter}
              onChange={(e) => setPlanFilter(e.target.value)}
              aria-label="Filter by plan"
              className="input-field px-3 py-2 text-sm"
            >
              <option value="all">Any plan</option>
              {planOptions.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          ) : null}
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
          <label className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
            Per page
            <select
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value) as 10 | 20 | 50)}
              aria-label="Members per page"
              className="input-field px-2 py-1.5 text-xs"
            >
              <option value={10}>10</option>
              <option value={20}>20</option>
              <option value={50}>50</option>
            </select>
          </label>
        </div>
      ) : null}

      {/* Bulk tier grant — select filtered members (e.g. a plan filter
          isolating a specific package) and grant them all a tier in one
          action, instead of one staff click per member. */}
      {canGrantTier && selectableVisibleIds.length > 0 ? (
        <div className="panel flex flex-wrap items-center gap-3 p-3">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={allVisibleSelected}
              onChange={toggleSelectAllVisible}
              aria-label="Select all filtered members"
              className="h-4 w-4 accent-primary"
            />
            Select all filtered ({selectableVisibleIds.length})
          </label>

          {selectedIds.size > 0 ? (
            <>
              <span className="text-xs text-muted-foreground">{selectedIds.size} selected</span>
              <select
                value={bulkTier}
                onChange={(e) => setBulkTier(e.target.value as BulkAction)}
                aria-label="Access change for selected members"
                className="input-field px-2 py-1.5 text-xs"
              >
                {(Object.keys(BULK_TIER_LABEL) as BulkAction[]).map((value) => (
                  <option key={value} value={value}>
                    {BULK_TIER_LABEL[value]}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={handleBulkGrant}
                disabled={isBulkSubmitting}
                className="btn-primary px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isBulkSubmitting ? "Updating…" : `Apply to ${selectedIds.size} selected`}
              </button>
            </>
          ) : null}

          {bulkSummary ? <p className="w-full text-xs text-muted-foreground">{bulkSummary}</p> : null}
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
          {search.trim()
            ? "No members match the current search and filters."
            : `No members in "${GROUP_FILTER_LABEL[groupFilter]}". Search by name or email to find anyone.`}
        </p>
      ) : (
        <div className="space-y-3">
          <div className="flex justify-end">
            <button type="button" onClick={exportView} className="text-xs font-semibold text-gold transition hover:text-gold/80">
              Export this view ({visibleRows.length} member{visibleRows.length === 1 ? "" : "s"}, CSV)
            </button>
          </div>
          {pagedRows.map((row) => (
            <MemberCard
              key={row.userId}
              row={row}
              packages={packages}
              canManageBilling={canManageBilling}
              selectable={canGrantTier && row.role === "member"}
              selected={selectedIds.has(row.userId)}
              onToggleSelect={() => toggleSelected(row.userId)}
            />
          ))}

          {pageCount > 1 ? (
            <div className="flex items-center justify-between pt-1">
              <p className="text-xs text-muted-foreground">
                Page {currentPage + 1} of {pageCount} · {visibleRows.length} member
                {visibleRows.length === 1 ? "" : "s"}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={currentPage === 0}
                  className="rounded-xl border border-border px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Previous
                </button>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                  disabled={currentPage >= pageCount - 1}
                  className="rounded-xl border border-border px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function MemberCard({
  row,
  packages,
  canManageBilling,
  selectable,
  selected,
  onToggleSelect,
}: {
  row: MemberRow;
  packages: MembershipPackageRecord[];
  canManageBilling: boolean;
  /** Whether this row can be bulk-selected for a tier grant (member rows only, when the viewer has members.grantTier). */
  selectable: boolean;
  selected: boolean;
  onToggleSelect: () => void;
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
  const [isStarring, setIsStarring] = useState(false);

  async function toggleStar() {
    setIsStarring(true);
    try {
      const res = await fetch(`/api/staff/members/${row.userId}/star`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ starred: !row.starred }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.message ?? "Could not change the star. Please try again.");
        return;
      }
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setIsStarring(false);
    }
  }

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
        <div className="flex min-w-0 items-start gap-2.5">
          {selectable ? (
            <input
              type="checkbox"
              checked={selected}
              onChange={onToggleSelect}
              aria-label={`Select ${row.fullName ?? row.email} for bulk tier grant`}
              className="mt-1 h-4 w-4 shrink-0 accent-primary"
            />
          ) : null}
          {row.role === "member" ? (
            <button
              type="button"
              onClick={toggleStar}
              disabled={isStarring}
              aria-pressed={row.starred}
              aria-label={row.starred ? `Remove the star from ${row.fullName ?? row.email}` : `Star ${row.fullName ?? row.email}`}
              title={row.starred ? "Starred" : "Star to find them easily"}
              className={`-mt-0.5 shrink-0 text-lg leading-none transition disabled:opacity-50 ${row.starred ? "text-gold" : "text-muted-foreground/50 hover:text-gold"}`}
            >
              {row.starred ? "★" : "☆"}
            </button>
          ) : null}
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
            {row.role !== "member" ? (
              <span className="rounded-full bg-secondary px-2.5 py-0.5 text-xs font-semibold text-secondary-foreground">
                {STAFF_ROLE_LABEL[row.role as StaffRole] ?? "Staff"}
              </span>
            ) : row.currentStatus ? (
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
        </div>

        <div className="flex shrink-0 gap-2">
          <Link
            href={`/staff/members/${row.userId}`}
            className="rounded-xl border border-border px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-accent"
          >
            Details →
          </Link>
          {canManageBilling && packages.length > 0 && row.archivedAt === null && row.role === "member" ? (
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
