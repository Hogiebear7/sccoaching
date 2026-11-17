import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { effectivePrefs, setTopic } from "@/lib/comms-prefs";
import { findProfileByUserId, findUserById, saveProfile } from "@/lib/db";
import { verifyRequestSession } from "@/lib/mobile-auth";

// GET: the member's optional-email choices. POST { tips?: boolean, marketing?: boolean, source?: string }: change them. Opting in to marketing records when and
// where (proof of consent). Booking, billing and security emails are not affected by these.
function profileFor(request: NextRequest) {
  const userId = verifyRequestSession(request)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;
  return user ? findProfileByUserId(user.id) : undefined;
}

export async function GET(request: NextRequest) {
  const profile = profileFor(request);
  if (!profile) return NextResponse.json({ success: false, message: "You must be signed in." }, { status: 401 });
  const prefs = effectivePrefs(profile.emailPrefs);
  return NextResponse.json({ success: true, data: { tips: prefs.tips, marketing: prefs.marketing } });
}

export async function POST(request: NextRequest) {
  const profile = profileFor(request);
  if (!profile) return NextResponse.json({ success: false, message: "You must be signed in." }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = ((await request.json()) ?? {}) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }
  if ((body.tips !== undefined && typeof body.tips !== "boolean") || (body.marketing !== undefined && typeof body.marketing !== "boolean")) {
    return NextResponse.json({ success: false, message: "tips and marketing must be true or false." }, { status: 400 });
  }
  const source = typeof body.source === "string" && /^[a-z0-9_-]{1,30}$/.test(body.source) ? body.source : "settings";

  let prefs = effectivePrefs(profile.emailPrefs);
  if (typeof body.tips === "boolean") prefs = setTopic(prefs, "tips", body.tips, source);
  if (typeof body.marketing === "boolean") prefs = setTopic(prefs, "marketing", body.marketing, source);
  saveProfile({ ...profile, emailPrefs: prefs, updatedAt: new Date().toISOString() });
  return NextResponse.json({ success: true, data: { tips: prefs.tips, marketing: prefs.marketing } });
}
