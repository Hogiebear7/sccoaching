import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findProfileByUserId, findUserById, saveProfile } from "@/lib/db";
import { normalizeDrinkSettings } from "@/lib/drink-settings";
import { verifySession } from "@/lib/session";

// Members sync their own Sports Performance Drink calculator settings here
// (fire-and-forget from the Nutrition tab). Everything is normalized
// field-by-field before it touches the profile, so stored settings are
// always valid regardless of what the client sends.
export async function POST(request: NextRequest) {
  const sessionUserId = verifySession(request.cookies.get("session")?.value)?.userId ?? null;

  if (!sessionUserId) {
    return NextResponse.json(
      { success: false, message: "You must be signed in." },
      { status: 401 }
    );
  }

  const user = findUserById(sessionUserId);

  if (!user) {
    return NextResponse.json(
      { success: false, message: "You must be signed in." },
      { status: 401 }
    );
  }

  const profile = findProfileByUserId(user.id);

  if (!profile) {
    return NextResponse.json(
      { success: false, message: "No profile found for this account." },
      { status: 404 }
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

  if (typeof body !== "object" || body === null) {
    return NextResponse.json(
      { success: false, message: "Drink settings are required." },
      { status: 400 }
    );
  }

  const settings = normalizeDrinkSettings(body);
  const now = new Date().toISOString();

  saveProfile({
    ...profile,
    drinkSettings: settings,
    drinkSettingsUpdatedAt: now,
    updatedAt: now,
  });

  return NextResponse.json({ success: true, settings }, { status: 200 });
}
