import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findUserById, saveCoachNote, type CoachNoteRecord } from "@/lib/db";
import { verifySession } from "@/lib/session";

export async function POST(request: NextRequest) {
  const sessionUserId = verifySession(request.cookies.get("session")?.value)?.userId ?? null;

  if (!sessionUserId) {
    return NextResponse.json(
      { success: false, message: "You must be signed in to manage members." },
      { status: 401 }
    );
  }

  const staffUser = findUserById(sessionUserId);

  if (!staffUser) {
    return NextResponse.json(
      { success: false, message: "You must be signed in to manage members." },
      { status: 401 }
    );
  }

  if (staffUser.role !== "staff") {
    return NextResponse.json(
      { success: false, message: "Only staff can manage members." },
      { status: 403 }
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

  const { userId, notes } = (body ?? {}) as Record<string, unknown>;

  if (typeof userId !== "string" || !userId.trim()) {
    return NextResponse.json(
      { success: false, message: "A member is required." },
      { status: 400 }
    );
  }

  const targetUser = findUserById(userId);

  if (!targetUser) {
    return NextResponse.json(
      { success: false, message: "Member not found." },
      { status: 404 }
    );
  }

  const note: CoachNoteRecord = {
    userId,
    notes: typeof notes === "string" ? notes.trim() : "",
    updatedByStaffId: staffUser.id,
    updatedAt: new Date().toISOString(),
  };

  saveCoachNote(note);

  return NextResponse.json(
    { success: true, message: "Notes saved." },
    { status: 200 }
  );
}
