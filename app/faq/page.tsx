import type { Metadata } from "next";

import { FaqSection } from "@/components/marketing/FaqSection";
import { CtaBand, MarketingPage, PageIntro } from "@/components/marketing/MarketingPage";
import { BRAND_NAME } from "@/lib/content";
import { ALL_FAQS, FAQ_GROUPS } from "@/lib/faq-content";
import { FAQ_PAGE, PRIMARY_CTA } from "@/lib/site-content";

export const metadata: Metadata = {
  title: `FAQ — ${BRAND_NAME}`,
  alternates: { canonical: "/faq" },
  description: "Pricing, booking, cancellations, pausing, your first session and the S&C app: common questions answered.",
};

// Structured data so search engines can show the answers directly.
const FAQ_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: ALL_FAQS.map((f) => ({
    "@type": "Question",
    name: f.question,
    acceptedAnswer: { "@type": "Answer", text: f.answer },
  })),
};

// /faq — every question in four groups, with a sticky group index on wide
// screens. Copy lives in lib/faq-content.ts (shared with the homepage FAQ).
export default function FaqPage() {
  return (
    <MarketingPage>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(FAQ_JSON_LD) }} />

      <PageIntro label="FAQ" title={FAQ_PAGE.title} intro={FAQ_PAGE.intro} />

      <section className="relative mx-auto grid max-w-6xl gap-10 px-6 pb-24 lg:grid-cols-[0.55fr_1.45fr] lg:gap-20 lg:pb-32">
        <nav aria-label="FAQ topics" className="lg:sticky lg:top-28 lg:self-start">
          <ul className="flex flex-wrap gap-2 lg:grid lg:gap-1">
            {FAQ_GROUPS.map((g) => (
              <li key={g.id}>
                <a
                  href={`#${g.id}`}
                  className="inline-flex min-h-11 items-center rounded-[3px] border border-white/[0.12] px-4 text-sm font-medium text-zinc-300 transition-colors duration-150 hover:border-primary/50 hover:text-white lg:w-full lg:border-0 lg:border-l-2 lg:border-white/[0.1] lg:rounded-none lg:hover:border-primary"
                >
                  {g.title}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <FaqSection groups={FAQ_GROUPS} />
      </section>

      <CtaBand
        title={FAQ_PAGE.ctaTitle}
        body={FAQ_PAGE.ctaBody}
        primary={{ label: "Ask a question", href: PRIMARY_CTA.href }}
        secondary={{ label: "See classes and pricing", href: "/classes" }}
      />
    </MarketingPage>
  );
}
