// POST /api/staff/settings/store-downloads: the owner types in a month's Apple and Google download numbers for the monthly report. Platform owner only.
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MEMBER_SESSION_LIFETIME_MS, signSession } from "@/lib/session";

const h = vi.hoisted(() => ({ findUserById: vi.fn(), getFinanceSettings: vi.fn(), saveFinanceSettings: vi.fn() }));
vi.mock("@/lib/db", () => h);

const OWNER = { id: "s1", email: "c@x.c", role: "platform_operator" as const, archivedAt: null };
const MANAGER = { id: "s3", email: "am@x.c", role: "admin_manager" as const, archivedAt: null };
const cookie = (userId: string) => signSession({ userId }, MEMBER_SESSION_LIFETIME_MS);

async function post(body: unknown, userId?: string) {
  const mod = await import("@/app/api/staff/settings/store-downloads/route");
  return mod.POST(
    new NextRequest("http://localhost/api/staff/settings/store-downloads", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(userId ? { Cookie: `session=${cookie(userId)}` } : {}) },
      body: JSON.stringify(body),
    })
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  h.findUserById.mockImplementation((id: string) => (id === "s1" ? OWNER : id === "s3" ? MANAGER : undefined));
  h.getFinanceSettings.mockReturnValue({ taxRatePercent: 23, stripeFeePercent: null, stripeFeeFixedCents: null, cashPositionAnchorCents: null, cashPositionAnchorDate: null });
});

describe("store downloads", () => {
  it("is refused when signed out and for a gym manager (platform owner only)", async () => {
    expect((await post({ month: "2026-10", appStore: 1, googlePlay: 2 })).status).toBe(401);
    expect((await post({ month: "2026-10", appStore: 1, googlePlay: 2 }, "s3")).status).toBe(403);
    expect(h.saveFinanceSettings).not.toHaveBeenCalled();
  });

  it("saves a month next to the other settings without touching them", async () => {
    const res = await post({ month: "2026-10", appStore: 120, googlePlay: 95 }, "s1");
    expect(res.status).toBe(200);
    expect(h.saveFinanceSettings).toHaveBeenCalledWith(expect.objectContaining({ taxRatePercent: 23, storeDownloads: { "2026-10": { appStore: 120, googlePlay: 95 } } }));
  });

  it("keeps other months, accepts one store only, and clears a month when both are empty", async () => {
    h.getFinanceSettings.mockReturnValue({ taxRatePercent: null, storeDownloads: { "2026-09": { appStore: 10, googlePlay: 20 } } });
    await post({ month: "2026-10", appStore: 55, googlePlay: null }, "s1");
    expect(h.saveFinanceSettings.mock.calls[0][0].storeDownloads).toEqual({ "2026-09": { appStore: 10, googlePlay: 20 }, "2026-10": { appStore: 55, googlePlay: null } });
    await post({ month: "2026-09", appStore: null, googlePlay: null }, "s1");
    expect(h.saveFinanceSettings.mock.calls[1][0].storeDownloads).toEqual({});
  });

  it("rejects a bad month or a number that is not a whole count", async () => {
    for (const body of [{ month: "October", appStore: 1, googlePlay: 1 }, { month: "2026-13", appStore: 1, googlePlay: 1 }, { month: "2026-10", appStore: -1, googlePlay: 1 }, { month: "2026-10", appStore: 1.5, googlePlay: 1 }, { month: "2026-10", appStore: "12", googlePlay: 1 }]) {
      expect((await post(body, "s1")).status).toBe(400);
    }
    expect(h.saveFinanceSettings).not.toHaveBeenCalled();
  });
});
