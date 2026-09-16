import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { deleteTrainingProgram, findTrainingProgramById, findUserById } from "@/lib/db";
import { sameGym } from "@/lib/gym-scope";
import { staffCanViewMemberData } from "@/lib/member-tier-wall";
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
  const existing = findTrainingProgramById(id);
  if (!existing) {
    return NextResponse.json({ success: false, message: "Program not found." }, { status: 404 });
  }
  const owner = findUserById(existing.userId);
  if (!owner || !sameGym(staffUser, owner)) {
    return NextResponse.json({ success: false, message: "Program not found." }, { status: 404 });
  }
  if (!staffCanViewMemberData(existing.userId)) {
    return NextResponse.json(
      { success: false, message: "This member's data isn't available until they hold a Membership-tier subscription." },
      { status: 403 }
    );
  }

  deleteTrainingProgram(id);

  return NextResponse.json({ success: true, message: "Program deleted." }, { status: 200 });
}
