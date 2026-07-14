import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockFindMembers,
  mockFindNotificationByDedupeKey,
  mockCreateNotification,
  mockFindPassLedgerByUserId,
} = vi.hoisted(() => ({
  mockFindMembers: vi.fn(),
  mockFindNotificationByDedupeKey: vi.fn(),
  mockCreateNotification: vi.fn(),
  mockFindPassLedgerByUserId: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  findMembers: mockFindMembers,
  findNotificationByDedupeKey: mockFindNotificationByDedupeKey,
  createNotification: mockCreateNotification,
  findPassLedgerByUserId: mockFindPassLedgerByUserId,
  findPassLedgerByPurchaseId: vi.fn(() => []),
  findPassLedgerByBookingId: vi.fn(() => []),
  findClassPassProductById: vi.fn(),
  appendPassLedgerEntry: vi.fn(),
  savePurchase: vi.fn(),
}));

import { notifyExpiringPassesJob } from "@/lib/jobs/notify-expiring-passes";

const MEMBER = { id: "member-1", email: "alex@example.com", role: "member" as const };

function soonIso(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

function credit(delta: number, expiresAt: string | null, at: string) {
  return {
    id: `led-${at}`,
    userId: "member-1",
    delta,
    reason: "purchase" as const,
    purchaseId: `p-${at}`,
    bookingId: null,
    expiresAt,
    note: null,
    createdAt: at,
  };
}

describe("notify-expiring-passes job", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindMembers.mockReturnValue([MEMBER]);
    mockFindNotificationByDedupeKey.mockReturnValue(undefined);
    mockFindPassLedgerByUserId.mockReturnValue([]);
  });

  it("warns once about usable passes expiring within the window", async () => {
    const expiresAt = soonIso(3);
    mockFindPassLedgerByUserId.mockReturnValue([
      credit(5, expiresAt, "2026-01-01T00:00:00.000Z"),
    ]);

    const summary = await notifyExpiringPassesJob.run();

    expect(summary).toContain("Warned 1 member");
    const written = mockCreateNotification.mock.calls[0][0];
    expect(written).toMatchObject({
      userId: "member-1",
      type: "membership",
      linkHref: "/dashboard/schedule",
      dedupeKey: `pass-expiry:${expiresAt.slice(0, 10)}`,
    });
    expect(written.title).toContain("5 class passes");
  });

  it("stays quiet for far-future, already-expired, and empty pools", async () => {
    mockFindPassLedgerByUserId.mockReturnValue([
      credit(5, soonIso(60), "2026-01-01T00:00:00.000Z"),
      credit(3, soonIso(-2), "2026-01-02T00:00:00.000Z"),
      credit(2, null, "2026-01-03T00:00:00.000Z"),
    ]);

    const summary = await notifyExpiringPassesJob.run();

    expect(summary).toBe("No members with passes expiring soon.");
    expect(mockCreateNotification).not.toHaveBeenCalled();
  });

  it("does not re-announce the same expiry batch and skips archived members", async () => {
    const expiresAt = soonIso(3);
    mockFindPassLedgerByUserId.mockReturnValue([
      credit(5, expiresAt, "2026-01-01T00:00:00.000Z"),
    ]);
    mockFindNotificationByDedupeKey.mockReturnValue({ id: "existing" });

    await notifyExpiringPassesJob.run();
    expect(mockCreateNotification).not.toHaveBeenCalled();

    mockFindNotificationByDedupeKey.mockReturnValue(undefined);
    mockFindMembers.mockReturnValue([{ ...MEMBER, archivedAt: "2026-01-01T00:00:00.000Z" }]);
    await notifyExpiringPassesJob.run();
    expect(mockCreateNotification).not.toHaveBeenCalled();
  });

  it("ignores pools already spent down to zero", async () => {
    const expiresAt = soonIso(3);
    mockFindPassLedgerByUserId.mockReturnValue([
      credit(1, expiresAt, "2026-01-01T00:00:00.000Z"),
      {
        id: "led-c",
        userId: "member-1",
        delta: -1,
        reason: "consume" as const,
        purchaseId: null,
        bookingId: "bk-1",
        note: null,
        createdAt: "2026-01-02T00:00:00.000Z",
      },
    ]);

    const summary = await notifyExpiringPassesJob.run();

    expect(summary).toBe("No members with passes expiring soon.");
    expect(mockCreateNotification).not.toHaveBeenCalled();
  });
});
