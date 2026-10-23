import { AuthShell } from "@/components/auth/AuthShell";
import { FormMessage } from "@/components/auth/fields";
import { VerifyEmailChangeStatus } from "./verify-email-change-status";

export const metadata = {
  title: "Confirm email change — S&C Performance Coaching",
  description: "Confirm the new email address for your S&C member account.",
  robots: { index: false },
};

export default async function VerifyEmailChangePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  return (
    <AuthShell
      label="Your account"
      title="Confirm your new email."
      intro="Confirming this link updates the email address you sign in with."
    >
      {token ? (
        <VerifyEmailChangeStatus token={token} />
      ) : (
        <FormMessage tone="error">This link is incomplete. Request a new one from your profile in the app.</FormMessage>
      )}
    </AuthShell>
  );
}
