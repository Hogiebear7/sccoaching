import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  findBodyFatLogsByUserId,
  findProfileByUserId,
  findUserById,
  saveBodyFatLog,
  saveProfile,
  type BodyFatLogRecord,
} from "@/lib/db";
import { resolveCurrentBodyFatPct } from "@/lib/body-fat";
import { verifyRequestSession } from "@/lib/mobile-auth";

// Mirrors app/api/profile/body-weight/route.ts exactly, with a 0-100 sanity
// bound in place of body weight's "positive number" check since this is a
// percentage rather than an open-ended measurement.
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: NextRequest) {
  const userId = verifyRequestSession(request)?.userId ?? null;

  if (!userId) {
    return NextResponse.json(
      { success: false, message: "You must be signed in to view body fat history." },
      { status: 401 }
    );
  }

  const logs = [...findBodyFatLogsByUserId(userId)].sort((a, b) => a.date.localeCompare(b.date));

  return NextResponse.json({ success: true, data: logs });
}

export async function POST(request: NextRequest) {
  const userId = verifyRequestSession(request)?.userId ?? null;

  if (!userId) {
    return NextResponse.json(
      { success: false, message: "You must be signed in to log body fat." },
      { status: 401 }
    );
  }

  const user = findUserById(userId);

  if (!user) {
    return NextResponse.json(
      { success: false, message: "You must be signed in to log body fat." },
      { status: 401 }
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

  const { date, bodyFatPct } = (body ?? {}) as Record<string, unknown>;

  if (typeof date !== "string" || !ISO_DATE_RE.test(date)) {
    return NextResponse.json(
      { success: false, message: "Date must be a valid YYYY-MM-DD string." },
      { status: 400 }
    );
  }

  if (typeof bodyFatPct !== "number" || !Number.isFinite(bodyFatPct) || bodyFatPct <= 0 || bodyFatPct > 75) {
    return NextResponse.json(
      { success: false, message: "Body fat must be a percentage between 0 and 75." },
      { status: 400 }
    );
  }

  const now = new Date().toISOString();

  const log: BodyFatLogRecord = {
    id: randomUUID(),
    userId: user.id,
    date,
    bodyFatPct,
    createdAt: now,
  };

  saveBodyFatLog(log);

  // Keep the profile's current body fat % in sync with the latest log
  // entry, same invariant as current weight.
  const profile = findProfileByUserId(user.id);
  if (profile) {
    const synced = resolveCurrentBodyFatPct(profile.bodyFatPct, findBodyFatLogsByUserId(user.id));
    if (synced !== (profile.bodyFatPct ?? null)) {
      saveProfile({ ...profile, bodyFatPct: synced, updatedAt: now });
    }
  }

  return NextResponse.json({ success: true, message: "Body fat logged." }, { status: 201 });
}
