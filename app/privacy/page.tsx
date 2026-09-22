import Link from "next/link";

import { BRAND_NAME, CONTACT_INFO } from "@/lib/content";

export const metadata = {
  title: `Privacy Policy — ${BRAND_NAME}`,
  description: `How ${BRAND_NAME} collects, uses, and protects your personal data.`,
};

// A genuine, specific privacy notice grounded in what this app actually
// collects and does (see lib/db.ts / lib/profile-schema.ts record types) —
// not generic boilerplate. This is a DRAFT pending legal review: it must be
// reviewed and approved by a qualified privacy lawyer or data-protection
// professional before being relied on for GDPR/UK GDPR or Google Play
// compliance, particularly the legal-basis, special-category-consent,
// international-transfer, and retention sections. See
// docs/privacy-policy-audit-2026-08.md for the full audit this draft is
// based on, including a list of facts (legal entity details, vendor DPAs,
// hosting/database region, backup policy, minimum-age policy) that still
// need to be confirmed and are deliberately not asserted here.
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
            <h2 className="text-base font-semibold text-zinc-50">1. Who we are</h2>
            <p className="mt-3">
              {BRAND_NAME} (&ldquo;we&rdquo;, &ldquo;us&rdquo;) is a strength &amp; conditioning coaching business
              based in Navan, Co. Meath, Ireland. We operate this website and the {BRAND_NAME} member app, and this
              policy explains what personal data we collect through them, why, and how you can control it.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-zinc-50">2. Scope of this policy</h2>
            <p className="mt-3">
              This policy covers the marketing website, the member app (used by members and by our coaches and
              admin staff), and the data our coaches and administrators handle as part of running the service. It
              applies whether you&rsquo;re a signed-up member, someone enquiring through our contact form, or a
              visitor to the site. Where the app and website behave differently, we say so below.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-zinc-50">3. Personal data we collect</h2>
            <ul className="mt-3 list-disc space-y-2 pl-5">
              <li><strong className="text-zinc-100">Account details</strong> — your email and a securely hashed password (we never store your password itself).</li>
              <li><strong className="text-zinc-100">Profile information</strong> — name, phone number, date of birth, gender, country, primary coaching goal, secondary coaching goal (optional), sport played (where relevant to your goal), and, if you choose to add them, a profile photo, height, current weight, body-fat %, goal weight/body-fat/target date, and training days per week.</li>
              <li><strong className="text-zinc-100">Emergency contact details</strong> — the name and phone number of up to two emergency contacts, collected at sign-up. Visible to your coaches; used only if we need to reach someone on your behalf in an emergency.</li>
              <li><strong className="text-zinc-100">Training, performance &amp; recovery data</strong> — workout sessions, exercises/sets/reps/weight logged, run and cardio sessions, the personal bests and exercises you choose to feature, class bookings and attendance, your weekly training schedule, recovery check-ins (sleep, soreness, fatigue, RPE, readiness score), hydration logs, and sports-performance drink-calculator settings.</li>
              <li><strong className="text-zinc-100">Nutrition and food-logging data</strong> — see &ldquo;Food photos and nutrition information&rdquo; below.</li>
              <li><strong className="text-zinc-100">Cycle and pregnancy data (optional)</strong> — see &ldquo;Health and sensitive information&rdquo; below.</li>
              <li><strong className="text-zinc-100">Dietary preference, allergies, intolerances, and medical/dietary notes</strong> you choose to share — see &ldquo;Health and sensitive information&rdquo; below.</li>
              <li><strong className="text-zinc-100">Payment information</strong> — membership and class-pass payments are processed by Stripe or Revolut. We never see or store your full card details; we keep a record of the purchase itself (amount, date, status, and an internal reference) for your account history and our accounts.</li>
              <li><strong className="text-zinc-100">Messages and coach notes</strong> — messages you send to coaching staff through the app, and any private notes your coaches keep about your training. Coach notes aren&rsquo;t shown to you in the app, but are included if you ask us for a copy of your data.</li>
              <li><strong className="text-zinc-100">Push notification data</strong> — if you enable notifications, a device token and basic device information (model, OS version) so we can deliver them.</li>
              <li><strong className="text-zinc-100">Contact form submissions</strong> — if you enquire through the website, we collect your name, email, phone (if given), and message to reply to you.</li>
              <li><strong className="text-zinc-100">Bug reports</strong> — if you report a problem in the app, your description and any screenshots you attach.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-semibold text-zinc-50">4. Health and sensitive information</h2>
            <p className="mt-3">
              Some of what we collect can reveal information about your health. This includes menstrual-cycle
              information, pregnancy status, allergies and medical/dietary notes, body-fat % and other body
              measurements, and — where it reveals an injury, illness, or medical limitation — your training and
              recovery data. Under data-protection law this can be treated as a &ldquo;special category&rdquo; of
              personal data, which gets extra protection.
            </p>
            <p className="mt-3">Here&rsquo;s what&rsquo;s optional and what it&rsquo;s for:</p>
            <ul className="mt-3 list-disc space-y-2 pl-5">
              <li>Your date of birth, gender, and weight are needed for core account and coaching features. Height, body-fat %, and dietary/medical notes are optional, and are used to personalise your training and nutrition guidance.</li>
              <li>Cycle tracking and pregnancy tracking (see the next section) are entirely optional, off by default, and visible only to you unless you choose to share specific parts with your coach.</li>
              <li>Your coaches can see the dietary, medical, training, and recovery data needed to coach you safely. Administrators with the relevant staff permission can access it to run the club. Where you use an AI-assisted feature, relevant parts of this data may be sent to our AI provider — see &ldquo;AI-assisted features&rdquo; below.</li>
              <li>The app generates automated guidance from this data (for example, adjusting nutrition targets around your cycle phase, or estimating a readiness score) — this supports your coaching, it doesn&rsquo;t replace it.</li>
            </ul>
            <p className="mt-3">
              You choose to provide this information, and cycle or pregnancy tracking specifically only starts once
              you turn it on yourself. You can turn either off again at any time in your profile or cycle-tracking
              settings — this stops any new collection going forward. If you&rsquo;d also like data you&rsquo;ve
              already entered deleted rather than just switched off, contact us (see &ldquo;Account deletion and
              data export&rdquo; below).
            </p>
            <p className="mt-3">
              Coaching and any AI-generated guidance in the app is not a substitute for medical advice, diagnosis,
              or treatment. If you have a medical concern, please speak to a qualified healthcare professional.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-zinc-50">5. Food photos and nutrition information</h2>
            <p className="mt-3">
              You can log food by searching our food database, scanning a barcode, entering it manually, or
              submitting a photo of the food, a nutrition label, or a receipt. You can also import stats from a
              screenshot of another fitness tracker. For each logged item we store the food name, serving
              description, quantity, and calories/protein/carbs/fat — whether you typed it, picked it from search,
              or it came from a photo.
            </p>
            <p className="mt-3">
              Photos you submit for food, label, receipt, or tracker-screenshot recognition are sent to our AI
              provider to generate a result (see &ldquo;AI-assisted features&rdquo; below) and are not stored on our
              servers afterwards — only the resulting logged item is saved to your account, not the image itself.
            </p>
            <p className="mt-3">
              You can create your own reusable custom foods, and your recently-logged foods are kept so you can
              quickly log them again. If you tell the app to always recognise a certain photo or description as a
              specific food of yours (an &ldquo;always use this instead&rdquo; correction), we save that preference
              against your account so future scans default to it — this is stored with your account until you
              remove it or delete your account, and is applied by our own systems, not sent back to the AI
              provider.
            </p>
            <p className="mt-3">
              AI-identified foods and estimated nutrition values are approximate — please check them before logging,
              and use manual entry if you&rsquo;d rather not use a photo.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-zinc-50">6. AI-assisted features</h2>
            <p className="mt-3">
              Several features are powered by Anthropic&rsquo;s Claude AI models: identifying food from a photo,
              reading a nutrition label or receipt, importing stats from a tracker screenshot, estimating nutrition
              from a text description, the AI Coach and AI Nutrition Coach chats, and generating an automatic
              post-workout review. When you use these, the relevant data — which may include photos you submit,
              your messages, and training, recovery, weight, or dietary data needed to give you a relevant answer —
              is sent to Anthropic to generate a response.
            </p>
            <p className="mt-3">
              Anthropic processes this data under our agreement with them; we haven&rsquo;t independently verified
              their retention or model-training practices beyond what they publish themselves, and recommend
              reviewing Anthropic&rsquo;s own terms directly if you&rsquo;d like more detail.
            </p>
            <p className="mt-3">
              AI-generated results — food identification, nutrition estimates, coaching responses, workout reviews —
              can be inaccurate, and are not medical advice. Please review them before relying on them, and use the
              correction tools in the app (or manual entry) if something&rsquo;s wrong.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-zinc-50">7. How and why we use information</h2>
            <ul className="mt-3 list-disc space-y-2 pl-5">
              <li>Providing the coaching, training, recovery, and nutrition features you&rsquo;ve signed up for, including AI-assisted food recognition and coaching chat.</li>
              <li>Personalising guidance — for example, adjusting nutrition targets around your training load, cycle phase, or goals, and generating a readiness score from your recovery check-ins.</li>
              <li>Class booking, attendance, and membership/class-pass payment processing.</li>
              <li>Communicating with you about bookings, your membership, and enquiries or bug reports you send us.</li>
              <li>Authentication and keeping accounts secure, including limiting repeated failed sign-in attempts.</li>
              <li>Diagnosing technical problems and improving reliability.</li>
              <li>Meeting our legal obligations, such as keeping financial records.</li>
              <li>Handling access, deletion, correction, and export requests.</li>
            </ul>
            <p className="mt-3">We do not sell your data or use it for advertising.</p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-zinc-50">8. Legal bases and special-category conditions</h2>
            <p className="mt-3">
              If you&rsquo;re in the EU/EEA or UK, we need a lawful basis to process your personal data. This is a
              summary of the bases we rely on — a data-protection professional should confirm this mapping before
              this policy is relied upon:
            </p>
            <ul className="mt-3 list-disc space-y-2 pl-5">
              <li><strong className="text-zinc-100">Performance of a contract</strong> — account setup and the core coaching, booking, and payment features you sign up for.</li>
              <li><strong className="text-zinc-100">Consent</strong> — optional features you choose to enable, such as cycle or pregnancy tracking, and optional information you choose to add, such as a profile photo or medical/dietary notes. You can withdraw consent at any time by turning the relevant feature off or contacting us — this doesn&rsquo;t affect processing already carried out.</li>
              <li><strong className="text-zinc-100">Legitimate interests</strong> — keeping the service secure (for example, limiting repeated failed sign-in attempts) and improving reliability.</li>
              <li><strong className="text-zinc-100">Legal obligation</strong> — keeping financial records for accounting purposes.</li>
            </ul>
            <p className="mt-3">
              Cycle-tracking information, pregnancy status, and medical/dietary notes and allergies are
              &ldquo;special category&rdquo; data, which requires a specific additional condition beyond the bases
              above — typically your explicit consent. We treat your choice to enable these features and enter this
              information as that consent, and you can withdraw it in the same way described above.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-zinc-50">9. Who we share information with</h2>
            <p className="mt-3">
              We don&rsquo;t sell your personal data or share it for advertising. Your coaches and authorised admin
              staff can see the data described above that they need to coach you and run the club. Beyond that, we
              use the following service providers to run the app and website, who process data on our behalf and
              not for their own independent purposes:
            </p>
            <ul className="mt-3 list-disc space-y-2 pl-5">
              <li><strong className="text-zinc-100">Stripe</strong> and <strong className="text-zinc-100">Revolut</strong> — payment processing.</li>
              <li><strong className="text-zinc-100">Resend</strong> — transactional emails (booking confirmations, password resets, and similar).</li>
              <li><strong className="text-zinc-100">Anthropic (Claude)</strong> — AI-assisted coaching and food-logging features. See &ldquo;AI-assisted features&rdquo; above.</li>
              <li><strong className="text-zinc-100">Hostinger</strong> — hosts our website and app.</li>
              <li><strong className="text-zinc-100">Supabase</strong> — hosts part of our database and file storage, including our exercise library, the exercises you favourite, and website contact-form enquiries.</li>
              <li><strong className="text-zinc-100">Expo&rsquo;s push service and standard web push</strong> — delivering app and browser notifications, if you enable them.</li>
              <li><strong className="text-zinc-100">Open Food Facts</strong> — a public, open food database we query by barcode or food name when you search for food to log. We don&rsquo;t send any personal data to it.</li>
            </ul>
            <p className="mt-3">
              We may also disclose information where we&rsquo;re legally required to.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-zinc-50">10. International transfers</h2>
            <p className="mt-3">
              Some of the providers above may process data outside Ireland/the EEA/UK — most notably Anthropic,
              which is based in the United States. Where that happens, data-protection law requires an appropriate
              safeguard to be in place. We&rsquo;re in the process of confirming and documenting exactly which
              safeguard applies to each provider, and will update this section once that&rsquo;s complete. Contact
              us if you&rsquo;d like more detail on a specific provider in the meantime.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-zinc-50">11. Cookies and similar technologies</h2>
            <p className="mt-3">
              The website uses a single strictly-necessary cookie to keep you signed in. It contains no tracking
              information and isn&rsquo;t used for advertising or analytics, so no cookie-consent banner is needed
              for it. The mobile app doesn&rsquo;t use cookies — it stores your sign-in session securely on your
              device using your device&rsquo;s built-in secure storage, and clears it when you log out. We don&rsquo;t
              use analytics or advertising trackers on the website or in the mobile app.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-zinc-50">12. How long we keep information</h2>
            <ul className="mt-3 list-disc space-y-2 pl-5">
              <li><strong className="text-zinc-100">Recovery check-ins</strong> are automatically deleted after 14 days — the readiness trend only ever looks at that window.</li>
              <li><strong className="text-zinc-100">Password-reset links</strong> expire shortly after they&rsquo;re issued and are removed automatically.</li>
              <li><strong className="text-zinc-100">Account, profile, training, nutrition, messages, and coach notes</strong> are kept for as long as your account is active, so your history stays available to you and your coach.</li>
              <li><strong className="text-zinc-100">Payment records</strong> are kept for our accounting and legal obligations.</li>
              <li><strong className="text-zinc-100">Bug reports and attached screenshots</strong> are kept until removed by our team; we don&rsquo;t currently have a fixed automatic expiry for these.</li>
            </ul>
            <p className="mt-3">
              If you&rsquo;d like your account and data deleted, or a copy of your data exported, see &ldquo;Account
              deletion and data export&rdquo; below. We&rsquo;re still confirming our backup retention practices as
              part of finalising this policy.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-zinc-50">13. Security</h2>
            <p className="mt-3">
              We take reasonable technical and organisational steps to protect your data: passwords are hashed
              (never stored in plain text) and checked using methods designed to resist timing attacks; the site and
              app communicate over HTTPS; and access to member data is limited by role, so coaches and
              administrators only see what they need to coach you and run the club. No system is completely secure
              and we can&rsquo;t guarantee absolute security — if you have a security concern, please contact us.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-zinc-50">14. Your rights and choices</h2>
            <p className="mt-3">If you&rsquo;re in the EU/EEA or UK, you have the right to:</p>
            <ul className="mt-3 list-disc space-y-2 pl-5">
              <li><strong className="text-zinc-100">Access</strong> what data we hold about you.</li>
              <li><strong className="text-zinc-100">Correct</strong> anything inaccurate.</li>
              <li><strong className="text-zinc-100">Delete</strong> your data — see &ldquo;Account deletion and data export&rdquo; below.</li>
              <li><strong className="text-zinc-100">Restrict</strong> processing in certain circumstances, and <strong className="text-zinc-100">object</strong> to processing based on our legitimate interests.</li>
              <li><strong className="text-zinc-100">Receive a copy</strong> of the data you gave us in a portable format.</li>
              <li><strong className="text-zinc-100">Withdraw consent</strong> at any time, where we rely on it (for example, cycle or pregnancy tracking) — this doesn&rsquo;t affect processing already carried out.</li>
            </ul>
            <p className="mt-3">
              The app generates automated estimates and suggestions — like a readiness score or an AI-identified
              food item — to support your coaching. These are recommendations for you and your coach to use, not
              automated decisions made about you without your involvement, and you can always review, correct, or
              ignore them.
            </p>
            <p className="mt-3">
              These rights include any private coach notes held about you, even though they aren&rsquo;t shown in
              the app itself. To exercise any of these rights, email us (below) — we may need to verify it&rsquo;s
              really you first, and we&rsquo;ll respond within the timeframe required by law. If you&rsquo;re not
              satisfied with our response, you can complain to the Irish Data Protection Commission
              (dataprotection.ie) or your local supervisory authority.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-zinc-50">15. Account deletion and data export</h2>
            <p className="mt-3">
              To request deletion of your account, or a copy of your data, email us (below). We&rsquo;ll verify
              it&rsquo;s really you before actioning the request. We don&rsquo;t currently have a self-service
              delete or export button in the app, so every request is handled by a person on our team — timing can
              vary, so let us know if you need it actioned urgently.
            </p>
            <p className="mt-3">
              When you ask us to delete your account, we remove your account and the personal data tied to it,
              other than anything we&rsquo;re legally required to keep, such as financial records for accounting
              purposes. If you&rsquo;d like a copy of your data first, ask for that at the same time.
            </p>
            <p className="mt-3">
              This deletion route works whether or not you still have the app installed — email is enough.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-zinc-50">16. Children</h2>
            <p className="mt-3">
              This service is intended for adults booking and managing their own coaching, training, and nutrition,
              and isn&rsquo;t designed or marketed for children. We don&rsquo;t currently verify a specific minimum
              age at sign-up beyond confirming a valid date of birth in the past. If you believe a child has given
              us personal data, please contact us and we&rsquo;ll act on it, including deleting the data where
              appropriate.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-zinc-50">17. Changes to this policy</h2>
            <p className="mt-3">
              We may update this policy from time to time. We&rsquo;ll update the &ldquo;last updated&rdquo; date
              above when we do.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-zinc-50">18. Contact details and complaints</h2>
            <p className="mt-3">
              {BRAND_NAME}, Navan, Co. Meath, Ireland. Questions about this policy or your data — email{" "}
              <a href={`mailto:${CONTACT_INFO.email}`} className="text-gold hover:underline">{CONTACT_INFO.email}</a>.
              If you&rsquo;re not satisfied with how we&rsquo;ve handled your data, you can complain to the Irish
              Data Protection Commission (dataprotection.ie) or your local supervisory authority.
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
