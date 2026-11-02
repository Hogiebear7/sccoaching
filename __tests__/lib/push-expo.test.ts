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

  it("asks for high priority and sound, and names the Alerts channel only for installs that have it", async () => {
    h.findExpoPushTokensByUserId.mockReturnValue([{ token: OLD }, { token: NEW, androidChannel: "alerts" }]);
    fetchMock.mockResolvedValueOnce(reply({ data: [{ status: "ok" }, { status: "ok" }] }));
    await sendPush("member-1", payload);
    const [older, newer] = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(older).toMatchObject({ priority: "high", sound: "default" });
    expect(older).not.toHaveProperty("channelId");
    expect(newer).toMatchObject({ priority: "high", sound: "default", channelId: "alerts" });
  });

  it("asks Expo for the delivery receipt later and logs a failure such as a bad key", async () => {
    vi.useFakeTimers();
    try {
      h.findExpoPushTokensByUserId.mockReturnValue([{ token: NEW }]);
      fetchMock
        .mockResolvedValueOnce(reply({ data: [{ status: "ok", id: "ticket-1" }] }))
        .mockResolvedValueOnce(reply({ data: {} })) // not ready at the first check
        .mockResolvedValueOnce(reply({ data: { "ticket-1": { status: "error", message: "Unable to retrieve the FCM server key", details: { error: "InvalidCredentials" } } } }));
      await sendPush("member-1", payload);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(2 * 60_000);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[1][0]).toContain("getReceipts");
      expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ ids: ["ticket-1"] });
      await vi.advanceTimersByTimeAsync(15 * 60_000);
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining("InvalidCredentials"));
    } finally {
      vi.useRealTimers();
    }
  });

  it("a receipt saying the device is gone removes that token", async () => {
    vi.useFakeTimers();
    try {
      h.findExpoPushTokensByUserId.mockReturnValue([{ token: NEW }]);
      fetchMock
        .mockResolvedValueOnce(reply({ data: [{ status: "ok", id: "ticket-2" }] }))
        .mockResolvedValueOnce(reply({ data: { "ticket-2": { status: "error", details: { error: "DeviceNotRegistered" } } } }));
      await sendPush("member-1", payload);
      await vi.advanceTimersByTimeAsync(2 * 60_000);
      expect(h.deleteExpoPushTokenByToken).toHaveBeenCalledWith(NEW);
    } finally {
      vi.useRealTimers();
    }
  });

  it("logs any other refusal of the whole request instead of dropping it silently", async () => {
    fetchMock.mockResolvedValueOnce(reply({ errors: [{ code: "VALIDATION_ERROR", message: "bad request" }] }));
    await sendPush("member-1", payload);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("expo refused the request"), expect.stringContaining("VALIDATION_ERROR"));
  });
});
