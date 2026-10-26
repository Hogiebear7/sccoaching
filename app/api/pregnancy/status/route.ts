import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  createNotification,
  findPregnancyStatusByUserId,
  findProfileByUserId,
  findUserById,
  savePregnancyStatus,
} from "@/lib/db";
import { computeDueDate, estimatePregnancy } from "@/lib/pregnancy";
import { pregnancyStartISO } from "@/lib/pregnancy-nutrition";
import { defaultPaceForGoal } from "@/lib/nutrition-target";
import { verifyRequestSession } from "@/lib/mobile-auth";
import type { PregnancyStatusRecord } from "@/lib/profile-schema";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// Same eligibility gate as cycle tracking (private reproductive-health data).
// The member can share with their coach at any point in the pregnancy;
// unsetting isPregnant always clears sharing and the after-birth fields.
//
// Body: { isPregnant, weeksAlong?, shareWithCoach?, birthDate?, breastfeeding? }
// - birthDate ("Baby has arrived") must be today or earlier and after the
//   start of the pregnancy.
// - breastfeeding false after true records today as the day it stopped.
export async function POST(request: NextRequest) {
  const userId = verifyRequestSession(request)?.userId ?? null;
  const user = userId ? findUserById(userId) : null;

  if (!user) {
    return NextResponse.json({ success: false, message: "Unauthorized." }, { status: 401 });
  }

  const profile = findProfileByUserId(user.id);

  if (!profile?.cycleTrackingEligible) {
    return NextResponse.json(
      { success: false, message: "Pregnancy tracking is not available for this account." },
      { status: 403 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const { isPregnant, weeksAlong, shareWithCoach, birthDate, breastfeeding } = (body ?? {}) as Record<string, unknown>;

  if (typeof isPregnant !== "boolean") {
    return NextResponse.json({ success: false, message: "isPregnant is required." }, { status: 400 });
  }

  const now = new Date().toISOString();
  const existing = findPregnancyStatusByUserId(user.id);
  const today = now.slice(0, 10);

  let dueDate: string | null = existing?.dueDate ?? null;
  if (!isPregnant) {
    dueDate = null;
  } else if (typeof weeksAlong === "number" && Number.isFinite(weeksAlong) && weeksAlong >= 0 && weeksAlong <= 45) {
    // A fresh "how far along" entry always recomputes the due date from
    // today, rather than trying to reconcile it with any previous entry —
    // simplest and matches how a member would actually correct this.
    dueDate = computeDueDate(weeksAlong, today);
  } else if (!dueDate) {
    return NextResponse.json({ success: false, message: "weeksAlong is required to start tracking." }, { status: 400 });
  }

  let nextBirthDate: string | null = isPregnant ? existing?.birthDate ?? null : null;
  if (isPregnant && birthDate !== undefined) {
    if (birthDate === null) {
      nextBirthDate = null;
    } else if (
      typeof birthDate !== "string" ||
      !ISO_DATE.test(birthDate) ||
      birthDate > today ||
      (dueDate !== null && birthDate <= pregnancyStartISO(dueDate))
    ) {
      return NextResponse.json({ success: false, message: "Enter your baby's birth date (today or earlier)." }, { status: 400 });
    } else {
      nextBirthDate = birthDate;
    }
  }

  let nextBreastfeeding: boolean | null = isPregnant ? existing?.breastfeeding ?? null : null;
  let breastfeedingEndedOn: string | null = isPregnant ? existing?.breastfeedingEndedOn ?? null : null;
  if (isPregnant && typeof breastfeeding === "boolean") {
    if (breastfeeding) breastfeedingEndedOn = null;
    else if (existing?.breastfeeding === true) breastfeedingEndedOn = today;
    nextBreastfeeding = breastfeeding;
  }

  const record: PregnancyStatusRecord = {
    userId: user.id,
    isPregnant,
    dueDate,
    birthDate: nextBirthDate,
    breastfeeding: nextBreastfeeding,
    breastfeedingEndedOn,
    shareWithCoach: isPregnant && shareWithCoach === true,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  savePregnancyStatus(record);

  // Starting pregnancy tracking with a weight-loss or gain goal pauses that
  // goal (see lib/pregnancy-nutrition.ts) — say so, here and in the inbox,
  // rather than leaving it to "Why this number?".
  const pace = profile.goalPacePctPerWeek ?? defaultPaceForGoal(profile.primaryGoal);
  const goalPaused = isPregnant && existing?.isPregnant !== true && pace !== 0;
  if (goalPaused) {
    createNotification({
      id: randomUUID(),
      userId: user.id,
      type: "nutrition_update",
      title: "Your weight goal is paused",
      body: `Your ${pace < 0 ? "weight-loss" : "weight-gain"} goal is paused while you're pregnant. Your calorie target is now set to maintain your weight, with extra calories added as your pregnancy goes on.`,
      readAt: null,
      linkHref: "/dashboard/nutrition",
      dedupeKey: null,
      createdAt: now,
    });
  }

  const estimate = estimatePregnancy(isPregnant, dueDate, today, record);

  return NextResponse.json({
    success: true,
    data: {
      isPregnant: record.isPregnant,
      shareWithCoach: record.shareWithCoach,
      birthDate: record.birthDate,
      breastfeeding: record.breastfeeding,
      goalPaused,
      estimate,
    },
  });
}
