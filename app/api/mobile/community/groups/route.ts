import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { MAX_GROUP_DESCRIPTION, MAX_GROUP_NAME, groupView, newInviteCode, requireGroupAccess } from "@/lib/community-groups";
import { hiddenFromViewer, violatesCommunityRules } from "@/lib/community-moderation";
import { MAX_GROUPS_PER_ORGANISER, createGroupIfUnderLimit, findOpenGroupsForUser, findUserById } from "@/lib/db";
import { verifyRequestSession } from "@/lib/mobile-auth";

// GET  /api/mobile/community/groups — the groups I am in.
// POST /api/mobile/community/groups — { name, description? } create one (I become its organiser). Up to MAX_GROUPS_PER_ORGANISER open groups each.
// Both need the App tier and the 18+ confirmation (requireGroupAccess), checked live on every call.
export async function GET(request: NextRequest) {
  const session = verifyRequestSession(request);
  const me = session ? findUserById(session.userId) : undefined;
  if (!me) return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });
  const blocked = requireGroupAccess(me.id);
  if (blocked) return blocked;

  // A group whose organiser is blocked either way with me is hidden, like any other content from them.
  const hidden = hiddenFromViewer(me.id);
  return NextResponse.json({
    success: true,
    data: findOpenGroupsForUser(me.id)
      .filter((g) => !hidden.has(g.organiserId))
      .map((g) => groupView(g, me.id)),
  });
}

export async function POST(request: NextRequest) {
  const session = verifyRequestSession(request);
  const me = session ? findUserById(session.userId) : undefined;
  if (!me) return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });
  const blocked = requireGroupAccess(me.id);
  if (blocked) return blocked;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }
  const { name, description } = (body ?? {}) as Record<string, unknown>;
  const cleanName = typeof name === "string" ? name.trim() : "";
  const cleanDescription = typeof description === "string" ? description.trim() : "";
  if (!cleanName || cleanName.length > MAX_GROUP_NAME) {
    return NextResponse.json({ success: false, message: `Give your group a name of up to ${MAX_GROUP_NAME} characters.` }, { status: 400 });
  }
  if (cleanDescription.length > MAX_GROUP_DESCRIPTION) {
    return NextResponse.json({ success: false, message: `The description can be up to ${MAX_GROUP_DESCRIPTION} characters.` }, { status: 400 });
  }
  if (violatesCommunityRules(cleanName) || violatesCommunityRules(cleanDescription)) {
    return NextResponse.json({ success: false, message: "That wording breaks the Community rules. Please change it." }, { status: 400 });
  }

  const now = new Date().toISOString();
  const group = {
    id: randomUUID(),
    name: cleanName,
    description: cleanDescription,
    organiserId: me.id,
    gymId: me.gymId ?? null,
    inviteCode: newInviteCode(),
    createdAt: now,
    closedAt: null,
  };
  const created = createGroupIfUnderLimit(group);
  if (!created.ok) {
    return NextResponse.json(
      { success: false, message: `You can organise up to ${MAX_GROUPS_PER_ORGANISER} groups. Close one to create another.` },
      { status: 409 }
    );
  }

  return NextResponse.json({ success: true, data: groupView(group, me.id) }, { status: 201 });
}
