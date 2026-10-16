import Link from "next/link";

import { BRAND_NAME, CONTACT_INFO } from "@/lib/content";

export const metadata = {
  title: `Delete your account — ${BRAND_NAME}`,
  description: `How to delete your ${BRAND_NAME} account and what happens to your data.`,
};

// Public, no-login page. Google Play requires a web link where people can find out how to delete their account and data (and what is kept),
// and Apple expects the same path to be easy to find. The in-app route is Settings -> Delete account (web and mobile); email is the fallback for
// someone who can no longer sign in or no longer has the app. What is deleted and kept mirrors lib/db.ts deleteUserAndOwnedRecords.
export default function DeleteAccountPage() {
  return (
    <main data-theme="navy" data-palette="gold" className="min-h-screen px-6 py-16 text-zinc-100">
      <div className="mx-auto max-w-2xl">
        <Link href="/" className="text-mono text-[11px] uppercase tracking-[0.08em] text-zinc-500 transition hover:text-gold">
          ← Back to home
        </Link>

        <p className="text-mono mt-8 text-[11px] uppercase tracking-[0.24em] text-gold">Your data</p>
        <h1 className="text-editorial mt-2 text-[32px] leading-[1.05] text-zinc-50 sm:text-[36px]">Delete your account</h1>
        <p className="mt-3 text-sm text-zinc-400">
          You can delete your {BRAND_NAME} account yourself, from the app or the website. This page explains how, and what happens to your data.
        </p>

        <div className="mt-10 space-y-8 text-sm leading-relaxed text-zinc-300">
          <section>
            <h2 className="text-base font-semibold text-zinc-50">Delete it yourself</h2>
            <ol className="mt-3 list-decimal space-y-2 pl-5">
              <li>Sign in to the {BRAND_NAME} app or to the website.</li>
              <li>Open <strong className="text-zinc-100">Settings</strong>, then <strong className="text-zinc-100">Delete account</strong>.</li>
              <li>Enter your password and type <strong className="text-zinc-100">DELETE</strong> to confirm.</li>
              <li>Your account and the data tied to it are removed straight away, and you are signed out.</li>
            </ol>
            <p className="mt-3">
              If you have an active paid membership, cancel it first. A membership paid through the website can be cancelled from Settings, then Manage
              membership, or by asking your gym. The App Subscription, bought through Google Play or the App Store, can only be cancelled in that store, and deleting your account does not cancel it. We can&rsquo;t delete an
              account while a paid subscription is still running, because it would keep billing with no account to manage it.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-zinc-50">What is deleted</h2>
            <ul className="mt-3 list-disc space-y-2 pl-5">
              <li>Your account, login details and profile, including your photo, goals, body measurements and emergency contacts.</li>
              <li>Your workouts, programmes, recovery check-ins, hydration logs, food diary, custom foods, recipes and shopping lists.</li>
              <li>Your class bookings, waitlist entries, messages with your coach, notifications and community activity.</li>
              <li>Any bug reports you sent, and the notification settings and device tokens linked to your account.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-semibold text-zinc-50">What we keep</h2>
            <p className="mt-3">
              Payment and subscription records that we must keep for accounting and legal reasons are retained, with your name and account removed so they no
              longer identify you.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-zinc-50">Can&rsquo;t sign in, or no longer have the app?</h2>
            <p className="mt-3">
              Email <a href={`mailto:${CONTACT_INFO.email}`} className="text-gold hover:underline">{CONTACT_INFO.email}</a> from the address on your account and ask
              us to delete it. We&rsquo;ll verify it&rsquo;s you and action it. See our{" "}
              <Link href="/privacy" className="text-gold hover:underline">Privacy Policy</Link> for how we handle your data.
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
