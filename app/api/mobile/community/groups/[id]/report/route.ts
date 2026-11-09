import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { MAX_GYM_REPORT_REASON } from "@/lib/community-gym";
import { findGroupVisibleToMember, requireGroupAccess } from "@/lib/community-groups";
import { createGymReport, findUserById, hasOpenGymReport } from "@/lib/db";
import { verifyRequestSession } from "@/lib/mobile-auth";

// POST /api/mobile/community/groups/[id]/report — { reason } up to 200 characters. A member of the group reports its name or description. The report goes to
// the staff of the organiser's gym (the same queue as gym posts and comments, capability comments.moderate), where closing the group is the action.
// Only a member can report (a stranger or a closed group gets the same "not found" as everywhere else), and an organiser cannot report their own group.
// Everything asynchronous (params, body) is read FIRST, so no datastore read can sit across an await.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const session = verifyRequestSession(request);
  const me = session ? findUserById(session.userId) : undefined;
  if (!me) return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });
  const gate = requireGroupAccess(me.id);
  if (gate) return gate;

  const group = findGroupVisibleToMember(me.id, id);
  if (!group) return NextResponse.json({ success: false, message: "Group not found." }, { status: 404 });
  if (group.organiserId === me.id) {
    return NextResponse.json({ success: false, message: "You organise this group. Edit it or close it instead." }, { status: 400 });
  }

  const raw = (body as { reason?: unknown } | null)?.reason;
  const reason = typeof raw === "string" ? raw.trim() : "";
  if (!reason || reason.length > MAX_GYM_REPORT_REASON) {
    return NextResponse.json({ success: false, message: `Tell us why, in up to ${MAX_GYM_REPORT_REASON} characters.` }, { status: 400 });
  }

  if (!hasOpenGymReport(me.id, "group", group.id)) {
    createGymReport({
      id: randomUUID(),
      gymId: group.gymId ?? null,
      targetType: "group",
      targetId: group.id,
      reporterId: me.id,
      reason,
      status: "open",
      resolvedById: null,
      resolvedAt: null,
      createdAt: new Date().toISOString(),
    });
  }
  return NextResponse.json({ success: true, message: "Thanks. Our team will take a look." }, { status: 201 });
}
