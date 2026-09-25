// lib/workout-template-scope.ts — tenant scope for class workout templates.
// A template's gym is derived: template -> createdByStaffId -> that creator's
// account -> its gym, compared with the acting staff member's gym by the
// canonical sameGym() logic. Fail closed for a template with no creator or a
// creator that no longer resolves. Synthetic fixtures only.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { findClassWorkoutTemplatesForStaff, templateInStaffGym } from "@/lib/workout-template-scope";

const h = vi.hoisted(() => ({ findUserById: vi.fn(), findClassWorkoutTemplates: vi.fn() }));
vi.mock("@/lib/db", () => h);

type U = { id: string; role: string; gymId: string | null; archivedAt: string | null };
const user = (id: string, gymId: string | null, archivedAt: string | null = null): U => ({ id, role: "coach", gymId, archivedAt });

// Tenant A = primary gym (gymId: null convention); B and C are separate gyms.
const A_STAFF = user("staff-a", null);
const A_OTHER = user("staff-a2", null);
const A_ARCHIVED = user("staff-a-archived", null, "2026-09-01T00:00:00.000Z");
const B_STAFF = user("staff-b", "gym-b");
const C_STAFF = user("staff-c", "gym-c");
const USERS = [A_STAFF, A_OTHER, A_ARCHIVED, B_STAFF, C_STAFF];

const tpl = (id: string, name: string, createdByStaffId: string) => ({ id, name, createdByStaffId });

beforeEach(() => {
  vi.clearAllMocks();
  h.findUserById.mockImplementation((id: string) => USERS.find((u) => u.id === id));
});

describe("templateInStaffGym", () => {
  it("is true when the creator is in the acting staff member's gym", () => {
    expect(templateInStaffGym(A_STAFF, tpl("t", "T", A_OTHER.id))).toBe(true);
    expect(templateInStaffGym(B_STAFF, tpl("t", "T", B_STAFF.id))).toBe(true);
  });

  it("is false when the creator is in another gym, in every direction (including two non-primary gyms)", () => {
    expect(templateInStaffGym(A_STAFF, tpl("t", "T", B_STAFF.id))).toBe(false);
    expect(templateInStaffGym(B_STAFF, tpl("t", "T", A_STAFF.id))).toBe(false);
    expect(templateInStaffGym(B_STAFF, tpl("t", "T", C_STAFF.id))).toBe(false);
  });

  it("still belongs to the gym when the creator was merely archived", () => {
    expect(templateInStaffGym(A_STAFF, tpl("t", "T", A_ARCHIVED.id))).toBe(true);
    expect(templateInStaffGym(B_STAFF, tpl("t", "T", A_ARCHIVED.id))).toBe(false);
  });

  it.each([
    ["an empty creator id", ""],
    ["a creator id that resolves to no account", "staff-gone"],
  ])("fails closed for %s", (_label, creator) => {
    expect(templateInStaffGym(A_STAFF, tpl("t", "T", creator))).toBe(false);
    expect(templateInStaffGym(B_STAFF, tpl("t", "T", creator))).toBe(false);
  });

  it("fails closed for a missing (undefined / null) creator field on a legacy record", () => {
    const legacy = { id: "t", name: "T" } as unknown as { createdByStaffId: string };
    const nullCreator = { id: "t", name: "T", createdByStaffId: null } as unknown as { createdByStaffId: string };

    expect(templateInStaffGym(A_STAFF, legacy)).toBe(false);
    expect(templateInStaffGym(A_STAFF, nullCreator)).toBe(false);
    expect(h.findUserById).not.toHaveBeenCalled(); // no lookup is even attempted
  });

  it("treats a staff member with no gymId as the primary gym (canonical null convention)", () => {
    expect(templateInStaffGym({}, tpl("t", "T", A_STAFF.id))).toBe(true);
    expect(templateInStaffGym({}, tpl("t", "T", B_STAFF.id))).toBe(false);
  });
});

describe("findClassWorkoutTemplatesForStaff", () => {
  const ALL = [
    tpl("t-a1", "Alpha", A_STAFF.id),
    tpl("t-b1", "Bravo", B_STAFF.id),
    tpl("t-a2", "Charlie", A_OTHER.id),
    tpl("t-legacy", "Delta", ""),
    tpl("t-orphan", "Echo", "staff-gone"),
    tpl("t-c1", "Foxtrot", C_STAFF.id),
    tpl("t-a3", "Golf", A_ARCHIVED.id),
  ];
  beforeEach(() => h.findClassWorkoutTemplates.mockReturnValue(ALL));

  it("returns only the acting gym's templates, in the existing order", () => {
    expect(findClassWorkoutTemplatesForStaff(A_STAFF).map((t) => t.id)).toEqual(["t-a1", "t-a2", "t-a3"]);
    expect(findClassWorkoutTemplatesForStaff(B_STAFF).map((t) => t.id)).toEqual(["t-b1"]);
    expect(findClassWorkoutTemplatesForStaff(C_STAFF).map((t) => t.id)).toEqual(["t-c1"]);
  });

  it("never returns a legacy template with no creator or one whose creator no longer resolves", () => {
    for (const staff of [A_STAFF, B_STAFF, C_STAFF]) {
      const ids = findClassWorkoutTemplatesForStaff(staff).map((t) => t.id);
      expect(ids).not.toContain("t-legacy");
      expect(ids).not.toContain("t-orphan");
    }
  });

  it("returns nothing for a gym that owns no templates", () => {
    expect(findClassWorkoutTemplatesForStaff({ gymId: "gym-empty" })).toEqual([]);
  });

  it("looks each distinct creator up only once per call, and skips empty creators entirely", () => {
    findClassWorkoutTemplatesForStaff(A_STAFF);

    const looked = h.findUserById.mock.calls.map((c) => c[0]);
    expect(looked.sort()).toEqual([A_STAFF.id, A_OTHER.id, A_ARCHIVED.id, B_STAFF.id, C_STAFF.id, "staff-gone"].sort());
    expect(new Set(looked).size).toBe(looked.length);
  });

  it("does not depend on any identifier other than the staff account: nothing to inject", () => {
    // The function accepts only the staff account object; a gym/tenant hint has nowhere to go.
    expect(findClassWorkoutTemplatesForStaff.length).toBe(1);
  });
});
