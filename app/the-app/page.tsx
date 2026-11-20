import type { Metadata } from "next";

import { AppFeatureGrid } from "@/components/marketing/AppFeatureGrid";
import { AppShowcase } from "@/components/marketing/AppShowcase";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, CtaBand, H2, MarketingPage, PageIntro, SECTION, SectionLabel } from "@/components/marketing/MarketingPage";
import { ScrollReveal } from "@/components/ui/ScrollReveal";
import { AUTH_ROUTES, BRAND_NAME } from "@/lib/content";
import { PRIMARY_CTA } from "@/lib/site-content";

export const metadata: Metadata = {
  title: `The app — ${BRAND_NAME}`,
  alternates: { canonical: "/the-app" },
  description:
    "The S&C app: training, nutrition and recovery in one place. Free to download; the App Subscription unlocks the Nutrition Coach, Ask the app, adaptive targets, programmes and more.",
};

// What the App Subscription adds on top of the free app (mirrors the FAQ and llms.txt).
const PAID_FEATURES = [
  { title: "Nutrition Coach", body: "Log a meal from a photo or a description and get coaching built around your day." },
  { title: "Ask the app", body: "Ask a question any time and get an answer based on your own training, recovery and nutrition." },
  { title: "Adaptive targets", body: "Calorie and macro targets that move with your training load, week by week." },
  { title: "Full programmes", body: "Multi-week programmes written around your goals and your equipment, adjusted as you log." },
  { title: "Meal ideas", body: "Photograph your ingredients or describe what is in the fridge and get meals built from what you actually have." },
  { title: "Cycle-phase guidance", body: "Training and recovery guidance that follows your cycle, private to you." },
  { title: "Community leaderboards", body: "See where you rank among friends and your gym, and celebrate every personal best." },
  { title: "Full history", body: "Every session, lift and check-in kept, so you can see how far you've come." },
  { title: "And much, much more", body: "Every tool in the app is unlocked, with new ones arriving as we build them." },
] as const;

// /the-app — everything in the member app, on its own page (the homepage shows a short preview and links here).
export default function TheAppPage() {
  return (
    <MarketingPage>
      <PageIntro
        label="The app"
        title="Coaching that fits in your pocket."
        intro="Not near the gym, or want to train on your own days? Get the same coaching approach, built into an app."
      >
        <div className="flex flex-col gap-3 sm:flex-row">
          <a href="#subscription" className={BUTTON_PRIMARY}>
            See what you unlock
            <span aria-hidden className="transition-transform duration-150 group-hover:translate-x-0.5">↓</span>
          </a>
          <a href={AUTH_ROUTES.signup} className={BUTTON_SECONDARY}>
            Create your account
          </a>
        </div>
      </PageIntro>

      <section className="relative border-t border-white/[0.06] bg-[var(--surface-1)]">
        <div className={SECTION}>
          <ScrollReveal>
            <AppShowcase>
              <div className="mt-16 border-t border-white/[0.08] pt-12">
                <h2 className="text-headline text-[32px] text-zinc-50">See everything in the app</h2>
                <p className="mt-3 max-w-[60ch] text-base leading-relaxed text-zinc-300">
                  Every tool below is live in the app today: training, nutrition, recovery and planning, all connected.
                </p>
                <div className="mt-10">
                  <AppFeatureGrid />
                </div>
              </div>
            </AppShowcase>
          </ScrollReveal>
        </div>
      </section>

      <section id="subscription" className="relative scroll-mt-20 border-t border-white/[0.06]">
        <div className={SECTION}>
          <SectionLabel>App Subscription</SectionLabel>
          <h2 className={`mt-4 max-w-3xl ${H2} text-zinc-50`}>Free to start. Built to take you further.</h2>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-zinc-300">
            Logging workouts, meals and check-ins is free. The App Subscription unlocks the full coaching toolkit, so the app does the planning and you do the training.
          </p>
          <ul className="mt-12 grid gap-x-10 gap-y-9 sm:grid-cols-2 lg:grid-cols-3">
            {PAID_FEATURES.map((f) => (
              <li key={f.title} className="rounded-[4px] border border-white/[0.1] border-t-2 border-t-gold bg-[var(--surface-1)] p-6 transition-colors duration-200 hover:border-primary/40">
                <h3 className="text-headline text-[28px] text-gold">{f.title}</h3>
                <p className="mt-2 text-base leading-relaxed text-zinc-300">{f.body}</p>
              </li>
            ))}
          </ul>
          <div className="mt-14 border-t border-white/[0.08] pt-8">
            <p className="text-headline text-[40px] text-zinc-50">
              €12.99 a month <span className="text-gold">or €119.99 a year</span>
            </p>
            <p className="mt-2 text-base text-zinc-300">
              7-day free trial. No gym visit needed. Cancel any time in your store settings. All of it is included with a gym Membership.
            </p>
          </div>
        </div>
      </section>

      <CtaBand
        title="Train with a coach, or on your own."
        body="Join a class and get the app included, or start with the app and add the gym when you're ready."
        primary={{ label: PRIMARY_CTA.label, href: PRIMARY_CTA.href }}
        secondary={{ label: "See classes and pricing", href: "/classes" }}
      />
    </MarketingPage>
  );
}
