// lib/staff-actions.ts: the staff change log (admin revamp S6). Each gym sees only its own members' changes; names are looked up when read, so a
// deleted member or former staff member still shows a row.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  appendStaffAction: vi.fn(),
  findStaffActions: vi.fn(),
  findUserById: vi.fn(),
  findProfileByUserId: vi.fn(),
}));
vi.mock("@/lib/db", () => h);

import { listStaffActions, recordStaffAction } from "@/lib/staff-actions";

const users: Record<string, { id: string; email: string; gymId: string | null }> = {
  owner: { id: "owner", email: "owner@x.test", gymId: null },
  aoife: { id: "aoife", email: "aoife@x.test", gymId: null },
  other: { id: "other", email: "other@x.test", gymId: "gym-b" },
};

beforeEach(() => {
  vi.clearAllMocks();
  h.findUserById.mockImplementation((id: string) => users[id]);
  h.findProfileByUserId.mockImplementation((id: string) => (id === "aoife" ? { fullName: "Aoife Byrne" } : undefined));
  h.findStaffActions.mockReturnValue([
    { id: "1", at: "2026-10-01T09:00:00.000Z", gymId: null, staffUserId: "owner", memberUserId: "aoife", type: "app_access_granted", detail: { endsOn: "2026-12-31", note: null } },
    { id: "2", at: "2026-10-20T09:00:00.000Z", gymId: "gym-b", staffUserId: "x", memberUserId: "other", type: "ai_paused", detail: {} },
    { id: "3", at: "2026-10-25T09:00:00.000Z", gymId: null, staffUserId: "gone", memberUserId: "deleted", type: "member_deleted", detail: {} },
  ]);
});

describe("staff change log", () => {
  it("records the member's gym, so the right gym sees it", () => {
    recordStaffAction(users.owner, users.other, "ai_paused");
    expect(h.appendStaffAction).toHaveBeenCalledWith({ gymId: "gym-b", staffUserId: "owner", memberUserId: "other", type: "ai_paused", detail: {} });
  });

  it("lists only the acting gym's changes, newest first, with readable names and details", () => {
    const rows = listStaffActions({ gymId: null }, null, "2026-10-30");
    expect(rows.map((r) => [r.staff, r.member, r.action, r.detail])).toEqual([
      ["Former staff", "Deleted member", "Deleted account", ""],
      ["owner@x.test", "Aoife Byrne", "Gave free App Subscription", "until 2026-12-31"],
    ]);
    expect(listStaffActions({ gymId: "gym-b" }, null, "2026-10-30").map((r) => r.id)).toEqual(["2"]);
  });

  it("filters by date", () => {
    expect(listStaffActions({ gymId: null }, "2026-10-10", "2026-10-30").map((r) => r.id)).toEqual(["3"]);
  });
});
