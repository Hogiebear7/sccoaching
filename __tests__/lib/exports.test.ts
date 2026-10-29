// lib/exports.ts + lib/exports-format.ts: the spreadsheet exports (admin revamp slice S1). Gym scope before any read, the phone rule, the
// period filter, the summary figures, and the two file formats (including the formula-injection guard).
import ExcelJS from "exceljs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  findAllAiUsageLogs: vi.fn(),
  findAllBookings: vi.fn(),
  findAllNoShows: vi.fn(),
  findClassCategories: vi.fn(() => []),
  findClasses: vi.fn(),
  findDeletedCategoryLabels: vi.fn(() => ({})),
  findDigitalEntitlementsByUserId: vi.fn(() => []),
  findMembers: vi.fn(),
  findMembershipPackageById: vi.fn(),
  findProfileByUserId: vi.fn(),
  findStaffMemberStars: vi.fn((): { userId: string }[] => []),
  findSubscriptionByUserId: vi.fn(),
  findUserById: vi.fn(),
  findWorkoutSessionsByUserId: vi.fn(() => []),
}));
vi.mock("@/lib/db", () => h);
vi.mock("@/lib/ai-allowance", () => ({ aiUsdPerEur: () => 1.05 }));
vi.mock("@/lib/digital-entitlement", () => ({ describeDigitalPlan: (rows: unknown[]) => (rows as { source: string }[])[0] ?? null }));
vi.mock("@/lib/membership-entitlement", () => ({
  resolveMemberAccessForUser: (id: string) => ({ digital: false, gymMembership: id === "a-gym" }),
  resolveSubscriptionEntitlement: (sub: { packageId?: string } | undefined) => (sub?.packageId ? { name: "Premium" } : null),
}));
vi.mock("@/lib/scheduling-status", () => ({ classCategoryLabel: () => "Strength" }));

import { buildMasterWorkbook, buildMembersSheet, rangeStart } from "@/lib/exports";
import { safeText, toCsv, toXlsx } from "@/lib/exports-format";

const NOW = new Date("2026-10-29T12:00:00.000Z");
const user = (id: string, gymId: string | null, extra: object = {}) => ({ id, email: `${id}@x.test`, role: "member", gymId, createdAt: "2026-10-20T00:00:00.000Z", archivedAt: null, ...extra });
const A_GYM = user("a-gym", null);
const A_NON = user("a-non", null, { createdAt: "2025-01-01T00:00:00.000Z" });
const B_MEMBER = user("b-member", "gym-b");
const A_COACH = { id: "coach-a", role: "coach", gymId: null };
const B_COACH = { id: "coach-b", role: "coach", gymId: "gym-b" };

beforeEach(() => {
  vi.clearAllMocks();
  h.findMembers.mockReturnValue([A_GYM, A_NON, B_MEMBER]);
  h.findUserById.mockImplementation((id: string) => [A_GYM, A_NON, B_MEMBER, A_COACH, B_COACH].find((u) => u.id === id));
  h.findProfileByUserId.mockImplementation((id: string) => ({ fullName: `Name ${id}`, phone: "0831234567" }));
  h.findSubscriptionByUserId.mockImplementation((id: string) =>
    id === "a-gym" ? { userId: id, packageId: "p", status: "active", provider: "none", createdAt: "2026-10-20T00:00:00.000Z", updatedAt: "2026-10-20T00:00:00.000Z", currentPeriodEnd: null, pausedUntil: null } : undefined
  );
  h.findMembershipPackageById.mockReturnValue({ deliveryChannel: "in_person" });
  h.findClasses.mockReturnValue([
    { id: "c-recent", title: "Strength", category: "strength", coachUserId: "coach-a", date: "2026-10-28", startTime: "07:00", capacity: 8 },
    { id: "c-old", title: "Strength", category: "strength", coachUserId: "coach-a", date: "2025-06-01", startTime: "07:00", capacity: 8 },
    { id: "c-b", title: "Other gym", category: "strength", coachUserId: "coach-b", date: "2026-10-28", startTime: "07:00", capacity: 8 },
  ]);
  h.findAllBookings.mockReturnValue([
    { id: "b1", classId: "c-recent", userId: "a-gym", attendedAt: "2026-10-28T07:05:00.000Z", createdAt: "2026-10-27T10:00:00.000Z" },
    { id: "b2", classId: "c-recent", userId: "a-non", attendedAt: null, createdAt: "2026-10-27T10:00:00.000Z" },
    { id: "b3", classId: "c-old", userId: "a-gym", attendedAt: "2025-06-01T07:05:00.000Z", createdAt: "2025-05-30T10:00:00.000Z" },
    { id: "b4", classId: "c-b", userId: "b-member", attendedAt: "2026-10-28T07:05:00.000Z", createdAt: "2026-10-27T10:00:00.000Z" },
  ]);
  h.findAllNoShows.mockReturnValue([{ classId: "c-recent", userId: "a-non" }]);
  h.findAllAiUsageLogs.mockReturnValue([{ userId: "a-gym", costUsd: 1.05, createdAt: "2026-10-28T09:00:00.000Z" }]);
});

describe("exports: scope, privacy and period", () => {
  it("lists only the acting gym's members, and a phone number only for those who hold a gym Membership", () => {
    const sheet = buildMembersSheet({ gymId: null }, "30d", NOW);
    expect(sheet.rows.map((r) => [r.email, r.phone, r.group])).toEqual([
      ["a-gym@x.test", "0831234567", "Current"],
      ["a-non@x.test", null, "Non-member"],
    ]);
    expect(sheet.rows[0].classesAttended).toBe(1); // the 2025 class is outside the last 30 days
  });

  it("another gym's staff get their own gym only", () => {
    const sheet = buildMembersSheet({ gymId: "gym-b" }, "all", NOW);
    expect(sheet.rows.map((r) => r.email)).toEqual(["b-member@x.test"]);
  });

  it("the master workbook: summary first, then every sheet, each filtered to the period and the gym", () => {
    const sheets = buildMasterWorkbook({ gymId: null }, "30d", NOW);
    expect(sheets.map((s) => s.key)).toEqual(["summary", "members", "memberships", "classes", "bookings", "app-access"]);
    const classes = sheets.find((s) => s.key === "classes")!;
    expect(classes.rows).toHaveLength(1);
    expect(classes.rows[0]).toMatchObject({ booked: 2, attended: 1, fill: 1 / 8, noShows: 1 });
    expect(sheets.find((s) => s.key === "bookings")!.rows).toHaveLength(2);
    expect(sheets.find((s) => s.key === "app-access")!.rows[0]).toMatchObject({ email: "a-gym@x.test", aiRequests: 1, aiCostEur: 1 });
    const summary = Object.fromEntries(sheets[0].rows.map((r) => [r.measure, r.value]));
    expect(summary).toMatchObject({ "Current gym members": 1, "New sign-ups": 1, "Classes run": 1, Attendances: 1, "No-shows": 1, "AI cost (€)": 1 });
  });

  it("periods count back from today; all time has no start", () => {
    expect(rangeStart("30d", NOW)).toBe("2026-09-29");
    expect(rangeStart("12m", NOW)).toBe("2025-10-29");
    expect(rangeStart("all", NOW)).toBeNull();
  });
});

describe("exports: file formats", () => {
  it("text a spreadsheet would run as a formula is written as plain text", () => {
    expect(safeText("=HYPERLINK(\"x\")")).toBe("'=HYPERLINK(\"x\")");
    expect(safeText("+353 83")).toBe("'+353 83");
    expect(safeText("@cmd")).toBe("'@cmd");
    expect(safeText("Aoife")).toBe("Aoife");
  });

  it("CSV: a byte-order mark, a header row, quoted commas and quotes, guarded formulas, percentages", () => {
    const csv = toCsv({
      key: "classes",
      title: "Classes",
      columns: [{ key: "a", header: "Name" }, { key: "b", header: "Fill", kind: "percent" }],
      rows: [{ a: 'Doe, "Jo"', b: 0.125 }, { a: "=1+1", b: null }],
    });
    expect(csv.startsWith("﻿Name,Fill\r\n")).toBe(true);
    expect(csv).toContain('"Doe, ""Jo""",12.5%');
    expect(csv).toContain("'=1+1,\r\n");
  });

  it("Excel: one worksheet per sheet, header row first, numbers kept as numbers, formula-like text stored as text (never run)", async () => {
    const sheets = buildMasterWorkbook({ gymId: null }, "30d", NOW);
    sheets[1].rows[0].name = "=cmd";
    const buffer = await toXlsx(sheets, { title: "Test" });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Summary", "Members", "Memberships", "Classes", "Bookings", "App access & AI"]);
    const members = wb.getWorksheet("Members")!;
    expect(members.getRow(1).getCell(1).value).toBe("Name");
    expect(members.getRow(2).getCell(1).value).toBe("=cmd");
    expect(members.getRow(2).getCell(1).type).toBe(ExcelJS.ValueType.String);
    expect(typeof wb.getWorksheet("Classes")!.getRow(2).getCell(6).value).toBe("number");
  });
});
