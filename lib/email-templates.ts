// APP_URL is used to build action links in emails. Must be set in production.
// Falls back to localhost for development.
const APP_URL = process.env.APP_URL?.trim() || "http://localhost:3000";

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Shared wrapper — minimal inline-styled HTML that renders cleanly in all
// major email clients without a template engine or external CSS.
function emailWrapper(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#09090b;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;">
          <tr>
            <td style="padding-bottom:20px;">
              <span style="font-size:15px;font-weight:700;color:#e4c55a;letter-spacing:0.04em;">S&C Performance Coaching</span>
            </td>
          </tr>
          <tr>
            <td style="background:#18181b;border:1px solid #27272a;border-radius:16px;padding:28px 24px;">
              ${body}
            </td>
          </tr>
          <tr>
            <td style="padding-top:16px;font-size:11px;color:#52525b;text-align:center;">
              You are receiving this as a member of S&C Performance Coaching.
              Manage notification preferences in your
              <a href="${APP_URL}/dashboard/profile" style="color:#52525b;">profile settings</a>.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function ctaButton(label: string, href: string): string {
  return `<a href="${href}" style="display:inline-block;margin-top:20px;padding:10px 22px;background:#3b82f6;color:#fff;font-size:13px;font-weight:600;border-radius:10px;text-decoration:none;">${label}</a>`;
}

// ─── Waitlist offer ────────────────────────────────────────────────────────────

export interface WaitlistOfferEmailOpts {
  memberName: string;
  className: string;
  classDate: string;
  expiryTime: string;
  expiryDate: string;
}

export function waitlistOfferEmail(opts: WaitlistOfferEmailOpts): {
  subject: string;
  html: string;
  text: string;
} {
  const { memberName, className, classDate, expiryTime, expiryDate } = opts;
  const eName = escapeHtml(memberName);
  const eClass = escapeHtml(className);
  const actionUrl = `${APP_URL}/dashboard/schedule`;
  const subject = `Spot available: ${className}`;

  const html = emailWrapper(`Spot available: ${eClass}`, `
    <p style="margin:0 0 4px;font-size:12px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:#e4c55a;">Waitlist offer</p>
    <h1 style="margin:0 0 16px;font-size:20px;font-weight:700;color:#fafafa;">A spot opened for you</h1>
    <p style="margin:0 0 12px;font-size:14px;color:#a1a1aa;">Hi ${eName},</p>
    <p style="margin:0 0 16px;font-size:14px;color:#a1a1aa;">
      A confirmed spot is available in <strong style="color:#fafafa;">${eClass}</strong> on <strong style="color:#fafafa;">${classDate}</strong>.
    </p>
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#09090b;border:1px solid #27272a;border-radius:10px;padding:14px 16px;margin-bottom:4px;">
      <tr>
        <td style="font-size:12px;color:#71717a;">Offer expires</td>
      </tr>
      <tr>
        <td style="font-size:15px;font-weight:600;color:#fafafa;padding-top:2px;">${expiryTime} on ${expiryDate}</td>
      </tr>
    </table>
    <p style="margin:8px 0 0;font-size:12px;color:#52525b;">If you do not respond before then, the spot passes to the next person on the waitlist.</p>
    ${ctaButton("Accept or decline →", actionUrl)}
  `);

  const text = [
    `Hi ${memberName},`,
    ``,
    `A spot has opened in ${className} on ${classDate}.`,
    ``,
    `Accept your offer before ${expiryTime} on ${expiryDate} or it passes to the next person on the waitlist.`,
    ``,
    `Accept or decline: ${actionUrl}`,
    ``,
    `— S&C Performance Coaching`,
  ].join("\n");

  return { subject, html, text };
}

// ─── Waitlist timeout warning ──────────────────────────────────────────────────

export interface WaitlistTimeoutEmailOpts {
  memberName: string;
  className: string;
  classDate: string;
  expiryTime: string;
}

export function waitlistTimeoutEmail(opts: WaitlistTimeoutEmailOpts): {
  subject: string;
  html: string;
  text: string;
} {
  const { memberName, className, classDate, expiryTime } = opts;
  const eName = escapeHtml(memberName);
  const eClass = escapeHtml(className);
  const actionUrl = `${APP_URL}/dashboard/schedule`;
  const subject = `Offer expiring soon: ${className}`;

  const html = emailWrapper(`Offer expiring soon: ${eClass}`, `
    <p style="margin:0 0 4px;font-size:12px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:#e4c55a;">Time-sensitive</p>
    <h1 style="margin:0 0 16px;font-size:20px;font-weight:700;color:#fafafa;">Your offer is expiring</h1>
    <p style="margin:0 0 12px;font-size:14px;color:#a1a1aa;">Hi ${eName},</p>
    <p style="margin:0 0 16px;font-size:14px;color:#a1a1aa;">
      Your spot offer for <strong style="color:#fafafa;">${eClass}</strong> on <strong style="color:#fafafa;">${classDate}</strong> is about to expire.
    </p>
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#09090b;border:1px solid #f59e0b40;border-radius:10px;padding:14px 16px;margin-bottom:4px;">
      <tr>
        <td style="font-size:12px;color:#71717a;">Accept by</td>
      </tr>
      <tr>
        <td style="font-size:15px;font-weight:600;color:#fafafa;padding-top:2px;">${expiryTime}</td>
      </tr>
    </table>
    <p style="margin:8px 0 0;font-size:12px;color:#52525b;">After this time the spot passes automatically to the next person.</p>
    ${ctaButton("Accept now →", actionUrl)}
  `);

  const text = [
    `Hi ${memberName},`,
    ``,
    `Your spot offer for ${className} on ${classDate} is about to expire.`,
    ``,
    `Accept before ${expiryTime} or it passes to the next person.`,
    ``,
    `Accept now: ${actionUrl}`,
    ``,
    `— S&C Performance Coaching`,
  ].join("\n");

  return { subject, html, text };
}

// ─── Class reminder ────────────────────────────────────────────────────────────

export interface ClassReminderEmailOpts {
  memberName: string;
  className: string;
  classDate: string;
  startTime: string;
  leadLabel: string;
}

export function classReminderEmail(opts: ClassReminderEmailOpts): {
  subject: string;
  html: string;
  text: string;
} {
  const { memberName, className, classDate, startTime, leadLabel } = opts;
  const eName = escapeHtml(memberName);
  const eClass = escapeHtml(className);
  const eDate = escapeHtml(classDate);
  const eTime = escapeHtml(startTime);
  const eLead = escapeHtml(leadLabel);
  const actionUrl = `${APP_URL}/dashboard/bookings`;
  const subject = `Reminder: ${className} starts in ${leadLabel}`;

  const html = emailWrapper(`Reminder: ${eClass} starts in ${eLead}`, `
    <p style="margin:0 0 4px;font-size:12px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:#e4c55a;">Class reminder</p>
    <h1 style="margin:0 0 16px;font-size:20px;font-weight:700;color:#fafafa;">Your class is coming up</h1>
    <p style="margin:0 0 12px;font-size:14px;color:#a1a1aa;">Hi ${eName},</p>
    <p style="margin:0 0 16px;font-size:14px;color:#a1a1aa;">
      <strong style="color:#fafafa;">${eClass}</strong> starts in <strong style="color:#fafafa;">${eLead}</strong>.
    </p>
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#09090b;border:1px solid #27272a;border-radius:10px;padding:14px 16px;margin-bottom:4px;">
      <tr>
        <td style="font-size:12px;color:#71717a;padding-bottom:8px;">When</td>
      </tr>
      <tr>
        <td style="font-size:15px;font-weight:600;color:#fafafa;">${eDate}</td>
      </tr>
      <tr>
        <td style="font-size:14px;color:#a1a1aa;padding-top:2px;">${eTime}</td>
      </tr>
    </table>
    ${ctaButton("View booking →", actionUrl)}
  `);

  const text = [
    `Hi ${memberName},`,
    ``,
    `${className} starts in ${leadLabel} — ${classDate} at ${startTime}.`,
    ``,
    `View your booking: ${actionUrl}`,
    ``,
    `— S&C Performance Coaching`,
  ].join("\n");

  return { subject, html, text };
}

// ─── Booking confirmation ──────────────────────────────────────────────────────

export interface BookingConfirmationEmailOpts {
  memberName: string;
  className: string;
  classDate: string;
  startTime: string;
  durationLabel: string;
  coachName?: string | null;
}

export function bookingConfirmationEmail(opts: BookingConfirmationEmailOpts): {
  subject: string;
  html: string;
  text: string;
} {
  const { memberName, className, classDate, startTime, durationLabel, coachName } = opts;
  const eName = escapeHtml(memberName);
  const eClass = escapeHtml(className);
  const eDate = escapeHtml(classDate);
  const eTime = escapeHtml(startTime);
  const eDur = escapeHtml(durationLabel);
  const eCoach = coachName ? escapeHtml(coachName) : null;
  const actionUrl = `${APP_URL}/dashboard/bookings`;
  const subject = `Booking confirmed: ${className}`;

  const html = emailWrapper(`Booking confirmed: ${eClass}`, `
    <p style="margin:0 0 4px;font-size:12px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:#e4c55a;">Booking confirmed</p>
    <h1 style="margin:0 0 16px;font-size:20px;font-weight:700;color:#fafafa;">You&#39;re booked in</h1>
    <p style="margin:0 0 12px;font-size:14px;color:#a1a1aa;">Hi ${eName},</p>
    <p style="margin:0 0 16px;font-size:14px;color:#a1a1aa;">
      You&#39;re confirmed for <strong style="color:#fafafa;">${eClass}</strong>.
    </p>
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#09090b;border:1px solid #27272a;border-radius:10px;padding:14px 16px;margin-bottom:4px;">
      <tr>
        <td style="font-size:12px;color:#71717a;padding-bottom:8px;">When</td>
      </tr>
      <tr>
        <td style="font-size:15px;font-weight:600;color:#fafafa;">${eDate}</td>
      </tr>
      <tr>
        <td style="font-size:14px;color:#a1a1aa;padding-top:2px;">${eTime} · ${eDur}</td>
      </tr>
      ${eCoach ? `<tr><td style="font-size:13px;color:#71717a;padding-top:10px;">Coach: ${eCoach}</td></tr>` : ""}
    </table>
    ${ctaButton("View booking →", actionUrl)}
  `);

  const text = [
    `Hi ${memberName},`,
    ``,
    `You're booked in for ${className}.`,
    ``,
    `When: ${classDate} at ${startTime} (${durationLabel})`,
    ...(coachName ? [`Coach: ${coachName}`] : []),
    ``,
    `View your booking: ${actionUrl}`,
    ``,
    `— S&C Performance Coaching`,
  ].join("\n");

  return { subject, html, text };
}

// ─── Booking cancellation ──────────────────────────────────────────────────────

export interface BookingCancellationEmailOpts {
  memberName: string;
  className: string;
  classDate: string;
  startTime: string;
  // Only true when a session credit was actually returned — the email mentions
  // restored credit ONLY in that case, and stays neutral otherwise.
  creditRestored: boolean;
}

export function bookingCancellationEmail(opts: BookingCancellationEmailOpts): {
  subject: string;
  html: string;
  text: string;
} {
  const { memberName, className, classDate, startTime, creditRestored } = opts;
  const eName = escapeHtml(memberName);
  const eClass = escapeHtml(className);
  const eDate = escapeHtml(classDate);
  const eTime = escapeHtml(startTime);
  const actionUrl = `${APP_URL}/dashboard/schedule`;
  const subject = `Booking cancelled: ${className}`;

  const creditLineHtml = creditRestored
    ? `<p style="margin:0 0 16px;font-size:14px;color:#a1a1aa;">Your session credit has been restored.</p>`
    : "";

  const html = emailWrapper(`Booking cancelled: ${eClass}`, `
    <p style="margin:0 0 4px;font-size:12px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:#e4c55a;">Booking cancelled</p>
    <h1 style="margin:0 0 16px;font-size:20px;font-weight:700;color:#fafafa;">Your booking is cancelled</h1>
    <p style="margin:0 0 12px;font-size:14px;color:#a1a1aa;">Hi ${eName},</p>
    <p style="margin:0 0 16px;font-size:14px;color:#a1a1aa;">
      Your booking for <strong style="color:#fafafa;">${eClass}</strong> on <strong style="color:#fafafa;">${eDate}</strong> at <strong style="color:#fafafa;">${eTime}</strong> has been cancelled.
    </p>
    ${creditLineHtml}
    ${ctaButton("Browse schedule →", actionUrl)}
  `);

  const text = [
    `Hi ${memberName},`,
    ``,
    `Your booking for ${className} on ${classDate} at ${startTime} has been cancelled.`,
    ...(creditRestored ? [``, `Your session credit has been restored.`] : []),
    ``,
    `Browse the schedule: ${actionUrl}`,
    ``,
    `— S&C Performance Coaching`,
  ].join("\n");

  return { subject, html, text };
}

// ─── Class cancelled by the club (staff/gym-initiated) ─────────────────────────

export interface ClassCancelledEmailOpts {
  memberName: string;
  className: string;
  classDate: string;
  startTime: string;
  // Only true when the member's session credit was actually returned.
  creditRestored: boolean;
}

export function classCancelledEmail(opts: ClassCancelledEmailOpts): {
  subject: string;
  html: string;
  text: string;
} {
  const { memberName, className, classDate, startTime, creditRestored } = opts;
  const eName = escapeHtml(memberName);
  const eClass = escapeHtml(className);
  const eDate = escapeHtml(classDate);
  const eTime = escapeHtml(startTime);
  const actionUrl = `${APP_URL}/dashboard/schedule`;
  const subject = `Class cancelled: ${className}`;

  const creditLineHtml = creditRestored
    ? `<p style="margin:0 0 16px;font-size:14px;color:#a1a1aa;">Your session credit has been returned to your account.</p>`
    : "";

  const html = emailWrapper(`Class cancelled: ${eClass}`, `
    <p style="margin:0 0 4px;font-size:12px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:#e4c55a;">Class cancelled</p>
    <h1 style="margin:0 0 16px;font-size:20px;font-weight:700;color:#fafafa;">A class you booked was cancelled</h1>
    <p style="margin:0 0 12px;font-size:14px;color:#a1a1aa;">Hi ${eName},</p>
    <p style="margin:0 0 16px;font-size:14px;color:#a1a1aa;">
      <strong style="color:#fafafa;">${eClass}</strong> on <strong style="color:#fafafa;">${eDate}</strong> at <strong style="color:#fafafa;">${eTime}</strong> has been cancelled by S&amp;C Performance Coaching. Apologies for the disruption.
    </p>
    ${creditLineHtml}
    <p style="margin:0 0 4px;font-size:14px;color:#a1a1aa;">You can book another session any time.</p>
    ${ctaButton("Browse schedule →", actionUrl)}
  `);

  const text = [
    `Hi ${memberName},`,
    ``,
    `${className} on ${classDate} at ${startTime} has been cancelled by S&C Performance Coaching. Apologies for the disruption.`,
    ...(creditRestored ? [``, `Your session credit has been returned to your account.`] : []),
    ``,
    `Browse the schedule to book another session: ${actionUrl}`,
    ``,
    `— S&C Performance Coaching`,
  ].join("\n");

  return { subject, html, text };
}

// ─── Lapsed membership ─────────────────────────────────────────────────────────

export interface LapsedMembershipEmailOpts {
  memberName: string;
  planName: string | null;
  periodEndDate: string | null;
}

export function lapsedMembershipEmail(opts: LapsedMembershipEmailOpts): {
  subject: string;
  html: string;
  text: string;
} {
  const { memberName, planName, periodEndDate } = opts;
  const eName = escapeHtml(memberName);
  const ePlan = planName ? escapeHtml(planName) : null;
  const eDate = periodEndDate ? escapeHtml(periodEndDate) : null;
  const actionUrl = `${APP_URL}/dashboard/membership`;
  const subject = "Your membership period has ended";

  const whenClause = ePlan
    ? `Your <strong style="color:#fafafa;">${ePlan}</strong> billing period${eDate ? ` ended on <strong style="color:#fafafa;">${eDate}</strong>` : " has ended"}.`
    : `Your billing period${eDate ? ` ended on <strong style="color:#fafafa;">${eDate}</strong>` : " has ended"}.`;

  const html = emailWrapper(subject, `
    <p style="margin:0 0 4px;font-size:12px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:#e4c55a;">Membership</p>
    <h1 style="margin:0 0 16px;font-size:20px;font-weight:700;color:#fafafa;">Your billing period has ended</h1>
    <p style="margin:0 0 12px;font-size:14px;color:#a1a1aa;">Hi ${eName},</p>
    <p style="margin:0 0 16px;font-size:14px;color:#a1a1aa;">
      ${whenClause} Select your plan again to keep booking classes.
    </p>
    ${ctaButton("Renew membership →", actionUrl)}
  `);

  const textWhenClause = planName
    ? `Your ${planName} billing period${periodEndDate ? ` ended on ${periodEndDate}` : " has ended"}.`
    : `Your billing period${periodEndDate ? ` ended on ${periodEndDate}` : " has ended"}.`;

  const text = [
    `Hi ${memberName},`,
    ``,
    textWhenClause,
    ``,
    `Select your plan again to keep booking classes: ${actionUrl}`,
    ``,
    `— S&C Performance Coaching`,
  ].join("\n");

  return { subject, html, text };
}

export interface LowPassBalanceEmailOpts {
  memberName: string;
  remaining: number;
}

export function lowPassBalanceEmail(opts: LowPassBalanceEmailOpts): {
  subject: string;
  html: string;
  text: string;
} {
  const { memberName, remaining } = opts;
  const eName = escapeHtml(memberName);
  const actionUrl = `${APP_URL}/dashboard/membership`;
  const noun = remaining === 1 ? "class pass" : "class passes";
  const subject = `You have ${remaining} ${noun} remaining`;

  const html = emailWrapper(subject, `
    <p style="margin:0 0 4px;font-size:12px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:#e4c55a;">Class passes</p>
    <h1 style="margin:0 0 16px;font-size:20px;font-weight:700;color:#fafafa;">${remaining} ${noun} remaining</h1>
    <p style="margin:0 0 12px;font-size:14px;color:#a1a1aa;">Hi ${eName},</p>
    <p style="margin:0 0 16px;font-size:14px;color:#a1a1aa;">
      You have <strong style="color:#fafafa;">${remaining} ${noun}</strong> remaining. Top up on the Membership page so you never miss a session.
    </p>
    ${ctaButton("Top up passes →", actionUrl)}
  `);

  const text = [
    `Hi ${memberName},`,
    ``,
    `You have ${remaining} ${noun} remaining.`,
    ``,
    `Top up on the Membership page: ${actionUrl}`,
    ``,
    `— S&C Performance Coaching`,
  ].join("\n");

  return { subject, html, text };
}

// ─── Password reset ────────────────────────────────────────────────────────────

export interface PasswordResetEmailOpts {
  resetToken: string;
}

export function passwordResetEmail(opts: PasswordResetEmailOpts): {
  subject: string;
  html: string;
  text: string;
} {
  const { resetToken } = opts;
  const actionUrl = `${APP_URL}/reset-password?token=${resetToken}`;
  const subject = "Reset your password";

  const html = emailWrapper(subject, `
    <p style="margin:0 0 4px;font-size:12px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:#e4c55a;">Password reset</p>
    <h1 style="margin:0 0 16px;font-size:20px;font-weight:700;color:#fafafa;">Reset your password</h1>
    <p style="margin:0 0 16px;font-size:14px;color:#a1a1aa;">
      We received a request to reset your password. This link expires in 15 minutes and can only be used once.
    </p>
    ${ctaButton("Reset password →", actionUrl)}
    <p style="margin:20px 0 0;font-size:12px;color:#52525b;">If you didn&#39;t request this, you can safely ignore this email — your password won&#39;t change.</p>
  `);

  const text = [
    `We received a request to reset your password.`,
    ``,
    `This link expires in 15 minutes and can only be used once:`,
    actionUrl,
    ``,
    `If you didn't request this, you can safely ignore this email — your password won't change.`,
    ``,
    `— S&C Performance Coaching`,
  ].join("\n");

  return { subject, html, text };
}

// ─── Contact form lead (staff notification, not member-facing) ──────────────

export interface ContactInquiryEmailOpts {
  name: string;
  email: string;
  phone: string | null;
  message: string;
}

export function contactInquiryEmail(opts: ContactInquiryEmailOpts): {
  subject: string;
  html: string;
  text: string;
} {
  const { name, email, phone, message } = opts;
  const eName = escapeHtml(name);
  const eEmail = escapeHtml(email);
  const ePhone = phone ? escapeHtml(phone) : null;
  const eMessage = escapeHtml(message).replace(/\n/g, "<br/>");
  const subject = `New website enquiry — ${name}`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /><title>${subject}</title></head>
<body style="margin:0;padding:0;background:#09090b;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr><td align="center" style="padding:32px 16px;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;">
        <tr><td style="padding-bottom:20px;">
          <span style="font-size:15px;font-weight:700;color:#e4c55a;letter-spacing:0.04em;">S&amp;C Performance Coaching — Website Enquiry</span>
        </td></tr>
        <tr><td style="background:#18181b;border:1px solid #27272a;border-radius:16px;padding:28px 24px;">
          <p style="margin:0 0 4px;font-size:12px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:#e4c55a;">New enquiry</p>
          <h1 style="margin:0 0 16px;font-size:20px;font-weight:700;color:#fafafa;">${eName}</h1>
          <p style="margin:0 0 6px;font-size:14px;color:#a1a1aa;">Email: <a href="mailto:${eEmail}" style="color:#fafafa;">${eEmail}</a></p>
          ${ePhone ? `<p style="margin:0 0 16px;font-size:14px;color:#a1a1aa;">Phone: <a href="tel:${ePhone}" style="color:#fafafa;">${ePhone}</a></p>` : ""}
          <p style="margin:16px 0 4px;font-size:12px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:#71717a;">Message</p>
          <p style="margin:0;font-size:14px;line-height:1.6;color:#e4e4e7;">${eMessage}</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = [
    `New website enquiry — ${name}`,
    ``,
    `Email: ${email}`,
    phone ? `Phone: ${phone}` : null,
    ``,
    `Message:`,
    message,
  ].filter((line) => line !== null).join("\n");

  return { subject, html, text };
}
