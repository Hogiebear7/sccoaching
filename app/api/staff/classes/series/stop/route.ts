import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  deleteClass,
  deleteWaitlistEntry,
  findAllWaitlistEntries,
  findBookingsByClassId,
  findClassSeriesById,
  findClassesBySeriesId,
  findUserById,
  saveClassSeries,
} from "@/lib/db";
import { classStartMs } from "@/lib/class-time";
import { sameGymAsStaff } from "@/lib/gym-scope";
import { verifyRequestSession } from "@/lib/mobile-auth";
import { can } from "@/lib/permissions";

// Stops a recurring series: nothing new is generated, and upcoming
// occurrences nobody has booked are removed (their waitlists cleared).
// Occurrences WITH bookings are deliberately kept — cancelling those is a
// member-facing act, so staff do it per class via the delete flow, which
// restores passes and notifies members.
export async function POST(request: NextRequest) {
  const userId = verifyRequestSession(request)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;

  if (!user) {
    return NextResponse.json(
      { success: false, message: "You must be signed in to manage classes." },
      { status: 401 }
    );
  }

  if (!can(user.role, "classes.manage")) {
    return NextResponse.json(
      { success: false, message: "Only staff can manage classes." },
      { status: 403 }
    );
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, message: "Invalid JSON body." },
      { status: 400 }
    );
  }

  const { id } = (body ?? {}) as Record<string, unknown>;

  if (typeof id !== "string" || !id.trim()) {
    return NextResponse.json(
      { success: false, message: "A series is required." },
      { status: 400 }
    );
  }

  const series = findClassSeriesById(id.trim());

  if (!series) {
    return NextResponse.json(
      { success: false, message: "This repeating class no longer exists." },
      { status: 404 }
    );
  }

  // A series with no coachUserId shouldn't exist (it's stamped at
  // creation), but treat that as not-found rather than assume ownership.
  // This must run before any occurrence/waitlist mutation below, so a
  // denied cross-gym request has zero effect.
  if (!series.coachUserId || !sameGymAsStaff(user, series.coachUserId)) {
    return NextResponse.json(
      { success: false, message: "This repeating class no longer exists." },
      { status: 404 }
    );
  }

  if (!series.isActive) {
    return NextResponse.json(
      { success: false, message: "This repeating class is already stopped." },
      { status: 409 }
    );
  }

  const now = new Date();
  const nowIso = now.toISOString();

  saveClassSeries({ ...series, isActive: false, updatedAt: nowIso });

  let removed = 0;
  let keptBooked = 0;

  for (const occurrence of findClassesBySeriesId(series.id)) {
    const startsInFuture = classStartMs(occurrence.date, occurrence.startTime) > now.getTime();
    if (!startsInFuture) continue;

    if (findBookingsByClassId(occurrence.id).length > 0) {
      keptBooked += 1;
      continue;
    }

    for (const entry of findAllWaitlistEntries()) {
      if (entry.classId === occurrence.id) deleteWaitlistEntry(entry.id);
    }
    deleteClass(occurrence.id);
    removed += 1;
  }

  const parts = [`${series.title} stopped repeating.`];
  if (removed > 0) parts.push(`${removed} unbooked upcoming session${removed === 1 ? "" : "s"} removed.`);
  if (keptBooked > 0)
    parts.push(
      `${keptBooked} session${keptBooked === 1 ? " has" : "s have"} bookings and ${keptBooked === 1 ? "was" : "were"} kept — cancel ${keptBooked === 1 ? "it" : "them"} individually to notify members and return passes.`
    );

  return NextResponse.json({ success: true, message: parts.join(" ") }, { status: 200 });
}
