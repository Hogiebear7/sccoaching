import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findTrainingProgramById, findUserById } from "@/lib/db";
import { verifyRequestSession } from "@/lib/mobile-auth";
import { advanceProgramDay } from "@/lib/training-programs";

// Called once a member finishes logging the day their program currently
// points at — moves currentDayIndex to the next day (wrapping to the start
// of the block once the last day is done).
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

  const { id } = (body ?? {}) as Record<string, unknown>;
  if (typeof id !== "string" || !id.trim()) {
    return NextResponse.json({ success: false, message: "id is required." }, { status: 400 });
  }

  const program = findTrainingProgramById(id);
  if (!program || program.userId !== user.id) {
    return NextResponse.json({ success: false, message: "Program not found." }, { status: 404 });
  }

  const updated = advanceProgramDay(program);

  return NextResponse.json({ success: true, message: "Advanced to next day.", data: { program: updated } });
}
