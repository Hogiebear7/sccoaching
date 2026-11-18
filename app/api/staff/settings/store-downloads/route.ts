import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getFinanceSettings, saveFinanceSettings } from "@/lib/db";
import { authorizeStaffRequest } from "@/lib/staff-auth";

// Saves the Apple and Google download numbers the owner types in for one calendar month (the monthly manager report asks for them: the stores report them in
// App Store Connect and Google Play Console, not to this system). Platform owner only (finance.view). Sending both as null clears the month.
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const MAX_DOWNLOADS = 10_000_000;

function count(value: unknown, field: string): { ok: true; value: number | null } | { ok: false; message: string } {
  if (value === null || value === undefined || value === "") return { ok: true, value: null };
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > MAX_DOWNLOADS) {
    return { ok: false, message: `${field} must be a whole number of downloads, or empty.` };
  }
  return { ok: true, value };
}

export async function POST(request: NextRequest) {
  const auth = authorizeStaffRequest(request, "finance.view");
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }
  const { month, appStore, googlePlay } = (body ?? {}) as Record<string, unknown>;
  if (typeof month !== "string" || !MONTH.test(month)) {
    return NextResponse.json({ success: false, message: "month must look like 2026-10." }, { status: 400 });
  }
  const apple = count(appStore, "Apple downloads");
  if (!apple.ok) return NextResponse.json({ success: false, message: apple.message }, { status: 400 });
  const google = count(googlePlay, "Google downloads");
  if (!google.ok) return NextResponse.json({ success: false, message: google.message }, { status: 400 });

  const current = getFinanceSettings();
  const storeDownloads = { ...(current.storeDownloads ?? {}) };
  if (apple.value === null && google.value === null) delete storeDownloads[month];
  else storeDownloads[month] = { appStore: apple.value, googlePlay: google.value };
  saveFinanceSettings({ ...current, storeDownloads });

  return NextResponse.json({ success: true, message: "Saved.", month, downloads: storeDownloads[month] ?? null }, { status: 200 });
}
