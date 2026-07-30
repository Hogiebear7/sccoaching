// Image-forward header/accent for class & programme cards. There are no real
// class photos in the data model yet, so this renders an intentional on-brand
// placeholder (a deterministic ink→steel-blue gradient with a gold streak and
// an activity watermark). It already accepts an optional `imageUrl`, so real
// imagery can drop in later with no layout change — text stays legible via the
// overlay gradient either way. Decorative by default (aria-hidden).

// Deterministic hue within the navy/steel-blue range so different classes
// look distinct but cohesive; the gold accent streak stays constant (one
// accent color per brand, not seed-varied).
function hueFor(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return 228 + (h % 40); // ~228–268
}

export function ClassImageSlot({
  seed,
  label,
  imageUrl,
  alt,
  className,
}: {
  /** Stable string (class id / category) → picks the placeholder hue. */
  seed: string;
  /** Optional faded label rendered large in the corner (e.g. category). */
  label?: string;
  /** A real cover image (data URL or built-in path). When present it fills the
      slot as a native <img> with an overlay. */
  imageUrl?: string | null;
  /** Alt text for the cover. A non-empty value makes the image meaningful (used
      as the native img alt); null/blank keeps it decorative (alt=""). */
  alt?: string | null;
  className?: string;
}) {
  const hue = hueFor(seed);
  // Meaningful only when there's actually an image AND staff gave it alt text.
  const describedAlt = imageUrl && alt && alt.trim() ? alt.trim() : null;

  return (
    // Decorative as a whole (placeholder art, faded label, gradients) unless a
    // meaningful cover is present — then the inner <img> carries the label and
    // the wrapper must stay visible to screen readers.
    <div
      className={`relative overflow-hidden ${className ?? ""}`}
      {...(describedAlt ? {} : { "aria-hidden": true })}
    >
      {imageUrl ? (
        <>
          {/* Native <img> so alt is handled the standard way: the described
              text when meaningful, empty string when purely decorative. Covers
              are inline data URLs or small static SVGs, which next/image can't
              meaningfully optimize, so a plain <img> is the right primitive. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageUrl}
            alt={describedAlt ?? ""}
            className="absolute inset-0 h-full w-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/35 to-black/10" />
        </>
      ) : (
        <>
          <div
            className="absolute inset-0"
            style={{
              background: `linear-gradient(135deg, oklch(0.24 0.05 ${hue}) 0%, oklch(0.16 0.03 ${hue}) 58%, oklch(0.12 0.02 ${(hue + 24) % 360}) 100%)`,
            }}
          />
          {/* faint grid texture */}
          <div
            className="absolute inset-0 opacity-[0.07]"
            style={{
              backgroundImage:
                "linear-gradient(oklch(1 0 0 / 0.6) 1px, transparent 1px), linear-gradient(90deg, oklch(1 0 0 / 0.6) 1px, transparent 1px)",
              backgroundSize: "22px 22px",
            }}
          />
          {/* angular gold streak (brand accent, not seed-varied) */}
          <div className="absolute -right-5 top-0 h-full w-14 -skew-x-[18deg] bg-primary/[0.14]" />
          <div className="absolute right-2 top-0 h-full w-1.5 -skew-x-[18deg] bg-primary/60" />
          {/* activity watermark */}
          <svg
            viewBox="0 0 24 24"
            fill="none"
            style={{ stroke: "var(--primary)" }}
            strokeWidth={1.25}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="absolute -bottom-3 left-3 h-20 w-20 opacity-15"
          >
            <path d="M6.5 6.5 17.5 17.5M4 8l-1 1 3 3 1-1M20 16l1-1-3-3-1 1M8 4l-1 1 3 3 1-1M16 20l1-1-3-3-1 1" />
          </svg>
        </>
      )}
      {label ? (
        <span
          aria-hidden
          className="text-condensed absolute right-3 top-2 max-w-[70%] truncate text-right text-2xl uppercase leading-none text-white/[0.14]"
        >
          {label}
        </span>
      ) : null}
      {/* Bottom fade so overlaid card content reads cleanly */}
      <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/60 to-transparent" />
    </div>
  );
}
