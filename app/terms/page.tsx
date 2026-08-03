import Link from "next/link";

import { BRAND_NAME, CONTACT_INFO } from "@/lib/content";

export const metadata = {
  title: `Terms of Service — ${BRAND_NAME}`,
  description: `The terms that apply to using ${BRAND_NAME}'s website, membership, and class bookings.`,
};

// Grounded in what this app actually does (Stripe-billed memberships/passes,
// class bookings with a cancellation cutoff, staff-mediated account changes)
// rather than generic boilerplate. Written for launch; the club should still
// have a solicitor review it before relying on it.
export default function TermsPage() {
  return (
    <main data-theme="navy" data-palette="gold" className="min-h-screen px-6 py-16 text-zinc-100">
      <div className="mx-auto max-w-2xl">
        <Link href="/" className="text-mono text-[11px] uppercase tracking-[0.08em] text-zinc-500 transition hover:text-gold">
          ← Back to home
        </Link>

        <p className="text-mono mt-8 text-[11px] uppercase tracking-[0.24em] text-gold">Legal</p>
        <h1 className="text-editorial mt-2 text-[32px] leading-[1.05] text-zinc-50 sm:text-[36px]">Terms of Service</h1>
        <p className="mt-2 text-sm text-zinc-500">Last updated: {new Date().toLocaleDateString("en-IE", { year: "numeric", month: "long" })}</p>

        <div className="mt-10 space-y-8 text-sm leading-relaxed text-zinc-300">
          <section>
            <p>
              These terms apply when you create an account with, or use, {BRAND_NAME} (&ldquo;we&rdquo;,
              &ldquo;us&rdquo;) — our website, member app, memberships, class passes, and class bookings. By
              creating an account you agree to them.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-zinc-50">Your account</h2>
            <p className="mt-3">
              You&rsquo;re responsible for keeping your login details secure and for the accuracy of the information
              you give us (including health and training information — accurate details help your coach train you
              safely). You must be old enough, under applicable law, to enter into these terms.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-zinc-50">Memberships and class passes</h2>
            <p className="mt-3">
              Memberships and class passes are paid for through our payment processor, Stripe. Recurring memberships
              renew automatically each billing period until cancelled; class passes are single purchases that grant
              a set number of bookings. Prices and what&rsquo;s included are shown at the time of purchase. To
              cancel or change your membership, or to query a payment, contact us — cancellations and refunds are
              reviewed and actioned by our team rather than processed automatically.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-zinc-50">Class bookings and cancellations</h2>
            <p className="mt-3">
              Booking a class reserves your spot against your membership allowance or class pass. If you cancel far
              enough ahead of the class start time — the exact cutoff is shown at the time of booking — your session
              credit is restored; cancelling after that point uses the session. We may need to cancel or reschedule
              a class (illness, low numbers, unforeseen circumstances); if we do, any session credit used for it is
              restored to your account.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-zinc-50">Training risk</h2>
            <p className="mt-3">
              Physical training carries an inherent risk of injury. You confirm that you&rsquo;re fit to take part in
              training and classes, or have disclosed any relevant medical conditions to us. Follow your coach&rsquo;s
              guidance and stop if something feels wrong — tell your coach.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-zinc-50">Acceptable use</h2>
            <p className="mt-3">
              Use your own account. Don&rsquo;t misuse the booking system (e.g. booking spots you don&rsquo;t intend
              to use to block other members), and treat coaches and other members with respect, in the app and in
              the gym.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-zinc-50">Ending your account</h2>
            <p className="mt-3">
              You can ask us to close your account at any time — contact us and we&rsquo;ll action it. We may suspend
              or close an account for misuse of the service or non-payment, and will make reasonable efforts to let
              you know why.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-zinc-50">Changes to these terms</h2>
            <p className="mt-3">
              We may update these terms from time to time. We&rsquo;ll update the &ldquo;last updated&rdquo; date
              above when we do; continuing to use the service after a change means you accept the update.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-zinc-50">Governing law</h2>
            <p className="mt-3">
              These terms are governed by the laws of Ireland.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-zinc-50">Contact us</h2>
            <p className="mt-3">
              Questions about these terms — email{" "}
              <a href={`mailto:${CONTACT_INFO.email}`} className="text-gold hover:underline">{CONTACT_INFO.email}</a>.
              See also our{" "}
              <Link href="/privacy" className="text-gold hover:underline">Privacy Policy</Link>.
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
