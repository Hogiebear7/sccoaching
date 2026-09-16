import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockCreateGym,
  mockCreateUserWithRole,
  mockFindGymBySlug,
  mockFindUserByEmail,
  mockSetUserGymId,
} = vi.hoisted(() => ({
  mockCreateGym: vi.fn(),
  mockCreateUserWithRole: vi.fn(),
  mockFindGymBySlug: vi.fn(),
  mockFindUserByEmail: vi.fn(),
  mockSetUserGymId: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  createGym: mockCreateGym,
  createUserWithRole: mockCreateUserWithRole,
  findGymBySlug: mockFindGymBySlug,
  findUserByEmail: mockFindUserByEmail,
  setUserGymId: mockSetUserGymId,
}));

async function callGymsSignup(body: unknown) {
  const { POST } = await import("@/app/api/gyms/signup/route");
  const request = new NextRequest("http://localhost/api/gyms/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return POST(request);
}

const VALID_BODY = {
  gymName: "Iron Peak Fitness",
  addressLine: "123 Main St, Cork",
  ownerEmail: "owner@ironpeak.test",
  password: "TestPass123!",
};

describe("POST /api/gyms/signup", () => {
  beforeEach(() => {
    mockCreateGym.mockReset();
    mockCreateUserWithRole.mockReset();
    mockFindGymBySlug.mockReset();
    mockFindUserByEmail.mockReset();
    mockSetUserGymId.mockReset();
    mockFindGymBySlug.mockReturnValue(undefined);
    mockFindUserByEmail.mockReturnValue(undefined);
    mockCreateUserWithRole.mockReturnValue({ id: "owner-1", email: VALID_BODY.ownerEmail, role: "admin_manager" });
  });

  it("creates a pending gym and an admin_manager owner scoped to it", async () => {
    const res = await callGymsSignup(VALID_BODY);
    const data = await res.json();

    expect(res.status).toBe(201);
    expect(data.success).toBe(true);

    // Owner is created with no gymId yet (chicken-and-egg — see the route's
    // own comment), then stamped with the new gym's id afterward.
    expect(mockCreateUserWithRole).toHaveBeenCalledWith(VALID_BODY.ownerEmail, expect.any(String), "admin_manager", null);
    expect(mockCreateGym).toHaveBeenCalledTimes(1);
    const createdGym = mockCreateGym.mock.calls[0][0];
    expect(createdGym.status).toBe("pending");
    expect(createdGym.ownerUserId).toBe("owner-1");
    expect(createdGym.latitude).toBeNull();
    expect(mockSetUserGymId).toHaveBeenCalledWith("owner-1", createdGym.id);
  });

  it("rejects a duplicate owner email", async () => {
    mockFindUserByEmail.mockReturnValue({ id: "existing" });
    const res = await callGymsSignup(VALID_BODY);

    expect(res.status).toBe(400);
    expect(mockCreateGym).not.toHaveBeenCalled();
  });

  it("rejects a weak password", async () => {
    const res = await callGymsSignup({ ...VALID_BODY, password: "weak" });

    expect(res.status).toBe(400);
    expect(mockCreateGym).not.toHaveBeenCalled();
  });

  it("rejects a missing gym name", async () => {
    const res = await callGymsSignup({ ...VALID_BODY, gymName: "" });

    expect(res.status).toBe(400);
    expect(mockCreateGym).not.toHaveBeenCalled();
  });

  it("de-duplicates the slug when the gym name collides with an existing one", async () => {
    mockFindGymBySlug.mockImplementation((slug: string) => (slug === "iron-peak-fitness" ? { id: "other" } : undefined));

    await callGymsSignup(VALID_BODY);

    const createdGym = mockCreateGym.mock.calls[0][0];
    expect(createdGym.slug).toBe("iron-peak-fitness-2");
  });
});
