import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findProfileByUserId, findUserById, saveProfile } from "@/lib/db";
import { verifySession } from "@/lib/session";

export async function POST(request: NextRequest) {
  const userId = verifySession(request.cookies.get("session")?.value)?.userId ?? null;
  const user = userId ? findUserById(userId) : null;

  if (!user) {
    return NextResponse.json({ success: false, message: "Unauthorized." }, { status: 401 });
  }

  const profile = findProfileByUserId(user.id);

  if (!profile) {
    return NextResponse.json({ success: false, message: "No profile found." }, { status: 404 });
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const { menopauseSupportEnabled } = (body ?? {}) as Record<string, unknown>;

  saveProfile({
    ...profile,
    menopauseSupportEnabled: Boolean(menopauseSupportEnabled),
    updatedAt: new Date().toISOString(),
  });

  return NextResponse.json({ success: true, message: "Preferences saved." });
}
