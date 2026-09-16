import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockVerifyRequestSession } = vi.hoisted(() => ({ mockVerifyRequestSession: vi.fn() }));
vi.mock("@/lib/mobile-auth", () => ({ verifyRequestSession: mockVerifyRequestSession }));

async function callGeocode(q?: string) {
  const { GET } = await import("@/app/api/mobile/gyms/geocode/route");
  const url = q ? `http://localhost/api/mobile/gyms/geocode?q=${encodeURIComponent(q)}` : "http://localhost/api/mobile/gyms/geocode";
  return GET(new NextRequest(url));
}

describe("GET /api/mobile/gyms/geocode", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    mockVerifyRequestSession.mockReset();
    mockVerifyRequestSession.mockReturnValue({ userId: "member-1" });
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("requires auth", async () => {
    mockVerifyRequestSession.mockReturnValue(null);
    const res = await callGeocode("Dublin");
    expect(res.status).toBe(401);
  });

  it("requires a query", async () => {
    const res = await callGeocode();
    expect(res.status).toBe(400);
  });

  it("returns coordinates for a matched place", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ lat: "53.3498", lon: "-6.2603", display_name: "Dublin, Ireland" }],
    }) as unknown as typeof fetch;

    const res = await callGeocode("Dublin");
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.data).toEqual({ lat: 53.3498, lng: -6.2603, label: "Dublin, Ireland" });
  });

  it("returns 404 when nothing matches", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => [] }) as unknown as typeof fetch;

    const res = await callGeocode("asdkfjasldkfj");
    expect(res.status).toBe(404);
  });

  it("returns 502 when the provider is unreachable", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("network down")) as unknown as typeof fetch;

    const res = await callGeocode("Dublin");
    expect(res.status).toBe(502);
  });
});
