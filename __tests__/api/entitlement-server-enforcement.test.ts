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
  if (tier === "app_subscription") fx.setSubscription(user.id, { packageId: fx.ids.appPackage, provider: "none", status: "active" });
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

// Every feature in lib/member-access.ts's FEATURE_MIN_TIER, with the route that enforces it.
const GATED: { feature: string; run: (m: { cookie: string; workoutId: string }) => Promise<Response> }[] = [
  { feature: "aiCoachChat", run: async (m) => (await import("@/app/api/ai/chat/route")).POST(call("POST", "/api/ai/chat", m.cookie, { content: "hi" })) },
  { feature: "aiNutritionCoachChat", run: async (m) => (await import("@/app/api/ai/nutrition-coach/route")).POST(call("POST", "/api/ai/nutrition-coach", m.cookie, { content: "hi" })) },
  { feature: "workoutGenerate", run: async (m) => (await import("@/app/api/mobile/programs/generate/route")).POST(call("POST", "/api/mobile/programs/generate", m.cookie, {})) },
  { feature: "trackerImport", run: async (m) => (await import("@/app/api/mobile/tracker-import/scan/route")).POST(call("POST", "/api/mobile/tracker-import/scan", m.cookie, { imageBase64: "AAAA" })) },
  { feature: "workoutReview", run: async (m) => (await import("@/app/api/mobile/workout-review/[id]/route")).GET(call("GET", "/x", m.cookie), { params: Promise.resolve({ id: m.workoutId }) }) },
  { feature: "foodSearch", run: async (m) => (await import("@/app/api/mobile/nutrition/food/search/route")).GET(call("GET", "/api/mobile/nutrition/food/search?q=oats", m.cookie)) },
  { feature: "gymProfiles", run: async (m) => (await import("@/app/api/mobile/gym-profiles/route")).GET(call("GET", "/api/mobile/gym-profiles", m.cookie)) },
  { feature: "notifications (push)", run: async (m) => (await import("@/app/api/profile/push-notifications/route")).POST(call("POST", "/api/profile/push-notifications", m.cookie, { pushNotificationsEnabled: true })) },
  { feature: "notifications (email)", run: async (m) => (await import("@/app/api/profile/email-notifications/route")).POST(call("POST", "/api/profile/email-notifications", m.cookie, { emailNotificationsEnabled: true })) },
  { feature: "nutritionMoreTools (meal suggestions)", run: async (m) => (await import("@/app/api/mobile/nutrition/meal-suggest/route")).POST(call("POST", "/api/mobile/nutrition/meal-suggest", m.cookie, {})) },
];

describe("a Free member, even with AI consent granted, is refused by every tier-gated route", () => {
  for (const g of GATED) {
    it(`${g.feature}: 403 and nothing reaches the AI provider`, async () => {
      const free = await member(`free-${g.feature.replace(/\W+/g, "")}@example.test`, "free");
      const res = await g.run(free);
      expect(res.status, await res.clone().text()).toBe(403);
      expect(reached.calls).toEqual([]);
    });
  }

  it("coach messaging is Membership-only on the server: Free and App Subscription are both refused", async () => {
    const { POST } = await import("@/app/api/messages/send/route");
    for (const tier of ["free", "app_subscription"] as const) {
      const m = await member(`msg-${tier}@example.test`, tier);
      const res = await POST(call("POST", "/api/messages/send", m.cookie, { body: "hello coach" }));
      expect(res.status, `${tier}: ${await res.clone().text()}`).toBe(403);
    }
  });
});

describe("an entitled member is not blocked by the tier gate", () => {
  for (const tier of ["app_subscription", "membership"] as const) {
    it(`${tier}: the chat route passes the tier check (it then reaches the provider stand-in)`, async () => {
      const m = await member(`ok-${tier}@example.test`, tier);
      const { POST } = await import("@/app/api/ai/chat/route");
      const res = await POST(call("POST", "/api/ai/chat", m.cookie, { content: "hi" }));
      expect(res.status).not.toBe(403);
      expect(reached.calls).toContain("createCoachChatStream");
    });
  }
});

describe("lib/member-access.ts feature list is fully accounted for", () => {
  it("every feature that the apps gate has a server route above, except the ones named here as client-only", async () => {
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const src = readFileSync(path.join(process.cwd(), "lib", "member-access.ts"), "utf8");
    const block = src.slice(src.indexOf("const FEATURE_MIN_TIER"), src.indexOf("export function hasAccess"));
    const features = [...block.matchAll(/^\s+(\w+):\s*"/gm)].map((m) => m[1]);
    // unlimitedCustomFoods is a COUNT limit enforced in the create route (tested in the custom-food tests); nutritionMoreTools is enforced for the one cost-bearing tool
    // (meal suggestions). The sports drink calculator, weekly training schedule and shopping list are own-data tools with no provider cost and are hidden, not blocked,
    // for Free: an owner decision, listed in the handover.
    const tested = new Set(GATED.map((g) => g.feature.split(" ")[0]));
    const clientOnly = new Set(["unlimitedCustomFoods"]);
    expect(features.filter((f) => !tested.has(f) && !clientOnly.has(f))).toEqual([]);
  });
});
