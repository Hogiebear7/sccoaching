import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

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
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  const next = safeNextPath(url.searchParams.get("next"));

  const userId = token ? consumeMobileHandoffToken(token) : undefined;
  if (!userId) {
    return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(next)}`, request.url));
  }

  const response = NextResponse.redirect(new URL(next, request.url));

  response.cookies.set("session", signSession({ userId }), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
  });

  return response;
}
