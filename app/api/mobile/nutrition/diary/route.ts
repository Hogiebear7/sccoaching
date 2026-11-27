import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findFoodEntriesByUserId, findNutritionDayStatusesByUserId, findPregnancyStatusByUserId, findProfileByUserId, findUserById } from "@/lib/db";
import { verifyRequestSession } from "@/lib/mobile-auth";
import { MICRO_KEYS, microTotalViews } from "@/lib/micronutrients";
import { REFERENCE_SOURCE, resolveReference } from "@/lib/micronutrient-references";
import { sumDailyTotals, sumExtraTotals, sumMicroTotals } from "@/lib/nutrition-diary";
import { requireTenantAccess } from "@/lib/tenant-request";

// Returns every entry for the requested date plus the summed totals, so the
// client doesn't need to re-derive the math from raw entries.
export async function GET(request: NextRequest) {
  const userId = verifyRequestSession(request)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;

  if (!user) {
    return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });
  }

  const tenantLock = requireTenantAccess(user);
  if (tenantLock) return tenantLock;

  const date = request.nextUrl.searchParams.get("date");
  if (!date) {
    return NextResponse.json({ success: false, message: "date is required." }, { status: 400 });
  }

  const entries = findFoodEntriesByUserId(user.id).filter((e) => e.date === date);
  // The member's own complete/incomplete mark for this day, or null.
  const dayStatus = findNutritionDayStatusesByUserId(user.id).find((s) => s.date === date)?.status ?? null;

  // The EU reference amount for each vitamin and mineral, for THIS member (sex, pregnancy and breastfeeding, menopause, age), so the app can show how far the day's total has got.
  // Nothing is returned for a member under 18. See lib/micronutrient-references.ts for the source and the choices made.
  const profile = findProfileByUserId(user.id);
  const pregnancy = findPregnancyStatusByUserId(user.id);
  const references = MICRO_KEYS.map((key) =>
    resolveReference(key, {
      gender: profile?.gender,
      dateOfBirth: profile?.dateOfBirth,
      isPregnant: pregnancy?.isPregnant === true && !pregnancy.birthDate,
      breastfeeding: pregnancy?.breastfeeding === true && !pregnancy.breastfeedingEndedOn,
      menopauseStage: profile?.menopauseStage ?? null,
    }),
  ).filter((r) => r !== null);

  return NextResponse.json({
    success: true,
    data: { entries, totals: sumDailyTotals(entries), extras: sumExtraTotals(entries), micros: microTotalViews(sumMicroTotals(entries)), references, referenceSource: REFERENCE_SOURCE, dayStatus },
  });
}
