import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findGymById, findGymBySlug, findUserById, saveGym } from "@/lib/db";
import { verifyRequestSession } from "@/lib/mobile-auth";
import { can } from "@/lib/permissions";
import { PRIMARY_GYM_SLUG } from "@/lib/primary-gym";

// Backend foundation only — no provider-facing UI reaches this route yet.
// A gym can only ever toggle ITS OWN acceptingNewEnquiries flag: "my gym" is
// resolved entirely from the caller's own identity (their stored gymId),
// never from a client-supplied id, so there is no target-gym parameter for
// a caller to manipulate.
//
// gymId null/undefined means "the primary gym" (S&C) — every pre-existing
// account reads that way, since only one thing in this codebase creates a
// gym-scoped staff account (app/api/gyms/signup/route.ts), and it always
// stamps a real gymId on the owner it creates via setUserGymId(). An
// admin-tier account that still has a null gymId when it reaches this route
// can therefore only be S&C's own staff today — see the accompanying plan
// for the exhaustive check. That said, this is a convention the rest of the
// codebase upholds, not something this route can independently re-verify,
// so the fallback is deliberately narrowed below to resolve to nothing but
// the one named primary gym, rather than "whatever gym happens to match."
export async function POST(request: NextRequest) {
  const sessionUserId = verifyRequestSession(request)?.userId ?? null;
  if (!sessionUserId) {
    return NextResponse.json({ success: false, message: "You must be signed in." }, { status: 401 });
  }

  const user = findUserById(sessionUserId);
  if (!user) {
    return NextResponse.json({ success: false, message: "You must be signed in." }, { status: 401 });
  }

  if (!can(user.role, "gym.manageAvailability")) {
    return NextResponse.json(
      { success: false, message: "You don't have access to manage a gym's availability." },
      { status: 403 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const { acceptingNewEnquiries } = (body ?? {}) as Record<string, unknown>;
  if (typeof acceptingNewEnquiries !== "boolean") {
    return NextResponse.json(
      { success: false, message: "acceptingNewEnquiries must be true or false." },
      { status: 400 }
    );
  }

  const gym = user.gymId ? findGymById(user.gymId) : findGymBySlug(PRIMARY_GYM_SLUG);
  if (!gym) {
    return NextResponse.json({ success: false, message: "No gym found for this account." }, { status: 404 });
  }

  // Explicit, independent of the capability check above: the null-gymId
  // fallback may only ever resolve to the one named primary gym slug, never
  // "whatever findGymBySlug happened to return." Fails closed rather than
  // trusting the resolution above alone.
  if (user.gymId == null && gym.slug !== PRIMARY_GYM_SLUG) {
    return NextResponse.json({ success: false, message: "No gym found for this account." }, { status: 403 });
  }

  saveGym({ ...gym, acceptingNewEnquiries, updatedAt: new Date().toISOString() });

  return NextResponse.json({
    success: true,
    message: acceptingNewEnquiries ? "Your gym is now visible in search." : "Your gym is now hidden from search.",
    data: { acceptingNewEnquiries },
  });
}
