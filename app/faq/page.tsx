import type { Metadata } from "next";

import { FaqExplorer } from "@/components/marketing/FaqExplorer";
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

// /faq — every question in four topics; the topic list picks which one shows. Copy lives in lib/faq-content.ts (shared with the homepage FAQ).
export default function FaqPage() {
  return (
    <MarketingPage>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(FAQ_JSON_LD) }} />

      <PageIntro label="FAQ" title={FAQ_PAGE.title} intro={FAQ_PAGE.intro} />

      <FaqExplorer groups={FAQ_GROUPS} />

      <CtaBand
        title={FAQ_PAGE.ctaTitle}
        body={FAQ_PAGE.ctaBody}
        primary={{ label: "Ask a question", href: PRIMARY_CTA.href }}
        secondary={{ label: "See classes and pricing", href: "/classes" }}
      />
    </MarketingPage>
  );
}
