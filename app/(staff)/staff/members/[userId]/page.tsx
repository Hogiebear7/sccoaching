import Link from "next/link";

import {
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
import { remainingSessions } from "@/lib/scheduling-status";
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
      <span className="text-sm text-zinc-500">{label}</span>
      <span className="text-sm text-zinc-100">{value}</span>
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
        <Link
          href="/staff/classes"
          className="text-sm text-teal-400 transition hover:text-teal-300"
        >
          ← Back to classes
        </Link>

        <div className="rounded-3xl border border-zinc-800 bg-zinc-900 p-6 shadow-2xl">
          <p className="text-sm uppercase tracking-[0.24em] text-teal-400">Member</p>
          <h2 className="mt-2 text-3xl font-semibold text-zinc-50">Member not found</h2>
          <p className="mt-3 max-w-2xl text-sm text-zinc-400">
            This member account no longer exists.
          </p>
        </div>
      </section>
    );
  }

  const profile = findProfileByUserId(user.id);
  const cycleSettings = profile?.cycleTrackingEligible ? findCycleSettingsByUserId(user.id) : undefined;
  const cyclePrivacy = profile?.cycleTrackingEligible ? findCyclePrivacyByUserId(user.id) : undefined;
  const programme = findProgrammeByUserId(user.id);
  const sessions = findWorkoutSessionsByUserId(user.id);
  const coachNote = findCoachNoteByUserId(user.id);
  const recoveryLogs = findRecoveryLogsByUserId(user.id).slice(0, 7);
  const messages = findMessagesByMemberId(user.id);
  const activePlans = findMembershipPlans().filter((plan) => plan.isActive);
  const subscription = findSubscriptionByUserId(user.id);
  const subscriptionPlan = subscription?.planId ? findMembershipPlanById(subscription.planId) : undefined;

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
    .filter((booking): booking is NonNullable<typeof booking> => booking !== null && !booking.isPast)
    .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));

  return (
    <section className="space-y-6">
      <Link
        href="/staff/classes"
        className="text-sm text-teal-400 transition hover:text-teal-300"
      >
        ← Back to classes
      </Link>

      <div className="rounded-3xl border border-zinc-800 bg-zinc-900 p-6 shadow-2xl">
        <p className="text-sm uppercase tracking-[0.24em] text-teal-400">Member</p>
        <h2 className="mt-2 text-3xl font-semibold text-zinc-50">
          {profile?.fullName ?? user.email}
        </h2>
        <p className="mt-3 max-w-2xl text-sm text-zinc-400">{user.email}</p>
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
        currentRemainingSessions={
          subscriptionPlan && subscription ? remainingSessions(subscriptionPlan, subscription) : null
        }
      />

      {!profile ? (
        <div className="rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
          <h3 className="text-lg font-semibold text-zinc-50">Profile</h3>
          <p className="mt-3 text-sm text-zinc-400">No profile data for this account yet.</p>
        </div>
      ) : (
        <StaffMemberEditor
          userId={user.id}
          email={user.email}
          profile={profile}
          initialNotes={coachNote?.notes ?? ""}
        />
      )}

      {profile?.cycleTrackingEligible ? (
        <div className="rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
          <h3 className="text-lg font-semibold text-zinc-50">Cycle tracking</h3>
          {!profile.cycleTrackingEnabled ? (
            <p className="mt-3 text-sm text-zinc-400">Member has not enabled cycle tracking.</p>
          ) : !cyclePrivacy ||
            (!cyclePrivacy.shareCurrentPhaseWithCoach &&
              !cyclePrivacy.shareExactDatesWithCoach &&
              !cyclePrivacy.shareNotesWithCoach) ? (
            <p className="mt-3 text-sm text-zinc-400">
              Cycle tracking is private — the member has not shared any information with coaches.
            </p>
          ) : (
            <div className="mt-4 space-y-3">
              <p className="text-xs text-zinc-500">
                Shown based on member&apos;s sharing preferences. Approximate only — not medical
                information.
              </p>
              {cycleSettings?.updatedAt ? (
                <p className="text-xs text-zinc-600">
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

      <div className="rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
        <h3 className="text-lg font-semibold text-zinc-50">Programme</h3>
        {!programme ? (
          <p className="mt-3 text-sm text-zinc-400">No programme assigned yet.</p>
        ) : (
          <div className="mt-3 space-y-2">
            <p className="text-base font-semibold text-zinc-100">{programme.title}</p>
            <p className="text-sm text-zinc-400">
              Status: {programme.status}
              {programme.phase ? ` · ${programme.phase}` : ""}
            </p>
            {programme.currentWeek != null && programme.totalWeeks != null ? (
              <p className="text-sm text-zinc-400">
                Week {programme.currentWeek} of {programme.totalWeeks}
              </p>
            ) : null}
            {programme.focus ? (
              <p className="text-sm text-zinc-400">{programme.focus}</p>
            ) : null}
            {programme.notes ? (
              <p className="text-sm text-zinc-400">Notes: {programme.notes}</p>
            ) : null}
          </div>
        )}
      </div>

      <div className="rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
        <h3 className="text-lg font-semibold text-zinc-50">Workout history</h3>
        {sessions.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-400">No workouts logged yet.</p>
        ) : (
          <div className="mt-5 space-y-3">
            {sessions.map((session) => (
              <div
                key={session.id}
                className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4"
              >
                <p className="text-sm text-zinc-500">{session.date}</p>
                <h4 className="mt-1 text-base font-semibold text-zinc-100">
                  {session.title}
                </h4>
                {session.notes ? (
                  <p className="mt-2 text-sm text-zinc-400">{session.notes}</p>
                ) : null}
                {session.durationMins !== null ? (
                  <span className="mt-2 inline-block rounded-full bg-zinc-950 px-3 py-1 text-xs font-medium text-zinc-300">
                    {session.durationMins} min
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
        <h3 className="text-lg font-semibold text-zinc-50">Recovery (last 7 entries)</h3>
        {recoveryLogs.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-400">No recovery check-ins logged yet.</p>
        ) : (
          <div className="mt-5 space-y-3">
            {recoveryLogs.map((log) => {
              const load = trainingLoadForLog(log);

              return (
                <div
                  key={log.id}
                  className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4"
                >
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="text-sm text-zinc-500">{log.date}</p>
                      <p className="mt-1 text-sm text-zinc-300">
                        Sleep {log.sleepHours}h · Quality {log.sleepQuality}/5 · Soreness{" "}
                        {log.soreness}/5 · Fatigue {log.fatigue}/5
                      </p>
                      {log.readinessScore !== null ? (
                        <p className="mt-2 text-xs text-zinc-500">
                          {readinessGuidance(log.readinessScore)}
                        </p>
                      ) : null}
                    </div>

                    <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
                      <span className="rounded-full bg-zinc-950 px-3 py-1 text-xs font-medium text-zinc-300">
                        Readiness {log.readinessScore ?? "—"}/100
                      </span>
                      {load !== null ? (
                        <span className="rounded-full bg-zinc-950 px-3 py-1 text-xs font-medium text-zinc-300">
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

      <div className="rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
        <h3 className="text-lg font-semibold text-zinc-50">Upcoming bookings</h3>
        {upcomingBookings.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-400">No upcoming bookings.</p>
        ) : (
          <div className="mt-5 space-y-3">
            {upcomingBookings.map((booking) => (
              <div
                key={booking.bookingId}
                className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4"
              >
                <p className="text-sm text-zinc-500">
                  {booking.date} · {booking.startTime}
                </p>
                <h4 className="mt-1 text-base font-semibold text-zinc-100">
                  {booking.title}
                </h4>
                <span className="mt-2 inline-block rounded-full bg-zinc-950 px-3 py-1 text-xs font-medium text-zinc-300">
                  {booking.durationMins} min
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
        <h3 className="text-lg font-semibold text-zinc-50">Messages</h3>
        <p className="mt-2 text-sm text-zinc-400">
          Conversation with {profile?.fullName ?? user.email}.
        </p>
        <div className="mt-4">
          <MessagesThread messages={messages} currentUserRole="staff" memberId={user.id} />
        </div>
      </div>
    </section>
  );
}
