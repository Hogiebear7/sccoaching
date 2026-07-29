// Shared validation for small cover-image data URLs (class covers, package
// covers). Mirrors the member-avatar pattern in app/api/profile/appearance —
// images are stored inline as JPEG/PNG/WebP data URLs in data/db.json, so the
// only server-side job is to bound the size and shape. Covers are landscape,
// so the cap is a little larger than the square avatar cap.

import { isBuiltinCoverSrc } from "@/lib/class-covers";

export const MAX_COVER_DATA_URL_LENGTH = 500_000;
export const MAX_COVER_ALT_LENGTH = 160;

const IMAGE_DATA_URL_PATTERN = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/;

export function isValidImageDataUrl(
  value: string,
  maxLength = MAX_COVER_DATA_URL_LENGTH
): boolean {
  return value.length <= maxLength && IMAGE_DATA_URL_PATTERN.test(value);
}

export type CoverImageResult =
  | { ok: true; value: string | null | undefined }
  | { ok: false };

// Resolves an untrusted `imageUrl` field from a create/edit request into a
// stored value: undefined = leave unchanged, null = remove, a valid uploaded
// data URL OR a known built-in cover path = set, anything else = reject. The
// built-in whitelist stops a client pointing imageUrl at an arbitrary URL.
// Keeps the class + catalog routes in sync.
export function resolveCoverImageInput(raw: unknown): CoverImageResult {
  if (raw === undefined) return { ok: true, value: undefined };
  if (raw === null) return { ok: true, value: null };
  if (typeof raw === "string" && (isValidImageDataUrl(raw) || isBuiltinCoverSrc(raw))) {
    return { ok: true, value: raw };
  }
  return { ok: false };
}

export type CoverAltResult =
  | { ok: true; value: string | null | undefined }
  | { ok: false };

// Resolves an untrusted `imageAlt` field: undefined = leave unchanged, null or
// blank = decorative (stored null), a non-empty string within the length cap =
// set, over-long = reject. Blank alt is a valid, intentional "decorative"
// choice — never forced.
export function resolveCoverAltInput(raw: unknown): CoverAltResult {
  if (raw === undefined) return { ok: true, value: undefined };
  if (raw === null) return { ok: true, value: null };
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed.length === 0) return { ok: true, value: null };
    if (trimmed.length > MAX_COVER_ALT_LENGTH) return { ok: false };
    return { ok: true, value: trimmed };
  }
  return { ok: false };
}
