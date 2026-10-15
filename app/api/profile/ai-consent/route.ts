import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { AI_CONSENT_VERSION, hasAiConsentOnProfile } from "@/lib/ai-consent";
import { findProfileByUserId, findUserById, saveProfile } from "@/lib/db";
import { verifyRequestSession } from "@/lib/mobile-auth";

// The member's own AI data-sharing consent (web cookie or mobile Bearer). The account comes from the session and nowhere else.
//   GET   -> { granted, version, grantedAt }
//   POST  { granted: true }   grants (stamped with the current wording version and the time)
//   POST  { granted: false }  withdraws; AI requests are refused from the next one on
// Granting or withdrawing touches nothing else on the profile except updatedAt.
function sessionProfile(request: NextRequest) {
  const userId = verifyRequestSession(request)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;
  if (!user) return { error: NextResponse.json({ success: false, message: "You must be signed in." }, { status: 401 }) };
  const profile = findProfileByUserId(user.id);
  if (!profile) return { error: NextResponse.json({ success: false, message: "No profile found for this account." }, { status: 404 }) };
  return { profile };
}

const view = (granted: boolean, grantedAt: string | null) => ({ success: true, data: { granted, version: AI_CONSENT_VERSION, grantedAt } });

export async function GET(request: NextRequest) {
  const r = sessionProfile(request);
  if (r.error) return r.error;
  const granted = hasAiConsentOnProfile(r.profile);
  return NextResponse.json(view(granted, granted ? r.profile.aiDataConsent!.grantedAt : null));
}

export async function POST(request: NextRequest) {
  const r = sessionProfile(request);
  if (r.error) return r.error;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }
  const { granted } = (body ?? {}) as Record<string, unknown>;
  if (typeof granted !== "boolean") {
    return NextResponse.json({ success: false, message: "granted must be true or false." }, { status: 400 });
  }

  const now = new Date().toISOString();
  saveProfile({ ...r.profile, aiDataConsent: granted ? { grantedAt: now, version: AI_CONSENT_VERSION } : null, updatedAt: now });
  return NextResponse.json(view(granted, granted ? now : null));
}
