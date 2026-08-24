import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findPregnancyStatusByUserId, findProfileByUserId, findUserById } from "@/lib/db";
import { estimatePregnancy } from "@/lib/pregnancy";
import { verifyRequestSession } from "@/lib/mobile-auth";

// Read-only aggregation for the mobile Cycle Tracking screen's pregnancy
// section — same eligibility gate as cycle tracking (cycleTrackingEligible,
// set from gender at signup) since it's the same private reproductive-
// health surface, not a separate feature with its own gate. Writes go
// through /api/pregnancy/status.
export async function GET(request: NextRequest) {
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

  const status = findPregnancyStatusByUserId(user.id) ?? null;
  const estimate = estimatePregnancy(status?.isPregnant ?? false, status?.dueDate ?? null);

  return NextResponse.json({
    success: true,
    data: {
      isPregnant: status?.isPregnant ?? false,
      shareWithCoach: status?.shareWithCoach ?? false,
      estimate,
    },
  });
}
