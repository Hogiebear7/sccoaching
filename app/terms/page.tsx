import Link from "next/link";

import { BRAND_NAME, CONTACT_INFO } from "@/lib/content";

export const metadata = {
  title: `Terms of Service — ${BRAND_NAME}`,
  alternates: { canonical: "/terms" },
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
        <h1 className="text-headline mt-2 text-[40px] text-zinc-50 sm:text-[48px]">Terms of Service</h1>
        <p className="mt-2 text-sm text-zinc-500">Last updated: November 2026</p>

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
            <h2 className="text-base font-semibold text-zinc-50">App features included with a gym Membership</h2>
            <p className="mt-3">
              If you hold an active gym Membership, your Membership includes access to the app&rsquo;s digital features,
              including the AI coach, programmes, food and calorie tools, full history and personal bests (the &ldquo;App
              Features&rdquo;), at no extra charge, for as long as your Membership is active (including any short payment
              grace period we allow).
            </p>
            <p className="mt-3">
              If your Membership ends, is cancelled, is paused or lapses for non-payment, your access to the App Features
              ends with it and your account returns to the free version of the app. We keep your data, and it is available
              again if you later hold an active Membership or buy the App Subscription.
            </p>
            <p className="mt-3">
              The App Features come with the Membership as a benefit; they are not sold separately by us to Membership
              holders, and you do not need to buy the App Subscription. If you also buy the App Subscription from an app
              store, that is a separate contract with the store, and ending your Membership does not cancel it. We may change
              which features come with a Membership; where a change reduces what you receive, we will give existing members at
              least 30 days&rsquo; notice.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-zinc-50">App Subscription bought through an app store</h2>
            <p className="mt-3">
              The App Subscription is sold and billed by Apple or Google, not by us. Its price, billing period, renewal,
              free trial, cancellation and refunds are governed by the store&rsquo;s terms, and you manage or cancel it in
              your store account.
            </p>
            <p className="mt-3">
              Where the store offers it, new subscribers can start with a 7-day free trial. The subscription then renews at the
              price the store shows you unless you cancel at least 24 hours before the trial ends.
            </p>
            <p className="mt-3">
              Deleting your account in the app does not cancel a store subscription. Cancel it with the store first; we may not
              be able to delete your account while a store subscription is still running.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-zinc-50">AI features and fair usage</h2>
            <p className="mt-3">
              AI features (such as the AI coach, food photo recognition, meal ideas, programme generation and workout
              reviews) are provided under a fair usage limit, whichever membership, subscription, pass or free trial you
              have. Fair usage limits how much AI you can use in a day, over a rolling 30-day period and during a free
              trial. We may also limit how often requests can be made, and limit AI features when overall demand is high.
              We set these limits to keep the features available to all members, and we may change them. If you reach a
              limit, AI features pause until your allowance is available again; the rest of the app keeps working. Nothing
              in these terms affects your statutory rights as a consumer.
            </p>
            <p className="mt-3">
              AI features give general information and suggestions. They are not medical, nutritional or professional advice
              and are not a substitute for your doctor, midwife, physiotherapist or other qualified professional. Check with
              a qualified professional before changing your training or diet, especially if you are pregnant or postnatal,
              or have a medical condition, an injury or an eating disorder. AI responses may be inaccurate or incomplete.
            </p>
            <p className="mt-3">
              Our coaches may pause AI features on your account, for example for safety or misuse, or if you ask us to; we
              will tell you if we do. We do not guarantee that AI features will be available at all times: they may pause when
              you reach a usage limit, when demand is high, or when a third-party provider is unavailable. AI features only
              use your data if you have allowed them, and you can turn them off in Settings at any time (see our{" "}
              <Link href="/privacy" className="text-gold hover:underline">Privacy Policy</Link>).
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
            <h2 className="text-base font-semibold text-zinc-50">Community content</h2>
            <p className="mt-3">
              If you share workouts, comments or a display name in Community, you are responsible for what you post. Don&rsquo;t post anything unlawful,
              abusive, hateful, sexually explicit, or that harasses or impersonates someone else. Comments are checked for unmistakable abuse before they are posted, and
              you can report a comment or a shared workout, and block any member, from the app. Blocking hides each of you from the other in Community. Our coaches
              review reports and remove content that breaks these rules; a removed workout stays in its owner&rsquo;s own history but can&rsquo;t be shared again. We may
              also restrict or close accounts that break these rules. To raise a concern, email {CONTACT_INFO.email}.
            </p>
            <p className="mt-3">
              Groups, challenges and gym communities are for members aged 18 or over. If you create a group you are its
              organiser and are responsible for it: you can remove members and end the group. Groups are available to members
              with access to the App Features. If you hold a gym Membership, you may be added to your gym&rsquo;s members-only
              community, where members and that gym&rsquo;s staff can post, and staff can set challenges. Posts there are
              visible to its members and staff. We can remove any group, post or member that breaks these rules, and we may
              close a group at any time. You can report a post, comment or member, and block any member, from the app.
            </p>
            <p className="mt-3">
              Challenges are for fun and motivation. Take part within your own limits and training level; we are not
              responsible for injury caused by taking part in a challenge. Any rewards for challenges are arranged in person
              by your gym and are not provided through the app.
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
            <p className="mt-3">
              Deleting your account removes the data the app holds about you as described in our{" "}
              <Link href="/privacy" className="text-gold hover:underline">Privacy Policy</Link>, other than records we are
              required to keep, such as payment records.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-zinc-50">Changes to these terms</h2>
            <p className="mt-3">
              We may update these terms from time to time. We&rsquo;ll update the &ldquo;last updated&rdquo; date
              above when we do; continuing to use the service after a change means you accept the update. When a change
              affects what you pay or what you receive, we will also tell you in the app or by email.
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
