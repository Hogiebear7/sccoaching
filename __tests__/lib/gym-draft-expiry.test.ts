// An unpaid new gym keeps its saved setup 24 hours after it was last used (once +3 days if the owner asks), then it is removed. Real datastore; the gate and cleanup switches are test values.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { canExtendDraft, draftCountdownText, draftExpiresAt, draftState, extensionUntil } from "@/lib/gym-draft-expiry";
import { createFixture, GYM_B, type IapFixture } from "../helpers/iap-fixture";

const H = 3_600_000;
const created = "2026-12-01T10:00:00.000Z";
const at = (hours: number) => new Date(Date.parse(created) + hours * H);

describe("the rules", () => {
  it("expires 24 hours after the last use, or after creation when never used", () => {
    expect(draftExpiresAt({ createdAt: created }).toISOString()).toBe(at(24).toISOString());
    expect(draftExpiresAt({ createdAt: created, draftLastActivityAt: at(5).toISOString() }).toISOString()).toBe(at(29).toISOString());
  });
  it("is keeping, then warns in the last 12 hours, then expired", () => {
    const gym = { createdAt: created };
    expect(draftState(gym, at(1))).toBe("keeping");
    expect(draftState(gym, at(13))).toBe("warn");
    expect(draftState(gym, at(23.9))).toBe("warn");
    expect(draftState(gym, at(24))).toBe("expired");
  });
  it("the extra 3 days can be asked for once and never shorten the time", () => {
    const gym = { createdAt: created, draftExtendedUntil: extensionUntil(at(10)) };
    expect(canExtendDraft({})).toBe(true);
    expect(canExtendDraft(gym)).toBe(false);
    expect(draftExpiresAt(gym).toISOString()).toBe(at(10 + 72).toISOString());
    // activity after the extension that pushes past it wins
    expect(draftExpiresAt({ ...gym, draftLastActivityAt: at(100).toISOString() }).toISOString()).toBe(at(124).toISOString());
    expect(draftState(gym, at(60))).toBe("keeping");
  });
  it("a started payment gets extra time", () => {
    expect(draftExpiresAt({ createdAt: created, pendingStripeCustomerId: "cus_x" }).toISOString()).toBe(at(24 + 72).toISOString());
  });
  it("reads plainly", () => {
    expect(draftCountdownText(at(24), at(0))).toBe("24 hours");
    expect(draftCountdownText(at(1.5), at(0))).toBe("about an hour");
    expect(draftCountdownText(at(0.25), at(0))).toBe("15 minutes");
    expect(draftCountdownText(at(100), at(0))).toBe("4 days");
  });
});

let fx: IapFixture;
const T = "2026-01-01T00:00:00.000Z";

function gymB(over: Record<string, unknown> = {}) {
  fx.db.createGym({
    id: GYM_B, slug: "gym-b", name: "Gym B", tagline: null, description: null, ownerUserId: fx.adminB.id, contactEmail: "b@example.test", contactPhone: null,
    addressLine: "", latitude: null, longitude: null, status: "pending", createdAt: created, updatedAt: T, ...over,
  } as never);
}

beforeEach(async () => {
  fx = await createFixture();
  // Gym B has no real members here: it is a brand-new gym with an owner and some setup.
  fx.db.deleteUserAndOwnedRecords(fx.memberB.id);
  vi.stubEnv("TENANT_PAYMENT_GATE_ENABLED", "true");
});
afterEach(() => {
  vi.unstubAllEnvs();
  fx.cleanup();
});

describe("removing an expired unpaid gym", () => {
  it("removes the gym's setup and accounts and nothing else, once it has run out", async () => {
    gymB();
    const { deleteExpiredDraftGym } = await import("@/lib/gym-draft-cleanup");
    const result = await deleteExpiredDraftGym(GYM_B, at(30));
    expect(result.deleted).toBe(true);
    expect(fx.db.findGymById(GYM_B)).toBeUndefined();
    expect(fx.db.findUserById(fx.adminB.id)).toBeUndefined();
    expect(fx.db.findMembershipCategoryById("cat-gym-b")).toBeUndefined();
    expect(fx.db.findMembershipPackageById("pkg-gym-b")).toBeUndefined();
    // The primary gym and its people are untouched.
    expect(fx.db.findUserById(fx.adminA.id)).toBeDefined();
    expect(fx.db.findMembershipPackageById("pkg-membership")).toBeDefined();
  });

  it("does nothing before the time is up, with the gate off, or for a gym that has billing or a member", async () => {
    const { deleteExpiredDraftGym } = await import("@/lib/gym-draft-cleanup");
    gymB();
    expect(await deleteExpiredDraftGym(GYM_B, at(5))).toMatchObject({ deleted: false, reason: "not expired yet" });
    vi.stubEnv("TENANT_PAYMENT_GATE_ENABLED", "false");
    expect(await deleteExpiredDraftGym(GYM_B, at(30))).toMatchObject({ deleted: false });
    vi.stubEnv("TENANT_PAYMENT_GATE_ENABLED", "true");
    expect(fx.db.findGymById(GYM_B)).toBeDefined();

    // a paid gym is never removed
    const gym = fx.db.findGymById(GYM_B)!;
    fx.db.saveGym({ ...gym, platformBilling: { paidThrough: "2027-01-01" } } as never);
    expect(await deleteExpiredDraftGym(GYM_B, at(500))).toMatchObject({ deleted: false });
    expect(fx.db.findGymById(GYM_B)).toBeDefined();
    expect(fx.db.findUserById(fx.adminB.id)).toBeDefined();
  });

  it("refuses a gym that has a member, and the primary gym", async () => {
    const { deleteExpiredDraftGym } = await import("@/lib/gym-draft-cleanup");
    gymB();
    const member = fx.db.createUserWithRole("newmember@example.test", "x", "member", GYM_B);
    expect(fx.db.findUserById(member.id)).toBeDefined();
    expect(await deleteExpiredDraftGym(GYM_B, at(30))).toMatchObject({ deleted: false });
    expect(fx.db.findGymById(GYM_B)).toBeDefined();
    expect(await deleteExpiredDraftGym("no-such-gym", at(30))).toMatchObject({ deleted: false });
  });
});

describe("the cleanup job", () => {
  it("only reports until deleting is switched on, then removes the expired gym", async () => {
    gymB({ createdAt: new Date(Date.now() - 48 * H).toISOString() });
    const { unpaidGymCleanupJob } = await import("@/lib/jobs/unpaid-gym-cleanup");

    const dry = await unpaidGymCleanupJob.run();
    expect(dry).toMatch(/would remove 1/);
    expect(fx.db.findGymById(GYM_B)).toBeDefined();

    vi.stubEnv("TENANT_DRAFT_CLEANUP_ENABLED", "true");
    const real = await unpaidGymCleanupJob.run();
    expect(real).toMatch(/removed 1/);
    expect(fx.db.findGymById(GYM_B)).toBeUndefined();
    expect(fx.db.findUserById(fx.adminA.id)).toBeDefined();
  });

  it("warns a gym in its last hours once, and leaves a fresh gym alone", async () => {
    gymB({ createdAt: new Date(Date.now() - 18 * H).toISOString() });
    const { unpaidGymCleanupJob } = await import("@/lib/jobs/unpaid-gym-cleanup");
    expect(await unpaidGymCleanupJob.run()).toMatch(/warned 1/);
    expect(await unpaidGymCleanupJob.run()).toMatch(/warned 0/);
    const notes = fx.db.findNotificationsByUserId(fx.adminB.id).filter((n) => n.type === "tenant_go_live");
    expect(notes).toHaveLength(1);
    expect(fx.db.findGymById(GYM_B)).toBeDefined();
  });
});
