import { Resend } from "resend";

const apiKey = process.env.RESEND_API_KEY?.trim() || null;
const fromAddress = process.env.EMAIL_FROM?.trim() || "onboarding@resend.dev";

// Lazily initialised — only when an API key is present. This means the module
// is safe to import in any context without side effects when email is unconfigured.
const resend = apiKey ? new Resend(apiKey) : null;

if (process.env.NODE_ENV === "production" && !process.env.APP_URL?.trim()) {
  console.warn(
    "[email] APP_URL is not set in production — action links in emails will point to http://localhost:3000"
  );
}

export interface EmailPayload {
  to: string;
  subject: string;
  html: string;
  text: string;
}

// Sends a transactional email. Never throws — failures are logged and swallowed
// so that email delivery can never break the calling flow.
export async function sendEmail(payload: EmailPayload): Promise<void> {
  if (!resend) {
    // Console fallback: same pattern as the forgot-password route.
    console.log(`[email] ${payload.subject} → ${payload.to}`);
    return;
  }

  const { data, error } = await resend.emails.send({
    from: fromAddress,
    to: payload.to,
    subject: payload.subject,
    html: payload.html,
    text: payload.text,
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

  console.log(
    "[email] sent:",
    data?.id ?? "(no id)",
    "→",
    payload.to,
    `"${payload.subject}"`
  );
}
