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

  it("requests multiple candidates from the provider (limit=5)", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ lat: "53.3498", lon: "-6.2603", display_name: "Dublin, Ireland" }],
    }) as unknown as typeof fetch;

    await callGeocode("Dublin");

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("limit=5"),
      expect.anything()
    );
  });

  it("returns a candidate list instead of guessing when multiple real places match", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        { lat: "45.4211060", lon: "-75.4259490", display_name: "Navan, Ottawa, Eastern Ontario, Ontario, K4B 1N2, Canada" },
        { lat: "53.6530941", lon: "-6.6840434", display_name: "Navan, The Municipal District of Navan, County Meath, Leinster, Éire / Ireland" },
      ],
    }) as unknown as typeof fetch;

    const res = await callGeocode("Navan");
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.data.candidates).toHaveLength(2);
    expect(data.data.candidates[1]).toEqual({
      lat: 53.6530941,
      lng: -6.6840434,
      label: "Navan, The Municipal District of Navan, County Meath, Leinster, Éire / Ireland",
    });
    // Never picks one silently — no bare {lat, lng, label} at the top level
    // when the result is genuinely ambiguous.
    expect(data.data.lat).toBeUndefined();
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
