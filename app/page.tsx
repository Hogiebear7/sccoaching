import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import {
  findMembershipBillingOptionsByPackageId,
  findMembershipPackages,
  findUserById,
} from "@/lib/db";
import { formatPriceCents } from "@/lib/billing";
import { formatBillingOptionCadence } from "@/lib/catalog";
import { AUTH_ROUTES, BRAND_NAME, BRAND_TAGLINE, LANDING_DESCRIPTION, VALUE_PROPS } from "@/lib/content";
import { verifySession } from "@/lib/session";
import { FeaturedClassCard } from "@/components/marketing/FeaturedClassCard";

// Split the tagline on its em-dash so the second half can take the lime accent,
// echoing the reference two-tone headline without changing the copy.
function splitTagline(tagline: string): [string, string | null] {
  const idx = tagline.indexOf("—");
  if (idx === -1) return [tagline, null];
  return [tagline.slice(0, idx).trim(), tagline.slice(idx + 1).trim()];
}

export default async function Root() {
  const cookieStore = await cookies();
  const userId = verifySession(cookieStore.get("session")?.value)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;

  if (user) {
    redirect("/dashboard");
  }

  // Marketing "from €X" cards, one per visible membership package, priced by
  // its cheapest visible recurring billing option.
  const plans = findMembershipPackages()
    .filter((pkg) => pkg.visible && pkg.packageType === "membership")
    .map((pkg) => {
      const recurring = findMembershipBillingOptionsByPackageId(pkg.id).filter(
        (o) => o.visible && o.billingType === "recurring"
      );
      const cheapest = recurring.length
        ? recurring.reduce((min, o) => (o.amountCents < min.amountCents ? o : min))
        : null;
      return {
        id: pkg.id,
        name: pkg.name,
        teaser: pkg.shortDescription,
        detail: pkg.fullDescription,
        imageUrl: pkg.imageUrl ?? null,
        imageAlt: pkg.imageAlt ?? null,
        amountCents: cheapest?.amountCents ?? null,
        cadence: cheapest ? formatBillingOptionCadence(cheapest) : null,
      };
    })
    .filter((p) => p.amountCents !== null);

  const [taglineLead, taglineAccent] = splitTagline(BRAND_TAGLINE);

  return (
    <main
      data-palette="electric"
      data-theme="onyx"
      className="relative min-h-screen overflow-hidden bg-[oklch(0.14_0.006_150)] text-zinc-100"
    >
      {/* Ambient — lime aurora + angular streaks */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[620px] bg-[radial-gradient(60%_80%_at_72%_-5%,oklch(0.86_0.2_128/0.16),transparent)]" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(50%_50%_at_100%_100%,oklch(0.86_0.2_128/0.06),transparent)]" />
      <div className="pointer-events-none absolute -right-24 top-24 hidden h-[520px] w-40 -skew-x-[18deg] bg-gradient-to-b from-lime-400/25 via-lime-400/5 to-transparent blur-md lg:block" />
      <div className="pointer-events-none absolute -right-8 top-10 hidden h-[560px] w-8 -skew-x-[18deg] bg-lime-400/40 lg:block" />

      {/* Top navigation */}
      <nav className="relative mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <span className="text-condensed text-xl uppercase tracking-wide text-zinc-50">
          S<span className="text-lime-400">&</span>C<span className="hidden font-semibold sm:inline"> Performance</span>
        </span>
        <div className="flex items-center gap-2.5">
          <Link
            href={AUTH_ROUTES.login}
            className="rounded-lg px-4 py-2 text-sm font-medium text-zinc-300 transition-colors duration-150 hover:bg-white/[0.06] hover:text-white"
          >
            Sign in
          </Link>
          <Link
            href={AUTH_ROUTES.signup}
            className="rounded-lg bg-lime-400 px-4 py-2 text-sm font-semibold text-[oklch(0.2_0.03_140)] shadow-[0_0_0_1px_oklch(0.9_0.2_128/0.5),0_8px_24px_-8px_oklch(0.86_0.2_128/0.6)] transition-[background-color,transform] duration-150 hover:bg-lime-300 active:translate-y-px"
          >
            Create account
          </Link>
        </div>
      </nav>

      {/* Hero — editorial split */}
      <section className="relative mx-auto grid max-w-6xl items-center gap-14 px-6 pb-24 pt-14 lg:grid-cols-[1.05fr_0.95fr] lg:pt-20">
        <div className="anim-rise">
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.28em] text-lime-400">
            <span className="h-px w-8 bg-lime-400/70" />
            {BRAND_NAME}
          </p>
          <h1 className="text-condensed mt-6 text-[52px] uppercase leading-[0.92] text-zinc-50 sm:text-[68px]">
            {taglineLead}
            {taglineAccent ? (
              <>
                {" "}
                <span className="text-lime-400">{taglineAccent}</span>
              </>
            ) : null}
          </h1>
          <p className="mt-6 max-w-md text-base leading-relaxed text-zinc-400">
            {LANDING_DESCRIPTION}
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link
              href={AUTH_ROUTES.signup}
              className="group inline-flex items-center justify-center gap-2 rounded-xl bg-lime-400 px-6 py-3 text-sm font-semibold uppercase tracking-wide text-[oklch(0.2_0.03_140)] shadow-[0_0_0_1px_oklch(0.9_0.2_128/0.5),0_12px_32px_-10px_oklch(0.86_0.2_128/0.65)] transition-[background-color,transform] duration-150 hover:bg-lime-300 active:translate-y-px"
            >
              Start training
              <span aria-hidden className="transition-transform duration-150 group-hover:translate-x-0.5">→</span>
            </Link>
            <Link
              href={AUTH_ROUTES.login}
              className="inline-flex items-center justify-center rounded-xl border border-white/[0.12] bg-white/[0.04] px-6 py-3 text-sm font-medium text-zinc-200 transition-colors duration-150 hover:border-lime-400/40 hover:bg-white/[0.07] hover:text-white"
            >
              Sign in
            </Link>
          </div>

          <ul className="mt-10 space-y-3">
            {VALUE_PROPS.map((item) => (
              <li key={item} className="flex items-start gap-3 text-sm text-zinc-300">
                <span className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border border-lime-400/40 bg-lime-400/10">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="h-3 w-3 text-lime-400">
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
                <span className="text-condensed text-[22px] leading-none text-zinc-50 tabular-nums">06</span>
                <span className="text-[10px] leading-none text-zinc-500 tabular-nums">:30</span>
              </div>
              <div>
                <p className="text-condensed text-[16px] uppercase text-zinc-50">Strength Foundations</p>
                <p className="mt-1 text-xs text-zinc-500 tabular-nums">60 min · Coach Sarah</p>
              </div>
            </div>
            <div className="mt-4 h-1 overflow-hidden rounded-full bg-white/[0.06]">
              <div className="h-full w-[78%] rounded-full bg-lime-400" />
            </div>
            <p className="mt-2 text-[11px] text-zinc-500 tabular-nums">14/18 enrolled</p>
          </div>

          {/* Streak card */}
          <div className="panel-raised absolute right-2 top-0 w-[190px] rotate-3 p-5">
            <p className="label-caps">Streak</p>
            <p className="text-condensed mt-3 text-[44px] leading-none text-lime-400 tabular-nums">12</p>
            <p className="mt-1.5 text-xs text-zinc-500">days in a row</p>
          </div>

          {/* Progress card */}
          <div className="panel-raised absolute bottom-6 right-8 w-[260px] rotate-1 p-5">
            <div className="flex items-baseline justify-between">
              <p className="label-caps">Back Squat</p>
              <span className="inline-flex items-center gap-0.5 rounded-full bg-lime-400/10 px-1.5 py-0.5 text-[11px] font-medium text-lime-400 tabular-nums">↑ 12%</span>
            </div>
            <p className="text-condensed mt-3 text-[30px] leading-none text-zinc-50 tabular-nums">110 kg</p>
            <div className="mt-4 flex h-12 items-end gap-1">
              {[35, 45, 40, 55, 62, 58, 74, 70, 85, 100].map((h, i, arr) => (
                <div key={i} className={`flex-1 rounded-t ${i === arr.length - 1 ? "bg-lime-400" : "bg-white/[0.08]"}`} style={{ height: `${h}%` }} />
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Plans — image-less premium cards with hover-reveal descriptions */}
      {plans.length > 0 ? (
        <section className="relative border-t border-white/[0.06]">
          <div className="mx-auto max-w-6xl px-6 py-20">
            <div className="max-w-lg">
              <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.28em] text-lime-400">
                <span className="h-px w-8 bg-lime-400/70" />
                Membership
              </p>
              <h2 className="text-condensed mt-4 text-4xl uppercase text-zinc-50">Choose how you train</h2>
              <p className="mt-3 text-sm leading-relaxed text-zinc-400">
                Every plan includes coach messaging, class booking, and full workout tracking.
              </p>
            </div>

            <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {plans.map((plan, i) => (
                <FeaturedClassCard
                  key={plan.id}
                  seed={plan.id}
                  name={plan.name}
                  teaser={plan.teaser}
                  detail={plan.detail}
                  imageUrl={plan.imageUrl}
                  imageAlt={plan.imageAlt}
                  priceLabel={formatPriceCents(plan.amountCents!)}
                  cadence={plan.cadence}
                  featured={i === 0}
                  href={AUTH_ROUTES.signup}
                />
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {/* Footer */}
      <footer className="relative border-t border-white/[0.06]">
        <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-4 px-6 py-10 sm:flex-row sm:items-center">
          <span className="text-condensed text-base uppercase text-zinc-300">S<span className="text-lime-400">&</span>C Performance Coaching</span>
          <div className="flex items-center gap-6 text-[13px] text-zinc-500">
            <Link href={AUTH_ROUTES.login} className="transition-colors duration-150 hover:text-lime-400">Sign in</Link>
            <Link href={AUTH_ROUTES.signup} className="transition-colors duration-150 hover:text-lime-400">Create account</Link>
            <Link href={AUTH_ROUTES.forgotPassword} className="transition-colors duration-150 hover:text-lime-400">Forgot password</Link>
          </div>
          <p className="text-xs text-zinc-600">© 2026 {BRAND_NAME}</p>
        </div>
      </footer>
    </main>
  );
}
