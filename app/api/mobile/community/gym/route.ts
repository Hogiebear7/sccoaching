import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { GYM_PAGE_SIZE, GYM_POSTS_PER_DAY, MAX_GYM_POST, gymCommunityAccess, gymPostView } from "@/lib/community-gym";
import { hiddenFromViewer, violatesCommunityRules } from "@/lib/community-moderation";
import { countGymPostsByAuthorSince, createGymPost, findGymPosts } from "@/lib/db";
import { verifyRequestSession } from "@/lib/mobile-auth";

// GET  /api/mobile/community/gym?before=<ISO createdAt> — your gym's feed, newest first, 30 a page. Gym members (live Membership, 18+ confirmed) and the gym's
//      coaches and admins only. Posts by anyone blocked either way with you are left out.
// POST /api/mobile/community/gym — { body } post to your gym's feed. Text only, up to 1000 characters, 10 a day (a removed post still counts).
export async function GET(request: NextRequest) {
  const access = gymCommunityAccess(verifyRequestSession(request)?.userId);
  if (!access.ok) return access.response;

  const before = new URL(request.url).searchParams.get("before") || undefined;
  const hidden = hiddenFromViewer(access.user.id);
  // Over-fetch a page so a few hidden authors don't leave a short page behind.
  const posts = findGymPosts(access.gymId, GYM_PAGE_SIZE * 2, before)
    .filter((p) => p.authorId === access.user.id || !hidden.has(p.authorId))
    .slice(0, GYM_PAGE_SIZE);

  return NextResponse.json({
    success: true,
    data: {
      posts: posts.map((p) => gymPostView(p, access.user, access.isStaff)),
      nextBefore: posts.length === GYM_PAGE_SIZE ? posts[posts.length - 1].createdAt : null,
    },
  });
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const access = gymCommunityAccess(verifyRequestSession(request)?.userId);
  if (!access.ok) return access.response;

  const raw = (body as { body?: unknown } | null)?.body;
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text || text.length > MAX_GYM_POST) {
    return NextResponse.json({ success: false, message: `Write something up to ${MAX_GYM_POST} characters.` }, { status: 400 });
  }
  if (violatesCommunityRules(text)) {
    return NextResponse.json({ success: false, message: "That wording breaks the Community rules. Please change it." }, { status: 400 });
  }

  const since = new Date(Date.now() - 86_400_000).toISOString();
  if (countGymPostsByAuthorSince(access.user.id, since) >= GYM_POSTS_PER_DAY) {
    return NextResponse.json({ success: false, message: `You can post ${GYM_POSTS_PER_DAY} times a day. Try again tomorrow.` }, { status: 429 });
  }

  const post = {
    id: randomUUID(),
    gymId: access.gymId,
    authorId: access.user.id,
    body: text,
    createdAt: new Date().toISOString(),
    removedAt: null,
    removedById: null,
  };
  createGymPost(post);
  return NextResponse.json({ success: true, data: gymPostView(post, access.user, access.isStaff) }, { status: 201 });
}
