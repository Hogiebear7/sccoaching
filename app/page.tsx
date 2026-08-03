import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { findUserById } from "@/lib/db";
import { AUTH_ROUTES, BRAND_NAME, BRAND_TAGLINE, CONTACT_INFO, LANDING_DESCRIPTION, VALUE_PROPS } from "@/lib/content";
import { verifySession } from "@/lib/session";
import { ClassesShowcase } from "@/components/marketing/ClassesShowcase";
import { ClassPricingShowcase } from "@/components/marketing/ClassPricingShowcase";
import { ContactForm } from "@/components/marketing/ContactForm";
import { Ledger, type LedgerRow } from "@/components/marketing/Ledger";
import { ScrollReveal } from "@/components/ui/ScrollReveal";

// Structural copy, not business fact — the specific claims here (coach
// qualifications, locality specifics) are placeholders carried over from the
// design blueprint and need the client's confirmation/edit before launch.
const DIFFERENTIATORS = [
  {
    title: "Assessment before programming",
    body: "No member starts on a generic plan. Movement screens and baseline testing shape your first block before you lift a single working set.",
  },
  {
    title: "Capped coaching ratios",
    body: "Small-group sessions stay small on purpose — every rep gets watched, every cue is specific to you, not shouted at the room.",
  },
  {
    title: "Qualified S&C coaches",
    body: "Every coach on the floor is degree-qualified in strength & conditioning, not a personal trainer certificate away from athletics.",
  },
  {
    title: "Rooted in the community",
    body: "Built for members training toward their own first standard, alongside athletes preparing for their sport's season.",
  },
] as const;

const SAMPLE_LEDGER_ROWS: LedgerRow[] = [
  { metric: "Back Squat 1RM", athlete: "C.M.", value: "142", unit: "kg", delta: "+12kg / 8wk", deltaDirection: "up" },
  { metric: "10m Sprint", athlete: "R.O.", value: "1.71", unit: "s", delta: "−0.09s / 6wk", deltaDirection: "up" },
  { metric: "Broad Jump", athlete: "S.K.", value: "2.58", unit: "m", delta: "+14cm / 10wk", deltaDirection: "up" },
  { metric: "CMJ Height", athlete: "L.D.", value: "41.2", unit: "cm", delta: "+5.6cm / 8wk", deltaDirection: "up" },
];

// Split the tagline on its em-dash so the second half can take the gold accent,
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


  const [taglineLead, taglineAccent] = splitTagline(BRAND_TAGLINE);

  return (
    <main
      data-palette="gold"
      data-theme="navy"
      className="relative min-h-screen overflow-hidden text-zinc-100"
    >
      {/* Ambient — restrained hairline grid, no aurora/skew streaks */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[620px] opacity-60 [mask-image:linear-gradient(to_bottom,black,transparent_90%)]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(90deg, var(--border-subtle) 0, var(--border-subtle) 1px, transparent 1px, transparent 120px)",
        }}
      />

      {/* Top navigation — brand lockup mirrors index.html exactly */}
      <nav className="anim-fade relative mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <div className="flex items-center gap-3">
          <span className="text-editorial text-[22px] italic text-gold">S&amp;C</span>
          <span className="h-7 w-px bg-white/[0.14]" />
          <span className="text-mono hidden text-[10px] uppercase leading-[1.35] tracking-[0.08em] text-zinc-400 sm:block">
            Performance
            <br />
            Coaching
          </span>
        </div>
        <div className="flex items-center gap-2.5">
          <Link
            href={AUTH_ROUTES.login}
            className="rounded-[3px] px-4 py-2 text-sm font-medium text-zinc-300 transition-colors duration-150 hover:bg-white/[0.06] hover:text-white"
          >
            Sign in
          </Link>
          <Link
            href={AUTH_ROUTES.signup}
            className="rounded-[3px] bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-[background-color,transform] duration-150 hover:bg-[var(--primary-hover)] active:translate-y-px"
          >
            Create account
          </Link>
        </div>
      </nav>

      {/* Hero — editorial split, staggered page-load choreography. The
          Ledger is the signature element (from the index.html blueprint)
          in place of a stock athlete photo. */}
      <section className="relative mx-auto grid max-w-6xl items-start gap-14 px-6 pb-24 pt-14 lg:grid-cols-[1.05fr_0.95fr] lg:pt-20">
        <div>
          <p
            className="anim-rise text-mono flex items-center gap-2 text-xs font-medium uppercase tracking-[0.28em] text-gold"
            style={{ animationDelay: "60ms" }}
          >
            <span className="h-px w-8 bg-primary/70" />
            {BRAND_NAME}
          </p>
          <h1
            className="anim-rise mt-6 text-editorial text-[46px] leading-[1.04] text-zinc-50 sm:text-[62px]"
            style={{ animationDelay: "150ms" }}
          >
            {taglineLead}
            {taglineAccent ? (
              <>
                {" "}
                <em className="not-italic text-gold">{taglineAccent}</em>
              </>
            ) : null}
          </h1>
          <p
            className="anim-rise mt-6 max-w-md text-base leading-relaxed text-zinc-400"
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
              <li key={item} className="flex items-start gap-3 text-sm text-zinc-300">
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
          <Ledger
            title="Session Ledger"
            tag="Latest Testing Block"
            rows={SAMPLE_LEDGER_ROWS}
            footnote="Representative data — your numbers, tracked from week one."
          />
        </div>
      </section>

      {/* Classes we offer — curated services panel (hover/tap reveals each
          class's description) over the real gym photo. Replaces the old
          literal weekly timetable; these three classes are fixed content,
          not derived from booking data. */}
      <section className="relative border-t border-white/[0.06]">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <ScrollReveal className="max-w-lg">
            <p className="text-mono flex items-center gap-2 text-xs font-medium uppercase tracking-[0.28em] text-gold">
              <span className="h-px w-8 bg-primary/70" />
              The Training Floor
            </p>
            <h2 className="mt-4 text-editorial text-[32px] text-zinc-50">Classes we offer.</h2>
          </ScrollReveal>

          <ScrollReveal delayMs={80} className="mt-10">
            <ClassesShowcase imageUrl="/gymPicture.jpg" imageAlt="Inside the S&C training floor" />
          </ScrollReveal>
        </div>
      </section>

      {/* Membership — one card per class from "Classes we offer" above,
          priced to match. Fixed marketing content, not catalog-driven (see
          the Classes we offer section for the same reasoning): the real
          catalog only prices Semi-Private tiers today, and these three
          cards are meant to mirror the class showcase one-to-one. */}
      <section className="relative border-t border-white/[0.06]">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <ScrollReveal className="max-w-lg">
            <p className="text-mono flex items-center gap-2 text-xs font-medium uppercase tracking-[0.28em] text-gold">
              <span className="h-px w-8 bg-primary/70" />
              Membership
            </p>
            <h2 className="text-condensed mt-4 text-4xl uppercase text-zinc-50">Choose how you train</h2>
            <p className="mt-3 text-sm leading-relaxed text-zinc-400">
              Every plan includes coach messaging, class booking, and full workout tracking.
            </p>
          </ScrollReveal>

          <ScrollReveal delayMs={80} className="mt-10">
            <ClassPricingShowcase href={AUTH_ROUTES.signup} />
          </ScrollReveal>
        </div>
      </section>

      {/* The Standard — differentiators. Structural copy only; see the
          DIFFERENTIATORS comment above re: placeholder specifics. */}
      <section className="relative border-t border-white/[0.06] bg-[var(--surface-1)]">
        <div className="mx-auto grid max-w-6xl gap-10 px-6 py-20 lg:grid-cols-[0.8fr_1.2fr]">
          <ScrollReveal>
            <p className="text-mono flex items-center gap-2 text-xs font-medium uppercase tracking-[0.28em] text-gold">
              <span className="h-px w-8 bg-primary/70" />
              The Standard
            </p>
            <h2 className="mt-4 text-editorial text-[34px] leading-[1.1] text-zinc-50">
              This is a coaching floor, not a workout class.
            </h2>
          </ScrollReveal>

          <div className="grid gap-6">
            {DIFFERENTIATORS.map((item, i) => (
              <ScrollReveal
                key={item.title}
                delayMs={i * 90}
                className={`pb-6 ${i !== DIFFERENTIATORS.length - 1 ? "border-b border-white/[0.08]" : ""}`}
              >
                <h3 className="text-editorial text-[19px] text-gold">{item.title}</h3>
                <p className="mt-2 max-w-[52ch] text-sm leading-relaxed text-zinc-400">{item.body}</p>
              </ScrollReveal>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA — booking links, contact details, and a real lead-capture
          form (app/api/contact) so visitors can leave their details. id
          gives other sections' CTAs (e.g. "Book Your Assessment") a real
          same-page destination to point at. */}
      <section id="contact" className="relative scroll-mt-20 border-t border-white/[0.06]">
        <div className="mx-auto grid max-w-5xl gap-12 px-6 py-24 lg:grid-cols-2 lg:items-start">
          <ScrollReveal>
            <p className="text-mono flex items-center gap-2 text-xs font-medium uppercase tracking-[0.28em] text-gold">
              <span className="h-px w-8 bg-primary/70" />
              Start Your Block
            </p>
            <h2 className="mt-4 text-editorial text-[38px] italic leading-[1.06] text-zinc-50">
              Your first session starts the ledger.
            </h2>
            <p className="mt-4 max-w-md text-base leading-relaxed text-zinc-400">
              Book an assessment and leave with a baseline, a block, and a coach who's read both.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <a
                href={`mailto:${CONTACT_INFO.email}`}
                className="inline-flex items-center justify-center rounded-[3px] bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground transition-[background-color] duration-150 hover:bg-[var(--primary-hover)]"
              >
                Book Your Assessment
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
                <dt className="text-mono w-16 flex-shrink-0 text-[10px] uppercase tracking-[0.08em] text-zinc-500">Location</dt>
                <dd className="text-sm text-zinc-200">{CONTACT_INFO.location}</dd>
              </div>
              <div className="flex items-baseline gap-3">
                <dt className="text-mono w-16 flex-shrink-0 text-[10px] uppercase tracking-[0.08em] text-zinc-500">Email</dt>
                <dd className="break-all text-sm text-zinc-200">{CONTACT_INFO.email}</dd>
              </div>
              <div className="flex items-baseline gap-3">
                <dt className="text-mono w-16 flex-shrink-0 text-[10px] uppercase tracking-[0.08em] text-zinc-500">Phone</dt>
                <dd className="text-sm text-zinc-200">{CONTACT_INFO.phone}</dd>
              </div>
            </dl>
          </ScrollReveal>

          <ScrollReveal delayMs={120}>
            <ContactForm />
          </ScrollReveal>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative border-t border-white/[0.06]">
        <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-4 px-6 py-10 sm:flex-row sm:items-center">
          <div className="flex items-center gap-3">
            <span className="text-editorial text-[17px] italic text-gold">S&amp;C</span>
            <span className="h-6 w-px bg-white/[0.14]" />
            <span className="text-mono text-[10px] uppercase tracking-[0.08em] text-zinc-400">Performance Coaching</span>
          </div>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[13px] text-zinc-500">
            <Link href={AUTH_ROUTES.login} className="transition-colors duration-150 hover:text-gold">Sign in</Link>
            <Link href={AUTH_ROUTES.signup} className="transition-colors duration-150 hover:text-gold">Create account</Link>
            <Link href={AUTH_ROUTES.forgotPassword} className="transition-colors duration-150 hover:text-gold">Forgot password</Link>
            <Link href="/privacy" className="transition-colors duration-150 hover:text-gold">Privacy</Link>
            <Link href="/terms" className="transition-colors duration-150 hover:text-gold">Terms</Link>
          </div>
          <p className="text-mono text-xs text-zinc-600">© 2026 {BRAND_NAME}</p>
        </div>
      </footer>
    </main>
  );
}
