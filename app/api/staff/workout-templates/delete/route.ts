import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { deleteClassWorkoutTemplate, findClassWorkoutTemplateById, findUserById } from "@/lib/db";
import { verifyRequestSession } from "@/lib/mobile-auth";
import { can } from "@/lib/permissions";

export async function POST(request: NextRequest) {
  const sessionUserId = verifyRequestSession(request)?.userId ?? null;

  if (!sessionUserId) {
    return NextResponse.json({ success: false, message: "You must be signed in to manage workout templates." }, { status: 401 });
  }

  const staffUser = findUserById(sessionUserId);

  if (!staffUser || !can(staffUser.role, "classes.manage")) {
    return NextResponse.json({ success: false, message: "Only staff can manage workout templates." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const { id } = (body ?? {}) as Record<string, unknown>;

  if (typeof id !== "string" || !id.trim()) {
    return NextResponse.json({ success: false, message: "Template ID is required." }, { status: 400 });
  }

  const template = findClassWorkoutTemplateById(id);

  if (!template) {
    return NextResponse.json({ success: false, message: "Template not found." }, { status: 404 });
  }

  deleteClassWorkoutTemplate(id);

  return NextResponse.json({ success: true, message: "Template deleted." }, { status: 200 });
}
