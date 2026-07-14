"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { DEFAULT_PALETTE, PALETTE_OPTIONS, isPaletteId, type PaletteId } from "@/lib/palettes";

// Square photos keep every avatar spot (sidebar, header, future rosters)
// consistent; 256px is plenty for the largest one we render.
const AVATAR_SIZE = 256;
const MAX_SOURCE_FILE_BYTES = 10 * 1024 * 1024;

// Center-crops the chosen image to a square and re-encodes it as a small
// JPEG data URL, so the upload is tiny regardless of the source photo.
async function fileToAvatarDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const sx = (bitmap.width - side) / 2;
  const sy = (bitmap.height - side) / 2;

  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_SIZE;
  canvas.height = AVATAR_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no-canvas");
  ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
  bitmap.close();

  return canvas.toDataURL("image/jpeg", 0.85);
}

export function AppearancePanel({
  fullName,
  initialAvatarDataUrl,
  initialPalette,
}: {
  fullName: string;
  initialAvatarDataUrl: string | null;
  initialPalette: string | null;
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [avatar, setAvatar] = useState<string | null>(initialAvatarDataUrl);
  const [palette, setPalette] = useState<PaletteId>(
    isPaletteId(initialPalette) ? initialPalette : DEFAULT_PALETTE
  );
  const [isSavingPhoto, setIsSavingPhoto] = useState(false);
  const [isSavingPalette, setIsSavingPalette] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const initials = (fullName || "?")
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  async function saveAppearance(patch: { avatarDataUrl?: string | null; palette?: PaletteId }) {
    const res = await fetch("/api/profile/appearance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.message ?? "Could not save. Please try again.");
    router.refresh();
  }

  async function handleFileChosen(file: File | undefined) {
    if (!file) return;
    setError(null);

    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
      setError("Choose a JPEG, PNG or WebP image.");
      return;
    }
    if (file.size > MAX_SOURCE_FILE_BYTES) {
      setError("That image is too large — choose one under 10MB.");
      return;
    }

    setIsSavingPhoto(true);
    try {
      const dataUrl = await fileToAvatarDataUrl(file);
      await saveAppearance({ avatarDataUrl: dataUrl });
      setAvatar(dataUrl);
    } catch (e) {
      setError(e instanceof Error && e.message !== "no-canvas" ? e.message : "Could not process that image.");
    } finally {
      setIsSavingPhoto(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleRemovePhoto() {
    setError(null);
    setIsSavingPhoto(true);
    try {
      await saveAppearance({ avatarDataUrl: null });
      setAvatar(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove the photo.");
    } finally {
      setIsSavingPhoto(false);
    }
  }

  async function handlePaletteSelect(next: PaletteId) {
    if (next === palette || isSavingPalette) return;
    setError(null);
    const previous = palette;
    setPalette(next);
    setIsSavingPalette(true);
    try {
      await saveAppearance({ palette: next });
    } catch (e) {
      setPalette(previous);
      setError(e instanceof Error ? e.message : "Could not save the palette.");
    } finally {
      setIsSavingPalette(false);
    }
  }

  return (
    <div className="panel px-5 py-4">
      {error ? (
        <p className="mb-3 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      ) : null}

      {/* Profile photo */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {avatar ? (
            <div
              aria-hidden="true"
              className="h-12 w-12 shrink-0 rounded-full bg-cover bg-center ring-1 ring-white/15"
              style={{ backgroundImage: `url(${avatar})` }}
            />
          ) : (
            <div
              aria-hidden="true"
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-teal-500 text-sm font-semibold text-white ring-1 ring-white/15"
            >
              {initials}
            </div>
          )}
          <div>
            <p className="text-sm font-medium text-zinc-100">Profile photo</p>
            <p className="mt-0.5 text-xs text-zinc-500">
              {avatar ? "Shown in place of your initials." : "Your initials are shown until you add one."}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(e) => handleFileChosen(e.target.files?.[0])}
            className="hidden"
            aria-label="Choose profile photo"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isSavingPhoto}
            className="btn-primary px-3.5 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSavingPhoto ? "Saving…" : avatar ? "Change photo" : "Add photo"}
          </button>
          {avatar ? (
            <button
              type="button"
              onClick={handleRemovePhoto}
              disabled={isSavingPhoto}
              className="rounded-lg border border-white/[0.1] bg-white/[0.05] px-3.5 py-1.5 text-xs font-medium text-zinc-300 transition-colors duration-150 hover:bg-white/[0.06] hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Remove
            </button>
          ) : null}
        </div>
      </div>

      {/* Accent palette */}
      <div className="mt-5 border-t border-white/[0.06] pt-4">
        <p className="text-sm font-medium text-zinc-100">Accent colour</p>
        <p className="mt-0.5 text-xs text-zinc-500">
          Changes buttons and highlights across the app. Preset options only.
        </p>
        <div role="radiogroup" aria-label="Accent colour palette" className="mt-3 flex flex-wrap gap-2">
          {PALETTE_OPTIONS.map((option) => {
            const selected = palette === option.id;
            return (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => handlePaletteSelect(option.id)}
                disabled={isSavingPalette}
                className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed ${
                  selected
                    ? "border-white/40 bg-white/[0.08] text-zinc-50"
                    : "border-white/[0.12] text-zinc-400 hover:border-white/30 hover:text-zinc-200"
                }`}
              >
                <span
                  aria-hidden="true"
                  className="h-3.5 w-3.5 rounded-full ring-1 ring-white/25"
                  style={{ backgroundColor: option.swatch }}
                />
                {option.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
