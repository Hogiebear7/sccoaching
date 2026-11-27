// Hides specific accounts from the Community: they are not found in search or suggestions, do not appear on leaderboards or challenges, and nobody can start following them.
// Meant for accounts that must keep working but should never be seen by members (for example the logins given to app store reviewers).
//
//   node scripts/hide-from-community.mjs applereview@test.com applereview2@test.com            (dry run: says what would change)
//   node scripts/hide-from-community.mjs applereview@test.com applereview2@test.com --confirm  (applies it; copies db.json first)
//
// Only changes the Community privacy settings of the accounts named. Everything else is left alone. Set GYM_DB_PATH to target a different datastore file.
import { copyFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { createRequire } from "node:module";
const { readForScript, writeForScript } = createRequire(import.meta.url)("../lib/datastore/core.js");

const DB_PATH = process.env.GYM_DB_PATH ?? fileURLToPath(new URL("../data/db.json", import.meta.url));
const args = process.argv.slice(2);
const CONFIRM = args.includes("--confirm");
const emails = args.filter((a) => a !== "--confirm").map((e) => e.toLowerCase());
if (emails.length === 0) {
  console.error("Usage: node scripts/hide-from-community.mjs <email> [<email> ...] [--confirm]");
  process.exit(1);
}
if (!existsSync(DB_PATH)) {
  console.error(`Database not found at ${DB_PATH}.`);
  process.exit(1);
}

const { db, token } = readForScript(DB_PATH);
const users = db.users ?? [];
const HIDDEN = { discoverable: false, leaderboardVisible: false, leaderboardMode: "hidden", whoCanFollow: "nobody", profileVisibility: "followers" };

console.log(`\nHide from Community: ${CONFIRM ? "APPLYING" : "DRY RUN"}\n`);
const now = new Date().toISOString();
db.communityPrivacy = db.communityPrivacy ?? [];
let changed = 0;
for (const email of emails) {
  const user = users.find((u) => u.email.toLowerCase() === email);
  if (!user) {
    console.log(`  not found: ${email}`);
    continue;
  }
  const existing = db.communityPrivacy.find((p) => p.userId === user.id);
  if (existing) {
    const already = Object.entries(HIDDEN).every(([k, v]) => existing[k] === v);
    console.log(`  ${already ? "already hidden" : "will hide"}: ${email} (${user.name})`);
    if (!already) {
      Object.assign(existing, HIDDEN, { updatedAt: now });
      changed++;
    }
  } else {
    console.log(`  will hide: ${email} (${user.name})`);
    db.communityPrivacy.push({ userId: user.id, showRealName: true, ...HIDDEN, createdAt: now, updatedAt: now });
    changed++;
  }
}

if (!CONFIRM || changed === 0) {
  console.log(changed === 0 ? "\nNothing to change.\n" : "\nNothing written. Run again with --confirm to apply.\n");
  process.exit(0);
}
const backup = `${DB_PATH}.bak-${Date.now()}`;
copyFileSync(DB_PATH, backup);
writeForScript(DB_PATH, db, token);
console.log(`\nDone. ${changed} account(s) hidden. Copy of the data before the change: ${backup}\n`);
