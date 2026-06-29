"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent, ReactNode } from "react";

import { BRAND_NAME } from "@/lib/content";

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
    <main className="min-h-screen bg-black px-4 py-8 text-zinc-100">
      <div className="mx-auto w-full max-w-md">
        <div className="mb-8">
          <p className="text-sm uppercase tracking-[0.24em] text-teal-400">
            {BRAND_NAME}
          </p>
          <h1 className="mt-3 text-3xl font-bold">Sign in</h1>
          <p className="mt-2 text-sm text-zinc-400">
            Access your training, schedule, messages, and profile.
          </p>
        </div>

        <div className="rounded-3xl border border-zinc-800 bg-zinc-900 p-5 shadow-2xl">
          <form onSubmit={handleSubmit} className="space-y-4">
            <fieldset className="space-y-4">
              <legend className="mb-4 text-lg font-semibold text-zinc-50">
                Welcome back
              </legend>

              {formError ? (
                <p className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-400">
                  {formError}
                </p>
              ) : null}

              <FormField label="Email" error={errors.email}>
                <input
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
                error={errors.password}
                trailing={
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs font-medium text-zinc-200 transition hover:bg-zinc-700"
                  >
                    {showPassword ? "Hide" : "Show"}
                  </button>
                }
              >
                <input
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

            <div className="flex items-center justify-between gap-3 pt-2">
              <div className="flex flex-col gap-1">
                <Link
                  href="/signup"
                  className="text-sm text-zinc-400 transition hover:text-zinc-200"
                >
                  Need an account?
                </Link>
                <Link
                  href="/forgot-password"
                  className="text-sm text-zinc-400 transition hover:text-zinc-200"
                >
                  Forgot password?
                </Link>
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="rounded-xl bg-teal-500 px-5 py-2 text-sm font-semibold text-black transition hover:bg-teal-400 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSubmitting ? "Signing in…" : "Sign in"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </main>
  );
}

function FormField({
  label,
  error,
  trailing,
  children,
}: {
  label: string;
  error?: string;
  trailing?: ReactNode;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-medium text-zinc-200">{label}</span>
      {trailing ? (
        <div className="relative">
          {children}
          {trailing}
        </div>
      ) : (
        children
      )}
      {error ? <p className="mt-1 text-xs text-red-400">{error}</p> : null}
    </label>
  );
}

function inputClass(hasError?: string) {
  return `w-full rounded-xl border bg-zinc-950 px-4 py-3 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-500 ${
    hasError
      ? "border-red-500 focus:border-red-400"
      : "border-zinc-800 focus:border-teal-500"
  }`;
}