// A cap on one tenant gym's whole AI use (lib/ai-gym-cap.ts, reserveAiBudget's gymPool): a big gym cannot use up what everyone else was meant to have, S&C's own gym is not
// affected, a bigger band gets a bigger cap, and nothing changes when the setting is not there. Real datastore and real reservation; amounts are TEST values.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createFixture, GYM_B, type IapFixture } from "../helpers/iap-fixture";

const DAY = 86_400_000;
const T = "2026-01-01T00:00:00.000Z";
const CAPS = JSON.stringify({ b50: 1, b100: 2, b150: 3, b300: 4, b500: 5, b501: 6 });
let fx: IapFixture;

function gymB(band?: "b50" | "b100") {
  fx.db.createGym({
    id: GYM_B, slug: "gym-b", name: "Gym B", tagline: null, description: null, ownerUserId: fx.adminB.id, contactEmail: "b@example.test", contactPhone: null,
    addressLine: "", latitude: null, longitude: null, status: "active", createdAt: T, updatedAt: T,
    ...(band ? { platformBilling: { paidThrough: "2099-01-01", band } } : {}),
  });
}

function spend(userId: string, usd: number, ageMs = 0) {
  fx.db.createAiUsageLog({ id: `l_${Math.random()}`, userId, feature: "coach_chat", model: "m", inputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 0, costUsd: usd, allowanceKind: "free", createdAt: new Date(Date.now() - ageMs).toISOString() } as never);
}

async function reserve(userId: string, reserveUsd: number, cap: { gymId: string; usd: number } | null) {
  return fx.db.reserveAiBudget({ userId, feature: "coach_chat", kind: "free", reserveUsd, budgetUsd: 1000, windowMs: 30 * DAY, gymPool: cap, ttlMs: 60_000 });
}

beforeEach(async () => {
  fx = await createFixture();
  vi.stubEnv("AI_USD_PER_EUR", "1");
});
afterEach(() => {
  vi.unstubAllEnvs();
  fx.cleanup();
});

describe("the per-gym AI cap setting", () => {
  it("needs all six bands as plain numbers, otherwise it is off", async () => {
    const { parseGymAiCaps } = await import("@/lib/ai-gym-cap");
    expect(parseGymAiCaps(CAPS)?.b300).toBe(4);
    expect(parseGymAiCaps(undefined)).toBeNull();
    expect(parseGymAiCaps("nope")).toBeNull();
    expect(parseGymAiCaps(JSON.stringify({ b50: 1 }))).toBeNull();
    expect(parseGymAiCaps(JSON.stringify({ b50: 1, b100: 2, b150: 3, b300: 4, b500: "5", b501: 6 }))).toBeNull();
  });

  it("applies to a tenant gym's users by band, never to S&C's own gym, and not at all when unset", async () => {
    const { tenantGymAiCap } = await import("@/lib/ai-gym-cap");
    gymB("b100");
    expect(tenantGymAiCap(fx.memberB.id)).toBeNull(); // unset
    vi.stubEnv("AI_TENANT_GYM_CAPS_EUR", CAPS);
    expect(tenantGymAiCap(fx.memberB.id)).toEqual({ gymId: GYM_B, usd: 2 });
    expect(tenantGymAiCap(fx.memberA.id)).toBeNull(); // S&C's own gym
    expect(tenantGymAiCap(null)).toBeNull();
  });

  it("a tenant gym with no band yet is held to the smallest cap", async () => {
    const { tenantGymAiCap } = await import("@/lib/ai-gym-cap");
    gymB(); // not billed
    vi.stubEnv("AI_TENANT_GYM_CAPS_EUR", CAPS);
    expect(tenantGymAiCap(fx.memberB.id)).toEqual({ gymId: GYM_B, usd: 1 });
  });
});

describe("the gym ceiling in the reservation", () => {
  it("stops a gym once its users together have used the cap, whoever used it", async () => {
    gymB("b50");
    const cap = { gymId: GYM_B, usd: 1 };
    spend(fx.memberB.id, 0.6);
    spend(fx.adminB.id, 0.35); // staff of the gym count too
    expect((await reserve(fx.memberB.id, 0.01, cap)).ok).toBe(true);
    const over = await reserve(fx.memberB.id, 0.2, cap);
    expect(over.ok).toBe(false);
    expect((over as { limit: string }).limit).toBe("pool");
  });

  it("counts held reservations as well, so many calls at once cannot slip past", async () => {
    gymB("b50");
    const cap = { gymId: GYM_B, usd: 1 };
    expect((await reserve(fx.memberB.id, 0.6, cap)).ok).toBe(true);
    expect((await reserve(fx.adminB.id, 0.6, cap)).ok).toBe(false);
  });

  it("only looks at the last 30 days", async () => {
    gymB("b50");
    spend(fx.memberB.id, 5, 40 * DAY);
    expect((await reserve(fx.memberB.id, 0.5, { gymId: GYM_B, usd: 1 })).ok).toBe(true);
  });

  it("one gym's spending never uses up another's ceiling, or S&C's own", async () => {
    gymB("b50");
    spend(fx.memberB.id, 5);
    expect((await reserve(fx.memberA.id, 0.5, null)).ok).toBe(true); // S&C's own member, no gym cap
    expect((await reserve(fx.memberA.id, 0.5, { gymId: "some-other-gym", usd: 1 })).ok).toBe(true);
  });
});
