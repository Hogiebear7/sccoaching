import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { findUserById } from "@/lib/db";
import { AUTH_ROUTES, CONTACT_INFO } from "@/lib/content";
import { HOME_APPROACH, HOME_CONTACT, HOME_HERO, HOME_INCLUDED, HOME_PROGRESS, HOME_PROOF } from "@/lib/homepage-content";
import { verifySession } from "@/lib/session";
import { AppFeatureGrid } from "@/components/marketing/AppFeatureGrid";
import { AppShowcase } from "@/components/marketing/AppShowcase";
import { ClassOffers } from "@/components/marketing/ClassOffers";
import { ContactForm } from "@/components/marketing/ContactForm";
import { FaqSection } from "@/components/marketing/FaqSection";
import { HeroShader } from "@/components/marketing/HeroShader";
import { H2, SECTION } from "@/components/marketing/MarketingPage";
import { MemberPreviewStack } from "@/components/marketing/MemberPreviewStack";
import { SiteFooter } from "@/components/marketing/SiteFooter";
import { SiteHeader } from "@/components/marketing/SiteHeader";
import { ScrollReveal } from "@/components/ui/ScrollReveal";

// Public homepage. Layout only: all copy lives in lib/homepage-content.ts and
// lib/marketing-classes.ts so it can later be edited from the back end/CMS.
// Section rhythm: navy hero → proof strip → classes → ivory "approach" band →
// progress → app → FAQ → contact. See DESIGN.md for the system.

export const metadata: Metadata = {
  title: "S&C Performance Coaching — Small-group strength coaching in Navan",
  alternates: { canonical: "/" },
};

const LABEL = "flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-gold";
const MORE_LINK = "group inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-gold transition-colors duration-150 hover:text-[var(--primary-hover)]";

export default async function Root() {
  const cookieStore = await cookies();
  const userId = verifySession(cookieStore.get("session")?.value)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;

  if (user) {
    redirect("/dashboard");
  }

  return (
    <main data-palette="gold" data-theme="navy" className="relative min-h-screen overflow-hidden text-zinc-100">
      {/* Ambient — slow navy haze with drifting chalk specks behind the hero */}
      <HeroShader className="pointer-events-none absolute inset-x-0 top-0 h-[820px] [mask-image:linear-gradient(to_bottom,black,transparent_92%)]" />

      <SiteHeader />

      {/* Hero — who we help and the outcome, one primary action, the real
          training floor as the brand-led visual. */}
      <section className="relative mx-auto grid max-w-6xl items-center gap-12 px-6 pb-20 pt-14 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16 lg:pb-28 lg:pt-24">
        <div>
          <h1 className="anim-rise text-headline text-[64px] text-zinc-50 sm:text-[96px]" style={{ animationDelay: "60ms" }}>
            {HOME_HERO.headline.lead}{" "}
            <em className="not-italic text-gold">{HOME_HERO.headline.accent}</em>
          </h1>
          <p className="anim-rise mt-6 max-w-lg text-lg leading-relaxed text-zinc-300 sm:text-xl" style={{ animationDelay: "140ms" }}>
            {HOME_HERO.intro}
          </p>
          <div className="anim-rise mt-10 flex flex-col gap-3 sm:flex-row sm:items-center" style={{ animationDelay: "220ms" }}>
            <a
              href={HOME_HERO.primaryCta.href}
              className="group inline-flex h-12 items-center justify-center gap-2 rounded-[3px] bg-primary px-7 text-sm font-semibold text-primary-foreground transition-[background-color,transform] duration-150 hover:bg-[var(--primary-hover)] active:translate-y-px"
            >
              {HOME_HERO.primaryCta.label}
              <span aria-hidden className="transition-transform duration-150 group-hover:translate-x-0.5">→</span>
            </a>
            <a
              href={HOME_HERO.secondaryCta.href}
              className="inline-flex h-12 items-center justify-center rounded-[3px] border border-white/[0.16] px-7 text-sm font-medium text-zinc-200 transition-colors duration-150 hover:border-primary/50 hover:text-white"
            >
              {HOME_HERO.secondaryCta.label}
            </a>
          </div>
        </div>

        <figure className="anim-fade relative" style={{ animationDelay: "120ms" }}>
          <div className="relative overflow-hidden rounded-[4px] border border-white/[0.1]">
            <div className="absolute inset-x-0 top-0 z-10 h-[2px] bg-primary" aria-hidden />
            {/* eslint-disable-next-line @next/next/no-img-element -- static marketing photo with fixed dimensions */}
            <img
              src={HOME_HERO.image.src}
              alt={HOME_HERO.image.alt}
              width={2048}
              height={779}
              fetchPriority="high"
              className="aspect-[4/3] w-full object-cover lg:aspect-[4/5]"
            />
          </div>
          <figcaption className="mt-3 text-sm text-zinc-500">{HOME_HERO.image.caption}</figcaption>
        </figure>
      </section>

      {/* Proof strip — how the coaching works, no invented statistics. */}
      <section aria-label="How S&C coaching works" className="relative border-y border-white/[0.06] bg-[var(--surface-1)]">
        <dl className="mx-auto grid max-w-6xl grid-cols-2 gap-x-6 gap-y-10 px-6 py-12 lg:grid-cols-4 lg:py-14">
          {HOME_PROOF.map((item) => (
            <div key={item.label} className="lg:border-l lg:border-white/[0.08] lg:pl-6 lg:first:border-l-0 lg:first:pl-0">
              <dt className="text-headline text-[44px] leading-none text-zinc-50">{item.value}</dt>
              <dd className="mt-2 max-w-[22ch] text-sm leading-relaxed text-zinc-400">{item.label}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* Classes — the three offers with pricing; details on hover, focus or tap. */}
      <section id="classes" className="relative scroll-mt-20">
        <div className={SECTION}>
          <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
            <div>
              <p className={LABEL}>
                <span className="h-px w-8 bg-primary/70" />
                The training floor
              </p>
              <h2 className={`mt-4 ${H2} text-zinc-50`}>Classes we offer.</h2>
            </div>
            <p className="max-w-md text-base leading-relaxed text-zinc-300">
              Every class is coached, capped and programmed. Every plan includes coach messaging, class booking and full workout tracking.
            </p>
          </div>
          <ScrollReveal className="mt-12">
            <ClassOffers />
          </ScrollReveal>
          <Link href="/classes" className={`mt-10 ${MORE_LINK}`}>
            Compare the classes in detail
            <span aria-hidden className="transition-transform duration-150 group-hover:translate-x-0.5">→</span>
          </Link>
        </div>
      </section>

      {/* Approach — the one light editorial band on the page. */}
      <section id="approach" data-surface="light" className="relative scroll-mt-20 bg-[#f2eee6] text-[#0a1526]">
        <div className={`${SECTION} grid gap-14 lg:grid-cols-[0.9fr_1.1fr] lg:gap-20`}>
          <div className="lg:sticky lg:top-28 lg:self-start">
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-[#8a6a2f]">
              <span className="h-px w-8 bg-[#8a6a2f]" />
              Our approach
            </p>
            <h2 className={`mt-4 ${H2}`}>{HOME_APPROACH.title}</h2>
            <p className="mt-6 max-w-md text-lg leading-relaxed text-[#2c3a52]">{HOME_APPROACH.intro}</p>
          </div>
          <ul className="grid gap-10">
            {HOME_APPROACH.pillars.map((item) => (
              <li key={item.title} className="border-t-2 border-[#c6a15b] pt-6">
                <h3 className="text-headline text-[34px]">{item.title}</h3>
                <p className="mt-3 max-w-[52ch] text-base leading-relaxed text-[#2c3a52]">{item.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Progress — credibility from how training is measured and what every
          plan includes, using the real app; no testimonials or results claims. */}
      <section id="progress" className="relative scroll-mt-20">
        <div className={`${SECTION} grid items-center gap-14 lg:grid-cols-2 lg:gap-20`}>
          <div>
            <p className={LABEL}>
              <span className="h-px w-8 bg-primary/70" />
              Measured, not guessed
            </p>
            <h2 className={`mt-4 ${H2} text-zinc-50`}>{HOME_PROGRESS.title}</h2>
            <p className="mt-6 max-w-md text-lg leading-relaxed text-zinc-300">{HOME_PROGRESS.intro}</p>
            <ul className="mt-10 grid gap-6">
              {HOME_PROGRESS.points.map((p) => (
                <li key={p.title} className="flex gap-4">
                  <span aria-hidden className="mt-3 h-px w-6 shrink-0 bg-primary" />
                  <div>
                    <p className="text-base font-semibold text-zinc-50">{p.title}</p>
                    <p className="mt-1 text-base leading-relaxed text-zinc-400">{p.body}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <ScrollReveal>
            <MemberPreviewStack />
            <p className="mt-4 text-xs italic text-zinc-500">Representative data. Your numbers, tracked from week one.</p>
          </ScrollReveal>
        </div>

        {/* Every plan includes — concrete terms (mirroring the FAQ and the
            app's real booking/pause rules) instead of social proof. */}
        <div className="mx-auto max-w-6xl px-6 pb-24 lg:pb-32">
          <div className="border-t border-white/[0.08] pt-12">
            <h3 className="text-headline text-[32px] text-zinc-50">Every plan includes</h3>
            <ul className="mt-8 grid gap-x-8 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">
              {HOME_INCLUDED.map((item) => (
                <li key={item.title} className="border-t-2 border-primary pt-4">
                  <p className="text-base font-semibold text-zinc-50">{item.title}</p>
                  <p className="mt-1 text-sm leading-relaxed text-zinc-400">{item.body}</p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* The app — for members who train on their own days. */}
      <section id="app" className="relative scroll-mt-20 border-t border-white/[0.06] bg-[var(--surface-1)]">
        <div className={SECTION}>
          <div className="max-w-xl">
            <p className={LABEL}>
              <span className="h-px w-8 bg-primary/70" />
              The app
            </p>
            <h2 className={`mt-4 ${H2} text-zinc-50`}>Coaching that fits in your pocket.</h2>
            <p className="mt-6 text-lg leading-relaxed text-zinc-300">
              Not near the gym, or want to train on your own days? Get the same coaching approach, built into an app.
            </p>
          </div>

          <ScrollReveal className="mt-12">
            <AppShowcase>
              <details className="group mt-12 border-t border-white/[0.08] pt-8">
                <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 [&::-webkit-details-marker]:hidden">
                  <span className="text-headline text-[32px] text-zinc-50">See everything in the app</span>
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden className="h-5 w-5 shrink-0 text-gold transition-transform duration-200 group-open:rotate-180">
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

      {/* FAQ — resolves the common objections right before the final CTA. */}
      <section id="faq" className="relative scroll-mt-20 border-t border-white/[0.06]">
        <div className="mx-auto max-w-3xl px-6 py-24 lg:py-32">
          <h2 className={`${H2} text-zinc-50`}>Common questions.</h2>
          <div className="mt-12">
            <FaqSection />
          </div>
          <Link href="/faq" className={`mt-10 ${MORE_LINK}`}>
            See all questions
            <span aria-hidden className="transition-transform duration-150 group-hover:translate-x-0.5">→</span>
          </Link>
        </div>
      </section>

      {/* Contact — one obvious next step, three-step expectation, low-friction form. */}
      <section id="contact" className="relative scroll-mt-20 border-t border-white/[0.06] bg-[var(--surface-1)]">
        <div className="mx-auto grid max-w-6xl gap-14 px-6 py-24 lg:grid-cols-[1.05fr_0.95fr] lg:items-start lg:gap-20 lg:py-32">
          <div>
            <p className={LABEL}>
              <span className="h-px w-8 bg-primary/70" />
              Get started
            </p>
            <h2 className={`mt-4 ${H2} text-zinc-50`}>{HOME_CONTACT.title}</h2>
            <p className="mt-6 max-w-md text-lg leading-relaxed text-zinc-300">{HOME_CONTACT.intro}</p>

            <ol className="mt-10 grid gap-6 sm:grid-cols-3">
              {HOME_CONTACT.steps.map((s) => (
                <li key={s.title} className="border-t-2 border-primary pt-4">
                  <p className="text-headline text-[24px] text-zinc-50">{s.title}</p>
                  <p className="mt-1 text-sm leading-relaxed text-zinc-400">{s.body}</p>
                </li>
              ))}
            </ol>

            <div className="mt-10 flex flex-col gap-3 sm:flex-row">
              <a
                href={`mailto:${CONTACT_INFO.email}?subject=${encodeURIComponent("First session enquiry")}`}
                className="inline-flex h-12 items-center justify-center rounded-[3px] bg-primary px-7 text-sm font-semibold text-primary-foreground transition-[background-color,transform] duration-150 hover:bg-[var(--primary-hover)] active:translate-y-px"
              >
                {HOME_CONTACT.primaryCta}
              </a>
              <a
                href={`tel:${CONTACT_INFO.phoneHref}`}
                className="inline-flex h-12 items-center justify-center rounded-[3px] border border-white/[0.16] px-7 text-sm font-medium text-zinc-200 transition-colors duration-150 hover:border-primary/50 hover:text-white"
              >
                {HOME_CONTACT.secondaryCta}
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
            <p className="mt-6 text-sm text-zinc-400">
              Already decided?{" "}
              <Link href={AUTH_ROUTES.signup} className="font-semibold text-gold transition-colors duration-150 hover:text-[var(--primary-hover)]">
                Create your account
              </Link>
            </p>
          </div>

          <ContactForm />
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}
