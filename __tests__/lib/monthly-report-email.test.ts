// lib/jobs/monthly-report-email.ts: last month's master workbook, emailed to gym managers once a month in the first week.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  createNotification: vi.fn(),
  findNotificationByDedupeKey: vi.fn(),
  findStaffUsers: vi.fn(),
}));
vi.mock("@/lib/db", () => h);
const mail = vi.hoisted(() => ({ sendEmail: vi.fn() }));
vi.mock("@/lib/email", () => mail);
const ex = vi.hoisted(() => ({
  buildMasterWorkbook: vi.fn(() => [{ key: "summary", title: "Summary", columns: [], rows: [{ measure: "Period", value: "Last month" }, { measure: "Current gym members", value: 4 }, { measure: "Average fill rate", value: 0.5 }] }]),
}));
vi.mock("@/lib/exports", async (orig) => ({ ...(await orig<typeof import("@/lib/exports")>()), buildMasterWorkbook: ex.buildMasterWorkbook }));
vi.mock("@/lib/exports-format", () => ({ toXlsx: vi.fn(async () => Buffer.from("xlsx")) }));

import { monthlyReportEmailJob } from "@/lib/jobs/monthly-report-email";

const staff = [
  { id: "owner", email: "owner@x.test", role: "admin_manager", gymId: null, archivedAt: null },
  { id: "manager-b", email: "b@x.test", role: "admin_manager", gymId: "gym-b", archivedAt: null },
  { id: "operator", email: "op@x.test", role: "platform_operator", gymId: "gym-b", archivedAt: null },
  { id: "coach", email: "coach@x.test", role: "coach", gymId: null, archivedAt: null },
  { id: "gone", email: "gone@x.test", role: "admin_manager", gymId: null, archivedAt: "2026-01-01T00:00:00.000Z" },
];

beforeEach(() => {
  vi.clearAllMocks();
  h.findStaffUsers.mockReturnValue(staff);
  h.findNotificationByDedupeKey.mockReturnValue(undefined);
});
afterEach(() => vi.useRealTimers());

describe("monthly-report-email", () => {
  it("does nothing after the first week of the month", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-29T09:00:00.000Z"));
    expect(await monthlyReportEmailJob.run()).toMatch(/Not in the first 7 days/);
    expect(mail.sendEmail).not.toHaveBeenCalled();
  });

  it("in the first week: each manager gets their own gym's report for last month, with the workbook attached; coaches and archived staff get nothing", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-02T09:00:00.000Z"));
    const summary = await monthlyReportEmailJob.run();
    expect(summary).toBe("October 2026 report sent to 3 managers.");
    expect(ex.buildMasterWorkbook.mock.calls.map((c) => [(c as unknown[])[0], (c as unknown[])[1]])).toEqual([
      [{ gymId: null }, "last-month"],
      [{ gymId: "gym-b" }, "last-month"],
      [{ gymId: null }, "last-month"], // a platform operator gets the primary gym's report
    ]);
    const email = mail.sendEmail.mock.calls[0][0];
    expect(email).toMatchObject({ to: "owner@x.test", subject: "S&C monthly report: October 2026" });
    expect(email.attachments[0]).toEqual({ filename: "sc-report-2026-10.xlsx", content: Buffer.from("xlsx").toString("base64") });
    expect(email.text).toContain("Current gym members: 4");
    expect(email.text).toContain("Average fill rate: 50%");
    expect(h.createNotification.mock.calls[0][0]).toMatchObject({ type: "monthly_report", dedupeKey: "monthly-report:2026-10", linkHref: "/staff/exports?range=last-month" });
  });

  it("sends once per person per month", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-03T09:00:00.000Z"));
    h.findNotificationByDedupeKey.mockReturnValue({ id: "already" });
    expect(await monthlyReportEmailJob.run()).toBe("October 2026 report sent to 0 managers.");
    expect(mail.sendEmail).not.toHaveBeenCalled();
  });
});
