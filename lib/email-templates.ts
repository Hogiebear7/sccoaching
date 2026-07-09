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
