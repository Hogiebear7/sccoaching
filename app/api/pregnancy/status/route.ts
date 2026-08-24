import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findPregnancyStatusByUserId, findProfileByUserId, findUserById, savePregnancyStatus } from "@/lib/db";
import { computeDueDate, estimatePregnancy, COACH_SHARE_UNLOCK_WEEKS } from "@/lib/pregnancy";
import { verifyRequestSession } from "@/lib/mobile-auth";
import type { PregnancyStatusRecord } from "@/lib/profile-schema";

// Same eligibility gate as cycle tracking (private reproductive-health data).
// shareWithCoach is re-validated server-side against the record actually
// being saved, not trusted from the client — a member can't unlock sharing
// early by sending shareWithCoach:true before 12 weeks, and unsetting
// isPregnant always clears it too.
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

  const { isPregnant, weeksAlong, shareWithCoach } = (body ?? {}) as Record<string, unknown>;

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

  const estimate = estimatePregnancy(isPregnant, dueDate, today);
  const eligibleToShare = isPregnant && (estimate.weeksPregnant ?? 0) >= COACH_SHARE_UNLOCK_WEEKS;

  const record: PregnancyStatusRecord = {
    userId: user.id,
    isPregnant,
    dueDate,
    shareWithCoach: eligibleToShare && shareWithCoach === true,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  savePregnancyStatus(record);

  return NextResponse.json({ success: true, data: { isPregnant: record.isPregnant, shareWithCoach: record.shareWithCoach, estimate } });
}
