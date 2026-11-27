// Talks to the mail provider (Resend) to register, check and remove a gym's own sending domain, and keeps the gym record in step. Server-only.
// Everything a person has to do is add the DNS records the provider gives back; there is nothing for the platform owner to do by hand.
import { saveGym } from "@/lib/db";
import { getResendClient } from "@/lib/email";
import type { GymEmailDomain, GymRecord } from "@/lib/gyms-schema";

export type DomainResult = { ok: true; gym: GymRecord } | { ok: false; status: number; message: string };

type ProviderRecord = { record?: string; name?: string; type?: string; value?: string; ttl?: string; priority?: number; status?: string };
type ProviderDomain = { id?: string; name?: string; status?: string; records?: ProviderRecord[] };

function toRecords(list: ProviderRecord[] | undefined): GymEmailDomain["records"] {
  return (list ?? [])
    .filter((r) => (r.record === "SPF" || r.record === "DKIM") && r.name && r.type && r.value)
    .map((r) => ({ record: String(r.record), name: String(r.name), type: String(r.type), value: String(r.value), ttl: r.ttl ? String(r.ttl) : undefined, priority: r.priority, status: r.status }));
}

const unavailable: DomainResult = { ok: false, status: 503, message: "Custom email domains are not available right now. Please try again later." };
const providerFailed = (what: string): DomainResult => ({ ok: false, status: 502, message: `We could not ${what} with our email provider. Please try again in a few minutes.` });

export async function registerGymEmailDomain(gym: GymRecord, domain: string, fromLocal: string): Promise<DomainResult> {
  const resend = getResendClient();
  if (!resend) return unavailable;
  if (gym.emailDomain) return { ok: false, status: 409, message: "Your gym already has a domain. Remove it first to use a different one." };

  const created = await resend.domains.create({ name: domain }).catch(() => null);
  const data = created?.data as ProviderDomain | null | undefined;
  if (!data?.id) {
    const msg = String((created?.error as { message?: string } | null | undefined)?.message ?? "");
    // Most likely the domain is already registered on the platform by someone else.
    if (/already|exist|registered/i.test(msg)) return { ok: false, status: 409, message: "That domain is already in use. If it is yours, contact support." };
    return providerFailed("add that domain");
  }

  const now = new Date().toISOString();
  const next: GymRecord = {
    ...gym,
    emailDomain: { name: domain, resendId: data.id, status: data.status ?? "pending", fromLocal, records: toRecords(data.records), createdAt: now, verifiedAt: null },
    updatedAt: now,
  };
  saveGym(next);
  return { ok: true, gym: next };
}

/** Asks the provider to re-check the records, then stores the answer. Cheap to call; the staff page and an hourly job both use it. */
export async function refreshGymEmailDomain(gym: GymRecord, askToVerify: boolean): Promise<DomainResult> {
  const resend = getResendClient();
  const own = gym.emailDomain;
  if (!resend) return unavailable;
  if (!own) return { ok: false, status: 404, message: "Your gym has no domain set up." };

  if (askToVerify && own.status !== "verified") await resend.domains.verify(own.resendId).catch(() => null);
  const got = await resend.domains.get(own.resendId).catch(() => null);
  const data = got?.data as ProviderDomain | null | undefined;
  if (!data?.status) return providerFailed("check the domain");

  const now = new Date().toISOString();
  const next: GymRecord = {
    ...gym,
    emailDomain: {
      ...own,
      status: data.status,
      records: data.records ? toRecords(data.records) : own.records,
      verifiedAt: data.status === "verified" ? own.verifiedAt ?? now : null,
    },
    updatedAt: now,
  };
  saveGym(next);
  return { ok: true, gym: next };
}

export async function removeGymEmailDomain(gym: GymRecord): Promise<DomainResult> {
  const own = gym.emailDomain;
  if (!own) return { ok: true, gym };
  const resend = getResendClient();
  if (resend) await resend.domains.remove(own.resendId).catch(() => null);
  const { emailDomain: _removed, ...rest } = gym;
  const next: GymRecord = { ...rest, updatedAt: new Date().toISOString() };
  saveGym(next);
  return { ok: true, gym: next };
}
