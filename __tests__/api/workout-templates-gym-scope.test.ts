// Tenant scope for class workout templates on the three API surfaces:
//   * POST /api/staff/workout-templates          (create + update by id)
//   * POST /api/staff/workout-templates/delete
//   * GET  /api/mobile/staff/workout-templates    (list)
// Policy: staff may list / create / update / delete ONLY their own gym's templates.
// A template's gym is derived from createdByStaffId -> the creator's account -> its
// gym. A client-supplied gymId/tenantId is never authorization. A template with no
// creator, or an unresolvable one, fails closed. A cross-gym template reads exactly
// like a missing one ("Template not found."), and a denied request saves/deletes
// nothing.
//
// Real signed sessions; the real can(), sameGym() and verifyRequestSession are NOT
// mocked — only the datastore. Synthetic fixtures. Tenant A = primary gym (gymId:
// null convention); Tenant B / Tenant C are separate non-primary gyms.
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MEMBER_SESSION_LIFETIME_MS, signSession } from "@/lib/session";

type Tpl = {
  id: string;
  name: string;
  categories: string[];
  exercises: { name: string }[];
  notes: string | null;
  createdByStaffId: string;
  createdAt: string;
  updatedAt: string;
};

const store = vi.hoisted(() => ({ templates: [] as Tpl[] }));
const h = vi.hoisted(() => ({
  findUserById: vi.fn(),
  findClassCategories: vi.fn(),
  findClassWorkoutTemplates: vi.fn(),
  findClassWorkoutTemplateById: vi.fn(),
  saveClassWorkoutTemplate: vi.fn(),
  deleteClassWorkoutTemplate: vi.fn(),
  findExercises: vi.fn(),
}));
vi.mock("@/lib/db", () => h);

type U = { id: string; email: string; role: string; gymId: string | null; archivedAt: string | null };
const user = (id: string, role: string, gymId: string | null, archivedAt: string | null = null): U => ({ id, email: `${id}@x.test`, role, gymId, archivedAt });

const A_COACH = user("coach-a", "coach", null);
const A_ADMIN = user("admin-a", "admin", null);
const A_ARCHIVED_CREATOR = user("coach-a-archived", "coach", null, "2026-09-01T00:00:00.000Z");
const A_MEMBER = user("member-a", "member", null);
const B_COACH = user("coach-b", "coach", "gym-b");
const C_COACH = user("coach-c", "coach", "gym-c");
// OPERATOR POLICY (documented, not a new exception): a platform operator has
// gymId: null, which the canonical sameGym() treats as the PRIMARY gym — so for
// workout templates it behaves exactly like primary-gym staff. The operator role
// grants NO cross-gym reach on tenant data: it sees and edits only primary-gym
// templates, and every non-primary-gym template (Tenant B, Tenant C) stays
// inaccessible to it.
const OPERATOR = user("operator", "platform_operator", null);
const ARCHIVED_ACTOR = user("coach-archived", "coach", null, "2026-09-01T00:00:00.000Z");
const WORLD = [A_COACH, A_ADMIN, A_ARCHIVED_CREATOR, A_MEMBER, B_COACH, C_COACH, OPERATOR, ARCHIVED_ACTOR];

const tpl = (id: string, name: string, createdByStaffId: string): Tpl => ({
  id,
  name,
  categories: ["strength"],
  exercises: [{ name: "Squat" }],
  notes: null,
  createdByStaffId,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});
const seed = () => [
  tpl("tpl-a1", "Alpha A", A_COACH.id),
  tpl("tpl-a2", "Bravo A", A_ADMIN.id),
  tpl("tpl-a3", "Charlie A (creator archived)", A_ARCHIVED_CREATOR.id),
  tpl("tpl-b1", "Delta B", B_COACH.id),
  tpl("tpl-c1", "Echo C", C_COACH.id),
  tpl("tpl-legacy", "Foxtrot legacy (no creator)", ""),
  tpl("tpl-orphan", "Golf orphan (creator gone)", "staff-gone"),
];
const snapshot = () => JSON.stringify(store.templates);

const cookie = (id: string) => `session=${signSession({ userId: id }, MEMBER_SESSION_LIFETIME_MS)}`;
const headers = (as?: string) => ({ "Content-Type": "application/json", ...(as ? { Cookie: cookie(as) } : {}) });

async function save(body: unknown, as?: string) {
  const { POST } = await import("@/app/api/staff/workout-templates/route");
  return POST(new NextRequest("http://localhost/api/staff/workout-templates", { method: "POST", headers: headers(as), body: JSON.stringify(body) }));
}
async function del(body: unknown, as?: string) {
  const { POST } = await import("@/app/api/staff/workout-templates/delete/route");
  return POST(new NextRequest("http://localhost/api/staff/workout-templates/delete", { method: "POST", headers: headers(as), body: JSON.stringify(body) }));
}
async function list(as?: string, query = "") {
  const { GET } = await import("@/app/api/mobile/staff/workout-templates/route");
  return GET(new NextRequest(`http://localhost/api/mobile/staff/workout-templates${query}`, { method: "GET", headers: headers(as) }));
}
const valid = (extra: Record<string, unknown> = {}) => ({ name: "New template", categories: ["strength"], exercises: [{ name: "Deadlift" }], ...extra });
const listedIds = async (res: Response) => ((await res.json()).data.templates as Tpl[]).map((t) => t.id);
const NOT_FOUND = { success: false, message: "Template not found." };

beforeEach(() => {
  vi.clearAllMocks();
  store.templates = seed();
  h.findUserById.mockImplementation((id: string) => WORLD.find((u) => u.id === id));
  h.findClassCategories.mockReturnValue([{ slug: "strength" }, { slug: "conditioning" }]);
  h.findClassWorkoutTemplates.mockImplementation(() => [...store.templates].sort((a, b) => a.name.localeCompare(b.name)));
  h.findClassWorkoutTemplateById.mockImplementation((id: string) => store.templates.find((t) => t.id === id));
  h.saveClassWorkoutTemplate.mockImplementation((t: Tpl) => {
    const i = store.templates.findIndex((x) => x.id === t.id);
    if (i === -1) store.templates.push(t);
    else store.templates[i] = t;
  });
  h.deleteClassWorkoutTemplate.mockImplementation((id: string) => {
    store.templates = store.templates.filter((t) => t.id !== id);
  });
  h.findExercises.mockReturnValue([{ id: "ex-1" }]);
});

describe("GET /api/mobile/staff/workout-templates — list is scoped to the acting gym", () => {
  it("Tenant A lists its own templates (including one whose creator was archived) and no one else's", async () => {
    const ids = await listedIds(await list(A_COACH.id));

    expect(ids).toEqual(["tpl-a1", "tpl-a2", "tpl-a3"]);
  });

  it("Tenant B and Tenant C each see only their own", async () => {
    expect(await listedIds(await list(B_COACH.id))).toEqual(["tpl-b1"]);
    expect(await listedIds(await list(C_COACH.id))).toEqual(["tpl-c1"]);
  });

  it("never lists a legacy template with no creator or one whose creator is gone", async () => {
    for (const actor of [A_COACH.id, B_COACH.id, C_COACH.id, OPERATOR.id]) {
      const ids = await listedIds(await list(actor));
      expect(ids).not.toContain("tpl-legacy");
      expect(ids).not.toContain("tpl-orphan");
    }
  });

  it("the response body never contains another gym's template ids or names", async () => {
    const text = JSON.stringify(await (await list(A_COACH.id)).json());

    expect(text).not.toMatch(/tpl-b1|tpl-c1|Delta B|Echo C|tpl-legacy|tpl-orphan/);
  });

  it("a platform operator (gymId: null) sees ONLY primary-gym templates: no new cross-gym exception, non-primary-gym templates stay inaccessible", async () => {
    const ids = await listedIds(await list(OPERATOR.id));

    expect(ids).toEqual(["tpl-a1", "tpl-a2", "tpl-a3"]); // primary gym (Tenant A) only
    expect(ids).not.toContain("tpl-b1"); // Tenant B (non-primary)
    expect(ids).not.toContain("tpl-c1"); // Tenant C (non-primary)
  });

  it("ignores a client-supplied gymId / tenantId in the query", async () => {
    const ids = await listedIds(await list(A_COACH.id, "?gymId=gym-b&tenantId=gym-b"));

    expect(ids).toEqual(["tpl-a1", "tpl-a2", "tpl-a3"]);
  });

  it("still bundles the exercise library alongside the templates (existing behaviour)", async () => {
    const body = await (await list(A_COACH.id)).json();

    expect(body.success).toBe(true);
    expect(body.data.libraryExercises).toEqual([{ id: "ex-1" }]);
  });

  it("wrong role -> 403; no session -> 401; archived and deleted actors -> 401, nothing listed", async () => {
    const member = await list(A_MEMBER.id);
    expect(member.status).toBe(403);
    expect((await member.json()).data).toBeUndefined();

    const none = await list();
    const archived = await list(ARCHIVED_ACTOR.id);
    expect(none.status).toBe(401);
    expect(archived.status).toBe(401);
    expect(await archived.json()).toEqual(await none.json());
    expect((await list("no-such-actor")).status).toBe(401);
  });

  it("a restored actor lists again with the same session", async () => {
    expect((await list(ARCHIVED_ACTOR.id)).status).toBe(401);

    ARCHIVED_ACTOR.archivedAt = null;
    try {
      expect(await listedIds(await list(ARCHIVED_ACTOR.id))).toEqual(["tpl-a1", "tpl-a2", "tpl-a3"]);
    } finally {
      ARCHIVED_ACTOR.archivedAt = "2026-09-01T00:00:00.000Z";
    }
  });
});

describe("POST /api/staff/workout-templates — create", () => {
  it("creates a template owned by the acting staff member, and it appears in that gym's list only", async () => {
    const res = await save(valid(), A_COACH.id);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.message).toBe("Template created.");
    expect(body.data.createdByStaffId).toBe(A_COACH.id);
    expect(h.saveClassWorkoutTemplate).toHaveBeenCalledTimes(1);
    expect(await listedIds(await list(A_ADMIN.id))).toContain(body.data.id);
    expect(await listedIds(await list(B_COACH.id))).not.toContain(body.data.id);
  });

  it("works for a second tenant's staff", async () => {
    const res = await save(valid(), B_COACH.id);

    expect(res.status).toBe(200);
    expect((await res.json()).data.createdByStaffId).toBe(B_COACH.id);
  });

  it("ignores a client-supplied gymId, tenantId or createdByStaffId: ownership always comes from the session", async () => {
    const res = await save(valid({ gymId: "gym-b", tenantId: "gym-b", createdByStaffId: B_COACH.id }), A_COACH.id);

    expect((await res.json()).data.createdByStaffId).toBe(A_COACH.id);
    expect(await listedIds(await list(B_COACH.id))).toEqual(["tpl-b1"]);
  });

  it("keeps the existing request validation (nothing saved)", async () => {
    for (const body of [valid({ name: " " }), valid({ categories: [] }), valid({ categories: ["nope"] }), valid({ exercises: [] })]) {
      expect((await save(body, A_COACH.id)).status).toBe(400);
    }
    expect(h.saveClassWorkoutTemplate).not.toHaveBeenCalled();
  });
});

describe("POST /api/staff/workout-templates — update by id", () => {
  it("updates a same-gym template, keeping its id and original creator", async () => {
    const res = await save(valid({ id: "tpl-a2", name: "Renamed" }), A_COACH.id); // a different same-gym staff member edits it
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.message).toBe("Template updated.");
    expect(body.data).toMatchObject({ id: "tpl-a2", name: "Renamed", createdByStaffId: A_ADMIN.id });
    expect(store.templates.filter((t) => t.id === "tpl-a2")).toHaveLength(1);
  });

  it("updates a template whose creator was archived (the gym still owns it)", async () => {
    expect((await save(valid({ id: "tpl-a3" }), A_COACH.id)).status).toBe(200);
  });

  it.each([
    ["Tenant A -> Tenant B template", A_COACH.id, "tpl-b1"],
    ["Tenant B -> Tenant A template (reverse)", B_COACH.id, "tpl-a1"],
    ["Tenant B -> Tenant C template (two non-primary gyms)", B_COACH.id, "tpl-c1"],
    ["platform operator (gymId: null) -> non-primary Tenant B template: no operator cross-gym exception", OPERATOR.id, "tpl-b1"],
  ])("%s: 404 'Template not found.', nothing saved, data unchanged", async (_label, actor, id) => {
    const before = snapshot();

    const res = await save(valid({ id, name: "Hijacked" }), actor);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual(NOT_FOUND);
    expect(h.saveClassWorkoutTemplate).not.toHaveBeenCalled();
    expect(snapshot()).toBe(before);
  });

  it.each([
    ["a legacy template with no creator", "tpl-legacy"],
    ["a template whose creator account no longer exists", "tpl-orphan"],
  ])("fails closed for %s: 404, nothing saved", async (_label, id) => {
    const before = snapshot();

    const res = await save(valid({ id }), A_COACH.id);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual(NOT_FOUND);
    expect(h.saveClassWorkoutTemplate).not.toHaveBeenCalled();
    expect(snapshot()).toBe(before);
  });

  it("a cross-gym id, a legacy id and an unknown id are indistinguishable (same status and body)", async () => {
    const crossGym = await save(valid({ id: "tpl-b1" }), A_COACH.id);
    const legacy = await save(valid({ id: "tpl-legacy" }), A_COACH.id);
    const missing = await save(valid({ id: "tpl-does-not-exist" }), A_COACH.id);

    expect(legacy.status).toBe(crossGym.status);
    expect(missing.status).toBe(crossGym.status);
    const body = await crossGym.json();
    expect(await legacy.json()).toEqual(body);
    expect(await missing.json()).toEqual(body);
  });

  it("ignores a client-supplied gymId / tenantId when the id names another gym's template", async () => {
    const res = await save(valid({ id: "tpl-b1", gymId: null, tenantId: "gym-a", createdByStaffId: A_COACH.id }), A_COACH.id);

    expect(res.status).toBe(404);
    expect(h.saveClassWorkoutTemplate).not.toHaveBeenCalled();
    expect(store.templates.find((t) => t.id === "tpl-b1")?.createdByStaffId).toBe(B_COACH.id);
  });

  it("a platform operator (gymId: null = primary gym) may update a PRIMARY-gym template, as primary-gym staff can", async () => {
    expect((await save(valid({ id: "tpl-a1" }), OPERATOR.id)).status).toBe(200);
  });
});

describe("POST /api/staff/workout-templates/delete", () => {
  it("deletes a same-gym template (and only that one)", async () => {
    const res = await del({ id: "tpl-a1" }, A_ADMIN.id);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, message: "Template deleted." });
    expect(store.templates.map((t) => t.id)).not.toContain("tpl-a1");
    expect(store.templates).toHaveLength(seed().length - 1);
  });

  it("deletes a template whose creator was archived", async () => {
    expect((await del({ id: "tpl-a3" }, A_COACH.id)).status).toBe(200);
  });

  it.each([
    ["Tenant A -> Tenant B template", A_COACH.id, "tpl-b1"],
    ["Tenant B -> Tenant A template (reverse)", B_COACH.id, "tpl-a1"],
    ["Tenant B -> Tenant C template (two non-primary gyms)", B_COACH.id, "tpl-c1"],
    ["platform operator (gymId: null) -> non-primary Tenant B template: no operator cross-gym exception", OPERATOR.id, "tpl-b1"],
    ["Tenant A -> a legacy template with no creator", A_COACH.id, "tpl-legacy"],
    ["Tenant A -> a template whose creator is gone", A_COACH.id, "tpl-orphan"],
  ])("%s: 404 'Template not found.' and nothing is deleted", async (_label, actor, id) => {
    const before = snapshot();

    const res = await del({ id }, actor);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual(NOT_FOUND);
    expect(h.deleteClassWorkoutTemplate).not.toHaveBeenCalled();
    expect(snapshot()).toBe(before);
  });

  it("cross-gym, legacy and unknown ids are indistinguishable", async () => {
    const crossGym = await del({ id: "tpl-b1" }, A_COACH.id);
    const legacy = await del({ id: "tpl-legacy" }, A_COACH.id);
    const missing = await del({ id: "tpl-does-not-exist" }, A_COACH.id);

    expect(legacy.status).toBe(crossGym.status);
    expect(missing.status).toBe(crossGym.status);
    const body = await crossGym.json();
    expect(await legacy.json()).toEqual(body);
    expect(await missing.json()).toEqual(body);
  });

  it("ignores a client-supplied gymId / tenantId", async () => {
    const res = await del({ id: "tpl-b1", gymId: null, tenantId: "gym-a" }, A_COACH.id);

    expect(res.status).toBe(404);
    expect(h.deleteClassWorkoutTemplate).not.toHaveBeenCalled();
  });

  it("a platform operator (gymId: null = primary gym) may delete a PRIMARY-gym template, as primary-gym staff can", async () => {
    expect((await del({ id: "tpl-a2" }, OPERATOR.id)).status).toBe(200);
  });

  it("keeps the existing validation (a missing id -> 400, nothing deleted)", async () => {
    const res = await del({}, A_COACH.id);

    expect(res.status).toBe(400);
    expect((await res.json()).message).toBe("Template ID is required.");
    expect(h.deleteClassWorkoutTemplate).not.toHaveBeenCalled();
  });
});

describe("workout-template writes — wrong role, no session, archived and deleted actors", () => {
  it("a plain member is refused (403) on create/update and delete; nothing changes", async () => {
    const before = snapshot();

    expect((await save(valid(), A_MEMBER.id)).status).toBe(403);
    expect((await save(valid({ id: "tpl-a1" }), A_MEMBER.id)).status).toBe(403);
    expect((await del({ id: "tpl-a1" }, A_MEMBER.id)).status).toBe(403);
    expect(snapshot()).toBe(before);
  });

  it("no session -> 401 on both writes, identical to an ARCHIVED actor, and a DELETED actor's token; nothing changes", async () => {
    const before = snapshot();

    const noneSave = await save(valid({ id: "tpl-a1" }));
    const archivedSave = await save(valid({ id: "tpl-a1" }), ARCHIVED_ACTOR.id);
    const deletedSave = await save(valid({ id: "tpl-a1" }), "no-such-actor");
    const noneDel = await del({ id: "tpl-a1" });
    const archivedDel = await del({ id: "tpl-a1" }, ARCHIVED_ACTOR.id);
    const deletedDel = await del({ id: "tpl-a1" }, "no-such-actor");

    for (const r of [noneSave, archivedSave, deletedSave, noneDel, archivedDel, deletedDel]) expect(r.status).toBe(401);
    expect(await archivedSave.json()).toEqual(await noneSave.json());
    expect(await archivedDel.json()).toEqual(await noneDel.json());
    expect(h.saveClassWorkoutTemplate).not.toHaveBeenCalled();
    expect(h.deleteClassWorkoutTemplate).not.toHaveBeenCalled();
    expect(snapshot()).toBe(before);
  });

  it("a restored actor can create, update and delete again with the same session", async () => {
    expect((await save(valid(), ARCHIVED_ACTOR.id)).status).toBe(401);

    ARCHIVED_ACTOR.archivedAt = null;
    try {
      const created = await save(valid(), ARCHIVED_ACTOR.id);
      expect(created.status).toBe(200);
      const id = (await created.json()).data.id;
      expect((await save(valid({ id, name: "Edited" }), ARCHIVED_ACTOR.id)).status).toBe(200);
      expect((await del({ id }, ARCHIVED_ACTOR.id)).status).toBe(200);
    } finally {
      ARCHIVED_ACTOR.archivedAt = "2026-09-01T00:00:00.000Z";
    }
  });
});
