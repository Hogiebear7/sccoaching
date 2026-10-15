// Member-initiated account deletion (POST /api/account/delete), required by the Apple App Store and Google Play account-deletion policies.
//
// REAL route, REAL datastore code, a REAL temporary datastore, fake accounts only. Nothing here contacts a payment provider: the route only
// reads the subscription row, refuses while a paid subscription is live, and otherwise reuses the same deleteUserAndOwnedRecords that the staff
// hard delete uses (lib/db.ts), so Google Play purchase records are anonymised and a running Play entitlement refuses the deletion.
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createFixture, type IapFixture } from "../helpers/iap-fixture";
import { hashPassword } from "@/lib/password";

let fx: IapFixture;
const PASSWORD = "Delete-me-123!";

async function remove(cookie: string | undefined, body: unknown) {
  const { POST } = await import("@/app/api/account/delete/route");
  return POST(
    new NextRequest("http://localhost/api/account/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
      body: JSON.stringify(body),
    })
  );
}

const confirm = (extra: Record<string, unknown> = {}) => ({ password: PASSWORD, confirm: "DELETE", ...extra });
const exists = (id: string) => !!fx.db.findUserById(id);

beforeEach(async () => {
  fx = await createFixture();
  for (const u of [fx.memberA, fx.memberB, fx.adminA]) fx.db.updateUserPassword(u.id, hashPassword(PASSWORD));
});
afterEach(() => fx.cleanup());

describe("who can call it, and what they must prove", () => {
  it("refuses an unauthenticated request (401) and changes nothing", async () => {
    const res = await remove(undefined, confirm());
    expect(res.status).toBe(401);
    expect(exists(fx.memberA.id)).toBe(true);
  });

  it("requires the password and the typed confirmation word (400), and deletes nothing without them", async () => {
    expect((await remove(fx.cookie(fx.memberA.id), { confirm: "DELETE" })).status).toBe(400);
    expect((await remove(fx.cookie(fx.memberA.id), { password: PASSWORD })).status).toBe(400);
    expect((await remove(fx.cookie(fx.memberA.id), confirm({ confirm: "delete" }))).status).toBe(400);
    expect((await remove(fx.cookie(fx.memberA.id), confirm({ confirm: "yes" }))).status).toBe(400);
    expect(exists(fx.memberA.id)).toBe(true);
  });

  it("refuses a wrong password with 403 (never 401, which would sign a mobile member out) and keeps the account", async () => {
    const res = await remove(fx.cookie(fx.memberA.id), confirm({ password: "Not-the-password-1!" }));
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("invalid_password");
    expect(exists(fx.memberA.id)).toBe(true);
  });

  it("refuses staff and admin accounts (403 staff_account): their removal belongs to a gym administrator", async () => {
    const res = await remove(fx.cookie(fx.adminA.id), confirm());
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("staff_account");
    expect(exists(fx.adminA.id)).toBe(true);
  });

  it("is rate limited per account: after five attempts the sixth is 429, even with the right password", async () => {
    for (let i = 0; i < 5; i++) expect((await remove(fx.cookie(fx.memberA.id), confirm({ password: "Wrong-password-9!" }))).status).toBe(403);
    expect((await remove(fx.cookie(fx.memberA.id), confirm())).status).toBe(429);
    expect(exists(fx.memberA.id)).toBe(true);
  });
});

describe("a successful deletion", () => {
  it("removes the member and the data they own, signs them out, and leaves everyone else untouched", async () => {
    const id = fx.memberA.id;
    fx.setSubscription(id, { packageId: fx.ids.membershipPackage, provider: "none", status: "active" });
    fx.db.createBugReport({ id: "bug-a", userId: id, description: "fake report", screenshots: [], status: "open", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" } as never);
    fx.db.createBugReport({ id: "bug-b", userId: fx.memberB.id, description: "someone else's", screenshots: [], status: "open", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" } as never);
    expect(fx.db.findSubscriptionByUserId(id)).toBeDefined();

    const res = await remove(fx.cookie(id), confirm());
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);

    expect(exists(id)).toBe(false);
    expect(fx.db.findSubscriptionByUserId(id)).toBeUndefined();
    expect(fx.db.findAllBugReports().map((b) => b.id)).toEqual(["bug-b"]);

    // Signed out: the session cookie is cleared, and the old token no longer authenticates anything.
    expect(res.headers.get("set-cookie") ?? "").toMatch(/session=;|session=\s*;|Max-Age=0|Expires=Thu, 01 Jan 1970/i);
    expect((await remove(fx.cookie(id), confirm())).status).toBe(401);

    // Other accounts and their data are intact.
    expect(exists(fx.memberB.id)).toBe(true);
    expect(exists(fx.adminA.id)).toBe(true);
    expect(exists(fx.adminB.id)).toBe(true);
  });

  it("only ever deletes the signed-in account: a user id in the body is ignored", async () => {
    const res = await remove(fx.cookie(fx.memberA.id), confirm({ userId: fx.memberB.id, id: fx.memberB.id }));
    expect(res.status).toBe(200);
    expect(exists(fx.memberA.id)).toBe(false);
    expect(exists(fx.memberB.id)).toBe(true);
  });

  it("is not blocked by a manual, gym-granted plan (provider none) or an already-cancelled paid plan", async () => {
    fx.setSubscription(fx.memberA.id, { packageId: fx.ids.membershipPackage, provider: "none", status: "active" });
    expect((await remove(fx.cookie(fx.memberA.id), confirm())).status).toBe(200);

    fx.setSubscription(fx.memberB.id, { packageId: fx.ids.gymBMembershipPackage, provider: "stripe", status: "canceled", providerSubscriptionId: "sub_fake" });
    expect((await remove(fx.cookie(fx.memberB.id), confirm())).status).toBe(200);
  });
});

describe("a live paid subscription blocks deletion until it ends (nothing is cancelled or refunded)", () => {
  for (const provider of ["stripe", "revolut"] as const) {
    for (const status of ["active", "past_due", "paused"] as const) {
      it(`${provider} ${status}: 409 active_subscription, account kept`, async () => {
        fx.setSubscription(fx.memberA.id, { packageId: fx.ids.membershipPackage, provider, status, providerSubscriptionId: "sub_fake" });
        const res = await remove(fx.cookie(fx.memberA.id), confirm());
        expect(res.status).toBe(409);
        expect((await res.json()).code).toBe("active_subscription");
        expect(exists(fx.memberA.id)).toBe(true);
        expect(fx.db.findSubscriptionByUserId(fx.memberA.id)?.status).toBe(status);
      });
    }
  }

  it("a checkout still in flight (pending): 409 payment_in_progress, account kept", async () => {
    fx.setSubscription(fx.memberA.id, { packageId: fx.ids.membershipPackage, provider: "stripe", status: "pending" });
    const res = await remove(fx.cookie(fx.memberA.id), confirm());
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("payment_in_progress");
    expect(exists(fx.memberA.id)).toBe(true);
  });

  it("a running Google Play entitlement is refused by the datastore guard (409, self-service wording), account and purchase kept", async () => {
    fx.setSubscription(fx.memberA.id, { packageId: fx.ids.appPackage, provider: "google_play", status: "active", providerSubscriptionId: "play_fake" });
    const res = await remove(fx.cookie(fx.memberA.id), confirm());
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("active_subscription");
    expect(body.message).toMatch(/^You have an active Google Play subscription/);
    expect(JSON.stringify(body)).not.toMatch(/token|order|member has/i);
    expect(exists(fx.memberA.id)).toBe(true);
  });
});
