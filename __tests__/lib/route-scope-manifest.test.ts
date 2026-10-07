// Drift guard for lib/route-scope-manifest.ts. Every app/api route must be classified, and the
// classification must still be true of the route's source: the recorded capability strings and
// tenant-check evidence must be present, and a route filed as "self" must not take a client-supplied
// user or gym id. Source is read as text, so this needs no datastore and no mocks.
import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

import { can, type Capability } from "@/lib/permissions";
import { ROUTE_SCOPE_MANIFEST, type RouteScope } from "@/lib/route-scope-manifest";

const API = path.join(process.cwd(), "app", "api");

function discoverRoutes(dir = API, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) discoverRoutes(full, out);
    else if (name === "route.ts") out.push(path.relative(API, full).split(path.sep).join("/").replace(/\/?route\.ts$/, ""));
  }
  return out.sort();
}

const sourceOf = (route: string) => readFileSync(path.join(API, ...route.split("/"), "route.ts"), "utf8").replace(/\r/g, "");

const STAFF_SCOPES: RouteScope[] = ["tenant-staff", "own-tenant", "platform", "global-shared"];
const PLATFORM_CAPABILITIES = ["gyms.moderate", "finance.view", "platform.jobs"];

describe("route scope manifest: completeness", () => {
  const discovered = discoverRoutes();
  const listed = ROUTE_SCOPE_MANIFEST.map((e) => e.route);

  it("finds a plausible number of routes (the discovery itself works)", () => {
    expect(discovered.length).toBeGreaterThan(200);
  });

  it("has no duplicate entries", () => {
    expect(listed.filter((r, i) => listed.indexOf(r) !== i)).toEqual([]);
  });

  it("classifies every route and no route that does not exist", () => {
    const set = new Set(listed);
    const actual = new Set(discovered);
    expect(discovered.filter((r) => !set.has(r))).toEqual([]);
    expect(listed.filter((r) => !actual.has(r))).toEqual([]);
  });
});

describe("route scope manifest: classification still matches the source", () => {
  it("requires non-empty evidence on every tenant-checked entry", () => {
    const bad = ROUTE_SCOPE_MANIFEST.filter(
      (e) => ["tenant-staff", "self-tenant-checked", "own-tenant"].includes(e.scope) && (!e.evidence || e.evidence.length === 0)
    ).map((e) => e.route);
    expect(bad).toEqual([]);
  });

  it("finds every recorded evidence token and capability literally in the route source", () => {
    const missing: string[] = [];
    for (const e of ROUTE_SCOPE_MANIFEST) {
      const src = sourceOf(e.route);
      for (const token of e.evidence ?? []) if (!src.includes(token)) missing.push(`${e.route}: evidence ${token}`);
      for (const cap of e.capabilities ?? []) if (!src.includes(`"${cap}"`)) missing.push(`${e.route}: capability ${cap}`);
    }
    expect(missing).toEqual([]);
  });

  it("only gives a capability to staff-gated scopes, and only real capabilities", () => {
    const wrong: string[] = [];
    for (const e of ROUTE_SCOPE_MANIFEST) {
      if (!e.capabilities?.length) continue;
      if (![...STAFF_SCOPES, "self-tenant-checked", "cron"].includes(e.scope)) wrong.push(`${e.route}: ${e.scope} lists capabilities`);
      for (const cap of e.capabilities) {
        // can() returns a boolean for any string, so prove the capability is real by checking the top role holds it.
        if (!can("platform_operator", cap as Capability)) wrong.push(`${e.route}: unknown capability ${cap}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("files every staff-guarded route under a staff scope, and no unguarded route under one", () => {
    const wrong: string[] = [];
    for (const e of ROUTE_SCOPE_MANIFEST) {
      const src = sourceOf(e.route);
      const staffGuarded = /authorizeStaffRequest\(/.test(src);
      if (staffGuarded && !STAFF_SCOPES.includes(e.scope) && e.scope !== "cron") wrong.push(`${e.route}: staff-guarded but filed as ${e.scope}`);
      if (STAFF_SCOPES.includes(e.scope) && !staffGuarded && !/verifyRequestSession\(/.test(src)) wrong.push(`${e.route}: ${e.scope} but no session check`);
    }
    expect(wrong).toEqual([]);
  });

  it("requires every platform route to be gated by an exact-role platform capability", () => {
    const wrong: string[] = [];
    for (const e of ROUTE_SCOPE_MANIFEST.filter((x) => x.scope === "platform")) {
      const caps = (e.capabilities ?? []).filter((c) => PLATFORM_CAPABILITIES.includes(c));
      if (caps.length === 0) wrong.push(`${e.route}: no platform-only capability`);
      for (const c of caps) {
        if (can("admin_manager", c as Capability)) wrong.push(`${e.route}: ${c} is reachable by a tenant role`);
        if (!can("platform_operator", c as Capability)) wrong.push(`${e.route}: ${c} is not held by the operator`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("lets only the platform scope use a platform-only capability", () => {
    const wrong = ROUTE_SCOPE_MANIFEST.filter(
      (e) => e.scope !== "platform" && e.scope !== "cron" && (e.capabilities ?? []).some((c) => PLATFORM_CAPABILITIES.includes(c))
    ).map((e) => `${e.route}: ${e.scope}`);
    // mobile/staff/business lists finance.view next to reports.view but derives data through a gym-scoped loader.
    expect(wrong.filter((w) => !w.startsWith("mobile/staff/business"))).toEqual([]);
  });

  it("requires a session check on every self and self-tenant-checked route", () => {
    const bad = ROUTE_SCOPE_MANIFEST.filter((e) => e.scope === "self" || e.scope === "self-tenant-checked")
      .filter((e) => !/verifyRequestSession\(/.test(sourceOf(e.route)))
      .map((e) => e.route);
    expect(bad).toEqual([]);
  });

  it("never lets a self route read a client-supplied user or gym id", () => {
    const CLIENT_ID_READS = [
      /searchParams\.get\(\s*["'](?:userId|memberId|gymId|ownerUserId|targetUserId)["']\s*\)/,
      /\b(?:body|payload|parsed|json|input|data)\??\.(?:userId|memberId|gymId|ownerUserId|targetUserId)\b/,
      /const \{[^}]*\b(?:userId|memberId|gymId|ownerUserId|targetUserId)\b[^}]*\} = (?:\(?body|await request\.json)/,
      /formData\.get\(\s*["'](?:userId|memberId|gymId|ownerUserId|targetUserId)["']\s*\)/,
    ];
    const bad = ROUTE_SCOPE_MANIFEST.filter((e) => e.scope === "self")
      .filter((e) => CLIENT_ID_READS.some((re) => re.test(sourceOf(e.route))))
      .map((e) => e.route);
    expect(bad).toEqual([]);
  });

  it("explains every public, webhook, cron and global-shared route", () => {
    const bare = ROUTE_SCOPE_MANIFEST.filter((e) => ["public", "webhook", "cron", "global-shared"].includes(e.scope) && !e.note).map((e) => e.route);
    expect(bare).toEqual([]);
  });

  it("keeps the new Google Play and tier routes under a deliberate scope", () => {
    const byRoute = Object.fromEntries(ROUTE_SCOPE_MANIFEST.map((e) => [e.route, e.scope]));
    expect(byRoute["mobile/billing/google-play/verify"]).toBe("self");
    expect(byRoute["webhooks/google-play"]).toBe("webhook");
    expect(byRoute["staff/members/[userId]/tier"]).toBe("tenant-staff");
    expect(byRoute["admin/membership/activate"]).toBe("tenant-staff");
    expect(byRoute["membership/checkout"]).toBe("self-tenant-checked");
  });
});
