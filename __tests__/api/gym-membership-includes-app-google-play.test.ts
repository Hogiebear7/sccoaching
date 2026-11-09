// Google Play half of "no store purchase for a member who already has the features" (the App Store half is in gym-membership-includes-app.test.ts).
// Real route, real datastore file, mocked store. Fake ids only.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createPlayFixture, type PlayFixture } from "../helpers/iap-play-fixture";

let fx: PlayFixture;

beforeEach(async () => {
  fx = await createPlayFixture();
});
afterEach(() => {
  vi.unstubAllEnvs();
  fx.cleanup();
});

describe("Google Play purchase context and the gym Membership bundle", () => {
  it("ON: a member whose gym Membership includes the App features gets a plain refusal and no purchase binding", async () => {
    vi.stubEnv("GYM_MEMBERSHIP_INCLUDES_APP", "true");
    fx.setSubscription(fx.memberA.id, { packageId: fx.ids.membershipPackage, status: "active" });
    const res = await fx.context(fx.memberA.id);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body).toMatchObject({ success: false, code: "included_with_membership", message: "Your gym Membership already includes the App features, so there is nothing to buy." });
    expect(JSON.stringify(body)).not.toMatch(/obfuscatedAccountId/);
  });

  it("ON: a member without a Membership can still start a purchase", async () => {
    vi.stubEnv("GYM_MEMBERSHIP_INCLUDES_APP", "true");
    expect((await fx.context(fx.memberB.id)).status).toBe(200);
  });

  it("OFF: a gym member can still start a purchase, as before (decision D1)", async () => {
    fx.setSubscription(fx.memberA.id, { packageId: fx.ids.membershipPackage, status: "active" });
    expect((await fx.context(fx.memberA.id)).status).toBe(200);
  });
});
