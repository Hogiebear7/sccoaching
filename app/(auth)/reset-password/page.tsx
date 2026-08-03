import { BRAND_NAME } from "@/lib/content";
import { ResetPasswordForm } from "./reset-password-form";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  return (
    <main data-theme="navy" data-palette="gold" className="relative min-h-screen px-4 py-10 text-zinc-100 before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:h-80 before:bg-[radial-gradient(70%_100%_at_50%_0%,oklch(0.7279_0.0989_82.1/0.08),transparent)]">
      <div className="mx-auto w-full max-w-md">
        <div className="mb-8">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-gold">
            {BRAND_NAME}
          </p>
          <h1 className="text-editorial mt-3 text-[30px]">Reset password</h1>
          <p className="mt-2 text-sm text-zinc-400">
            Choose a new password for your account.
          </p>
        </div>

        <div className="panel-raised anim-rise p-6">
          {token ? (
            <ResetPasswordForm token={token} />
          ) : (
            <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-400">
              This reset link is missing its token. Request a new one from the
              forgot password page.
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
