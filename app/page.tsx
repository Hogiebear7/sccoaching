import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { findMembershipPlans, findUserById } from "@/lib/db";
import { formatPriceCents } from "@/lib/billing";
import { AUTH_ROUTES, BRAND_NAME, BRAND_TAGLINE, LANDING_DESCRIPTION, VALUE_PROPS } from "@/lib/content";
import { verifySession } from "@/lib/session";

export default async function Root() {
  const cookieStore = await cookies();
  const userId = verifySession(cookieStore.get("session")?.value)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;

  if (user) {
    redirect("/dashboard");
  }

  const plans = findMembershipPlans().filter((plan) => plan.isActive);

  return (
    <main className="flex min-h-screen flex-col items-center bg-black px-4 py-16 text-zinc-100">
      <div className="w-full max-w-2xl text-center">
        <p className="text-sm uppercase tracking-[0.24em] text-teal-400">
          {BRAND_NAME}
        </p>
        <h1 className="mt-4 text-4xl font-bold sm:text-5xl">{BRAND_TAGLINE}</h1>
        <p className="mt-4 text-base text-zinc-400 sm:text-lg">
          {LANDING_DESCRIPTION}
        </p>

        <ul className="mx-auto mt-8 max-w-md space-y-2 text-left text-sm text-zinc-400">
          {VALUE_PROPS.map((item) => (
            <li key={item} className="flex gap-2">
              <span className="text-teal-400">•</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>

        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href={AUTH_ROUTES.login}
            className="w-full rounded-xl bg-teal-500 px-6 py-3 text-sm font-semibold text-black transition hover:bg-teal-400 sm:w-auto"
          >
            Sign in
          </Link>
          <Link
            href={AUTH_ROUTES.signup}
            className="w-full rounded-xl border border-zinc-700 px-6 py-3 text-sm font-medium text-zinc-200 transition hover:border-zinc-500 sm:w-auto"
          >
            Create an account
          </Link>
        </div>

        <p className="mt-6 text-sm text-zinc-500">
          <Link
            href={AUTH_ROUTES.forgotPassword}
            className="text-teal-400 transition hover:text-teal-300"
          >
            Forgot your password?
          </Link>
        </p>
      </div>

      {plans.length > 0 ? (
        <div className="mt-16 w-full max-w-3xl">
          <h2 className="text-center text-xl font-semibold text-zinc-100">
            Membership plans
          </h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            {plans.map((plan) => (
              <div
                key={plan.id}
                className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5 text-left"
              >
                <h3 className="text-base font-semibold text-zinc-100">{plan.name}</h3>
                {plan.description ? (
                  <p className="mt-2 text-sm text-zinc-400">{plan.description}</p>
                ) : null}
                <p className="mt-3 text-sm font-medium text-teal-400">
                  {formatPriceCents(plan.priceCents)} / {plan.billingInterval}
                </p>
              </div>
            ))}
          </div>
          <p className="mt-4 text-center text-sm text-zinc-500">
            <Link
              href={AUTH_ROUTES.signup}
              className="text-teal-400 transition hover:text-teal-300"
            >
              Create an account
            </Link>{" "}
            to select a plan.
          </p>
        </div>
      ) : null}
    </main>
  );
}
