import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MEMBER_SESSION_LIFETIME_MS, signSession } from "@/lib/session";

const {
  mockFindUserById,
  mockFindProfileByUserId,
  mockCreateMessage,
  mockCreateNotification,
  mockFindSubscriptionByUserId,
  mockFindMembershipPackageById,
} = vi.hoisted(() => ({
  mockFindUserById: vi.fn(),
  mockFindProfileByUserId: vi.fn(),
  mockCreateMessage: vi.fn(),
  mockCreateNotification: vi.fn(),
  mockFindSubscriptionByUserId: vi.fn(),
  mockFindMembershipPackageById: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  findUserById: mockFindUserById,
  findProfileByUserId: mockFindProfileByUserId,
  createMessage: mockCreateMessage,
  createNotification: mockCreateNotification,
  findSubscriptionByUserId: mockFindSubscriptionByUserId,
  findMembershipPackageById: mockFindMembershipPackageById,
}));

vi.mock("@/lib/push", () => ({ sendPush: vi.fn() }));

const MEMBER_USER = { id: "user-1", email: "athlete@example.com", role: "member" as const };
const STAFF_USER = { id: "staff-1", email: "coach@example.com", role: "coach" as const };

async function callMessagesSend(body: unknown, cookie: string) {
  const { POST } = await import("@/app/api/messages/send/route");
  const request = new NextRequest("http://localhost/api/messages/send", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: `session=${cookie}` },
    body: JSON.stringify(body),
  });
  return POST(request);
}

describe("POST /api/messages/send", () => {
  beforeEach(() => {
    mockFindUserById.mockReset();
    mockFindProfileByUserId.mockReset();
    mockCreateMessage.mockReset();
    mockCreateNotification.mockReset();
    mockFindSubscriptionByUserId.mockReset();
    mockFindMembershipPackageById.mockReset();
    mockFindProfileByUserId.mockReturnValue({ fullName: "Athlete" });
  });

  it("blocks a Free tier member from messaging a coach", async () => {
    mockFindUserById.mockReturnValue(MEMBER_USER);
    mockFindSubscriptionByUserId.mockReturnValue(undefined);
    const cookie = signSession({ userId: MEMBER_USER.id }, MEMBER_SESSION_LIFETIME_MS);

    const res = await callMessagesSend({ body: "Hi coach" }, cookie);
    const data = await res.json();

    expect(res.status).toBe(403);
    expect(data.message).toBe("Messaging a coach is available on the Membership tier.");
    expect(mockCreateMessage).not.toHaveBeenCalled();
  });

  it("blocks an App Subscription tier member from messaging a coach", async () => {
    mockFindUserById.mockReturnValue(MEMBER_USER);
    mockFindSubscriptionByUserId.mockReturnValue({ packageId: "pkg-1", status: "active" });
    mockFindMembershipPackageById.mockReturnValue({ id: "pkg-1", deliveryChannel: "app_only" });
    const cookie = signSession({ userId: MEMBER_USER.id }, MEMBER_SESSION_LIFETIME_MS);

    const res = await callMessagesSend({ body: "Hi coach" }, cookie);

    expect(res.status).toBe(403);
    expect(mockCreateMessage).not.toHaveBeenCalled();
  });

  it("allows a Membership tier member to message a coach", async () => {
    mockFindUserById.mockReturnValue(MEMBER_USER);
    mockFindSubscriptionByUserId.mockReturnValue({ packageId: "pkg-2", status: "active" });
    mockFindMembershipPackageById.mockReturnValue({ id: "pkg-2", deliveryChannel: "in_person" });
    const cookie = signSession({ userId: MEMBER_USER.id }, MEMBER_SESSION_LIFETIME_MS);

    const res = await callMessagesSend({ body: "Hi coach" }, cookie);

    expect(res.status).toBe(201);
    expect(mockCreateMessage).toHaveBeenCalledTimes(1);
  });

  it("never gates staff replying into a member's thread, regardless of that member's tier", async () => {
    mockFindUserById.mockReturnValue(STAFF_USER);
    const cookie = signSession({ userId: STAFF_USER.id }, MEMBER_SESSION_LIFETIME_MS);

    const res = await callMessagesSend({ memberId: MEMBER_USER.id, body: "Hi there" }, cookie);

    expect(res.status).toBe(201);
    expect(mockCreateMessage).toHaveBeenCalledTimes(1);
    // Staff sends never even consult tier resolution — confirms the gate is
    // scoped to member-initiated sends only.
    expect(mockFindSubscriptionByUserId).not.toHaveBeenCalled();
  });
});
