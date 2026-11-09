// The staff web page /staff/gym-community: reports of gym posts, comments and groups in the signed-in staff member's OWN gym. Real page function, real
// datastore (helpers/iap-fixture.ts), real signed sessions, the real shared row builder. Fake ids only.
// What this proves: a coach or admin sees their own gym's reports (text, author, reporter, reason); another gym's staff see none of them; a plain member and a
// signed-out visitor are redirected away; and a group report shows the group's name and description with the organiser as its author.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createFixture, GYM_B, type IapFixture } from "../helpers/iap-fixture";

const pageCookie = vi.hoisted(() => ({ current: "" }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === "session" ? { value: pageCookie.current.replace(/^session=/, "") } : undefined) }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));

const T = "2026-01-01T00:00:00.000Z";
let fx: IapFixture;

type Row = { id: string; targetType: string; text: string | null; reason: string; reporterName: string; author: { displayName: string } | null };
async function pageRows(userId: string | null): Promise<Row[]> {
  pageCookie.current = userId ? fx.cookie(userId) : "";
  const { default: Page } = await import("@/app/(staff)/staff/gym-community/page");
  const element = (await Page()) as { props: { reports: Row[] } };
  return element.props.reports;
}

function person(name: string, role: "member" | "coach" = "member", gymId: string | null = null) {
  const user = fx.db.createUserWithRole(`gp-${name.replace(/\W+/g, "")}-${Math.random().toString(36).slice(2, 6)}@example.test`, "x", role, gymId);
  fx.db.saveProfile({ userId: user.id, fullName: name, email: user.email, createdAt: T, updatedAt: T } as never);
  return user;
}

function report(over: Record<string, unknown>) {
  fx.db.createGymReport({
    id: `r-${Math.random().toString(36).slice(2, 8)}`, gymId: null, targetType: "post", targetId: "", reporterId: "", reason: "Rude", status: "open",
    resolvedById: null, resolvedAt: null, createdAt: T, ...over,
  } as never);
}

beforeEach(async () => {
  fx = await createFixture();
});
afterEach(() => fx.cleanup());

describe("who can open the page", () => {
  it("a plain member and a signed-out visitor are redirected away", async () => {
    const member = person("Plain Member");
    await expect(pageRows(member.id)).rejects.toThrow(/REDIRECT:/);
    await expect(pageRows(null)).rejects.toThrow(/REDIRECT:/);
  });

  it("a coach and an admin open it", async () => {
    expect(await pageRows(person("Coach", "coach").id)).toEqual([]);
    expect(await pageRows(fx.adminA.id)).toEqual([]);
  });
});

describe("what staff see", () => {
  it("a post report and a group report from the coach's own gym, with text, author, reporter and reason", async () => {
    const coach = person("Coach", "coach");
    const author = person("Pat Poster");
    const reporter = person("Rae Reporter");
    fx.db.createGymPost({ id: "p1", gymId: null, authorId: author.id, body: "A rude post", createdAt: T, removedAt: null, removedById: null } as never);
    fx.db.createGroupIfUnderLimit({ id: "g1", name: "Late Night Lifters", description: "Rude words", organiserId: author.id, gymId: null, inviteCode: "ABCD2345", createdAt: T, closedAt: null } as never);
    report({ targetType: "post", targetId: "p1", reporterId: reporter.id, reason: "Offensive" });
    report({ targetType: "group", targetId: "g1", reporterId: reporter.id, reason: "Rude name" });

    const rows = await pageRows(coach.id);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.targetType === "post")).toMatchObject({ text: "A rude post", reason: "Offensive", reporterName: "Rae Reporter", author: { displayName: "Pat Poster" } });
    expect(rows.find((r) => r.targetType === "group")).toMatchObject({ text: "Late Night Lifters\nRude words", reason: "Rude name", author: { displayName: "Pat Poster" } });
  });

  it("another gym's staff see none of them", async () => {
    const author = person("Pat Poster");
    fx.db.createGymPost({ id: "p1", gymId: null, authorId: author.id, body: "A rude post", createdAt: T, removedAt: null, removedById: null } as never);
    report({ targetType: "post", targetId: "p1", reporterId: author.id });
    const other = person("Other Coach", "coach", GYM_B);
    expect(await pageRows(other.id)).toEqual([]);
    expect(await pageRows(fx.adminB.id)).toEqual([]);
  });
});
