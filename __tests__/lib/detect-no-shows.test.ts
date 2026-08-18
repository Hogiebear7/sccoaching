import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockFindAllBookings,
  mockFindClassById,
  mockFindNoShowsByUserId,
  mockCreateNoShow,
  mockMarkBookingNoShowProcessed,
  mockFindWatchlistEntryByUserAndMonth,
  mockSaveWatchlistEntry,
  mockFindNotificationByDedupeKey,
  mockCreateNotification,
  mockFindProfileByUserId,
  mockIsTransactionalEmailEnabled,
  mockSendEmail,
  mockSendPush,
} = vi.hoisted(() => ({
  mockFindAllBookings: vi.fn(),
  mockFindClassById: vi.fn(),
  mockFindNoShowsByUserId: vi.fn(),
  mockCreateNoShow: vi.fn(),
  mockMarkBookingNoShowProcessed: vi.fn(),
  mockFindWatchlistEntryByUserAndMonth: vi.fn(),
  mockSaveWatchlistEntry: vi.fn(),
  mockFindNotificationByDedupeKey: vi.fn(),
  mockCreateNotification: vi.fn(),
  mockFindProfileByUserId: vi.fn(),
  mockIsTransactionalEmailEnabled: vi.fn(),
  mockSendEmail: vi.fn(),
  mockSendPush: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  findAllBookings: mockFindAllBookings,
  findClassById: mockFindClassById,
  findNoShowsByUserId: mockFindNoShowsByUserId,
  createNoShow: mockCreateNoShow,
  markBookingNoShowProcessed: mockMarkBookingNoShowProcessed,
  findWatchlistEntryByUserAndMonth: mockFindWatchlistEntryByUserAndMonth,
  saveWatchlistEntry: mockSaveWatchlistEntry,
  findNotificationByDedupeKey: mockFindNotificationByDedupeKey,
  createNotification: mockCreateNotification,
  findProfileByUserId: mockFindProfileByUserId,
  isTransactionalEmailEnabled: mockIsTransactionalEmailEnabled,
}));

vi.mock("@/lib/class-time", () => ({
  classStartMs: (date: string, startTime: string) => Date.parse(`${date}T${startTime}:00Z`),
}));

vi.mock("@/lib/email", () => ({ sendEmail: mockSendEmail }));
vi.mock("@/lib/push", () => ({ sendPush: mockSendPush }));

import { detectNoShowsJob } from "@/lib/jobs/detect-no-shows";

const NOW = Date.parse("2026-03-15T12:00:00Z");

function booking(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "booking-1",
    classId: "class-1",
    userId: "user-1",
    attendedAt: null,
    noShowProcessedAt: null,
    createdAt: "2026-03-01T00:00:00.000Z",
    ...overrides,
  };
}

function classRecord(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "class-1",
    title: "Semi-PT",
    date: "2026-03-15",
    startTime: "09:00", // ends 09:30 UTC — 2.5h before NOW
    durationMins: 30,
    ...overrides,
  };
}

describe("detectNoShowsJob", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.clearAllMocks();
    mockFindNoShowsByUserId.mockReturnValue([]);
    mockFindWatchlistEntryByUserAndMonth.mockReturnValue(undefined);
    mockFindNotificationByDedupeKey.mockReturnValue(undefined);
    mockIsTransactionalEmailEnabled.mockReturnValue(true);
    mockFindProfileByUserId.mockReturnValue({
      email: "member@example.com",
      fullName: "Member One",
      emailNotificationsEnabled: true,
      pushNotificationsEnabled: true,
    });
  });

  it("flags a booking nobody checked in for, an hour after class end", async () => {
    mockFindAllBookings.mockReturnValue([booking()]);
    mockFindClassById.mockReturnValue(classRecord());

    const summary = await detectNoShowsJob.run();

    expect(summary).toBe("Flagged 1 no-show.");
    expect(mockMarkBookingNoShowProcessed).toHaveBeenCalledWith("booking-1");
    expect(mockCreateNoShow).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1", classId: "class-1", monthKey: "2026-03" })
    );
    expect(mockCreateNotification).toHaveBeenCalledWith(
      expect.objectContaining({ type: "no_show", userId: "user-1" })
    );
    expect(mockSendEmail).toHaveBeenCalled();
    expect(mockSendPush).toHaveBeenCalled();
  });

  it("skips a booking that was checked in", async () => {
    mockFindAllBookings.mockReturnValue([booking({ attendedAt: "2026-03-15T09:05:00.000Z" })]);
    mockFindClassById.mockReturnValue(classRecord());

    const summary = await detectNoShowsJob.run();

    expect(summary).toBe("No new no-shows detected.");
    expect(mockMarkBookingNoShowProcessed).not.toHaveBeenCalled();
    expect(mockCreateNoShow).not.toHaveBeenCalled();
  });

  it("skips a booking already processed", async () => {
    mockFindAllBookings.mockReturnValue([booking({ noShowProcessedAt: "2026-03-15T10:35:00.000Z" })]);
    mockFindClassById.mockReturnValue(classRecord());

    const summary = await detectNoShowsJob.run();

    expect(summary).toBe("No new no-shows detected.");
    expect(mockCreateNoShow).not.toHaveBeenCalled();
  });

  it("does not flag a class that ended less than an hour ago", async () => {
    // Class ends at 11:30 UTC, NOW is 12:00 UTC — only 30 minutes of grace elapsed.
    mockFindAllBookings.mockReturnValue([booking()]);
    mockFindClassById.mockReturnValue(classRecord({ startTime: "11:00" }));

    const summary = await detectNoShowsJob.run();

    expect(summary).toBe("No new no-shows detected.");
    expect(mockMarkBookingNoShowProcessed).not.toHaveBeenCalled();
  });

  it("adds the member to the watchlist on their second miss this month, not the first or third", async () => {
    mockFindAllBookings.mockReturnValue([booking()]);
    mockFindClassById.mockReturnValue(classRecord());

    mockFindNoShowsByUserId.mockReturnValue([]);
    await detectNoShowsJob.run();
    expect(mockSaveWatchlistEntry).not.toHaveBeenCalled();

    mockFindNoShowsByUserId.mockReturnValue([{ monthKey: "2026-03" }]);
    await detectNoShowsJob.run();
    expect(mockSaveWatchlistEntry).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1", monthKey: "2026-03", missCount: 2 })
    );

    mockSaveWatchlistEntry.mockClear();
    mockFindNoShowsByUserId.mockReturnValue([{ monthKey: "2026-03" }, { monthKey: "2026-03" }]);
    await detectNoShowsJob.run();
    expect(mockSaveWatchlistEntry).not.toHaveBeenCalled();
  });

  it("does not recreate a watchlist entry that already exists for the month", async () => {
    mockFindAllBookings.mockReturnValue([booking()]);
    mockFindClassById.mockReturnValue(classRecord());
    mockFindNoShowsByUserId.mockReturnValue([{ monthKey: "2026-03" }]);
    mockFindWatchlistEntryByUserAndMonth.mockReturnValue({ id: "existing" });

    await detectNoShowsJob.run();

    expect(mockSaveWatchlistEntry).not.toHaveBeenCalled();
  });

  it("skips emailing when the no-show toggle is off but still notifies in-app and via push", async () => {
    mockIsTransactionalEmailEnabled.mockReturnValue(false);
    mockFindAllBookings.mockReturnValue([booking()]);
    mockFindClassById.mockReturnValue(classRecord());

    await detectNoShowsJob.run();

    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(mockCreateNotification).toHaveBeenCalled();
    expect(mockSendPush).toHaveBeenCalled();
  });
});
