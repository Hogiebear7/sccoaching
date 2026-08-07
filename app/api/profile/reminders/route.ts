import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findProfileByUserId, findUserById, saveProfile } from "@/lib/db";
import { verifyRequestSession } from "@/lib/mobile-auth";

const MAX_TIMING_MINS = 10080; // 7 days

export async function POST(request: NextRequest) {
  const userId = verifyRequestSession(request)?.userId ?? null;

  if (!userId) {
    return NextResponse.json(
      { success: false, message: "You must be signed in." },
      { status: 401 }
    );
  }

  const user = findUserById(userId);
  if (!user) {
    return NextResponse.json(
      { success: false, message: "You must be signed in." },
      { status: 401 }
    );
  }

  const existingProfile = findProfileByUserId(user.id);
  if (!existingProfile) {
    return NextResponse.json(
      { success: false, message: "No profile found for this account." },
      { status: 404 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const { timings } = (body ?? {}) as Record<string, unknown>;

  if (timings === null || timings === undefined || (Array.isArray(timings) && timings.length === 0)) {
    saveProfile({
      ...existingProfile,
      reminderTimingsMins: null,
      updatedAt: new Date().toISOString(),
    });
    return NextResponse.json({ success: true, message: "Reminder preferences saved." });
  }

  if (!Array.isArray(timings)) {
    return NextResponse.json(
      { success: false, message: "timings must be an array of positive integers." },
      { status: 400 }
    );
  }

  const parsed: number[] = [];
  for (const entry of timings) {
    const n = Number(entry);
    if (!Number.isInteger(n) || n <= 0 || n > MAX_TIMING_MINS) {
      return NextResponse.json(
        {
          success: false,
          message: `Each timing must be a positive whole number of minutes up to ${MAX_TIMING_MINS}.`,
        },
        { status: 400 }
      );
    }
    parsed.push(n);
  }

  // Deduplicate and sort descending (longest lead time first)
  const deduped = [...new Set(parsed)].sort((a, b) => b - a);

  saveProfile({
    ...existingProfile,
    reminderTimingsMins: deduped,
    updatedAt: new Date().toISOString(),
  });

  return NextResponse.json({ success: true, message: "Reminder preferences saved." });
}
