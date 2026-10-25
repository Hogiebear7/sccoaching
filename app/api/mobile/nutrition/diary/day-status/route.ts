import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findUserById, setNutritionDayStatus, type NutritionDayStatus } from "@/lib/db";
import { verifyRequestSession } from "@/lib/mobile-auth";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const STATUSES: NutritionDayStatus[] = ["complete", "incomplete"];

// Member marks one of their own diary days complete or incomplete, or clears
// the mark (status null). Self-owned only: the session user is the owner,
// there is no userId in the body. See isCompleteDay in lib/nutrition-target.ts
// for what the mark changes.
export async function POST(request: NextRequest) {
  const userId = verifyRequestSession(request)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;

  if (!user) {
    return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const { date, status } = (body ?? {}) as Record<string, unknown>;

  if (typeof date !== "string" || !ISO_DATE_RE.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    return NextResponse.json({ success: false, message: "date must be a valid YYYY-MM-DD string." }, { status: 400 });
  }
  // A day can't be finished before it starts. One day of slack covers a
  // member whose local date is ahead of the server's UTC date.
  const tomorrowUtc = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  if (date > tomorrowUtc) {
    return NextResponse.json({ success: false, message: "You can't mark a future day." }, { status: 400 });
  }
  if (status !== null && !STATUSES.includes(status as NutritionDayStatus)) {
    return NextResponse.json({ success: false, message: "status must be complete, incomplete or null." }, { status: 400 });
  }

  const record = setNutritionDayStatus(user.id, date, status as NutritionDayStatus | null);

  return NextResponse.json({ success: true, data: { date, status: record?.status ?? null } });
}
