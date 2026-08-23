import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { deleteExercise, findExercises, findUserById } from "@/lib/db";
import { verifyRequestSession } from "@/lib/mobile-auth";
import { can } from "@/lib/permissions";

const MAX_IDS_PER_REQUEST = 200;

// Bulk-audit companion to delete/route.ts's single-id version — the same
// operation, just for the "keep a handful, prune the rest" workflow where
// clicking Delete 70 times individually isn't reasonable.
export async function POST(request: NextRequest) {
  const sessionUserId = verifyRequestSession(request)?.userId ?? null;

  if (!sessionUserId) {
    return NextResponse.json({ success: false, message: "You must be signed in to manage exercises." }, { status: 401 });
  }

  const staffUser = findUserById(sessionUserId);
  if (!staffUser || !can(staffUser.role, "exercises.manage")) {
    return NextResponse.json({ success: false, message: "Only staff can manage exercises." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const { ids } = (body ?? {}) as Record<string, unknown>;
  if (!Array.isArray(ids) || ids.length === 0 || !ids.every((id) => typeof id === "string")) {
    return NextResponse.json({ success: false, message: "ids must be a non-empty array of strings." }, { status: 400 });
  }
  if (ids.length > MAX_IDS_PER_REQUEST) {
    return NextResponse.json({ success: false, message: `Delete at most ${MAX_IDS_PER_REQUEST} at a time.` }, { status: 400 });
  }

  const existingIds = new Set(findExercises().map((e) => e.id));
  const toDelete = (ids as string[]).filter((id) => existingIds.has(id));

  for (const id of toDelete) {
    deleteExercise(id);
  }

  return NextResponse.json({ success: true, deletedCount: toDelete.length });
}
