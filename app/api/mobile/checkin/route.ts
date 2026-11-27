import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getConfiguredSessionSecret } from "@/lib/app-config";
import { checkinPeriodOf, chooseCheckin, readAnyCheckinCode, type CheckinCandidate } from "@/lib/class-checkin";
import { findBookingsByUserId, findClassById, findUserById, updateBookingAttendance } from "@/lib/db";
import { gymRecordForUser, selfCheckinModeForUser } from "@/lib/gym-checkin-setting";
import { sameGym } from "@/lib/gym-scope";
import { verifyRequestSession } from "@/lib/mobile-auth";
import { requireTenantAccess } from "@/lib/tenant-request";
import { classData, memberData } from "@/lib/gym-webhook-data";
import { emitUserEvent } from "@/lib/gym-webhooks";

// A member scans their gym's poster code and is checked in to the class they have booked. See lib/class-checkin.ts for the rules.
// The member comes from the session; the code only proves the poster belongs to the member's own gym.
export async function POST(request: NextRequest) {
  const userId = verifyRequestSession(request)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;
  if (!user) return NextResponse.json({ success: false, message: "Sign in to check in." }, { status: 401 });

  const tenantLock = requireTenantAccess(user);
  if (tenantLock) return tenantLock;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const secret = getConfiguredSessionSecret();
  if (!secret) return NextResponse.json({ success: false, message: "Check-in is not available right now." }, { status: 503 });

  // The member's own gym decides whether and how check-in works.
  const mode = selfCheckinModeForUser(user);
  if (mode === "off") {
    return NextResponse.json({ success: false, message: "Your gym has not turned on check-in by scanning. Ask a coach to mark you in.", data: { state: "off" } }, { status: 403 });
  }

  const read = readAnyCheckinCode(secret, (body as Record<string, unknown> | null)?.code, Date.now());
  if (!read) return NextResponse.json({ success: false, message: "That is not a check-in code for a gym. Scan the code at your gym." }, { status: 400 });
  if (!sameGym(user, { gymId: read.gymId })) {
    return NextResponse.json({ success: false, message: "That code belongs to a different gym." }, { status: 403 });
  }
  if (read.kind === "expired") {
    return NextResponse.json({ success: false, message: "That code has run out. Scan the code on the screen again.", data: { state: "expired" } }, { status: 409 });
  }
  // A live code must be the kind the gym uses now: an old code from a different schedule (say a weekly one after the gym went to every minute) is not accepted.
  if (read.kind === "live" && read.period !== checkinPeriodOf(gymRecordForUser(user))) {
    return NextResponse.json({ success: false, message: "Scan the code on the screen at your gym.", data: { state: "wrong_code" } }, { status: 409 });
  }
  if (read.kind !== mode) {
    return NextResponse.json({ success: false, message: mode === "live" ? "Scan the live code on the screen at your gym." : "Scan the poster at your gym.", data: { state: "wrong_code" } }, { status: 409 });
  }

  const candidates: CheckinCandidate[] = [];
  for (const booking of findBookingsByUserId(user.id)) {
    const cls = findClassById(booking.classId);
    if (!cls) continue;
    candidates.push({
      bookingId: booking.id,
      classId: cls.id,
      title: cls.title,
      date: cls.date,
      startTime: cls.startTime,
      durationMins: cls.durationMins,
      attendedAt: booking.attendedAt,
    });
  }

  const outcome = chooseCheckin(candidates, Date.now());
  switch (outcome.kind) {
    case "checked_in":
      updateBookingAttendance(outcome.bookingId, true);
      emitUserEvent(user, "class.checked_in", () => {
        const booking = findBookingsByUserId(user.id).find((b) => b.id === outcome.bookingId);
        return { bookingId: outcome.bookingId, member: memberData(user.id), class: booking ? classData(booking.classId) : { title: outcome.title } };
      });
      return NextResponse.json({ success: true, message: `You are checked in to ${outcome.title}. Enjoy the session.`, data: { state: "checked_in", title: outcome.title } });
    case "already":
      return NextResponse.json({ success: true, message: `You are already checked in to ${outcome.title}.`, data: { state: "already", title: outcome.title } });
    case "too_early":
      return NextResponse.json({ success: false, message: `${outcome.title} starts at ${outcome.startTime}. Check-in opens 30 minutes before.`, data: { state: "too_early" } }, { status: 409 });
    default:
      return NextResponse.json({ success: false, message: outcome.message, data: { state: "none" } }, { status: 409 });
  }
}
