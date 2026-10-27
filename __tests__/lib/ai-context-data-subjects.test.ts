// WHOSE data goes to the AI provider. One member's consent covers that member's OWN data and nothing else, so the prompts must not carry other people's details. The
// member's emergency contacts are third parties who never agreed to anything; the member's email and phone are not needed to answer a training question. This pins
// that: the contexts built for the provider contain none of them, however the profile is filled in.
import { readFileSync } from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createFixture, type IapFixture } from "../helpers/iap-fixture";

let fx: IapFixture;
beforeEach(async () => {
  fx = await createFixture();
});
afterEach(() => fx.cleanup());

const SECRETS = {
  emergencyName: "Quentin Zzyzx-Contact",
  emergencyPhone: "0877770001",
  emergencyName2: "Priya Zzyzx-Second",
  emergencyPhone2: "0877770002",
  email: "subject-email@example.test",
  phone: "0831119999",
};

async function memberWithFilledProfile() {
  const { POST } = await import("@/app/api/auth/signup/route");
  const res = await POST(
    new NextRequest("http://localhost/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: SECRETS.email, password: "Tester-pass-123!", fullName: "Subject Member", phone: SECRETS.phone, dateOfBirth: "1990-01-01", gender: "Male", primaryGoal: "Build Muscle" }),
    })
  );
  expect(res.status).toBeLessThan(300);
  const user = fx.db.findUserByEmail(SECRETS.email)!;
  const profile = fx.db.findProfileByUserId(user.id)!;
  fx.db.saveProfile({
    ...profile,
    emergencyContactName: SECRETS.emergencyName,
    emergencyContactPhone: SECRETS.emergencyPhone,
    emergencyContact2Name: SECRETS.emergencyName2,
    emergencyContact2Phone: SECRETS.emergencyPhone2,
  });
  return { user, profile: fx.db.findProfileByUserId(user.id)! };
}

describe("what the AI contexts contain", () => {
  it("the member's own AI coach context carries no emergency contact, email or phone number", async () => {
    const { buildCoachingContext } = await import("@/lib/ai-context");
    const { profile } = await memberWithFilledProfile();
    const ctx = buildCoachingContext({ profile, recoveryLogs: [], sessions: [], todayISO: "2026-10-15", drinkSettings: null, weeklyTrainingSchedule: null, upcomingBookings: [] } as never);
    for (const [what, value] of Object.entries(SECRETS)) expect(ctx.text, what).not.toContain(value);
    expect(ctx.text).toContain("Subject Member"); // the member's own name is the member's own data
  });

  it("the staff-side member context (coach summary and draft reply) carries none of them either", async () => {
    const src = readFileSync(path.join(process.cwd(), "lib", "ai.ts"), "utf8");
    const body = src.slice(src.indexOf("function buildStaffMemberContext"), src.indexOf("function textFromMessage"));
    expect(body).toContain("buildCoachingContext(");
    // and it adds no contact details of its own
    expect(body).not.toMatch(/emergencyContact|\.email|\.phone/);
  });
});
