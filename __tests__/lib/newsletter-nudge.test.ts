import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockStaff, mockNotifFind, mockNotifCreate, mockOptIns, mockSend } = vi.hoisted(() => ({
  mockStaff: vi.fn(),
  mockNotifFind: vi.fn(),
  mockNotifCreate: vi.fn(),
  mockOptIns: vi.fn(),
  mockSend: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ findStaffUsers: mockStaff, findNotificationByDedupeKey: mockNotifFind, createNotification: mockNotifCreate }));
vi.mock("@/lib/comms-optins", () => ({ listOptIns: mockOptIns }));
vi.mock("@/lib/email", () => ({ sendEmail: mockSend }));

const OWNER = { id: "o1", email: "owner@x.test", role: "admin_manager", gymId: null };
const people = (gym: number, app: number) => [...Array(gym).fill({ type: "gym" }), ...Array(app).fill({ type: "app" })];

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  delete process.env.NEWSLETTER_REMINDER_DATE;
  mockStaff.mockReturnValue([OWNER]);
  mockNotifFind.mockReturnValue(undefined);
});

describe("newsletter nudge", () => {
  it("says nothing with a small list before the reminder date", async () => {
    process.env.NEWSLETTER_REMINDER_DATE = "2999-01-01";
    mockOptIns.mockReturnValue(people(2, 3));
    const { newsletterNudgeJob } = await import("@/lib/jobs/newsletter-nudge");
    expect(await newsletterNudgeJob.run()).toContain("Nothing to nudge");
    expect(mockNotifCreate).not.toHaveBeenCalled();
  });

  it("tells the owner when the list reaches 10, once", async () => {
    process.env.NEWSLETTER_REMINDER_DATE = "2999-01-01";
    mockOptIns.mockReturnValue(people(4, 6));
    const { newsletterNudgeJob } = await import("@/lib/jobs/newsletter-nudge");
    await newsletterNudgeJob.run();
    expect(mockNotifCreate).toHaveBeenCalledTimes(1);
    expect(mockNotifCreate.mock.calls[0][0]).toMatchObject({ type: "newsletter_nudge", dedupeKey: "newsletter-list-ready" });
    expect(mockSend).toHaveBeenCalledTimes(1);
    mockNotifFind.mockReturnValue({ id: "already" });
    mockNotifCreate.mockClear();
    mockSend.mockClear();
    await newsletterNudgeJob.run();
    expect(mockNotifCreate).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("reminds on or after the reminder date even with a small list", async () => {
    process.env.NEWSLETTER_REMINDER_DATE = "2020-01-01";
    mockOptIns.mockReturnValue(people(1, 1));
    const { newsletterNudgeJob } = await import("@/lib/jobs/newsletter-nudge");
    await newsletterNudgeJob.run();
    expect(mockNotifCreate.mock.calls[0][0].dedupeKey).toBe("newsletter-first-due:2020-01-01");
    expect(mockNotifCreate.mock.calls[0][0].body).toContain("2 opted in (1 gym, 1 app)");
  });
});
