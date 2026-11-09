import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { groupMemberView, groupView, requireGroupAccess } from "@/lib/community-groups";
import { hiddenFromViewer } from "@/lib/community-moderation";
import { findGroupById, findGroupMembers, findUserById } from "@/lib/db";
import { verifyRequestSession } from "@/lib/mobile-auth";

// GET /api/mobile/community/groups/[id] — the group and its members. Only members of the group can see it; anyone else (or a closed or missing group)
// gets the same "not found". Members who are blocked either way with the viewer are left out of the list.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = verifyRequestSession(request);
  const me = session ? findUserById(session.userId) : undefined;
  if (!me) return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });
  const gate = requireGroupAccess(me.id);
  if (gate) return gate;

  const { id } = await params;
  const group = findGroupById(id);
  const members = group ? findGroupMembers(group.id) : [];
  if (!group || !members.some((m) => m.userId === me.id)) {
    return NextResponse.json({ success: false, message: "Group not found." }, { status: 404 });
  }

  const hidden = hiddenFromViewer(me.id);
  if (hidden.has(group.organiserId)) {
    return NextResponse.json({ success: false, message: "Group not found." }, { status: 404 });
  }
  return NextResponse.json({
    success: true,
    data: {
      ...groupView(group, me.id),
      members: members.filter((m) => m.userId === me.id || !hidden.has(m.userId)).map((m) => groupMemberView(m.userId, group.organiserId)),
    },
  });
}
