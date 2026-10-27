// The non-streaming AI routes (staff coach summary, staff draft reply, workout review) must also answer a provider failure with a controlled 502 JSON error, not an
// unexplained 500. REAL routes, REAL temporary datastore; the provider functions are stand-ins that throw.
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createFixture, type IapFixture } from "../helpers/iap-fixture";

vi.mock("@/lib/ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai")>();
  const boom = (name: string) => vi.fn(async () => { throw new Error(`provider failed: ${name}`); });
  return {
    ...actual,
    isAiConfigured: () => true,
    generateCoachSummary: boom("generateCoachSummary"),
    draftReply: boom("draftReply"),
    generateWorkoutReview: boom("generateWorkoutReview"),
  };
});

let fx: IapFixture;
beforeEach(async () => {
  fx = await createFixture();
});
afterEach(() => fx.cleanup());

const post = (url: string, cookie: string, body?: unknown) =>
  new NextRequest(`http://localhost${url}`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie }, body: body === undefined ? undefined : JSON.stringify(body) });

async function consentingMember() {
  const { POST } = await import("@/app/api/auth/signup/route");
  const res = await POST(
    new NextRequest("http://localhost/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "pf@example.test", password: "Tester-pass-123!", fullName: "Provider Fail", phone: "0830000000", dateOfBirth: "1990-01-01", gender: "Male", primaryGoal: "Build Muscle" }),
    })
  );
  expect(res.status).toBeLessThan(300);
  const user = fx.db.findUserByEmail("pf@example.test")!;
  fx.setSubscription(user.id, { packageId: fx.ids.membershipPackage, provider: "none", status: "active" });
  // Digital access is separate from a gym Membership (owner decision D1): the AI routes need the digital flag.
  (await import("@/lib/digital-entitlement")).grantStaffDigitalEntitlement({ userId: user.id, grantedByUserId: null });
  fx.db.saveProfile({ ...fx.db.findProfileByUserId(user.id)!, aiDataConsent: { grantedAt: "2026-10-01T00:00:00.000Z", version: 1 } });
  const t = "2026-10-01T00:00:00.000Z";
  fx.db.saveWorkoutSession({ id: "w-pf", userId: user.id, date: "2026-10-01", title: "Session", exercises: [], runs: [], createdAt: t, updatedAt: t } as never);
  return { id: user.id, cookie: fx.cookie(user.id) };
}

describe("a provider failure on the non-streaming AI routes", () => {
  it("staff coach summary: 502 ai_unavailable", async () => {
    const m = await consentingMember();
    const { POST } = await import("@/app/api/ai/coach-summary/route");
    const res = await POST(post("/api/ai/coach-summary", fx.cookie(fx.adminA.id), { memberId: m.id }));
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ success: false, code: "ai_unavailable" });
  });

  it("staff draft reply: 502 ai_unavailable", async () => {
    const m = await consentingMember();
    const { POST } = await import("@/app/api/ai/draft-reply/route");
    const res = await POST(post("/api/ai/draft-reply", fx.cookie(fx.adminA.id), { memberId: m.id }));
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ success: false, code: "ai_unavailable" });
  });

  it("workout review: 502 ai_unavailable, and no review text is stored", async () => {
    const m = await consentingMember();
    const { GET } = await import("@/app/api/mobile/workout-review/[id]/route");
    const res = await GET(new NextRequest("http://localhost/x", { headers: { Cookie: m.cookie } }), { params: Promise.resolve({ id: "w-pf" }) });
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ success: false, code: "ai_unavailable" });
    expect(fx.db.findWorkoutSessionById("w-pf")!.reviewText ?? null).toBeNull();
  });
});
