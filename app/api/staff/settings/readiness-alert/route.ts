import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getReadinessAlertSettings, saveReadinessAlertSettings } from "@/lib/db";
import { authorizeStaffRequest } from "@/lib/staff-auth";

// Saves the coach-alert threshold shown on Staff Operations. When enabled,
// a member logging recovery with a readiness score below the threshold
// notifies every staff user — see the check in app/api/recovery/log/route.ts.
export async function POST(request: NextRequest) {
  const auth = authorizeStaffRequest(request, "operations.view");
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const { enabled, threshold } = (body ?? {}) as Record<string, unknown>;

  if (typeof enabled !== "boolean") {
    return NextResponse.json({ success: false, message: "enabled must be a boolean." }, { status: 400 });
  }
  if (typeof threshold !== "number" || !Number.isFinite(threshold) || threshold < 0 || threshold > 100) {
    return NextResponse.json(
      { success: false, message: "threshold must be a number between 0 and 100." },
      { status: 400 }
    );
  }

  const next = { enabled, threshold: Math.round(threshold) };
  saveReadinessAlertSettings(next);

  return NextResponse.json({ success: true, message: "Saved.", settings: next }, { status: 200 });
}
