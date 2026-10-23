import type { Metadata } from "next";
import Link from "next/link";

import { CtaBand, H2, MarketingPage, PageIntro, SECTION, SectionLabel } from "@/components/marketing/MarketingPage";
import { ScrollReveal } from "@/components/ui/ScrollReveal";
import { BRAND_NAME, CONTACT_INFO } from "@/lib/content";
import { HOME_HERO } from "@/lib/homepage-content";
import { MARKETING_CLASSES } from "@/lib/marketing-classes";
import { ABOUT_PAGE, PRIMARY_CTA } from "@/lib/site-content";

export const metadata: Metadata = {
  title: `About — ${BRAND_NAME}`,
  description:
    "Who S&C Performance Coaching is for, how we coach, and why a coached small-group floor in Navan is different from a typical gym.",
};

// /about — trust through who we coach, what we believe and how coaching is
// structured, not a CV: no qualifications, years or results are claimed. The
// only photograph is S&C's own training floor. Copy lives in lib/site-content.ts.
export default function AboutPage() {
  return (
    <MarketingPage>
      <PageIntro label="About S&C" title={ABOUT_PAGE.title} intro={ABOUT_PAGE.intro} />

      {/* Who we coach — each links to its class. */}
      <section className="relative border-t border-white/[0.06] bg-[var(--surface-1)]">
        <div className={SECTION}>
          <SectionLabel>Who it&apos;s for</SectionLabel>
          <h2 className={`mt-4 ${H2} text-zinc-50`}>{ABOUT_PAGE.whoTitle}</h2>
          <ul className="mt-12 grid gap-10 lg:grid-cols-3">
            {ABOUT_PAGE.who.map((item, i) => (
              <li key={item.title} className="flex flex-col border-t-2 border-primary pt-5">
                <h3 className="text-headline text-[30px] text-zinc-50">{item.title}</h3>
                <p className="mt-3 flex-1 text-base leading-relaxed text-zinc-300">{item.body}</p>
                <Link
                  href={`/classes#${MARKETING_CLASSES[i].slug}`}
                  className="group mt-5 inline-flex min-h-11 items-center gap-1.5 self-start text-sm font-semibold text-gold transition-colors duration-150 hover:text-[var(--primary-hover)]"
                >
                  {MARKETING_CLASSES[i].name}
                  <span aria-hidden className="transition-transform duration-150 group-hover:translate-x-0.5">→</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Philosophy — the light editorial band. */}
      <section className="relative bg-[#f2eee6] text-[#0a1526]">
        <div className={`${SECTION} grid gap-14 lg:grid-cols-[0.8fr_1.2fr] lg:gap-20`}>
          <div className="lg:sticky lg:top-28 lg:self-start">
            <SectionLabel tone="ivory">Our approach</SectionLabel>
            <h2 className={`mt-4 ${H2}`}>{ABOUT_PAGE.philosophyTitle}</h2>
          </div>
          <ul className="grid gap-x-10 gap-y-12 sm:grid-cols-2">
            {ABOUT_PAGE.philosophy.map((item) => (
              <li key={item.title} className="border-t-2 border-[#c6a15b] pt-5">
                <h3 className="text-headline text-[30px]">{item.title}</h3>
                <p className="mt-3 text-base leading-relaxed text-[#2c3a52]">{item.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* How coaching is structured — a repeating cycle of blocks. */}
      <section className="relative">
        <div className={SECTION}>
          <div className="max-w-2xl">
            <SectionLabel>The method</SectionLabel>
            <h2 className={`mt-4 ${H2} text-zinc-50`}>{ABOUT_PAGE.structureTitle}</h2>
            <p className="mt-6 text-lg leading-relaxed text-zinc-300">{ABOUT_PAGE.structureIntro}</p>
          </div>
          <ol className="mt-14 grid gap-10 sm:grid-cols-2 lg:grid-cols-4 lg:gap-0">
            {ABOUT_PAGE.structure.map((step, i) => (
              <li key={step.title} className="relative border-t-2 border-primary pt-5 lg:pr-8">
                <p className="text-headline text-[44px] leading-none text-gold">{String(i + 1).padStart(2, "0")}</p>
                <h3 className="mt-3 text-headline text-[28px] text-zinc-50">{step.title}</h3>
                <p className="mt-2 text-base leading-relaxed text-zinc-400">{step.body}</p>
              </li>
            ))}
          </ol>
          <p className="mt-10 flex items-center gap-3 text-sm text-zinc-400">
            <span aria-hidden className="text-gold">↻</span>
            {ABOUT_PAGE.structureNote}
          </p>
        </div>
      </section>

      {/* Different from a typical gym — a plain two-column comparison. */}
      <section className="relative border-t border-white/[0.06] bg-[var(--surface-1)]">
        <div className={`${SECTION} grid gap-12 lg:grid-cols-[0.8fr_1.2fr] lg:gap-20`}>
          <div>
            <SectionLabel>The environment</SectionLabel>
            <h2 className={`mt-4 ${H2} text-zinc-50`}>{ABOUT_PAGE.differentTitle}</h2>
          </div>
          <table className="w-full border-collapse text-left">
            <caption className="sr-only">How S&amp;C compares with a typical gym</caption>
            <thead>
              <tr className="text-xs font-semibold uppercase tracking-[0.16em]">
                <th scope="col" className="w-1/2 pb-4 pr-4 font-semibold text-zinc-500">Typical gym</th>
                <th scope="col" className="w-1/2 pb-4 font-semibold text-gold">S&amp;C</th>
              </tr>
            </thead>
            <tbody>
              {ABOUT_PAGE.different.map((row) => (
                <tr key={row.us} className="border-t border-white/[0.1] align-top">
                  <td className="py-5 pr-4 text-base leading-relaxed text-zinc-500">{row.gym}</td>
                  <td className="py-5 text-base font-medium leading-relaxed text-zinc-50">{row.us}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Where we train — S&C's own floor, the one real photograph. */}
      <section className="relative">
        <div className={`${SECTION} grid items-center gap-12 lg:grid-cols-[1.2fr_0.8fr] lg:gap-20`}>
          <ScrollReveal>
            <figure>
              <div className="relative overflow-hidden rounded-[4px] border border-white/[0.1]">
                <div className="absolute inset-x-0 top-0 z-10 h-[2px] bg-primary" aria-hidden />
                {/* eslint-disable-next-line @next/next/no-img-element -- static marketing photo with fixed dimensions */}
                <img
                  src={HOME_HERO.image.src}
                  alt={HOME_HERO.image.alt}
                  width={2048}
                  height={779}
                  loading="lazy"
                  className="aspect-[16/10] w-full object-cover"
                />
              </div>
              <figcaption className="mt-3 text-sm text-zinc-500">{HOME_HERO.image.caption}</figcaption>
            </figure>
          </ScrollReveal>
          <div>
            <SectionLabel>Where we train</SectionLabel>
            <h2 className={`mt-4 ${H2} text-zinc-50`}>{CONTACT_INFO.location}.</h2>
            <p className="mt-6 text-lg leading-relaxed text-zinc-300">{ABOUT_PAGE.placeBody}</p>
          </div>
        </div>
      </section>

      <CtaBand
        title={ABOUT_PAGE.ctaTitle}
        body={ABOUT_PAGE.ctaBody}
        primary={PRIMARY_CTA}
        secondary={{ label: "See classes and pricing", href: "/classes" }}
      />
    </MarketingPage>
  );
}
