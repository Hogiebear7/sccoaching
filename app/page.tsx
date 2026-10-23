import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { findUserById } from "@/lib/db";
import { AUTH_ROUTES, BRAND_NAME, CONTACT_INFO, HERO_HEADLINE, LANDING_DESCRIPTION, VALUE_PROPS } from "@/lib/content";
import { verifySession } from "@/lib/session";
import { AppFeatureGrid } from "@/components/marketing/AppFeatureGrid";
import { AppShowcase } from "@/components/marketing/AppShowcase";
import { ClassesShowcase } from "@/components/marketing/ClassesShowcase";
import { ClassPricingShowcase } from "@/components/marketing/ClassPricingShowcase";
import { ContactForm } from "@/components/marketing/ContactForm";
import { FaqSection } from "@/components/marketing/FaqSection";
import { HeroShader } from "@/components/marketing/HeroShader";
import { MemberPreviewStack } from "@/components/marketing/MemberPreviewStack";
import { ScrollReveal } from "@/components/ui/ScrollReveal";

// Structural copy, not business fact — the specific claims here (coach
// qualifications, locality specifics) are placeholders carried over from the
// design blueprint and need the client's confirmation/edit before launch.
const DIFFERENTIATORS = [
  {
    title: "Your goals, not a template",
    body: "No member starts on a generic plan. Your first session sets your goals and baseline, then shapes the block that follows.",
  },
  {
    title: "Capped coaching ratios",
    body: "Small-group sessions stay small on purpose — every rep gets watched, every cue is specific to you, not shouted at the room.",
  },
  {
    title: "Highly qualified coach",
    body: "15+ years of hands-on experience, backed by multiple science and coaching degrees. Not your standard club trainer.",
  },
  {
    title: "Rooted in the community",
    body: "Members, athletes, and everyone in between train side by side in a calm, focused environment.",
  },
] as const;

export default async function Root() {
  const cookieStore = await cookies();
  const userId = verifySession(cookieStore.get("session")?.value)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;

  if (user) {
    redirect("/dashboard");
  }

  return (
    <main
      data-palette="gold"
      data-theme="navy"
      className="relative min-h-screen overflow-hidden text-zinc-100"
    >
      {/* Ambient — slow navy haze with drifting chalk specks, under the hairline grid */}
      <HeroShader className="pointer-events-none absolute inset-x-0 top-0 h-[620px] [mask-image:linear-gradient(to_bottom,black,transparent_90%)]" />

      {/* Ambient — restrained hairline grid, no aurora/skew streaks */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[620px] opacity-60 [mask-image:linear-gradient(to_bottom,black,transparent_90%)]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(90deg, var(--border-subtle) 0, var(--border-subtle) 1px, transparent 1px, transparent 120px)",
        }}
      />

      {/* Top navigation */}
      <nav className="anim-fade relative mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <Link href="/" className="flex items-center">
          {/* eslint-disable-next-line @next/next/no-img-element -- small static brand asset, next/image's overhead isn't worth it here */}
          <img src="/brand/website-logo-v2.png" alt="S&amp;C Performance Coaching" className="h-20 w-auto sm:h-[120px]" />
        </Link>
        <div className="flex items-center gap-2.5">
          <Link
            href={AUTH_ROUTES.login}
            className="whitespace-nowrap rounded-[3px] px-4 py-2 text-sm font-medium text-zinc-300 transition-colors duration-150 hover:bg-white/[0.06] hover:text-white"
          >
            Sign in
          </Link>
          <Link
            href={AUTH_ROUTES.signup}
            className="whitespace-nowrap rounded-[3px] bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-[background-color,transform] duration-150 hover:bg-[var(--primary-hover)] active:translate-y-px"
          >
            Create account
          </Link>
        </div>
      </nav>

      {/* Hero — editorial split, staggered page-load choreography. Right
          column previews three member-area features (training, nutrition,
          recovery) in the same solid-panel/gold-accent language as the
          Ledger signature motif, in place of a stock athlete photo. */}
      <section className="relative mx-auto grid max-w-6xl items-start gap-14 px-6 pb-24 pt-14 lg:grid-cols-[1.05fr_0.95fr] lg:pt-20">
        <div>
          <h1
            className="anim-rise text-headline text-[64px] text-zinc-50 sm:text-[96px]"
            style={{ animationDelay: "150ms" }}
          >
            {HERO_HEADLINE.lead}{" "}
            <em className="not-italic text-gold">{HERO_HEADLINE.accent}</em>
          </h1>
          <p
            className="anim-rise mt-6 max-w-md text-lg leading-relaxed text-zinc-300"
            style={{ animationDelay: "260ms" }}
          >
            {LANDING_DESCRIPTION}
          </p>

          <div
            className="anim-rise mt-8 flex flex-col gap-3 sm:flex-row"
            style={{ animationDelay: "360ms" }}
          >
            <Link
              href={AUTH_ROUTES.signup}
              className="group inline-flex items-center justify-center gap-2 rounded-[3px] bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground transition-[background-color,transform] duration-150 hover:bg-[var(--primary-hover)] active:translate-y-px"
            >
              Start training
              <span aria-hidden className="transition-transform duration-150 group-hover:translate-x-0.5">→</span>
            </Link>
            <Link
              href={AUTH_ROUTES.login}
              className="inline-flex items-center justify-center rounded-[3px] border border-white/[0.14] bg-transparent px-6 py-3 text-sm font-medium text-zinc-200 transition-colors duration-150 hover:border-primary/40 hover:bg-white/[0.04] hover:text-white"
            >
              Sign in
            </Link>
          </div>

          <ul
            className="anim-rise mt-10 space-y-3"
            style={{ animationDelay: "460ms" }}
          >
            {VALUE_PROPS.map((item) => (
              <li key={item} className="flex items-start gap-3 text-base text-zinc-300">
                <span className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border border-primary/40 bg-primary/10">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="h-3 w-3 text-primary">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                </span>
                {item}
              </li>
            ))}
          </ul>
        </div>

        <div
          className="anim-rise hidden lg:block"
          style={{ animationDelay: "420ms" }}
        >
          <MemberPreviewStack />
          <p className="mt-4 text-xs italic text-zinc-500">
            Representative data — your numbers, tracked from week one.
          </p>
        </div>
      </section>

      {/* Classes we offer — curated services panel (hover/tap reveals each
          class's description) over the real gym photo. Replaces the old
          literal weekly timetable; these three classes are fixed content,
          not derived from booking data. */}
      <section className="relative border-t border-white/[0.06]">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <div className="max-w-lg">
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-gold">
              <span className="h-px w-8 bg-primary/70" />
              The Training Floor
            </p>
            <h2 className="mt-4 text-headline text-[44px] text-zinc-50 sm:text-[56px]">Classes we offer.</h2>
          </div>

          <ScrollReveal delayMs={80} className="mt-10">
            <ClassesShowcase imageUrl="/marketing/training-floor.jpg" imageAlt="Inside the S&C training floor" />
          </ScrollReveal>
        </div>
      </section>

      {/* The Standard — differentiators. Structural copy only; see the
          DIFFERENTIATORS comment above re: placeholder specifics. */}
      <section className="relative border-t border-white/[0.06] bg-[var(--surface-1)]">
        <div className="mx-auto grid max-w-6xl gap-10 px-6 py-20 lg:grid-cols-[0.8fr_1.2fr]">
          <div>
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-gold">
              <span className="h-px w-8 bg-primary/70" />
              The Standard
            </p>
            <h2 className="mt-4 text-headline text-[44px] text-zinc-50 sm:text-[56px]">
              This is a coaching floor, not a workout class.
            </h2>
          </div>

          <div className="grid gap-6">
            {DIFFERENTIATORS.map((item, i) => (
              <div
                key={item.title}
                className={`pb-6 ${i !== DIFFERENTIATORS.length - 1 ? "border-b border-white/[0.08]" : ""}`}
              >
                <h3 className="text-headline text-[32px] text-gold">{item.title}</h3>
                <p className="mt-2 max-w-[52ch] text-base leading-relaxed text-zinc-300">{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Membership — one card per class from "Classes we offer" above,
          priced to match. Fixed marketing content, not catalog-driven (see
          the Classes we offer section for the same reasoning): the real
          catalog only prices Semi-Private tiers today, and these three
          cards are meant to mirror the class showcase one-to-one. */}
      <section className="relative border-t border-white/[0.06]">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <div className="max-w-lg">
            <h2 className="text-headline text-[44px] text-zinc-50 sm:text-[56px]">Choose how you train</h2>
            <p className="mt-4 max-w-[60ch] text-base leading-relaxed text-zinc-300">
              Every plan includes coach messaging, class booking, and full workout tracking.
            </p>
          </div>

          <ScrollReveal delayMs={80} className="mt-10">
            <ClassPricingShowcase href={AUTH_ROUTES.signup} />
          </ScrollReveal>
        </div>
      </section>

      {/* App-only membership (Tier 2) — the app-based alternative to the
          in-person memberships above: real screenshots, then the full feature
          index behind a native <details> disclosure (works without JS), then
          the launch line. See AppShowcase.tsx for why store links are
          placeholders. App questions live in the merged FAQ below. */}
      <section className="relative border-t border-white/[0.06]">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <div className="max-w-lg">
            <h2 className="text-headline text-[44px] text-zinc-50 sm:text-[56px]">Coaching that fits in your pocket.</h2>
            <p className="mt-4 max-w-[60ch] text-base leading-relaxed text-zinc-300">
              Not near the gym, or want to train on your own days? Get the same coaching approach, built into an app.
            </p>
          </div>

          <ScrollReveal delayMs={80} className="mt-10">
            <AppShowcase>
              <details className="group mt-12 border-t border-white/[0.08] pt-8">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 [&::-webkit-details-marker]:hidden">
                  <span className="text-headline text-[32px] text-zinc-50">See everything in the app</span>
                  <svg
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                    className="h-5 w-5 shrink-0 text-gold transition-transform duration-200 group-open:rotate-180"
                  >
                    <path d="M4 6l4 4 4-4" />
                  </svg>
                </summary>
                <div className="details-reveal">
                  <p className="mt-3 max-w-[60ch] text-base leading-relaxed text-zinc-300">
                    Every tool below is live in the app today — training, nutrition, recovery, and planning, all connected.
                  </p>
                  <div className="mt-10">
                    <AppFeatureGrid />
                  </div>
                </div>
              </details>
            </AppShowcase>
          </ScrollReveal>
        </div>
      </section>

      {/* FAQ — resolves the common objections/questions right before the
          final CTA asks for action. */}
      <section className="relative border-t border-white/[0.06]">
        <div className="mx-auto max-w-3xl px-6 py-20">
          <div className="max-w-lg">
            <h2 className="text-headline text-[44px] text-zinc-50 sm:text-[56px]">Common questions.</h2>
          </div>

          <div className="mt-10">
            <FaqSection />
          </div>
        </div>
      </section>

      {/* Final CTA — booking links, contact details, and a real lead-capture
          form (app/api/contact) so visitors can leave their details. id
          gives other sections' CTAs (e.g. "Book Your First Session") a real
          same-page destination to point at. */}
      <section id="contact" className="relative scroll-mt-20 border-t border-white/[0.06]">
        <div className="mx-auto grid max-w-5xl gap-12 px-6 py-24 lg:grid-cols-2 lg:items-start">
          <div>
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-gold">
              <span className="h-px w-8 bg-primary/70" />
              Get Started
            </p>
            <h2 className="mt-4 text-headline text-[44px] text-zinc-50 sm:text-[56px]">
              Begin your training with us.
            </h2>
            <p className="mt-4 max-w-md text-lg leading-relaxed text-zinc-300">
              Book your first session and walk out with a baseline, a plan, and a coach who already knows your goals.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <a
                href={`mailto:${CONTACT_INFO.email}`}
                className="inline-flex items-center justify-center rounded-[3px] bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground transition-[background-color] duration-150 hover:bg-[var(--primary-hover)]"
              >
                Book Your First Session
              </a>
              <a
                href={`tel:${CONTACT_INFO.phoneHref}`}
                className="inline-flex items-center justify-center rounded-[3px] border border-white/[0.14] px-6 py-3 text-sm font-medium text-zinc-200 transition-colors duration-150 hover:border-primary/40 hover:bg-white/[0.04]"
              >
                Call the Floor
              </a>
            </div>

            <dl className="mt-10 grid gap-4 border-t border-white/[0.08] pt-6">
              <div className="flex items-baseline gap-3">
                <dt className="w-16 flex-shrink-0 text-xs font-semibold uppercase tracking-[0.08em] text-zinc-500">Location</dt>
                <dd className="text-base text-zinc-200">{CONTACT_INFO.location}</dd>
              </div>
              <div className="flex items-baseline gap-3">
                <dt className="w-16 flex-shrink-0 text-xs font-semibold uppercase tracking-[0.08em] text-zinc-500">Email</dt>
                <dd className="break-all text-base text-zinc-200">{CONTACT_INFO.email}</dd>
              </div>
              <div className="flex items-baseline gap-3">
                <dt className="w-16 flex-shrink-0 text-xs font-semibold uppercase tracking-[0.08em] text-zinc-500">Phone</dt>
                <dd className="text-base text-zinc-200">{CONTACT_INFO.phone}</dd>
              </div>
            </dl>
          </div>

          <div>
            <ContactForm />
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative border-t border-white/[0.06]">
        <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-4 px-6 py-10 sm:flex-row sm:items-center">
          {/* eslint-disable-next-line @next/next/no-img-element -- small static brand asset, next/image's overhead isn't worth it here */}
          <img src="/brand/website-logo-v2.png" alt="S&amp;C Performance Coaching" className="h-8 w-auto" />
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-zinc-400">
            <Link href={AUTH_ROUTES.login} className="transition-colors duration-150 hover:text-gold">Sign in</Link>
            <Link href={AUTH_ROUTES.signup} className="transition-colors duration-150 hover:text-gold">Create account</Link>
            <Link href={AUTH_ROUTES.forgotPassword} className="transition-colors duration-150 hover:text-gold">Forgot password</Link>
            <Link href="/privacy" className="transition-colors duration-150 hover:text-gold">Privacy</Link>
            <Link href="/terms" className="transition-colors duration-150 hover:text-gold">Terms</Link>
          </div>
          <p className="text-xs text-zinc-500">© 2026 {BRAND_NAME}</p>
        </div>
      </footer>
    </main>
  );
}
