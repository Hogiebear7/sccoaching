import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { requireGroupAccess } from "@/lib/community-groups";
import { findGroupById, findGroupMembers, findUserById, removeGroupMember } from "@/lib/db";
import { verifyRequestSession } from "@/lib/mobile-auth";

// POST /api/mobile/community/groups/[id]/remove-member — { userId }  Organiser only. Removes someone from the group; they can rejoin only with the code.
// A non-organiser gets the same "not found" as a missing group, so non-members learn nothing. Everything asynchronous (params, body) is read FIRST, so
// the checks and the write below run back to back with nothing awaited in between (see scripts/audit-await-gaps.cjs).
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

  const group = findGroupById(id);
  if (!group || group.organiserId !== me.id) {
    return NextResponse.json({ success: false, message: "Group not found." }, { status: 404 });
  }

  const userId = (body as { userId?: unknown } | null)?.userId;
  if (typeof userId !== "string" || !userId.trim()) {
    return NextResponse.json({ success: false, message: "userId is required." }, { status: 400 });
  }
  if (userId === me.id) {
    return NextResponse.json({ success: false, message: "You organise this group, so close it instead." }, { status: 400 });
  }
  if (!findGroupMembers(group.id).some((m) => m.userId === userId)) {
    return NextResponse.json({ success: false, message: "That member isn't in this group." }, { status: 404 });
  }

  removeGroupMember(group.id, userId);
  return NextResponse.json({ success: true, message: "Removed from the group." });
}
