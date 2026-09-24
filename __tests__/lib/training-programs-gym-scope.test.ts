// getStaffTrainingPrograms(userId, staff) (lib/training-programs.ts, served by
// GET /api/mobile/staff/programs): programs are scoped to the acting staff
// member's own gym BEFORE any member email/profile is read — previously every
// gym's programs were loaded, hydrated with their members' email and full name,
// and only then filtered by the route. Ownership: program -> userId -> member's
// gym (gymId null = primary gym, lib/gym-scope.ts). sameGym is not mocked.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  findAllTrainingPrograms: vi.fn(),
  findTrainingProgramsByUserId: vi.fn(),
  findUserById: vi.fn(),
  findProfileByUserId: vi.fn(),
}));
vi.mock("@/lib/db", () => h);

const member = (id: string, gymId: string | null) => ({ id, email: `${id}@x.test`, role: "member", gymId });
const A = member("member-a", null);
const B = member("member-b", "gym-b");
const program = (id: string, userId: string) => ({ id, userId, name: `Program ${id}` });
const PROGRAMS = [program("p-a", A.id), program("p-b", B.id), program("p-ghost", "member-gone")];

beforeEach(() => {
  vi.clearAllMocks();
  h.findUserById.mockImplementation((id: string) => [A, B].find((u) => u.id === id));
  h.findProfileByUserId.mockImplementation((id: string) => ({ fullName: `Name of ${id}` }));
  h.findAllTrainingPrograms.mockImplementation(() => PROGRAMS);
  h.findTrainingProgramsByUserId.mockImplementation((id: string) => PROGRAMS.filter((p) => p.userId === id));
});

describe("getStaffTrainingPrograms — gym-scoped before hydrating members", () => {
  it("returns only the acting gym's programs (with member email/name) and reads no other gym's profile", async () => {
    const { getStaffTrainingPrograms } = await import("@/lib/training-programs");

    const rows = getStaffTrainingPrograms(undefined, { gymId: null });

    expect(rows.map((r) => r.id)).toEqual(["p-a"]);
    expect(rows[0]).toMatchObject({ memberEmail: A.email, memberFullName: "Name of member-a" });
    expect(h.findProfileByUserId.mock.calls.map((c) => c[0])).toEqual(["member-a"]);
    expect(JSON.stringify(rows)).not.toMatch(/member-b|member-gone/);
  });

  it("gym B staff see only gym B; a program whose member can't be resolved is dropped (fail closed)", async () => {
    const { getStaffTrainingPrograms } = await import("@/lib/training-programs");

    expect(getStaffTrainingPrograms(undefined, { gymId: "gym-b" }).map((r) => r.id)).toEqual(["p-b"]);
    expect(getStaffTrainingPrograms(undefined, { gymId: "gym-empty" })).toEqual([]);
  });

  it("with a userId filter: same-gym member's programs are returned, another gym's member yields nothing", async () => {
    const { getStaffTrainingPrograms } = await import("@/lib/training-programs");

    expect(getStaffTrainingPrograms(A.id, { gymId: null }).map((r) => r.id)).toEqual(["p-a"]);
    expect(getStaffTrainingPrograms(B.id, { gymId: null })).toEqual([]);
    expect(h.findProfileByUserId.mock.calls.map((c) => c[0])).not.toContain("member-b");
  });
});
