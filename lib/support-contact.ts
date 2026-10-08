// Where a member's feedback goes, and how the Settings -> Help "Feedback & support" entry is built.
//
// Deliberately a plain mailto, not a new data-collection backend: nothing is stored by this app, nothing is sent until the member sends
// the email themselves, and nothing about the account (id, email, tenant, plan, payment state) is put into the message automatically.
//
// Destination: the business contact address already published on the public site, privacy policy and terms (CONTACT_INFO in lib/content.ts).
// That address belongs to the primary gym. Other gyms have a self-entered contactEmail on their gym record that nobody has verified, so
// a member of any other gym is NOT pointed at either address: resolveSupportEmail returns null and the entry is not shown. A verified
// per-gym support address is an owner input (see docs/app-polish-release-2026-10.md).

import { CONTACT_INFO } from "@/lib/content";

export const SUPPORT_SUBJECT = "S&C app feedback";

// A starting point for the member to type over. It asks for nothing private and says not to send secrets.
export const SUPPORT_BODY = [
  "Hi,",
  "",
  "What happened, or what would you like to see?",
  "",
  "",
  "(Please don't include your password or card details.)",
].join("\n");

/** The address a member of this gym may be pointed at, or null when there is no verified one. gymId null/undefined is the primary gym. */
export function resolveSupportEmail(gymId: string | null | undefined): string | null {
  return gymId ? null : CONTACT_INFO.email;
}

export function buildSupportMailto(email: string): string {
  return `mailto:${email}?subject=${encodeURIComponent(SUPPORT_SUBJECT)}&body=${encodeURIComponent(SUPPORT_BODY)}`;
}

export type CopyOutcome = "copied" | "unavailable";

/** Copies text, or reports that the clipboard is not available (an insecure page, a blocked permission, an old browser). Never throws. */
export async function copyText(
  clipboard: { writeText?: (text: string) => Promise<void> } | null | undefined,
  text: string
): Promise<CopyOutcome> {
  if (!clipboard || typeof clipboard.writeText !== "function") return "unavailable";
  try {
    await clipboard.writeText(text);
    return "copied";
  } catch {
    return "unavailable";
  }
}
