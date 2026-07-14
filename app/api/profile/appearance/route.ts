import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { findProfileByUserId, findUserById, saveProfile } from "@/lib/db";
import { isPaletteId, isThemeId } from "@/lib/palettes";
import { verifySession } from "@/lib/session";

// The client downsizes photos to a small square JPEG before upload, so this
// cap (~330KB of base64 ≈ 240KB binary) is generous headroom, not a target.
const MAX_AVATAR_DATA_URL_LENGTH = 330_000;

// Strict allow-list: base64 data URLs for raster formats only. No SVG (can
// carry script), no external URLs, nothing else.
const AVATAR_DATA_URL_PATTERN = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/;

// Updates appearance-only profile fields: the accent palette preset and/or
// the profile photo. Both are optional per request; omitted fields are left
// untouched. avatarDataUrl: null explicitly removes the photo.
export async function POST(request: NextRequest) {
  const userId = verifySession(request.cookies.get("session")?.value)?.userId ?? null;
  const user = userId ? findUserById(userId) : undefined;

  if (!user) {
    return NextResponse.json(
      { success: false, message: "You must be signed in." },
      { status: 401 }
    );
  }

  const profile = findProfileByUserId(user.id);

  if (!profile) {
    return NextResponse.json(
      { success: false, message: "No profile found for this account." },
      { status: 404 }
    );
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, message: "Invalid JSON body." },
      { status: 400 }
    );
  }

  const { palette, theme, avatarDataUrl } = (body ?? {}) as Record<string, unknown>;
  const updated = { ...profile };
  let changed = false;

  if (palette !== undefined) {
    if (!isPaletteId(palette)) {
      return NextResponse.json(
        { success: false, message: "Choose one of the preset palettes." },
        { status: 400 }
      );
    }
    updated.palette = palette;
    changed = true;
  }

  if (theme !== undefined) {
    if (!isThemeId(theme)) {
      return NextResponse.json(
        { success: false, message: "Choose one of the preset themes." },
        { status: 400 }
      );
    }
    updated.theme = theme;
    changed = true;
  }

  if (avatarDataUrl !== undefined) {
    if (avatarDataUrl === null) {
      updated.avatarDataUrl = null;
      changed = true;
    } else if (
      typeof avatarDataUrl === "string" &&
      avatarDataUrl.length <= MAX_AVATAR_DATA_URL_LENGTH &&
      AVATAR_DATA_URL_PATTERN.test(avatarDataUrl)
    ) {
      updated.avatarDataUrl = avatarDataUrl;
      changed = true;
    } else {
      return NextResponse.json(
        {
          success: false,
          message: "Photo must be a JPEG, PNG or WebP image under 240KB.",
        },
        { status: 400 }
      );
    }
  }

  if (!changed) {
    return NextResponse.json(
      { success: false, message: "Nothing to update." },
      { status: 400 }
    );
  }

  updated.updatedAt = new Date().toISOString();
  saveProfile(updated);

  return NextResponse.json({ success: true, message: "Appearance updated." }, { status: 200 });
}
