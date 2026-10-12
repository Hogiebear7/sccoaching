// Runs once before the visual suite, after the test server (see playwright.config.ts) is up:
//   1. recreate the isolated datastore and seed the demo data into it (scripts/seed.js, targeted with GYM_DB_PATH);
//   2. pin the demo member's billing end date to a fixed day, so nothing on the Membership screen depends on the clock;
//   3. log in ONCE and save the session, so tests reuse it instead of logging in again (the login route allows 5 attempts per email per 15
//      minutes, in memory, and that limit is deliberately left exactly as production has it);
//   4. mark the demo member's first-run walkthrough as seen through the app's own route, so the overlay is not on every screen;
//   5. request each screen once so the dev server has compiled it before any test's timeout starts.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { request } from "@playwright/test";

import { BASE_URL, DATA_DIR, DB_PATH, DEMO, FIXED_PERIOD_END, STATE_PATH } from "./visual-env";

const SCREENS = ["/dashboard", "/dashboard/recovery", "/dashboard/nutrition", "/dashboard/messages", "/dashboard/membership"];

export default async function globalSetup() {
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });

  // The seed writes only the file named by GYM_DB_PATH (see scripts/seed-target.cjs); it is the temporary one.
  execFileSync(process.execPath, [path.join(process.cwd(), "scripts", "seed.js")], {
    env: { ...process.env, GYM_DB_PATH: DB_PATH, DATA_DIR },
    stdio: ["ignore", "ignore", "inherit"],
  });

  const db = JSON.parse(readFileSync(DB_PATH, "utf8"));
  const alex = db.users.find((u: { email: string }) => u.email === DEMO.email);
  if (!alex) throw new Error("demo member missing from the seeded datastore");
  const sub = db.subscriptions.find((s: { userId: string }) => s.userId === alex.id);
  if (!sub) throw new Error("demo member has no seeded membership");
  sub.currentPeriodEnd = FIXED_PERIOD_END;
  writeFileSync(DB_PATH, JSON.stringify(db, null, 2), "utf8");

  const ctx = await request.newContext({ baseURL: BASE_URL });
  const login = await ctx.post("/api/auth/login", { data: DEMO });
  if (!login.ok()) throw new Error(`demo login failed: ${login.status()}`);
  const tour = await ctx.post("/api/profile/tour", { data: { completed: true } });
  if (!tour.ok()) throw new Error(`could not mark the walkthrough as seen: ${tour.status()}`);
  await ctx.storageState({ path: STATE_PATH });

  for (const screen of SCREENS) {
    const res = await ctx.get(screen);
    if (!res.ok()) throw new Error(`warm-up of ${screen} failed: ${res.status()}`);
  }
  await ctx.dispose();
}
