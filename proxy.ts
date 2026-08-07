import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findUserById } from "@/lib/db";
import { isStaffRole } from "@/lib/permissions";
import { verifySession } from "@/lib/session";

const GUEST_ONLY_PATHS = ["/login", "/signup"];

// Prototype surfaces (see docs/surface-architecture.md) — mock-data-backed,
// never wired to real auth. Fine to reach during local development, but must
// never be publicly reachable once deployed: they render convincing-looking
// member/staff data (including fake revenue figures) with zero login wall.
const BLOCKED_IN_PRODUCTION_PREFIXES = ["/app", "/admin", "/admin-mobile"];

// CORS for the mobile API surface only. These routes are Bearer-token
// authenticated (no cookies), so a wildcard origin carries none of the
// CSRF risk a cookie-authenticated wildcard would — the mobile app (and
// its web-preview target during development) is the only intended caller,
// and a stolen token is the same risk regardless of origin restriction.
function mobileCorsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/api/mobile/")) {
    if (request.method === "OPTIONS") {
      return new NextResponse(null, { status: 204, headers: mobileCorsHeaders() });
    }
    const response = NextResponse.next();
    for (const [key, value] of Object.entries(mobileCorsHeaders())) {
      response.headers.set(key, value);
    }
    return response;
  }

  if (
    process.env.NODE_ENV === "production" &&
    BLOCKED_IN_PRODUCTION_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
  ) {
    return new NextResponse(null, { status: 404 });
  }

  const userId = verifySession(request.cookies.get("session")?.value)?.userId ?? null;
  const hasSession = userId !== null;

  if (pathname.startsWith("/dashboard") && !hasSession) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (pathname.startsWith("/staff")) {
    const user = userId ? findUserById(userId) : undefined;

    if (!user) {
      return NextResponse.redirect(new URL("/login", request.url));
    }

    // Any elevated role may enter the staff area; per-section capability is
    // enforced by the layout, each page (requireStaffPage), and each API route.
    if (user.archivedAt || !isStaffRole(user.role)) {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }
  }

  if (GUEST_ONLY_PATHS.includes(pathname) && hasSession) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  const response = NextResponse.next();

  // Next.js's default full-route cache sets a year-long Cache-Control on
  // statically-rendered pages (anything with no server-side dynamic data —
  // e.g. /signup, /login), assuming the host ties cache invalidation to
  // each deployment the way Vercel's Edge Network does. Hostinger's hosting
  // doesn't: after a redeploy replaced the JS chunk files, the CDN kept
  // serving a cached HTML shell referencing the old (now-deleted) chunk
  // filenames, so every visitor hit a hard hydration failure ("That didn't
  // work"). Forcing no-store here overrides that for every page this proxy
  // runs on (see the broadened matcher below) — /_next/static assets are
  // excluded there since those are content-hashed and safe to cache forever.
  response.headers.set("Cache-Control", "no-store, must-revalidate");
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
