// Informed, revocable consent before a member's data is sent to the AI provider (Apple App Review Guideline 5.1.2(i): disclose where personal data is shared
// with third-party AI and obtain explicit permission first; Google Play expects the same disclosure).
//
// WHAT IS GATED. Every request that carries a member's own data to the provider: the AI coach chat and nutrition coach, food identification from a photo or a
// typed description, meal suggestions, receipt and tracker-screenshot scans, programme generation and check-ins, exercise alternatives, and the written workout
// review. Staff-side AI (coach summary, draft reply) uses a MEMBER's data, so it needs that member's consent too.
// WHERE IT IS ENFORCED. In each route, after the request is authenticated and BEFORE anything is read from the body or passed to lib/ai.ts, so nothing leaves
// for the provider without a current grant. __tests__/lib/ai-consent-guard.test.ts fails if any route that imports lib/ai.ts does not call this module.
// DECLINING. The member can decline: the AI feature then says so and everything else in the app keeps working. WITHDRAWING. Settings turns it off at any time;
// the next request is refused immediately. Content already sent is handled under the provider's own terms (see the privacy policy), and account deletion removes
// everything the app itself stored.
import { NextResponse } from "next/server";

import { findProfileByUserId } from "@/lib/db";
import type { ProfileRecord } from "@/lib/profile-schema";

/** Bump when what is shared, or with whom, changes. An older grant stops counting and the member is asked again. */
export const AI_CONSENT_VERSION = 1;
export const AI_CONSENT_REQUIRED_CODE = "ai_consent_required";
export const AI_CONSENT_MISSING_MEMBER_CODE = "ai_consent_missing_member";

export const AI_CONSENT_REQUIRED_MESSAGE =
  "Turn on AI features to use this. Your text, photos and training data are sent to our AI provider to produce the answer. You can turn it off any time in Settings.";
export const AI_CONSENT_MISSING_MEMBER_MESSAGE = "This member hasn't allowed AI features, so nothing about them can be sent to the AI provider.";

export function hasAiConsentOnProfile(profile: Pick<ProfileRecord, "aiDataConsent"> | undefined | null): boolean {
  const c = profile?.aiDataConsent;
  return !!c && c.version === AI_CONSENT_VERSION && typeof c.grantedAt === "string" && c.grantedAt.length > 0;
}

export function hasAiConsent(userId: string): boolean {
  return hasAiConsentOnProfile(findProfileByUserId(userId));
}

/** Returns a 403 to send back if this member has not granted a current consent, or null if the request may continue. */
export function requireAiConsent(userId: string): NextResponse | null {
  if (hasAiConsent(userId)) return null;
  return NextResponse.json(
    { success: false, code: AI_CONSENT_REQUIRED_CODE, consentVersion: AI_CONSENT_VERSION, message: AI_CONSENT_REQUIRED_MESSAGE },
    { status: 403 }
  );
}

/** Staff-side AI that uses a member's data: the MEMBER's consent is what counts. */
export function requireAiConsentForMember(memberId: string): NextResponse | null {
  if (hasAiConsent(memberId)) return null;
  return NextResponse.json({ success: false, code: AI_CONSENT_MISSING_MEMBER_CODE, message: AI_CONSENT_MISSING_MEMBER_MESSAGE }, { status: 403 });
}
