// GET /api/staff/exports: admin only (reports.view), the gym always taken from the session, input checked, and the right file headers.
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MEMBER_SESSION_LIFETIME_MS, signSession } from "@/lib/session";

const h = vi.hoisted(() => ({ findUserById: vi.fn() }));
vi.mock("@/lib/db", () => h);
const ex = vi.hoisted(() => ({
  buildExportSheet: vi.fn((key: string) => ({ key, title: "Members", columns: [{ key: "a", header: "A" }], rows: [{ a: "x" }] })),
  buildMasterWorkbook: vi.fn(() => [{ key: "summary", title: "Summary", columns: [{ key: "a", header: "A" }], rows: [] }]),
}));
vi.mock("@/lib/exports", () => ({
  ...ex,
  EXPORT_RANGES: ["30d", "90d", "12m", "all"],
  EXPORT_SHEET_KEYS: ["summary", "members", "memberships", "classes", "bookings", "app-access"],
}));

const ADMIN_B = { id: "admin-b", role: "admin", gymId: "gym-b", archivedAt: null };
const COACH = { id: "coach-a", role: "coach", gymId: null, archivedAt: null };
const MEMBER = { id: "member-a", role: "member", gymId: null, archivedAt: null };

async function get(query: string, as?: string) {
  const { GET } = await import("@/app/api/staff/exports/route");
  const headers = as ? { Cookie: `session=${signSession({ userId: as }, MEMBER_SESSION_LIFETIME_MS)}` } : undefined;
  return GET(new NextRequest(`http://localhost/api/staff/exports?${query}`, { headers }));
}

beforeEach(() => {
  vi.clearAllMocks();
  h.findUserById.mockImplementation((id: string) => [ADMIN_B, COACH, MEMBER].find((u) => u.id === id));
});

describe("GET /api/staff/exports", () => {
  it("nobody signed in: 401; a coach or member: 403; nothing is built", async () => {
    expect((await get("sheet=members&format=csv")).status).toBe(401);
    expect((await get("sheet=members&format=csv", COACH.id)).status).toBe(403);
    expect((await get("sheet=members&format=csv", MEMBER.id)).status).toBe(403);
    expect(ex.buildExportSheet).not.toHaveBeenCalled();
    expect(ex.buildMasterWorkbook).not.toHaveBeenCalled();
  });

  it("an admin gets a CSV for their own gym, whatever the request says", async () => {
    const res = await get("sheet=members&format=csv&range=30d&gymId=other", ADMIN_B.id);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toMatch(/attachment; filename="sc-members-30d-\d{4}-\d{2}-\d{2}\.csv"/);
    expect(ex.buildExportSheet).toHaveBeenCalledWith("members", { gymId: "gym-b" }, "30d");
  });

  it("the master workbook is an Excel file", async () => {
    const res = await get("sheet=master&format=xlsx&range=all", ADMIN_B.id);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("spreadsheetml");
    expect(ex.buildMasterWorkbook).toHaveBeenCalledWith({ gymId: "gym-b" }, "all");
  });

  it("refuses an unknown sheet, format or period, and the master workbook as CSV", async () => {
    expect((await get("sheet=passwords&format=csv", ADMIN_B.id)).status).toBe(400);
    expect((await get("sheet=members&format=pdf", ADMIN_B.id)).status).toBe(400);
    expect((await get("sheet=members&format=csv&range=forever", ADMIN_B.id)).status).toBe(400);
    expect((await get("sheet=master&format=csv", ADMIN_B.id)).status).toBe(400);
  });
});
