import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findClassCategories, findUserById } from "@/lib/db";
import { sameGym } from "@/lib/gym-scope";
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

  // Scoped to the acting staff member's own gym — this feeds the class
  // CREATE category picker, so it must match exactly what
  // app/api/staff/classes/route.ts will actually accept.
  const categories = findClassCategories()
    .filter((c) => sameGym(staffUser, c))
    .map((c) => ({ slug: c.slug, name: c.name }));

  return NextResponse.json({ success: true, data: categories });
}
