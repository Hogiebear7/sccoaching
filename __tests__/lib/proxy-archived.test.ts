// proxy.ts page gating. An archived (or deleted) account's signed token counts
// as NO session: /dashboard redirects to /login, and /login then renders for it
// (no /login <-> /dashboard bounce loop). The staff-area behaviour, including
// the operator/staff role gate, is unchanged.
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { proxy } from "@/proxy";
import { MEMBER_SESSION_LIFETIME_MS, STAFF_SESSION_LIFETIME_MS, signSession } from "@/lib/session";

const h = vi.hoisted(() => ({ findUserById: vi.fn() }));
vi.mock("@/lib/db", () => h);

type U = { id: string; role: string; archivedAt: string | null };
let users: Record<string, U>;

const cookie = (id: string, lifetime = MEMBER_SESSION_LIFETIME_MS) => `session=${signSession({ userId: id }, lifetime)}`;
const page = (path: string, as?: string) =>
  proxy(new NextRequest(`http://localhost${path}`, { headers: as ? { Cookie: cookie(as, STAFF_SESSION_LIFETIME_MS) } : {} }));
const redirectPath = (res: Response) => {
  const loc = res.headers.get("location");
  return loc ? new URL(loc).pathname : null;
};

beforeEach(() => {
  vi.clearAllMocks();
  users = {
    member: { id: "member", role: "member", archivedAt: null },
    admin: { id: "admin", role: "admin", archivedAt: null },
    operator: { id: "operator", role: "platform_operator", archivedAt: null },
    goneMember: { id: "goneMember", role: "member", archivedAt: "2026-09-01T00:00:00.000Z" },
    goneAdmin: { id: "goneAdmin", role: "admin", archivedAt: "2026-09-01T00:00:00.000Z" },
  };
  h.findUserById.mockImplementation((id: string) => users[id]);
});

describe("/dashboard", () => {
  it("lets a live member through (control)", () => {
    expect(redirectPath(page("/dashboard", "member"))).toBeNull();
  });

  it.each(["goneMember", "goneAdmin"])("redirects an archived account (%s) to /login", (id) => {
    expect(redirectPath(page("/dashboard", id))).toBe("/login");
    expect(redirectPath(page("/dashboard/membership", id))).toBe("/login");
  });

  it("redirects a deleted account's token to /login", () => {
    expect(redirectPath(page("/dashboard", "no-such-user"))).toBe("/login");
  });

  it("redirects a request with no session to /login (unchanged)", () => {
    expect(redirectPath(page("/dashboard"))).toBe("/login");
  });

  it("lets a restored account back in", () => {
    expect(redirectPath(page("/dashboard", "goneMember"))).toBe("/login");

    users.goneMember.archivedAt = null;

    expect(redirectPath(page("/dashboard", "goneMember"))).toBeNull();
  });
});

describe("/login and /signup (guest-only pages)", () => {
  it("still bounces a LIVE session to /dashboard (unchanged)", () => {
    expect(redirectPath(page("/login", "member"))).toBe("/dashboard");
    expect(redirectPath(page("/signup", "admin"))).toBe("/dashboard");
  });

  it("does NOT bounce an archived account back to /dashboard, so there is no redirect loop", () => {
    expect(redirectPath(page("/login", "goneMember"))).toBeNull();
    expect(redirectPath(page("/signup", "goneAdmin"))).toBeNull();
  });
});

describe("/staff (unchanged)", () => {
  it("lets a live admin and a platform operator through", () => {
    expect(redirectPath(page("/staff/classes", "admin"))).toBeNull();
    expect(redirectPath(page("/staff/finances", "operator"))).toBeNull();
  });

  it("sends a non-staff member to /dashboard", () => {
    expect(redirectPath(page("/staff/classes", "member"))).toBe("/dashboard");
  });

  it("sends an archived staff account to /dashboard (which then sends it to /login)", () => {
    expect(redirectPath(page("/staff/classes", "goneAdmin"))).toBe("/dashboard");
    expect(redirectPath(page("/dashboard", "goneAdmin"))).toBe("/login");
  });

  it("sends a deleted account or no session to /login", () => {
    expect(redirectPath(page("/staff/classes", "no-such-user"))).toBe("/login");
    expect(redirectPath(page("/staff/classes"))).toBe("/login");
  });
});
