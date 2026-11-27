import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findBookingsByClassId, findClassById, findClassSeriesById, findClassesBySeriesId, findUserById, saveClass, saveClassSeries } from "@/lib/db";
import { planSeriesEdit } from "@/lib/class-series-edit";
import { sameGymAsStaff } from "@/lib/gym-scope";
import { verifyRequestSession } from "@/lib/mobile-auth";
import { can } from "@/lib/permissions";
import { issueWaitlistOffer } from "@/lib/scheduling";
import { requireTenantAccess } from "@/lib/tenant-request";

// Changes a repeating class for all of its upcoming sessions. mode "preview" only describes what would
// change; mode "apply" does it. Past sessions are never touched.
export async function POST(request: NextRequest) {
  const userId = verifyRequestSession(request)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;
  if (!user) return NextResponse.json({ success: false, message: "You must be signed in to manage classes." }, { status: 401 });

  const tenantLock = requireTenantAccess(user);
  if (tenantLock) return tenantLock;

  if (!can(user.role, "classes.manage")) return NextResponse.json({ success: false, message: "Only staff can manage classes." }, { status: 403 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }
  const { id, mode, changes } = (body ?? {}) as Record<string, unknown>;
  if (typeof id !== "string" || !id.trim()) return NextResponse.json({ success: false, message: "A repeating class is required." }, { status: 400 });
  if (mode !== "preview" && mode !== "apply") return NextResponse.json({ success: false, message: "Mode must be preview or apply." }, { status: 400 });

  const series = findClassSeriesById(id.trim());
  if (!series || !series.coachUserId || !sameGymAsStaff(user, series.coachUserId)) {
    return NextResponse.json({ success: false, message: "This repeating class no longer exists." }, { status: 404 });
  }
  if (!series.isActive) return NextResponse.json({ success: false, message: "This repeating class has been stopped." }, { status: 409 });

  const plan = planSeriesEdit(series, findClassesBySeriesId(series.id), (classId) => findBookingsByClassId(classId).length, changes, Date.now());
  if (plan.error) return NextResponse.json({ success: false, message: plan.error }, { status: 400 });

  if (mode === "preview") {
    return NextResponse.json({
      success: true,
      data: { lines: plan.lines, willChange: plan.willChange, blocked: plan.blocked, bookedMembers: plan.bookedMembers, sessions: plan.occurrences },
    });
  }

  const nowIso = new Date().toISOString();
  saveClassSeries({ ...series, ...plan.changes, updatedAt: nowIso });

  for (const p of plan.occurrences) {
    if (p.blocked) continue;
    const existing = findClassById(p.classId);
    if (!existing) continue;
    saveClass({ ...existing, ...plan.changes, updatedAt: nowIso });
    if (plan.changes.capacity !== undefined && plan.changes.capacity > existing.capacity) {
      for (let i = 0; i < plan.changes.capacity - existing.capacity; i++) {
        try {
          issueWaitlistOffer(existing.id);
        } catch {
          // An offer failing must not undo the save.
        }
      }
    }
  }

  return NextResponse.json({
    success: true,
    message: `Updated ${plan.willChange} upcoming session${plan.willChange === 1 ? "" : "s"}.`,
    data: { updated: plan.willChange, kept: plan.blocked },
  });
}
