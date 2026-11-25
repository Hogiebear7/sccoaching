// Uploading a gym logo: only the gym's own admin, only real PNG/JPEG/WebP files up to 1 MB (judged by the file's own bytes, never SVG), served publicly from this site,
// replaced and removed cleanly. Real routes, real temporary datastore, fake accounts.
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createFixture, GYM_B, type IapFixture } from "../helpers/iap-fixture";

const T = "2026-01-01T00:00:00.000Z";
let fx: IapFixture;

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

beforeEach(async () => {
  fx = await createFixture();
  fx.db.createGym({
    id: GYM_B, slug: "gym-b", name: "Gym B", tagline: null, description: null, ownerUserId: fx.adminB.id, contactEmail: "b@example.test", contactPhone: null,
    addressLine: "", latitude: null, longitude: null, status: "active", createdAt: T, updatedAt: T,
  });
});
afterEach(() => fx.cleanup());

async function upload(userId: string, bytes: Uint8Array | null, name = "logo.png") {
  const { POST } = await import("@/app/api/staff/gym/branding/route");
  const form = new FormData();
  if (bytes) form.append("file", new File([new Uint8Array(bytes)], name));
  return POST(new NextRequest("http://localhost/api/staff/gym/branding", { method: "POST", headers: { Cookie: fx.cookie(userId) }, body: form }));
}

async function serve(gymId: string) {
  const { GET } = await import("@/app/api/gym-logo/[gymId]/route");
  return GET(new NextRequest(`http://localhost/api/gym-logo/${gymId}`), { params: Promise.resolve({ gymId }) });
}

describe("gym logo upload", () => {
  it("stores a PNG for the admin's own gym and serves it publicly with the right type", async () => {
    const res = await upload(fx.adminB.id, PNG);
    expect(res.status).toBe(200);
    const stored = fx.db.findGymById(GYM_B)?.branding?.logoUrl ?? "";
    expect(stored).toContain(`/api/gym-logo/${GYM_B}?v=`);

    const served = await serve(GYM_B);
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("image/png");
    expect(served.headers.get("x-content-type-options")).toBe("nosniff");
    expect(Array.from(new Uint8Array(await served.arrayBuffer())).slice(0, 4)).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it("replaces an earlier logo, even with a different file type", async () => {
    await upload(fx.adminB.id, PNG);
    expect((await upload(fx.adminB.id, JPG, "logo.jpg")).status).toBe(200);
    expect((await serve(GYM_B)).headers.get("content-type")).toBe("image/jpeg");
  });

  it("refuses SVG, a renamed non-image, an empty request and an oversized file", async () => {
    expect((await upload(fx.adminB.id, SVG, "logo.png")).status).toBe(400);
    expect((await upload(fx.adminB.id, new TextEncoder().encode("hello"), "logo.png")).status).toBe(400);
    expect((await upload(fx.adminB.id, null)).status).toBe(400);
    const big = new Uint8Array(1_000_001);
    big.set(PNG);
    expect((await upload(fx.adminB.id, big)).status).toBe(400);
    expect(fx.db.findGymById(GYM_B)?.branding?.logoUrl ?? null).toBeNull();
  });

  it("is not available to a member, and the primary gym's brand stays fixed", async () => {
    expect((await upload(fx.memberB.id, PNG)).status).toBeGreaterThanOrEqual(400);
    expect((await upload(fx.adminA.id, PNG)).status).toBe(403);
  });

  it("keeps the uploaded logo when the colour is saved later with the same link", async () => {
    await upload(fx.adminB.id, PNG);
    const logoUrl = fx.db.findGymById(GYM_B)?.branding?.logoUrl;
    const { PUT } = await import("@/app/api/staff/gym/branding/route");
    const res = await PUT(new NextRequest("http://localhost/api/staff/gym/branding", { method: "PUT", headers: { "Content-Type": "application/json", Cookie: fx.cookie(fx.adminB.id) }, body: JSON.stringify({ accentColor: "#E5B84B", logoUrl }) }));
    expect(res.status).toBe(200);
    expect(fx.db.findGymById(GYM_B)?.branding?.logoUrl).toBe(logoUrl);
  });

  it("removing the logo deletes the file and the public link stops working", async () => {
    await upload(fx.adminB.id, PNG);
    const { DELETE } = await import("@/app/api/staff/gym/branding/route");
    const res = await DELETE(new NextRequest("http://localhost/api/staff/gym/branding", { method: "DELETE", headers: { Cookie: fx.cookie(fx.adminB.id) } }));
    expect(res.status).toBe(200);
    expect(fx.db.findGymById(GYM_B)?.branding?.logoUrl).toBeNull();
    expect((await serve(GYM_B)).status).toBe(404);
  });

  it("never serves a logo for a gym that has none, or an unsafe id", async () => {
    expect((await serve(GYM_B)).status).toBe(404);
    expect((await serve("..%2F..%2Fdb")).status).toBe(404);
  });
});
