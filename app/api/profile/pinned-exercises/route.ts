import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findProfileByUserId, findUserById, saveProfile } from "@/lib/db";
import { verifyRequestSession } from "@/lib/mobile-auth";

const MAX_PINNED = 5;
const MAX_NAME_LENGTH = 100;

// Members choose up to 5 exercises to feature on their Personal Bests card
// (mobile Workouts tab). Normalized server-side so a stored list is always
// valid regardless of what the client sends: trimmed, deduped
// case-insensitively (first occurrence wins, preserving pick order), and
// capped at 5.
function normalizePinnedExercises(input: unknown): string[] {
  if (!Array.isArray(input)) return [];

  const seen = new Set<string>();
  const result: string[] = [];

  for (const entry of input) {
    if (typeof entry !== "string") continue;
    const trimmed = entry.trim().slice(0, MAX_NAME_LENGTH);
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
    if (result.length >= MAX_PINNED) break;
  }

  return result;
}

export async function POST(request: NextRequest) {
  const sessionUserId = verifyRequestSession(request)?.userId ?? null;

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
      { success: false, message: "Pinned exercises are required." },
      { status: 400 }
    );
  }

  const pinnedExercises = normalizePinnedExercises((body as { pinnedExercises?: unknown }).pinnedExercises);

  saveProfile({
    ...profile,
    pinnedExercises,
    updatedAt: new Date().toISOString(),
  });

  return NextResponse.json({ success: true, pinnedExercises }, { status: 200 });
}
