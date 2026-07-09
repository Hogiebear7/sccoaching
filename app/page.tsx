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
    <main className="relative min-h-screen bg-zinc-950 text-zinc-100">
      {/* Ambient */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[560px] bg-[radial-gradient(60%_80%_at_70%_0%,rgba(45,212,191,0.1),transparent)]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[560px] bg-gradient-to-b from-teal-950/40 to-transparent" />

      {/* Top navigation */}
      <nav className="relative mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <span className="text-display text-xl text-zinc-50">
          S<span className="text-teal-400">&</span>C<span className="hidden sm:inline"> Performance Coaching</span>
        </span>
        <div className="flex items-center gap-2.5">
          <Link
            href={AUTH_ROUTES.login}
            className="rounded-[10px] px-4 py-2 text-sm font-medium text-zinc-300 transition-colors duration-150 hover:bg-white/[0.06] hover:text-white"
          >
            Sign in
          </Link>
          <Link
            href={AUTH_ROUTES.signup}
            className="rounded-[10px] border border-teal-700/60 bg-gradient-to-b from-teal-500 to-teal-600 px-4 py-2 text-sm font-semibold text-white shadow-[inset_0_1px_0_0_rgba(255,255,255,0.16),0_1px_2px_0_rgba(0,0,0,0.4)] transition-[background-color,transform] duration-150 hover:from-teal-400 hover:to-teal-500 active:translate-y-px"
          >
            Create account
          </Link>
        </div>
      </nav>

      {/* Hero — editorial split */}
      <section className="relative mx-auto grid max-w-6xl items-center gap-14 px-6 pb-24 pt-14 lg:grid-cols-[1.05fr_0.95fr] lg:pt-20">
        <div className="anim-rise">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-gold">{BRAND_NAME}</p>
          <h1 className="text-display mt-5 text-[44px] leading-[1.04] text-zinc-50 sm:text-[56px]">
            {BRAND_TAGLINE}
          </h1>
          <p className="mt-5 max-w-md text-base leading-relaxed text-zinc-400">
            {LANDING_DESCRIPTION}
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link
              href={AUTH_ROUTES.signup}
              className="rounded-xl border border-teal-700/60 bg-gradient-to-b from-teal-500 to-teal-600 px-6 py-3 text-center text-sm font-semibold text-white shadow-[inset_0_1px_0_0_rgba(255,255,255,0.16),0_1px_2px_0_rgba(0,0,0,0.4)] transition-[background-color,transform] duration-150 hover:from-teal-400 hover:to-teal-500 active:translate-y-px"
            >
              Start training
            </Link>
            <Link
              href={AUTH_ROUTES.login}
              className="rounded-xl border border-white/[0.1] bg-white/[0.04] px-6 py-3 text-center text-sm font-medium text-zinc-200 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)] transition-colors duration-150 hover:border-white/[0.16] hover:bg-white/[0.07] hover:text-white"
            >
              Sign in
            </Link>
          </div>

          <ul className="mt-10 space-y-3">
            {VALUE_PROPS.map((item) => (
              <li key={item} className="flex items-start gap-3 text-sm text-zinc-300">
                <span className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border border-teal-500/30 bg-teal-500/10">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="h-3 w-3 text-teal-300">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                </span>
                {item}
              </li>
            ))}
          </ul>
        </div>

        {/* Product collage — built from the app's real surfaces */}
        <div className="anim-rise relative hidden h-[480px] select-none lg:block" aria-hidden="true">
          {/* Session card */}
          <div className="panel-raised absolute left-0 top-10 w-[300px] -rotate-2 p-5">
            <p className="label-caps">Up Next · Today</p>
            <div className="mt-4 flex items-center gap-4">
              <div className="flex h-14 w-14 flex-shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl border border-white/[0.07] bg-white/[0.04]">
                <span className="text-display text-[20px] leading-none text-zinc-50 tabular-nums">06</span>
                <span className="text-[10px] leading-none text-zinc-500 tabular-nums">:30</span>
              </div>
              <div>
                <p className="text-display text-[15px] text-zinc-50">Strength Foundations</p>
                <p className="mt-1 text-xs text-zinc-500 tabular-nums">60 min · Coach Sarah</p>
              </div>
            </div>
            <div className="mt-4 h-1 overflow-hidden rounded-full bg-white/[0.06]">
              <div className="h-full w-[78%] rounded-full bg-teal-400/80" />
            </div>
            <p className="mt-2 text-[11px] text-zinc-500 tabular-nums">14/18 enrolled</p>
          </div>

          {/* Streak card */}
          <div className="panel-raised absolute right-2 top-0 w-[190px] rotate-3 p-5">
            <p className="label-caps">Streak</p>
            <p className="text-display mt-3 text-[40px] leading-none text-gold tabular-nums">12</p>
            <p className="mt-1.5 text-xs text-zinc-500">days in a row</p>
          </div>

          {/* Progress card */}
          <div className="panel-raised absolute bottom-6 right-8 w-[260px] rotate-1 p-5">
            <div className="flex items-baseline justify-between">
              <p className="label-caps">Back Squat</p>
              <span className="inline-flex items-center gap-0.5 rounded-full bg-teal-500/10 px-1.5 py-0.5 text-[11px] font-medium text-teal-400 tabular-nums">↑ 12%</span>
            </div>
            <p className="text-display mt-3 text-[28px] leading-none text-zinc-50 tabular-nums">110 kg</p>
            <div className="mt-4 flex h-12 items-end gap-1">
              {[35, 45, 40, 55, 62, 58, 74, 70, 85, 100].map((h, i, arr) => (
                <div key={i} className={`flex-1 rounded-t ${i === arr.length - 1 ? "bg-teal-400" : "bg-white/[0.08]"}`} style={{ height: `${h}%` }} />
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Plans — editorial section */}
      {plans.length > 0 ? (
        <section className="relative border-t border-white/[0.06]">
          <div className="mx-auto max-w-6xl px-6 py-20">
            <div className="max-w-lg">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-gold">Membership</p>
              <h2 className="text-display mt-4 text-3xl text-zinc-50">Choose how you train</h2>
              <p className="mt-3 text-sm leading-relaxed text-zinc-400">
                Every plan includes coach messaging, class booking, and full workout tracking.
              </p>
            </div>

            <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {plans.map((plan, i) => {
                const featured = i === 0;
                return (
                  <div
                    key={plan.id}
                    className={`hover-lift relative flex flex-col p-6 ${
                      featured
                        ? "panel-raised border-teal-500/30 shadow-[0_2px_6px_rgba(0,0,0,0.3),0_16px_48px_-12px_rgba(0,0,0,0.55),0_0_0_1px_rgba(45,212,191,0.12)]"
                        : "panel"
                    }`}
                  >
                    {featured && (
                      <span className="absolute -top-2.5 left-6 rounded-full border border-teal-500/40 bg-teal-950 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-teal-300">
                        Most popular
                      </span>
                    )}
                    <h3 className="text-display text-lg text-zinc-50">{plan.name}</h3>
                    {plan.description ? (
                      <p className="mt-2 flex-1 text-sm leading-relaxed text-zinc-400">{plan.description}</p>
                    ) : (
                      <span className="flex-1" />
                    )}
                    <p className="mt-5 flex items-baseline gap-1.5">
                      <span className="text-display text-[28px] leading-none text-zinc-50 tabular-nums">{formatPriceCents(plan.priceCents)}</span>
                      <span className="text-sm text-zinc-500">/ {plan.billingInterval}</span>
                    </p>
                    <Link
                      href={AUTH_ROUTES.signup}
                      className={`mt-5 rounded-[10px] py-2.5 text-center text-sm font-semibold transition-[background-color,border-color,color,transform] duration-150 active:translate-y-px ${
                        featured
                          ? "border border-teal-700/60 bg-gradient-to-b from-teal-500 to-teal-600 text-white shadow-[inset_0_1px_0_0_rgba(255,255,255,0.16),0_1px_2px_0_rgba(0,0,0,0.4)] hover:from-teal-400 hover:to-teal-500"
                          : "border border-white/[0.1] bg-white/[0.04] text-zinc-200 hover:border-white/[0.16] hover:bg-white/[0.07] hover:text-white"
                      }`}
                    >
                      Get started
                    </Link>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      ) : null}

      {/* Footer */}
      <footer className="relative border-t border-white/[0.06]">
        <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-4 px-6 py-10 sm:flex-row sm:items-center">
          <span className="text-display text-base text-zinc-300">S<span className="text-teal-500">&</span>C Performance Coaching</span>
          <div className="flex items-center gap-6 text-[13px] text-zinc-500">
            <Link href={AUTH_ROUTES.login} className="transition-colors duration-150 hover:text-zinc-300">Sign in</Link>
            <Link href={AUTH_ROUTES.signup} className="transition-colors duration-150 hover:text-zinc-300">Create account</Link>
            <Link href={AUTH_ROUTES.forgotPassword} className="transition-colors duration-150 hover:text-zinc-300">Forgot password</Link>
          </div>
          <p className="text-xs text-zinc-600">© 2026 {BRAND_NAME}</p>
        </div>
      </footer>
    </main>
  );
}
