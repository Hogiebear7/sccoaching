import { randomInt } from "crypto";
import { NextResponse } from "next/server";

import { communityDisplayName } from "@/lib/community-display-name";
import { hiddenFromViewer } from "@/lib/community-moderation";
import { findCommunityPrivacyByUserId, findGroupById, findGroupByInviteCode, findGroupMembers, findProfileByUserId, type GroupRecord } from "@/lib/db";
import { requireFeature } from "@/lib/member-access-response";

// Shared pieces of the Community groups routes (Community plan, 2026-11).

export const ADULT_CONFIRMATION_REQUIRED_CODE = "adult_confirmation_required";
export const MAX_GROUP_NAME = 60;
export const MAX_GROUP_DESCRIPTION = 300;

/**
 * Groups need the App tier (or above, e.g. a bundled gym Membership) AND the member's own confirmation that they are 18 or over. Null to carry on,
 * otherwise the 403 to return. Checked on every call from the live account, never from anything the app says.
 */
export function requireGroupAccess(userId: string): NextResponse | null {
  const upgrade = requireFeature(userId, "communityGroups");
  if (upgrade) return upgrade;
  if (!findCommunityPrivacyByUserId(userId)?.adultConfirmedAt) {
    return NextResponse.json(
      { success: false, code: ADULT_CONFIRMATION_REQUIRED_CODE, message: "Confirm you are 18 or over to use groups." },
      { status: 403 }
    );
  }
  return null;
}

// Easy to read aloud and type: no I/O/0/1 lookalikes.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function newInviteCode(): string {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    let code = "";
    for (let i = 0; i < 8; i += 1) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
    if (!findGroupByInviteCode(code)) return code;
  }
  throw new Error("Could not generate a unique invite code.");
}

/** Normalises what a person typed or pasted (case, spaces, dashes) to the stored form. */
export function normaliseInviteCode(input: string): string {
  return input.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

/**
 * The open group, only if `viewerId` is a member and its organiser is not blocked either way with them. Anyone else (a stranger, a closed or missing group)
 * gets undefined, which every route turns into the same "not found".
 */
export function findGroupVisibleToMember(viewerId: string, groupId: string): GroupRecord | undefined {
  const group = findGroupById(groupId);
  if (!group) return undefined;
  if (!findGroupMembers(group.id).some((m) => m.userId === viewerId)) return undefined;
  if (hiddenFromViewer(viewerId).has(group.organiserId)) return undefined;
  return group;
}

/** The group as its members see it. Only the organiser is shown the invite code. */
export function groupView(group: GroupRecord, viewerId: string) {
  const isOrganiser = group.organiserId === viewerId;
  return {
    id: group.id,
    name: group.name,
    description: group.description,
    isOrganiser,
    memberCount: findGroupMembers(group.id).length,
    ...(isOrganiser ? { inviteCode: group.inviteCode } : {}),
    createdAt: group.createdAt,
  };
}

/** A member as other group members see them: id and display name only, honouring that person's own real-name setting. */
export function groupMemberView(userId: string, organiserId: string) {
  const fullName = findProfileByUserId(userId)?.fullName ?? "Member";
  return {
    userId,
    displayName: communityDisplayName(fullName, findCommunityPrivacyByUserId(userId)),
    isOrganiser: userId === organiserId,
  };
}
