// Promote ONE existing staff account to the platform_operator role — the only
// way that role is ever granted (no route, signup or UI can assign it).
//
//   npm run promote:platform-operator -- --user-id <id>
//   npm run promote:platform-operator -- --email someone@domain.com
//   npm run promote:platform-operator -- --user-id <id> --confirm
//
// platform_operator (see lib/permissions.ts) alone may moderate gyms, use the
// platform-wide Finance ledger, and trigger platform jobs from a session. It is
// never implied by a tenant role or by gymId: null, so this script needs an
// EXPLICIT target and never picks one for you.
//
// Safety:
//  - Dry run by default; nothing is written without --confirm.
//  - Exactly one of --user-id / --email is required. No hardcoded identity.
//  - Fails clearly if the user is missing, ambiguous (several accounts match),
//    archived, or not an existing staff account (coach/admin/admin_manager).
//  - Idempotent: an existing operator is left unchanged.
//  - Backs up the db file to <db>.bak-<ts> before writing; changes only that
//    one user's `role` (and updatedAt). Never prints password hashes.
// Set GYM_DB_PATH to target a different db file (used by tests). Do NOT point
// this at production data except deliberately, from the deployed host.

import { readFileSync, writeFileSync, copyFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";

const DB_PATH = process.env.GYM_DB_PATH ?? fileURLToPath(new URL("../data/db.json", import.meta.url));

// Keep in sync with lib/permissions.ts (plain .mjs cannot import the .ts module).
const OPERATOR_ROLE = "platform_operator";
const PROMOTABLE_ROLES = new Set(["coach", "admin", "admin_manager", "staff"]);

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

function parseArgs(argv) {
  const out = { confirm: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--user-id") out.userId = argv[++i];
    else if (a === "--email") out.email = argv[++i];
    else if (a === "--confirm") out.confirm = true;
    else fail(`Unknown argument "${a}".`);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const userId = (args.userId ?? "").trim();
const email = (args.email ?? "").trim().toLowerCase();

if ((userId ? 1 : 0) + (email ? 1 : 0) !== 1) {
  fail("Provide exactly one of --user-id <id> or --email <email>. No account is ever chosen automatically.");
}
if (!existsSync(DB_PATH)) fail(`Database not found at ${DB_PATH}.`);

const db = JSON.parse(readFileSync(DB_PATH, "utf8"));
const users = db.users ?? [];
const matches = userId
  ? users.filter((u) => u.id === userId)
  : users.filter((u) => (u.email ?? "").trim().toLowerCase() === email);

if (matches.length === 0) fail(`No account matches ${userId ? `id "${userId}"` : `email "${email}"`}.`);
if (matches.length > 1) fail(`${matches.length} accounts match ${userId ? `id "${userId}"` : `email "${email}"`} — refusing to guess. Use a unique --user-id.`);

const target = matches[0];
if (target.archivedAt) fail(`Account ${target.id} is archived. Reactivate it first; an archived account is never promoted.`);
if (target.role === OPERATOR_ROLE) {
  console.log(`\n${target.id} is already a ${OPERATOR_ROLE}. Nothing to do.\n`);
  process.exit(0);
}
if (!PROMOTABLE_ROLES.has(target.role)) {
  fail(`Account ${target.id} has role "${target.role ?? "member"}". Only an existing staff account (coach, admin, admin_manager) can be promoted.`);
}

console.log(`\nPromote to ${OPERATOR_ROLE} — ${args.confirm ? "APPLYING" : "DRY RUN"}\n`);
console.log(`  account : ${target.id} (${target.email})`);
console.log(`  role    : ${target.role} -> ${OPERATOR_ROLE}`);
console.log(`  gymId   : ${target.gymId ?? "null (primary gym)"} — unchanged; this does not grant gym membership or cross-gym data access`);

if (!args.confirm) {
  console.log(`\nNothing written. Re-run with --confirm to apply.\n`);
  process.exit(0);
}

const backup = `${DB_PATH}.bak-${Date.now()}`;
copyFileSync(DB_PATH, backup);

target.role = OPERATOR_ROLE;
target.updatedAt = new Date().toISOString();
writeFileSync(DB_PATH, JSON.stringify(db, null, 2));

console.log(`\n✓ Promoted ${target.id}.`);
console.log(`  Backup written: ${backup}\n`);
