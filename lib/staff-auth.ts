// Server-side authorization helpers for the staff area. Every staff API route
// and page goes through here, so permission enforcement is consistent and can
// never be bypassed by hidden-UI alone.

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { findUserById, type StoredUser } from "./db";
import { verifyRequestSession } from "./mobile-auth";
import { can, type Capability } from "./permissions";
import { verifySession } from "./session";

type Authorized = { ok: true; user: StoredUser };
type Unauthorized = { ok: false; response: NextResponse };

// Guard for API routes. Returns the authenticated staff user when they hold the
// capability, or a ready-to-return 401/403 JSON response otherwise.
//
//   const auth = authorizeStaffRequest(request, "catalog.manage");
//   if (!auth.ok) return auth.response;
//   const { user } = auth;
//
// By default this reads the website's session cookie only. A route the staff APP also calls passes { allowAppToken: true }, which additionally accepts the
// app's Bearer token (the same signed session token, sent as a header; see lib/mobile-auth.ts). It is opt-in per route so that a route is never reachable
// from the app by accident, and an archived account is refused either way.
export function authorizeStaffRequest(
  request: NextRequest,
  capability: Capability,
  options: { allowAppToken?: boolean } = {}
): Authorized | Unauthorized {
  const userId = options.allowAppToken
    ? verifyRequestSession(request)?.userId ?? null
    : verifySession(request.cookies.get("session")?.value)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;

  if (!user) {
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, message: "You must be signed in." },
        { status: 401 }
      ),
    };
  }

  if (user.archivedAt || !can(user.role, capability)) {
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, message: "You don't have permission to do that." },
        { status: 403 }
      ),
    };
  }

  return { ok: true, user };
}

// Guard for staff server-component PAGES. Redirects members to /dashboard and
// staff who lack the capability to the staff landing page (/staff/classes is
// the lowest common surface). Returns the user when allowed.
export async function requireStaffPage(capability: Capability): Promise<StoredUser> {
  const cookieStore = await cookies();
  const userId = verifySession(cookieStore.get("session")?.value)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;

  if (!user || user.archivedAt || !can(user.role, "staff.access")) {
    redirect("/dashboard");
  }
  if (!can(user.role, capability)) {
    redirect("/staff/classes");
  }
  return user;
}
