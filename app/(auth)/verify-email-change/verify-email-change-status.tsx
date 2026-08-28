"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Status = "confirming" | "success" | "error";

export function VerifyEmailChangeStatus({ token }: { token: string }) {
  const [status, setStatus] = useState<Status>("confirming");
  const [message, setMessage] = useState<string | null>(null);
  const [newEmail, setNewEmail] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function confirm() {
      try {
        const res = await fetch("/api/profile/change-email/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        const data = await res.json().catch(() => null);

        if (cancelled) return;

        if (!res.ok || !data?.success) {
          setStatus("error");
          setMessage(data?.message ?? "This link has expired or was already used.");
          return;
        }

        setStatus("success");
        setNewEmail(data.email ?? null);
      } catch {
        if (!cancelled) {
          setStatus("error");
          setMessage("Something went wrong. Please try again.");
        }
      }
    }

    void confirm();
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (status === "confirming") {
    return <p className="text-sm text-zinc-400">Confirming your new email address…</p>;
  }

  if (status === "error") {
    return (
      <div className="space-y-4">
        <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {message}
        </p>
        <Link href="/login" className="text-sm text-zinc-400 transition hover:text-zinc-200">
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-400">
        {newEmail ? `Your email has been updated to ${newEmail}.` : "Your email has been updated."}
      </p>
      <Link href="/login" className="text-sm text-zinc-400 transition hover:text-zinc-200">
        Back to sign in
      </Link>
    </div>
  );
}
