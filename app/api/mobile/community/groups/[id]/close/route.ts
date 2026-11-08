import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { requireGroupAccess } from "@/lib/community-groups";
import { closeGroup, findGroupById, findUserById } from "@/lib/db";
import { verifyRequestSession } from "@/lib/mobile-auth";

// POST /api/mobile/community/groups/[id]/close — organiser only. Closes the group: it disappears for every member and its invite code stops working.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = verifyRequestSession(request);
  const me = session ? findUserById(session.userId) : undefined;
  if (!me) return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });
  const gate = requireGroupAccess(me.id);
  if (gate) return gate;

  const { id } = await params;
  const group = findGroupById(id);
  if (!group || group.organiserId !== me.id) {
    return NextResponse.json({ success: false, message: "Group not found." }, { status: 404 });
  }

  closeGroup(group.id, new Date().toISOString());
  return NextResponse.json({ success: true, message: "Group closed." });
}
