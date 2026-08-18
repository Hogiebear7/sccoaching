import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findClassWorkoutTemplates, findExercises, findUserById } from "@/lib/db";
import { verifyRequestSession } from "@/lib/mobile-auth";
import { can } from "@/lib/permissions";

export async function GET(request: NextRequest) {
  const sessionUserId = verifyRequestSession(request)?.userId ?? null;
  const staffUser = sessionUserId ? findUserById(sessionUserId) : undefined;

  if (!staffUser) {
    return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });
  }
  if (!can(staffUser.role, "classes.manage")) {
    return NextResponse.json({ success: false, message: "Staff access required." }, { status: 403 });
  }

  // Bundles the exercise library alongside the templates so the mobile
  // template builder's autocomplete doesn't need a second round-trip —
  // mirrors the same bundling on the per-class workout route.
  return NextResponse.json({
    success: true,
    data: {
      templates: findClassWorkoutTemplates(),
      libraryExercises: findExercises(),
    },
  });
}
