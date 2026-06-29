import { cookies } from "next/headers";

import {
  findProfileByUserId,
  findUserById,
  findWorkoutSessionsByUserId,
  type WorkoutSessionRecord,
} from "@/lib/db";
import { verifySession } from "@/lib/session";
import { WorkoutsView } from "./WorkoutsView";

function sumDurationThisWeek(sessions: WorkoutSessionRecord[]): number {
  const today = new Date();
  const day = today.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;

  const monday = new Date(today);
  monday.setDate(today.getDate() + mondayOffset);

  const mondayISO = monday.toISOString().slice(0, 10);
  const todayISO = today.toISOString().slice(0, 10);

  return sessions
    .filter((session) => session.date >= mondayISO && session.date <= todayISO)
    .reduce((total, session) => total + (session.durationMins ?? 0), 0);
}

export default async function DashboardWorkoutsPage() {
  const cookieStore = await cookies();
  const userId = verifySession(cookieStore.get("session")?.value)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;
  const profile = user ? findProfileByUserId(user.id) : undefined;
  const sessions = user ? findWorkoutSessionsByUserId(user.id) : [];

  if (!user || !profile) {
    return (
      <div className="space-y-5 pt-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Workouts</h1>
        </div>
        <div className="rounded-2xl border bg-card p-5 shadow-[var(--shadow-card)]">
          <p className="text-sm text-muted-foreground">
            We couldn&apos;t load profile data for this account. Try logging out and back in.
          </p>
        </div>
      </div>
    );
  }

  return (
    <WorkoutsView sessions={sessions} weeklyDurationMins={sumDurationThisWeek(sessions)} />
  );
}
