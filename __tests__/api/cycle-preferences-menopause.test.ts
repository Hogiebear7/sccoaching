import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MEMBER_SESSION_LIFETIME_MS, signSession } from "@/lib/session";

const h = vi.hoisted(() => ({ findUserById: vi.fn(), findProfileByUserId: vi.fn(), saveProfile: vi.fn() }));
vi.mock("@/lib/db", () => h);

async function post(body: unknown) {
  const { POST } = await import("@/app/api/cycle/preferences/route");
  const cookie = signSession({ userId: "u1" }, MEMBER_SESSION_LIFETIME_MS);
  return POST(new NextRequest("http://localhost/api/cycle/preferences", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: `session=${cookie}` },
    body: JSON.stringify(body),
  }));
}
const saved = () => h.saveProfile.mock.calls.at(-1)![0];

beforeEach(() => {
  vi.clearAllMocks();
  h.findUserById.mockReturnValue({ id: "u1" });
  h.findProfileByUserId.mockReturnValue({ userId: "u1", menopauseSupportEnabled: false, menopauseStage: null, menopauseShareWithCoach: false });
});

describe("POST /api/cycle/preferences (menopause)", () => {
  it("choosing a stage switches support on", async () => {
    await post({ menopauseStage: "postmenopause" });
    expect(saved()).toMatchObject({ menopauseStage: "postmenopause", menopauseSupportEnabled: true });
  });

  it("older apps sending only the switch keep the stage", async () => {
    h.findProfileByUserId.mockReturnValue({ userId: "u1", menopauseSupportEnabled: true, menopauseStage: "perimenopause", menopauseShareWithCoach: true });
    await post({ menopauseSupportEnabled: true });
    expect(saved()).toMatchObject({ menopauseStage: "perimenopause", menopauseShareWithCoach: true });
  });

  it("switching support off clears stage and sharing", async () => {
    h.findProfileByUserId.mockReturnValue({ userId: "u1", menopauseSupportEnabled: true, menopauseStage: "perimenopause", menopauseShareWithCoach: true });
    await post({ menopauseSupportEnabled: false });
    expect(saved()).toMatchObject({ menopauseSupportEnabled: false, menopauseStage: null, menopauseShareWithCoach: false });
  });

  it("rejects an unknown stage", async () => {
    expect((await post({ menopauseStage: "menopause" })).status).toBe(400);
  });
});
