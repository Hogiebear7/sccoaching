import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockFindGyms } = vi.hoisted(() => ({ mockFindGyms: vi.fn() }));

vi.mock("@/lib/db", () => ({ findGyms: mockFindGyms }));

const { mockVerifyRequestSession } = vi.hoisted(() => ({ mockVerifyRequestSession: vi.fn() }));
vi.mock("@/lib/mobile-auth", () => ({ verifyRequestSession: mockVerifyRequestSession }));

// Navan, Co. Meath — matches scripts/seed-primary-gym.mjs's hand-entered coordinates.
const SC_GYM = {
  id: "sc-1",
  slug: "sc-performance-coaching",
  name: "S&C Performance Coaching",
  tagline: null,
  contactEmail: "info@sandccoaching.com",
  contactPhone: null,
  addressLine: "Navan, Co. Meath",
  latitude: 53.6528,
  longitude: -6.6819,
  status: "active" as const,
};

async function callNearby(lat: number, lng: number, radiusKm?: number) {
  const { GET } = await import("@/app/api/mobile/gyms/nearby/route");
  const radiusPart = radiusKm !== undefined ? `&radiusKm=${radiusKm}` : "";
  const request = new NextRequest(`http://localhost/api/mobile/gyms/nearby?lat=${lat}&lng=${lng}${radiusPart}`);
  return GET(request);
}

describe("GET /api/mobile/gyms/nearby", () => {
  beforeEach(() => {
    mockFindGyms.mockReset();
    mockVerifyRequestSession.mockReset();
    mockVerifyRequestSession.mockReturnValue({ userId: "member-1" });
    mockFindGyms.mockReturnValue([SC_GYM]);
  });

  it("requires auth", async () => {
    mockVerifyRequestSession.mockReturnValue(null);
    const res = await callNearby(53.35, -6.26);
    expect(res.status).toBe(401);
  });

  it("requires lat/lng", async () => {
    const { GET } = await import("@/app/api/mobile/gyms/nearby/route");
    const res = await GET(new NextRequest("http://localhost/api/mobile/gyms/nearby"));
    expect(res.status).toBe(400);
  });

  it("defaults to a 25km radius when radiusKm is omitted", async () => {
    // Dublin — ~40km from Navan, so a 25km default should exclude it.
    const res = await callNearby(53.3498, -6.2603);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.data).toHaveLength(0);
  });

  it("rejects a radiusKm value outside the allowed set", async () => {
    const res = await callNearby(53.3498, -6.2603, 30);
    expect(res.status).toBe(400);
  });

  it("recommends S&C when within both the requested radius and the recommended radius", async () => {
    // Dublin — ~40km from Navan; a 50km request includes it and the fixed
    // 50km "recommended" threshold still applies independently.
    const res = await callNearby(53.3498, -6.2603, 50);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.data).toHaveLength(1);
    expect(data.data[0].recommended).toBe(true);
    expect(data.data[0].distanceKm).toBeLessThan(50);
  });

  it("excludes a provider outside the selected radius, even at the largest allowed radius", async () => {
    // New York — thousands of km from Navan; not returned at any allowed
    // radius, and never surfaced as a fallback.
    const res = await callNearby(40.7128, -74.006, 100);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.data).toHaveLength(0);
  });

  it("excludes a gym with no coordinates yet", async () => {
    mockFindGyms.mockReturnValue([SC_GYM, { ...SC_GYM, id: "pending-1", latitude: null, longitude: null }]);
    const res = await callNearby(53.3498, -6.2603, 50);
    const data = await res.json();

    expect(data.data).toHaveLength(1);
    expect(data.data[0].id).toBe("sc-1");
  });

  it("excludes a suspended/pending gym", async () => {
    mockFindGyms.mockReturnValue([SC_GYM, { ...SC_GYM, id: "pending-1", status: "pending" }]);
    const res = await callNearby(53.3498, -6.2603, 50);
    const data = await res.json();

    expect(data.data).toHaveLength(1);
    expect(data.data[0].id).toBe("sc-1");
  });

  it("excludes a gym that has voluntarily hidden from discovery", async () => {
    mockFindGyms.mockReturnValue([{ ...SC_GYM, acceptingNewEnquiries: false }]);
    const res = await callNearby(53.3498, -6.2603, 50);
    const data = await res.json();

    expect(data.data).toHaveLength(0);
  });

  it("includes a gym when acceptingNewEnquiries is true or absent", async () => {
    mockFindGyms.mockReturnValue([
      { ...SC_GYM, id: "sc-1", acceptingNewEnquiries: true },
      { ...SC_GYM, id: "sc-2", acceptingNewEnquiries: undefined },
    ]);
    const res = await callNearby(53.3498, -6.2603, 50);
    const data = await res.json();

    expect(data.data.map((g: { id: string }) => g.id).sort()).toEqual(["sc-1", "sc-2"]);
  });
});
