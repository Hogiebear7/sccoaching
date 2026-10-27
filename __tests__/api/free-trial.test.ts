// The 7-day free trial (owner decision 2026-10-16), end to end through the real routes and a real datastore, with the store providers faked.
// MOCKED ONLY: no Apple or Google sandbox has been used. What these prove is OUR handling of what the stores report:
//   - a zero-charge trial is never recorded as revenue (the first paid renewal is);
//   - a trial grants access, shown as a trial, until its end;
//   - cancelling during the trial keeps access to the trial's end and then stops;
//   - conversion to paid is a new period that is no longer a trial and is booked once;
//   - an ineligible subscriber (no offer) is simply the normal paid purchase.
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAppStoreFixture, type AppStoreFixture } from "../helpers/app-store-fixture";
import { createPlayFixture, type PlayFixture } from "../helpers/iap-play-fixture";

const DAY = 86_400_000;

describe("Apple free trial", () => {
  let fx: AppStoreFixture;
  const O = "trial-otx-1";
  const TRIAL_TX = { transactionId: "tx-trial", offerType: 1, offerDiscountType: "FREE_TRIAL", price: 0 };
  const ent = () => fx.db.findDigitalEntitlement(fx.memberA.id, "app_store");
  const access = async () => (await import("@/lib/membership-entitlement")).resolveMemberAccessForUser(fx.memberA.id);
  const revenue = () => fx.db.findAllRevenueEvents().map((e) => [e.provider, e.providerRef]);

  beforeEach(async () => {
    fx = await createAppStoreFixture();
  });
  afterEach(() => fx.cleanup());

  it("a trial grants access, is flagged as a trial, ends at the trial's end, and records NO revenue", async () => {
    const trialEnd = Date.now() + 7 * DAY;
    const res = await fx.claim(fx.memberA.id, O, { tx: { ...TRIAL_TX, expiresDate: trialEnd } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.plan).toMatchObject({ source: "app_store", status: "active", trial: true, autoRenewing: true, currentPeriodEnd: new Date(trialEnd).toISOString() });
    expect(ent()).toMatchObject({ trial: true, status: "active" });
    expect((await access()).digital).toBe(true);
    expect(revenue()).toEqual([]);
    expect(fx.db.findAppStorePurchaseByOriginalTransactionId(O)?.freeTrial).toBe(true);
  });

  it("a zero-price introductory offer is a trial even without the explicit discount type", async () => {
    await fx.claim(fx.memberA.id, O, { tx: { transactionId: "tx-z", offerType: 1, price: 0, expiresDate: Date.now() + 7 * DAY } });
    expect(ent()?.trial).toBe(true);
    expect(revenue()).toEqual([]);
  });

  it("a PAID introductory offer is not a trial: it is booked", async () => {
    await fx.claim(fx.memberA.id, O, { tx: { transactionId: "tx-intro", offerType: 1, offerDiscountType: "PAY_AS_YOU_GO", price: 4990 } });
    expect(ent()?.trial).toBe(false);
    expect(revenue()).toEqual([["app_store", "apple:tx-intro"]]);
  });

  it("an ineligible subscriber (no offer on the transaction) is the normal paid purchase", async () => {
    await fx.claim(fx.memberA.id, O, { tx: { transactionId: "tx-plain" } });
    expect(ent()?.trial).toBe(false);
    expect(revenue()).toEqual([["app_store", "apple:tx-plain"]]);
  });

  it("revenue is the amount the SIGNED transaction says was charged, in its own currency, marked store-reported (not the catalog price)", async () => {
    await fx.claim(fx.memberA.id, O, { tx: { transactionId: "tx-gbp", price: 10990, currency: "GBP" } });
    const [row] = fx.db.findAllRevenueEvents();
    expect(row).toMatchObject({ amountCents: 1099, currency: "gbp", evidence: "store_reported" });
    expect(row.unverifiedReason).toBeUndefined();
  });

  it("a transaction with no price or currency cannot establish what was received: the row is UNVERIFIED, pending, not income", async () => {
    await fx.claim(fx.memberA.id, O, { tx: { transactionId: "tx-noprice" } });
    const [row] = fx.db.findAllRevenueEvents();
    expect(row).toMatchObject({ evidence: "unverified" });
    expect(row.unverifiedReason).toMatch(/Reconcile/);
    const { buildFinanceLedgerLines } = await import("@/lib/finance");
    expect(buildFinanceLedgerLines().find((l) => l.reference === "apple:tx-noprice")?.status).toBe("pending");
  });

  it("cancelling during the trial keeps access to the trial's end, still no revenue, and then access stops", async () => {
    const trialEnd = Date.now() + 5 * DAY;
    await fx.claim(fx.memberA.id, O, { tx: { ...TRIAL_TX, expiresDate: trialEnd } });
    fx.adapter.setLive(O, { renewal: { originalTransactionId: O, autoRenewStatus: 0 } });
    await fx.notify("DID_CHANGE_RENEWAL_STATUS", O, { subtype: "AUTO_RENEW_DISABLED" });
    expect(ent()).toMatchObject({ status: "canceled", trial: true, autoRenewing: false });
    expect((await access()).digital).toBe(true);

    fx.adapter.setLive(O, { status: 2, tx: { expiresDate: Date.now() - 1000 } });
    await fx.notify("EXPIRED", O, { subtype: "VOLUNTARY" });
    expect((await access()).digital).toBe(false);
    expect(revenue()).toEqual([]);
  });

  it("access also ends at the trial's end if no notification ever arrives", async () => {
    await fx.claim(fx.memberA.id, O, { tx: { ...TRIAL_TX, expiresDate: Date.now() + 2 * DAY } });
    fx.db.saveDigitalEntitlement({ ...ent()!, currentPeriodEnd: new Date(Date.now() - 3_600_000).toISOString() });
    expect((await access()).digital).toBe(false);
  });

  it("a trial that is not converted records nothing and grants nothing afterwards", async () => {
    await fx.claim(fx.memberA.id, O, { tx: { ...TRIAL_TX, expiresDate: Date.now() + DAY } });
    fx.adapter.setLive(O, { status: 2, tx: { expiresDate: Date.now() - 1000 } });
    await fx.notify("EXPIRED", O, { subtype: "BILLING_RETRY" });
    expect(ent()?.status).toBe("expired");
    expect((await access()).digital).toBe(false);
    expect(revenue()).toEqual([]);
  });

  it("conversion: the first paid renewal is a new period that is no longer a trial, access continues, and revenue is booked ONCE for the paid transaction", async () => {
    await fx.claim(fx.memberA.id, O, { tx: { ...TRIAL_TX, expiresDate: Date.now() + DAY } });
    expect(revenue()).toEqual([]);

    const paidEnd = Date.now() + 30 * DAY;
    // Apple's next transaction for the same subscription carries no offer.
    fx.adapter.setLive(O, { status: 1, tx: { transactionId: "tx-paid-1", offerType: undefined, offerDiscountType: undefined, price: 12990, expiresDate: paidEnd } });
    await fx.notify("DID_RENEW", O);
    await fx.notify("DID_RENEW", O); // a second delivery

    expect(ent()).toMatchObject({ trial: false, status: "active", currentPeriodEnd: new Date(paidEnd).toISOString() });
    expect((await access()).digital).toBe(true);
    expect(revenue()).toEqual([["app_store", "apple:tx-paid-1"]]);
  });

  it("a refund during the trial period is honoured like any other and still records nothing", async () => {
    await fx.claim(fx.memberA.id, O, { tx: { ...TRIAL_TX, expiresDate: Date.now() + 3 * DAY } });
    await fx.notify("REVOKE", O, { tx: { transactionId: "tx-trial", revocationDate: Date.now() } });
    expect(ent()?.status).toBe("revoked");
    expect((await access()).digital).toBe(false);
    expect(revenue()).toEqual([]);
  });

  it("the trial is shown to staff and the app as a trial, never as a paid plan with a price", async () => {
    await fx.claim(fx.memberA.id, O, { tx: { ...TRIAL_TX, expiresDate: Date.now() + 7 * DAY } });
    const { describeDigitalPlan } = await import("@/lib/digital-entitlement");
    expect(describeDigitalPlan(fx.db.findDigitalEntitlementsByUserId(fx.memberA.id))?.trial).toBe(true);
  });
});

describe("Google Play free trial", () => {
  let fx: PlayFixture;
  const T = "fake-play-trial-1";
  const ent = () => fx.db.findDigitalEntitlement(fx.memberA.id, "google_play");
  const access = async () => (await import("@/lib/membership-entitlement")).resolveMemberAccessForUser(fx.memberA.id);

  beforeEach(async () => {
    fx = await createPlayFixture();
  });
  afterEach(() => fx.cleanup());

  it("Google says the period is a free trial (offerPhase): trial, access, and NO revenue row at all", async () => {
    const now = Date.now();
    const res = await fx.claim(fx.memberA.id, T, { offerId: "freetrial7", offerPhase: "free_trial", orderId: "GPA.trial-1", startTimeMillis: now, expiryTimeMillis: now + 7 * DAY });
    expect(res.status).toBe(200);
    expect(ent()).toMatchObject({ trial: true, status: "active" });
    expect((await access()).digital).toBe(true);
    expect(fx.db.findAllRevenueEvents()).toEqual([]);
  });

  it("Google reports a PAID phase: never a trial, even for an offer with a short period; its revenue is recorded UNVERIFIED (amount received not established)", async () => {
    const now = Date.now();
    await fx.claim(fx.memberA.id, T, { offerId: "intro", offerPhase: "introductory_price", orderId: "GPA.intro-1", startTimeMillis: now, expiryTimeMillis: now + 5 * DAY });
    expect(ent()?.trial).toBe(false);
    const [row] = fx.db.findAllRevenueEvents();
    expect(row).toMatchObject({ providerRef: "GPA.intro-1", provider: "google_play", evidence: "unverified" });
    expect(row.unverifiedReason).toMatch(/Reconcile/);
  });

  it("a plain base-plan purchase is never a trial; its revenue is recorded as UNVERIFIED, because the charged amount is not fetched from Google", async () => {
    await fx.claim(fx.memberA.id, T, { offerId: null, offerPhase: "base_price", orderId: "GPA.plain-1" });
    expect(ent()?.trial).toBe(false);
    expect(fx.db.findAllRevenueEvents().map((e) => [e.providerRef, e.evidence])).toEqual([["GPA.plain-1", "unverified"]]);
  });

  it("an unverified Google row is visible in the finance ledger as PENDING with its reason, and is never counted as income", async () => {
    await fx.claim(fx.memberA.id, T, { offerId: null, offerPhase: "base_price", orderId: "GPA.plain-2" });
    const { buildFinanceLedgerLines } = await import("@/lib/finance");
    const line = buildFinanceLedgerLines().find((l) => l.reference === "GPA.plain-2");
    expect(line).toMatchObject({ status: "pending" });
    expect(line?.notes).toMatch(/UNVERIFIED, not counted as income/);
    const { computeTotals } = await import("@/lib/finance-shared");
    expect(computeTotals(buildFinanceLedgerLines().filter((l) => l.reference === "GPA.plain-2")).moneyInCents).toBe(0);
  });

  it("with NO phase reported the trial is only INFERRED (to bound AI cost): the period gets the trial allowance, and its revenue is unverified, not dropped", async () => {
    const now = Date.now();
    await fx.claim(fx.memberA.id, T, { offerId: "freetrial7", offerPhase: null, orderId: "GPA.infer-1", startTimeMillis: now, expiryTimeMillis: now + 7 * DAY });
    expect(ent()).toMatchObject({ trial: true });
    expect(fx.db.findAllRevenueEvents().map((e) => [e.providerRef, e.evidence])).toEqual([["GPA.infer-1", "unverified"]]);
    expect(fx.db.findAllRevenueEvents()[0].unverifiedReason).toMatch(/did not report the offer phase/);
  });

  it("cancelling during the trial keeps access to its end; then it expires; nothing is ever booked", async () => {
    const now = Date.now();
    await fx.claim(fx.memberA.id, T, { offerId: "freetrial7", offerPhase: "free_trial", orderId: "GPA.trial-2", startTimeMillis: now, expiryTimeMillis: now + 6 * DAY });
    fx.adapter.setSnapshot(T, { state: "SUBSCRIPTION_STATE_CANCELED", autoRenewing: false });
    await fx.rtdn(fx.subscriptionEvent(T, 3));
    expect(ent()).toMatchObject({ status: "canceled", trial: true });
    expect((await access()).digital).toBe(true);

    fx.adapter.setSnapshot(T, { state: "SUBSCRIPTION_STATE_EXPIRED", expiryTimeMillis: Date.now() - 1000 });
    await fx.rtdn(fx.subscriptionEvent(T, 13));
    expect((await access()).digital).toBe(false);
    expect(fx.db.findAllRevenueEvents()).toEqual([]);
  });

  it("conversion: the first paid period is no longer a trial and its order is booked once", async () => {
    const start = Date.now() - 7 * DAY;
    await fx.claim(fx.memberA.id, T, { offerId: "freetrial7", offerPhase: "free_trial", orderId: "GPA.trial-3", startTimeMillis: start, expiryTimeMillis: Date.now() + 1000 });
    expect(ent()?.trial).toBe(true);

    fx.adapter.setSnapshot(T, { state: "SUBSCRIPTION_STATE_ACTIVE", offerPhase: "base_price", orderId: "GPA.paid-3", expiryTimeMillis: Date.now() + 30 * DAY });
    await fx.rtdn(fx.subscriptionEvent(T, 2));
    await fx.rtdn(fx.subscriptionEvent(T, 2));
    expect(ent()).toMatchObject({ trial: false, status: "active" });
    expect(fx.db.findAllRevenueEvents().map((e) => e.providerRef)).toEqual(["GPA.paid-3"]);
  });

  it("googleTrialEvidence: the reported phase is the authority; the length guess applies only when no phase is reported, and says so", async () => {
    const { googleTrialEvidence, GOOGLE_TRIAL_MAX_MS } = await import("@/lib/iap/service");
    const t0 = 1_000_000_000_000;
    const span = (ms: number, extra: object = {}) => ({ offerId: "o", offerPhase: null, startTimeMillis: t0, expiryTimeMillis: t0 + ms, ...extra });
    // Reported: the length of the period is irrelevant.
    expect(googleTrialEvidence(span(30 * DAY, { offerPhase: "free_trial" }))).toEqual({ trial: true, basis: "store_reported" });
    expect(googleTrialEvidence(span(3 * DAY, { offerPhase: "introductory_price" }))).toEqual({ trial: false, basis: "store_reported" });
    expect(googleTrialEvidence(span(3 * DAY, { offerPhase: "base_price" }))).toEqual({ trial: false, basis: "store_reported" });
    // Not reported: inferred, deliberately conservative, and labelled as inferred.
    expect(googleTrialEvidence(span(7 * DAY))).toEqual({ trial: true, basis: "inferred" });
    expect(googleTrialEvidence(span(GOOGLE_TRIAL_MAX_MS))).toEqual({ trial: true, basis: "inferred" });
    expect(googleTrialEvidence(span(GOOGLE_TRIAL_MAX_MS + 1))).toEqual({ trial: false, basis: "inferred" });
    expect(googleTrialEvidence(span(7 * DAY, { offerId: null }))).toEqual({ trial: false, basis: "inferred" });
    expect(googleTrialEvidence(span(7 * DAY, { startTimeMillis: null }))).toEqual({ trial: false, basis: "inferred" });
  });
});
