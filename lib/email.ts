import { Resend } from "resend";

import { getConfiguredAppUrl, getConfiguredEmailFrom, getConfiguredResendApiKey, getConfiguredResendDomainsApiKey } from "@/lib/app-config";
import { randomUUID } from "crypto";

import { findGymById, findUserByEmail, hasEmailSend, isEmailSuppressed, recordEmailSend } from "@/lib/db";
import { fromLineFor } from "@/lib/gym-email-domain";
import { userInLockedGym } from "@/lib/tenant-lockout";

const apiKey = getConfiguredResendApiKey() || null;
const fromAddress = getConfiguredEmailFrom() || "onboarding@resend.dev";

// Lazily initialised — only when an API key is present. This means the module
// is safe to import in any context without side effects when email is unconfigured.
const resend = apiKey ? new Resend(apiKey) : null;

/** A mail provider client for managing gyms' sending domains, or null when RESEND_DOMAINS_API_KEY is not set. Separate from the sending client above, which only needs to send. */
let domainsClient: Resend | null | undefined;
export function getResendDomainsClient(): Resend | null {
  if (domainsClient === undefined) {
    const key = getConfiguredResendDomainsApiKey();
    domainsClient = key ? new Resend(key) : null;
  }
  return domainsClient;
}

if (process.env.NODE_ENV === "production" && !getConfiguredAppUrl()) {
  console.warn(
    "[email] APP_URL is not set in production — action links in emails will point to http://localhost:3000"
  );
}

export interface EmailAttachment {
  filename: string;
  /** Base64-encoded file content. */
  content: string;
}

export interface EmailPayload {
  to: string;
  subject: string;
  html: string;
  text: string;
  attachments?: EmailAttachment[];
  /** Where replies go instead of the sender (e.g. the enquirer on a website lead). */
  replyTo?: string;
  /** Extra mail headers, for example List-Unsubscribe and List-Unsubscribe-Post on optional emails. */
  headers?: Record<string, string>;
  /** What this email is, for the send log ("booking-confirmation"...). Defaults to "other". */
  kind?: string;
  /** When set, the email goes once only: a second call with the same key is skipped (for example `welcome:<userId>`). */
  dedupeKey?: string;
  /** The gym this email is on behalf of (null = the original S&C gym). When not given, the recipient's own gym is used. Decides the sender name and, for a gym with a verified own domain, the sending address. */
  gymId?: string | null;
  /** Sign-in and account-security mail (a password reset, an email change) that must still reach a member or staff member of a locked gym. Everything else is held back. */
  essential?: boolean;
}

// Sends a transactional email. Never throws — failures are logged and swallowed
// so that email delivery can never break the calling flow.
export async function sendEmail(payload: EmailPayload): Promise<void> {
  // A gym locked for an unpaid platform subscription sends and receives no routine email; account-security mail still goes (lib/tenant-lockout.ts).
  const recipient = findUserByEmail(payload.to);
  if (!payload.essential && userInLockedGym(recipient)) {
    console.log("[email] skipped, the recipient's gym is locked:", payload.subject, "->", payload.to);
    return;
  }

  if (!resend) {
    // Console fallback: same pattern as the forgot-password route.
    console.log(`[email] ${payload.subject} → ${payload.to}`);
    return;
  }

  // An address that hard-bounced or complained is never emailed again (list kept from Resend's webhook, lib/email-events.ts).
  if (isEmailSuppressed(payload.to)) {
    console.log("[email] skipped, address is suppressed:", payload.subject, "→", payload.to);
    return;
  }

  // A once-only email (welcome, onboarding step) already sent under this key is not sent again.
  if (payload.dedupeKey && hasEmailSend(payload.dedupeKey)) {
    console.log("[email] skipped, already sent:", payload.dedupeKey);
    return;
  }

  // A tenant gym's mail is sent in the gym's name (and from its own verified domain when it has one), and replies go to the gym. The original S&C gym is unchanged.
  const gymId = payload.gymId !== undefined ? payload.gymId : recipient?.gymId ?? null;
  const gym = gymId ? findGymById(gymId) : undefined;
  const from = gym ? fromLineFor(gym, fromAddress) : fromAddress;
  const contact = gym?.contactEmail?.trim();
  const replyTo = payload.replyTo ?? (contact && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact) ? contact : undefined);

  const { data, error } = await resend.emails.send({
    from,
    to: payload.to,
    subject: payload.subject,
    html: payload.html,
    text: payload.text,
    attachments: payload.attachments,
    ...(replyTo ? { replyTo } : {}),
    ...(payload.headers ? { headers: payload.headers } : {}),
  }).catch((err: unknown) => ({ data: null, error: err }));

  if (error) {
    const resendError = error as Record<string, unknown>;
    console.error(
      "[email] Send failed:",
      payload.subject,
      "→",
      payload.to,
      `statusCode=${resendError.statusCode ?? "unknown"}`,
      `name=${resendError.name ?? "unknown"}`,
      resendError.message ?? error
    );
    return;
  }

  // Logged for usage counting (lib/jobs/check-email-usage.ts) and the once-only check above. A logging problem never affects the send.
  try {
    recordEmailSend({
      id: randomUUID(),
      at: new Date().toISOString(),
      to: payload.to,
      kind: payload.kind ?? "other",
      dedupeKey: payload.dedupeKey ?? null,
      resendId: data?.id ?? null,
    });
  } catch (err) {
    console.error("[email] could not log the send:", err);
  }

  console.log(
    "[email] sent:",
    data?.id ?? "(no id)",
    "→",
    payload.to,
    `"${payload.subject}"`
  );
}
