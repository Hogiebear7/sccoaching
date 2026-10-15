"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import type { FormEvent } from "react";

import { DELETE_CONFIRM_WORD } from "@/lib/account-deletion";

const ROW_BUTTON =
  "inline-flex min-h-11 items-center justify-center rounded-lg border border-white/[0.1] bg-white/[0.05] px-3.5 py-2 text-[13px] font-medium text-zinc-300 transition-colors duration-150 hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-60";
const DANGER_BUTTON =
  "inline-flex min-h-11 items-center justify-center rounded-lg border border-red-500/40 bg-red-500/15 px-3.5 py-2 text-[13px] font-semibold text-red-200 transition-colors duration-150 hover:bg-red-500/25 disabled:cursor-not-allowed disabled:opacity-60";
const INPUT =
  "mt-1.5 block min-h-11 w-full rounded-lg border border-white/[0.12] bg-white/[0.04] px-3 py-2 text-sm text-zinc-100 outline-none focus:border-white/30";

/**
 * Settings -> Account: permanently delete the member's own account (required by the app stores). Two steps so it is never one click: the button
 * reveals a form that needs the current password and the word DELETE. The server re-checks both, refuses while a paid subscription is live, and
 * answers with a plain-language reason that is shown as-is. On success the member is sent to the login page.
 */
export function DeleteAccountPanel() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const passwordId = useId();
  const confirmId = useId();

  const ready = password.length > 0 && confirmText === DELETE_CONFIRM_WORD && !busy;

  function reset() {
    setOpen(false);
    setPassword("");
    setConfirmText("");
    setError(null);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/account/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, confirm: confirmText }),
      });
      const data = (await res.json().catch(() => null)) as { success?: boolean; message?: string } | null;
      if (res.ok && data?.success) {
        router.replace("/login");
        router.refresh();
        return;
      }
      setError(data?.message ?? "We couldn't delete your account. Please try again.");
    } catch {
      setError("We couldn't reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="surface-card px-5 py-4" data-testid="delete-account-panel">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-zinc-100">Delete account</p>
          <p className="mt-0.5 text-xs text-zinc-500">
            Permanently deletes your account and the training, nutrition, messages and profile data tied to it. This can&rsquo;t be undone.
          </p>
        </div>
        {!open && (
          <button type="button" onClick={() => setOpen(true)} className={ROW_BUTTON} aria-expanded={false}>
            Delete account…
          </button>
        )}
      </div>

      {open && (
        <form onSubmit={handleSubmit} className="mt-4 space-y-3 border-t border-white/[0.08] pt-4" aria-label="Confirm account deletion">
          <p className="text-xs text-zinc-400">
            Payment records the club must keep for accounting are retained without your name. If you have an active paid membership, cancel it first.
          </p>
          <div>
            <label htmlFor={passwordId} className="text-xs font-medium text-zinc-300">
              Your password
            </label>
            <input
              id={passwordId}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={INPUT}
            />
          </div>
          <div>
            <label htmlFor={confirmId} className="text-xs font-medium text-zinc-300">
              Type {DELETE_CONFIRM_WORD} to confirm
            </label>
            <input
              id={confirmId}
              type="text"
              autoComplete="off"
              autoCapitalize="characters"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              className={INPUT}
            />
          </div>
          <p role="alert" aria-live="assertive" className="min-h-4 text-xs text-red-300">
            {error}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" disabled={!ready} className={DANGER_BUTTON}>
              {busy ? "Deleting…" : "Permanently delete my account"}
            </button>
            <button type="button" onClick={reset} disabled={busy} className={ROW_BUTTON}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
