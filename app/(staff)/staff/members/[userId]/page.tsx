import Link from "next/link";

import {
  findBodyWeightLogsByUserId,
  findPassLedgerByUserId,
  findBookingsByUserId,
  findClassById,
  findCoachNoteByUserId,
  findCyclePrivacyByUserId,
  findCycleSettingsByUserId,
  findMembershipPlanById,
  findMembershipPlans,
  findMessagesByMemberId,
  findProfileByUserId,
  findProgrammeByUserId,
  findRecoveryLogsByUserId,
  findSubscriptionByUserId,
  findUserById,
  findWorkoutSessionsByUserId,
} from "@/lib/db";
import { readinessGuidance, trainingLoadForLog } from "@/lib/recovery";
import { resolveCurrentWeightKg } from "@/lib/body-weight";
import { describeDrinkSettings } from "@/lib/drink-settings";
import { formatMembershipDate } from "@/lib/membership-status";
import { buildDrinkMix, buildDrinkPlan } from "@/lib/nutrition";
import { purchasedPassBalance } from "@/lib/payments";
import { classPassBalance } from "@/lib/scheduling-status";
import { MessagesThread } from "@/components/messages/MessagesThread";
import { CoachSummaryPanel } from "@/components/staff/CoachSummaryPanel";
import { MembershipStatusPanel } from "@/components/staff/MembershipStatusPanel";
import { StaffMemberEditor } from "./StaffMemberEditor";

function approximateCycleDay(lastPeriodStartDate: string, averageCycleLengthDays: number): number {
  const diffDays = Math.floor(
    (Date.now() - new Date(lastPeriodStartDate).getTime()) / 86_400_000
  );
  if (diffDays < 0) return 1;
  return (diffDays % averageCycleLengthDays) + 1;
}

function CycleInfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[180px_minmax(0,1fr)]">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm">{value}</span>
    </div>
  );
}

export default async function StaffMemberDetailPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId } = await params;
  const user = findUserById(userId);

  if (!user) {
    return (
      <section className="space-y-6">
        <Link href="/staff/classes" className="text-sm text-gold transition hover:text-gold/80">
          ← Back to classes
        </Link>
        <div>
          <p className="label-caps">Member</p>
          <h2 className="text-display mt-1 text-[28px] leading-tight">Member not found</h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            This member account no longer exists.
          </p>
        </div>
      </section>
    );
  }

  const profile = findProfileByUserId(user.id);
  const cycleSettings = profile?.cycleTrackingEligible
    ? findCycleSettingsByUserId(user.id)
    : undefined;
  const cyclePrivacy = profile?.cycleTrackingEligible
    ? findCyclePrivacyByUserId(user.id)
    : undefined;
  const programme = findProgrammeByUserId(user.id);
  const sessions = findWorkoutSessionsByUserId(user.id);
  const coachNote = findCoachNoteByUserId(user.id);
  const recoveryLogs = findRecoveryLogsByUserId(user.id).slice(0, 7);
  const messages = findMessagesByMemberId(user.id);
  const activePlans = findMembershipPlans().filter((plan) => plan.isActive);
  const subscription = findSubscriptionByUserId(user.id);

  // Drink calculator summary — computed with the member's synced weight so
  // staff see the same numbers the member (and the AI coach) sees.
  const drinkSettings = profile?.drinkSettings ?? null;
  const drinkInput = drinkSettings
    ? {
        bodyWeightKg:
          resolveCurrentWeightKg(
            profile?.currentWeightKg ?? null,
            findBodyWeightLogsByUserId(user.id)
          ) ?? 75,
        ...drinkSettings,
      }
    : null;
  const drinkMix = drinkInput ? buildDrinkMix(drinkInput) : null;
  const drinkPlan = drinkInput ? buildDrinkPlan(drinkInput) : null;
  const subscriptionPlan = subscription?.planId
    ? findMembershipPlanById(subscription.planId)
    : undefined;

  const now = Date.now();
  const upcomingBookings = findBookingsByUserId(user.id)
    .map((booking) => {
      const classRecord = findClassById(booking.classId);
      if (!classRecord) return null;
      return {
        bookingId: booking.id,
        title: classRecord.title,
        date: classRecord.date,
        startTime: classRecord.startTime,
        durationMins: classRecord.durationMins,
        isPast: new Date(`${classRecord.date}T${classRecord.startTime}`).getTime() < now,
      };
    })
    .filter((b): b is NonNullable<typeof b> => b !== null && !b.isPast)
    .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));

  return (
    <section className="space-y-6">
      <Link href="/staff/classes" className="text-sm text-gold transition hover:text-gold/80">
        ← Back to classes
      </Link>

      {/* Header */}
      <div>
        <p className="label-caps">Member</p>
        <h2 className="text-display mt-1 text-[28px] leading-tight">
          {profile?.fullName ?? user.email}
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">{user.email}</p>
      </div>

      <CoachSummaryPanel memberId={user.id} />

      <MembershipStatusPanel
        memberId={user.id}
        plans={activePlans}
        currentPlanId={subscription?.planId ?? null}
        currentPlanName={subscriptionPlan?.name ?? null}
        currentStatus={subscription?.status ?? null}
        currentProvider={subscription?.provider ?? null}
        currentUpdatedAt={subscription?.updatedAt ?? null}
        currentPeriodEnd={subscription?.currentPeriodEnd ?? null}
        passBalance={
          subscriptionPlan && subscription
            ? classPassBalance(subscriptionPlan, subscription)
            : null
        }
        purchasedPasses={purchasedPassBalance(user.id)}
        passLedger={findPassLedgerByUserId(user.id)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .slice(0, 6)}
      />

      {/* Drink calculator */}
      {drinkSettings && drinkMix && drinkPlan ? (
        <div className="panel p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-lg font-semibold">Drink calculator</h3>
            <span className="text-xs text-muted-foreground">
              {describeDrinkSettings(drinkSettings)}
              {profile?.drinkSettingsUpdatedAt
                ? ` · updated ${formatMembershipDate(profile.drinkSettingsUpdatedAt)}`
                : ""}
            </span>
          </div>
          <div className="mt-4 grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
            {[
              { name: "Maltodextrin", amount: `${drinkMix.maltodextrinG} g` },
              { name: "Beta-alanine", amount: `${drinkMix.betaAlanineG} g` },
              { name: "Chia seeds", amount: `${drinkMix.chiaG} g` },
              { name: "Beetroot powder", amount: `${drinkMix.beetrootG} g` },
              { name: "Orange concentrate", amount: `${drinkMix.orangeMl} ml` },
              { name: "Salt", amount: `${drinkMix.saltG.toFixed(2)} g` },
            ].map((row) => (
              <div key={row.name} className="flex items-baseline justify-between gap-3">
                <span className="text-sm text-muted-foreground">{row.name}</span>
                <span className="text-sm font-medium tabular-nums">{row.amount}</span>
              </div>
            ))}
          </div>
          <p className="mt-4 text-xs text-muted-foreground tabular-nums">
            {drinkMix.carbsG.toFixed(0)} g carbs · {drinkMix.sodiumTotalMg} mg sodium ·{" "}
            {drinkMix.nitrateMg} mg nitrate · {drinkMix.calories} kcal
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{drinkPlan.bottleAdvice}</p>
        </div>
      ) : null}

      {!profile ? (
        <div className="panel p-6">
          <h3 className="text-lg font-semibold">Profile</h3>
          <p className="mt-3 text-sm text-muted-foreground">No profile data for this account yet.</p>
        </div>
      ) : (
        <StaffMemberEditor
          userId={user.id}
          email={user.email}
          profile={profile}
          initialNotes={coachNote?.notes ?? ""}
        />
      )}

      {/* Cycle tracking */}
      {profile?.cycleTrackingEligible ? (
        <div className="panel p-6">
          <h3 className="text-lg font-semibold">Cycle tracking</h3>
          {!profile.cycleTrackingEnabled ? (
            <p className="mt-3 text-sm text-muted-foreground">
              Member has not enabled cycle tracking.
            </p>
          ) : !cyclePrivacy ||
            (!cyclePrivacy.shareCurrentPhaseWithCoach &&
              !cyclePrivacy.shareExactDatesWithCoach &&
              !cyclePrivacy.shareNotesWithCoach) ? (
            <p className="mt-3 text-sm text-muted-foreground">
              Cycle tracking is private — the member has not shared any information with coaches.
            </p>
          ) : (
            <div className="mt-4 space-y-3">
              <p className="text-xs text-muted-foreground">
                Shown based on member&apos;s sharing preferences. Approximate only — not medical
                information.
              </p>
              {cycleSettings?.updatedAt ? (
                <p className="text-xs text-muted-foreground/50">
                  Updated{" "}
                  {new Date(cycleSettings.updatedAt).toLocaleDateString(undefined, {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                  })}
                </p>
              ) : null}
              {cyclePrivacy.shareCurrentPhaseWithCoach ? (
                cycleSettings?.lastPeriodStartDate && cycleSettings.averageCycleLengthDays ? (
                  <CycleInfoRow
                    label="Approx. cycle day"
                    value={`Day ${approximateCycleDay(cycleSettings.lastPeriodStartDate, cycleSettings.averageCycleLengthDays)} of ~${cycleSettings.averageCycleLengthDays}`}
                  />
                ) : (
                  <CycleInfoRow label="Approx. cycle day" value="Not enough data to estimate" />
                )
              ) : null}
              {cyclePrivacy.shareExactDatesWithCoach && cycleSettings?.lastPeriodStartDate ? (
                <CycleInfoRow
                  label="Last period start"
                  value={new Date(cycleSettings.lastPeriodStartDate).toLocaleDateString(undefined, {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                  })}
                />
              ) : null}
              {cyclePrivacy.shareNotesWithCoach && cycleSettings?.privateNotes ? (
                <CycleInfoRow label="Notes" value={cycleSettings.privateNotes} />
              ) : null}
            </div>
          )}
        </div>
      ) : null}

      {/* Programme */}
      <div className="panel p-6">
        <h3 className="text-lg font-semibold">Programme</h3>
        {!programme ? (
          <p className="mt-3 text-sm text-muted-foreground">No programme assigned yet.</p>
        ) : (
          <div className="mt-3 space-y-2">
            <p className="text-base font-semibold">{programme.title}</p>
            <p className="text-sm text-muted-foreground">
              Status: {programme.status}
              {programme.phase ? ` · ${programme.phase}` : ""}
            </p>
            {programme.currentWeek != null && programme.totalWeeks != null ? (
              <p className="text-sm text-muted-foreground">
                Week {programme.currentWeek} of {programme.totalWeeks}
              </p>
            ) : null}
            {programme.focus ? (
              <p className="text-sm text-muted-foreground">{programme.focus}</p>
            ) : null}
            {programme.notes ? (
              <p className="text-sm text-muted-foreground">Notes: {programme.notes}</p>
            ) : null}
          </div>
        )}
      </div>

      {/* Workout history */}
      <div className="panel p-6">
        <h3 className="text-lg font-semibold">Workout history</h3>
        {sessions.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No workouts logged yet.</p>
        ) : (
          <div className="mt-5 space-y-3">
            {sessions.map((session) => (
              <div
                key={session.id}
                className="well p-4"
              >
                <p className="text-xs text-muted-foreground">{session.date}</p>
                <h4 className="mt-1 text-base font-semibold">{session.title}</h4>
                {session.notes ? (
                  <p className="mt-2 text-sm text-muted-foreground">{session.notes}</p>
                ) : null}
                {session.durationMins !== null ? (
                  <span className="mt-2 inline-block rounded-full bg-secondary px-3 py-1 text-xs font-medium text-secondary-foreground">
                    {session.durationMins} min
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recovery */}
      <div className="panel p-6">
        <h3 className="text-lg font-semibold">Recovery (last 7 entries)</h3>
        {recoveryLogs.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No recovery check-ins logged yet.</p>
        ) : (
          <div className="mt-5 space-y-3">
            {recoveryLogs.map((log) => {
              const load = trainingLoadForLog(log);
              return (
                <div
                  key={log.id}
                  className="well p-4"
                >
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="text-xs text-muted-foreground">{log.date}</p>
                      <p className="mt-1 text-sm">
                        Sleep {log.sleepHours}h · Quality {log.sleepQuality}/5 · Soreness{" "}
                        {log.soreness}/5 · Fatigue {log.fatigue}/5
                      </p>
                      {log.readinessScore !== null ? (
                        <p className="mt-2 text-xs text-muted-foreground">
                          {readinessGuidance(log.readinessScore)}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
                      <span className="rounded-full bg-secondary px-3 py-1 text-xs font-medium text-secondary-foreground">
                        Readiness {log.readinessScore ?? "—"}/100
                      </span>
                      {load !== null ? (
                        <span className="rounded-full bg-secondary px-3 py-1 text-xs font-medium text-secondary-foreground">
                          Load {load}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Upcoming bookings */}
      <div className="panel p-6">
        <h3 className="text-lg font-semibold">Upcoming bookings</h3>
        {upcomingBookings.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No upcoming bookings.</p>
        ) : (
          <div className="mt-5 space-y-3">
            {upcomingBookings.map((booking) => (
              <div
                key={booking.bookingId}
                className="well p-4"
              >
                <p className="text-xs text-muted-foreground">
                  {booking.date} · {booking.startTime}
                </p>
                <h4 className="mt-1 text-base font-semibold">{booking.title}</h4>
                <span className="mt-2 inline-block rounded-full bg-secondary px-3 py-1 text-xs font-medium text-secondary-foreground">
                  {booking.durationMins} min
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Messages */}
      <div className="panel p-6">
        <h3 className="text-lg font-semibold">Messages</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          Conversation with {profile?.fullName ?? user.email}.
        </p>
        <div className="mt-4">
          <MessagesThread messages={messages} currentUserRole="staff" memberId={user.id} />
        </div>
      </div>
    </section>
  );
}
