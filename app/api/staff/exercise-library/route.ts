import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getExerciseLibraryClient } from "@/lib/exercise-library/admin-client";
import { mapExerciseRow } from "@/lib/exercise-library/mappers";
import { authorizeStaffRequest } from "@/lib/staff-auth";

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

// Admin inspect view — every exercise regardless of approval state, unlike
// the member-facing list which only ever returns approved rows. Paginated
// (unlike the old flat limit(500)) so staff can actually reach every row in
// a 1000+ exercise library, not just the first page's worth.
export async function GET(request: NextRequest) {
  const auth = authorizeStaffRequest(request, "exercises.manage");
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim();
  const approvedParam = searchParams.get("approved");
  const bodyPart = searchParams.get("bodyPart")?.trim();
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(searchParams.get("pageSize")) || DEFAULT_PAGE_SIZE));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const client = getExerciseLibraryClient();
  let query = client.from("exercises").select("*", { count: "exact" }).order("name", { ascending: true }).range(from, to);

  if (q) query = query.ilike("name", `%${q}%`);
  if (approvedParam === "true") query = query.eq("approved", true);
  if (approvedParam === "false") query = query.eq("approved", false);
  if (bodyPart) query = query.eq("body_part", bodyPart);

  const { data, error, count } = await query;
  if (error) {
    console.error("[exercise-library] admin list failed:", error);
    return NextResponse.json({ success: false, message: "Could not load exercises." }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    exercises: (data ?? []).map(mapExerciseRow),
    total: count ?? 0,
    page,
    pageSize,
  });
}
