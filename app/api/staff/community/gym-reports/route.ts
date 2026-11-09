import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { gymReportRows } from "@/lib/gym-reports-view";
import { authorizeStaffRequest } from "@/lib/staff-auth";

// GET /api/staff/community/gym-reports?status=open|resolved|dismissed — reports of posts and comments in the staff member's OWN gym's community, and of
// groups whose organiser belongs to that gym (capability comments.moderate). Each carries the reported text (for a group: its name and description), who
// wrote it (for a group: the organiser) and who reported it, so staff can decide without opening anything else.
export async function GET(request: NextRequest) {
  const auth = authorizeStaffRequest(request, "comments.moderate", { allowAppToken: true });
  if (!auth.ok) return auth.response;

  const statusParam = new URL(request.url).searchParams.get("status");
  const status = statusParam === "resolved" || statusParam === "dismissed" ? statusParam : "open";

  return NextResponse.json({ success: true, data: gymReportRows(auth.user.gymId ?? null, status) });
}
