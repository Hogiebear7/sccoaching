/* eslint-disable @typescript-eslint/no-require-imports -- a CommonJS audit script run directly with node */
// Static, heuristic audit: which functions read the datastore, then `await` something, then write the datastore. Those are check-then-act sequences that a
// file lock cannot make atomic (the lock is held for one synchronous turn). They are not new: they already race between two requests in ONE process.
// Run from the repository root:  node audit-await-gaps.cjs
const fs = require("fs");
const path = require("path");

const dbSrc = fs.readFileSync("lib/db.ts", "utf8");
const exported = [...dbSrc.matchAll(/^export (?:async )?function (\w+)/gm)].map((m) => m[1]);
const WRITE = /^(save|create|update|delete|append|set|record|claim|complete|mark|add|remove|follow|unfollow|archive|restore|purge|reset|toggle|insert|upsert|expire|cancel|apply|grant|bulk|clear|rename|resolve|finish|use|credit|debit|log|reject|accept|redeem|revoke|merge|move|replace|put)/i;
const writes = new Set(exported.filter((n) => WRITE.test(n)));
const reads = new Set(exported.filter((n) => !WRITE.test(n)));

const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (["node_modules", ".next", "__tests__", ".git"].includes(e.name)) continue;
      walk(p);
    } else if (/\.(ts|tsx)$/.test(e.name) && p !== path.join("lib", "db.ts")) files.push(p);
  }
})(".");

const targets = files.filter((f) => /^(app[\\/]api|lib)/.test(f.replace(/^\.[\\/]/, "")));
const hits = [];
for (const f of targets) {
  const src = fs.readFileSync(f, "utf8");
  const parts = src.split(/\n(?=(?:export )?(?:async )?function |export const \w+ = async)/);
  for (const part of parts) {
    const tokens = [];
    for (const m of part.matchAll(/\bawait\b|\b(\w+)\(/g)) {
      if (m[0] === "await") tokens.push("A");
      else if (writes.has(m[1])) tokens.push("W");
      else if (reads.has(m[1])) tokens.push("R");
    }
    const s = tokens.join("");
    if (/A.*R.*A.*W/.test(s)) {
      const name = (part.match(/function (\w+)/) || [])[1] || "(anonymous)";
      hits.push({ file: f.replace(/\\/g, "/").replace(/^\.\//, ""), name, reads: (s.match(/R/g) || []).length, awaits: (s.match(/A/g) || []).length, writes: (s.match(/W/g) || []).length });
    }
  }
}
console.log(`db.ts exports: ${exported.length} (writers by name: ${writes.size}, readers: ${reads.size}); files scanned: ${targets.length}`);
console.log(`functions with: await, then a datastore read, then another await, then a datastore write (a read that can go stale before the write): ${hits.length}`);
const by = {};
for (const h of hits) by[h.file.startsWith("app/api") ? "app/api" : "lib"] = (by[h.file.startsWith("app/api") ? "app/api" : "lib"] || 0) + 1;
console.log(JSON.stringify(by));
for (const h of hits) console.log(`${h.file} :: ${h.name}  reads=${h.reads} awaits=${h.awaits} writes=${h.writes}`);
