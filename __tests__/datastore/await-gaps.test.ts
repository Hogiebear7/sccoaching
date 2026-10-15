// A read taken BEFORE a slow `await` (a payment-provider call, an AI call) must never overwrite a change that landed DURING it. The file lock covers one synchronous
// turn and cannot do this, so the writers that sit after such an await re-read the row and change only their own fields. These tests run the REAL routes against a REAL
// temporary datastore and make the "slow call" itself perform the competing change (as a Stripe webhook or another request would), then check that both survive.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createFixture, type IapFixture } from "../helpers/iap-fixture";

const providerHooks = vi.hoisted(() => ({
  pause: vi.fn<() => Promise<{ ok: boolean; message?: string }>>(),
  resume: vi.fn<() => Promise<{ ok: boolean; message?: string }>>(),
  cancel: vi.fn<() => Promise<{ ok: boolean; message?: string }>>(),
}));
vi.mock("@/lib/billing", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/billing")>();
  return { ...actual, pauseProviderSubscription: providerHooks.pause, resumeProviderSubscription: providerHooks.resume, cancelProviderSubscription: providerHooks.cancel };
});

let fx: IapFixture;
beforeEach(async () => {
  fx = await createFixture();
  providerHooks.pause.mockReset();
  providerHooks.resume.mockReset();
  providerHooks.cancel.mockReset();
});
afterEach(() => fx.cleanup());

const post = (url: string, cookie: string, body: unknown) =>
  new NextRequest(`http://localhost${url}`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify(body) });
const ctx = (userId: string) => ({ params: Promise.resolve({ userId }) });

function stripeMember() {
  fx.setSubscription(fx.memberA.id, { packageId: fx.ids.membershipPackage, billingOptionId: fx.ids.membershipOption, provider: "stripe", providerSubscriptionId: "sub_test_1", status: "active", currentPeriodEnd: "2030-01-01T00:00:00.000Z" });
}

describe("staff pause and resume", () => {
  it("keeps a webhook's change that lands while the Stripe call is in flight", async () => {
    stripeMember();
    providerHooks.pause.mockImplementation(async () => {
      fx.db.updateSubscription(fx.memberA.id, () => ({ currentPeriodEnd: "2031-06-01T00:00:00.000Z", lastWebhookEventAt: "2026-10-15T12:00:00.000Z" }));
      return { ok: true };
    });
    const { POST } = await import("@/app/api/staff/members/[userId]/pause/route");
    const res = await POST(post("/x", fx.cookie(fx.adminA.id), { action: "pause", duration: "1m" }), ctx(fx.memberA.id));
    expect(res.status).toBe(200);
    const sub = fx.db.findSubscriptionByUserId(fx.memberA.id)!;
    expect(sub.status).toBe("paused");
    expect(sub.statusBeforePause).toBe("active");
    expect(sub.currentPeriodEnd).toBe("2031-06-01T00:00:00.000Z"); // the webhook's change survived
    expect(sub.lastWebhookEventAt).toBe("2026-10-15T12:00:00.000Z");
  });

  it("refuses (409) and saves nothing when the membership was cancelled while Stripe was being called", async () => {
    stripeMember();
    providerHooks.pause.mockImplementation(async () => {
      fx.db.updateSubscription(fx.memberA.id, () => ({ status: "canceled" }));
      return { ok: true };
    });
    const { POST } = await import("@/app/api/staff/members/[userId]/pause/route");
    const res = await POST(post("/x", fx.cookie(fx.adminA.id), { action: "pause", duration: "2w" }), ctx(fx.memberA.id));
    expect(res.status).toBe(409);
    expect(fx.db.findSubscriptionByUserId(fx.memberA.id)!.status).toBe("canceled"); // not resurrected into "paused"
  });

  it("resume keeps a concurrent change and refuses if the membership is no longer paused", async () => {
    stripeMember();
    fx.db.updateSubscription(fx.memberA.id, () => ({ status: "paused", statusBeforePause: "active", pausedUntil: "2026-11-15T00:00:00.000Z" }));
    providerHooks.resume.mockImplementation(async () => {
      fx.db.updateSubscription(fx.memberA.id, () => ({ currentPeriodEnd: "2032-01-01T00:00:00.000Z" }));
      return { ok: true };
    });
    const { POST } = await import("@/app/api/staff/members/[userId]/pause/route");
    expect((await POST(post("/x", fx.cookie(fx.adminA.id), { action: "resume" }), ctx(fx.memberA.id))).status).toBe(200);
    const sub = fx.db.findSubscriptionByUserId(fx.memberA.id)!;
    expect([sub.status, sub.currentPeriodEnd]).toEqual(["active", "2032-01-01T00:00:00.000Z"]);

    fx.db.updateSubscription(fx.memberA.id, () => ({ status: "paused", statusBeforePause: "active" }));
    providerHooks.resume.mockImplementation(async () => {
      fx.db.updateSubscription(fx.memberA.id, () => ({ status: "canceled" }));
      return { ok: true };
    });
    expect((await POST(post("/x", fx.cookie(fx.adminA.id), { action: "resume" }), ctx(fx.memberA.id))).status).toBe(409);
    expect(fx.db.findSubscriptionByUserId(fx.memberA.id)!.status).toBe("canceled");
  });
});

describe("staff subscription override", () => {
  it("builds the new row from the subscription as it is AFTER the provider cancel, and keeps what changed meanwhile", async () => {
    stripeMember();
    providerHooks.cancel.mockImplementation(async () => {
      fx.db.updateSubscription(fx.memberA.id, () => ({ sessionsUsedThisPeriod: 7, lastWebhookEventAt: "2026-10-15T13:00:00.000Z" }));
      return { ok: true };
    });
    const { POST } = await import("@/app/api/staff/members/[userId]/subscription/route");
    const res = await POST(post("/x", fx.cookie(fx.adminA.id), { status: "active", packageId: fx.ids.membershipPackage }), ctx(fx.memberA.id));
    expect(res.status).toBe(200);
    const sub = fx.db.findSubscriptionByUserId(fx.memberA.id)!;
    expect(sub.provider).toBe("none");
    expect(sub.lastWebhookEventAt).toBe("2026-10-15T13:00:00.000Z");
    expect(sub.sessionsUsedThisPeriod).toBe(7); // same package and already active: usage is not reset, and the value changed meanwhile survived
  });
});

describe("guarded record helpers", () => {
  it("updateSubscription applies a patch to the CURRENT row and writes nothing when the change declines", () => {
    fx.setSubscription(fx.memberA.id, { packageId: fx.ids.membershipPackage, provider: "none", status: "active" });
    const stale = fx.db.findSubscriptionByUserId(fx.memberA.id)!;
    fx.db.updateSubscription(fx.memberA.id, () => ({ sessionsUsedThisPeriod: 3 }));
    fx.db.updateSubscription(fx.memberA.id, () => ({ pausedUntil: "2027-01-01T00:00:00.000Z" })); // a second writer, working from the new row
    const now = fx.db.findSubscriptionByUserId(fx.memberA.id)!;
    expect([now.sessionsUsedThisPeriod, now.pausedUntil]).toEqual([3, "2027-01-01T00:00:00.000Z"]);
    expect(stale.sessionsUsedThisPeriod).toBe(0); // proves the stale copy really was stale
    expect(fx.db.updateSubscription("nobody", () => ({ status: "active" }))).toBeUndefined();
    const before = JSON.stringify(fx.db.findSubscriptionByUserId(fx.memberA.id));
    expect(fx.db.updateSubscription(fx.memberA.id, () => null)).toBeDefined();
    expect(JSON.stringify(fx.db.findSubscriptionByUserId(fx.memberA.id))).toBe(before);
  });

  it("saveTrainingProgramIfUnchanged refuses a stale programme and accepts a fresh one", () => {
    const t = "2026-10-01T00:00:00.000Z";
    const program = { id: "p1", userId: fx.memberA.id, name: "P", status: "active", days: [], currentDayIndex: 0, createdByStaffId: "x", createdAt: t, updatedAt: t } as never;
    fx.db.saveTrainingProgram(program);
    expect(fx.db.saveTrainingProgramIfUnchanged({ ...(program as object), name: "mine", updatedAt: "2026-10-02T00:00:00.000Z" } as never, t)).toBe(true);
    // a second writer that still holds the original is refused
    expect(fx.db.saveTrainingProgramIfUnchanged({ ...(program as object), name: "stale", updatedAt: "2026-10-03T00:00:00.000Z" } as never, t)).toBe(false);
    expect(fx.db.findTrainingProgramById("p1")!.name).toBe("mine");
  });

  it("updateWorkoutSession sets only the given fields on the current session", () => {
    const t = "2026-10-01T00:00:00.000Z";
    fx.db.saveWorkoutSession({ id: "w1", userId: fx.memberA.id, date: "2026-10-01", title: "Old", exercises: [], runs: [], createdAt: t, updatedAt: t } as never);
    const stale = fx.db.findWorkoutSessionById("w1")!;
    fx.db.saveWorkoutSession({ ...stale, title: "Edited meanwhile" });
    fx.db.updateWorkoutSession("w1", () => ({ reviewText: "Nice", reviewGeneratedAt: t }));
    const now = fx.db.findWorkoutSessionById("w1")!;
    expect([now.title, now.reviewText]).toEqual(["Edited meanwhile", "Nice"]);
  });
});

describe("the await-gap inventory", () => {
  it("every flagged function has a written disposition, and none is stale (a new gap fails here until someone reads it)", () => {
    const root = path.resolve(__dirname, "..", "..");
    let out = "";
    try {
      out = execFileSync(process.execPath, ["scripts/audit-await-gaps.cjs", "--check"], { cwd: root, encoding: "utf8" });
    } catch (e) {
      out = String((e as { stdout?: string }).stdout ?? e);
      throw new Error(out);
    }
    expect(out).not.toContain("NOT REVIEWED");
    expect(out).not.toContain("STALE");
  });
});
