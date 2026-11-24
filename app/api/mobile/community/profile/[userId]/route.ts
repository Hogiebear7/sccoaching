import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { leaderboardModeOf } from "@/lib/community-alias";
import { isGymStaff } from "@/lib/community-gym";
import { communityDisplayName } from "@/lib/community-display-name";
import { isBlockedEitherWay } from "@/lib/community-moderation";
import {
  canSeeProfileDetail,
  followDecision,
  memberSinceMonth,
  profileStats,
  profileVisibilityOf,
  recentActivities,
  whoCanFollowOf,
} from "@/lib/community-profile";
import { isGymMemberOrStaff } from "@/lib/community-profile-access";
import { findCommunityPrivacyByUserId, findProfileByUserId, findUserById, findWorkoutSessionsByUserId, isCommunityEligible, isFollowing } from "@/lib/db";
import { sameGymAsStaff } from "@/lib/gym-scope";
import { verifyRequestSession } from "@/lib/mobile-auth";

// GET /api/mobile/community/profile/[userId] — the card behind a tapped name in Community.
//
// Always returns the name (shown by the person's own real-name setting), whether the viewer follows them or they follow the viewer, and whether the
// viewer may follow. The detail (volume this week / month / year, last activities, member since) comes back only when the person's own
// `profileVisibility` allows this viewer; otherwise `detail` is null and `detailHidden` says so. A different gym, a blocked pair, an archived account
// and a missing person all return the same 404, so the card never reveals who exists.
export async function GET(request: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const session = verifyRequestSession(request);
  if (!session) {
    return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });
  }
  const me = findUserById(session.userId);
  if (!me) {
    return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });
  }

  const { userId } = await params;
  const isSelf = userId === me.id;
  const target = findUserById(userId);
  if (!target || target.archivedAt || !isCommunityEligible(target) || (!isSelf && (!sameGymAsStaff(me, target.id) || isBlockedEitherWay(me.id, target.id)))) {
    return NextResponse.json({ success: false, message: "Member not found." }, { status: 404 });
  }

  const privacy = findCommunityPrivacyByUserId(target.id);
  const alreadyFollowing = isSelf ? false : isFollowing(me.id, target.id);
  const followsYou = isSelf ? false : isFollowing(target.id, me.id);
  const viewerIsGymMember = isGymMemberOrStaff(me);

  // A member who uses an alias or hides from leaderboards keeps their card detail private from everyone but themselves and gym staff, whatever their
  // profile setting says (owner decision 2026-11-24).
  const viewerIsStaff = isGymStaff(me);
  const detailLocked = leaderboardModeOf(privacy) !== "named" && !isSelf && !viewerIsStaff;
  const detailVisible = !detailLocked && (viewerIsStaff || canSeeProfileDetail(profileVisibilityOf(privacy), { isSelf, isFollower: alreadyFollowing, isGymMember: viewerIsGymMember }));
  const follow = followDecision(whoCanFollowOf(privacy), { isSelf, alreadyFollowing, isGymMember: viewerIsGymMember });

  const targetIsStaff = isGymStaff(target);
  const fullName = findProfileByUserId(target.id)?.fullName?.trim() || "Member";
  // Coaches and admins appear by their full name (as in the gym community); members by their own real-name setting.
  const displayName = targetIsStaff ? fullName : communityDisplayName(fullName, privacy);

  let detail: {
    memberSince: string | null;
    stats: ReturnType<typeof profileStats> | null;
    recent: ReturnType<typeof recentActivities>;
  } | null = null;
  if (detailVisible && !targetIsStaff) {
    const sessions = findWorkoutSessionsByUserId(target.id);
    detail = {
      memberSince: memberSinceMonth(target.createdAt),
      stats: profileStats(sessions),
      recent: recentActivities(sessions),
    };
  } else if (detailVisible) {
    detail = { memberSince: memberSinceMonth(target.createdAt), stats: null, recent: [] };
  }

  return NextResponse.json({
    success: true,
    data: {
      userId: target.id,
      displayName,
      isSelf,
      isStaff: targetIsStaff,
      isFollowing: alreadyFollowing,
      followsYou,
      canFollow: follow.allowed && !alreadyFollowing,
      followBlockedReason: follow.allowed ? null : follow.reason,
      detailHidden: !detailVisible,
      // True when the detail is private whatever the viewer does (an alias or hidden member), so the app does not suggest following to see it.
      detailLocked,
      detail,
    },
  });
}
