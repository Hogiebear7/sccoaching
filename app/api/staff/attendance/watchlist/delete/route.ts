import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { deleteWatchlistEntry, findAttendanceWatchlist, findUserById } from "@/lib/db";
import { sameGymAsStaff } from "@/lib/gym-scope";
import { verifyRequestSession } from "@/lib/mobile-auth";
import { can } from "@/lib/permissions";

export async function POST(request: NextRequest) {
  const sessionUserId = verifyRequestSession(request)?.userId ?? null;

  if (!sessionUserId) {
    return NextResponse.json(
      { success: false, message: "You must be signed in to manage the watchlist." },
      { status: 401 }
    );
  }

  const staffUser = findUserById(sessionUserId);

  if (!staffUser || !can(staffUser.role, "classes.manage")) {
    return NextResponse.json(
      { success: false, message: "Only staff can manage the watchlist." },
      { status: 403 }
    );
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const { id } = (body ?? {}) as Record<string, unknown>;

  if (typeof id !== "string" || !id.trim()) {
    return NextResponse.json({ success: false, message: "A watchlist entry is required." }, { status: 400 });
  }

  // Ownership: entry -> member -> gym. An entry whose member can't be resolved
  // fails closed, and a cross-gym entry gets the same not-found response as a
  // missing one, before the delete.
  const entry = findAttendanceWatchlist().find((e) => e.id === id);

  if (!entry || !sameGymAsStaff(staffUser, entry.userId)) {
    return NextResponse.json({ success: false, message: "This watchlist entry no longer exists." }, { status: 404 });
  }

  deleteWatchlistEntry(id);

  return NextResponse.json({ success: true, message: "Removed from the watchlist." }, { status: 200 });
}
