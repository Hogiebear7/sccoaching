import type { NextRequest } from "next/server";

import { verifySession, type SessionPayload } from "./session";

// The mobile app carries the exact same signed token web sessions use (see
// lib/session.ts) as a Bearer header instead of a cookie — verifySession is
// pure token verification with no cookie-specific mechanics, so it works
// unchanged for either transport. This just picks the token off whichever
// transport the request used, preferring an explicit Bearer header (mobile)
// and falling back to the session cookie (web) so the same handler could
// serve either client if ever needed.
export function verifyRequestSession(request: NextRequest): SessionPayload | null {
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice("Bearer ".length).trim();
    const session = verifySession(token);
    if (session) return session;
  }

  return verifySession(request.cookies.get("session")?.value);
}
