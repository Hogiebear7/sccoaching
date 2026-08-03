import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { contactInquiryEmail } from "@/lib/email-templates";
import { sendEmail } from "@/lib/email";
import { checkRateLimit } from "@/lib/rate-limit";

const CONTACT_RATE_LIMIT = 3;
const CONTACT_RATE_WINDOW_MS = 10 * 60 * 1000;
const NOTIFY_EMAIL = process.env.CONTACT_NOTIFY_EMAIL?.trim() || "hello@scperformancecoaching.ie";

const GENERIC_SUCCESS = { success: true, message: "Thanks — we'll be in touch shortly." };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || "unknown";
}

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
  if (typeof email !== "string" || !EMAIL_RE.test(email.trim())) {
    return NextResponse.json({ success: false, message: "A valid email is required." }, { status: 400 });
  }
  if (typeof message !== "string" || !message.trim()) {
    return NextResponse.json({ success: false, message: "Message is required." }, { status: 400 });
  }
  if (phone !== undefined && phone !== null && typeof phone !== "string") {
    return NextResponse.json({ success: false, message: "Invalid phone number." }, { status: 400 });
  }

  const rate = checkRateLimit(`contact:${clientIp(request)}`, CONTACT_RATE_LIMIT, CONTACT_RATE_WINDOW_MS);
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
