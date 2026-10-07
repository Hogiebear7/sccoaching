// The atomic datastore helpers for App Subscription state (lib/db.ts), run against a REAL datastore
// file in a temporary directory. DATA_DIR is read once when lib/db.ts loads, so each test points it
// at a fresh directory and re-imports the module. Fake tokens only; no provider is contacted.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Db = typeof import("@/lib/db");

let dir: string;
let db: Db;

const loadDb = async (): Promise<Db> => {
  vi.resetModules();
  process.env.DATA_DIR = dir;
  return import("@/lib/db");
};
const rawFile = () => JSON.parse(readFileSync(path.join(dir, "db.json"), "utf8"));

const TOKEN_A = "fake-token-aaaaaaaaaaaaaaaaaaaa";
const TOKEN_B = "fake-token-bbbbbbbbbbbbbbbbbbbb";

const claimInput = (purchaseToken: string): Parameters<Db["claimGooglePlayPurchase"]>[0] => ({
  purchaseToken,
  productId: "app_subscription",
  basePlanId: "monthly",
  orderId: "GPA.fake-1",
  linkedPurchaseToken: null,
  status: "active",
  acknowledged: false,
  autoRenewing: true,
  startTimeMillis: 1_700_000_000_000,
  expiryTimeMillis: 1_800_000_000_000,
  obfuscatedExternalAccountId: "binding-hash",
  acknowledgementState: "pending",
});

beforeEach(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "iap-datastore-"));
  db = await loadDb();
});
afterEach(() => {
  delete process.env.DATA_DIR;
  rmSync(dir, { recursive: true, force: true });
});

describe("claimGooglePlayPurchase: first valid binding wins", () => {
  it("binds a new token to the claiming account and writes one purchase_claimed event", () => {
    const result = db.claimGooglePlayPurchase(claimInput(TOKEN_A), "user-1");
    expect(result.status).toBe("claimed");
    if (result.status !== "claimed") return;
    expect(result.purchase).toMatchObject({ userId: "user-1", purchaseToken: TOKEN_A, purchaseTokenHash: db.hashPurchaseToken(TOKEN_A) });
    expect(result.purchase.boundAt).toBe(result.purchase.createdAt);

    const events = db.findIapEvents({ userId: "user-1" });
    expect(events.map((e) => e.type)).toEqual(["purchase_claimed"]);
  });

  it("is idempotent for the same account: returns the existing row unchanged and writes no event", () => {
    const first = db.claimGooglePlayPurchase(claimInput(TOKEN_A), "user-1");
    const again = db.claimGooglePlayPurchase({ ...claimInput(TOKEN_A), status: "expired" }, "user-1");
    expect(again.status).toBe("existing");
    if (first.status === "claimed" && again.status === "existing") {
      expect(again.purchase).toEqual(first.purchase);
      expect(again.purchase.status).toBe("active");
    }
    expect(db.findIapEvents().length).toBe(1);
    expect(rawFile().googlePlayPurchases).toHaveLength(1);
  });

  it("rejects a token already bound to another account and never reassigns it", () => {
    db.claimGooglePlayPurchase(claimInput(TOKEN_A), "user-1");
    const rival = db.claimGooglePlayPurchase(claimInput(TOKEN_A), "user-2");
    expect(rival.status).toBe("owned_by_other");
    expect(db.findGooglePlayPurchaseByToken(TOKEN_A)?.userId).toBe("user-1");
    expect(db.findGooglePlayPurchasesByUserId("user-2")).toEqual([]);
    expect(db.findIapEvents({ type: "claim_rejected_owner" }).map((e) => e.userId)).toEqual(["user-2"]);
  });

  it("keeps one row per token however many accounts race for it", () => {
    for (const user of ["u1", "u2", "u3", "u4"]) db.claimGooglePlayPurchase(claimInput(TOKEN_A), user);
    expect(rawFile().googlePlayPurchases).toHaveLength(1);
    expect(rawFile().googlePlayPurchases[0].userId).toBe("u1");
  });

  it("lets different tokens belong to different accounts", () => {
    db.claimGooglePlayPurchase(claimInput(TOKEN_A), "user-1");
    expect(db.claimGooglePlayPurchase(claimInput(TOKEN_B), "user-2").status).toBe("claimed");
  });

  it("never writes the raw purchase token into the audit log, only its hash", () => {
    db.claimGooglePlayPurchase(claimInput(TOKEN_A), "user-1");
    db.claimGooglePlayPurchase(claimInput(TOKEN_A), "user-2");
    const eventsJson = JSON.stringify(rawFile().iapEvents);
    expect(eventsJson).not.toContain(TOKEN_A);
    expect(eventsJson).toContain(db.hashPurchaseToken(TOKEN_A));
  });
});

describe("applyGooglePlayPurchaseSnapshot: ordering", () => {
  beforeEach(() => {
    db.claimGooglePlayPurchase(claimInput(TOKEN_A), "user-1");
  });

  it("applies a first snapshot and records when it was taken", () => {
    const result = db.applyGooglePlayPurchaseSnapshot(TOKEN_A, { status: "in_grace_period" }, "2026-10-07T10:00:00.000Z");
    expect(result.status).toBe("applied");
    expect(db.findGooglePlayPurchaseByToken(TOKEN_A)).toMatchObject({ status: "in_grace_period", lastSnapshotAt: "2026-10-07T10:00:00.000Z" });
  });

  it("rejects an older snapshot arriving late and leaves the newer state alone", () => {
    db.applyGooglePlayPurchaseSnapshot(TOKEN_A, { status: "expired" }, "2026-10-07T11:00:00.000Z");
    const late = db.applyGooglePlayPurchaseSnapshot(TOKEN_A, { status: "active" }, "2026-10-07T10:59:59.000Z");
    expect(late.status).toBe("stale");
    expect(db.findGooglePlayPurchaseByToken(TOKEN_A)?.status).toBe("expired");
    expect(db.findIapEvents({ type: "notification_stale" })).toHaveLength(1);
  });

  it("accepts an equal timestamp so a retry of the same snapshot is idempotent", () => {
    const at = "2026-10-07T10:00:00.000Z";
    db.applyGooglePlayPurchaseSnapshot(TOKEN_A, { status: "expired" }, at);
    expect(db.applyGooglePlayPurchaseSnapshot(TOKEN_A, { status: "expired" }, at).status).toBe("applied");
  });

  it("answers unknown_token without writing anything for a token nobody claimed", () => {
    const before = readFileSync(path.join(dir, "db.json"), "utf8");
    expect(db.applyGooglePlayPurchaseSnapshot("never-claimed", { status: "active" }, "2026-10-07T10:00:00.000Z").status).toBe("unknown_token");
    expect(readFileSync(path.join(dir, "db.json"), "utf8")).toBe(before);
  });

  it("cannot change ownership: userId, token and boundAt are not reachable through a snapshot", () => {
    const sneaky = { status: "active", userId: "attacker", purchaseToken: "other", boundAt: "1999-01-01T00:00:00.000Z" } as never;
    db.applyGooglePlayPurchaseSnapshot(TOKEN_A, sneaky, "2026-10-07T10:00:00.000Z");
    const row = db.findGooglePlayPurchaseByToken(TOKEN_A);
    expect(row?.userId).toBe("user-1");
    expect(row?.purchaseToken).toBe(TOKEN_A);
    expect(row?.boundAt).not.toBe("1999-01-01T00:00:00.000Z");
    expect(row?.status).toBe("active");
  });
});

describe("claimIapNotification: message-id idempotency", () => {
  it("processes a new message once, retries one that never completed, and skips a completed one", () => {
    expect(db.claimIapNotification("msg-1")).toEqual({ status: "new", attempts: 1 });
    expect(db.claimIapNotification("msg-1")).toEqual({ status: "retry", attempts: 2 });
    expect(db.completeIapNotification("msg-1", "applied")).toBe(true);
    expect(db.claimIapNotification("msg-1")).toEqual({ status: "duplicate" });
    expect(db.findIapNotification("msg-1")).toMatchObject({ outcome: "applied", attempts: 2 });
  });

  it("returns false when completing a message that was never claimed", () => {
    expect(db.completeIapNotification("unknown", "applied")).toBe(false);
  });

  it("prunes processed rows older than 30 days and keeps unprocessed ones", () => {
    const old = new Date("2026-08-01T00:00:00.000Z");
    const now = new Date("2026-10-07T00:00:00.000Z");
    db.claimIapNotification("old-done", old);
    db.completeIapNotification("old-done", "applied", old);
    db.claimIapNotification("old-pending", old);
    db.claimIapNotification("fresh", now);
    expect(db.findIapNotification("old-done")).toBeUndefined();
    expect(db.findIapNotification("old-pending")).toBeDefined();
  });
});

describe("appendIapEvent and sanitizeIapDetail", () => {
  it("appends in order and never rewrites an earlier event", () => {
    const a = db.appendIapEvent({ type: "staff_write_rejected", userId: "u", actor: "staff", detail: { code: "membership_active" } });
    db.appendIapEvent({ type: "reconciliation_run", userId: null, actor: "system" });
    const events = db.findIapEvents();
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual(a);
  });

  it("drops secret-like and personal keys, truncates long strings and caps the key count", () => {
    const detail = db.sanitizeIapDetail({
      code: "x",
      purchaseToken: "SECRET",
      authorization: "Bearer abc",
      email: "a@b.c",
      fullName: "A B",
      long: "y".repeat(500),
      "bad key!": 1,
      nested: { a: 1 },
      n: 3,
      flag: true,
      nothing: null,
      nan: Number.NaN,
    });
    expect(detail).toEqual({ code: "x", long: "y".repeat(120), n: 3, flag: true, nothing: null });
    const many = db.sanitizeIapDetail(Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`k${i}`, i])));
    expect(Object.keys(many)).toHaveLength(12);
  });

  it("hashes a raw token rather than storing it", () => {
    db.appendIapEvent({ type: "claim_rejected_binding", userId: "u", purchaseToken: TOKEN_A, actor: "user" });
    expect(JSON.stringify(rawFile().iapEvents)).not.toContain(TOKEN_A);
    expect(db.findIapEvents({ purchaseTokenHash: db.hashPurchaseToken(TOKEN_A) })).toHaveLength(1);
  });
});

describe("backward compatibility: an existing datastore file loads unchanged", () => {
  it("defaults the new collections and leaves legacy purchase rows readable without the new fields", async () => {
    writeFileSync(
      path.join(dir, "db.json"),
      JSON.stringify({
        users: [],
        googlePlayPurchases: [
          { id: "p1", userId: "legacy-user", purchaseToken: TOKEN_B, productId: "x", basePlanId: null, orderId: null, linkedPurchaseToken: null, status: "active", acknowledged: true, autoRenewing: true, startTimeMillis: null, expiryTimeMillis: null, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
        ],
      })
    );
    db = await loadDb();
    const legacy = db.findGooglePlayPurchaseByToken(TOKEN_B);
    expect(legacy?.userId).toBe("legacy-user");
    expect(legacy?.purchaseTokenHash).toBeUndefined();
    expect(db.findIapEvents()).toEqual([]);
    // A legacy row's owner is still protected: another account cannot claim its token.
    expect(db.claimGooglePlayPurchase(claimInput(TOKEN_B), "someone-else").status).toBe("owned_by_other");
    expect(db.claimGooglePlayPurchase(claimInput(TOKEN_B), "legacy-user").status).toBe("existing");
  });
});
