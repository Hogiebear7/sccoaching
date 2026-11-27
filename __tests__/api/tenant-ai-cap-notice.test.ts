// A tenant gym's admins are told when the gym has used 80% and 100% of its own AI allowance, once each per month; S&C's own admins and gyms with no allowance set are never told.
// Real datastore and the real job; the amounts are TEST values.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createFixture, GYM_B, type IapFixture } from "../helpers/iap-fixture";

const T = "2026-01-01T00:00:00.000Z";
let fx: IapFixture;

function gymB() {
  fx.db.createGym({
    id: GYM_B, slug: "gym-b", name: "Gym B", tagline: null, description: null, ownerUserId: fx.adminB.id, contactEmail: "b@example.test", contactPhone: null,
    addressLine: "", latitude: null, longitude: null, status: "active", createdAt: T, updatedAt: T, platformBilling: { paidThrough: "2099-01-01", band: "b50" },
  });
}

function spend(userId: string, usd: number) {
  fx.db.createAiUsageLog({ id: `l_${Math.random()}`, userId, feature: "coach_chat", model: "m", inputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 0, costUsd: usd, allowanceKind: "free", createdAt: new Date().toISOString() } as never);
}

const notices = (userId: string) => fx.db.findNotificationsByUserId(userId).filter((n) => n.type === "tenant_ai_cap_notice");

beforeEach(async () => {
  fx = await createFixture();
  vi.stubEnv("AI_USD_PER_EUR", "1");
  vi.stubEnv("AI_TENANT_GYM_CAPS_EUR", JSON.stringify({ b50: 10, b100: 20, b150: 30, b300: 40, b500: 50, b501: 60 }));
});
afterEach(() => {
  vi.unstubAllEnvs();
  fx.cleanup();
});

describe("the AI allowance notice job", () => {
  it("is silent below 80%, then tells the gym's admins at 80% and again at 100%, once each", async () => {
    const { tenantAiCapNoticeJob } = await import("@/lib/jobs/tenant-ai-cap-notice");
    gymB();
    spend(fx.memberB.id, 5); // 50%
    await tenantAiCapNoticeJob.run();
    expect(notices(fx.adminB.id)).toHaveLength(0);

    spend(fx.memberB.id, 3.5); // 85%
    await tenantAiCapNoticeJob.run();
    await tenantAiCapNoticeJob.run(); // a second run the same month adds nothing
    expect(notices(fx.adminB.id)).toHaveLength(1);
    expect(notices(fx.adminB.id)[0].title).toMatch(/80%/);

    spend(fx.adminB.id, 2); // staff use counts too: 105%
    await tenantAiCapNoticeJob.run();
    await tenantAiCapNoticeJob.run();
    const all = notices(fx.adminB.id);
    expect(all).toHaveLength(2);
    expect(all.some((n) => /used all/.test(n.title))).toBe(true);
  });

  it("never tells S&C's own admins, and does nothing when no allowances are set", async () => {
    const { tenantAiCapNoticeJob } = await import("@/lib/jobs/tenant-ai-cap-notice");
    gymB();
    spend(fx.memberB.id, 20);
    spend(fx.memberA.id, 20);
    await tenantAiCapNoticeJob.run();
    expect(notices(fx.adminA.id)).toHaveLength(0);

    vi.stubEnv("AI_TENANT_GYM_CAPS_EUR", "");
    const before = notices(fx.adminB.id).length;
    await tenantAiCapNoticeJob.run();
    expect(notices(fx.adminB.id)).toHaveLength(before);
  });

  it("the gym usage figure counts only the last 30 days and only that gym's people", async () => {
    const { gymAiUsage } = await import("@/lib/ai-gym-cap");
    gymB();
    spend(fx.memberB.id, 4);
    spend(fx.memberA.id, 9);
    fx.db.createAiUsageLog({ id: "old", userId: fx.memberB.id, feature: "coach_chat", model: "m", inputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 0, costUsd: 50, allowanceKind: "free", createdAt: new Date(Date.now() - 40 * 86_400_000).toISOString() } as never);
    const u = gymAiUsage(GYM_B)!;
    expect(u.spentUsd).toBeCloseTo(4, 5);
    expect(u.share).toBeCloseTo(0.4, 5);
  });
});
