import Link from "next/link";

import { findClasses, findGymById, findMembersInGym, findStaffUsers } from "@/lib/db";
import { resolveBranding } from "@/lib/gym-branding";
import { requireStaffPage } from "@/lib/staff-auth";
import { tenantAccess } from "@/lib/tenant-billing";
import { BAND_RULE_TEXT, bandLabel, tenantPriceMap } from "@/lib/tenant-pricing";
import { tenantSubscriptionConfigured } from "@/lib/tenant-subscription";
import { BrandingForm } from "./BrandingForm";
import { SubscriptionCard } from "./SubscriptionCard";

// A tenant gym's setup page: the checklist for getting a new gym ready, and the form for its logo and accent colour. Each tick is worked out from the gym's real data, so it
// cannot drift from what is actually set up. The S&C primary gym has no tenant record to set up and is shown a short note instead.
export default async function StaffGymSetupPage({ searchParams }: { searchParams?: Promise<{ subscription?: string }> }) {
  const user = await requireStaffPage("gym.manageBranding");
  const gym = user.gymId ? findGymById(user.gymId) : undefined;
  if (!gym) {
    return (
      <div className="max-w-xl space-y-3">
        <h1 className="text-xl font-semibold text-zinc-50">Gym setup</h1>
        <p className="text-sm text-zinc-400">This page is for gyms set up on the platform. S&C Performance Coaching&apos;s own brand and set-up are managed by the platform team.</p>
      </div>
    );
  }

  const resolved = resolveBranding(gym);
  const classCount = findClasses().filter((c) => c.gymId === gym.id).length;
  const staffCount = findStaffUsers().filter((u) => u.gymId === gym.id && !u.archivedAt).length;
  const memberCount = findMembersInGym(gym.id).length;
  const billing = tenantAccess(gym, new Date());

  const steps: { done: boolean; title: string; detail: string }[] = [
    { done: resolved.custom, title: "Add your logo and accent colour", detail: "Your members see these in the app and on the website. Until you set them, they see the S&C look." },
    { done: Boolean(gym.tagline && gym.description), title: "Write your gym's tagline and description", detail: "Shown in the gym directory once you are approved." },
    { done: gym.latitude !== null && gym.longitude !== null, title: "Confirm your address on the map", detail: "Needed so members nearby can find you. Contact the platform team if your address does not locate." },
    { done: gym.status === "active", title: "Get approved for the directory", detail: gym.status === "pending" ? "Your gym is waiting for approval. You can set everything up in the meantime." : gym.status === "suspended" ? "Your listing is paused. Contact the platform team." : "You are listed." },
    { done: classCount > 0, title: "Create your first class", detail: "Staff area, Classes." },
    { done: staffCount > 1, title: "Invite your coaches", detail: "Staff area, Staff. Give each coach the role that fits what they should see." },
    { done: memberCount > 0, title: "Invite your first members", detail: "Staff area, Invites, or share your gym's invite link." },
    { done: billing.state === "active" && Boolean(gym.platformBilling), title: "Platform subscription paid", detail: gym.platformBilling ? "Your S&C platform subscription is up to date." : "Subscribe below (or use the payment link the platform team sends you)." },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  const returned = (await searchParams)?.subscription;
  const band = gym.platformBilling?.band;
  const planNote = tenantPriceMap()
    ? `${band ? `Your plan: ${bandLabel(band)}. You have ${memberCount} members now; the most this period is ${Math.max(gym.platformBilling?.memberHighWater?.peak ?? 0, memberCount)}. ` : "Your plan is set by your gym's size: up to 50 members, 51 to 100, 101 to 149, or 150 and over. "}${BAND_RULE_TEXT} You are told by notification and email when you are close to the top of your plan and when you go over it.`
    : null;
  const statusLine = !gym.platformBilling
    ? "You have not subscribed to the S&C platform yet."
    : billing.state === "active"
      ? `Your platform subscription is paid up to ${billing.paidThrough}.`
      : billing.state === "grace"
        ? `Your platform payment is overdue. Access pauses in ${billing.graceDaysLeft ?? "a few"} day${billing.graceDaysLeft === 1 ? "" : "s"} unless it is paid.`
        : "Your platform subscription is overdue and access is paused.";

  return (
    <div className="max-w-2xl space-y-8">
      <header>
        <h1 className="text-xl font-semibold text-zinc-50">Set up {gym.name}</h1>
        <p className="mt-1 text-sm text-zinc-400">
          {doneCount} of {steps.length} done. New here? Read the <Link href="/staff/gym-guide" className="underline underline-offset-2 hover:text-zinc-100">gym guide</Link>.
        </p>
      </header>

      <ol className="space-y-2" aria-label="Setup checklist">
        {steps.map((s) => (
          <li key={s.title} className="flex gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3">
            <span aria-hidden="true" className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${s.done ? "bg-emerald-400 text-emerald-950" : "border border-white/25 text-transparent"}`}>
              ✓
            </span>
            <span>
              <span className="block text-sm font-medium text-zinc-100">
                {s.title}
                <span className="sr-only">{s.done ? " (done)" : " (not done yet)"}</span>
              </span>
              <span className="block text-xs text-zinc-400">{s.detail}</span>
            </span>
          </li>
        ))}
      </ol>

      <section aria-labelledby="subscription-heading" className="space-y-3">
        <h2 id="subscription-heading" className="text-base font-semibold text-zinc-50">Platform subscription</h2>
        <SubscriptionCard
          enabled={tenantSubscriptionConfigured()}
          hasCustomer={Boolean(gym.platformBilling?.stripeCustomerId ?? gym.pendingStripeCustomerId)}
          statusLine={statusLine}
          planNote={planNote}
          justReturned={returned === "success" || returned === "cancelled" ? returned : null}
        />
      </section>

      <section aria-labelledby="branding-heading" className="space-y-3">
        <h2 id="branding-heading" className="text-base font-semibold text-zinc-50">Logo and accent colour</h2>
        <BrandingForm initialAccent={gym.branding?.accentColor ?? ""} initialLogo={gym.branding?.logoUrl ?? ""} gymName={gym.name} />
      </section>
    </div>
  );
}
