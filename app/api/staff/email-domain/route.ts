import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findGymById, findUserById } from "@/lib/db";
import { domainStateText, gymMayUseCustomEmailDomain, readDomainInput, readSenderName } from "@/lib/gym-email-domain";
import { refreshGymEmailDomain, registerGymEmailDomain, removeGymEmailDomain } from "@/lib/gym-email-domain-sync";
import { verifyRequestSession } from "@/lib/mobile-auth";
import { can } from "@/lib/permissions";
import { requireTenantAccess } from "@/lib/tenant-request";

// A tenant gym's own email domain. The gym comes from the signed-in admin's account, never from the request. The original S&C gym has no gym record on its accounts and uses the platform sender.
async function adminGym(request: NextRequest) {
  const userId = verifyRequestSession(request)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;
  if (!user) return { error: NextResponse.json({ success: false, message: "You must be signed in." }, { status: 401 }) };
  const tenantLock = requireTenantAccess(user);
  if (tenantLock) return { error: tenantLock };
  if (!can(user.role, "gym.manageBranding")) return { error: NextResponse.json({ success: false, message: "Only the gym owner or an admin can change this." }, { status: 403 }) };
  const gym = user.gymId ? findGymById(user.gymId) : undefined;
  if (!gym) return { error: NextResponse.json({ success: false, message: "This is set up for gyms on the platform." }, { status: 404 }) };
  return { gym };
}

function view(gym: NonNullable<ReturnType<typeof findGymById>>) {
  return {
    allowed: gymMayUseCustomEmailDomain(gym),
    domain: gym.emailDomain ?? null,
    ...domainStateText(gym.emailDomain),
  };
}

export async function GET(request: NextRequest) {
  const found = await adminGym(request);
  if (!found.gym) return found.error;
  // Reading the page also re-checks a domain that is still waiting, so a gym sees "verified" as soon as it is true.
  let gym = found.gym;
  if (gym.emailDomain && gym.emailDomain.status !== "verified") {
    const refreshed = await refreshGymEmailDomain(gym, false);
    if (refreshed.ok) gym = refreshed.gym;
  }
  return NextResponse.json({ success: true, data: view(gym) });
}

export async function POST(request: NextRequest) {
  const found = await adminGym(request);
  if (!found.gym) return found.error;
  const gym = found.gym;
  if (!gymMayUseCustomEmailDomain(gym)) {
    return NextResponse.json({ success: false, message: "Your own email domain is included in the larger plans. Your emails are still sent in your gym's name, and replies come to your contact email." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }
  const { domain, fromName } = (body ?? {}) as Record<string, unknown>;
  const d = readDomainInput(domain);
  if (!d.domain) return NextResponse.json({ success: false, message: d.error }, { status: 400 });
  const local = readSenderName(fromName ?? "hello");
  if (!local.local) return NextResponse.json({ success: false, message: local.error }, { status: 400 });

  const result = await registerGymEmailDomain(gym, d.domain, local.local);
  if (!result.ok) return NextResponse.json({ success: false, message: result.message }, { status: result.status });
  return NextResponse.json({ success: true, message: "Domain added. Now add the records below where you bought your domain.", data: view(result.gym) }, { status: 201 });
}

export async function DELETE(request: NextRequest) {
  const found = await adminGym(request);
  if (!found.gym) return found.error;
  const result = await removeGymEmailDomain(found.gym);
  if (!result.ok) return NextResponse.json({ success: false, message: result.message }, { status: result.status });
  return NextResponse.json({ success: true, message: "Removed. Emails are sent in your gym's name from the standard address.", data: view(result.gym) });
}
