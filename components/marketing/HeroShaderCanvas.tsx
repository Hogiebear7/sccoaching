"use client";

import { FloatingParticles, FractalNoise, MeshGradient, Shader } from "shaders/react";

// Hex equivalents of the navy theme tokens in app/globals.css (the shaders
// package only takes hex/rgb colors, not OKLCH), stretched a little either
// way so the slow drift reads as light moving across the surface. The gold
// point is muted --primary (#c6a15b), echoing the theme's top-right glow.
const NAVY_STOPS = [
  { color: "#030a16", position: 0 }, // deeper than --sidebar
  { color: "#0a1526", position: 0.25 }, // --bg-0
  { color: "#142b4a", position: 0.5 }, // --surface-2
  { color: "#1f3b63", position: 0.75 }, // lighter steel navy
  { color: "#5a4a2c", position: 1 }, // muted gold
];

// Kept in its own module so HeroShader can lazy-load it: next/dynamic emits a
// CommonJS require.resolveWeak() for whatever it imports, and `shaders/react`
// is exported for ESM `import` only, so it must not be next/dynamic's direct target.
//
// Chalk dust / gym haze: the navy base under a slow, pale drifting cloud with
// a sparse field of fine chalk specks floating upward.
export default function HeroShaderCanvas() {
  return (
    <Shader className="h-full w-full">
      <MeshGradient stops={NAVY_STOPS} colorSpace="oklab" count={5} speed={0.3} drift={0.4} swirl={0.15} />
      <FractalNoise colorA="#000000" colorB="#c3cddb" octaves={5} contrast={0.6} speed={0.06} opacity={0.07} blendMode="screen" />
      <FloatingParticles
        count={120}
        speed={0.04}
        angle={90}
        angleVariance={40}
        particleSize={0.6}
        softness={0.5}
        twinkle={0.3}
        particleColor="#dfe4ec"
        opacity={0.25}
        blendMode="screen"
      />
    </Shader>
  );
}
