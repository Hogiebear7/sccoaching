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

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

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

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/staff/:path*",
    "/login",
    "/signup",
    "/app/:path*",
    "/admin/:path*",
    "/admin-mobile/:path*",
  ],
};
