import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findUserById } from "@/lib/db";
import { isStaffRole } from "@/lib/permissions";
import { verifySession } from "@/lib/session";

const GUEST_ONLY_PATHS = ["/login", "/signup"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
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
  matcher: ["/dashboard/:path*", "/staff/:path*", "/login", "/signup"],
};
