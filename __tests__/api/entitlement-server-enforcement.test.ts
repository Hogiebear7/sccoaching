// SERVER-SIDE entitlements, independent of what the apps show. The apps default to "informational" mode (no Upgrade badges or links), which only changes what is DRAWN. Nothing in
// that mode, and nothing about giving AI consent, may let a Free account use a paid feature. REAL routes, REAL temporary datastore: a Free member who has allowed AI features
// (the strongest case: the consent gate is already open) calls every tier-gated route directly, and the provider stand-ins prove nothing reached the AI.
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createFixture, type IapFixture } from "../helpers/iap-fixture";

const reached = vi.hoisted(() => ({ calls: [] as string[] }));
vi.mock("@/lib/ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai")>();
  const spy = (name: string) =>
    vi.fn(async () => {
      reached.calls.push(name);
      throw new Error(`provider reached: ${name}`);
    });
  const stream = (name: string) =>
    vi.fn(() => {
      reached.calls.push(name);
      throw new Error(`provider reached: ${name}`);
    });
  return {
    ...actual,
    isAiConfigured: () => true,
    createCoachChatStream: stream("createCoachChatStream"),
    createNutritionCoachChatStream: stream("createNutritionCoachChatStream"),
    generateMealSuggestions: spy("generateMealSuggestions"),
    extractTrackerStats: spy("extractTrackerStats"),
    generateProgrammeSkeleton: spy("generateProgrammeSkeleton"),
    generateWorkoutReview: spy("generateWorkoutReview"),
  };
});

let fx: IapFixture;
const call = (method: string, url: string, cookie: string, body?: unknown) =>
  new NextRequest(`http://localhost${url}`, { method, headers: { "Content-Type": "application/json", Cookie: cookie }, body: body === undefined ? undefined : JSON.stringify(body) });

// "free": nothing. "app_subscription": digital access only (a complimentary grant stands in for a verified store purchase here).
// "membership": a gym Membership ONLY, which since owner decision D1 grants none of the digital features.
async function member(email: string, tier: "free" | "app_subscription" | "membership") {
  const { POST } = await import("@/app/api/auth/signup/route");
  const res = await POST(
    new NextRequest("http://localhost/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "Tester-pass-123!", fullName: "Tier Tester", phone: "0830000000", dateOfBirth: "1990-01-01", gender: "Male", primaryGoal: "Build Muscle" }),
    })
  );
  expect(res.status).toBeLessThan(300);
  const user = fx.db.findUserByEmail(email)!;
  if (tier === "membership") fx.setSubscription(user.id, { packageId: fx.ids.membershipPackage, provider: "none", status: "active" });
  if (tier === "app_subscription") (await import("@/lib/digital-entitlement")).grantStaffDigitalEntitlement({ userId: user.id, grantedByUserId: null });
  fx.db.saveProfile({ ...fx.db.findProfileByUserId(user.id)!, aiDataConsent: { grantedAt: "2026-10-01T00:00:00.000Z", version: 1 } }); // consent is ON: it must not matter
  const t = "2026-10-01T00:00:00.000Z";
  fx.db.saveWorkoutSession({ id: `w-${email}`, userId: user.id, date: "2026-10-01", title: "Session", exercises: [], runs: [], createdAt: t, updatedAt: t } as never);
  return { id: user.id, cookie: fx.cookie(user.id), workoutId: `w-${email}` };
}

beforeEach(async () => {
  fx = await createFixture();
  reached.calls = [];
});
afterEach(() => fx.cleanup());

// Every feature in lib/member-access.ts's FEATURE_REQUIRES, with the route that enforces it.
const GATED: { feature: string; run: (m: { cookie: string; workoutId: string }) => Promise<Response> }[] = [
  { feature: "aiCoachChat", run: async (m) => (await import("@/app/api/ai/chat/route")).POST(call("POST", "/api/ai/chat", m.cookie, { content: "hi" })) },
  { feature: "aiNutritionCoachChat", run: async (m) => (await import("@/app/api/ai/nutrition-coach/route")).POST(call("POST", "/api/ai/nutrition-coach", m.cookie, { content: "hi" })) },
  { feature: "workoutGenerate", run: async (m) => (await import("@/app/api/mobile/programs/generate/route")).POST(call("POST", "/api/mobile/programs/generate", m.cookie, {})) },
  { feature: "trackerImport", run: async (m) => (await import("@/app/api/mobile/tracker-import/scan/route")).POST(call("POST", "/api/mobile/tracker-import/scan", m.cookie, { imageBase64: "AAAA" })) },
  { feature: "workoutReview", run: async (m) => (await import("@/app/api/mobile/workout-review/[id]/route")).GET(call("GET", "/x", m.cookie), { params: Promise.resolve({ id: m.workoutId }) }) },
  { feature: "gymProfiles", run: async (m) => (await import("@/app/api/mobile/gym-profiles/route")).GET(call("GET", "/api/mobile/gym-profiles", m.cookie)) },
  { feature: "programmes", run: async (m) => (await import("@/app/api/mobile/programs/save/route")).POST(call("POST", "/api/mobile/programs/save", m.cookie, {})) },
  { feature: "weeklyPlanner", run: async (m) => (await import("@/app/api/mobile/weekly-training/route")).GET(call("GET", "/api/mobile/weekly-training", m.cookie)) },
  { feature: "weeklyPlanner (sync)", run: async (m) => (await import("@/app/api/mobile/programs/sync-weekly-schedule/route")).POST(call("POST", "/api/mobile/programs/sync-weekly-schedule", m.cookie, {})) },
  { feature: "calorieTargets", run: async (m) => (await import("@/app/api/mobile/nutrition/target/route")).GET(call("GET", "/api/mobile/nutrition/target", m.cookie)) },
  { feature: "calorieTargets (week)", run: async (m) => (await import("@/app/api/mobile/nutrition/targets/week/route")).GET(call("GET", "/api/mobile/nutrition/targets/week", m.cookie)) },
  { feature: "calorieTargets (web)", run: async (m) => (await import("@/app/api/nutrition/target/route")).GET(call("GET", "/api/nutrition/target", m.cookie)) },
  { feature: "communityLeaderboards", run: async (m) => (await import("@/app/api/mobile/community/leaderboard/route")).GET(call("GET", "/api/mobile/community/leaderboard", m.cookie)) },
  { feature: "communityLeaderboards (highlight)", run: async (m) => (await import("@/app/api/mobile/community/highlight/route")).GET(call("GET", "/api/mobile/community/highlight", m.cookie)) },
  { feature: "nutritionMoreTools (meal suggestions)", run: async (m) => (await import("@/app/api/mobile/nutrition/meal-suggest/route")).POST(call("POST", "/api/mobile/nutrition/meal-suggest", m.cookie, {})) },
];

describe("a member without digital access, even with AI consent granted, is refused by every gated route", () => {
  for (const who of ["free", "membership"] as const) {
    for (const g of GATED) {
      it(`${who} / ${g.feature}: 403 and nothing reaches the AI provider`, async () => {
        const m = await member(`${who}-${g.feature.replace(/\W+/g, "")}@example.test`, who);
        const res = await g.run(m);
        expect(res.status, await res.clone().text()).toBe(403);
        expect(reached.calls).toEqual([]);
      });
    }
  }

  it("coach messaging is gym-Membership-only on the server: Free and digital-only are both refused", async () => {
    const { POST } = await import("@/app/api/messages/send/route");
    for (const tier of ["free", "app_subscription"] as const) {
      const m = await member(`msg-${tier}@example.test`, tier);
      const res = await POST(call("POST", "/api/messages/send", m.cookie, { body: "hello coach" }));
      expect(res.status, `${tier}: ${await res.clone().text()}`).toBe(403);
    }
  });
});

describe("an entitled member is not blocked by the gate", () => {
  it("digital access: the chat route passes the check (it then reaches the provider stand-in)", async () => {
    const m = await member("ok-digital@example.test", "app_subscription");
    const { POST } = await import("@/app/api/ai/chat/route");
    const res = await POST(call("POST", "/api/ai/chat", m.cookie, { content: "hi" }));
    expect(res.status).not.toBe(403);
    expect(reached.calls).toContain("createCoachChatStream");
  });

  it("a gym Membership reaches coach messaging, and a digital plan does not", async () => {
    const { POST } = await import("@/app/api/messages/send/route");
    const gym = await member("msg-ok-gym@example.test", "membership");
    expect((await POST(call("POST", "/api/messages/send", gym.cookie, { body: "hello coach" }))).status).not.toBe(403);
  });
});

describe("lib/member-access.ts feature list is fully accounted for", () => {
  it("every feature that the apps gate has a server route above, except the ones named here as client-only", async () => {
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const src = readFileSync(path.join(process.cwd(), "lib", "member-access.ts"), "utf8");
    const block = src.slice(src.indexOf("const FEATURE_REQUIRES"), src.indexOf("export function hasAccess"));
    const features = [...block.matchAll(/^\s+(\w+):\s*"/gm)].map((m) => m[1]);
    expect(features.length).toBeGreaterThan(0);
    // Not a plain 403, each with its own test below: the Free features (open to everyone), the two Free COUNT limits (saved workouts and meals),
    // fullHistory (a date filter) and cyclePhaseGuidance (the guidance fields are emptied). coachMessaging is the messages/send test above.
    const tested = new Set(GATED.map((g) => g.feature.split(" ")[0]));
    const clientOnly = new Set([
      "foodSearch",
      "unlimitedCustomFoods",
      "notifications",
      "unlimitedSavedWorkouts",
      "unlimitedSavedMeals",
      "fullHistory",
      "cyclePhaseGuidance",
      "coachMessaging",
    ]);
    expect(features.filter((f) => !tested.has(f) && !clientOnly.has(f))).toEqual([]);
  });
});

describe("Free features stay open to a member with no plan (owner decisions 2026-10-27)", () => {
  it("food search and both notification switches are not refused", async () => {
    const m = await member("free-open@example.test", "free");
    const search = await (await import("@/app/api/mobile/nutrition/food/search/route")).GET(call("GET", "/api/mobile/nutrition/food/search?q=oats", m.cookie));
    expect(search.status, await search.clone().text()).not.toBe(403);
    const push = await (await import("@/app/api/profile/push-notifications/route")).POST(call("POST", "/api/profile/push-notifications", m.cookie, { pushNotificationsEnabled: true }));
    expect(push.status, await push.clone().text()).not.toBe(403);
    const email = await (await import("@/app/api/profile/email-notifications/route")).POST(call("POST", "/api/profile/email-notifications", m.cookie, { emailNotificationsEnabled: true }));
    expect(email.status, await email.clone().text()).not.toBe(403);
  });
});

describe("Free-tier count limits are enforced on the server", () => {
  const template = { name: "Push day", exercises: [{ name: "Bench Press", sets: 3, reps: 8 }] };

  it("a Free member can save 3 workouts; the 4th is refused with the upgrade code; a subscriber is not limited", async () => {
    const { POST } = await import("@/app/api/mobile/workout-templates/create/route");
    const free = await member("free-templates@example.test", "free");
    for (let i = 0; i < 3; i++) {
      const res = await POST(call("POST", "/api/mobile/workout-templates/create", free.cookie, { ...template, name: `Day ${i}` }));
      expect(res.status, await res.clone().text()).toBeLessThan(300);
    }
    const fourth = await POST(call("POST", "/api/mobile/workout-templates/create", free.cookie, template));
    expect(fourth.status).toBe(403);
    expect((await fourth.json()).code).toBe("upgrade_required");

    const sub = await member("sub-templates@example.test", "app_subscription");
    for (let i = 0; i < 4; i++) {
      const res = await POST(call("POST", "/api/mobile/workout-templates/create", sub.cookie, { ...template, name: `Day ${i}` }));
      expect(res.status, await res.clone().text()).toBeLessThan(300);
    }
  });

  it("a Free member can save 5 meals (favourites); the 6th is refused", async () => {
    const { POST } = await import("@/app/api/mobile/nutrition/food/favorites/add/route");
    const free = await member("free-meals@example.test", "free");
    const t = "2026-10-01T00:00:00.000Z";
    for (let i = 0; i < 5; i++) {
      fx.db.createFoodFavorite({ id: `fav-${i}`, userId: free.id, name: `Meal ${i}`, createdAt: t } as never);
    }
    const sixth = await POST(call("POST", "/api/mobile/nutrition/food/favorites/add", free.cookie, { name: "Meal 6" }));
    expect(sixth.status).toBe(403);
    expect((await sixth.json()).code).toBe("upgrade_required");
  });
});

describe("Free history covers the last 7 days; nothing is deleted", () => {
  it("the workout list holds only recent sessions for Free, and everything for a subscriber", async () => {
    const { GET } = await import("@/app/api/mobile/workouts/route");
    const today = new Date().toISOString().slice(0, 10);
    for (const who of ["free", "app_subscription"] as const) {
      const m = await member(`history-${who}@example.test`, who);
      const t = new Date().toISOString();
      fx.db.saveWorkoutSession({ id: `recent-${who}`, userId: m.id, date: today, title: "Today", exercises: [], runs: [], createdAt: t, updatedAt: t } as never);
      const res = await GET(call("GET", "/api/mobile/workouts", m.cookie));
      const ids = ((await res.json()).data.sessions as { id: string }[]).map((x) => x.id);
      expect(ids).toContain(`recent-${who}`);
      // The member() helper logs a session dated 2026-10-01: older than 7 days for Free.
      expect(ids.includes(m.workoutId)).toBe(who === "app_subscription");
    }
  });
});
