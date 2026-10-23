import type { Metadata } from "next";
import Link from "next/link";

import { Accordion } from "@/components/marketing/FaqSection";
import {
  BUTTON_PRIMARY,
  CtaBand,
  H2,
  MarketingPage,
  PageIntro,
  SECTION,
  SectionLabel,
} from "@/components/marketing/MarketingPage";
import { HeadlineText } from "@/components/ui/HeadlineText";
import { BRAND_NAME } from "@/lib/content";
import { ALL_FAQS } from "@/lib/faq-content";
import { HOME_INCLUDED } from "@/lib/homepage-content";
import { MARKETING_CLASSES } from "@/lib/marketing-classes";
import { CLASSES_PAGE, PRIMARY_CTA, START_STEPS } from "@/lib/site-content";

export const metadata: Metadata = {
  title: `Classes and pricing — ${BRAND_NAME}`,
  alternates: { canonical: "/classes" },
  description:
    "Semi-Private Personal Training, Parent & Baby Classes and Over 50s in Navan, Co. Meath: who each class is for, what's included, and prices.",
};

const LIST_HEADING = "text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500";

// /classes — the pricing-page pattern adapted to three offers: a self-select
// row, one structured section per class (who it's for, what's included, what's
// different, its own enquiry), then what every plan includes, how you start,
// and the questions people ask before enquiring. Layout only; copy lives in
// lib/marketing-classes.ts and lib/site-content.ts.
export default function ClassesPage() {
  const faqs = CLASSES_PAGE.faqQuestions
    .map((q) => ALL_FAQS.find((f) => f.question === q))
    .filter((f) => f !== undefined);

  return (
    <MarketingPage>
      <PageIntro label="Classes and pricing" title={CLASSES_PAGE.title} intro={CLASSES_PAGE.intro}>
        <p className={LIST_HEADING}>{CLASSES_PAGE.selectLabel}</p>
        <ul className="mt-4 grid gap-3 lg:grid-cols-3">
          {MARKETING_CLASSES.map((cls) => (
            <li key={cls.slug}>
              <a
                href={`#${cls.slug}`}
                className="group flex h-full items-start justify-between gap-4 rounded-[4px] border border-white/[0.1] bg-[var(--surface-1)] p-5 transition-colors duration-150 hover:border-primary/40"
              >
                <span>
                  <span className="block text-headline text-[26px] text-zinc-50">
                    <HeadlineText text={cls.name} />
                  </span>
                  <span className="mt-1 block text-sm leading-relaxed text-zinc-400">{cls.forWho[0]}</span>
                </span>
                <span aria-hidden className="mt-1 text-gold transition-transform duration-150 group-hover:translate-y-0.5">↓</span>
              </a>
            </li>
          ))}
        </ul>
      </PageIntro>

      {MARKETING_CLASSES.map((cls, i) => (
        <section
          key={cls.slug}
          id={cls.slug}
          aria-labelledby={`${cls.slug}-title`}
          className={`relative scroll-mt-20 border-t border-white/[0.06] ${i % 2 === 0 ? "bg-[var(--surface-1)]" : ""}`}
        >
          <div className={`${SECTION} grid gap-12 lg:grid-cols-[0.85fr_1.15fr] lg:gap-20`}>
            <div className="lg:sticky lg:top-28 lg:self-start">
              <p className="text-headline text-[28px] text-gold">{String(i + 1).padStart(2, "0")}</p>
              <h2 id={`${cls.slug}-title`} className={`mt-2 ${H2} text-zinc-50`}>
                <HeadlineText text={cls.name} />
              </h2>
              <p className="mt-5 flex items-baseline gap-1.5 text-sm text-zinc-400">
                From
                <span className="text-headline text-[52px] leading-none text-gold">{cls.price.from}</span>
                <span>/ {cls.price.per}</span>
              </p>
              <p className="mt-5 max-w-md text-lg leading-relaxed text-zinc-300">{cls.tagline}</p>
              <Link href={`/contact?class=${cls.slug}`} className={`mt-8 ${BUTTON_PRIMARY}`}>
                {cls.cta}
                <span aria-hidden className="transition-transform duration-150 group-hover:translate-x-0.5">→</span>
              </Link>
            </div>

            <div className="grid gap-12">
              <div>
                <h3 className={LIST_HEADING}>Who it&apos;s for</h3>
                <ul className="mt-5 grid gap-4">
                  {cls.forWho.map((line) => (
                    <li key={line} className="flex gap-4 text-lg leading-relaxed text-zinc-100">
                      <span aria-hidden className="mt-[0.85rem] h-px w-6 shrink-0 bg-primary" />
                      {line}
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <h3 className={LIST_HEADING}>What&apos;s included</h3>
                <ul className="mt-5 grid gap-x-8 gap-y-5 sm:grid-cols-2">
                  {cls.includes.map((line) => (
                    <li key={line} className="border-t border-white/[0.1] pt-4 text-base leading-relaxed text-zinc-300">
                      {line}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="border-l-2 border-primary pl-6">
                <h3 className={LIST_HEADING}>What makes it different</h3>
                <p className="mt-3 text-xl font-medium leading-snug text-zinc-50 sm:text-2xl">{cls.different}</p>
              </div>
            </div>
          </div>
        </section>
      ))}

      {/* Every plan includes — the light editorial band, as on the homepage. */}
      <section data-surface="light" className="relative bg-[#f2eee6] text-[#0a1526]">
        <div className={SECTION}>
          <SectionLabel tone="ivory">All three classes</SectionLabel>
          <h2 className={`mt-4 ${H2}`}>{CLASSES_PAGE.includedTitle}.</h2>
          <ul className="mt-12 grid gap-x-10 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
            {HOME_INCLUDED.map((item) => (
              <li key={item.title} className="border-t-2 border-[#c6a15b] pt-5">
                <h3 className="text-headline text-[28px]">{item.title}</h3>
                <p className="mt-2 text-base leading-relaxed text-[#2c3a52]">{item.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* How you start */}
      <section className="relative">
        <div className={SECTION}>
          <SectionLabel>What happens next</SectionLabel>
          <h2 className={`mt-4 ${H2} text-zinc-50`}>{CLASSES_PAGE.stepsTitle}</h2>
          <ol className="mt-12 grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
            {START_STEPS.map((step, i) => (
              <li key={step.title} className="border-t-2 border-primary pt-5">
                <p className="text-headline text-[44px] leading-none text-gold">{i + 1}</p>
                <h3 className="mt-3 text-headline text-[26px] text-zinc-50">{step.title}</h3>
                <p className="mt-2 text-base leading-relaxed text-zinc-400">{step.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Short FAQ */}
      <section className="relative border-t border-white/[0.06]">
        <div className="mx-auto grid max-w-6xl gap-10 px-6 py-24 lg:grid-cols-[0.85fr_1.15fr] lg:gap-20 lg:py-32">
          <div>
            <h2 className={`${H2} text-zinc-50`}>{CLASSES_PAGE.faqTitle}</h2>
            <Link
              href="/faq"
              className="group mt-6 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-gold transition-colors duration-150 hover:text-[var(--primary-hover)]"
            >
              See all questions
              <span aria-hidden className="transition-transform duration-150 group-hover:translate-x-0.5">→</span>
            </Link>
          </div>
          <Accordion items={faqs} idPrefix="classes-faq" />
        </div>
      </section>

      <CtaBand
        title="Not sure which class?"
        body="Tell us what you're training for and we'll point you to the right one."
        primary={PRIMARY_CTA}
        secondary={{ label: "Read the FAQ", href: "/faq" }}
      />
    </MarketingPage>
  );
}
