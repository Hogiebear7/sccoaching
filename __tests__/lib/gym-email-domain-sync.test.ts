// Registering, checking and removing a gym's own email domain, with the mail provider and the datastore mocked.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  saveGym: vi.fn(),
  resend: {
    domains: { create: vi.fn(), verify: vi.fn(), get: vi.fn(), remove: vi.fn() },
  },
  client: null as unknown,
}));
vi.mock("@/lib/db", () => ({ saveGym: h.saveGym }));
vi.mock("@/lib/email", () => ({ getResendDomainsClient: () => h.client }));

import { refreshGymEmailDomain, registerGymEmailDomain, removeGymEmailDomain } from "@/lib/gym-email-domain-sync";
import type { GymRecord } from "@/lib/gyms-schema";

const gym = { id: "g1", name: "Iron Works", updatedAt: "" } as unknown as GymRecord;
const records = [
  { record: "SPF", name: "send", type: "MX", value: "feedback-smtp.example", ttl: "Auto", priority: 10, status: "not_started" },
  { record: "DKIM", name: "resend._domainkey", type: "TXT", value: "p=KEY", ttl: "Auto", status: "not_started" },
  { record: "Receiving", name: "@", type: "MX", value: "ignored.example", status: "not_started" },
];

beforeEach(() => {
  vi.clearAllMocks();
  h.client = h.resend;
});

describe("registerGymEmailDomain", () => {
  it("stores the provider's id and only the SPF and DKIM records", async () => {
    h.resend.domains.create.mockResolvedValue({ data: { id: "rid", status: "not_started", records }, error: null });
    const r = await registerGymEmailDomain(gym, "ironworks.ie", "hello");
    expect(r.ok).toBe(true);
    const saved = h.saveGym.mock.calls[0][0] as GymRecord;
    expect(saved.emailDomain).toMatchObject({ name: "ironworks.ie", resendId: "rid", fromLocal: "hello", verifiedAt: null });
    expect(saved.emailDomain?.records.map((x) => x.record)).toEqual(["SPF", "DKIM"]);
  });
  it("explains a domain that is already taken, and refuses a second domain", async () => {
    h.resend.domains.create.mockResolvedValue({ data: null, error: { message: "domain already exists" } });
    const taken = await registerGymEmailDomain(gym, "ironworks.ie", "hello");
    expect(taken).toMatchObject({ ok: false, status: 409 });
    const again = await registerGymEmailDomain({ ...gym, emailDomain: { name: "x.ie", resendId: "r", status: "pending", fromLocal: "hello", records: [], createdAt: "", verifiedAt: null } }, "y.ie", "hello");
    expect(again).toMatchObject({ ok: false, status: 409 });
    expect(h.resend.domains.create).toHaveBeenCalledTimes(1);
  });
  it("says so when email is not configured or the provider fails", async () => {
    h.client = null;
    expect(await registerGymEmailDomain(gym, "ironworks.ie", "hello")).toMatchObject({ ok: false, status: 503 });
    h.client = h.resend;
    h.resend.domains.create.mockRejectedValue(new Error("network"));
    expect(await registerGymEmailDomain(gym, "ironworks.ie", "hello")).toMatchObject({ ok: false, status: 502 });
    expect(h.saveGym).not.toHaveBeenCalled();
  });
});

describe("refreshGymEmailDomain", () => {
  const waiting = { ...gym, emailDomain: { name: "ironworks.ie", resendId: "rid", status: "pending", fromLocal: "hello", records: [], createdAt: "", verifiedAt: null } } as GymRecord;

  it("asks the provider to verify and records the new status; verified sets the date once", async () => {
    h.resend.domains.verify.mockResolvedValue({});
    h.resend.domains.get.mockResolvedValue({ data: { status: "verified", records } });
    const r = await refreshGymEmailDomain(waiting, true);
    expect(h.resend.domains.verify).toHaveBeenCalledWith("rid");
    expect(r.ok && r.gym.emailDomain?.status).toBe("verified");
    expect(r.ok && r.gym.emailDomain?.verifiedAt).toBeTruthy();
  });
  it("does not ask to verify an already verified domain, and reports a provider failure", async () => {
    h.resend.domains.get.mockResolvedValue({ data: null });
    const verified = { ...waiting, emailDomain: { ...waiting.emailDomain!, status: "verified" } } as GymRecord;
    const r = await refreshGymEmailDomain(verified, true);
    expect(h.resend.domains.verify).not.toHaveBeenCalled();
    expect(r).toMatchObject({ ok: false, status: 502 });
  });
});

describe("removeGymEmailDomain", () => {
  it("removes it at the provider and from the gym", async () => {
    h.resend.domains.remove.mockResolvedValue({});
    const r = await removeGymEmailDomain({ ...gym, emailDomain: { name: "x.ie", resendId: "rid", status: "verified", fromLocal: "hello", records: [], createdAt: "", verifiedAt: "t" } } as GymRecord);
    expect(h.resend.domains.remove).toHaveBeenCalledWith("rid");
    expect(r.ok && r.gym.emailDomain).toBeUndefined();
  });
});
