// The one place Community's two per-person privacy rules get resolved —
// every route that emits a person's name or decides whether they can be
// newly discovered must go through these, keyed off THAT PERSON's own
// CommunityPrivacyRecord, never the viewer's. Centralized so neither rule
// can drift between surfaces (see CommunityPrivacyRecord in lib/db.ts for
// the full policy).
import type { CommunityPrivacyRecord } from "./db";

// Real name, or first name + last initial when the person has opted out.
export function communityDisplayName(
  fullName: string,
  privacy: CommunityPrivacyRecord | undefined
): string {
  const trimmed = fullName.trim();
  if (privacy?.showRealName !== false) return trimmed;

  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return trimmed;
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

// Whether this person can be surfaced to someone who doesn't already follow
// them — search results, suggested-members, and new follow attempts. Never
// applies to an existing follow relationship (grandfathered at the call
// site, not here, since that requires knowing the viewer).
export function isDiscoverable(privacy: CommunityPrivacyRecord | undefined): boolean {
  return privacy?.discoverable !== false;
}
