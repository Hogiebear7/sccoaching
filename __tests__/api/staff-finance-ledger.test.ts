import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { signSession } from "@/lib/session";

const h = vi.hoisted(() => ({
  findUserById: vi.fn(),
  findFinanceLedgerEntryById: vi.fn(),
  findMembershipPackageById: vi.fn(),
  saveFinanceLedgerEntry: vi.fn(),
  deleteFinanceLedgerEntry: vi.fn(),
}));

vi.mock("@/lib/db", () => h);

const ADMIN_MANAGER = { id: "s1", email: "c@x.c", role: "admin_manager" as const, archivedAt: null };
const COACH = { id: "s2", email: "coach@x.c", role: "coach" as const, archivedAt: null };
const auth = (userId: string) => signSession({ userId });

async function post(path: string, body: unknown, cookie?: string) {
  const mod = await import(`@/app/api/staff/finance/ledger${path}/route`);
  const req = new NextRequest(`http://localhost/api/staff/finance/ledger${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: `session=${cookie}` } : {}) },
    body: JSON.stringify(body),
  });
  return mod.POST(req);
}

describe("staff finance ledger CRUD", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.findUserById.mockReturnValue(ADMIN_MANAGER);
    h.findFinanceLedgerEntryById.mockReturnValue(undefined);
    h.findMembershipPackageById.mockReturnValue(undefined);
  });

  const incomePayload = {
    kind: "income",
    incomeSource: "apple",
    incomeType: "tier2_app_subscription",
    status: "cleared",
    date: "2026-08-10T00:00:00.000Z",
    grossAmountCents: 999,
    feeAmountCents: 150,
  };

  it("rejects anyone below admin_manager (finance.view)", async () => {
    h.findUserById.mockReturnValue(COACH);
    const res = await post("", incomePayload, auth(COACH.id));
    expect(res.status).toBe(403);
    expect(h.saveFinanceLedgerEntry).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated request", async () => {
    const res = await post("", incomePayload);
    expect(res.status).toBe(401);
  });

  it("creates an income entry and computes net = gross - fee", async () => {
    const res = await post("", incomePayload, auth(ADMIN_MANAGER.id));
    expect(res.status).toBe(200);
    const saved = h.saveFinanceLedgerEntry.mock.calls[0][0];
    expect(saved).toMatchObject({
      kind: "income",
      incomeSource: "apple",
      incomeType: "tier2_app_subscription",
      expenseType: null,
      feeType: null,
      grossAmountCents: 999,
      feeAmountCents: 150,
      netAmountCents: 849,
      createdByUserId: ADMIN_MANAGER.id,
    });
  });

  it("requires incomeSource/incomeType for income, rejects expense/fee fields on it", async () => {
    const missingSource = await post("", { ...incomePayload, incomeSource: undefined }, auth(ADMIN_MANAGER.id));
    expect(missingSource.status).toBe(400);
  });

  it("requires expenseType for an expense entry", async () => {
    const bad = await post("", { kind: "expense", status: "cleared", date: "2026-08-10T00:00:00.000Z", grossAmountCents: 5000 }, auth(ADMIN_MANAGER.id));
    expect(bad.status).toBe(400);

    const ok = await post(
      "",
      { kind: "expense", expenseType: "payroll", status: "cleared", date: "2026-08-10T00:00:00.000Z", grossAmountCents: 5000 },
      auth(ADMIN_MANAGER.id)
    );
    expect(ok.status).toBe(200);
    const saved = h.saveFinanceLedgerEntry.mock.calls[0][0];
    expect(saved).toMatchObject({ kind: "expense", expenseType: "payroll", grossAmountCents: 5000, netAmountCents: 5000 });
  });

  it("requires feeType for a fee entry", async () => {
    const res = await post(
      "",
      { kind: "fee", feeType: "stripe_fee", status: "cleared", date: "2026-08-10T00:00:00.000Z", grossAmountCents: 250 },
      auth(ADMIN_MANAGER.id)
    );
    expect(res.status).toBe(200);
    expect(h.saveFinanceLedgerEntry.mock.calls[0][0]).toMatchObject({ kind: "fee", feeType: "stripe_fee" });
  });

  it("rejects a non-integer amount", async () => {
    const res = await post("", { ...incomePayload, grossAmountCents: 9.99 }, auth(ADMIN_MANAGER.id));
    expect(res.status).toBe(400);
  });

  it("rejects an unknown status/kind", async () => {
    expect((await post("", { ...incomePayload, status: "bogus" }, auth(ADMIN_MANAGER.id))).status).toBe(400);
    expect((await post("", { ...incomePayload, kind: "bogus" }, auth(ADMIN_MANAGER.id))).status).toBe(400);
  });

  it("404s an update against a missing id", async () => {
    h.findFinanceLedgerEntryById.mockReturnValue(undefined);
    const res = await post("", { ...incomePayload, id: "missing" }, auth(ADMIN_MANAGER.id));
    expect(res.status).toBe(404);
  });

  it("updates an existing entry, preserving createdAt/createdByUserId", async () => {
    h.findFinanceLedgerEntryById.mockReturnValue({
      id: "e1",
      createdAt: "2020-01-01T00:00:00.000Z",
      createdByUserId: "someone-else",
      sourceExternalId: "ext-1",
    });
    const res = await post("", { ...incomePayload, id: "e1", grossAmountCents: 1500 }, auth(ADMIN_MANAGER.id));
    expect(res.status).toBe(200);
    const saved = h.saveFinanceLedgerEntry.mock.calls[0][0];
    expect(saved).toMatchObject({
      id: "e1",
      grossAmountCents: 1500,
      createdAt: "2020-01-01T00:00:00.000Z",
      createdByUserId: "someone-else",
      sourceExternalId: "ext-1",
    });
  });

  it("deletes an entry", async () => {
    h.findFinanceLedgerEntryById.mockReturnValue({ id: "e1" });
    const res = await post("/delete", { id: "e1" }, auth(ADMIN_MANAGER.id));
    expect(res.status).toBe(200);
    expect(h.deleteFinanceLedgerEntry).toHaveBeenCalledWith("e1");
  });

  it("404s deleting a missing entry", async () => {
    h.findFinanceLedgerEntryById.mockReturnValue(undefined);
    const res = await post("/delete", { id: "missing" }, auth(ADMIN_MANAGER.id));
    expect(res.status).toBe(404);
    expect(h.deleteFinanceLedgerEntry).not.toHaveBeenCalled();
  });
});
