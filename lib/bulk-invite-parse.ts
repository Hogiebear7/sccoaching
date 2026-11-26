// Reading a pasted list or an uploaded file of people to invite. Pure (no database), so the staff page can show a preview straight away and the server can read the very same text
// again before it sends anything: the server never trusts what the page says it parsed.
//
// Accepted: one person per line, or several addresses on a line; a plain list of emails, or a spreadsheet saved as CSV (comma, semicolon or tab separated) where each row has an
// email and, optionally, a name. A first row that is a header ("Email", "Name") is ignored. Anything on a line that is not an email is kept as the person's name for the preview.
export const BULK_INVITE_MAX = 100;
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMAIL_FINDER = /[^\s,;<>"'()]+@[^\s,;<>"'()]+/g;

export interface ParsedInviteRow {
  email: string; // lower case
  name: string | null;
  line: number; // 1-based line in what was pasted
}

export interface InviteParseResult {
  rows: ParsedInviteRow[];
  /** Lines that had text but no usable email address. */
  invalid: { line: number; text: string }[];
  /** Addresses repeated later in the list (the first one is kept). */
  duplicates: { line: number; email: string }[];
  /** More than BULK_INVITE_MAX valid addresses: the extra ones are left out of rows and counted here. */
  overLimit: number;
}

function cleanName(text: string): string | null {
  const n = text.replace(/["']/g, "").replace(/\s+/g, " ").replace(/^[,;\t ]+|[,;\t ]+$/g, "").trim();
  return n && n.length <= 80 ? n : null;
}

export function parseInviteList(text: string): InviteParseResult {
  const rows: ParsedInviteRow[] = [];
  const invalid: InviteParseResult["invalid"] = [];
  const duplicates: InviteParseResult["duplicates"] = [];
  const seen = new Set<string>();
  let overLimit = 0;

  const lines = String(text ?? "").replace(/^﻿/, "").split(/\r\n|\n|\r/);
  lines.forEach((raw, index) => {
    const line = index + 1;
    const trimmed = raw.trim();
    if (!trimmed) return;
    const found = trimmed.match(EMAIL_FINDER) ?? [];
    if (found.length === 0) {
      // A header row ("Email,Name") is not an error.
      if (index === 0 || rows.length === 0) {
        if (/email|e-mail/i.test(trimmed)) return;
      }
      invalid.push({ line, text: trimmed.slice(0, 80) });
      return;
    }
    // One address on the line: whatever else is there is the name. Several: just addresses.
    const rest = found.length === 1 ? cleanName(trimmed.replace(found[0], " ")) : null;
    for (const candidate of found) {
      const email = candidate.replace(/[.,;:]+$/, "").toLowerCase();
      if (!EMAIL_RE.test(email) || email.length > 254) {
        invalid.push({ line, text: candidate.slice(0, 80) });
        continue;
      }
      if (seen.has(email)) {
        duplicates.push({ line, email });
        continue;
      }
      seen.add(email);
      if (rows.length >= BULK_INVITE_MAX) {
        overLimit += 1;
        continue;
      }
      rows.push({ email, name: rest, line });
    }
  });

  return { rows, invalid, duplicates, overLimit };
}

export type BulkInviteStatus = "ready" | "already_member" | "already_invited" | "sent" | "failed";

export const BULK_INVITE_STATUS_LABEL: Record<BulkInviteStatus, string> = {
  ready: "Ready to invite",
  already_member: "Already in your gym",
  already_invited: "Already invited",
  sent: "Invite sent",
  failed: "Could not send",
};
