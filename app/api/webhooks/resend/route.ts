import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { addEmailSuppression, recordEmailEvent } from "@/lib/db";
import { parseResendEvent, verifySvixSignature } from "@/lib/email-events";

// Resend delivery events (delivered, bounced, complained, delayed, failed). Signature-checked with RESEND_WEBHOOK_SECRET; with no secret set the route
// refuses everything, so nothing can be written until the webhook is deliberately set up. A permanent bounce or a complaint adds the address to the
// suppression list so we stop emailing it. Always answers 200 to a valid event so Resend doesn't retry.
export async function POST(request: NextRequest) {
  const secret = process.env.RESEND_WEBHOOK_SECRET?.trim();
  if (!secret) return NextResponse.json({ success: false, message: "Not configured." }, { status: 503 });

  const rawBody = await request.text();
  const id = request.headers.get("svix-id");
  const ok = verifySvixSignature({
    secret,
    id,
    timestamp: request.headers.get("svix-timestamp"),
    signatureHeader: request.headers.get("svix-signature"),
    body: rawBody,
  });
  if (!ok || !id) return NextResponse.json({ success: false, message: "Invalid signature." }, { status: 401 });

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ success: false, message: "Invalid JSON body." }, { status: 400 });
  }

  const event = parseResendEvent(payload);
  if (!event) return NextResponse.json({ success: true, message: "Ignored." }, { status: 200 });

  const receivedAt = new Date().toISOString();
  recordEmailEvent({ id, emailId: event.emailId, type: event.type, to: event.to, receivedAt, detail: event.detail });
  if (event.suppress && event.to) addEmailSuppression({ email: event.to, reason: event.suppress, emailId: event.emailId, at: receivedAt });

  return NextResponse.json({ success: true, message: "Recorded." }, { status: 200 });
}
