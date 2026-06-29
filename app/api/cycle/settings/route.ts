import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  findCycleSettingsByUserId,
  findProfileByUserId,
  findUserById,
  saveCycleSettings,
  saveProfile,
} from "@/lib/db";
import { verifySession } from "@/lib/session";
import type { CycleRegularity, CycleSettingsRecord } from "@/lib/profile-schema";

const VALID_REGULARITIES: CycleRegularity[] = ["Regular", "Irregular", "Unsure"];

export async function POST(request: NextRequest) {
  const userId = verifySession(request.cookies.get("session")?.value)?.userId ?? null;
  const user = userId ? findUserById(userId) : null;

  if (!user) {
    return NextResponse.json({ success: false, message: "Unauthorized." }, { status: 401 });
  }

  const profile = findProfileByUserId(user.id);

  if (!profile?.cycleTrackingEligible) {
    return NextResponse.json(
      { success: false, message: "Cycle tracking is not available for this account." },
      { status: 403 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const { lastPeriodStartDate, averageCycleLengthDays, periodLengthDays, regularity, privateNotes } =
    (body ?? {}) as Record<string, unknown>;

  const now = new Date().toISOString();
  const existing = findCycleSettingsByUserId(user.id);

  const settings: CycleSettingsRecord = {
    userId: user.id,
    lastPeriodStartDate:
      typeof lastPeriodStartDate === "string" && lastPeriodStartDate.trim()
        ? lastPeriodStartDate.trim()
        : null,
    averageCycleLengthDays:
      typeof averageCycleLengthDays === "string" && averageCycleLengthDays.trim() !== ""
        ? Number(averageCycleLengthDays)
        : typeof averageCycleLengthDays === "number"
        ? averageCycleLengthDays
        : null,
    periodLengthDays:
      typeof periodLengthDays === "string" && periodLengthDays.trim() !== ""
        ? Number(periodLengthDays)
        : typeof periodLengthDays === "number"
        ? periodLengthDays
        : null,
    regularity:
      typeof regularity === "string" && VALID_REGULARITIES.includes(regularity as CycleRegularity)
        ? (regularity as CycleRegularity)
        : null,
    privateNotes:
      typeof privateNotes === "string" && privateNotes.trim() ? privateNotes.trim() : null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  saveCycleSettings(settings);

  if (!profile.cycleTrackingEnabled) {
    saveProfile({ ...profile, cycleTrackingEnabled: true, updatedAt: now });
  }

  return NextResponse.json({ success: true, message: "Cycle settings saved." });
}
