"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";

import { AuthField, fieldA11y, FormMessage, inputClass, PasswordToggle, SubmitButton } from "@/components/auth/fields";

// Matches the signup form's requirement copy and the server-side check in
// validatePasswordStrength (lib/password.ts) — reset-password enforces the
// same policy, not a weaker one.
const PASSWORD_REQUIREMENTS_HINT =
  "Must be at least 8 characters and include an uppercase letter, a lowercase letter, a number, and a special character.";

const MISMATCH = "Passwords do not match.";

export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError(MISMATCH);
      return;
    }

    setIsSubmitting(true);

    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        setError(data?.message ?? "Could not reset password. Please try again.");
        return;
      }

      router.push("/login");
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  // The mismatch is shown on the confirm field; anything from the server
  // (expired or used link, weak password) is shown above the form.
  const mismatch = error === MISMATCH;

  return (
    <form onSubmit={handleSubmit} className="grid gap-6">
      {error && !mismatch ? (
        <FormMessage tone="error">
          {error}{" "}
          <Link href="/forgot-password" className="font-semibold underline underline-offset-2">
            Request a new link
          </Link>
        </FormMessage>
      ) : null}

      <AuthField label="New password" id="reset-password" hint={PASSWORD_REQUIREMENTS_HINT}>
        <div className="relative">
          <input
            id="reset-password"
            name="new-password"
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            {...fieldA11y("reset-password", undefined, true)}
            className={`${inputClass()} pr-14`}
          />
          <PasswordToggle controls="reset-password" shown={showPassword} onToggle={() => setShowPassword((prev) => !prev)} />
        </div>
      </AuthField>

      <AuthField label="Confirm new password" id="reset-confirm" error={mismatch ? MISMATCH : undefined}>
        <input
          id="reset-confirm"
          name="confirm-password"
          type={showPassword ? "text" : "password"}
          autoComplete="new-password"
          required
          minLength={8}
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          {...fieldA11y("reset-confirm", mismatch ? MISMATCH : undefined)}
          className={inputClass(mismatch)}
        />
      </AuthField>

      <SubmitButton busy={isSubmitting} label="Save new password" busyLabel="Saving…" />
    </form>
  );
}
