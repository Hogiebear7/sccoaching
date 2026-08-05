import { cookies } from "next/headers";

import { findCycleSettingsByUserId, findProfileByUserId, findRecoveryLogsByUserId, findUserById } from "@/lib/db";
import { estimatePhase } from "@/lib/cycle-phase";
import { computeRollingTrainingLoad, readinessGuidance } from "@/lib/recovery";
import { verifySession } from "@/lib/session";
import { RecoveryView } from "./RecoveryView";

export default async function DashboardRecoveryPage() {
  const cookieStore = await cookies();
  const userId = verifySession(cookieStore.get("session")?.value)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;

  if (!user) {
    return (
      <div className="space-y-8">
        <div>
          <h1 className="text-display text-[28px]">Recovery</h1>
        </div>
        <div className="surface-card p-5">
          <p className="text-sm text-muted-foreground">
            We couldn&apos;t load account data. Try logging out and back in.
          </p>
        </div>
      </div>
    );
  }

  const logs = findRecoveryLogsByUserId(user.id);
  const latestLog = logs[0] ?? null;
  const rollingLoad = computeRollingTrainingLoad(logs);

  const profile = findProfileByUserId(user.id);
  const cycleSettings =
    profile?.cycleTrackingEligible && profile.cycleTrackingEnabled
      ? findCycleSettingsByUserId(user.id)
      : undefined;
  const phaseEstimate = cycleSettings
    ? estimatePhase(
        cycleSettings.lastPeriodStartDate,
        cycleSettings.averageCycleLengthDays,
        cycleSettings.periodLengthDays,
        cycleSettings.regularity
      )
    : null;

  return (
    <RecoveryView
      logs={logs}
      latestReadinessScore={latestLog?.readinessScore ?? null}
      latestGuidance={
        latestLog && latestLog.readinessScore !== null
          ? readinessGuidance(latestLog.readinessScore)
          : null
      }
      rollingLoad={rollingLoad}
      phaseEstimate={phaseEstimate}
      periodLengthDays={cycleSettings?.periodLengthDays ?? null}
    />
  );
}
