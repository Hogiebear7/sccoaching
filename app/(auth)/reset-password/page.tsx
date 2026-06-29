import { BRAND_NAME } from "@/lib/content";
import { ResetPasswordForm } from "./reset-password-form";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  return (
    <main className="min-h-screen bg-black px-4 py-8 text-zinc-100">
      <div className="mx-auto w-full max-w-md">
        <div className="mb-8">
          <p className="text-sm uppercase tracking-[0.24em] text-teal-400">
            {BRAND_NAME}
          </p>
          <h1 className="mt-3 text-3xl font-bold">Reset password</h1>
          <p className="mt-2 text-sm text-zinc-400">
            Choose a new password for your account.
          </p>
        </div>

        <div className="rounded-3xl border border-zinc-800 bg-zinc-900 p-5 shadow-2xl">
          {token ? (
            <ResetPasswordForm token={token} />
          ) : (
            <p className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-400">
              This reset link is missing its token. Request a new one from the
              forgot password page.
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
