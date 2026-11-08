import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { requireGroupAccess } from "@/lib/community-groups";
import { findGroupById, findGroupMembers, findUserById, removeGroupMember } from "@/lib/db";
import { verifyRequestSession } from "@/lib/mobile-auth";

// POST /api/mobile/community/groups/[id]/leave — leave a group I am in. The organiser can't leave (they close the group instead), so a group is never
// left without someone responsible for it.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = verifyRequestSession(request);
  const me = session ? findUserById(session.userId) : undefined;
  if (!me) return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });
  const gate = requireGroupAccess(me.id);
  if (gate) return gate;

  const { id } = await params;
  const group = findGroupById(id);
  if (!group || !findGroupMembers(group.id).some((m) => m.userId === me.id)) {
    return NextResponse.json({ success: false, message: "Group not found." }, { status: 404 });
  }
  if (group.organiserId === me.id) {
    return NextResponse.json({ success: false, message: "You organise this group, so close it instead of leaving." }, { status: 409 });
  }

  removeGroupMember(group.id, me.id);
  return NextResponse.json({ success: true, message: "You left the group." });
}
