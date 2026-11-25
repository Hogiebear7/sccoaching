import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { listOptIns } from "@/lib/comms-optins";
import { resolveStaffTenantRequest } from "@/lib/tenant-request";

// CSV of members who have opted in to news and offers (marketing), for importing into Resend's Audience before a newsletter. Only members of the acting
// manager's own gym (listOptIns scopes with sameGym( on the viewer's gym); never anyone who hasn't opted in, has switched emails off, or whose address
// bounced or complained. ?type=gym or ?type=app gives just that group, ready for the matching Resend segment; no type gives everyone.
const csv = (v: string) => `"${v.replace(/"/g, '""')}"`;

export async function GET(request: NextRequest) {
  const auth = resolveStaffTenantRequest(request, "staffUsers.manage");
  if (!auth.ok) return auth.response;

  // ?count=1: just the numbers, for the count on the Staff users page.
  if (request.nextUrl.searchParams.get("count") === "1") {
    const all = listOptIns(auth.user);
    const gym = all.filter((o) => o.type === "gym").length;
    return NextResponse.json({ success: true, data: { gym, app: all.length - gym, total: all.length } });
  }

  const wanted = request.nextUrl.searchParams.get("type");
  const only = wanted === "gym" || wanted === "app" ? wanted : null;

  const rows: string[] = ["email,first_name,type,consented_at,source"];
  for (const o of listOptIns(auth.user)) {
    if (only && o.type !== only) continue;
    rows.push([csv(o.email), csv(o.firstName), o.type, o.consentedAt ?? "", csv(o.source ?? "")].join(","));
  }

  return new NextResponse(rows.join("\n") + "\n", {
    status: 200,
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${only ? `${only}-members-optins` : "marketing-optins"}.csv"` },
  });
}
