// Who has opted in to news and offers (marketing), split into gym members and app members. One definition used by the download, the count on the Staff users
// page and the newsletter reminder, so they can never disagree. Only the viewer's own gym; never anyone who hasn't opted in, has switched emails off, or whose
// address bounced or complained.
import { effectivePrefs } from "@/lib/comms-prefs";
import { findMembers, findProfileByUserId, isEmailSuppressed } from "@/lib/db";
import { sameGym } from "@/lib/gym-scope";
import { resolveMemberAccessForUser } from "@/lib/membership-entitlement";

export interface OptIn {
  email: string;
  firstName: string;
  type: "gym" | "app";
  consentedAt: string | null;
  source: string | null;
}

export function listOptIns(viewer: { gymId?: string | null }): OptIn[] {
  const out: OptIn[] = [];
  for (const user of findMembers()) {
    if (user.archivedAt || !sameGym(viewer, user)) continue;
    const profile = findProfileByUserId(user.id);
    if (!profile?.email || profile.emailNotificationsEnabled === false) continue;
    const prefs = effectivePrefs(profile.emailPrefs);
    if (!prefs.marketing || isEmailSuppressed(profile.email)) continue;
    out.push({
      email: profile.email,
      firstName: (profile.fullName || "").trim().split(/\s+/)[0] ?? "",
      type: resolveMemberAccessForUser(user.id).gymMembership ? "gym" : "app",
      consentedAt: prefs.marketingConsentAt,
      source: prefs.marketingConsentSource,
    });
  }
  return out;
}
