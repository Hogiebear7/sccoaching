// A tenant gym's own email domain (hello@theirgym.ie): the rules, with no database and no network, so they can be tested.
// The gym types its domain; the mail provider (Resend) gives back DNS records; the gym adds those where it bought the domain; once they are verified, the gym's emails are sent from its own domain.
// Until then, and for gyms that do not use this, mail goes from the platform's one sending address with the gym's NAME as the sender name and the gym's contact email as the reply address.
import type { GymEmailDomain } from "@/lib/gyms-schema";

/** Every gym on the platform can use its own email domain, whatever its size band. (If that ever changes to certain plans only, it is decided here.) */
export function gymMayUseCustomEmailDomain(gym: { platformBilling?: { band?: string } } | null | undefined): boolean {
  return !!gym;
}

// The mail provider's plan allows a fixed number of sending domains in total (Resend: 10 on Pro). The owner is told at 80% so the plan can be upgraded in time.
export const DEFAULT_EMAIL_DOMAIN_LIMIT = 10;
export function emailDomainLimitFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.EMAIL_DOMAIN_LIMIT);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_EMAIL_DOMAIN_LIMIT;
}
export function domainLimitState(count: number, limit: number): "ok" | "near" | "full" {
  if (count >= limit) return "full";
  return count >= Math.ceil(limit * 0.8) ? "near" : "ok";
}

// Free mailbox providers cannot be used: we cannot add DNS records to someone else's domain, and mail "from" them would be rejected or sent to spam.
const FREE_MAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "hotmail.co.uk", "live.com", "msn.com", "yahoo.com", "yahoo.co.uk", "yahoo.ie", "icloud.com", "me.com", "mac.com",
  "aol.com", "proton.me", "protonmail.com", "gmx.com", "mail.com", "zoho.com", "eircom.net", "vodafone.ie", "ymail.com", "duck.com",
]);

const DOMAIN_RE = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/;

/** Reads what a person typed ("https://www.TheirGym.ie/", "hello@theirgym.ie") into a bare domain, or says what is wrong in plain words. */
export function readDomainInput(input: unknown): { domain: string; error: null } | { domain: null; error: string } {
  if (typeof input !== "string") return { domain: null, error: "Type the domain you own, for example theirgym.ie." };
  let value = input.trim().toLowerCase();
  value = value.replace(/^[a-z]+:\/\//, "").replace(/\/.*$/, "");
  if (value.includes("@")) value = value.slice(value.lastIndexOf("@") + 1);
  value = value.replace(/^www\./, "").replace(/\.$/, "");
  if (!value) return { domain: null, error: "Type the domain you own, for example theirgym.ie." };
  if (FREE_MAIL_DOMAINS.has(value)) {
    return { domain: null, error: `${value} is a free email service, so we cannot send from it. Use a domain you own (like theirgym.ie), or keep the standard setup, where emails are sent in your gym's name and replies come to your contact email.` };
  }
  if (!DOMAIN_RE.test(value)) return { domain: null, error: "That does not look like a domain. Use something like theirgym.ie." };
  return { domain: value, error: null };
}

/** The part before the @ for a gym's own sending address. Letters, numbers, dots, dashes only. */
export function readSenderName(input: unknown): { local: string; error: null } | { local: null; error: string } {
  const value = typeof input === "string" ? input.trim().toLowerCase() : "";
  if (!/^[a-z0-9][a-z0-9._-]{0,40}$/.test(value)) return { local: null, error: "Use letters and numbers only, for example hello or bookings." };
  return { local: value, error: null };
}

/** A gym name made safe to use as an email sender name: no quotes, angle brackets, line breaks. Falls back to the given default. */
export function senderDisplayName(name: unknown, fallback = "S&C Performance Coaching"): string {
  const clean = typeof name === "string" ? name.replace(/[\r\n<>"@]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60) : "";
  return clean || fallback;
}

/** The bare address inside "Name <address>" or just "address". */
export function bareAddress(from: string): string {
  const m = from.match(/<([^>]+)>/);
  return (m ? m[1] : from).trim();
}

/** The From line for an email to or about this gym. A verified own domain wins; otherwise the gym's name on the platform address. */
export function fromLineFor(
  gym: { name?: string; emailDomain?: GymEmailDomain } | null | undefined,
  platformFrom: string,
): string {
  const display = senderDisplayName(gym?.name);
  const own = gym?.emailDomain;
  if (own && own.status === "verified") return `${display} <${own.fromLocal}@${own.name}>`;
  return `${display} <${bareAddress(platformFrom)}>`;
}

/** Whether the records the gym has to add are all in place (used to show "waiting" versus "verified"). */
export function domainStateText(domain: GymEmailDomain | undefined): { state: "none" | "waiting" | "verified" | "problem"; text: string } {
  if (!domain) return { state: "none", text: "Not set up." };
  if (domain.status === "verified") return { state: "verified", text: `Verified. Your emails are sent from ${domain.fromLocal}@${domain.name}.` };
  if (domain.status === "failed" || domain.status === "partially_failed") {
    return { state: "problem", text: "We could not find all the records yet. Check each one is added exactly as shown, then press Check again. DNS changes can take up to a day." };
  }
  return { state: "waiting", text: "Waiting for the records. After you add them it can take from a few minutes to a day. We check automatically." };
}
