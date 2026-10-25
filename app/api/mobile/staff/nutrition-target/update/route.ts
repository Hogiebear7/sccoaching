import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  findNutritionTargetByUserId,
  findUserById,
  saveNutritionTarget,
  type NutritionTargetMode,
  type NutritionTargetRecord,
} from "@/lib/db";
import { sameGym } from "@/lib/gym-scope";
import { staffCanViewMemberData } from "@/lib/member-tier-wall";
import { verifyRequestSession } from "@/lib/mobile-auth";
import { can } from "@/lib/permissions";
import type { CalorieDistribution } from "@/lib/profile-schema";

function positiveInt(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
}

const MODES: NutritionTargetMode[] = ["auto", "manual", "disabled"];
const DISTRIBUTIONS: CalorieDistribution[] = ["even", "training"];

export async function POST(request: NextRequest) {
  const sessionUserId = verifyRequestSession(request)?.userId ?? null;
  const staffUser = sessionUserId ? findUserById(sessionUserId) : undefined;

  if (!staffUser) {
    return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });
  }
  if (!can(staffUser.role, "nutrition.manage")) {
    return NextResponse.json({ success: false, message: "Staff access required." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const {
    userId,
    mode: rawMode,
    calories,
    proteinG,
    carbsG,
    fatG,
    notes,
    distribution: rawDistribution,
    distributionLocked: rawDistributionLocked,
  } = (body ?? {}) as Record<string, unknown>;

  if (typeof userId !== "string" || !userId.trim()) {
    return NextResponse.json({ success: false, message: "A member must be selected." }, { status: 400 });
  }
  const member = findUserById(userId);
  if (!member || !sameGym(staffUser, member)) {
    return NextResponse.json({ success: false, message: "Member not found." }, { status: 404 });
  }
  if (!staffCanViewMemberData(member.id)) {
    return NextResponse.json(
      { success: false, message: "This member's data isn't available until they hold a Membership-tier subscription." },
      { status: 403 }
    );
  }

  const existing = findNutritionTargetByUserId(member.id);

  // Nutrition targets v2: a coach's default spread and lock. Either field may
  // be sent alone; anything not sent keeps its current value.
  if (rawDistribution !== undefined && rawDistribution !== null && !DISTRIBUTIONS.includes(rawDistribution as CalorieDistribution)) {
    return NextResponse.json({ success: false, message: "distribution must be even, training or null." }, { status: 400 });
  }
  if (rawDistributionLocked !== undefined && typeof rawDistributionLocked !== "boolean") {
    return NextResponse.json({ success: false, message: "distributionLocked must be true or false." }, { status: 400 });
  }
  const distribution =
    rawDistribution !== undefined ? ((rawDistribution as CalorieDistribution | null) ?? null) : (existing?.distribution ?? null);
  const distributionLocked =
    rawDistributionLocked !== undefined ? (rawDistributionLocked as boolean) : (existing?.distributionLocked ?? false);
  if (distributionLocked && distribution === null) {
    return NextResponse.json({ success: false, message: "Choose a distribution before locking it." }, { status: 400 });
  }

  // A distribution-only update (no mode, no numbers) leaves the target's mode
  // and numbers exactly as they were — it must not flip the member to manual.
  const distributionOnly =
    rawMode === undefined &&
    calories === undefined &&
    proteinG === undefined &&
    carbsG === undefined &&
    fatG === undefined &&
    (rawDistribution !== undefined || rawDistributionLocked !== undefined);

  const mode: NutritionTargetMode = distributionOnly
    ? (existing?.mode ?? "auto")
    : typeof rawMode === "string" && MODES.includes(rawMode as NutritionTargetMode)
      ? (rawMode as NutritionTargetMode)
      : "manual"; // back-compat: callers that never send mode are the old manual-only form

  let cals: number | null = null;
  let protein: number | null = null;
  let carbs: number | null = null;
  let fat: number | null = null;

  if (distributionOnly) {
    cals = existing?.calories ?? null;
    protein = existing?.proteinG ?? null;
    carbs = existing?.carbsG ?? null;
    fat = existing?.fatG ?? null;
  } else if (mode === "manual") {
    cals = positiveInt(calories);
    protein = positiveInt(proteinG);
    carbs = positiveInt(carbsG);
    fat = positiveInt(fatG);
    if (cals === null || protein === null || carbs === null || fat === null) {
      return NextResponse.json({ success: false, message: "Calories and macros must be non-negative numbers." }, { status: 400 });
    }
  }

  const now = new Date().toISOString();
  const target: NutritionTargetRecord = {
    id: existing?.id ?? randomUUID(),
    userId: member.id,
    mode,
    calories: cals,
    proteinG: protein,
    carbsG: carbs,
    fatG: fat,
    setByStaffId: distributionOnly ? (existing?.setByStaffId ?? staffUser.id) : staffUser.id,
    notes: distributionOnly ? (existing?.notes ?? null) : typeof notes === "string" && notes.trim() ? notes.trim() : null,
    distribution,
    distributionLocked,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  saveNutritionTarget(target);

  return NextResponse.json({ success: true, message: "Target saved.", data: target }, { status: 200 });
}
