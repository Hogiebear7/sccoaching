// Generates a small, clearly fake, TWO-GYM datastore for isolated staging and test validation. It is a separate tool from
// scripts/seed.js (which is unchanged): that one builds the public single-gym demo with a documented shared password, and must never
// be used on a reachable server. This one has no password in it.
//
//   GYM_DB_PATH=/path/to/staging/db.json node scripts/seed-staging-fixtures.mjs --credentials-out /path/outside/repo/creds.json
//   ... --dry-run     report what would happen; write nothing (no datastore, no credentials file)
//   ... --reset       replace an existing FIXTURE datastore (one whose every user is @example.test); a backup is kept
//   npm run seed:staging-fixtures -- --credentials-out /path/outside/repo/creds.json
//
// Safety, all enforced before anything is written:
//   - GYM_DB_PATH is REQUIRED. There is no DATA_DIR or default fallback, so a forgotten variable can never pick a datastore.
//   - The target must be a .json file, not a directory, and not the repository's data/ folder (data/db.json or anything inside it).
//   - The credentials file must be outside the repository, must not already exist, and must not be the datastore.
//   - An existing target is refused unless --reset, and --reset only replaces a datastore made entirely of @example.test users.
//
// Credentials: each account gets a fresh random password at run time. Passwords are written ONLY to --credentials-out (created
// exclusive, owner-only permissions on POSIX) and are never printed, logged or stored in the datastore (only the scrypt hash is,
// in the same salt:hash format as lib/password.ts). Hand that file to the operator out of band and delete it afterwards.
//
// Data: gym #1 (the primary gym, users with gymId null, slug as lib/primary-gym.ts) and a second gym, each with staff and a member,
// a no-charge manual plan, classes, and for one member a programme, recovery logs, bookings and a coach message. Every email is
// @example.test and every name starts "Fixture". No payment, purchase, provider, webhook or IAP record is created.

import { randomBytes, randomInt, randomUUID, scryptSync } from "node:crypto";
import { copyFileSync, existsSync, readFileSync, realpathSync, statSync, unlinkSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const FIXTURE_EMAIL_DOMAIN = "@example.test";
// Same value as lib/primary-gym.ts's PRIMARY_GYM_SLUG (duplicated, as the other scripts here do).
const PRIMARY_GYM_SLUG = "sc-performance-coaching";

export class RefusalError extends Error {}

// --- Paths ------------------------------------------------------------------------------------------------

function realish(p) {
  // The real location of the deepest part of the path that exists, so a symlink cannot hide the repository.
  let probe = path.resolve(p);
  const tail = [];
  while (!existsSync(probe)) {
    const parent = path.dirname(probe);
    if (parent === probe) return path.resolve(p);
    tail.unshift(path.basename(probe));
    probe = parent;
  }
  return path.join(realpathSync(probe), ...tail);
}

function isInside(child, parent) {
  const rel = path.relative(realish(parent), realish(child));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

export function parseArgs(argv) {
  const out = { dryRun: false, reset: false, credentialsOut: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") out.dryRun = true;
    else if (a === "--reset") out.reset = true;
    else if (a === "--credentials-out") out.credentialsOut = argv[++i] ?? "";
    else if (a.startsWith("--credentials-out=")) out.credentialsOut = a.slice("--credentials-out=".length);
    else throw new RefusalError(`Unknown argument: ${a}`);
  }
  return out;
}

/** Validates the datastore target and credentials file. Returns { dbPath, credentialsPath } or throws RefusalError. */
export function resolveTargets(env, args, repoRoot = REPO_ROOT) {
  const raw = env.GYM_DB_PATH && env.GYM_DB_PATH.trim();
  if (!raw) throw new RefusalError("GYM_DB_PATH is required. Set it to the staging datastore file; there is no default and no DATA_DIR fallback.");

  const dbPath = path.resolve(raw);
  if (path.extname(dbPath).toLowerCase() !== ".json") throw new RefusalError(`Refusing ${dbPath}: the target must be a .json file.`);
  // The repository data folder is checked by path alone first, so a refused target there is never even looked at on disk.
  const repoData = path.join(repoRoot, "data");
  const lexicalRel = path.relative(path.resolve(repoData), dbPath);
  const insideRepoData = (rel) => rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
  const refuseRepoData = () => new RefusalError(`Refusing ${dbPath}: it is inside the repository data folder. Fixtures must never be written next to real or local app data.`);
  if (insideRepoData(lexicalRel)) throw refuseRepoData();
  // Then again by real location, so a symlink or junction pointing into the repository data folder cannot get past the first check.
  if (isInside(dbPath, repoData)) throw refuseRepoData();
  if (existsSync(dbPath) && statSync(dbPath).isDirectory()) throw new RefusalError(`Refusing ${dbPath}: it is a directory.`);

  let credentialsPath = null;
  if (args.credentialsOut !== null || !args.dryRun) {
    if (!args.credentialsOut) throw new RefusalError("--credentials-out <file> is required (a path OUTSIDE the repository; passwords are written there and nowhere else).");
    credentialsPath = path.resolve(args.credentialsOut);
    if (isInside(credentialsPath, repoRoot)) throw new RefusalError("Refusing --credentials-out: it is inside the repository, where it could be committed.");
    if (credentialsPath === dbPath) throw new RefusalError("--credentials-out must not be the datastore file.");
    if (existsSync(credentialsPath)) throw new RefusalError(`Refusing --credentials-out ${credentialsPath}: it already exists. Choose a new file; it is never overwritten.`);
    if (!existsSync(path.dirname(credentialsPath))) throw new RefusalError(`The folder for --credentials-out does not exist: ${path.dirname(credentialsPath)}`);
  }
  return { dbPath, credentialsPath };
}

/** Is this existing file a fixture datastore (every user @example.test)? Only such a file may be replaced by --reset. */
export function looksLikeFixtureDatastore(file) {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    const users = Array.isArray(parsed.users) ? parsed.users : [];
    return users.length > 0 && users.every((u) => typeof u.email === "string" && u.email.toLowerCase().endsWith(FIXTURE_EMAIL_DOMAIN));
  } catch {
    return false;
  }
}

// --- Credentials ------------------------------------------------------------------------------------------

const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const LOWER = "abcdefghijkmnopqrstuvwxyz";
const DIGIT = "23456789";
const SYMBOL = "!@#$%^&*-_=+";

/** A random 24-character password meeting lib/password.ts's strength rules (upper, lower, digit, special). */
export function generatePassword() {
  const pick = (set) => set[randomInt(set.length)];
  const chars = [pick(UPPER), pick(LOWER), pick(DIGIT), pick(SYMBOL)];
  const all = UPPER + LOWER + DIGIT + SYMBOL;
  while (chars.length < 24) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

// Same format as lib/password.ts's hashPassword(): "<salt hex>:<scrypt hash hex>", 64-byte key.
function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}

// Mirrors lib/recovery.ts's computeReadinessScore() (the other scripts here duplicate it too).
function computeReadinessScore({ sleepHours, sleepQuality, soreness, fatigue }) {
  const clamp = (v, min, max) => Math.min(Math.max(v, min), max);
  return Math.round(
    (clamp(sleepHours, 0, 8) / 8) * 25 + (clamp(sleepQuality - 1, 0, 4) / 4) * 25 + (clamp(5 - soreness, 0, 4) / 4) * 25 + (clamp(5 - fatigue, 0, 4) / 4) * 25
  );
}

// --- Data -------------------------------------------------------------------------------------------------

/** Builds the datastore object and the account list (WITH passwords, for the credentials file only). */
export function buildFixtures(nowDate = new Date()) {
  const iso = (d) => d.toISOString();
  const now = iso(nowDate);
  const daysFromNow = (n) => iso(new Date(nowDate.getTime() + n * 86400000));
  const dateStr = (n) => daysFromNow(n).slice(0, 10);

  const accounts = [];
  function makeUser(key, role, gym, fullName, gymId) {
    const password = generatePassword();
    const user = { id: randomUUID(), email: `fixture-${key}${FIXTURE_EMAIL_DOMAIN}`, role, createdAt: now, updatedAt: now, passwordHash: hashPassword(password) };
    if (gymId !== null) user.gymId = gymId;
    accounts.push({ email: user.email, role, gym, password });
    return { user, fullName };
  }

  const gymB = { id: randomUUID() };
  const p = { admin: makeUser("admin", "admin_manager", "primary", "Fixture Admin", null), coach: makeUser("coach", "coach", "primary", "Fixture Coach", null),
    m1: makeUser("member-a1", "member", "primary", "Fixture Member A1", null), m2: makeUser("member-a2", "member", "primary", "Fixture Member A2", null) };
  const b = { admin: makeUser("gymb-admin", "admin_manager", "second", "Fixture Gym B Admin", gymB.id), member: makeUser("gymb-member", "member", "second", "Fixture Gym B Member", gymB.id) };
  const all = [p.admin, p.coach, p.m1, p.m2, b.admin, b.member];

  const profiles = all.map(({ user, fullName }) => ({
    userId: user.id, fullName, email: user.email, phone: "+000 000 0000", gender: "Other", primaryGoal: "General Health", sportPlayed: null,
    currentWeightKg: null, additionalInfo: null, cycleTrackingEligible: false, cycleTrackingEnabled: false, onboardingCompleted: true,
    programmeEnabled: user.id === p.m1.user.id, createdAt: now, updatedAt: now,
  }));

  const gyms = [
    { id: randomUUID(), slug: PRIMARY_GYM_SLUG, name: "Fixture Primary Gym", tagline: "TEST/STAGING FIXTURE", description: "Test/staging fixture gym. Fake data; safe to delete.",
      ownerUserId: p.admin.user.id, contactEmail: `fixture-primary-gym${FIXTURE_EMAIL_DOMAIN}`, contactPhone: null, addressLine: "1 Fixture Street, Testville", latitude: 53.0, longitude: -6.0,
      status: "active", createdAt: now, updatedAt: now },
    { id: gymB.id, slug: "fixture-second-gym", name: "Fixture Second Gym", tagline: "TEST/STAGING FIXTURE", description: "Test/staging fixture gym. Fake data; safe to delete.",
      ownerUserId: b.admin.user.id, contactEmail: `fixture-second-gym${FIXTURE_EMAIL_DOMAIN}`, contactPhone: null, addressLine: "2 Fixture Street, Testville", latitude: 53.2, longitude: -6.2,
      status: "active", createdAt: now, updatedAt: now },
  ];

  // A no-charge manual catalog per gym: enough for plan status and class booking, with no price and no provider reference.
  const membershipCategories = [];
  const membershipPackages = [];
  const membershipBillingOptions = [];
  const subscriptions = [];
  function plan(gymId, label, member) {
    const category = { id: randomUUID(), gymId, name: `Fixture ${label} Plans`, slug: `fixture-${label.toLowerCase()}-plans`, description: "Fixture catalog (no charge).", sortOrder: 0, visible: true, createdAt: now, updatedAt: now };
    const pkg = { id: randomUUID(), categoryId: category.id, name: `Fixture ${label} Plan`, slug: `fixture-${label.toLowerCase()}-plan`, shortDescription: "Fixture plan (no charge).", fullDescription: null,
      packageType: "membership", sessionAllowanceType: "unlimited", sessionAllowanceCount: null, eligibleClassTypes: ["general", "strength", "cardio"], visible: true, sortOrder: 0, stripeProductId: null, createdAt: now, updatedAt: now };
    const option = { id: randomUUID(), packageId: pkg.id, name: "Fixture (no charge)", billingType: "recurring", intervalUnit: "month", intervalCount: 1, amountCents: 0, currency: "eur", visible: true, sortOrder: 0, stripePriceId: null, createdAt: now, updatedAt: now };
    membershipCategories.push(category); membershipPackages.push(pkg); membershipBillingOptions.push(option);
    subscriptions.push({ userId: member.user.id, packageId: pkg.id, billingOptionId: option.id, status: "active", provider: "none", providerCustomerId: null, providerSubscriptionId: null,
      currentPeriodEnd: dateStr(25), lastWebhookEventAt: null, sessionsUsedThisPeriod: 0, periodLapsedNotifiedAt: null, ownerGym: { scope: "gym", gymId }, createdAt: now, updatedAt: now });
  }
  plan(null, "Primary", p.m1);
  plan(gymB.id, "Second", b.member);

  const cls = (title, category, coach, gymId, day, time, capacity) => ({ id: randomUUID(), title, category, coachUserId: coach.user.id, gymId, date: dateStr(day), startTime: time, durationMins: 60, capacity, createdAt: now, updatedAt: now });
  const upcoming1 = cls("Fixture Strength", "strength", p.coach, null, 1, "07:00", 10);
  const upcoming2 = cls("Fixture Conditioning", "cardio", p.coach, null, 2, "18:00", 10);
  const past = cls("Fixture Past Session", "strength", p.coach, null, -5, "09:00", 10);
  const gymBClass = cls("Fixture Second Gym Class", "general", b.admin, gymB.id, 1, "08:00", 10);
  const classes = [upcoming1, upcoming2, past, gymBClass];
  const bookings = [
    { id: randomUUID(), classId: upcoming1.id, userId: p.m1.user.id, attendedAt: null, createdAt: now },
    { id: randomUUID(), classId: past.id, userId: p.m1.user.id, attendedAt: daysFromNow(-5), createdAt: daysFromNow(-8) },
    { id: randomUUID(), classId: gymBClass.id, userId: b.member.user.id, attendedAt: null, createdAt: now },
  ];

  const programmes = [{ id: randomUUID(), userId: p.m1.user.id, title: "Fixture Programme", phase: "Base", focus: "General strength", status: "active", startDate: dateStr(-7), currentWeek: 2, totalWeeks: 8, notes: null, createdAt: now, updatedAt: now }];

  const recoveryLogs = [
    { daysAgo: 2, sleepHours: 7, sleepQuality: 4, soreness: 2, fatigue: 2, goal: "Fixture check-in" },
    { daysAgo: 1, sleepHours: 6, sleepQuality: 3, soreness: 3, fatigue: 3, goal: "Fixture check-in" },
    { daysAgo: 0, sleepHours: 8, sleepQuality: 5, soreness: 1, fatigue: 1, goal: "Fixture check-in" },
  ].map((d) => ({ id: randomUUID(), userId: p.m1.user.id, date: dateStr(-d.daysAgo), sleepHours: d.sleepHours, sleepQuality: d.sleepQuality, soreness: d.soreness, fatigue: d.fatigue,
    trainingDurationMins: null, rpe: null, goal: d.goal, notes: null, readinessScore: computeReadinessScore(d), createdAt: daysFromNow(-d.daysAgo), updatedAt: daysFromNow(-d.daysAgo) }));

  const messages = [
    { id: randomUUID(), memberId: p.m1.user.id, senderId: p.m1.user.id, senderRole: "member", body: "Fixture message: is the strength class still on?", readAt: null, createdAt: daysFromNow(-1) },
    { id: randomUUID(), memberId: p.m1.user.id, senderId: p.coach.user.id, senderRole: "staff", body: "Fixture reply: yes, see you there.", readAt: null, createdAt: daysFromNow(-1) },
  ];

  const db = {
    gyms, users: all.map((x) => x.user), profiles, resetTokens: [], programmes, workoutSessions: [], classes, bookings, membershipCategories, membershipPackages,
    membershipBillingOptions, subscriptions, recoveryLogs, messages, waitlistEntries: [], jobRuns: [],
  };
  return { db, accounts };
}

// --- Main -------------------------------------------------------------------------------------------------

function main(argv, env) {
  const args = parseArgs(argv);
  const { dbPath, credentialsPath } = resolveTargets(env, args);

  const exists = existsSync(dbPath);
  if (exists && !args.reset) throw new RefusalError(`Refusing ${dbPath}: it already exists. Re-run with --reset to replace a fixture datastore, or choose a new path.`);
  if (exists && args.reset && !looksLikeFixtureDatastore(dbPath)) {
    throw new RefusalError(`Refusing --reset on ${dbPath}: it is not a fixture datastore (every user must be ${FIXTURE_EMAIL_DOMAIN}). Nothing was changed.`);
  }

  const { db, accounts } = buildFixtures();
  const mode = args.dryRun ? "dry run" : exists ? "reset (replace fixture datastore)" : "create";
  console.log(`Fixture target: ${dbPath} (from GYM_DB_PATH)`);
  console.log(`Mode: ${mode}`);
  console.log(`Gyms: ${db.gyms.map((g) => g.slug).join(", ")}`);
  console.log("Accounts (passwords are never printed):");
  for (const a of accounts) console.log(`  ${a.gym.padEnd(8)} ${a.role.padEnd(14)} ${a.email}`);

  if (args.dryRun) {
    console.log("Dry run: nothing was written (no datastore and no credentials file).");
    return;
  }

  // Credentials first (exclusive create, owner-only). If the datastore write then fails, the unusable file is removed.
  const creds = { note: "Fixture credentials for isolated staging/test data only. Hand over out of band, then delete this file.", generatedAt: new Date().toISOString(), accounts };
  writeFileSync(credentialsPath, JSON.stringify(creds, null, 2), { flag: "wx", mode: 0o600 });
  try {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    if (exists) copyFileSync(dbPath, `${dbPath}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`);
    writeFileSync(dbPath, JSON.stringify(db, null, 2), { encoding: "utf8", mode: 0o600 });
  } catch (err) {
    try { unlinkSync(credentialsPath); } catch { /* best effort */ }
    throw err;
  }
  console.log(`Wrote ${dbPath}.`);
  console.log(`Passwords were written to ${credentialsPath} (owner-only on POSIX). They are not stored anywhere else. Hand that file over out of band and delete it afterwards.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main(process.argv.slice(2), process.env);
  } catch (err) {
    if (err instanceof RefusalError) {
      console.error(err.message);
      process.exit(2);
    }
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
