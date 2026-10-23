"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { FormMessage } from "@/components/auth/fields";

type Status = "confirming" | "success" | "error";

const LINK_BUTTON =
  "inline-flex h-12 w-full items-center justify-center rounded-[3px] bg-primary px-6 text-sm font-semibold text-primary-foreground transition-[background-color,transform] duration-150 hover:bg-[var(--primary-hover)] active:translate-y-px";

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
          setMessage(data?.message ?? "This link has expired or was already used. Request a new one from your profile in the app.");
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
    return (
      <p role="status" className="flex items-center gap-3 text-base text-zinc-300">
        <svg viewBox="0 0 24 24" fill="none" aria-hidden className="h-5 w-5 animate-spin text-gold motion-reduce:animate-none">
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
          <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        </svg>
        Confirming your new email address…
      </p>
    );
  }

  if (status === "error") {
    return (
      <div className="grid gap-6">
        <FormMessage tone="error">{message}</FormMessage>
        <Link href="/login" className={LINK_BUTTON}>
          Go to sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="grid gap-6">
      <FormMessage tone="success">
        {newEmail ? `Your email has been updated to ${newEmail}.` : "Your email has been updated."} Use it next time you sign in.
      </FormMessage>
      <Link href="/login" className={LINK_BUTTON}>
        Go to sign in
      </Link>
    </div>
  );
}
