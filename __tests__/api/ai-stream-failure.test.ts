// A provider failure must reach the client as a CONTROLLED failure. REAL chat routes and a REAL temporary datastore; the AI library is replaced by a stand-in whose stream
// we script: fail before any text (a proper 502 JSON error is still possible because no byte has been sent), or fail after some text (the status is already 200, so the
// reply ends with a short note instead of a dropped connection).
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { primeAiStream } from "@/lib/ai-stream";
import { createFixture, type IapFixture } from "../helpers/iap-fixture";

type Ev = { type: string; delta?: { type: string; text: string } };
const script = vi.hoisted(() => ({ events: [] as (Ev | Error)[], throwOnCreate: false }));

function fakeStream() {
  if (script.throwOnCreate) throw new Error("provider unreachable (sync)");
  const events = [...script.events];
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return {
        async next() {
          if (i >= events.length) return { done: true as const, value: undefined };
          const e = events[i++];
          if (e instanceof Error) throw e;
          return { done: false as const, value: e };
        },
      };
    },
    async finalMessage() {
      return { stop_reason: "end_turn" };
    },
  };
}

vi.mock("@/lib/ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai")>();
  return { ...actual, isAiConfigured: () => true, createCoachChatStream: vi.fn(fakeStream), createNutritionCoachChatStream: vi.fn(fakeStream) };
});

const text = (t: string): Ev => ({ type: "content_block_delta", delta: { type: "text_delta", text: t } });
const start: Ev = { type: "message_start" };

describe("primeAiStream", () => {
  const stream = (events: (Ev | Error)[]) => {
    script.events = events;
    return fakeStream() as unknown as AsyncIterable<Ev>;
  };

  it("waits for the first text, replays what it already received, then the rest", async () => {
    const primed = await primeAiStream(stream([start, text("Hel"), text("lo")]));
    expect(primed.ok).toBe(true);
    if (!primed.ok) return;
    const seen: string[] = [];
    for await (const e of primed.replay()) seen.push(e.type === "content_block_delta" ? e.delta!.text : e.type);
    expect(seen).toEqual(["message_start", "Hel", "lo"]);
  });

  it("reports a failure that happens before any text, so the caller can still send an error status", async () => {
    const primed = await primeAiStream(stream([start, new Error("503 from provider")]));
    expect(primed.ok).toBe(false);
  });

  it("lets a failure AFTER the first text surface during replay, where the caller can end the reply with a note", async () => {
    const primed = await primeAiStream(stream([text("Part"), new Error("connection reset")]));
    expect(primed.ok).toBe(true);
    if (!primed.ok) return;
    const seen: string[] = [];
    await expect(
      (async () => {
        for await (const e of primed.replay()) seen.push(e.type === "content_block_delta" ? e.delta!.text : e.type);
      })()
    ).rejects.toThrow("connection reset");
    expect(seen).toEqual(["Part"]);
  });
});

let fx: IapFixture;
const req = (url: string, cookie: string, body: unknown) =>
  new NextRequest(`http://localhost${url}`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify(body) });

async function member(email: string) {
  const { POST } = await import("@/app/api/auth/signup/route");
  const res = await POST(
    new NextRequest("http://localhost/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "Tester-pass-123!", fullName: "Stream Tester", phone: "0830000000", dateOfBirth: "1990-01-01", gender: "Male", primaryGoal: "Build Muscle" }),
    })
  );
  expect(res.status).toBeLessThan(300);
  const user = fx.db.findUserByEmail(email)!;
  fx.setSubscription(user.id, { packageId: fx.ids.membershipPackage, provider: "none", status: "active" });
  // Digital access is separate from a gym Membership (owner decision D1): the AI routes need the digital flag.
  (await import("@/lib/digital-entitlement")).grantStaffDigitalEntitlement({ userId: user.id, grantedByUserId: null });
  const profile = fx.db.findProfileByUserId(user.id)!;
  fx.db.saveProfile({ ...profile, aiDataConsent: { grantedAt: "2026-10-01T00:00:00.000Z", version: 1 } });
  return fx.cookie(user.id);
}

beforeEach(async () => {
  fx = await createFixture();
  script.events = [];
  script.throwOnCreate = false;
});
afterEach(() => fx.cleanup());

describe.each([
  ["/api/ai/chat", () => import("@/app/api/ai/chat/route")],
  ["/api/ai/nutrition-coach", () => import("@/app/api/ai/nutrition-coach/route")],
] as const)("%s when the provider fails", (url, load) => {
  it("before any text: a 502 JSON error with a code, not a 200 and a dropped connection", async () => {
    const cookie = await member(`s1${url.length}@example.test`);
    script.events = [start, new Error("503 from provider")];
    const { POST } = await load();
    const res = await POST(req(url, cookie, { content: "How is my recovery?" }));
    expect(res.status).toBe(502);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toMatchObject({ success: false, code: "ai_unavailable" });
  });

  it("when the provider cannot even be called (synchronous failure): the same controlled 502", async () => {
    const cookie = await member(`s2${url.length}@example.test`);
    script.throwOnCreate = true;
    const { POST } = await load();
    const res = await POST(req(url, cookie, { content: "hello" }));
    expect(res.status).toBe(502);
    expect((await res.json()).code).toBe("ai_unavailable");
  });

  it("after some text: status 200, the text the member already saw is kept, and the reply ends with a note instead of an error", async () => {
    const cookie = await member(`s3${url.length}@example.test`);
    script.events = [start, text("Your recovery looks "), new Error("connection reset")];
    const { POST } = await load();
    const res = await POST(req(url, cookie, { content: "How is my recovery?" }));
    expect(res.status).toBe(200);
    const body = await res.text(); // reads to the end: it must END, not throw
    expect(body.startsWith("Your recovery looks ")).toBe(true);
    expect(body.length).toBeGreaterThan("Your recovery looks ".length); // the interruption note was appended
  });

  it("a normal reply still streams in full", async () => {
    const cookie = await member(`s4${url.length}@example.test`);
    script.events = [start, text("All "), text("good.")];
    const { POST } = await load();
    const res = await POST(req(url, cookie, { content: "hello" }));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("All good.");
  });
});
