"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import type { FormEvent } from "react";

import { AuthShell } from "@/components/auth/AuthShell";
import { AuthField, FormMessage, inputClass, PasswordToggle, SubmitButton } from "@/components/auth/fields";
import { useHydrated } from "@/lib/use-hydrated";

type LoginErrors = {
  email?: string;
  password?: string;
};

const ASIDE_LINK =
  "inline-flex min-h-11 items-center text-sm font-medium text-gold transition-colors duration-150 hover:text-[var(--primary-hover)]";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<LoginErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const mounted = useHydrated();
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  function validate() {
    const nextErrors: LoginErrors = {};

    if (!email.trim()) nextErrors.email = "Enter your email address.";
    if (!password.trim()) nextErrors.password = "Enter your password.";

    setErrors(nextErrors);
    // Move focus to the first field that needs attention.
    if (nextErrors.email) emailRef.current?.focus();
    else if (nextErrors.password) passwordRef.current?.focus();
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
    <AuthShell
      label="Member login"
      title="Welcome back."
      intro="Sign in for your training, schedule, messages and progress."
      footer={
        <p className="text-sm text-zinc-400">
          New to S&amp;C?{" "}
          <Link href="/signup" className="inline-flex min-h-11 items-center font-semibold text-gold transition-colors duration-150 hover:text-[var(--primary-hover)]">
            Create an account
          </Link>
        </p>
      }
    >
      {/* noValidate: the form's own messages replace the browser's bubbles. */}
      <form onSubmit={handleSubmit} noValidate className="grid gap-6">
        {formError ? <FormMessage tone="error">{formError}</FormMessage> : null}

        <AuthField label="Email" id="login-email" error={errors.email}>
          <input
            ref={emailRef}
            id="login-email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setErrors((prev) => ({ ...prev, email: undefined }));
            }}
            aria-invalid={errors.email ? true : undefined}
            aria-describedby={errors.email ? "login-email-error" : undefined}
            className={inputClass(Boolean(errors.email))}
            placeholder="you@example.com"
          />
        </AuthField>

        <AuthField
          label="Password"
          id="login-password"
          error={errors.password}
          aside={
            <Link href="/forgot-password" className={`-my-3 ${ASIDE_LINK}`}>
              Forgot password?
            </Link>
          }
        >
          <div className="relative">
            <input
              ref={passwordRef}
              id="login-password"
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setErrors((prev) => ({ ...prev, password: undefined }));
              }}
              aria-invalid={errors.password ? true : undefined}
              aria-describedby={errors.password ? "login-password-error" : undefined}
              className={`${inputClass(Boolean(errors.password))} pr-14`}
            />
            <PasswordToggle
              controls="login-password"
              shown={showPassword}
              onToggle={() => setShowPassword((prev) => !prev)}
              disabled={!mounted}
            />
          </div>
        </AuthField>

        <div className="pt-2">
          <SubmitButton busy={isSubmitting} disabled={!mounted} label="Sign in" busyLabel="Signing in…" />
        </div>
      </form>
    </AuthShell>
  );
}
