import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { deleteTrainingProgram, findTrainingProgramById, findUserById } from "@/lib/db";
import { verifyRequestSession } from "@/lib/mobile-auth";
import { can } from "@/lib/permissions";

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

  const { id } = (body ?? {}) as Record<string, unknown>;
  if (typeof id !== "string" || !id.trim()) {
    return NextResponse.json({ success: false, message: "id is required." }, { status: 400 });
  }
  if (!findTrainingProgramById(id)) {
    return NextResponse.json({ success: false, message: "Program not found." }, { status: 404 });
  }

  deleteTrainingProgram(id);

  return NextResponse.json({ success: true, message: "Program deleted." }, { status: 200 });
}
