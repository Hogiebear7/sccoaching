import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { deleteWaitlistEntry, findUserById, findWaitlistEntryByClassAndUser } from "@/lib/db";
import { verifySession } from "@/lib/session";

export async function POST(request: NextRequest) {
  const userId = verifySession(request.cookies.get("session")?.value)?.userId ?? null;

  if (!userId) {
    return NextResponse.json(
      { success: false, message: "You must be signed in to leave a waitlist." },
      { status: 401 }
    );
  }

  const user = findUserById(userId);

  if (!user) {
    return NextResponse.json(
      { success: false, message: "You must be signed in to leave a waitlist." },
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

  const { classId } = (body ?? {}) as Record<string, unknown>;

  if (typeof classId !== "string" || !classId.trim()) {
    return NextResponse.json(
      { success: false, message: "A class is required." },
      { status: 400 }
    );
  }

  const entry = findWaitlistEntryByClassAndUser(classId, user.id);

  if (!entry) {
    return NextResponse.json(
      { success: false, message: "You're not on the waitlist for this class." },
      { status: 404 }
    );
  }

  deleteWaitlistEntry(entry.id);

  return NextResponse.json(
    { success: true, message: "Removed from the waitlist." },
    { status: 200 }
  );
}
