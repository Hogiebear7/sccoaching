import type { CSSProperties } from "react";

// Static navy haze, in the same colours as HeroShaderCanvas's NAVY_STOPS.
// The homepage hero shows it under the animated shader; inner pages use it
// alone (the animated haze stays a homepage-only moment).
export const STATIC_HAZE: CSSProperties = {
  backgroundImage: [
    "radial-gradient(55% 45% at 85% 5%, rgb(90 74 44 / 0.35), transparent 70%)",
    "radial-gradient(60% 50% at 25% 30%, rgb(195 205 219 / 0.07), transparent 70%)",
    "linear-gradient(160deg, #1f3b63 0%, #142b4a 30%, #0a1526 65%, #030a16 100%)",
  ].join(", "),
};
