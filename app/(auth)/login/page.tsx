"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { FormEvent, ReactNode } from "react";

import { BRAND_NAME, BRAND_TAGLINE, VALUE_PROPS } from "@/lib/content";

type LoginErrors = {
  email?: string;
  password?: string;
};

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<LoginErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  function validate() {
    const nextErrors: LoginErrors = {};

    if (!email.trim()) nextErrors.email = "Email is required.";
    if (!password.trim()) nextErrors.password = "Password is required.";

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    if (!validate()) return;

    setFormError(null);
    setIsSubmitting(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        setFormError(data?.message ?? "Login failed. Please try again.");
        return;
      }

      router.push("/dashboard");
    } catch {
      setFormError("Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main data-theme="navy" data-palette="gold" className="min-h-screen text-zinc-100 lg:grid lg:grid-cols-[1.1fr_1fr]">
      {/* Brand panel */}
      <aside className="relative hidden overflow-hidden border-r border-white/[0.06] lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-[var(--bg-1)]/80 via-[var(--bg-1)]/30 to-transparent" />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[420px] bg-[radial-gradient(70%_90%_at_35%_0%,oklch(0.7279_0.0989_82.1/0.14),transparent)]" />
        <div className="anim-rise relative" style={{ animationDelay: "60ms" }}>
          <Link href="/" className="inline-block transition-opacity hover:opacity-80">
            {/* eslint-disable-next-line @next/next/no-img-element -- small static brand asset, next/image's overhead isn't worth it here */}
            <img src="/brand/website-logo-v2.png" alt="S&amp;C Performance Coaching" className="h-12 w-auto" />
          </Link>
        </div>
        <div className="relative max-w-md">
          <p className="anim-rise text-xs font-semibold uppercase tracking-[0.24em] text-gold" style={{ animationDelay: "160ms" }}>{BRAND_NAME}</p>
          <h2 className="anim-rise mt-4 text-editorial text-[40px] leading-[1.05] text-zinc-50" style={{ animationDelay: "240ms" }}>{BRAND_TAGLINE}</h2>
          <ul className="mt-8 space-y-3">
            {VALUE_PROPS.map((item, i) => (
              <li
                key={item}
                className="anim-rise flex items-start gap-3 text-sm text-zinc-300"
                style={{ animationDelay: `${340 + i * 90}ms` }}
              >
                <span className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border border-primary/30 bg-primary/10">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="h-3 w-3 text-primary">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                </span>
                {item}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-zinc-600">© 2026 {BRAND_NAME}. Built for serious training.</p>
      </aside>

      {/* Form column */}
      <div className="relative flex min-h-screen flex-col px-6 py-8 before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:h-64 before:bg-[radial-gradient(70%_100%_at_50%_0%,oklch(0.7279_0.0989_82.1/0.08),transparent)] lg:before:hidden">
        <div className="lg:hidden">
          <Link href="/" className="inline-block transition-opacity hover:opacity-80">
            {/* eslint-disable-next-line @next/next/no-img-element -- small static brand asset, next/image's overhead isn't worth it here */}
            <img src="/brand/website-logo-v2.png" alt="S&amp;C Performance Coaching" className="h-9 w-auto" />
          </Link>
        </div>
        <div className="anim-rise mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10">
          <p className="label-caps">Welcome back</p>
          <h1 className="text-editorial mt-2 text-[32px]">Sign in</h1>
          <p className="mt-2 text-sm text-zinc-400">
            Access your training, schedule, messages, and profile.
          </p>

          <form onSubmit={handleSubmit} className="mt-8 space-y-4">
            <fieldset className="space-y-4">
              {formError ? (
                <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-400">
                  {formError}
                </p>
              ) : null}

              <FormField label="Email" id="login-email" error={errors.email}>
                <input
                  id="login-email"
                  type="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setErrors((prev) => ({ ...prev, email: undefined }));
                  }}
                  className={inputClass(errors.email)}
                  placeholder="you@example.com"
                />
              </FormField>

              <FormField
                label="Password"
                id="login-password"
                error={errors.password}
                trailing={
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    disabled={!mounted}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs font-medium text-zinc-200 transition hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {showPassword ? "Hide" : "Show"}
                  </button>
                }
              >
                <input
                  id="login-password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setErrors((prev) => ({ ...prev, password: undefined }));
                  }}
                  className={`${inputClass(errors.password)} pr-16`}
                  placeholder="Enter your password"
                />
              </FormField>
            </fieldset>

            <div className="flex items-center justify-between pt-1">
              <span />
              <Link
                href="/forgot-password"
                className="text-[13px] text-zinc-400 transition-colors duration-150 hover:text-zinc-200"
              >
                Forgot password?
              </Link>
            </div>

            <button
              type="submit"
              disabled={!mounted || isSubmitting}
              className="w-full btn-primary px-5 py-3 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? "Signing in…" : "Sign in"}
            </button>

            <p className="pt-2 text-center text-[13px] text-zinc-500">
              Need an account?{" "}
              <Link href="/signup" className="font-medium text-primary transition-colors duration-150 hover:text-[var(--primary-hover)]">
                Create one
              </Link>
            </p>
          </form>
        </div>
      </div>
    </main>
  );
}

function FormField({
  label,
  id,
  error,
  trailing,
  children,
}: {
  label: string;
  id: string;
  error?: string;
  trailing?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-sm font-medium text-zinc-200">
        {label}
      </label>
      {trailing ? (
        <div className="relative">
          {children}
          {trailing}
        </div>
      ) : (
        children
      )}
      {error ? <p className="mt-1 text-xs text-red-400">{error}</p> : null}
    </div>
  );
}

function inputClass(hasError?: string) {
  return `w-full rounded-lg border bg-[--input] px-4 py-3 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-500 ${
    hasError
      ? "border-red-500 focus:border-red-400"
      : "border-zinc-800 focus:border-primary/60 focus:ring-2 focus:ring-primary/15"
  }`;
}