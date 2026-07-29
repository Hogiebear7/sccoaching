import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findBookingById, findUserById, updateBookingAttendance } from "@/lib/db";
import { verifySession } from "@/lib/session";
import { can } from "@/lib/permissions";

export async function POST(request: NextRequest) {
  const sessionUserId = verifySession(request.cookies.get("session")?.value)?.userId ?? null;

  if (!sessionUserId) {
    return NextResponse.json(
      { success: false, message: "You must be signed in to manage attendance." },
      { status: 401 }
    );
  }

  const staffUser = findUserById(sessionUserId);

  if (!staffUser) {
    return NextResponse.json(
      { success: false, message: "You must be signed in to manage attendance." },
      { status: 401 }
    );
  }

  if (!can(staffUser.role, "classes.manage")) {
    return NextResponse.json(
      { success: false, message: "Only staff can manage attendance." },
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

  const { bookingId, attended } = (body ?? {}) as Record<string, unknown>;

  if (typeof bookingId !== "string" || !bookingId.trim()) {
    return NextResponse.json(
      { success: false, message: "A booking is required." },
      { status: 400 }
    );
  }

  if (typeof attended !== "boolean") {
    return NextResponse.json(
      { success: false, message: "Attendance state is required." },
      { status: 400 }
    );
  }

  const booking = findBookingById(bookingId);

  if (!booking) {
    return NextResponse.json(
      { success: false, message: "This booking no longer exists." },
      { status: 404 }
    );
  }

  updateBookingAttendance(bookingId, attended);

  return NextResponse.json(
    { success: true, message: attended ? "Marked attended." : "Marked not attended." },
    { status: 200 }
  );
}
