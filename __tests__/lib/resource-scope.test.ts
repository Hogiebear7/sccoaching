// Drift guard for lib/resource-scope.ts: every datastore collection is classified, every
// classification names an ownership field that really exists, and every module-level cache is
// accounted for. Source files are read as text, so the test needs no datastore and no mocks.
import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

import { COLLECTION_SCOPE, MODULE_CACHE_SCOPE, STATIC_LOOKUP_CONSTANTS } from "@/lib/resource-scope";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8").replace(/\r/g, "");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(path.join(ROOT, dir))) {
    const rel = `${dir}/${name}`;
    if (name === "node_modules" || name.startsWith(".")) continue;
    if (statSync(path.join(ROOT, rel)).isDirectory()) walk(rel, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(rel);
  }
  return out;
}

const dbSource = read("lib/db.ts");
const databaseBody = /\ninterface Database \{([\s\S]*?)\n\}/.exec(dbSource)?.[1] ?? "";
// collection name -> record type name ("StoredUser" for users[]).
const collections = new Map<string, string>(
  [...databaseBody.matchAll(/^  (\w+): ([A-Za-z<>,\s]+?)(\[\])?;/gm)].map((m) => [m[1], m[2].trim()])
);

const libFiles = walk("lib");
const libSources = libFiles.map((f) => read(f));

function interfaceFields(typeName: string): string[] | null {
  for (const src of libSources) {
    const at = src.search(new RegExp(`(?:export )?interface ${typeName}(?:<[^>]*>)?(?: extends [\\w, <>]+)? \\{`));
    if (at < 0) continue;
    const end = src.indexOf("\n}", at);
    return [...src.slice(at, end).matchAll(/^ {2}(\w+)\??:/gm)].map((m) => m[1]);
  }
  return null;
}

describe("COLLECTION_SCOPE", () => {
  it("parses a plausible number of collections from the Database interface", () => {
    expect(collections.size).toBeGreaterThan(60);
    expect(collections.has("users")).toBe(true);
    expect(collections.has("subscriptions")).toBe(true);
  });

  it("classifies every collection and nothing that does not exist", () => {
    const declared = new Set(Object.keys(COLLECTION_SCOPE));
    const actual = new Set(collections.keys());
    expect([...actual].filter((k) => !declared.has(k)).sort()).toEqual([]);
    expect([...declared].filter((k) => !actual.has(k)).sort()).toEqual([]);
  });

  it("names an ownership field that exists on the record for every owner-bearing kind", () => {
    const problems: string[] = [];
    for (const [name, scope] of Object.entries(COLLECTION_SCOPE) as [string, { kind: string; owner?: string }][]) {
      if (!scope.owner) continue;
      let typeName = collections.get(name)!;
      if (typeName === "StoredUser") typeName = "UserRecord";
      const fields = interfaceFields(typeName);
      if (!fields) {
        problems.push(`${name}: record type ${typeName} not found`);
      } else if (!fields.includes(scope.owner)) {
        problems.push(`${name}: ${typeName} has no field ${scope.owner}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("requires a note on every global-shared and platform-only collection", () => {
    const missing = Object.entries(COLLECTION_SCOPE)
      .filter(([, s]) => (s.kind === "global-shared" || s.kind === "platform-only") && !("note" in s && s.note))
      .map(([n]) => n);
    expect(missing).toEqual([]);
  });

  it("keeps the money collections as provenance only, never user-owned access control", () => {
    for (const name of ["paymentEvents", "revenueEvents", "financeLedgerEntries"] as const) {
      expect(COLLECTION_SCOPE[name].kind).toBe("money-provenance");
    }
  });
});

describe("MODULE_CACHE_SCOPE", () => {
  // Module-level mutable holders: `let x = null|undefined|0|[]|{}`-style caches and new Map/Set/WeakMap constants.
  const found: { file: string; symbol: string }[] = [];
  const files = [...libFiles, ...walk("app")];
  for (const file of files) {
    const src = read(file);
    for (const m of src.matchAll(/^let (\w+)(?:: [^=\n]+)? = (?:null|undefined)\s*;/gm)) found.push({ file, symbol: m[1] });
    for (const m of src.matchAll(/^(?:export )?const (\w+)(?:: [^=\n]+)? = new (?:Map|Set|WeakMap|WeakSet)\b/gm)) found.push({ file, symbol: m[1] });
  }

  const known = new Set([
    ...MODULE_CACHE_SCOPE.map((c) => `${c.file}#${c.symbol}`),
    ...STATIC_LOOKUP_CONSTANTS.map((c) => `${c.file}#${c.symbol}`),
    // Static literal lookup tables outside lib/, same rule as STATIC_LOOKUP_CONSTANTS.
    "app/(dashboard)/dashboard/nutrition/page.tsx#DIET_LABEL",
    "app/api/staff/members/[userId]/ai-usage/route.ts#VALID_RANGES",
  ]);

  it("finds the caches the registry already knows about (the scan itself works)", () => {
    const keys = new Set(found.map((f) => `${f.file}#${f.symbol}`));
    expect(keys.has("lib/rate-limit.ts#buckets")).toBe(true);
    expect(keys.has("lib/providers/google-play.ts#cachedToken")).toBe(true);
  });

  it("accounts for every module-level cache or lookup constant", () => {
    const unclassified = found.filter((f) => !known.has(`${f.file}#${f.symbol}`)).map((f) => `${f.file}#${f.symbol}`);
    expect(unclassified).toEqual([]);
  });

  it("registers only caches that still exist", () => {
    const keys = new Set(found.map((f) => `${f.file}#${f.symbol}`));
    const stale = MODULE_CACHE_SCOPE.filter((c) => !keys.has(`${c.file}#${c.symbol}`)).map((c) => `${c.file}#${c.symbol}`);
    expect(stale).toEqual([]);
  });

  it("only allows keyed caches that name how the key is built", () => {
    for (const c of MODULE_CACHE_SCOPE) {
      if (c.cacheClass === "keyed") expect(c.note.toLowerCase()).toMatch(/key/);
    }
  });
});
