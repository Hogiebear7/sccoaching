import { NextResponse } from "next/server";

import { hasAccess, type MemberFeature } from "@/lib/member-access";
import { resolveMemberAccessForUser } from "@/lib/membership-entitlement";

/** The code every plan gate answers with, so the apps can show one upgrade sheet for all of them. */
export const UPGRADE_REQUIRED_CODE = "upgrade_required";

const MESSAGES: Partial<Record<MemberFeature, string>> = {
  coachMessaging: "Messaging your coach is part of a gym Membership.",
};

/** Null to carry on, or a friendly 403 saying the feature is part of the App subscription (or, for coach messaging, the gym Membership). */
export function requireFeature(userId: string, feature: MemberFeature): NextResponse | null {
  if (hasAccess(resolveMemberAccessForUser(userId), feature)) return null;
  return NextResponse.json(
    { success: false, code: UPGRADE_REQUIRED_CODE, feature, message: MESSAGES[feature] ?? "This is part of the App subscription." },
    { status: 403 }
  );
}

/** For a Free-tier allowance (saved workouts, saved meals): null to carry on, or a 403 that says how many are included. */
export function requireUnderFreeLimit(userId: string, feature: MemberFeature, used: number, limit: number, noun: string): NextResponse | null {
  if (hasAccess(resolveMemberAccessForUser(userId), feature) || used < limit) return null;
  return NextResponse.json(
    { success: false, code: UPGRADE_REQUIRED_CODE, feature, limit, message: `The Free plan includes ${limit} ${noun}. Upgrade to the App subscription for unlimited.` },
    { status: 403 }
  );
}
