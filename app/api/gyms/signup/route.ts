import { randomUUID } from "crypto";
import { NextResponse } from "next/server";

import {
  createGym,
  createUserWithRole,
  findGymBySlug,
  findUserByEmail,
  setUserGymId,
} from "@/lib/db";
import { checkClientRateLimit } from "@/lib/client-ip";
import type { GymRecord } from "@/lib/gyms-schema";
import { hashPassword, validatePasswordStrength } from "@/lib/password";
import { STAFF_SESSION_LIFETIME_MS, signSession } from "@/lib/session";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Public and anonymous, and it creates a tenant plus a staff account, so it is the
// most abusable endpoint: 3 attempts per client per hour (see lib/client-ip.ts for
// how a "client" is identified, and lib/rate-limit.ts for the process-local caveat).
const GYM_SIGNUP_RATE_LIMIT = 3;
const GYM_SIGNUP_RATE_WINDOW_MS = 60 * 60 * 1000;

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Self-serve gym-owner signup — technical shape only (see the Phase 2 plan's
// explicit list of open business questions this deliberately doesn't
// resolve: pricing, ToS, moderation process). Always creates the gym as
// "pending" — never directly reachable in nearby-search results — and the
// owner as a normal admin_manager account scoped to that gym via
// lib/gym-scope.ts, exactly like every other staff account, just for a gym
// that isn't S&C. A staff user with the new "gyms.moderate" capability
// (lib/permissions.ts) flips status to "active" once vetted; there's no
// dedicated moderation UI yet, only the capability and this route's own
// "pending" default — see the plan's Phase 3 for why that's deliberate.
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const { gymName, addressLine, contactPhone, ownerEmail, password } = (body ?? {}) as Record<string, unknown>;

  if (typeof gymName !== "string" || !gymName.trim()) {
    return NextResponse.json({ success: false, message: "Gym name is required." }, { status: 400 });
  }
  if (typeof addressLine !== "string" || !addressLine.trim()) {
    return NextResponse.json({ success: false, message: "Address is required." }, { status: 400 });
  }
  if (typeof ownerEmail !== "string" || !EMAIL_RE.test(ownerEmail.trim())) {
    return NextResponse.json({ success: false, message: "Enter a valid email address." }, { status: 400 });
  }
  if (typeof password !== "string") {
    return NextResponse.json({ success: false, message: "Password is required." }, { status: 400 });
  }
  const passwordError = validatePasswordStrength(password);
  if (passwordError) {
    return NextResponse.json({ success: false, message: passwordError }, { status: 400 });
  }

  // After the request is validated (a malformed request costs nothing and does not
  // use a slot) and before the first datastore lookup, so an attempt that reaches the
  // duplicate-email check, the password hash, or account creation always counts —
  // including one that fails there, which also bounds email probing.
  const rate = checkClientRateLimit(request, "gym-signup", GYM_SIGNUP_RATE_LIMIT, GYM_SIGNUP_RATE_WINDOW_MS);
  if (!rate.allowed) {
    return NextResponse.json(
      { success: false, message: "Too many attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSecs) } }
    );
  }

  const trimmedEmail = ownerEmail.trim();
  if (findUserByEmail(trimmedEmail)) {
    return NextResponse.json({ success: false, message: "Unable to create account." }, { status: 400 });
  }

  const baseSlug = slugify(gymName.trim()) || "gym";
  let slug = baseSlug;
  let suffix = 2;
  while (findGymBySlug(slug)) {
    slug = `${baseSlug}-${suffix}`;
    suffix += 1;
  }

  // Owner account first (no gymId yet) — the gym record needs the owner's
  // real id, and the owner's gymId gets stamped on right after, once the
  // gym's own id exists too. See lib/db.ts's setUserGymId for why this is
  // the one place that two-step update is needed.
  const passwordHash = hashPassword(password);
  const owner = createUserWithRole(trimmedEmail, passwordHash, "admin_manager", null);

  const now = new Date().toISOString();
  const gym: GymRecord = {
    id: randomUUID(),
    slug,
    name: gymName.trim(),
    tagline: null,
    description: null,
    ownerUserId: owner.id,
    contactEmail: trimmedEmail,
    contactPhone: typeof contactPhone === "string" && contactPhone.trim() ? contactPhone.trim() : null,
    addressLine: addressLine.trim(),
    latitude: null,
    longitude: null,
    status: "pending",
    createdAt: now,
    updatedAt: now,
  };
  createGym(gym);
  setUserGymId(owner.id, gym.id);

  const response = NextResponse.json(
    { success: true, message: "Gym created. It'll appear in search once approved.", data: { gymId: gym.id } },
    { status: 201 }
  );

  response.cookies.set("session", signSession({ userId: owner.id }, STAFF_SESSION_LIFETIME_MS), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: STAFF_SESSION_LIFETIME_MS / 1000,
  });

  return response;
}
