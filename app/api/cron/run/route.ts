import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findUserById } from "@/lib/db";
import { runAllJobs } from "@/lib/jobs/runner";
import { can } from "@/lib/permissions";
import { verifyRequestSession } from "@/lib/mobile-auth";

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
  const userId = verifyRequestSession(request)?.userId ?? null;
  if (!userId) return false;

  const user = findUserById(userId);
  // Housekeeping is an operations action — admin and above (not coach).
  return !!user && !user.archivedAt && can(user.role, "operations.view");
}

// Independent of runAllJobs' own internal deadline (lib/jobs/runner.ts) —
// this is a second, outer backstop so a bug in that internal accounting (or
// anything else on this path that isn't a job at all) still can't leave the
// caller's request hanging past its own timeout with zero response. GitHub
// Actions' curl caps at 180s; this returns well before that either way.
const ROUTE_HARD_DEADLINE_MS = 160_000;

async function runWithHardDeadline(trigger: "cron" | "manual") {
  return Promise.race([
    runAllJobs(trigger).then((outcomes) => ({ timedOut: false as const, outcomes })),
    new Promise<{ timedOut: true }>((resolve) => {
      setTimeout(() => resolve({ timedOut: true }), ROUTE_HARD_DEADLINE_MS);
    }),
  ]);
}

export async function GET(request: NextRequest) {
  if (isAuthorizedCronRequest(request)) {
    const result = await runWithHardDeadline("cron");
    if (result.timedOut) {
      return NextResponse.json(
        {
          success: false,
          trigger: "cron",
          message:
            "Housekeeping run exceeded its hard time limit — it may still be finishing in the background. Check /staff/operations for what actually completed.",
        },
        // Deliberately non-2xx: housekeeping.yml's `$status -ge 300` check
        // is the failure-email alerting for this endpoint. A 200 here would
        // read as a clean success and silently drop that alert on exactly
        // the run that most needs someone to notice.
        { status: 503 }
      );
    }
    return NextResponse.json({ success: true, trigger: "cron", outcomes: result.outcomes }, { status: 200 });
  }

  if (isAuthorizedStaffRequest(request)) {
    const result = await runWithHardDeadline("manual");
    if (result.timedOut) {
      return NextResponse.json(
        {
          success: false,
          trigger: "manual",
          message:
            "Housekeeping run exceeded its hard time limit — it may still be finishing in the background. Check /staff/operations for what actually completed.",
        },
        // Deliberately non-2xx: housekeeping.yml's `$status -ge 300` check
        // is the failure-email alerting for this endpoint. A 200 here would
        // read as a clean success and silently drop that alert on exactly
        // the run that most needs someone to notice.
        { status: 503 }
      );
    }
    return NextResponse.json({ success: true, trigger: "manual", outcomes: result.outcomes }, { status: 200 });
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
