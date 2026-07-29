import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findUserById } from "@/lib/db";
import { runAllJobs } from "@/lib/jobs/runner";
import { can } from "@/lib/permissions";
import { verifySession } from "@/lib/session";

// Two ways to trigger a run:
//   1. An external scheduler (Vercel Cron, GitHub Actions, system cron, a
//      curl command) sends `Authorization: Bearer ${CRON_SECRET}`. This is
//      Vercel's documented convention, but works with any scheduler that
//      can set a header.
//   2. A signed-in staff member triggers it manually from the Staff
//      Operations page (same route, browser session cookie instead).
// There is deliberately no in-process timer anywhere in this app: a
// serverless/typical Next.js hosting model doesn't guarantee a long-lived
// process to host one reliably, and a `setInterval` living in a route
// module would silently multiply across instances or vanish on a cold
// start. See docs/scheduler.md for what's needed to actually schedule this.
function isAuthorizedCronRequest(request: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) return false;

  const authHeader = request.headers.get("authorization");
  return authHeader === `Bearer ${cronSecret}`;
}

function isAuthorizedStaffRequest(request: NextRequest): boolean {
  const userId = verifySession(request.cookies.get("session")?.value)?.userId ?? null;
  if (!userId) return false;

  const user = findUserById(userId);
  // Housekeeping is an operations action — admin and above (not coach).
  return !!user && !user.archivedAt && can(user.role, "operations.view");
}

export async function GET(request: NextRequest) {
  if (isAuthorizedCronRequest(request)) {
    const outcomes = await runAllJobs("cron");
    return NextResponse.json({ success: true, trigger: "cron", outcomes }, { status: 200 });
  }

  if (isAuthorizedStaffRequest(request)) {
    const outcomes = await runAllJobs("manual");
    return NextResponse.json({ success: true, trigger: "manual", outcomes }, { status: 200 });
  }

  return NextResponse.json(
    { success: false, message: "Not authorized to run jobs." },
    { status: 401 }
  );
}

// Some schedulers (and the Staff Operations page's "Run now" button) use
// POST instead — same authorization rules, same behavior.
export async function POST(request: NextRequest) {
  return GET(request);
}
