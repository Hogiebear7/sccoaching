import { cookies } from "next/headers";

import {
  findCyclePrivacyByUserId,
  findCycleSettingsByUserId,
  findProfileByUserId,
  findUserById,
} from "@/lib/db";
import { verifySession } from "@/lib/session";
import { CycleView } from "./CycleView";

export default async function DashboardCyclePage() {
  const cookieStore = await cookies();
  const userId = verifySession(cookieStore.get("session")?.value)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;

  if (!user) {
    return (
      <section className="rounded-3xl border border-zinc-800 bg-zinc-900 p-6 shadow-2xl">
        <p className="text-sm uppercase tracking-[0.24em] text-teal-400">Cycle tracking</p>
        <h2 className="mt-2 text-3xl font-semibold text-zinc-50">Not available</h2>
        <p className="mt-3 max-w-2xl text-sm text-zinc-400">
          We couldn&apos;t load your account. Try logging out and back in.
        </p>
      </section>
    );
  }

  const profile = findProfileByUserId(user.id);

  if (!profile?.cycleTrackingEligible) {
    return (
      <section className="rounded-3xl border border-zinc-800 bg-zinc-900 p-6 shadow-2xl">
        <p className="text-sm uppercase tracking-[0.24em] text-teal-400">Cycle tracking</p>
        <h2 className="mt-2 text-3xl font-semibold text-zinc-50">Not available</h2>
        <p className="mt-3 max-w-2xl text-sm text-zinc-400">
          Cycle tracking is not available for this account.
        </p>
      </section>
    );
  }

  const cycleSettings = findCycleSettingsByUserId(user.id) ?? null;
  const cyclePrivacy = findCyclePrivacyByUserId(user.id) ?? null;

  return (
    <CycleView
      cycleTrackingEnabled={profile.cycleTrackingEnabled}
      cycleSettings={cycleSettings}
      cyclePrivacy={cyclePrivacy}
    />
  );
}
