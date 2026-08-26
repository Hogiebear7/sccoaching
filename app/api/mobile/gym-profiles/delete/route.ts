import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { deleteGymProfile, findUserById, getGymProfileById } from "@/lib/db";
import { hasAccess } from "@/lib/member-access";
import { resolveMemberTierForUser } from "@/lib/membership-entitlement";
import { verifyRequestSession } from "@/lib/mobile-auth";

export async function POST(request: NextRequest) {
  const userId = verifyRequestSession(request)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;

  if (!user) {
    return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });
  }

  if (!hasAccess(resolveMemberTierForUser(user.id), "gymProfiles")) {
    return NextResponse.json({ success: false, message: "Gym profiles need App Subscription or above." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const { id } = (body ?? {}) as Record<string, unknown>;

  if (typeof id !== "string" || !id.trim()) {
    return NextResponse.json({ success: false, message: "A gym profile is required." }, { status: 400 });
  }

  if (!getGymProfileById(user.id, id)) {
    return NextResponse.json({ success: false, message: "Gym profile not found." }, { status: 404 });
  }

  deleteGymProfile(user.id, id);

  return NextResponse.json({ success: true, message: "Gym profile deleted." }, { status: 200 });
}
