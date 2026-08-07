import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  findTrainingProgramById,
  findUserById,
  saveTrainingProgram,
  type TrainingProgramRecord,
  type TrainingProgramStatus,
} from "@/lib/db";
import { verifyRequestSession } from "@/lib/mobile-auth";
import { can } from "@/lib/permissions";
import { archiveOtherActivePrograms, parseProgramDays } from "@/lib/training-programs";

const STATUSES: TrainingProgramStatus[] = ["active", "archived"];

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

  const { id, name, days, status, currentDayIndex } = (body ?? {}) as Record<string, unknown>;

  if (typeof id !== "string" || !id.trim()) {
    return NextResponse.json({ success: false, message: "id is required." }, { status: 400 });
  }
  const existing = findTrainingProgramById(id);
  if (!existing) {
    return NextResponse.json({ success: false, message: "Program not found." }, { status: 404 });
  }

  if (typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ success: false, message: "Program name is required." }, { status: 400 });
  }

  const daysResult = parseProgramDays(days);
  if (!daysResult.ok) {
    return NextResponse.json({ success: false, message: daysResult.message }, { status: 400 });
  }

  const statusValue: TrainingProgramStatus =
    typeof status === "string" && STATUSES.includes(status as TrainingProgramStatus)
      ? (status as TrainingProgramStatus)
      : existing.status;

  const cursorRaw = typeof currentDayIndex === "number" ? currentDayIndex : existing.currentDayIndex;
  const cursor =
    Number.isInteger(cursorRaw) && cursorRaw >= 0 && cursorRaw < daysResult.days.length ? cursorRaw : 0;

  const updated: TrainingProgramRecord = {
    ...existing,
    name: name.trim(),
    days: daysResult.days,
    status: statusValue,
    currentDayIndex: cursor,
    updatedAt: new Date().toISOString(),
  };

  saveTrainingProgram(updated);
  if (statusValue === "active") archiveOtherActivePrograms(updated.userId, updated.id);

  return NextResponse.json({ success: true, message: "Program updated.", data: updated }, { status: 200 });
}
