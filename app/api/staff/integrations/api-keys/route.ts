import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findUserById, saveGym } from "@/lib/db";
import { gymRecordForUser } from "@/lib/gym-checkin-setting";
import { MAX_API_KEYS_PER_GYM, newApiKey, publicApiKey } from "@/lib/gym-api-keys";
import { verifyRequestSession } from "@/lib/mobile-auth";
import { can } from "@/lib/permissions";
import { requireTenantAccess } from "@/lib/tenant-request";

// A gym's API keys: list them, and make one. The key is returned ONCE, when it is made; only a hash is kept. The gym is the asker's own (from the account, never the request).
export async function GET(request: NextRequest) {
  const userId = verifyRequestSession(request)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;
  if (!user) return NextResponse.json({ success: false, message: "You must be signed in." }, { status: 401 });
  const tenantLock = requireTenantAccess(user);
  if (tenantLock) return tenantLock;
  if (!can(user.role, "gym.manageBranding")) return NextResponse.json({ success: false, message: "Only the gym owner or an admin can manage integrations." }, { status: 403 });
  const gym = gymRecordForUser(user);
  if (!gym) return NextResponse.json({ success: false, message: "Your gym could not be found." }, { status: 404 });
  return NextResponse.json({ success: true, data: { keys: (gym.apiKeys ?? []).filter((k) => !k.revokedAt).map(publicApiKey) } });
}

export async function POST(request: NextRequest) {
  const userId = verifyRequestSession(request)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;
  if (!user) return NextResponse.json({ success: false, message: "You must be signed in." }, { status: 401 });
  const tenantLock = requireTenantAccess(user);
  if (tenantLock) return tenantLock;
  if (!can(user.role, "gym.manageBranding")) return NextResponse.json({ success: false, message: "Only the gym owner or an admin can manage integrations." }, { status: 403 });
  const gym = gymRecordForUser(user);
  if (!gym) return NextResponse.json({ success: false, message: "Your gym could not be found." }, { status: 404 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }
  const name = typeof (body as Record<string, unknown> | null)?.name === "string" ? String((body as Record<string, unknown>).name).trim() : "";
  if (!name || name.length > 60) return NextResponse.json({ success: false, message: "Give the key a name (up to 60 characters), for example Zapier." }, { status: 400 });
  const active = (gym.apiKeys ?? []).filter((k) => !k.revokedAt);
  if (active.length >= MAX_API_KEYS_PER_GYM) return NextResponse.json({ success: false, message: `You can have up to ${MAX_API_KEYS_PER_GYM} keys. Revoke one to make another.` }, { status: 409 });

  const { key, record } = newApiKey(name);
  saveGym({ ...gym, apiKeys: [...(gym.apiKeys ?? []), record], updatedAt: new Date().toISOString() });
  return NextResponse.json({ success: true, message: "Key made. Copy it now: it is shown only once.", data: { key, apiKey: publicApiKey(record) } }, { status: 201 });
}
