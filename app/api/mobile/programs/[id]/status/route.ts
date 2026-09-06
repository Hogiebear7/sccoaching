import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findTrainingProgramById, findUserById, saveTrainingProgram, type TrainingProgramStatus } from "@/lib/db";
import { verifyRequestSession } from "@/lib/mobile-auth";
import { archiveOtherActivePrograms, resolveProgramStatusTransition } from "@/lib/training-programs";
import { removeSyncedProgrammeSessions } from "@/lib/programme-weekly-sync";

const STATUSES: TrainingProgramStatus[] = ["active", "paused", "archived"];

// POST /api/mobile/programs/[id]/status
// Body: { status: "active" | "paused" | "archived" }
// Member-facing Pause/Resume/Cancel — the only status-mutating route a
// member (rather than staff) can call on their own programme.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = verifyRequestSession(request)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;

  if (!user) {
    return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });
  }

  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const { status } = (body ?? {}) as Record<string, unknown>;
  if (typeof status !== "string" || !STATUSES.includes(status as TrainingProgramStatus)) {
    return NextResponse.json({ success: false, message: "A valid status is required." }, { status: 400 });
  }
  const requestedStatus = status as TrainingProgramStatus;

  const program = findTrainingProgramById(id);
  if (!program || program.userId !== user.id) {
    return NextResponse.json({ success: false, message: "Programme not found." }, { status: 404 });
  }

  const transition = resolveProgramStatusTransition(program.status, requestedStatus);
  if (!transition.ok) {
    return NextResponse.json({ success: false, message: transition.message }, { status: 400 });
  }

  const updated = { ...program, status: requestedStatus, updatedAt: new Date().toISOString() };
  saveTrainingProgram(updated);

  // Resuming re-enforces "at most one active programme" the same way every
  // other path that activates one already does — a member could otherwise
  // have saved a brand-new active programme while this one sat paused.
  if (requestedStatus === "active") {
    archiveOtherActivePrograms(user.id, program.id);
  }
  // Cancelling is permanent — clean up future Weekly Training entries the
  // same way archiving already does elsewhere. Pausing deliberately leaves
  // the calendar alone; it's meant to be lightweight and reversible.
  if (requestedStatus === "archived") {
    removeSyncedProgrammeSessions(user.id, program.id);
  }

  return NextResponse.json({ success: true, message: "Done.", data: { program: updated } });
}
