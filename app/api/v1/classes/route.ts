import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { authenticateApiRequest, gymKeyOf } from "@/lib/gym-api-keys";
import { findBookingsByClassId, findClasses } from "@/lib/db";
import { classStartMs } from "@/lib/class-time";

// GET /api/v1/classes: the gym's upcoming classes for the next 14 days, for a tool that needs to know what is on. Authorised by the gym's API key (Authorization: Bearer scp_...); the gym is the key's own.
export async function GET(request: NextRequest) {
  const auth = authenticateApiRequest(request);
  if (!auth.ok) return auth.response;
  const gymKey = gymKeyOf(auth.gym);
  const now = Date.now();
  const until = now + 14 * 86_400_000;
  const classes = findClasses()
    .filter((c) => (c.gymId ?? null) === gymKey)
    .filter((c) => {
      const start = classStartMs(c.date, c.startTime);
      return start >= now && start <= until;
    })
    .sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime))
    .map((c) => ({ id: c.id, title: c.title, date: c.date, startTime: c.startTime, durationMins: c.durationMins, capacity: c.capacity, booked: findBookingsByClassId(c.id).length }));
  return NextResponse.json({ success: true, data: { classes } });
}
