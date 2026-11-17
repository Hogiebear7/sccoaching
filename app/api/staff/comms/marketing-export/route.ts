import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { effectivePrefs } from "@/lib/comms-prefs";
import { findMembers, findProfileByUserId, isEmailSuppressed } from "@/lib/db";
import { sameGym } from "@/lib/gym-scope";
import { resolveMemberAccessForUser } from "@/lib/membership-entitlement";
import { authorizeStaffRequest } from "@/lib/staff-auth";

// CSV of members who have opted in to news and offers (marketing), for importing into Resend's Audience before a newsletter. Only members of the acting
// manager's own gym; never anyone who hasn't opted in, has switched emails off, or whose address bounced or complained. The "type" column is gym or app
// so a newsletter can be sent to the right group (a gym member shouldn't get app-subscription promotions).
const csv = (v: string) => `"${v.replace(/"/g, '""')}"`;

export async function GET(request: NextRequest) {
  const auth = authorizeStaffRequest(request, "staffUsers.manage");
  if (!auth.ok) return auth.response;

  const rows: string[] = ["email,first_name,type,consented_at,source"];
  for (const user of findMembers()) {
    if (user.archivedAt || !sameGym(auth.user, user)) continue;
    const profile = findProfileByUserId(user.id);
    if (!profile?.email || profile.emailNotificationsEnabled === false) continue;
    const prefs = effectivePrefs(profile.emailPrefs);
    if (!prefs.marketing || isEmailSuppressed(profile.email)) continue;
    const type = resolveMemberAccessForUser(user.id).gymMembership ? "gym" : "app";
    const first = (profile.fullName || "").trim().split(/\s+/)[0] ?? "";
    rows.push([csv(profile.email), csv(first), type, prefs.marketingConsentAt ?? "", csv(prefs.marketingConsentSource ?? "")].join(","));
  }

  return new NextResponse(rows.join("\n") + "\n", {
    status: 200,
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="marketing-optins.csv"' },
  });
}
