import Link from "next/link";

import { BRAND_NAME, CONTACT_INFO } from "@/lib/content";

export const metadata = {
  title: `Privacy Policy — ${BRAND_NAME}`,
  description: `How ${BRAND_NAME} collects, uses, and protects your personal data.`,
};

// A genuine, specific privacy notice grounded in what this app actually
// collects and does (see lib/db.ts / lib/profile-schema.ts record types) —
// not generic boilerplate. Written for launch; the club should still have a
// solicitor review it before relying on it, particularly the data-retention
// and rights sections, and especially the AI-processing and special-category
// health data (cycle tracking, pregnancy, dietary/medical notes) sections —
// GDPR treats this data category more strictly than ordinary personal data.
export default function PrivacyPolicyPage() {
  return (
    <main data-theme="navy" data-palette="gold" className="min-h-screen px-6 py-16 text-zinc-100">
      <div className="mx-auto max-w-2xl">
        <Link href="/" className="text-mono text-[11px] uppercase tracking-[0.08em] text-zinc-500 transition hover:text-gold">
          ← Back to home
        </Link>

        <p className="text-mono mt-8 text-[11px] uppercase tracking-[0.24em] text-gold">Legal</p>
        <h1 className="text-editorial mt-2 text-[32px] leading-[1.05] text-zinc-50 sm:text-[36px]">Privacy Policy</h1>
        <p className="mt-2 text-sm text-zinc-500">Last updated: {new Date().toLocaleDateString("en-IE", { year: "numeric", month: "long" })}</p>

        <div className="mt-10 space-y-8 text-sm leading-relaxed text-zinc-300">
          <section>
            <p>
              {BRAND_NAME} (&ldquo;we&rdquo;, &ldquo;us&rdquo;) operates this website and member app. This policy
              explains what personal data we collect, why, and how you can control it.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-zinc-50">What we collect</h2>
            <ul className="mt-3 list-disc space-y-2 pl-5">
              <li><strong className="text-zinc-100">Account details</strong> — your email and a securely hashed password (we never store your password itself).</li>
              <li><strong className="text-zinc-100">Profile information</strong> — name, phone number, date of birth, gender, country, training goals, and (optionally) a profile photo, height, current weight, body-fat %, goal weight/body-fat/target date, training days per week, dietary preferences, allergies, and medical/dietary notes you choose to share.</li>
              <li><strong className="text-zinc-100">Emergency contact details</strong> — the name and phone number of up to two emergency contacts, collected at sign-up. Visible to your coaches; used only if we need to reach someone on your behalf in an emergency.</li>
              <li><strong className="text-zinc-100">Training data</strong> — workout sessions, exercises logged, class bookings and attendance, recovery check-ins (sleep, soreness, fatigue, RPE), hydration logs, and sports-performance drink-calculator settings.</li>
              <li><strong className="text-zinc-100">Cycle tracking (optional)</strong> — if you enable it, menstrual cycle dates, phase estimates, and related notes, including menopause-support settings if relevant. Off by default, visible only to you, and shareable with your coach at the level of detail you choose (phase only, exact dates, or notes) — adjustable or fully turned off at any time in your profile settings.</li>
              <li><strong className="text-zinc-100">Pregnancy tracking (optional)</strong> — a separate, private-by-default setting. If you mark yourself as pregnant, that status and your due date are visible only to you unless you explicitly choose to share them with your coach.</li>
              <li><strong className="text-zinc-100">Photos you choose to provide</strong> — a profile photo; photos of food, nutrition labels, or grocery receipts for food logging; screenshots from other fitness trackers you choose to import. See &ldquo;AI-assisted features&rdquo; below for what happens to these.</li>
              <li><strong className="text-zinc-100">Payment information</strong> — membership and class-pass payments are processed by Stripe or Revolut. We never see or store your full card details; we keep a record of the purchase itself (amount, date, status) for your account history and our accounts.</li>
              <li><strong className="text-zinc-100">Messages</strong> — messages you send to coaching staff through the app. Your coaches may also keep their own private notes about your training, visible only to staff.</li>
              <li><strong className="text-zinc-100">Push notification data</strong> — if you enable notifications, a device token and basic device information (model, OS version) so we can deliver them.</li>
              <li><strong className="text-zinc-100">Contact form submissions</strong> — if you enquire through the website, we collect your name, email, phone (if given), and message to reply to you.</li>
              <li><strong className="text-zinc-100">Bug reports</strong> — if you report a problem in the app, your description and any screenshots you attach.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-semibold text-zinc-50">Why we use it</h2>
            <p className="mt-3">
              To provide coaching and class-booking services you&rsquo;ve signed up for, personalise training and
              nutrition guidance to your goals and recovery, process membership and class-pass payments, communicate
              with you about bookings and your membership, and respond to enquiries and bug reports. We do not sell
              your data or use it for advertising.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-zinc-50">AI-assisted features</h2>
            <p className="mt-3">
              Several features are powered by Anthropic&rsquo;s Claude AI models. When you use them, the relevant
              data is sent to Anthropic to generate a response — it is not used to train their models. This covers:
            </p>
            <ul className="mt-3 list-disc space-y-2 pl-5">
              <li>Photos of food, nutrition labels, or receipts you submit to log food, and tracker screenshots you choose to import — sent for identification or data extraction.</li>
              <li>Messages you send to the AI Coach or AI Nutrition Coach, along with the training, recovery, weight, and dietary data needed to give you a relevant answer.</li>
              <li>A summary of your training and recovery data, used to generate an automatic post-workout review.</li>
            </ul>
            <p className="mt-3">
              Your profile photo is never sent to the AI — it&rsquo;s stored only to display in the app.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-zinc-50">Who we share it with</h2>
            <p className="mt-3">
              Your coaches can see the training, recovery, dietary, and emergency-contact data needed to coach you
              and keep you safe, plus any cycle-tracking or pregnancy data you&rsquo;ve chosen to share. We use the
              following processors to run the service, and don&rsquo;t share your data with anyone else:
            </p>
            <ul className="mt-3 list-disc space-y-2 pl-5">
              <li><strong className="text-zinc-100">Stripe</strong> and <strong className="text-zinc-100">Revolut</strong> — payment processing.</li>
              <li><strong className="text-zinc-100">Resend</strong> — transactional emails (booking confirmations, password resets, and similar).</li>
              <li><strong className="text-zinc-100">Anthropic (Claude)</strong> — AI-assisted coaching and food-logging features. See &ldquo;AI-assisted features&rdquo; above.</li>
              <li><strong className="text-zinc-100">Expo&rsquo;s push service and standard web push</strong> — delivering app and browser notifications, if you enable them.</li>
              <li><strong className="text-zinc-100">Open Food Facts</strong> — a public, open food database we query by barcode or food name when you search for food to log. We don&rsquo;t send any personal data to it.</li>
            </ul>
            <p className="mt-3">
              We don&rsquo;t use analytics or advertising trackers on this site or in the app.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-zinc-50">Cookies</h2>
            <p className="mt-3">
              We use a single strictly-necessary cookie to keep you signed in. It contains no tracking information
              and isn&rsquo;t used for advertising or analytics, so no cookie-consent banner is needed for it.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-zinc-50">How long we keep it</h2>
            <p className="mt-3">
              We keep your account and training data for as long as your account is active, so your history stays
              available to you and your coach. If you&rsquo;d like your account and data deleted, or a copy of your
              data exported, contact us (below) and we&rsquo;ll action it — we don&rsquo;t currently have a
              self-service delete/export button in the app, so this is handled by our team on request.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-zinc-50">Your rights</h2>
            <p className="mt-3">
              If you&rsquo;re in the EU/EEA or UK, you have the right to access, correct, delete, or export your
              personal data, and to object to or restrict certain uses of it. This includes any private coach notes
              held about you, even though they aren&rsquo;t shown in the app itself. Contact us to exercise any of
              these rights. If you&rsquo;re not satisfied with our response, you can complain to the Irish Data
              Protection Commission (dataprotection.ie) or your local supervisory authority.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-zinc-50">Security</h2>
            <p className="mt-3">
              Passwords are hashed and never stored in plain text, connections to the site are encrypted, and access
              to member data is limited to your coaches and admin staff who need it to run the club.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-zinc-50">Changes to this policy</h2>
            <p className="mt-3">
              We may update this policy from time to time. We&rsquo;ll update the &ldquo;last updated&rdquo; date
              above when we do.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-zinc-50">Contact us</h2>
            <p className="mt-3">
              Questions about this policy or your data — email{" "}
              <a href={`mailto:${CONTACT_INFO.email}`} className="text-gold hover:underline">{CONTACT_INFO.email}</a>.
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
