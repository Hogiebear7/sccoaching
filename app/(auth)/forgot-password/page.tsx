"use client";

import Link from "next/link";
import { useState } from "react";
import type { FormEvent } from "react";

import { AuthShell } from "@/components/auth/AuthShell";
import { AuthField, FormMessage, inputClass, SubmitButton } from "@/components/auth/fields";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
    } finally {
      setIsSubmitting(false);
      setSubmitted(true);
    }
  }

  return (
    <AuthShell
      label="Member login"
      title="Reset your password."
      intro="Enter your account email and we'll send you a reset link."
      footer={
        <div className="grid gap-2">
          <Link
            href="/login"
            className="group inline-flex min-h-11 items-center gap-1.5 self-start text-sm font-semibold text-gold transition-colors duration-150 hover:text-[var(--primary-hover)]"
          >
            <span aria-hidden className="transition-transform duration-150 group-hover:-translate-x-0.5">←</span>
            Back to sign in
          </Link>
          <p className="text-sm text-zinc-400">Don&apos;t know which email you used? Contact your coach directly.</p>
        </div>
      }
    >
      {submitted ? (
        <FormMessage tone="success">If an account exists for that email, a password reset link has been sent.</FormMessage>
      ) : (
        <form onSubmit={handleSubmit} className="grid gap-6">
          <AuthField label="Email" id="forgot-email">
            <input
              id="forgot-email"
              name="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClass()}
              placeholder="you@example.com"
            />
          </AuthField>

          <SubmitButton busy={isSubmitting} label="Send reset link" busyLabel="Sending…" />
        </form>
      )}
    </AuthShell>
  );
}
