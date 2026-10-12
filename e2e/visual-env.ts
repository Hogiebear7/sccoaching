// Shared constants for the visual suite: the dedicated test server, its isolated datastore, and the saved login state.
//
// The suite starts its OWN server (never reuses one), on its own port and with its own temporary datastore, so it can never read or write real
// local data and its screens do not depend on whichever environment variables a developer or runner happens to have.
import os from "node:os";
import path from "node:path";

export const VISUAL_PORT = Number(process.env.VISUAL_PORT ?? 3100);
export const BASE_URL = `http://localhost:${VISUAL_PORT}`;

// Temporary and disposable: recreated by global-setup on every run.
export const DATA_DIR = path.join(os.tmpdir(), "sandc-visual-data");
export const DB_PATH = path.join(DATA_DIR, "db.json");
export const STATE_PATH = path.join(DATA_DIR, "demo-member-state.json");

// scripts/seed.js's demo member. Local test data on an isolated server only.
export const DEMO = { email: "alex@demo.local", password: "Demo1234!" };

// A fixed, far-future billing end date for the demo member, so the Membership screen never shows a date that moves with the clock and the
// membership never lapses while the baselines are in use.
export const FIXED_PERIOD_END = "2099-01-01";
