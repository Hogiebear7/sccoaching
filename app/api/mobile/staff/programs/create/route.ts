import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findUserById, saveTrainingProgram, type TrainingProgramRecord } from "@/lib/db";
import { verifyRequestSession } from "@/lib/mobile-auth";
import { can } from "@/lib/permissions";
import { archiveOtherActivePrograms, parseProgramDays } from "@/lib/training-programs";

export async function POST(request: NextRequest) {
  const sessionUserId = verifyRequestSession(request)?.userId ?? null;
  const staffUser = sessionUserId ? findUserById(sessionUserId) : undefined;

  if (!staffUser) {
    return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });
  }
  if (!can(staffUser.role, "programs.manage")) {
    return NextResponse.json({ success: false, message: "Staff access required." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const { userId, name, days } = (body ?? {}) as Record<string, unknown>;

  if (typeof userId !== "string" || !userId.trim()) {
    return NextResponse.json({ success: false, message: "A member must be selected." }, { status: 400 });
  }
  const member = findUserById(userId);
  if (!member) {
    return NextResponse.json({ success: false, message: "Member not found." }, { status: 404 });
  }

  if (typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ success: false, message: "Program name is required." }, { status: 400 });
  }

  const daysResult = parseProgramDays(days);
  if (!daysResult.ok) {
    return NextResponse.json({ success: false, message: daysResult.message }, { status: 400 });
  }

  const now = new Date().toISOString();
  const program: TrainingProgramRecord = {
    id: randomUUID(),
    userId: member.id,
    name: name.trim(),
    status: "active",
    days: daysResult.days,
    currentDayIndex: 0,
    createdByStaffId: staffUser.id,
    createdAt: now,
    updatedAt: now,
  };

  saveTrainingProgram(program);
  archiveOtherActivePrograms(member.id, program.id);

  return NextResponse.json({ success: true, message: "Program assigned.", data: program }, { status: 200 });
}
