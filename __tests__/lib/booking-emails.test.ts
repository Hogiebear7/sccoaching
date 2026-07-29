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

import {
  sendBookingConfirmationEmail,
  sendBookingCancellationEmail,
  sendClassCancelledEmail,
} from "@/lib/booking-emails";
import {
  bookingCancellationEmail,
  bookingConfirmationEmail,
  classCancelledEmail,
} from "@/lib/email-templates";
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
    });
    expect(html).not.toContain("Coach:");
    expect(text).not.toContain("Coach:");
  });
});

describe("bookingCancellationEmail template", () => {
  it("mentions restored credit only when it applies", () => {
    const restored = bookingCancellationEmail({
      memberName: "Alex",
      className: "Sunrise Strength",
      classDate: "Thu, Jul 30",
      startTime: "06:30",
      creditRestored: true,
    });
    expect(restored.subject).toBe("Booking cancelled: Sunrise Strength");
    expect(restored.html).toContain("session credit has been restored");
    expect(restored.text).toContain("session credit has been restored");
  });

  it("stays neutral (no credit claim) when credit was not restored", () => {
    const neutral = bookingCancellationEmail({
      memberName: "Alex",
      className: "Sunrise Strength",
      classDate: "Thu, Jul 30",
      startTime: "06:30",
      creditRestored: false,
    });
    expect(neutral.html).not.toContain("credit");
    expect(neutral.text).not.toContain("credit");
    expect(neutral.html).toContain("has been cancelled");
  });
});

describe("classCancelledEmail template", () => {
  it("uses gym-initiated wording (not member-initiated)", () => {
    const { subject, html, text } = classCancelledEmail({
      memberName: "Alex",
      className: "Sunrise Strength",
      classDate: "Thu, Jul 30",
      startTime: "06:30",
      creditRestored: true,
    });
    expect(subject).toBe("Class cancelled: Sunrise Strength");
    expect(html).toContain("cancelled by S&amp;C Performance Coaching");
    expect(text).toContain("cancelled by S&C Performance Coaching");
    // Distinct from a member's own cancellation phrasing.
    expect(html).not.toContain("Your booking");
    expect(html).toContain("session credit has been returned");
  });

  it("stays neutral on credit when none was restored", () => {
    const { html, text } = classCancelledEmail({
      memberName: "Alex",
      className: "Sunrise Strength",
      classDate: "Thu, Jul 30",
      startTime: "06:30",
      creditRestored: false,
    });
    expect(html).not.toContain("credit");
    expect(text).not.toContain("credit");
  });
});

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
});

describe("sendBookingCancellationEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsTransactionalEmailEnabled.mockReturnValue(true);
    mockFindUserById.mockReturnValue({ id: "coach-1", email: "coach@demo.local" });
    mockFindProfileByUserId.mockReturnValue({
      email: "alex@example.com",
      fullName: "Alex",
      emailNotificationsEnabled: true,
    });
  });

  it("sends a neutral cancellation when no credit was restored", () => {
    sendBookingCancellationEmail("member-1", CLASS, false);
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    const payload = mockSendEmail.mock.calls[0][0];
    expect(payload.to).toBe("alex@example.com");
    expect(payload.subject).toBe("Booking cancelled: Sunrise Strength");
    expect(payload.text).not.toContain("credit");
  });

  it("mentions restored credit when it applied", () => {
    sendBookingCancellationEmail("member-1", CLASS, true);
    const payload = mockSendEmail.mock.calls[0][0];
    expect(payload.text).toContain("session credit has been restored");
  });

  it("respects the email opt-out", () => {
    mockFindProfileByUserId.mockReturnValue({
      email: "alex@example.com",
      fullName: "Alex",
      emailNotificationsEnabled: false,
    });
    sendBookingCancellationEmail("member-1", CLASS, true);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });
});

describe("sendClassCancelledEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsTransactionalEmailEnabled.mockReturnValue(true);
    mockFindUserById.mockReturnValue({ id: "coach-1", email: "coach@demo.local" });
  });

  it("sends a gym-initiated cancellation to an affected member", () => {
    mockFindProfileByUserId.mockReturnValue({
      email: "alex@example.com",
      fullName: "Alex",
      emailNotificationsEnabled: true,
    });
    sendClassCancelledEmail("member-1", CLASS, true);
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    const payload = mockSendEmail.mock.calls[0][0];
    expect(payload.to).toBe("alex@example.com");
    expect(payload.subject).toBe("Class cancelled: Sunrise Strength");
    expect(payload.text).toContain("cancelled by S&C Performance Coaching");
    expect(payload.text).toContain("session credit has been returned");
  });

  it("does not send to a member who opted out (unaffected by email)", () => {
    mockFindProfileByUserId.mockReturnValue({
      email: "alex@example.com",
      fullName: "Alex",
      emailNotificationsEnabled: false,
    });
    sendClassCancelledEmail("member-1", CLASS, true);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("does not send when staff have disabled the class-cancelled email", () => {
    mockIsTransactionalEmailEnabled.mockReturnValue(false);
    mockFindProfileByUserId.mockReturnValue({
      email: "alex@example.com",
      fullName: "Alex",
      emailNotificationsEnabled: true,
    });
    sendClassCancelledEmail("member-1", CLASS, true);
    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(mockIsTransactionalEmailEnabled).toHaveBeenCalledWith("classCancelled");
  });
});
