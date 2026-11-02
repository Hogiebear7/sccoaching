// lib/push.ts Expo sending: a member whose devices registered under different Expo projects (e.g. Android built on one EAS account, a later
// build on another) must still get the notification on every device, and a refusal must be logged, never silently dropped.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  deleteExpoPushTokenByToken: vi.fn(),
  deletePushSubscriptionByEndpoint: vi.fn(),
  findExpoPushTokensByUserId: vi.fn(),
  findPushSubscriptionsByUserId: vi.fn(() => []),
}));
vi.mock("@/lib/db", () => h);
vi.mock("./db", () => h);

import { sendPush } from "@/lib/push";

const OLD = "ExponentPushToken[old-project-token]";
const NEW = "ExponentPushToken[new-project-token]";
const payload = { title: "New message from your coach", body: "See you at 6", linkHref: "/dashboard/messages" };

let fetchMock: ReturnType<typeof vi.fn>;
const sentBatches = () => fetchMock.mock.calls.map(([, init]) => (JSON.parse(init.body) as { to: string }[]).map((m) => m.to));

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  h.findExpoPushTokensByUserId.mockReturnValue([{ token: OLD }, { token: NEW }]);
});
afterEach(() => vi.unstubAllGlobals());

const reply = (body: unknown) => ({ json: async () => body });

describe("Expo push across projects", () => {
  it("re-sends one project at a time when Expo refuses a mixed batch", async () => {
    fetchMock
      .mockResolvedValueOnce(
        reply({
          errors: [
            {
              code: "PUSH_TOO_MANY_EXPERIENCE_IDS",
              message: "All push notification messages in the same request must be for the same project",
              details: { "@hogiebear777/sc-coaching-mobile": [OLD], "@sandcmails-team/sc-coaching-mobile": [NEW] },
            },
          ],
        })
      )
      .mockResolvedValueOnce(reply({ data: [{ status: "error", details: { error: "DeviceNotRegistered" } }] }))
      .mockResolvedValueOnce(reply({ data: [{ status: "ok" }] }));

    await sendPush("member-1", payload);

    expect(sentBatches()).toEqual([[OLD, NEW], [OLD], [NEW]]);
    // The stale token from the old project is cleaned up; the new device got its ticket.
    expect(h.deleteExpoPushTokenByToken).toHaveBeenCalledWith(OLD);
    expect(h.deleteExpoPushTokenByToken).not.toHaveBeenCalledWith(NEW);
  });

  it("sends one request when every token is from the same project", async () => {
    fetchMock.mockResolvedValueOnce(reply({ data: [{ status: "ok" }, { status: "ok" }] }));
    await sendPush("member-1", payload);
    expect(sentBatches()).toEqual([[OLD, NEW]]);
  });

  it("logs any other refusal of the whole request instead of dropping it silently", async () => {
    fetchMock.mockResolvedValueOnce(reply({ errors: [{ code: "VALIDATION_ERROR", message: "bad request" }] }));
    await sendPush("member-1", payload);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("expo refused the request"), expect.stringContaining("VALIDATION_ERROR"));
  });
});
