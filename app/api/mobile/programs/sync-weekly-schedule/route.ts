import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findTrainingProgramById, findUserById } from "@/lib/db";
import { verifyRequestSession } from "@/lib/mobile-auth";
import type { TrainingDayOfWeek } from "@/lib/profile-schema";
import { syncProgrammeToWeeklyTraining } from "@/lib/programme-weekly-sync";

// Called once, right after a member saves an AI programme, when they choose
// to auto-add it to their Weekly Training schedule — weekdayMap has one
// entry per type:"workout" day in the programme, in order, assigning each a
// real calendar weekday (there's no way to infer this automatically, see
// lib/programme-weekly-sync.ts).
export async function POST(request: NextRequest) {
  const userId = verifyRequestSession(request)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;

  if (!user) {
    return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const { id, weekdayMap } = (body ?? {}) as Record<string, unknown>;
  if (typeof id !== "string" || !id.trim()) {
    return NextResponse.json({ success: false, message: "id is required." }, { status: 400 });
  }

  const program = findTrainingProgramById(id);
  if (!program || program.userId !== user.id) {
    return NextResponse.json({ success: false, message: "Programme not found." }, { status: 404 });
  }
  if (program.status !== "active" || (program.source ?? "staff") !== "ai") {
    return NextResponse.json({ success: false, message: "Only an active AI programme can sync to your schedule." }, { status: 400 });
  }

  const workoutDayCount = program.days.filter((d) => d.type === "workout").length;
  const cleanWeekdayMap = Array.isArray(weekdayMap)
    ? weekdayMap.filter((v): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 6)
    : [];

  if (cleanWeekdayMap.length !== workoutDayCount) {
    return NextResponse.json(
      { success: false, message: `weekdayMap must have exactly ${workoutDayCount} weekday(s), one per workout day.` },
      { status: 400 }
    );
  }

  syncProgrammeToWeeklyTraining(user.id, program, cleanWeekdayMap as TrainingDayOfWeek[]);

  return NextResponse.json({ success: true, message: "Added to your weekly schedule." });
}
