import Link from "next/link";

import { AuthShell } from "@/components/auth/AuthShell";
import { FormMessage } from "@/components/auth/fields";
import { ResetPasswordForm } from "./reset-password-form";

export const metadata = {
  title: "Reset password — S&C Performance Coaching",
  description: "Choose a new password for your S&C member account.",
  robots: { index: false },
};

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  return (
    <AuthShell
      label="Member login"
      title="Choose a new password."
      intro="Set a new password for your account, then sign in with it."
      footer={
        <Link
          href="/login"
          className="group inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-gold transition-colors duration-150 hover:text-[var(--primary-hover)]"
        >
          <span aria-hidden className="transition-transform duration-150 group-hover:-translate-x-0.5">←</span>
          Back to sign in
        </Link>
      }
    >
      {token ? (
        <ResetPasswordForm token={token} />
      ) : (
        <div className="grid gap-6">
          <FormMessage tone="error">This reset link is incomplete. Request a new one and use the latest email.</FormMessage>
          <Link
            href="/forgot-password"
            className="inline-flex h-12 items-center justify-center rounded-[3px] bg-primary px-6 text-sm font-semibold text-primary-foreground transition-[background-color,transform] duration-150 hover:bg-[var(--primary-hover)] active:translate-y-px"
          >
            Request a new link
          </Link>
        </div>
      )}
    </AuthShell>
  );
}
