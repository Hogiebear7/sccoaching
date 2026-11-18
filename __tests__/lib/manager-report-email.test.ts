// lib/jobs/manager-report-email.ts: when the weekly and monthly briefings go out, to whom, and that nothing repeats. The report builder itself is stubbed; this is
// about timing, recipients and the once-only key.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ findStaffUsers: vi.fn() }));
vi.mock("@/lib/db", () => h);
const mail = vi.hoisted(() => ({ sendEmail: vi.fn() }));
vi.mock("@/lib/email", () => mail);
const builder = vi.hoisted(() => ({ buildManagerReport: vi.fn() }));
vi.mock("@/lib/manager-report", () => builder);

import { managerReportEmailJob } from "@/lib/jobs/manager-report-email";
import { reportPeriod } from "@/lib/manager-report-shared";

const staff = [
  { id: "owner", email: "owner@x.test", role: "platform_operator", gymId: "gym-b", archivedAt: null },
  { id: "manager-a", email: "a@x.test", role: "admin_manager", gymId: null, archivedAt: null },
  { id: "manager-b", email: "b@x.test", role: "admin_manager", gymId: "gym-b", archivedAt: null },
  { id: "coach", email: "coach@x.test", role: "coach", gymId: null, archivedAt: null },
  { id: "gone", email: "gone@x.test", role: "admin_manager", gymId: null, archivedAt: "2026-01-01T00:00:00.000Z" },
];

function stubReport(cadence: "weekly" | "monthly", now: Date) {
  return {
    cadence,
    period: reportPeriod(cadence, 0, now),
    generatedAt: now.toISOString(),
    gymName: "Test Gym",
    gym: {
      bookings: { total: 1, attended: 1, noShows: 0, classes: 1, fillRate: 0.5, byType: [], busiestHours: [], comparison: { previous: null, changePercent: null } },
      members: { total: 1, current: 1, paused: 0, passHolders: 0, newSignups: 0, newSignupsComparison: { previous: null, changePercent: null }, passesBought: 0, lost: 0, lostComparison: { previous: null, changePercent: null }, quiet: 0, quietNames: [] },
    },
    money: null,
    app: null,
    platform: null,
    attention: [],
    notes: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.MANAGER_REPORTS_EMAIL;
  h.findStaffUsers.mockReturnValue(staff);
  builder.buildManagerReport.mockImplementation((_actor: unknown, cadence: "weekly" | "monthly") => stubReport(cadence, new Date("2026-11-18T10:00:00Z")));
});
afterEach(() => vi.useRealTimers());

const at = (iso: string) => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(iso));
};

describe("manager-report-email", () => {
  it("does nothing on a day when nothing is due", async () => {
    at("2026-11-18T09:00:00.000Z"); // Wednesday the 18th
    expect(await managerReportEmailJob.run()).toBe("No briefing is due now.");
    expect(mail.sendEmail).not.toHaveBeenCalled();
  });

  it("does nothing before 07:00 Irish time", async () => {
    at("2026-11-16T06:30:00.000Z"); // Monday, 06:30 in Dublin (GMT)
    expect(await managerReportEmailJob.run()).toBe("No briefing is due now.");
    at("2026-07-13T05:30:00.000Z"); // Monday in summer, 06:30 in Dublin (UTC+1)
    expect(await managerReportEmailJob.run()).toBe("No briefing is due now.");
  });

  it("Monday morning: the weekly briefing goes to owners and gym managers only, each with a once-only key; platform owners get the primary gym", async () => {
    at("2026-11-16T07:15:00.000Z");
    const summary = await managerReportEmailJob.run();
    expect(summary).toBe("Sent 3 briefing emails (weekly) to 3 recipients.");
    expect(builder.buildManagerReport.mock.calls.map((c) => [(c as unknown[])[0], (c as unknown[])[1]])).toEqual([
      [{ id: "owner", role: "platform_operator", gymId: null }, "weekly"],
      [{ id: "manager-a", role: "admin_manager", gymId: null }, "weekly"],
      [{ id: "manager-b", role: "admin_manager", gymId: "gym-b" }, "weekly"],
    ]);
    const first = mail.sendEmail.mock.calls[0][0];
    expect(first.to).toBe("owner@x.test");
    expect(first.subject).toBe("Weekly briefing, Test Gym: Mon 9 Nov to Sun 15 Nov 2026");
    expect(first.dedupeKey).toBe("manager-report:weekly:2026-11-09:owner");
    expect(first.html).toContain("Weekly briefing");
    expect(first.text).toContain("Full report: https://");
    const emailed = mail.sendEmail.mock.calls.map((c) => (c[0] as { to: string }).to);
    expect(emailed).not.toContain("coach@x.test");
    expect(emailed).not.toContain("gone@x.test");
  });

  it("Tuesday still covers a missed Monday, and a Wednesday does not", async () => {
    at("2026-11-17T08:00:00.000Z");
    expect(await managerReportEmailJob.run()).toMatch(/^Sent 3 briefing emails \(weekly\)/);
  });

  it("from the 5th the monthly briefing is due as well", async () => {
    at("2026-11-05T09:00:00.000Z"); // a Thursday: monthly only
    const summary = await managerReportEmailJob.run();
    expect(summary).toBe("Sent 3 briefing emails (monthly) to 3 recipients.");
    expect(mail.sendEmail.mock.calls[0][0].dedupeKey).toMatch(/^manager-report:monthly:2026-10:owner$/);
  });

  it("a Monday on the 9th sends both", async () => {
    at("2026-11-09T08:00:00.000Z");
    expect(await managerReportEmailJob.run()).toBe("Sent 6 briefing emails (weekly and monthly) to 3 recipients.");
  });

  it("can be switched off", async () => {
    process.env.MANAGER_REPORTS_EMAIL = "off";
    at("2026-11-16T09:00:00.000Z");
    expect(await managerReportEmailJob.run()).toMatch(/switched off/);
    expect(mail.sendEmail).not.toHaveBeenCalled();
  });
});
