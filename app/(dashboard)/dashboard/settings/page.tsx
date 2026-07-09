import { cookies } from "next/headers";

import { findMembershipPlanById, findProfileByUserId, findSubscriptionByUserId, findUserById } from "@/lib/db";
import { SUBSCRIPTION_STATUS_LABEL } from "@/lib/membership-status";
import { verifySession } from "@/lib/session";
import { SettingsView } from "./SettingsView";

export default async function SettingsPage() {
  const cookieStore = await cookies();
  const userId = verifySession(cookieStore.get("session")?.value)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;
  const profile = user ? findProfileByUserId(user.id) : undefined;

  if (!user || !profile) {
    return (
      <div className="space-y-8">
        <div>
          <h1 className="text-display text-[28px]">Settings</h1>
        </div>
        <div className="panel p-5">
          <p className="text-sm text-muted-foreground">
            We couldn&apos;t load settings for this account. Try logging out and
            back in.
          </p>
        </div>
      </div>
    );
  }

  const subscription = findSubscriptionByUserId(user.id);
  const plan = subscription?.planId ? findMembershipPlanById(subscription.planId) : undefined;

  return (
    <SettingsView
      email={user.email}
      profile={profile}
      membership={{
        planName: plan?.name ?? null,
        statusLabel: subscription ? SUBSCRIPTION_STATUS_LABEL[subscription.status] : null,
        statusIsActive: subscription?.status === "active",
        startedAt: subscription?.createdAt ?? null,
        renewsAt: subscription?.currentPeriodEnd ?? null,
      }}
    />
  );
}
