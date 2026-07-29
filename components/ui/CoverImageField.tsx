"use client";

import { useId, useRef, useState } from "react";

import { ClassImageSlot } from "@/components/ui/ClassImageSlot";
import { BUILTIN_COVERS, suggestAltForCover, type BuiltinCover } from "@/lib/class-covers";
import { MAX_COVER_ALT_LENGTH } from "@/lib/image-upload";

// Reusable cover-image picker for staff forms (class + membership package).
// Mirrors the member-avatar upload: choose a file, it's client-cropped to a
// small 16:9 JPEG data URL, previewed in place, and removable. Fully
// controlled — the parent form owns `value` and receives the new data URL (or
// null on remove). Optional: not required.

const COVER_W = 800;
const COVER_H = 450; // 16:9 — matches the ClassImageSlot header/rail aspect
const MAX_SOURCE_FILE_BYTES = 10 * 1024 * 1024;

// Center-crops to 16:9 and re-encodes as a compact JPEG data URL.
async function fileToCoverDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const targetRatio = COVER_W / COVER_H;
  const srcRatio = bitmap.width / bitmap.height;

  let sw = bitmap.width;
  let sh = bitmap.height;
  if (srcRatio > targetRatio) sw = Math.round(bitmap.height * targetRatio);
  else sh = Math.round(bitmap.width / targetRatio);
  const sx = (bitmap.width - sw) / 2;
  const sy = (bitmap.height - sh) / 2;

  const canvas = document.createElement("canvas");
  canvas.width = COVER_W;
  canvas.height = COVER_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no-canvas");
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, COVER_W, COVER_H);
  bitmap.close();

  return canvas.toDataURL("image/jpeg", 0.78);
}

export function CoverImageField({
  value,
  onChange,
  alt,
  onAltChange,
  recommendedSrc,
  onAnnounce,
  seed,
  label,
  title = "Cover image",
  hint = "Optional — shown on the schedule and landing cards. A placeholder is used if none is set.",
}: {
  value: string | null;
  onChange: (dataUrl: string | null) => void;
  /** Cover alt text (controlled). Blank = decorative. */
  alt: string;
  onAltChange: (alt: string) => void;
  /** Optional built-in cover path to highlight as "Suggested" in the picker
      (e.g. the class category's best-fit). Purely a visual affordance — picking
      it is still an explicit manual action. */
  recommendedSrc?: string | null;
  /** Optional: route apply/remove confirmations to a parent-owned live region
      instead of this field's own. When provided, no internal live region is
      rendered — so the parent can share ONE region across the whole cover
      workflow (e.g. also announcing its own "accept suggestion" action). */
  onAnnounce?: (message: string) => void;
  /** Placeholder seed (class id / category / package id). */
  seed: string;
  /** Faded label rendered on the placeholder (e.g. category / package name). */
  label?: string;
  title?: string;
  hint?: string;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showBuiltins, setShowBuiltins] = useState(false);
  // Polite live-region text — announces cover apply/remove for screen readers.
  // Set only from user actions below, so it never fires on mount/edit-load and
  // (being aria-live) only re-announces when the message text actually changes.
  // When a parent passes `onAnnounce`, we route to its shared region instead so
  // the whole workflow uses ONE live region.
  const [liveMessage, setLiveMessage] = useState("");
  const announce = (message: string) =>
    onAnnounce ? onAnnounce(message) : setLiveMessage(message);
  const altId = useId();

  // Removing the cover also clears its alt — alt is meaningless with no image.
  function handleRemove() {
    onChange(null);
    onAltChange("");
    setShowBuiltins(false);
    announce("Cover image removed");
  }

  function handlePickBuiltin(cover: BuiltinCover) {
    onChange(cover.src);
    // Prefill a concise, editable default alt — without overwriting custom text.
    onAltChange(suggestAltForCover(alt, cover));
    setShowBuiltins(false);
    setError(null);
    announce(`${cover.label} cover applied`);
  }

  async function handleFile(file: File | undefined) {
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
    setBusy(true);
    try {
      onChange(await fileToCoverDataUrl(file));
      announce("Cover image applied");
    } catch (e) {
      setError(e instanceof Error && e.message !== "no-canvas" ? e.message : "Could not process that image.");
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return (
    <div>
      {/* Polite, visually-hidden confirmation for screen readers. Suppressed
          when a parent owns the shared region (via onAnnounce). */}
      {onAnnounce ? null : (
        <p aria-live="polite" role="status" className="sr-only">
          {liveMessage}
        </p>
      )}
      <p className="mb-1.5 block text-xs font-medium text-muted-foreground">{title}</p>
      <div className="flex flex-wrap items-center gap-3">
        {/* Live preview — real image if set, on-brand placeholder otherwise */}
        <ClassImageSlot
          seed={seed}
          label={label}
          imageUrl={value}
          className="h-16 w-28 shrink-0 rounded-lg ring-1 ring-white/10"
        />
        <div className="flex gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(e) => handleFile(e.target.files?.[0])}
            className="hidden"
            aria-label="Choose cover image"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={busy}
            className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? "Processing…" : value ? "Change image" : "Upload"}
          </button>
          <button
            type="button"
            onClick={() => setShowBuiltins((v) => !v)}
            aria-expanded={showBuiltins}
            disabled={busy}
            className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
          >
            Built-in
          </button>
          {value ? (
            <button
              type="button"
              onClick={handleRemove}
              disabled={busy}
              className="rounded-lg border border-destructive/30 px-3 py-1.5 text-xs font-medium text-destructive transition hover:border-destructive/60 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Remove
            </button>
          ) : null}
        </div>
      </div>

      {/* Curated built-in covers — pick one instead of uploading. */}
      {showBuiltins ? (
        <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
          {BUILTIN_COVERS.map((cover) => {
            const selected = value === cover.src;
            const recommended = !!recommendedSrc && recommendedSrc === cover.src;
            return (
              <button
                key={cover.id}
                type="button"
                onClick={() => handlePickBuiltin(cover)}
                aria-pressed={selected}
                // Deterministic accessible name so screen readers announce the
                // recommendation (the visible badge/label are decorative here).
                aria-label={recommended ? `${cover.label} cover, suggested` : `${cover.label} cover`}
                title={cover.label}
                className={`relative overflow-hidden rounded-lg ring-1 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-card ${
                  selected
                    ? "ring-2 ring-primary"
                    : recommended
                    ? "ring-1 ring-primary/50 hover:ring-primary/70"
                    : "ring-white/10 hover:ring-white/30"
                }`}
              >
                <ClassImageSlot seed={cover.id} imageUrl={cover.src} className="h-12 w-full" />
                {recommended ? (
                  <span aria-hidden className="absolute left-1 top-1 rounded bg-primary/90 px-1 py-px text-[8px] font-semibold uppercase tracking-wide text-primary-foreground shadow-sm">
                    Suggested
                  </span>
                ) : null}
                <span aria-hidden className="block truncate px-1 py-0.5 text-[10px] text-muted-foreground">{cover.label}</span>
              </button>
            );
          })}
        </div>
      ) : null}

      {/* Alt text — only relevant once a cover is set. Blank = decorative. */}
      {value ? (
        <div className="mt-3">
          <label htmlFor={altId} className="mb-1 block text-xs font-medium text-muted-foreground">
            Alt text (optional)
          </label>
          <input
            id={altId}
            type="text"
            value={alt}
            maxLength={MAX_COVER_ALT_LENGTH}
            onChange={(e) => onAltChange(e.target.value)}
            placeholder="Describe the image (leave blank if decorative)"
            className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-teal-600/60 focus:ring-2 focus:ring-teal-600/15"
          />
          <p className="mt-1 text-[11px] leading-snug text-muted-foreground/70">
            Read by screen readers. Leave blank for a decorative image.
          </p>
        </div>
      ) : null}

      {error ? <p className="mt-1.5 text-[11px] text-destructive">{error}</p> : null}
      <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground/70">{hint}</p>
    </div>
  );
}
