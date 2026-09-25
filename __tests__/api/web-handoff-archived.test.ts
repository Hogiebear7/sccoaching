// GET /api/auth/web-handoff redeems a mobile handoff token (60s, single-use)
// for a fresh web session cookie. It is the one place a session is issued
// without a login, so it must re-check the account like login does: an account
// archived after the token was minted gets NO cookie, and is sent to the login
// screen exactly like an invalid or expired token.
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ consumeMobileHandoffToken: vi.fn(), findUserById: vi.fn() }));
vi.mock("@/lib/db", () => h);

type U = { id: string; role: string; archivedAt: string | null };
let users: Record<string, U>;

const handoff = async (token = "handoff-token", next?: string) => {
  const { GET } = await import("@/app/api/auth/web-handoff/route");
  const qs = new URLSearchParams({ token, ...(next ? { next } : {}) });
  return GET(new NextRequest(`http://localhost/api/auth/web-handoff?${qs}`));
};

beforeEach(() => {
  vi.clearAllMocks();
  users = {
    member: { id: "member", role: "member", archivedAt: null },
    staff: { id: "staff", role: "admin", archivedAt: null },
    gone: { id: "gone", role: "member", archivedAt: "2026-09-01T00:00:00.000Z" },
    goneStaff: { id: "goneStaff", role: "admin", archivedAt: "2026-09-01T00:00:00.000Z" },
  };
  h.consumeMobileHandoffToken.mockImplementation((t: string) => (t === "handoff-token" ? "member" : undefined));
  h.findUserById.mockImplementation((id: string) => users[id]);
});

const location = (res: Response) => new URL(res.headers.get("location") ?? "").pathname + new URL(res.headers.get("location") ?? "").search;

describe("web-handoff consumer", () => {
  it("issues a session cookie for a live account (control: unchanged)", async () => {
    const res = await handoff();

    expect(res.headers.get("set-cookie")).toMatch(/session=/);
    expect(location(res)).toBe("/dashboard/membership");
  });

  it.each([
    ["an archived member", "gone"],
    ["an archived staff account", "goneStaff"],
  ])("does NOT issue a cookie for %s, and redirects to login", async (_label, id) => {
    h.consumeMobileHandoffToken.mockReturnValue(id);

    const res = await handoff("handoff-token", "/dashboard/membership");

    expect(res.headers.get("set-cookie")).toBeNull();
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(location(res)).toBe("/login?next=%2Fdashboard%2Fmembership");
  });

  it("an archived account is indistinguishable from an invalid token (same redirect, no cookie)", async () => {
    h.consumeMobileHandoffToken.mockReturnValueOnce("gone");
    const archived = await handoff("handoff-token", "/dashboard/membership");
    const invalid = await handoff("bad-token", "/dashboard/membership");

    expect(location(archived)).toBe(location(invalid));
    expect(archived.status).toBe(invalid.status);
    expect(archived.headers.get("set-cookie")).toBeNull();
    expect(invalid.headers.get("set-cookie")).toBeNull();
  });

  it("a restored account is handed a session again", async () => {
    h.consumeMobileHandoffToken.mockReturnValue("gone");
    expect((await handoff()).headers.get("set-cookie")).toBeNull();

    users.gone.archivedAt = null;

    expect((await handoff()).headers.get("set-cookie")).toMatch(/session=/);
  });
});
