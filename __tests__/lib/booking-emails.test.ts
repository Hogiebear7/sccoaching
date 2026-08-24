import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockFindProfileByUserId, mockFindUserById, mockIsTransactionalEmailEnabled, mockSendEmail } =
  vi.hoisted(() => ({
    mockFindProfileByUserId: vi.fn(),
    mockFindUserById: vi.fn(),
    mockIsTransactionalEmailEnabled: vi.fn(),
    mockSendEmail: vi.fn(),
  }));

vi.mock("@/lib/db", () => ({
  findProfileByUserId: mockFindProfileByUserId,
  findUserById: mockFindUserById,
  isTransactionalEmailEnabled: mockIsTransactionalEmailEnabled,
}));

vi.mock("@/lib/email", () => ({ sendEmail: mockSendEmail }));

import { sendBookingConfirmationEmail } from "@/lib/booking-emails";
import { bookingConfirmationEmail } from "@/lib/email-templates";
import type { ClassRecord } from "@/lib/db";

const CLASS: ClassRecord = {
  id: "class-1",
  title: "Sunrise Strength",
  category: "strength",
  coachUserId: "coach-1",
  date: "2026-07-30",
  startTime: "06:30",
  durationMins: 60,
  capacity: 12,
  imageUrl: null,
  imageAlt: null,
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
};

// ─── Templates (pure) ────────────────────────────────────────────────────────

describe("bookingConfirmationEmail template", () => {
  it("includes class details, coach, and a bookings link", () => {
    const { subject, html, text } = bookingConfirmationEmail({
      memberName: "Alex",
      className: "Sunrise Strength",
      classDate: "Thu, Jul 30",
      startTime: "06:30",
      durationLabel: "60 min",
      coachName: "Coach Sarah",
      cancellationCutoffHours: 3,
    });
    expect(subject).toBe("Booking confirmed: Sunrise Strength");
    expect(html).toContain("Sunrise Strength");
    expect(html).toContain("Thu, Jul 30");
    expect(html).toContain("06:30 · 60 min");
    expect(html).toContain("Coach Sarah");
    expect(html).toContain("/dashboard/bookings");
    expect(text).toContain("Coach: Coach Sarah");
  });

  it("omits the coach line when no coach name is given", () => {
    const { html, text } = bookingConfirmationEmail({
      memberName: "Alex",
      className: "Sunrise Strength",
      classDate: "Thu, Jul 30",
      startTime: "06:30",
      durationLabel: "60 min",
      coachName: null,
      cancellationCutoffHours: 3,
    });
    expect(html).not.toContain("Coach:");
    expect(text).not.toContain("Coach:");
  });

  it("includes the cancellation policy with the configured cutoff", () => {
    const { html, text } = bookingConfirmationEmail({
      memberName: "Alex",
      className: "Sunrise Strength",
      classDate: "Thu, Jul 30",
      startTime: "06:30",
      durationLabel: "60 min",
      coachName: null,
      cancellationCutoffHours: 5,
    });
    expect(html).toContain("Cancel at least 5 hours before");
    expect(text).toContain("Cancel at least 5 hours before");
  });
});

// bookingCancellationEmail and classCancelledEmail templates still exist in
// lib/email-templates.ts (unused for now — booking cancellation and
// gym-cancelled classes are push-only, see lib/db.ts) but are no longer
// wired to any send path, so there's nothing left here to test against.

// ─── Helpers (gating + send) ─────────────────────────────────────────────────

describe("sendBookingConfirmationEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsTransactionalEmailEnabled.mockReturnValue(true);
    mockFindUserById.mockReturnValue({ id: "coach-1", email: "coach@demo.local" });
  });

  it("sends once to the member when email is enabled", () => {
    mockFindProfileByUserId.mockImplementation((id: string) =>
      id === "member-1"
        ? { email: "alex@example.com", fullName: "Alex", emailNotificationsEnabled: true }
        : { fullName: "Coach Sarah" }
    );

    sendBookingConfirmationEmail("member-1", CLASS);

    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "alex@example.com",
        subject: "Booking confirmed: Sunrise Strength",
      })
    );
  });

  it("does not send when the member opted out of email", () => {
    mockFindProfileByUserId.mockReturnValue({
      email: "alex@example.com",
      fullName: "Alex",
      emailNotificationsEnabled: false,
    });
    sendBookingConfirmationEmail("member-1", CLASS);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("does not send when the member has no email address", () => {
    mockFindProfileByUserId.mockReturnValue({
      email: null,
      fullName: "Alex",
      emailNotificationsEnabled: true,
    });
    sendBookingConfirmationEmail("member-1", CLASS);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("does not send when staff have disabled this email type", () => {
    mockIsTransactionalEmailEnabled.mockReturnValue(false);
    mockFindProfileByUserId.mockReturnValue({
      email: "alex@example.com",
      fullName: "Alex",
      emailNotificationsEnabled: true,
    });
    sendBookingConfirmationEmail("member-1", CLASS);
    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(mockIsTransactionalEmailEnabled).toHaveBeenCalledWith("bookingConfirmation");
  });

  it("attaches a calendar invite for the class", () => {
    mockFindProfileByUserId.mockImplementation((id: string) =>
      id === "member-1"
        ? { email: "alex@example.com", fullName: "Alex", emailNotificationsEnabled: true }
        : { fullName: "Coach Sarah" }
    );

    sendBookingConfirmationEmail("member-1", CLASS);

    const payload = mockSendEmail.mock.calls[0][0];
    expect(payload.attachments).toHaveLength(1);
    expect(payload.attachments[0].filename).toBe("class.ics");
    const decoded = Buffer.from(payload.attachments[0].content, "base64").toString("utf8");
    expect(decoded).toContain("BEGIN:VCALENDAR");
    expect(decoded).toContain("SUMMARY:Sunrise Strength");
  });
});

