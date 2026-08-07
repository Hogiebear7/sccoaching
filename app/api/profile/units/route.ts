import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findProfileByUserId, findUserById, saveProfile } from "@/lib/db";
import { verifyRequestSession } from "@/lib/mobile-auth";

export async function POST(request: NextRequest) {
  const userId = verifyRequestSession(request)?.userId ?? null;

  if (!userId) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  const user = findUserById(userId);
  if (!user) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  const existingProfile = findProfileByUserId(user.id);
  if (!existingProfile) {
    return NextResponse.json({ error: "No profile found for this account." }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { preferredUnits } = (body ?? {}) as Record<string, unknown>;

  if (preferredUnits !== "metric" && preferredUnits !== "imperial") {
    return NextResponse.json(
      { error: 'preferredUnits must be "metric" or "imperial".' },
      { status: 400 }
    );
  }

  saveProfile({
    ...existingProfile,
    preferredUnits,
    updatedAt: new Date().toISOString(),
  });

  return NextResponse.json({ success: true });
}
