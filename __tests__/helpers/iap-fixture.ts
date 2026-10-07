// Shared fixture for tests that run REAL route handlers against a REAL datastore file in a
// temporary directory. lib/db.ts reads DATA_DIR once at import, so every fixture points DATA_DIR at
// a fresh directory, resets the module registry, and imports the datastore again. Routes imported
// AFTER createFixture() therefore see this fixture's data.
//
// Fake ids and fake tokens only. Nothing here talks to a network or a provider.
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { vi } from "vitest";

import { MEMBER_SESSION_LIFETIME_MS, signSession } from "@/lib/session";

type Db = typeof import("@/lib/db");

export const GYM_B = "gym-b";
const T = "2026-01-01T00:00:00.000Z";

export interface IapFixture {
  db: Db;
  dir: string;
  /** Primary-gym admin_manager. */
  adminA: { id: string };
  /** Gym B admin_manager. */
  adminB: { id: string };
  /** Primary-gym member with no subscription row yet. */
  memberA: { id: string };
  /** Gym B member. */
  memberB: { id: string };
  ids: {
    membershipPackage: string;
    membershipOption: string;
    appPackage: string;
    appOption: string;
    gymBMembershipPackage: string;
  };
  cookie: (userId: string) => string;
  /** Replaces the user's one subscription row. */
  setSubscription: (userId: string, over: Partial<import("@/lib/db").SubscriptionRecord> & { packageId: string | null }) => void;
  cleanup: () => void;
}

export async function createFixture(): Promise<IapFixture> {
  const dir = mkdtempSync(path.join(tmpdir(), "iap-fixture-"));
  process.env.DATA_DIR = dir;
  vi.resetModules();
  const db: Db = await import("@/lib/db");

  db.saveMembershipCategory({ id: "cat-primary", gymId: null, name: "Primary", slug: "primary", description: null, sortOrder: 1, visible: true, createdAt: T, updatedAt: T });
  db.saveMembershipCategory({ id: "cat-gym-b", gymId: GYM_B, name: "Gym B", slug: "gym-b", description: null, sortOrder: 1, visible: true, createdAt: T, updatedAt: T });
  db.saveMembershipCategory({ id: "cat-platform", gymId: null, name: "Platform", slug: "platform", description: null, sortOrder: 9, visible: false, createdAt: T, updatedAt: T });

  const pkg = (id: string, categoryId: string, delivery: "in_person" | "app_only", extra: Partial<import("@/lib/db").MembershipPackageRecord> = {}) =>
    db.saveMembershipPackage({
      id,
      categoryId,
      name: id,
      slug: id,
      shortDescription: null,
      fullDescription: null,
      packageType: "membership",
      sessionAllowanceType: "unlimited",
      sessionAllowanceCount: null,
      eligibleClassTypes: [],
      visible: true,
      sortOrder: 1,
      stripeProductId: null,
      deliveryChannel: delivery,
      billingChannel: delivery === "app_only" ? "google_play" : "stripe_web",
      accessType: delivery === "app_only" ? "subscription" : "membership",
      createdAt: T,
      updatedAt: T,
      ...extra,
    });
  pkg("pkg-membership", "cat-primary", "in_person");
  pkg("pkg-gym-b", "cat-gym-b", "in_person");
  pkg("pkg-app", "cat-platform", "app_only", { slug: "app-subscription-tier-2", visible: false });

  const option = (id: string, packageId: string, extra: Partial<import("@/lib/db").MembershipBillingOptionRecord> = {}) =>
    db.saveMembershipBillingOption({
      id,
      packageId,
      name: id,
      billingType: "recurring",
      intervalUnit: "month",
      intervalCount: 1,
      amountCents: 4900,
      currency: "gbp",
      visible: true,
      sortOrder: 1,
      stripePriceId: "price_fake",
      createdAt: T,
      updatedAt: T,
      ...extra,
    });
  option("opt-membership", "pkg-membership");
  option("opt-app", "pkg-app", { googlePlaySubscriptionId: "app_subscription", googlePlayBasePlanId: "monthly", stripePriceId: null });

  const adminA = db.createUserWithRole("admin-a@example.test", "x", "admin_manager", null);
  const adminB = db.createUserWithRole("admin-b@example.test", "x", "admin_manager", GYM_B);
  const memberA = db.createUserWithRole("member-a@example.test", "x", "member", null);
  const memberB = db.createUserWithRole("member-b@example.test", "x", "member", GYM_B);

  const setSubscription: IapFixture["setSubscription"] = (userId, over) => {
    const now = new Date().toISOString();
    db.saveSubscription({
      userId,
      billingOptionId: null,
      status: "active",
      pausedUntil: null,
      statusBeforePause: null,
      provider: "none",
      providerCustomerId: null,
      providerSubscriptionId: null,
      providerSetupOrderId: null,
      currentPeriodEnd: "2099-01-01T00:00:00.000Z",
      lastWebhookEventAt: null,
      sessionsUsedThisPeriod: 0,
      extraSessionGrants: [],
      periodLapsedNotifiedAt: null,
      ownerGym: over.packageId === "pkg-app" ? { scope: "platform" } : { scope: "gym", gymId: null },
      createdAt: now,
      updatedAt: now,
      ...over,
    });
  };

  return {
    db,
    dir,
    adminA,
    adminB,
    memberA,
    memberB,
    ids: {
      membershipPackage: "pkg-membership",
      membershipOption: "opt-membership",
      appPackage: "pkg-app",
      appOption: "opt-app",
      gymBMembershipPackage: "pkg-gym-b",
    },
    cookie: (userId) => `session=${signSession({ userId }, MEMBER_SESSION_LIFETIME_MS)}`,
    setSubscription,
    cleanup: () => {
      delete process.env.DATA_DIR;
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
