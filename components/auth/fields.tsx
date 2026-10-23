"use client";

import type { ReactNode } from "react";

// Form pieces for the member auth screens, matching the website's contact
// form and buttons: 48px controls, 3px radius, gold focus, explicit labels,
// and errors wired to their field for screen readers. The `!` focus classes
// override the app-wide blue :focus-visible outline in globals.css.

export function inputClass(hasError?: boolean) {
  return `h-12 w-full rounded-[3px] border bg-[var(--surface-1)] px-4 text-base text-zinc-100 outline-none transition-[border-color,box-shadow] duration-150 focus-visible:outline-none! placeholder:text-zinc-500 focus:ring-2 ${
    hasError
      ? "border-red-400/80 focus:border-red-300 focus:ring-red-400/20"
      : "border-white/[0.14] hover:border-white/[0.24] focus:border-primary focus:ring-primary/20"
  }`;
}

export function AuthField({
  id,
  label,
  error,
  aside,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  /** Right-aligned beside the label (e.g. "Forgot password?"). */
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-4">
        <label htmlFor={id} className="text-sm font-semibold text-zinc-200">
          {label}
        </label>
        {aside}
      </div>
      {children}
      {error ? (
        <p id={`${id}-error`} className="mt-2 flex items-center gap-1.5 text-sm text-red-300">
          <AlertIcon />
          {error}
        </p>
      ) : null}
    </div>
  );
}

// Whole-form message: failures are announced (role="alert"), confirmations
// politely (role="status").
export function FormMessage({ tone, children }: { tone: "error" | "success"; children: ReactNode }) {
  const error = tone === "error";
  return (
    <div
      role={error ? "alert" : "status"}
      className={`flex gap-3 rounded-[3px] border-l-2 px-4 py-3 text-sm leading-relaxed ${
        error ? "border-red-400 bg-red-500/[0.08] text-red-200" : "border-primary bg-primary/[0.08] text-zinc-100"
      }`}
    >
      {error ? <AlertIcon className="mt-0.5" /> : null}
      <div>{children}</div>
    </div>
  );
}

export function SubmitButton({ busy, disabled, label, busyLabel }: { busy: boolean; disabled?: boolean; label: string; busyLabel: string }) {
  return (
    <button
      type="submit"
      disabled={disabled || busy}
      aria-busy={busy}
      className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-[3px] bg-primary px-6 text-sm font-semibold text-primary-foreground transition-[background-color,transform] duration-150 hover:bg-[var(--primary-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary! active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60"
    >
      {busy ? (
        <svg viewBox="0 0 24 24" fill="none" aria-hidden className="h-4 w-4 animate-spin motion-reduce:animate-none">
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
          <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        </svg>
      ) : null}
      {busy ? busyLabel : label}
    </button>
  );
}

// Show/hide control inside the password field: a 44px icon button, labelled
// and pressed-state aware for assistive tech.
export function PasswordToggle({
  controls,
  shown,
  onToggle,
  disabled,
}: {
  controls: string;
  shown: boolean;
  onToggle: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      aria-controls={controls}
      aria-pressed={shown}
      aria-label="Show password"
      className="absolute right-0.5 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-[3px] text-zinc-400 transition-colors duration-150 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary! disabled:opacity-50"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden className="h-5 w-5">
        <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
        <circle cx="12" cy="12" r="3" />
        {shown ? <path d="M3 3l18 18" /> : null}
      </svg>
    </button>
  );
}

function AlertIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" aria-hidden className={`h-4 w-4 shrink-0 ${className}`}>
      <circle cx="8" cy="8" r="6.5" />
      <path d="M8 4.75v3.75M8 11h.01" />
    </svg>
  );
}
