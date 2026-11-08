import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { groupView, normaliseInviteCode, requireGroupAccess } from "@/lib/community-groups";
import { isBlockedEitherWay } from "@/lib/community-moderation";
import { MAX_MEMBERS_PER_GROUP, addGroupMemberIfRoom, findGroupByInviteCode, findUserById } from "@/lib/db";
import { sameGym } from "@/lib/gym-scope";
import { verifyRequestSession } from "@/lib/mobile-auth";

// POST /api/mobile/community/groups/join — { code }
// Groups are joined only with the invite code (or the link carrying it), never found by search. A wrong code, a closed group, a group in another gym,
// and a group whose organiser is blocked either way with you all give the same "not found" answer, so nothing can be probed. Needs the App tier and the
// 18+ confirmation. Joining a group you are already in succeeds quietly.
export async function POST(request: NextRequest) {
  const session = verifyRequestSession(request);
  const me = session ? findUserById(session.userId) : undefined;
  if (!me) return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });
  const gate = requireGroupAccess(me.id);
  if (gate) return gate;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }
  const raw = (body as { code?: unknown } | null)?.code;
  const code = typeof raw === "string" ? normaliseInviteCode(raw) : "";
  const group = code ? findGroupByInviteCode(code) : undefined;
  const organiser = group ? findUserById(group.organiserId) : undefined;

  if (!group || !organiser || organiser.archivedAt || !sameGym(me, organiser) || isBlockedEitherWay(me.id, organiser.id)) {
    return NextResponse.json({ success: false, message: "That invite code doesn't match a group." }, { status: 404 });
  }

  const added = addGroupMemberIfRoom(group.id, me.id, new Date().toISOString());
  if (!added.ok) {
    return NextResponse.json(
      added.reason === "full"
        ? { success: false, message: `That group is full (${MAX_MEMBERS_PER_GROUP} members).` }
        : { success: false, message: "That invite code doesn't match a group." },
      { status: added.reason === "full" ? 409 : 404 }
    );
  }

  return NextResponse.json({ success: true, data: groupView(group, me.id) });
}
