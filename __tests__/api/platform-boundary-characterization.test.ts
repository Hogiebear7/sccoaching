// PLATFORM-BOUNDARY TESTS — originally written as CHARACTERIZATION tests that
// pinned the INSECURE pre-remediation behavior; they have now been converted to
// assert the APPROVED policy. Every place that used to be "[INSECURE]" is kept
// in the same describe/test position, with a "WAS:" note recording exactly what
// the old behavior was, so the before/after is readable in one place.
//
// Approved policy (lib/permissions.ts):
//   * Only the `platform_operator` role satisfies the platform-only capabilities
//     `gyms.moderate`, `finance.view` and `platform.jobs` (checked by exact role,
//     never by rank, never by gymId — null included).
//   * A gym may never change its OWN status.
//   * Public gym signup still creates an ordinary admin_manager owner, who is
//     never a platform operator.
//   * The CRON_SECRET path of /api/cron/run is unchanged.
//   * Tenant admins lose platform-wide Finance (temporary, until per-gym Finance
//     ownership is designed). The Business snapshot's membership/class sections
//     stay same-gym scoped; its revenue section is platform-only.
//
// Everything runs against an isolated in-memory store (no production data), the
// real route handlers, the real signed-session mechanism, the real capability
// map, and the real lib/finance + lib/staff-business-data code.
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MEMBER_SESSION_LIFETIME_MS, signSession } from "@/lib/session";

const { mockCookies, mockRedirect } = vi.hoisted(() => ({
  mockCookies: vi.fn(),
  mockRedirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));
vi.mock("next/headers", () => ({ cookies: mockCookies }));
vi.mock("next/navigation", () => ({ redirect: mockRedirect }));

// ---- isolated in-memory store ------------------------------------------------
type AnyRec = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const store = vi.hoisted(() => ({
  users: [] as AnyRec[],
  gyms: [] as AnyRec[],
  ledger: [] as AnyRec[],
  revenueEvents: [] as AnyRec[],
  packages: [] as AnyRec[],
  settings: {} as AnyRec,
  nextId: 1,
}));

vi.mock("@/lib/db", () => ({
  // users / gyms (gym signup, staff auth, gym status)
  findUserById: (id: string) => store.users.find((u) => u.id === id),
  findUserByEmail: (email: string) => store.users.find((u) => u.email === email),
  createUserWithRole: (email: string, passwordHash: string, role: string, gymId: string | null = null) => {
    const user = { id: `user-${store.nextId++}`, email, passwordHash, role, archivedAt: null, gymId, createdAt: "now", updatedAt: "now" };
    store.users.push(user);
    return user;
  },
  setUserGymId: (userId: string, gymId: string | null) => {
    const user = store.users.find((u) => u.id === userId);
    if (!user) return false;
    user.gymId = gymId;
    return true;
  },
  createGym: (gym: AnyRec) => {
    store.gyms.push(gym);
  },
  findGymBySlug: (slug: string) => store.gyms.find((g) => g.slug === slug),
  findGymById: (id: string) => store.gyms.find((g) => g.id === id),
  saveGym: (gym: AnyRec) => {
    const i = store.gyms.findIndex((g) => g.id === gym.id);
    if (i >= 0) store.gyms[i] = gym;
    else store.gyms.push(gym);
  },
  // finance
  findAllFinanceLedgerEntries: () => [...store.ledger],
  findFinanceLedgerEntryById: (id: string) => store.ledger.find((e) => e.id === id),
  saveFinanceLedgerEntry: (entry: AnyRec) => {
    const i = store.ledger.findIndex((e) => e.id === entry.id);
    if (i >= 0) store.ledger[i] = entry;
    else store.ledger.push(entry);
  },
  deleteFinanceLedgerEntry: (id: string) => {
    store.ledger = store.ledger.filter((e) => e.id !== id);
  },
  getFinanceSettings: () => ({ ...store.settings }),
  saveFinanceSettings: (settings: AnyRec) => {
    store.settings = { ...settings };
  },
  findAllRevenueEvents: () => [...store.revenueEvents],
  findAllPurchases: () => [],
  findAllAiUsageLogs: () => [],
  findMembershipPackageById: (id: string) => store.packages.find((p) => p.id === id),
  findProfileByUserId: (id: string) => (id === "member-sc" ? { fullName: "Sam Member", dateOfBirth: "1990-05-05" } : undefined),
  findSubscriptionByUserId: () => undefined,
  // reports (mobile Business membership / classes sections)
  findMembers: () => store.users.filter((u) => u.role === "member"),
  findAllSubscriptions: () => [],
  findClasses: () => [],
  findClassCategories: () => [],
  findDeletedCategoryLabels: () => ({}),
  findBookingsByClassId: () => [],
}));
vi.mock("@/lib/membership-entitlement", () => ({ resolveMemberTier: () => "membership" }));
vi.mock("@/app/(staff)/staff/finances/FinancesView", () => ({ FinancesView: () => null }));

const runAllJobs = vi.hoisted(() => vi.fn());
vi.mock("@/lib/jobs/runner", () => ({ runAllJobs }));

// ---- fixtures ------------------------------------------------------------------
const NOW_ISO = new Date().toISOString();
const PRIMARY_GYM = { id: "gym-primary-id", slug: "sc-performance-coaching", name: "S&C", status: "active", ownerUserId: "mgr-primary", updatedAt: NOW_ISO };
const SECOND_GYM = { id: "gym-b-id", slug: "gym-b", name: "Gym B", status: "active", ownerUserId: "mgr-b", updatedAt: NOW_ISO };

const user = (id: string, role: string, gymId: string | null, archivedAt: string | null = null) => ({
  id,
  email: `${id}@x.test`,
  role,
  gymId,
  archivedAt,
  createdAt: NOW_ISO,
});

// S&C (primary gym, gymId null) data that a DIFFERENT gym's admin_manager must not see.
const MEMBER_SC = user("member-sc", "member", null);
const LEDGER_SC = {
  id: "led-sc",
  kind: "expense",
  incomeSource: null,
  incomeType: null,
  expenseType: "rent",
  feeType: null,
  status: "cleared",
  date: NOW_ISO,
  currency: "eur",
  grossAmountCents: 120000,
  feeAmountCents: 0,
  netAmountCents: 120000,
  memberId: null,
  packageId: null,
  relatedEntryId: null,
  reference: null,
  sourceExternalId: null,
  notes: "S&C studio rent",
  createdByUserId: "mgr-primary",
  createdAt: NOW_ISO,
  updatedAt: NOW_ISO,
};
const REVENUE_SC = {
  id: "rev-sc",
  userId: "member-sc",
  packageId: "pkg-sc",
  billingOptionId: null,
  amountCents: 9900,
  currency: "eur",
  provider: "stripe",
  providerRef: "in_sc_123",
  source: "membership_renewal",
  receivedAt: NOW_ISO,
};
const PKG_SC = { id: "pkg-sc", name: "S&C Unlimited" };

const IDENTITIES = {
  member: user("member-x", "member", null),
  coach: user("coach-x", "coach", null),
  admin: user("admin-x", "admin", null),
  adminManagerPrimaryNull: user("mgr-primary", "admin_manager", null),
  adminManagerPrimaryRecordId: user("mgr-primary-rec", "admin_manager", PRIMARY_GYM.id),
  adminManagerSecondGym: user("mgr-b", "admin_manager", SECOND_GYM.id),
  archivedAdminManager: user("mgr-archived", "admin_manager", SECOND_GYM.id, "2026-01-01T00:00:00.000Z"),
  // NEW: the only role that satisfies the platform-only capabilities.
  platformOperator: user("op-primary", "platform_operator", null), // an S&C-style operator (gymId null)
  platformOperatorInGym: user("op-gym-b", "platform_operator", SECOND_GYM.id), // an operator that belongs to Gym B
  archivedPlatformOperator: user("op-archived", "platform_operator", null, "2026-01-01T00:00:00.000Z"),
} as const;

function resetStore() {
  store.nextId = 1;
  store.users = [MEMBER_SC, ...Object.values(IDENTITIES).map((u) => ({ ...u }))];
  store.gyms = [{ ...PRIMARY_GYM }, { ...SECOND_GYM }];
  store.ledger = [{ ...LEDGER_SC }];
  store.revenueEvents = [{ ...REVENUE_SC }];
  store.packages = [{ ...PKG_SC }];
  store.settings = {
    taxRatePercent: 23,
    stripeFeePercent: 1.5,
    stripeFeeFixedCents: 25,
    cashPositionAnchorCents: null,
    cashPositionAnchorDate: null,
  };
}

const cookieFor = (userId: string) => `session=${signSession({ userId }, MEMBER_SESSION_LIFETIME_MS)}`;
const asCookieStore = (cookie: string | null) =>
  mockCookies.mockResolvedValue({
    get: (name: string) => (name === "session" && cookie ? { value: cookie.replace("session=", "") } : undefined),
  });

function request(url: string, method: string, cookie: string | null, body?: unknown) {
  return new NextRequest(`http://localhost${url}`, {
    method,
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

async function signupGymOwner() {
  const { POST } = await import("@/app/api/gyms/signup/route");
  const res = await POST(
    request("/api/gyms/signup", "POST", null, {
      gymName: "Gym Two",
      addressLine: "1 Test Road",
      ownerEmail: "owner@gymtwo.test",
      password: "Str0ng!Pass",
    })
  );
  const setCookie = res.headers.get("set-cookie") ?? "";
  const cookie = /session=[^;]+/.exec(setCookie)?.[0] ?? null;
  return { res, body: await res.json(), cookie };
}

const finances = async (cookie: string | null) => {
  asCookieStore(cookie);
  const { default: Page } = await import("@/app/(staff)/staff/finances/page");
  return (Page as () => Promise<{ props: { lines: AnyRec[]; settings: AnyRec } }>)();
};
const financesOutcome = async (cookie: string | null) => finances(cookie).then(() => "rendered", (e: Error) => e.message);
const ledgerPost = async (cookie: string | null, body: unknown) => {
  const { POST } = await import("@/app/api/staff/finance/ledger/route");
  return POST(request("/api/staff/finance/ledger", "POST", cookie, body));
};
const ledgerDelete = async (cookie: string | null, body: unknown) => {
  const { POST } = await import("@/app/api/staff/finance/ledger/delete/route");
  return POST(request("/api/staff/finance/ledger/delete", "POST", cookie, body));
};
const financeSettings = async (cookie: string | null, body: unknown) => {
  const { POST } = await import("@/app/api/staff/settings/finance/route");
  return POST(request("/api/staff/settings/finance", "POST", cookie, body));
};
const gymStatus = async (cookie: string | null, gymId: string, body: unknown) => {
  const { POST } = await import("@/app/api/staff/gyms/[gymId]/status/route");
  return POST(request(`/api/staff/gyms/${gymId}/status`, "POST", cookie, body), { params: Promise.resolve({ gymId }) });
};
const mobileBusiness = async (cookie: string | null) => {
  const { GET } = await import("@/app/api/mobile/staff/business/route");
  return GET(request("/api/mobile/staff/business", "GET", cookie));
};
const cron = async (method: "GET" | "POST", cookie: string | null, authorization?: string) => {
  const { GET, POST } = await import("@/app/api/cron/run/route");
  const req = new NextRequest("http://localhost/api/cron/run", {
    method,
    headers: { ...(cookie ? { Cookie: cookie } : {}), ...(authorization ? { authorization } : {}) },
  });
  return method === "GET" ? GET(req) : POST(req);
};

const ledgerUntouched = () => {
  expect(store.ledger).toHaveLength(1);
  expect(store.ledger[0]).toEqual(LEDGER_SC);
};
const settingsUntouched = () => expect(store.settings.taxRatePercent).toBe(23);

const ORIGINAL_CRON_SECRET = process.env.CRON_SECRET;
beforeEach(() => {
  vi.clearAllMocks();
  resetStore();
  process.env.CRON_SECRET = "test-cron-secret";
  runAllJobs.mockResolvedValue([
    { jobName: "notify-lapsed-memberships", status: "ok", summary: "Notified 3 members about a lapsed billing period.", startedAt: NOW_ISO, finishedAt: NOW_ISO, durationMs: 4 },
    { jobName: "send-class-reminders", status: "ok", summary: "Sent 12 class reminders.", startedAt: NOW_ISO, finishedAt: NOW_ISO, durationMs: 9 },
  ]);
});
afterEach(() => {
  if (ORIGINAL_CRON_SECRET === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = ORIGINAL_CRON_SECRET;
});

// =============================================================================
describe("PLATFORM BOUNDARY 1 — public gym signup creates an ordinary admin_manager, never an operator", () => {
  it("creates a PENDING gym and an ordinary admin_manager owner scoped to it, returns the gymId, and sets a session cookie (unchanged)", async () => {
    const { res, body, cookie } = await signupGymOwner();

    expect(res.status).toBe(201);
    expect(body.success).toBe(true);
    const gym = store.gyms.find((g) => g.id === body.data.gymId);
    expect(gym).toMatchObject({ status: "pending", name: "Gym Two" });
    const owner = store.users.find((u) => u.email === "owner@gymtwo.test");
    expect(owner).toMatchObject({ role: "admin_manager", gymId: body.data.gymId });
    expect(owner!.role).not.toBe("platform_operator");
    expect(cookie).toBeTruthy();
    expect(gym!.ownerUserId).toBe(owner!.id);
  });
});

describe("PLATFORM BOUNDARY 2 — a freshly signed-up gym owner is denied the platform-wide Finance surface (WAS: [INSECURE] full access)", () => {
  it("the Finance page redirects the owner to /staff/classes and returns none of S&C's finance data (WAS: revenue line, member id, package name, ledger notes)", async () => {
    const { cookie } = await signupGymOwner();

    expect(await financesOutcome(cookie)).toBe("REDIRECT:/staff/classes");
  });

  it("cannot create a ledger entry (WAS: 200, attached to another gym's member and package)", async () => {
    const { cookie } = await signupGymOwner();

    const res = await ledgerPost(cookie, {
      kind: "income",
      incomeSource: "manual_cash",
      incomeType: "misc_income",
      status: "cleared",
      date: NOW_ISO,
      grossAmountCents: 5000,
      memberId: "member-sc",
      packageId: "pkg-sc",
    });

    expect(res.status).toBe(403);
    ledgerUntouched();
  });

  it("cannot overwrite another gym's ledger entry by id (WAS: 200 'Entry updated.')", async () => {
    const { cookie } = await signupGymOwner();

    const res = await ledgerPost(cookie, { id: "led-sc", kind: "expense", expenseType: "misc", status: "cleared", date: NOW_ISO, grossAmountCents: 1, notes: "overwritten by another gym" });

    expect(res.status).toBe(403);
    ledgerUntouched();
  });

  it("cannot delete another gym's ledger entry (WAS: 200 'Entry deleted.')", async () => {
    const { cookie } = await signupGymOwner();

    const res = await ledgerDelete(cookie, { id: "led-sc" });

    expect(res.status).toBe(403);
    ledgerUntouched();
  });

  it("cannot overwrite the shared finance settings (WAS: 200, tax rate changed)", async () => {
    const { cookie } = await signupGymOwner();

    const res = await financeSettings(cookie, { taxRatePercent: 0, stripeFeePercent: 0, stripeFeeFixedCents: 0, cashPositionAnchorCents: null, cashPositionAnchorDate: null });

    expect(res.status).toBe(403);
    settingsUntouched();
  });

  it("the mobile Business snapshot returns NO revenue to the owner (revenue: null) while membership/class sections stay gym-scoped (WAS: S&C's platform-wide revenue)", async () => {
    const { cookie } = await signupGymOwner();

    const res = await mobileBusiness(cookie);
    const { data } = await res.json();

    expect(res.status).toBe(200);
    expect(data.revenue).toBeNull();
    expect(data.membership.activeMembers).toBe(0);
    expect(JSON.stringify(data)).not.toMatch(/9900|23|member-sc/);
  });
});

describe("PLATFORM BOUNDARY 2b — a platform_operator still has the (unchanged) platform Finance operations", () => {
  it("reads the Finance page: S&C's revenue line and manual ledger", async () => {
    const { props } = await finances(cookieFor("op-primary"));

    expect(props.lines.map((l) => l.id)).toEqual(expect.arrayContaining(["rev-sc", "led-sc"]));
    expect(props.lines.find((l) => l.id === "rev-sc")).toMatchObject({ grossCents: 9900, memberId: "member-sc" });
    expect(props.settings.taxRatePercent).toBe(23);
  });

  it("creates, overwrites and deletes ledger entries and saves settings, with the same responses as before", async () => {
    const cookie = cookieFor("op-primary");

    const created = await ledgerPost(cookie, { kind: "income", incomeSource: "manual_cash", incomeType: "misc_income", status: "cleared", date: NOW_ISO, grossAmountCents: 5000 });
    expect(created.status).toBe(200);
    expect((await created.json()).message).toBe("Entry added.");
    expect(store.ledger.find((e) => e.id !== "led-sc")).toMatchObject({ createdByUserId: "op-primary" });

    const updated = await ledgerPost(cookie, { id: "led-sc", kind: "expense", expenseType: "misc", status: "cleared", date: NOW_ISO, grossAmountCents: 1 });
    expect(updated.status).toBe(200);
    expect((await updated.json()).message).toBe("Entry updated.");
    expect(store.ledger.find((e) => e.id === "led-sc")).toMatchObject({ grossAmountCents: 1, createdByUserId: "mgr-primary" });

    const deleted = await ledgerDelete(cookie, { id: "led-sc" });
    expect(deleted.status).toBe(200);
    expect((await deleted.json()).message).toBe("Entry deleted.");

    const saved = await financeSettings(cookie, { taxRatePercent: 5, cashPositionAnchorCents: null, cashPositionAnchorDate: null });
    expect(saved.status).toBe(200);
    expect(store.settings.taxRatePercent).toBe(5);
  });

  it("the mobile Business snapshot includes revenue for the operator", async () => {
    const res = await mobileBusiness(cookieFor("op-primary"));
    const { data } = await res.json();

    expect(res.status).toBe(200);
    expect(data.revenue.thisMonthCents).toBe(9900);
    expect(data.revenue.taxRatePercent).toBe(23);
    // Membership/class sections remain ordinary same-gym (primary gym) sections for an operator.
    expect(data.membership.activeMembers).toBe(0);
  });
});

describe("PLATFORM BOUNDARY 3 — gym moderation is platform-only, and a gym can never change its own status (WAS: [INSECURE] any admin_manager, any gym, including self)", () => {
  it("a freshly signed-up owner CANNOT self-approve their PENDING gym (WAS: 200, status active)", async () => {
    const { cookie, body } = await signupGymOwner();

    const res = await gymStatus(cookie, body.data.gymId, { status: "active" });

    expect(res.status).toBe(403);
    expect(store.gyms.find((g) => g.id === body.data.gymId)!.status).toBe("pending");
  });

  it("the same owner CANNOT suspend the primary gym or any other gym (WAS: 200 for both)", async () => {
    const { cookie } = await signupGymOwner();

    expect((await gymStatus(cookie, PRIMARY_GYM.id, { status: "suspended" })).status).toBe(403);
    expect((await gymStatus(cookie, SECOND_GYM.id, { status: "suspended" })).status).toBe(403);
    expect(store.gyms.find((g) => g.id === PRIMARY_GYM.id)!.status).toBe("active");
    expect(store.gyms.find((g) => g.id === SECOND_GYM.id)!.status).toBe("active");
  });

  it("a primary-gym admin_manager CANNOT change a different gym's status (WAS: 200)", async () => {
    const res = await gymStatus(cookieFor("mgr-primary"), SECOND_GYM.id, { status: "pending" });

    expect(res.status).toBe(403);
    expect(store.gyms.find((g) => g.id === SECOND_GYM.id)!.status).toBe("active");
  });

  it("a platform_operator CAN moderate a different gym, with the existing response and mutation", async () => {
    const res = await gymStatus(cookieFor("op-primary"), SECOND_GYM.id, { status: "suspended" });

    expect(res.status).toBe(200);
    expect((await res.json()).message).toBe("Gym marked suspended.");
    expect(store.gyms.find((g) => g.id === SECOND_GYM.id)!.status).toBe("suspended");
  });

  it("a platform_operator can never change their OWN gym's status: a null-gym operator vs the primary gym, and an operator with a gymId vs that gym", async () => {
    const primaryByNullOperator = await gymStatus(cookieFor("op-primary"), PRIMARY_GYM.id, { status: "suspended" });
    expect(primaryByNullOperator.status).toBe(403);
    expect(await primaryByNullOperator.json()).toEqual({ success: false, message: "A gym can't change its own status." });
    expect(store.gyms.find((g) => g.id === PRIMARY_GYM.id)!.status).toBe("active");

    const ownByGymOperator = await gymStatus(cookieFor("op-gym-b"), SECOND_GYM.id, { status: "suspended" });
    expect(ownByGymOperator.status).toBe(403);
    expect(store.gyms.find((g) => g.id === SECOND_GYM.id)!.status).toBe("active");

    // ...but an operator that belongs to Gym B CAN moderate the primary gym (a different gym).
    const otherByGymOperator = await gymStatus(cookieFor("op-gym-b"), PRIMARY_GYM.id, { status: "suspended" });
    expect(otherByGymOperator.status).toBe(200);
    expect(store.gyms.find((g) => g.id === PRIMARY_GYM.id)!.status).toBe("suspended");
  });

  it("gymId null does not itself confer anything: a null-gym tenant admin_manager and admin are denied", async () => {
    expect((await gymStatus(cookieFor("mgr-primary"), SECOND_GYM.id, { status: "active" })).status).toBe(403);
    expect((await gymStatus(cookieFor("admin-x"), SECOND_GYM.id, { status: "active" })).status).toBe(403);
  });

  it("unknown-gym and validation behavior are unchanged for the operator: 404 'Gym not found.'; invalid status 400 with no change", async () => {
    const cookie = cookieFor("op-primary");

    const unknown = await gymStatus(cookie, "no-such-gym", { status: "active" });
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual({ success: false, message: "Gym not found." });

    const invalid = await gymStatus(cookie, SECOND_GYM.id, { status: "banned" });
    expect(invalid.status).toBe(400);
    expect(store.gyms.find((g) => g.id === SECOND_GYM.id)!.status).toBe("active");
  });

  it("authorization runs before the gym lookup: an unauthorized caller learns nothing about gym existence (WAS: the same order, but tenant admins reached the lookup)", async () => {
    expect((await gymStatus(null, "no-such-gym", { status: "active" })).status).toBe(401);
    for (const id of ["admin-x", "mgr-primary", "mgr-b"]) {
      const unknown = await gymStatus(cookieFor(id), "no-such-gym", { status: "active" });
      const known = await gymStatus(cookieFor(id), SECOND_GYM.id, { status: "active" });
      expect(unknown.status).toBe(403);
      expect(known.status).toBe(403); // identical: no existence disclosure to tenant roles
    }
  });
});

describe("PLATFORM BOUNDARY 4 — /api/cron/run", () => {
  it("CRON_SECRET path is unchanged: a matching bearer token runs the platform-wide job set with trigger 'cron' and returns each job's summary", async () => {
    const res = await cron("GET", null, "Bearer test-cron-secret");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(runAllJobs).toHaveBeenCalledWith("cron");
    expect(body).toMatchObject({ success: true, trigger: "cron" });
    expect(body.outcomes.map((o: AnyRec) => o.jobName)).toEqual(["notify-lapsed-memberships", "send-class-reminders"]);
  });

  it("CRON_SECRET path: wrong token (same length, different length), or no secret configured, is 401 and runs nothing", async () => {
    expect((await cron("GET", null, "Bearer wrong")).status).toBe(401);
    expect((await cron("GET", null, "Bearer test-cron-secreT")).status).toBe(401); // same length, one byte different
    delete process.env.CRON_SECRET;
    expect((await cron("GET", null, "Bearer test-cron-secret")).status).toBe(401);
    expect(runAllJobs).not.toHaveBeenCalled();
  });

  it("a platform_operator session runs the platform-wide jobs (trigger 'manual') with the response unchanged", async () => {
    const res = await cron("POST", cookieFor("op-primary"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(runAllJobs).toHaveBeenCalledTimes(1);
    expect(runAllJobs).toHaveBeenCalledWith("manual");
    expect(body).toMatchObject({ success: true, trigger: "manual" });
    expect(body.outcomes[0].summary).toBe("Notified 3 members about a lapsed billing period.");
  });

  it("a tenant admin session is DENIED, runs no job and sees no summaries (WAS: [INSECURE] 200 with cross-gym aggregate summaries)", async () => {
    for (const id of ["admin-x", "mgr-primary", "mgr-b", "mgr-primary-rec"]) {
      const res = await cron("GET", cookieFor(id));
      expect(res.status).toBe(401);
      const text = JSON.stringify(await res.json());
      expect(text).toContain("Not authorized to run jobs.");
      expect(text).not.toMatch(/Notified 3 members|outcomes/);
    }
    expect(runAllJobs).not.toHaveBeenCalled();
  });

  it("coach, member, archived tenant admin_manager, archived operator and a deleted user get 401 and run nothing", async () => {
    for (const cookie of [cookieFor("coach-x"), cookieFor("member-x"), cookieFor("mgr-archived"), cookieFor("op-archived"), cookieFor("ghost-user"), null]) {
      const res = await cron("GET", cookie);
      expect(res.status).toBe(401);
      expect((await res.json()).message).toBe("Not authorized to run jobs.");
    }
    expect(runAllJobs).not.toHaveBeenCalled();
  });

  it("a fresh gym owner cannot run cron through a session", async () => {
    const { cookie } = await signupGymOwner();

    expect((await cron("GET", cookie)).status).toBe(401);
    expect(runAllJobs).not.toHaveBeenCalled();
  });
});

// =============================================================================
// Role x gym matrix. Each row is the CURRENT status code. Only the
// platform_operator row is allowed; every tenant row — whatever the gym, incl.
// gymId null — is denied. (WAS: `admin_manager` of ANY gym got 200 on the
// finance/moderation routes and any `admin` got 200 on cron.)
// =============================================================================
type Ident = keyof typeof IDENTITIES | "unauthenticated" | "missingUser";
const cookieForIdent = (i: Ident): string | null =>
  i === "unauthenticated" ? null : i === "missingUser" ? cookieFor("ghost-user") : cookieFor(IDENTITIES[i].id);

const FINANCE_AND_MODERATION_MATRIX: [Ident, number][] = [
  ["unauthenticated", 401],
  ["missingUser", 401],
  ["member", 403],
  ["coach", 403],
  ["admin", 403],
  ["archivedAdminManager", 403],
  ["adminManagerPrimaryNull", 403], // WAS 200
  ["adminManagerPrimaryRecordId", 403], // WAS 200
  ["adminManagerSecondGym", 403], // WAS 200
  ["archivedPlatformOperator", 403], // fails closed
  ["platformOperator", 200], // the only allowed identity
];

describe("PLATFORM BOUNDARY 5 — authorization matrix (only platform_operator passes; no tenant role, gym or gymId can)", () => {
  describe.each(FINANCE_AND_MODERATION_MATRIX)("finance.view / gyms.moderate — %s", (ident, expected) => {
    it(`POST /api/staff/finance/ledger/delete -> ${expected}`, async () => {
      const res = await ledgerDelete(cookieForIdent(ident), { id: "led-sc" });
      expect(res.status).toBe(expected);
      expect(store.ledger.some((e) => e.id === "led-sc")).toBe(expected !== 200);
    });

    it(`POST /api/staff/finance/ledger (overwrite) -> ${expected}`, async () => {
      const res = await ledgerPost(cookieForIdent(ident), { id: "led-sc", kind: "expense", expenseType: "misc", status: "cleared", date: NOW_ISO, grossAmountCents: 1 });
      expect(res.status).toBe(expected);
      expect(store.ledger.find((e) => e.id === "led-sc")!.grossAmountCents).toBe(expected === 200 ? 1 : 120000);
    });

    it(`POST /api/staff/settings/finance -> ${expected}`, async () => {
      const res = await financeSettings(cookieForIdent(ident), { taxRatePercent: 1, cashPositionAnchorCents: null, cashPositionAnchorDate: null });
      expect(res.status).toBe(expected);
      expect(store.settings.taxRatePercent).toBe(expected === 200 ? 1 : 23);
    });

    it(`POST /api/staff/gyms/[gymId]/status (targeting a different gym) -> ${expected}`, async () => {
      const res = await gymStatus(cookieForIdent(ident), SECOND_GYM.id, { status: "suspended" });
      expect(res.status).toBe(expected);
      expect(store.gyms.find((g) => g.id === SECOND_GYM.id)!.status).toBe(expected === 200 ? "suspended" : "active");
    });
  });

  const CRON_MATRIX: [Ident, number][] = [
    ["unauthenticated", 401],
    ["missingUser", 401],
    ["member", 401],
    ["coach", 401],
    ["admin", 401], // WAS 200
    ["archivedAdminManager", 401],
    ["adminManagerPrimaryNull", 401], // WAS 200
    ["adminManagerPrimaryRecordId", 401], // WAS 200
    ["adminManagerSecondGym", 401], // WAS 200
    ["archivedPlatformOperator", 401],
    ["platformOperator", 200],
  ];
  it.each(CRON_MATRIX)("GET /api/cron/run — %s -> %i", async (ident, expected) => {
    const res = await cron("GET", cookieForIdent(ident));
    expect(res.status).toBe(expected);
    expect(runAllJobs).toHaveBeenCalledTimes(expected === 200 ? 1 : 0);
  });

  it("the Finance page renders only for a platform_operator; every other identity is redirected", async () => {
    const outcome = (ident: Ident) => financesOutcome(cookieForIdent(ident));
    expect(await outcome("unauthenticated")).toBe("REDIRECT:/dashboard");
    expect(await outcome("missingUser")).toBe("REDIRECT:/dashboard");
    expect(await outcome("member")).toBe("REDIRECT:/dashboard");
    expect(await outcome("archivedAdminManager")).toBe("REDIRECT:/dashboard");
    expect(await outcome("archivedPlatformOperator")).toBe("REDIRECT:/dashboard");
    for (const ident of ["coach", "admin", "adminManagerPrimaryNull", "adminManagerPrimaryRecordId", "adminManagerSecondGym"] as const) {
      expect(await outcome(ident)).toBe("REDIRECT:/staff/classes"); // WAS "rendered" for every admin_manager
    }
    expect(await outcome("platformOperator")).toBe("rendered");
  });

  it("a tenant admin_manager still reaches the Business snapshot's same-gym membership/class sections but never its revenue", async () => {
    for (const ident of ["adminManagerPrimaryNull", "adminManagerSecondGym"] as const) {
      const res = await mobileBusiness(cookieForIdent(ident));
      const { data } = await res.json();
      expect(res.status).toBe(200);
      expect(data.revenue).toBeNull();
      expect(data.membership).not.toBeNull();
    }
    expect((await mobileBusiness(cookieForIdent("coach"))).status).toBe(403);
  });
});
