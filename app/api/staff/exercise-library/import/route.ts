import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { listAvailablePacks, resolvePackDir, runExerciseImport } from "@/lib/exercise-library/import";
import { authorizeStaffRequest } from "@/lib/staff-auth";

// GET: which packs are available to import from (populates the admin UI's
// pack picker) — never a free-typed filesystem path from the client.
export async function GET(request: NextRequest) {
  const auth = authorizeStaffRequest(request, "exercises.manage");
  if (!auth.ok) return auth.response;

  return NextResponse.json({ success: true, packs: listAvailablePacks() });
}

// POST: trigger a dry-run or real import of the named pack. Synchronous —
// fine for a sample pack (one exercise here), but a full-dataset import
// with thousands of rows would need a background job instead of a request/
// response cycle; see import-data/README.md and the deliverables note.
export async function POST(request: NextRequest) {
  const auth = authorizeStaffRequest(request, "exercises.manage");
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const { pack, mode } = (body ?? {}) as Record<string, unknown>;

  if (typeof pack !== "string" || !pack.trim()) {
    return NextResponse.json({ success: false, message: "A pack name is required." }, { status: 400 });
  }
  if (mode !== "dry_run" && mode !== "import") {
    return NextResponse.json({ success: false, message: 'mode must be "dry_run" or "import".' }, { status: 400 });
  }

  const dir = resolvePackDir(pack);
  if (!dir) {
    return NextResponse.json({ success: false, message: `Pack "${pack}" not found.` }, { status: 404 });
  }

  try {
    const result = await runExerciseImport({ dir, source: pack, mode, triggeredBy: auth.user.id });
    return NextResponse.json({ success: true, result });
  } catch (err) {
    console.error("[exercise-library] import failed:", err);
    return NextResponse.json(
      { success: false, message: err instanceof Error ? err.message : "Import failed." },
      { status: 500 }
    );
  }
}
