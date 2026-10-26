import { cookies } from "next/headers";

import {
  findCyclePrivacyByUserId,
  findCycleSettingsByUserId,
  findPregnancyStatusByUserId,
  findProfileByUserId,
  findUserById,
} from "@/lib/db";
import { memberCyclePause } from "@/lib/cycle-phase-data";
import { estimatePregnancy } from "@/lib/pregnancy";
import { nutritionStageFor } from "@/lib/pregnancy-nutrition";
import { trainingGuidanceFor } from "@/lib/pregnancy-training";
import { verifySession } from "@/lib/session";
import { CycleView } from "./CycleView";
import { PregnancyPanel } from "./PregnancyPanel";

export default async function DashboardCyclePage() {
  const cookieStore = await cookies();
  const userId = verifySession(cookieStore.get("session")?.value)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;

  if (!user) {
    return (
      <section>
        <p className="label-caps">Cycle tracking</p>
        <h2 className="text-display mt-1 text-[28px] leading-tight text-zinc-50">Not available</h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-400">
          We couldn&apos;t load your account. Try logging out and back in.
        </p>
      </section>
    );
  }

  const profile = findProfileByUserId(user.id);

  if (!profile?.cycleTrackingEligible) {
    return (
      <section>
        <p className="label-caps">Cycle tracking</p>
        <h2 className="text-display mt-1 text-[28px] leading-tight text-zinc-50">Not available</h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-400">
          Cycle tracking is not available for this account.
        </p>
      </section>
    );
  }

  const cycleSettings = findCycleSettingsByUserId(user.id) ?? null;
  const cyclePrivacy = findCyclePrivacyByUserId(user.id) ?? null;

  const pregnancy = findPregnancyStatusByUserId(user.id) ?? null;
  const pregnancyStage = nutritionStageFor(pregnancy, new Date().toISOString().slice(0, 10));

  return (
    <div className="space-y-8">
      <CycleView
        cycleTrackingEnabled={profile.cycleTrackingEnabled}
        menopauseSupportEnabled={profile.menopauseSupportEnabled}
        cycleSettings={cycleSettings}
        cyclePrivacy={cyclePrivacy}
        cyclePause={memberCyclePause(user.id, cycleSettings)}
        menopauseStage={profile.menopauseStage ?? null}
        menopauseShareWithCoach={profile.menopauseShareWithCoach ?? false}
      />
      <PregnancyPanel
        isPregnant={pregnancy?.isPregnant ?? false}
        shareWithCoach={pregnancy?.shareWithCoach ?? false}
        birthDate={pregnancy?.birthDate ?? null}
        breastfeeding={pregnancy?.breastfeeding ?? null}
        estimate={estimatePregnancy(pregnancy?.isPregnant ?? false, pregnancy?.dueDate ?? null, undefined, pregnancy ?? undefined)}
        training={pregnancyStage ? trainingGuidanceFor(pregnancyStage) : null}
      />
    </div>
  );
}
