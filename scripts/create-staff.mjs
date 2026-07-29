// Create a new elevated (staff) account — the safe, repeatable way.
//
//   npm run create:staff -- --email new@domain.com --password '...' [--name 'Full Name'] [--role admin_manager]
//
// Elevated roles are hierarchical: coach < admin < admin_manager (see
// lib/permissions.ts). --role defaults to admin_manager (the top role, able to
// manage other staff). Prefer creating further staff from the in-app Staff
// users page once one admin_manager exists.
//
// Password hashing MIRRORS lib/password.ts hashPassword() exactly (scrypt,
// 16-byte hex salt, 64-byte key, stored as "salt:hash"). Keep in sync with
// lib/password.ts if that ever changes.
//
// Non-destructive except for adding one user (+ a minimal profile). Backs up
// data/db.json before writing. Never prints the password. Set GYM_DB_PATH to
// target a different db file (used by tests).

import { readFileSync, writeFileSync, copyFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { randomUUID, randomBytes, scryptSync } from "crypto";

const DB_PATH = process.env.GYM_DB_PATH ?? fileURLToPath(new URL("../data/db.json", import.meta.url));

// ── Mirrors lib/password.ts hashPassword() — keep in sync ──
function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

const ROLES = ["coach", "admin", "admin_manager"];

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--email") out.email = argv[++i];
    else if (a === "--password") out.password = argv[++i];
    else if (a === "--name") out.name = argv[++i];
    else if (a === "--role") out.role = argv[++i];
  }
  return out;
}

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

const args = parseArgs(process.argv.slice(2));

const email = (args.email ?? "").trim().toLowerCase();
const password = args.password ?? "";
const fullName = (args.name ?? "").trim() || email.split("@")[0];
const role = (args.role ?? "admin_manager").trim();

if (!email) fail("--email is required. Usage: npm run create:staff -- --email x@y.com --password '...'");
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(`"${email}" is not a valid email address.`);
if (!password || password.length < 8) fail("--password is required and must be at least 8 characters.");
if (!ROLES.includes(role)) fail(`--role must be one of: ${ROLES.join(", ")} (got "${role}").`);

if (!existsSync(DB_PATH)) fail(`Database not found at ${DB_PATH}. Start the app once (or seed) to create it.`);

const db = JSON.parse(readFileSync(DB_PATH, "utf8"));
db.users ??= [];
db.profiles ??= [];

if (db.users.some((u) => (u.email ?? "").toLowerCase() === email)) {
  fail(`An account with email "${email}" already exists. Choose a different email.`);
}

// Back up before writing.
const backup = `${DB_PATH}.bak-${Date.now()}`;
copyFileSync(DB_PATH, backup);

const now = new Date().toISOString();
const id = randomUUID();

db.users.push({
  id,
  email,
  role, // coach | admin | admin_manager (see lib/permissions.ts)
  archivedAt: null,
  createdAt: now,
  updatedAt: now,
  passwordHash: hashPassword(password),
});

// A minimal profile mirrors the existing coach account so the Profile page and
// avatar/initials render without a "couldn't load profile" message. Staff
// features (/staff/*) don't require it, but this keeps the account consistent.
db.profiles.push({
  userId: id,
  fullName,
  email,
  phone: "",
  dateOfBirth: null,
  gender: "Other",
  primaryGoal: "General Health",
  sportPlayed: null,
  currentWeightKg: null,
  additionalInfo: null,
  cycleTrackingEligible: false,
  cycleTrackingEnabled: false,
  menopauseSupportEnabled: false,
  reminderTimingsMins: null,
  emailNotificationsEnabled: true,
  pushNotificationsEnabled: false,
  preferredUnits: "metric",
  programmeEnabled: false,
  onboardingCompleted: true,
  createdAt: now,
  updatedAt: now,
});

writeFileSync(DB_PATH, JSON.stringify(db, null, 2), "utf8");

console.log(`✓ Created staff account`);
console.log(`  email: ${email}`);
console.log(`  role:  ${role}`);
console.log(`  id:    ${id}`);
console.log(`  (password not shown — hashed with scrypt)`);
console.log(`  backup written: ${backup}`);
