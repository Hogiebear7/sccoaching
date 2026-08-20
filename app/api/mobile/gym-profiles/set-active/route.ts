import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findUserById, setActiveGymProfile } from "@/lib/db";
import { verifyRequestSession } from "@/lib/mobile-auth";

// id: null clears the active profile (unfiltered / "show all exercises").
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

  if (id !== null && (typeof id !== "string" || !id.trim())) {
    return NextResponse.json({ success: false, message: "A gym profile id or null is required." }, { status: 400 });
  }

  const ok = setActiveGymProfile(user.id, id);

  if (!ok) {
    return NextResponse.json({ success: false, message: "Gym profile not found." }, { status: 404 });
  }

  return NextResponse.json({ success: true, message: "Active gym profile updated." }, { status: 200 });
}
