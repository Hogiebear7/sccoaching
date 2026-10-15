// POST /api/recovery/log validates sleep quality and soreness on a 1-10 scale (fatigue stays 1-5). The error text must say so: it used to say 1 and 5
// for all three, so a member who typed 11 was told the wrong range. Real route, real temporary datastore, fake account.
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createFixture, type IapFixture } from "../helpers/iap-fixture";

let fx: IapFixture;
beforeEach(async () => { fx = await createFixture(); });
afterEach(() => fx.cleanup());

async function log(over: Record<string, string>) {
  const { POST } = await import("@/app/api/recovery/log/route");
  const body = { date: "2026-10-15", sleepHours: "7", sleepQuality: "6", soreness: "4", fatigue: "3", ...over };
  return POST(new NextRequest("http://localhost/api/recovery/log", { method: "POST", headers: { "Content-Type": "application/json", Cookie: fx.cookie(fx.memberA.id) }, body: JSON.stringify(body) }));
}

describe("recovery log ranges and their error messages", () => {
  it("accepts 1-10 for sleep quality and soreness and 1-5 for fatigue", async () => {
    expect((await log({ sleepQuality: "10", soreness: "10", fatigue: "5" })).status).toBeLessThan(300);
  });

  it("refuses out-of-range values with a message that names the real range", async () => {
    const q = await log({ sleepQuality: "11" });
    expect(q.status).toBe(400);
    expect((await q.json()).message).toBe("Sleep quality must be between 1 and 10.");
    const s = await log({ soreness: "0" });
    expect(s.status).toBe(400);
    expect((await s.json()).message).toBe("Soreness must be between 1 and 10.");
    const f = await log({ fatigue: "6" });
    expect(f.status).toBe(400);
    expect((await f.json()).message).toBe("Fatigue must be between 1 and 5.");
  });
});
