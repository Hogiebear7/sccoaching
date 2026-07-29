"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { formatMembershipDate } from "@/lib/membership-status";

// Archive / restore controls for a member account. Archiving is the app's
// soft delete: sign-in is blocked and the member drops out of the default
// staff list, but bookings, purchases and the pass ledger are untouched.
export function MemberAccountPanel({
  memberId,
  email,
  archivedAt,
  canHardDelete,
}: {
  memberId: string;
  email: string;
  archivedAt: string | null;
  /** admin_manager only: permanently delete this (archived) member. */
  canHardDelete: boolean;
}) {
  const router = useRouter();
  const [isConfirming, setIsConfirming] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);

  const isArchived = archivedAt !== null;

  async function handleHardDelete() {
    setIsDeleting(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`/api/staff/members/${memberId}/delete`, { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.message ?? "Could not delete this account. Please try again.");
        return;
      }
      // The member no longer exists — leave the (now-dead) detail page.
      router.push("/staff/members");
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setIsDeleting(false);
    }
  }

  async function handleSetArchived(archived: boolean) {
    setIsSubmitting(true);
    setError(null);
    setMessage(null);

    try {
      const res = await fetch(`/api/staff/members/${memberId}/archive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        setError(data?.message ?? "Could not update this account. Please try again.");
        return;
      }

      setMessage(data?.message ?? (archived ? "Member archived." : "Member restored."));
      setIsConfirming(false);
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="panel p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">Account</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {isArchived
              ? `Archived ${formatMembershipDate(archivedAt)} — ${email} can't sign in.`
              : `${email} can sign in as normal.`}
          </p>
        </div>

        {isArchived ? (
          <button
            type="button"
            onClick={() => handleSetArchived(false)}
            disabled={isSubmitting}
            className="btn-primary px-4 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? "Restoring…" : "Restore account"}
          </button>
        ) : isConfirming ? (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => handleSetArchived(true)}
              disabled={isSubmitting}
              className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-2 text-xs font-semibold text-destructive transition hover:bg-destructive/20 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? "Archiving…" : "Confirm archive"}
            </button>
            <button
              type="button"
              onClick={() => setIsConfirming(false)}
              disabled={isSubmitting}
              className="rounded-xl border border-border px-4 py-2 text-xs font-medium text-foreground transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              setIsConfirming(true);
              setError(null);
              setMessage(null);
            }}
            className="rounded-xl border border-destructive/30 px-4 py-2 text-xs font-medium text-destructive transition hover:border-destructive/60"
          >
            Archive account
          </button>
        )}
      </div>

      {isConfirming && !isArchived ? (
        <p className="mt-3 text-xs text-muted-foreground">
          Archiving blocks sign-in and hides this member from the default list. Their bookings,
          purchases and pass history are kept, and the account can be restored at any time.
        </p>
      ) : null}

      {!isArchived ? (
        <p className="mt-3 text-[11px] text-muted-foreground/60">
          Archiving is reversible and keeps history auditable. Permanent deletion is only possible
          once an account is archived.
        </p>
      ) : null}

      {error ? (
        <p className="mt-3 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="mt-3 rounded-xl border border-primary/30 bg-primary/10 px-3 py-2 text-xs text-primary">
          {message}
        </p>
      ) : null}

      {/* Permanent deletion — admin_manager only, archived members only. The
          route enforces both rules server-side regardless of this UI. */}
      {isArchived && canHardDelete ? (
        <div className="mt-5 border-t border-destructive/20 pt-4">
          <h4 className="text-sm font-semibold text-destructive">Permanently delete</h4>
          <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
            Irreversibly removes this member and all their data — profile, bookings, subscription,
            purchases, pass ledger, recovery/cycle logs and messages. This frees any membership
            package or billing option that was blocked by their old subscription. Attended classes
            themselves are kept; only this member&apos;s booking is removed.
          </p>
          <label className="mt-3 block text-[11px] text-muted-foreground">
            Type the member&apos;s email <span className="font-mono text-foreground">{email}</span> to confirm:
            <input
              type="text"
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              placeholder={email}
              autoComplete="off"
              className="mt-1 w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground outline-none transition focus:border-destructive/60 focus:ring-2 focus:ring-destructive/15"
            />
          </label>
          <button
            type="button"
            onClick={handleHardDelete}
            disabled={isDeleting || deleteConfirmText.trim().toLowerCase() !== email.toLowerCase()}
            className="mt-3 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-2 text-xs font-semibold text-destructive transition hover:bg-destructive/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isDeleting ? "Deleting…" : "Permanently delete this member"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
