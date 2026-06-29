"use client";

import Link from "next/link";
import { useState } from "react";
import type { FormEvent } from "react";

import { BRAND_NAME } from "@/lib/content";

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
    <main className="min-h-screen bg-black px-4 py-8 text-zinc-100">
      <div className="mx-auto w-full max-w-md">
        <div className="mb-8">
          <p className="text-sm uppercase tracking-[0.24em] text-teal-400">
            {BRAND_NAME}
          </p>
          <h1 className="mt-3 text-3xl font-bold">Forgot password</h1>
          <p className="mt-2 text-sm text-zinc-400">
            Enter your account email and we&apos;ll send you a reset link.
          </p>
        </div>

        <div className="rounded-3xl border border-zinc-800 bg-zinc-900 p-5 shadow-2xl">
          {submitted ? (
            <p className="rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-sm text-zinc-200">
              If an account exists for that email, a password reset link has been sent.
            </p>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-zinc-200">
                  Email
                </span>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-500 focus:border-teal-500"
                  placeholder="you@example.com"
                />
              </label>

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full rounded-xl bg-teal-500 px-5 py-2 text-sm font-semibold text-black transition hover:bg-teal-400 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSubmitting ? "Sending…" : "Send reset link"}
              </button>
            </form>
          )}

          <div className="mt-6 border-t border-zinc-800 pt-4 space-y-2">
            <Link
              href="/login"
              className="block text-sm text-zinc-400 transition hover:text-zinc-200"
            >
              Back to sign in
            </Link>
            <p className="text-xs text-zinc-500">
              Don&apos;t know which email you used? Contact your coach/admin directly.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
