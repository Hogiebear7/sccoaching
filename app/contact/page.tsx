import type { Metadata } from "next";
import Link from "next/link";

import { ContactForm } from "@/components/marketing/ContactForm";
import { BUTTON_SECONDARY, MarketingPage, PageIntro } from "@/components/marketing/MarketingPage";
import { AUTH_ROUTES, BRAND_NAME, CONTACT_INFO } from "@/lib/content";
import { findMarketingClass } from "@/lib/marketing-classes";
import { CONTACT_PAGE, START_STEPS } from "@/lib/site-content";

export const metadata: Metadata = {
  title: `Contact and booking — ${BRAND_NAME}`,
  alternates: { canonical: "/contact" },
  description: "Enquire about classes or book your first session at S&C Performance Coaching in Navan, Co. Meath.",
};

const SUB_HEADING = "text-headline text-[32px] text-zinc-50";

// /contact — the low-friction enquiry: the form first (preselecting the class
// when arriving from /classes?class=<slug>), then what happens next and the
// direct email/phone route. Copy lives in lib/site-content.ts.
export default async function ContactPage({ searchParams }: { searchParams: Promise<{ class?: string | string[] }> }) {
  const { class: slug } = await searchParams;
  const preselected = findMarketingClass(typeof slug === "string" ? slug : undefined);

  return (
    <MarketingPage>
      <PageIntro label="Contact" title={CONTACT_PAGE.title} intro={CONTACT_PAGE.intro} />

      <section className="relative mx-auto grid max-w-6xl gap-14 px-6 pb-24 lg:grid-cols-[1.1fr_0.9fr] lg:gap-20 lg:pb-32">
        <div>
          <h2 className={SUB_HEADING}>{CONTACT_PAGE.formTitle}</h2>
          <p className="mt-2 text-sm text-zinc-400">{CONTACT_PAGE.formNote}</p>
          <div className="mt-6">
            <ContactForm initialInterest={preselected?.name ?? ""} />
          </div>
        </div>

        <div className="grid content-start gap-14">
          <div>
            <h2 className={SUB_HEADING}>{CONTACT_PAGE.stepsTitle}</h2>
            <ol className="mt-6 grid gap-6">
              {START_STEPS.map((step, i) => (
                <li key={step.title} className="flex gap-5 border-t border-white/[0.1] pt-5">
                  <span className="text-headline w-8 shrink-0 text-[32px] leading-none text-gold">{i + 1}</span>
                  <div>
                    <p className="text-base font-semibold text-zinc-50">{step.title}</p>
                    <p className="mt-1 text-base leading-relaxed text-zinc-400">{step.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>

          <div className="rounded-[4px] border border-white/[0.08] bg-[var(--surface-1)] p-6">
            <h2 className={SUB_HEADING}>{CONTACT_PAGE.directTitle}</h2>
            <p className="mt-2 text-base text-zinc-300">{CONTACT_PAGE.directBody}</p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <a href={`mailto:${CONTACT_INFO.email}?subject=${encodeURIComponent("First session enquiry")}`} className={BUTTON_SECONDARY}>
                Email us
              </a>
              <a href={`tel:${CONTACT_INFO.phoneHref}`} className={BUTTON_SECONDARY}>
                Call {CONTACT_INFO.phone}
              </a>
            </div>
            <dl className="mt-6 grid gap-3 border-t border-white/[0.08] pt-5">
              <div className="flex items-baseline gap-3">
                <dt className="w-16 shrink-0 text-xs font-semibold uppercase tracking-[0.08em] text-zinc-500">Email</dt>
                <dd className="break-all text-base text-zinc-200">{CONTACT_INFO.email}</dd>
              </div>
              <div className="flex items-baseline gap-3">
                <dt className="w-16 shrink-0 text-xs font-semibold uppercase tracking-[0.08em] text-zinc-500">Location</dt>
                <dd className="text-base text-zinc-200">{CONTACT_INFO.location}</dd>
              </div>
            </dl>
          </div>

          <p className="text-sm text-zinc-400">
            Still choosing?{" "}
            <Link href="/classes" className="font-semibold text-gold transition-colors duration-150 hover:text-[var(--primary-hover)]">
              Compare the classes
            </Link>{" "}
            or{" "}
            <Link href="/faq" className="font-semibold text-gold transition-colors duration-150 hover:text-[var(--primary-hover)]">
              read the FAQ
            </Link>
            . Already a member?{" "}
            <Link href={AUTH_ROUTES.login} className="font-semibold text-gold transition-colors duration-150 hover:text-[var(--primary-hover)]">
              Log in
            </Link>
            .
          </p>
        </div>
      </section>
    </MarketingPage>
  );
}
