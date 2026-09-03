import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findActiveTrainingProgramByUserId, findUserById } from "@/lib/db";
import { verifyRequestSession } from "@/lib/mobile-auth";
import { resolveTodayTier } from "@/lib/resolve-today-tier";
import { applyTierModifier } from "@/lib/training-programs";

export async function GET(request: NextRequest) {
  const userId = verifyRequestSession(request)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;

  if (!user) {
    return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });
  }

  const program = findActiveTrainingProgramByUserId(user.id) ?? null;

  // Read-time-only trim on a "reduced" readiness day, AI programmes only —
  // never written back (see applyTierModifier's own comment). Staff-
  // assigned programmes are unaffected by this pass.
  if (program && program.source === "ai") {
    const { tier } = resolveTodayTier(user.id);
    const trimmedDays = program.days.map((day, i) => (i === program.currentDayIndex ? applyTierModifier(day, tier) : day));
    return NextResponse.json({ success: true, data: { program: { ...program, days: trimmedDays } } });
  }

  return NextResponse.json({ success: true, data: { program } });
}
