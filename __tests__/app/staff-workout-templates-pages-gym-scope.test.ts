// Tenant scope for class workout templates on the two staff PAGES that list them:
//   * /staff/workouts                          (the template library)
//   * /staff/classes/[classId]/workout         (templates offered for a class)
// Each must hand its view only the acting staff member's own gym's templates
// (template -> createdByStaffId -> creator's gym). A legacy template with no
// creator, or an unresolvable one, is never shown. Real signed sessions and the
// real requireStaffPage() / can() / sameGym(); only the datastore, the redirect and
// the view components are mocked. Synthetic fixtures. Tenant A = primary gym
// (gymId: null convention); Tenant B / C = separate gyms.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MEMBER_SESSION_LIFETIME_MS, signSession } from "@/lib/session";

const { mockCookies, mockRedirect } = vi.hoisted(() => ({
  mockCookies: vi.fn(),
  mockRedirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));
vi.mock("next/headers", () => ({ cookies: mockCookies }));
vi.mock("next/navigation", () => ({ redirect: mockRedirect }));

const h = vi.hoisted(() => ({
  findUserById: vi.fn(),
  findClassCategories: vi.fn(),
  findClassWorkoutTemplates: vi.fn(),
  findExercises: vi.fn(),
  findClassById: vi.fn(),
  findBookingsByClassId: vi.fn(),
  findProfileByUserId: vi.fn(),
  findWorkoutSessionByUserAndClass: vi.fn(),
  findClassWorkoutByClassId: vi.fn(),
}));
vi.mock("@/lib/db", () => h);
vi.mock("@/app/(staff)/staff/workouts/WorkoutsView", () => ({ WorkoutsView: () => null }));
vi.mock("@/app/(staff)/staff/classes/[classId]/workout/ClassWorkoutView", () => ({ ClassWorkoutView: () => null }));

type U = { id: string; email: string; role: string; gymId: string | null; archivedAt: string | null };
const user = (id: string, role: string, gymId: string | null, archivedAt: string | null = null): U => ({ id, email: `${id}@x.test`, role, gymId, archivedAt });

const A_COACH = user("coach-a", "coach", null);
const A_ARCHIVED_CREATOR = user("coach-a-archived", "coach", null, "2026-09-01T00:00:00.000Z");
const B_COACH = user("coach-b", "coach", "gym-b");
const C_COACH = user("coach-c", "coach", "gym-c");
const A_MEMBER = user("member-a", "member", null);
// OPERATOR POLICY (documented, not a new exception): a platform operator has
// gymId: null, which the canonical sameGym() treats as the PRIMARY gym — so on
// these pages it sees exactly what primary-gym staff see. The operator role grants
// NO cross-gym reach: non-primary-gym templates (Tenant B, Tenant C) never appear.
const OPERATOR = user("operator", "platform_operator", null);
const ARCHIVED_ACTOR = user("coach-archived", "coach", null, "2026-09-01T00:00:00.000Z");
const WORLD = [A_COACH, A_ARCHIVED_CREATOR, B_COACH, C_COACH, A_MEMBER, OPERATOR, ARCHIVED_ACTOR];

const tpl = (id: string, name: string, createdByStaffId: string, categories: string[] = ["strength"]) => ({
  id,
  name,
  categories,
  exercises: [],
  notes: null,
  createdByStaffId,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});
const TEMPLATES = [
  tpl("tpl-a1", "Alpha A", A_COACH.id),
  tpl("tpl-a2", "Bravo A conditioning", A_COACH.id, ["conditioning"]),
  tpl("tpl-a3", "Charlie A (creator archived)", A_ARCHIVED_CREATOR.id),
  tpl("tpl-b1", "Delta B", B_COACH.id),
  tpl("tpl-c1", "Echo C", C_COACH.id),
  tpl("tpl-legacy", "Foxtrot legacy", ""),
  tpl("tpl-orphan", "Golf orphan", "staff-gone"),
];

const future = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
const cls = (id: string, coachUserId: string) => ({ id, title: `Class ${id}`, category: "strength", date: future, startTime: "18:00", durationMins: 60, capacity: 10, coachUserId, seriesId: null });
const CLASSES = [cls("class-a", A_COACH.id), cls("class-b", B_COACH.id)];

const asStaff = (u: { id: string }) =>
  mockCookies.mockResolvedValue({
    get: (name: string) => (name === "session" ? { value: signSession({ userId: u.id }, MEMBER_SESSION_LIFETIME_MS) } : undefined),
  });

type Props = { templates: { id: string }[] };
const workoutsPage = async () => {
  const { default: Page } = await import("@/app/(staff)/staff/workouts/page");
  return ((await (Page as () => Promise<{ props: Props }>)()).props.templates ?? []).map((t) => t.id);
};
const classPage = async (classId: string) => {
  const { default: Page } = await import("@/app/(staff)/staff/classes/[classId]/workout/page");
  const el = await (Page as (p: unknown) => Promise<{ props: Props }>)({ params: Promise.resolve({ classId }) });
  return (el.props.templates ?? []).map((t) => t.id);
};

beforeEach(() => {
  vi.clearAllMocks();
  h.findUserById.mockImplementation((id: string) => WORLD.find((u) => u.id === id));
  h.findClassCategories.mockReturnValue([{ slug: "strength" }, { slug: "conditioning" }]);
  h.findClassWorkoutTemplates.mockReturnValue(TEMPLATES);
  h.findExercises.mockReturnValue([]);
  h.findClassById.mockImplementation((id: string) => CLASSES.find((c) => c.id === id));
  h.findBookingsByClassId.mockReturnValue([]);
  h.findProfileByUserId.mockReturnValue(undefined);
  h.findWorkoutSessionByUserAndClass.mockReturnValue(undefined);
  h.findClassWorkoutByClassId.mockReturnValue(undefined);
  asStaff(A_COACH);
});

describe("/staff/workouts — template library", () => {
  it("shows Tenant A only its own templates (including one whose creator was archived)", async () => {
    expect(await workoutsPage()).toEqual(["tpl-a1", "tpl-a2", "tpl-a3"]);
  });

  it("shows Tenant B and Tenant C only their own", async () => {
    asStaff(B_COACH);
    expect(await workoutsPage()).toEqual(["tpl-b1"]);
    asStaff(C_COACH);
    expect(await workoutsPage()).toEqual(["tpl-c1"]);
  });

  it("never shows a legacy template with no creator or one whose creator is gone", async () => {
    for (const actor of [A_COACH, B_COACH, C_COACH, OPERATOR]) {
      asStaff(actor);
      const ids = await workoutsPage();
      expect(ids).not.toContain("tpl-legacy");
      expect(ids).not.toContain("tpl-orphan");
    }
  });

  it("a platform operator (gymId: null) sees ONLY primary-gym templates: no new cross-gym exception, non-primary-gym templates stay inaccessible", async () => {
    asStaff(OPERATOR);

    const ids = await workoutsPage();

    expect(ids).toEqual(["tpl-a1", "tpl-a2", "tpl-a3"]); // primary gym (Tenant A) only
    expect(ids).not.toContain("tpl-b1"); // Tenant B (non-primary)
    expect(ids).not.toContain("tpl-c1"); // Tenant C (non-primary)
  });

  it("an ARCHIVED actor is redirected before any template is loaded", async () => {
    asStaff(ARCHIVED_ACTOR);

    await expect(workoutsPage()).rejects.toThrow("REDIRECT:/dashboard");
    expect(h.findClassWorkoutTemplates).not.toHaveBeenCalled();
  });

  it("a deleted actor's session and a non-staff member are redirected before any template is loaded", async () => {
    asStaff({ id: "no-such-actor" });
    await expect(workoutsPage()).rejects.toThrow("REDIRECT:/dashboard");
    asStaff(A_MEMBER);
    await expect(workoutsPage()).rejects.toThrow("REDIRECT:/dashboard");
    expect(h.findClassWorkoutTemplates).not.toHaveBeenCalled();
  });

  it("a restored actor sees the library again", async () => {
    asStaff(ARCHIVED_ACTOR);
    await expect(workoutsPage()).rejects.toThrow("REDIRECT:/dashboard");

    ARCHIVED_ACTOR.archivedAt = null;
    try {
      expect(await workoutsPage()).toEqual(["tpl-a1", "tpl-a2", "tpl-a3"]);
    } finally {
      ARCHIVED_ACTOR.archivedAt = "2026-09-01T00:00:00.000Z";
    }
  });
});

describe("/staff/classes/[classId]/workout — templates offered for the class", () => {
  it("offers only this gym's templates for the class's category", async () => {
    expect(await classPage("class-a")).toEqual(["tpl-a1", "tpl-a3"]); // 'strength' only; tpl-a2 is conditioning
  });

  it("never offers another gym's template, even when its category matches the class", async () => {
    const ids = await classPage("class-a");

    expect(ids).not.toContain("tpl-b1"); // Tenant B, category 'strength'
    expect(ids).not.toContain("tpl-c1"); // Tenant C, category 'strength'
  });

  it("never offers a legacy or unresolvable-creator template", async () => {
    const ids = await classPage("class-a");

    expect(ids).not.toContain("tpl-legacy");
    expect(ids).not.toContain("tpl-orphan");
  });

  it("Tenant B's class offers Tenant B's templates only", async () => {
    asStaff(B_COACH);

    expect(await classPage("class-b")).toEqual(["tpl-b1"]);
  });

  it("a cross-gym class still reads as 'Class not found' and no template is loaded (existing behaviour)", async () => {
    const { default: Page } = await import("@/app/(staff)/staff/classes/[classId]/workout/page");
    const el = await (Page as (p: unknown) => Promise<unknown>)({ params: Promise.resolve({ classId: "class-b" }) });

    expect(JSON.stringify(el, (k, x) => (k === "type" && typeof x !== "string" ? undefined : x))).toContain("Class not found");
    expect(h.findClassWorkoutTemplates).not.toHaveBeenCalled();
  });

  it("an ARCHIVED actor is redirected before any template is loaded", async () => {
    asStaff(ARCHIVED_ACTOR);

    await expect(classPage("class-a")).rejects.toThrow("REDIRECT:/dashboard");
    expect(h.findClassWorkoutTemplates).not.toHaveBeenCalled();
  });
});
