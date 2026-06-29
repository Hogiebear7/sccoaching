import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  findProgrammeByUserId,
  findUserById,
  saveProgramme,
  type ProgrammeRecord,
  type ProgrammeStatus,
} from "@/lib/db";
import { verifySession } from "@/lib/session";

const PROGRAMME_STATUSES: ProgrammeStatus[] = ["active", "paused", "completed"];

function parseOptionalNonNegativeInt(
  value: unknown
): { ok: true; value: number | null } | { ok: false } {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== "string") return { ok: false };
  if (value.trim() === "") return { ok: true, value: null };

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) return { ok: false };

  return { ok: true, value: parsed };
}

export async function POST(request: NextRequest) {
  const userId = verifySession(request.cookies.get("session")?.value)?.userId ?? null;

  if (!userId) {
    return NextResponse.json(
      { success: false, message: "You must be signed in to update your programme." },
      { status: 401 }
    );
  }

  const user = findUserById(userId);

  if (!user) {
    return NextResponse.json(
      { success: false, message: "You must be signed in to update your programme." },
      { status: 401 }
    );
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, message: "Invalid JSON body." },
      { status: 400 }
    );
  }

  const { title, phase, focus, status, startDate, currentWeek, totalWeeks, notes } =
    (body ?? {}) as Record<string, unknown>;

  if (typeof title !== "string" || !title.trim()) {
    return NextResponse.json(
      { success: false, message: "Title is required." },
      { status: 400 }
    );
  }

  let statusValue: ProgrammeStatus = "active";

  if (status !== undefined && status !== null && status !== "") {
    if (typeof status !== "string" || !PROGRAMME_STATUSES.includes(status as ProgrammeStatus)) {
      return NextResponse.json(
        { success: false, message: "A valid status is required." },
        { status: 400 }
      );
    }
    statusValue = status as ProgrammeStatus;
  }

  const currentWeekResult = parseOptionalNonNegativeInt(currentWeek);

  if (!currentWeekResult.ok) {
    return NextResponse.json(
      { success: false, message: "Current week must be a whole number." },
      { status: 400 }
    );
  }

  const totalWeeksResult = parseOptionalNonNegativeInt(totalWeeks);

  if (!totalWeeksResult.ok) {
    return NextResponse.json(
      { success: false, message: "Total weeks must be a whole number." },
      { status: 400 }
    );
  }

  const existingProgramme = findProgrammeByUserId(user.id);
  const now = new Date().toISOString();

  const programme: ProgrammeRecord = {
    id: existingProgramme?.id ?? randomUUID(),
    userId: user.id,
    title: title.trim(),
    phase: typeof phase === "string" && phase.trim() ? phase.trim() : null,
    focus: typeof focus === "string" && focus.trim() ? focus.trim() : null,
    status: statusValue,
    startDate: typeof startDate === "string" && startDate.trim() ? startDate.trim() : null,
    currentWeek: currentWeekResult.value,
    totalWeeks: totalWeeksResult.value,
    notes: typeof notes === "string" && notes.trim() ? notes.trim() : null,
    createdAt: existingProgramme?.createdAt ?? now,
    updatedAt: now,
  };

  saveProgramme(programme);

  return NextResponse.json(
    { success: true, message: "Programme saved." },
    { status: 200 }
  );
}
