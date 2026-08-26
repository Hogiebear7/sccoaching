"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Status = "checking" | "success" | "needs-auth" | "error";

export function InviteRedeemPanel({ token }: { token: string }) {
  const [status, setStatus] = useState<Status>("checking");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function attempt() {
      try {
        const res = await fetch("/api/invites/redeem", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });

        const data = await res.json().catch(() => null);
        if (cancelled) return;

        if (res.status === 401) {
          setStatus("needs-auth");
          return;
        }

        if (!res.ok) {
          setStatus("error");
          setMessage(data?.message ?? "This invite couldn't be redeemed.");
          return;
        }

        setStatus("success");
        setMessage(data?.message ?? "Invite redeemed — welcome!");
      } catch {
        if (!cancelled) {
          setStatus("error");
          setMessage("Something went wrong. Please try again.");
        }
      }
    }

    attempt();
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (status === "checking") {
    return <p className="text-sm text-zinc-400">Checking your invite…</p>;
  }

  if (status === "success") {
    return (
      <div className="space-y-4">
        <p className="rounded-lg border border-primary/30 bg-primary/10 px-4 py-3 text-sm text-primary">
          {message}
        </p>
        <Link href="/dashboard" className="block w-full btn-primary px-5 py-2.5 text-center">
          Go to dashboard
        </Link>
      </div>
    );
  }

  if (status === "needs-auth") {
    return (
      <div className="space-y-4">
        <p className="text-sm text-zinc-400">
          Sign in or create an account with the email this invite was sent to, then come back to
          this same link — your access will apply automatically.
        </p>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Link href="/login" className="flex-1 btn-primary px-5 py-2.5 text-center">
            Sign in
          </Link>
          <Link
            href="/signup"
            className="flex-1 rounded-xl border border-zinc-700 px-5 py-2.5 text-center text-sm font-medium text-zinc-200 transition hover:bg-white/[0.04]"
          >
            Create account
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-400">
        {message}
      </p>
      <Link href="/login" className="block w-full btn-primary px-5 py-2.5 text-center">
        Back to sign in
      </Link>
    </div>
  );
}
