import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getFinanceSettings, saveFinanceSettings } from "@/lib/db";
import { authorizeStaffRequest } from "@/lib/staff-auth";

// Saves the manually-entered tax-rate estimate shown on the Finances tab.
// This is NOT a filing figure — see lib/finance.ts and docs/finances.md —
// so the only thing this route persists is a plain percentage the
// admin_manager typed in themselves.
export async function POST(request: NextRequest) {
  const auth = authorizeStaffRequest(request, "finance.view");
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const { taxRatePercent } = (body ?? {}) as Record<string, unknown>;

  if (taxRatePercent !== null && (typeof taxRatePercent !== "number" || !Number.isFinite(taxRatePercent))) {
    return NextResponse.json(
      { success: false, message: "taxRatePercent must be a number or null." },
      { status: 400 }
    );
  }
  if (typeof taxRatePercent === "number" && (taxRatePercent < 0 || taxRatePercent > 100)) {
    return NextResponse.json(
      { success: false, message: "taxRatePercent must be between 0 and 100." },
      { status: 400 }
    );
  }

  const next = { ...getFinanceSettings(), taxRatePercent: taxRatePercent as number | null };
  saveFinanceSettings(next);

  return NextResponse.json({ success: true, message: "Saved.", settings: next }, { status: 200 });
}
