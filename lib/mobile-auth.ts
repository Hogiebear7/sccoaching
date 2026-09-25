import type { NextRequest } from "next/server";

import { findUserById } from "./db";
import { verifySession, type SessionPayload } from "./session";

// A validly signed, unexpired token is only good while its account is live:
// tokens are stateless (no server-side store to revoke), so archiving an
// account can't invalidate them directly. Checking the account here — the one
// place every route resolves a request's session — makes deactivation take
// effect on the very next request, and restoring the account makes the same
// token work again (nothing about it was ever changed). A deleted or archived
// account reads exactly like no session, so callers keep their existing
// unauthorized response and nothing reveals which of the two it was.
function activeSession(session: SessionPayload | null): SessionPayload | null {
  if (!session) return null;
  const user = findUserById(session.userId);
  return user && !user.archivedAt ? session : null;
}

// The mobile app carries the exact same signed token web sessions use (see
// lib/session.ts) as a Bearer header instead of a cookie — verifySession is
// pure token verification with no cookie-specific mechanics, so it works
// unchanged for either transport. This just picks the token off whichever
// transport the request used, preferring an explicit Bearer header (mobile)
// and falling back to the session cookie (web) so the same handler could
// serve either client if ever needed. A Bearer token that verifies but whose
// account is archived or gone is NOT retried against the cookie: the request
// is unauthenticated, never silently a different account.
export function verifyRequestSession(request: NextRequest): SessionPayload | null {
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice("Bearer ".length).trim();
    const session = verifySession(token);
    if (session) return activeSession(session);
  }

  return activeSession(verifySession(request.cookies.get("session")?.value));
}
