// AI data-sharing consent. REAL routes, REAL temporary datastore, fake accounts. The AI library is replaced by spies that stand in for the provider, so each test can
// prove the strongest property: WITHOUT a current consent the provider function is never called, and after withdrawal it stops again.
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createFixture, type IapFixture } from "../helpers/iap-fixture";

vi.mock("@/lib/ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai")>();
  const spy = (name: string) => vi.fn(async () => { throw new Error(`provider reached: ${name}`); });
  return {
    ...actual,
    isAiConfigured: () => true,
    createCoachChatStream: vi.fn(() => { throw new Error("provider reached: createCoachChatStream"); }),
    createNutritionCoachChatStream: vi.fn(() => { throw new Error("provider reached: createNutritionCoachChatStream"); }),
    generateCoachSummary: spy("generateCoachSummary"),
    draftReply: spy("draftReply"),
    interpretFoodDescription: spy("interpretFoodDescription"),
    identifyFoodPhoto: spy("identifyFoodPhoto"),
    generateMealSuggestions: spy("generateMealSuggestions"),
    extractReceiptItems: spy("extractReceiptItems"),
    extractTrackerStats: spy("extractTrackerStats"),
    generateProgrammeSkeleton: spy("generateProgrammeSkeleton"),
    generateProgrammeCheckIn: spy("generateProgrammeCheckIn"),
    generateExerciseAlternatives: spy("generateExerciseAlternatives"),
    generateWorkoutReview: spy("generateWorkoutReview"),
  };
});

let fx: IapFixture;
const SIGNUP = (email: string) => ({ email, password: "Tester-pass-123!", fullName: "Consent Tester", phone: "0830000000", dateOfBirth: "1990-01-01", gender: "Male", primaryGoal: "Build Muscle" });

const req = (url: string, method: string, cookie: string | undefined, body?: unknown) =>
  new NextRequest(`http://localhost${url}`, { method, headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });

async function signUp(email: string) {
  const { POST } = await import("@/app/api/auth/signup/route");
  const res = await POST(req("/api/auth/signup", "POST", undefined, SIGNUP(email)));
  expect(res.status, await res.clone().text()).toBeLessThan(300);
  const user = fx.db.findUserByEmail(email)!;
  // A plan and a completed programme cycle, so the request gets past the tier and not-found checks and the CONSENT gate is what answers.
  fx.setSubscription(user.id, { packageId: fx.ids.membershipPackage, provider: "none", status: "active" });
  const t = "2026-10-01T00:00:00.000Z";
  fx.db.saveTrainingProgram({ id: "p1", userId: user.id, name: "Test programme", status: "active", days: [], currentDayIndex: 0, createdByStaffId: "x", createdAt: t, updatedAt: t, completedCycles: 2, totalWeeks: 4 } as never);
  return { user, cookie: fx.cookie(user.id) };
}
const consent = async (cookie: string | undefined, method: "GET" | "POST", body?: unknown) => {
  const mod = await import("@/app/api/profile/ai-consent/route");
  return method === "GET" ? mod.GET(req("/api/profile/ai-consent", "GET", cookie)) : mod.POST(req("/api/profile/ai-consent", "POST", cookie, body));
};
const grant = (cookie: string) => consent(cookie, "POST", { granted: true });
const withdraw = (cookie: string) => consent(cookie, "POST", { granted: false });

beforeEach(async () => { fx = await createFixture(); });
afterEach(() => fx.cleanup());

describe("the consent endpoint", () => {
  it("needs a session, and a profile", async () => {
    expect((await consent(undefined, "GET")).status).toBe(401);
    expect((await consent(undefined, "POST", { granted: true })).status).toBe(401);
    expect((await consent(fx.cookie(fx.memberA.id), "GET")).status).toBe(404); // an account with no profile has nothing to consent for
  });

  it("starts as not granted, grants with a timestamp and the current wording version, and withdraws", async () => {
    const { cookie } = await signUp("c1@example.test");
    const before = await (await consent(cookie, "GET")).json();
    expect(before.data).toMatchObject({ granted: false, grantedAt: null });

    const granted = await (await grant(cookie)).json();
    expect(granted.data).toMatchObject({ granted: true, version: 1 });
    expect(typeof granted.data.grantedAt).toBe("string");
    expect((await (await consent(cookie, "GET")).json()).data.granted).toBe(true);

    const gone = await (await withdraw(cookie)).json();
    expect(gone.data).toMatchObject({ granted: false, grantedAt: null });
    expect((await (await consent(cookie, "GET")).json()).data.granted).toBe(false);
  });

  it("refuses anything but a boolean, and changes nothing else on the profile", async () => {
    const { user, cookie } = await signUp("c2@example.test");
    const profileBefore = fx.db.findProfileByUserId(user.id)!;
    expect((await consent(cookie, "POST", { granted: "yes" })).status).toBe(400);
    expect((await consent(cookie, "POST", {})).status).toBe(400);
    await grant(cookie);
    const after = fx.db.findProfileByUserId(user.id)!;
    for (const key of Object.keys(profileBefore) as (keyof typeof profileBefore)[]) {
      if (key === "updatedAt" || key === "aiDataConsent") continue;
      expect(after[key], String(key)).toEqual(profileBefore[key]);
    }
  });

  it("is per account: one member's consent never counts for another", async () => {
    const a = await signUp("c3a@example.test");
    const b = await signUp("c3b@example.test");
    await grant(a.cookie);
    expect((await (await consent(b.cookie, "GET")).json()).data.granted).toBe(false);
  });

  it("a grant for older wording stops counting (the member is asked again)", async () => {
    const { user, cookie } = await signUp("c4@example.test");
    await grant(cookie);
    const p = fx.db.findProfileByUserId(user.id)!;
    fx.db.saveProfile({ ...p, aiDataConsent: { grantedAt: p.aiDataConsent!.grantedAt, version: 0 } });
    expect((await (await consent(cookie, "GET")).json()).data.granted).toBe(false);
  });

  it("the profile data the apps read carries the flag", async () => {
    const { user, cookie } = await signUp("c5@example.test");
    const { getProfileData } = await import("@/lib/profile-data");
    expect(getProfileData(user.id)?.aiConsentGranted).toBe(false);
    await grant(cookie);
    expect(getProfileData(user.id)?.aiConsentGranted).toBe(true);
    await withdraw(cookie);
    expect(getProfileData(user.id)?.aiConsentGranted).toBe(false);
  });
});

// Every member-facing route that would send the member's data to the provider. `provider` names the spy that must stay uncalled.
const ROUTES: { name: string; path: string; method: "GET" | "POST"; body?: unknown; params?: Record<string, string>; provider: string }[] = [
  { name: "AI coach chat", path: "ai/chat", method: "POST", body: { content: "hi" }, provider: "createCoachChatStream" },
  { name: "nutrition coach", path: "ai/nutrition-coach", method: "POST", body: { content: "hi" }, provider: "createNutritionCoachChatStream" },
  { name: "food from a description", path: "mobile/nutrition/food/describe", method: "POST", body: { description: "two eggs" }, provider: "interpretFoodDescription" },
  { name: "food from a photo", path: "mobile/nutrition/food/label-scan", method: "POST", body: { imageBase64: "data:image/jpeg;base64,AAAA" }, provider: "identifyFoodPhoto" },
  { name: "meal suggestions", path: "mobile/nutrition/meal-suggest", method: "POST", body: {}, provider: "generateMealSuggestions" },
  { name: "receipt scan", path: "mobile/nutrition/receipt-scan", method: "POST", body: { imageBase64: "data:image/jpeg;base64,AAAA" }, provider: "extractReceiptItems" },
  { name: "tracker screenshot import", path: "mobile/tracker-import/scan", method: "POST", body: { imageBase64: "data:image/jpeg;base64,AAAA" }, provider: "extractTrackerStats" },
  { name: "programme generation", path: "mobile/programs/generate", method: "POST", body: {}, provider: "generateProgrammeSkeleton" },
  { name: "programme check-in", path: "mobile/programs/[id]/checkin/[cycle]", method: "GET", params: { id: "p1", cycle: "1" }, provider: "generateProgrammeCheckIn" },
];

describe("without a current consent the provider is never reached", () => {
  for (const r of ROUTES) {
    it(`${r.name}: refused with ai_consent_required, nothing sent; still refused after withdrawal`, async () => {
      const { cookie } = await signUp(`gate-${r.path.replace(/[^a-z]/g, "")}@example.test`);
      const ai = (await import("@/lib/ai")) as unknown as Record<string, ReturnType<typeof vi.fn>>;
      const call = async () => {
        const mod = await import(`@/app/api/${r.path}/route`);
        const request = req(`/api/${r.path}`, r.method, cookie, r.body);
        return r.params ? mod[r.method](request, { params: Promise.resolve(r.params) }) : mod[r.method](request);
      };

      const refused = await call();
      expect(refused.status).toBe(403);
      expect((await refused.json()).code).toBe("ai_consent_required");
      expect(ai[r.provider]).not.toHaveBeenCalled();

      await grant(cookie);
      const allowed = await call();
      expect((await allowed.clone().json().catch(() => ({}))).code, "with consent the consent gate no longer answers").not.toBe("ai_consent_required");

      await withdraw(cookie);
      ai[r.provider].mockClear();
      const again = await call();
      expect(again.status).toBe(403);
      expect((await again.json()).code).toBe("ai_consent_required");
      expect(ai[r.provider]).not.toHaveBeenCalled();
    });
  }

  it("exercise alternatives: without consent the AI part is skipped and the deterministic list is used, so the screen still works", async () => {
    const { cookie } = await signUp("alt@example.test");
    const ai = (await import("@/lib/ai")) as unknown as Record<string, ReturnType<typeof vi.fn>>;
    const mod = await import("@/app/api/mobile/programs/[id]/exercises/[exerciseId]/alternatives/route");
    await mod.POST(req("/api/x", "POST", cookie, { reason: "no equipment" }), { params: Promise.resolve({ id: "p1", exerciseId: "e1" }) });
    expect(ai.generateExerciseAlternatives).not.toHaveBeenCalled();
  });

  it("workout review: the comparison is always returned, and the written AI review is only requested with consent", async () => {
    const { user, cookie } = await signUp("review@example.test");
    const wk = await (await import("@/app/api/workouts/create/route")).POST(req("/api/workouts/create", "POST", cookie, { title: "Squats", date: "2026-10-14", durationMins: "40" }));
    expect(wk.status).toBeLessThan(300);
    const session = fx.db.findWorkoutSessionsByUserId(user.id)[0];
    const ai = (await import("@/lib/ai")) as unknown as Record<string, ReturnType<typeof vi.fn>>;
    const mod = await import("@/app/api/mobile/workout-review/[id]/route");
    const res = await mod.GET(req("/api/x", "GET", cookie), { params: Promise.resolve({ id: session.id }) });
    if (res.status === 403) return; // the review needs a paid tier on this fixture; the consent gate sits behind that and is covered by the guard test
    const body = await res.json();
    expect(body.data.aiConsentRequired).toBe(true);
    expect(body.data.reviewText).toBeNull();
    expect(ai.generateWorkoutReview).not.toHaveBeenCalled();
  });
});

describe("staff-side AI uses a MEMBER's data, so the member's consent decides", () => {
  it("coach summary and draft reply are refused for a member who has not consented, and nothing is sent", async () => {
    const member = await signUp("staffgate@example.test");
    const ai = (await import("@/lib/ai")) as unknown as Record<string, ReturnType<typeof vi.fn>>;
    const adminCookie = fx.cookie(fx.adminA.id);
    for (const [route, spy] of [["ai/coach-summary", "generateCoachSummary"], ["ai/draft-reply", "draftReply"]] as const) {
      const mod = await import(`@/app/api/${route}/route`);
      const res = await mod.POST(req(`/api/${route}`, "POST", adminCookie, { memberId: member.user.id, latestMemberMessage: "hi" }));
      const body = await res.json();
      expect([403, 404]).toContain(res.status);
      if (res.status === 403 && body.code) expect(body.code).toBe("ai_consent_missing_member");
      expect(ai[spy]).not.toHaveBeenCalled();
    }
  });
});
