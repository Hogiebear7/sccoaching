// Gym isolation for the two staff AI routes that take a memberId from the
// request body:
//   POST /api/ai/coach-summary   (generateCoachSummary — loads the member's
//                                 training/recovery/nutrition data)
//   POST /api/ai/draft-reply     (draftReply — reads the member's messages)
// The memberId is client input, so the member is only trusted once it is in the
// acting staff member's own gym (gymId: null is the primary gym,
// lib/gym-scope.ts). A cross-gym member reads exactly like a missing one (the
// existing 404 "Member not found."), and — the point of this file — no member
// data is loaded and nothing is sent to the AI provider on denial. Auth uses
// the real signed-session mechanism; sameGym / can are deliberately not mocked.
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MEMBER_SESSION_LIFETIME_MS, signSession } from "@/lib/session";

const h = vi.hoisted(() => ({
  findUserById: vi.fn(),
  findMessagesByMemberId: vi.fn(),
  generateCoachSummary: vi.fn(),
  draftReply: vi.fn(),
  isAiConfigured: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ findUserById: h.findUserById, findMessagesByMemberId: h.findMessagesByMemberId }));
vi.mock("@/lib/ai", () => ({
  generateCoachSummary: h.generateCoachSummary,
  draftReply: h.draftReply,
  isAiConfigured: h.isAiConfigured,
}));

type U = { id: string; email: string; role: string; gymId: string | null };
const user = (id: string, role: string, gymId: string | null): U => ({ id, email: `${id}@x.test`, role, gymId });

// Gym A = primary gym (gymId: null). Gym B = "gym-b".
const COACH_A = user("coach-a", "coach", null);
const COACH_B = user("coach-b", "coach", "gym-b");
const MEMBER_A = user("member-a", "member", null);
const MEMBER_B = user("member-b", "member", "gym-b");
const EVERYONE = [COACH_A, COACH_B, MEMBER_A, MEMBER_B];

const NOT_FOUND = { success: false, message: "Member not found." };

const call = async (route: "coach-summary" | "draft-reply", body: unknown, u?: U) => {
  const { POST } =
    route === "coach-summary"
      ? await import("@/app/api/ai/coach-summary/route")
      : await import("@/app/api/ai/draft-reply/route");
  return POST(
    new NextRequest(`http://localhost/api/ai/${route}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(u ? { Cookie: `session=${signSession({ userId: u.id }, MEMBER_SESSION_LIFETIME_MS)}` } : {}),
      },
      body: JSON.stringify(body),
    })
  );
};

beforeEach(() => {
  vi.clearAllMocks();
  h.findUserById.mockImplementation((id: string) => EVERYONE.find((u) => u.id === id));
  h.findMessagesByMemberId.mockReturnValue([{ senderRole: "member", body: "Hi coach" }]);
  h.generateCoachSummary.mockResolvedValue("SUMMARY");
  h.draftReply.mockResolvedValue("DRAFT");
  h.isAiConfigured.mockReturnValue(true);
});

describe.each([
  ["coach-summary", "summary", () => h.generateCoachSummary],
  ["draft-reply", "draft", () => h.draftReply],
] as const)("POST /api/ai/%s — gym-scoped member", (route, resultKey, generator) => {
  it("generates for a same-gym member (existing behavior)", async () => {
    const res = await call(route, { memberId: MEMBER_A.id }, COACH_A);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, configured: true, [resultKey]: resultKey === "summary" ? "SUMMARY" : "DRAFT" });
    expect(generator()).toHaveBeenCalledWith(expect.objectContaining({ memberId: MEMBER_A.id, staffUserId: COACH_A.id }));
  });

  it("works within the second gym too", async () => {
    const res = await call(route, { memberId: MEMBER_B.id }, COACH_B);

    expect(res.status).toBe(200);
    expect(generator()).toHaveBeenCalledWith(expect.objectContaining({ memberId: MEMBER_B.id }));
  });

  it("denies a cross-gym member with the missing-member 404 (both directions), loading and sending nothing", async () => {
    const crossGym = await call(route, { memberId: MEMBER_B.id }, COACH_A);
    const reverse = await call(route, { memberId: MEMBER_A.id }, COACH_B);
    const missing = await call(route, { memberId: "member-gone" }, COACH_A);

    for (const res of [crossGym, reverse, missing]) {
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual(NOT_FOUND);
    }
    expect(generator()).not.toHaveBeenCalled();
    expect(h.findMessagesByMemberId).not.toHaveBeenCalled();
  });

  it("does not let a cross-gym STAFF id through either", async () => {
    const res = await call(route, { memberId: COACH_B.id }, COACH_A);

    expect(res.status).toBe(404);
    expect(generator()).not.toHaveBeenCalled();
  });

  it("ignores a client-supplied gymId in the body", async () => {
    const res = await call(route, { memberId: MEMBER_B.id, gymId: null }, COACH_A);

    expect(res.status).toBe(404);
    expect(generator()).not.toHaveBeenCalled();
  });

  it("keeps 401 / 403 / validation unchanged, before any member lookup", async () => {
    expect((await call(route, { memberId: MEMBER_A.id })).status).toBe(401);
    expect((await call(route, { memberId: MEMBER_A.id }, MEMBER_A)).status).toBe(403);
    const missingId = await call(route, {}, COACH_A);
    expect(missingId.status).toBe(400);
    expect((await missingId.json()).message).toBe("A member is required.");
    expect(generator()).not.toHaveBeenCalled();
  });
});
