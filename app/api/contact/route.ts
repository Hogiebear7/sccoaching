import { NextResponse } from "next/server";

import { getConfiguredContactNotifyEmail } from "@/lib/app-config";
import { checkClientRateLimit } from "@/lib/client-ip";
import { createClient } from "@/lib/supabase/server";
import { contactInquiryEmail } from "@/lib/email-templates";
import { sendEmail } from "@/lib/email";

const CONTACT_RATE_LIMIT = 3;
const CONTACT_RATE_WINDOW_MS = 10 * 60 * 1000;
const NOTIFY_EMAIL = getConfiguredContactNotifyEmail() || "info@sandccoaching.com";

const GENERIC_SUCCESS = { success: true, message: "Thanks — we'll be in touch shortly." };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Generous ceilings for a genuine enquiry, well below anything that would
// bloat the stored lead row or the notification email.
const MAX_NAME_LENGTH = 200;
const MAX_EMAIL_LENGTH = 254; // RFC 5321 mailbox length limit
const MAX_PHONE_LENGTH = 40;
const MAX_MESSAGE_LENGTH = 5000;

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const { name, email, phone, message, company } = (body ?? {}) as Record<string, unknown>;

  // Honeypot — a hidden field real visitors never fill. Bots that fill every
  // field trip this; pretend success so they don't learn to skip it.
  if (typeof company === "string" && company.trim()) {
    return NextResponse.json(GENERIC_SUCCESS, { status: 200 });
  }

  if (typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ success: false, message: "Name is required." }, { status: 400 });
  }
  if (name.trim().length > MAX_NAME_LENGTH) {
    return NextResponse.json({ success: false, message: `Name must be ${MAX_NAME_LENGTH} characters or fewer.` }, { status: 400 });
  }
  if (typeof email !== "string" || !EMAIL_RE.test(email.trim())) {
    return NextResponse.json({ success: false, message: "A valid email is required." }, { status: 400 });
  }
  if (email.trim().length > MAX_EMAIL_LENGTH) {
    return NextResponse.json({ success: false, message: "A valid email is required." }, { status: 400 });
  }
  if (typeof message !== "string" || !message.trim()) {
    return NextResponse.json({ success: false, message: "Message is required." }, { status: 400 });
  }
  if (message.trim().length > MAX_MESSAGE_LENGTH) {
    return NextResponse.json({ success: false, message: `Message must be ${MAX_MESSAGE_LENGTH} characters or fewer.` }, { status: 400 });
  }
  if (phone !== undefined && phone !== null && typeof phone !== "string") {
    return NextResponse.json({ success: false, message: "Invalid phone number." }, { status: 400 });
  }
  if (typeof phone === "string" && phone.trim().length > MAX_PHONE_LENGTH) {
    return NextResponse.json({ success: false, message: "Invalid phone number." }, { status: 400 });
  }

  // Malformed requests never reach here (all above this point costs no slot).
  // Uses the shared, conservative trusted-proxy policy (lib/client-ip.ts):
  // no forwarded header is trusted unless TRUSTED_PROXY_HOPS is explicitly
  // set and verified against the deployed host, matching every other public
  // endpoint's rate limiting added in this program.
  const rate = checkClientRateLimit(request, "contact", CONTACT_RATE_LIMIT, CONTACT_RATE_WINDOW_MS);
  if (!rate.allowed) {
    return NextResponse.json(
      { success: false, message: "Too many enquiries — please try again shortly." },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSecs) } }
    );
  }

  const trimmedPhone = typeof phone === "string" && phone.trim() ? phone.trim() : null;

  const supabase = await createClient();
  // No .select() here on purpose: the anon role can only INSERT on this
  // table (no SELECT policy — leads are write-only from the public form),
  // and RLS checks apply to RETURNING too, so asking for the row back would
  // fail even though the insert itself succeeds.
  const { error } = await supabase.from("contact_inquiries").insert({
    name: name.trim(),
    email: email.trim(),
    phone: trimmedPhone,
    message: message.trim(),
  });

  if (error) {
    console.error("contact insert failed:", error);
    return NextResponse.json(
      { success: false, message: "Something went wrong. Please try again." },
      { status: 500 }
    );
  }

  const notification = contactInquiryEmail({
    name: name.trim(),
    email: email.trim(),
    phone: trimmedPhone,
    message: message.trim(),
  });
  await sendEmail({ to: NOTIFY_EMAIL, ...notification });

  return NextResponse.json(GENERIC_SUCCESS, { status: 200 });
}
