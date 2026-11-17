import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { unsubscribe, verifyUnsubscribeToken } from "@/lib/comms-prefs";
import { findProfileByUserId, saveProfile } from "@/lib/db";

// Unsubscribe from optional emails with a signed link, no login. POST does it (this is also the RFC 8058 one-click endpoint mail apps call from the
// List-Unsubscribe header). GET never changes anything: it sends the person to the confirmation page, so a mail scanner opening the link can't unsubscribe anyone.
function apply(token: string | null) {
  const verified = verifyUnsubscribeToken(token);
  if (!verified) return false;
  const profile = findProfileByUserId(verified.userId);
  if (!profile) return false;
  saveProfile({ ...profile, emailPrefs: unsubscribe(profile.emailPrefs, verified.topic), updatedAt: new Date().toISOString() });
  return true;
}

export async function POST(request: NextRequest) {
  let token = request.nextUrl.searchParams.get("t");
  if (!token) {
    try {
      token = String(((await request.json()) as { t?: unknown })?.t ?? "") || null;
    } catch {
      token = null;
    }
  }
  if (!apply(token)) return NextResponse.json({ success: false, message: "This unsubscribe link isn't valid." }, { status: 400 });
  return NextResponse.json({ success: true, message: "You've been unsubscribed." });
}

export async function GET(request: NextRequest) {
  const t = request.nextUrl.searchParams.get("t") ?? "";
  return NextResponse.redirect(new URL(`/unsubscribe?t=${encodeURIComponent(t)}`, request.url));
}
