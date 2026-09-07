import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getConfiguredAppUrl } from "@/lib/app-config";
import { consumeMobileHandoffToken } from "@/lib/db";
import { signSession } from "@/lib/session";

const DEFAULT_NEXT = "/dashboard/membership";

// Only an internal relative path is ever honored — anything else (a
// protocol-relative "//evil.com", a full URL, etc.) falls back to the
// default rather than letting a crafted `next` value redirect the browser
// off this origin right after it's been handed a signed-in session.
function safeNextPath(value: string | null): string {
  if (value && value.startsWith("/") && !value.startsWith("//")) return value;
  return DEFAULT_NEXT;
}

// What the phone's system browser actually navigates to when the mobile app
// hands off to the web (see app/api/mobile/auth/web-handoff/route.ts, which
// mints the token this consumes). A missing/invalid/expired/already-used
// token degrades to the normal login screen — same as if the member had
// just tapped the button with no token at all — rather than erroring out.
export async function GET(request: NextRequest) {
  // Built from APP_URL rather than request.url: behind Hostinger's reverse
  // proxy, request.url reflects the Node process's internal bind address
  // (e.g. 0.0.0.0:3000), not the public domain — same issue already fixed
  // in app/api/auth/logout/route.ts. Falling back to request.url only
  // matters locally (dev has no proxy in front of it).
  const base = getConfiguredAppUrl() || request.url;
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  const next = safeNextPath(url.searchParams.get("next"));

  const userId = token ? consumeMobileHandoffToken(token) : undefined;
  if (!userId) {
    return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(next)}`, base));
  }

  const response = NextResponse.redirect(new URL(next, base));

  response.cookies.set("session", signSession({ userId }), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
  });

  return response;
}
