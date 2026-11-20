"use client";

import { FloatingParticles, FractalNoise, Shader } from "shaders/react";

// Chalk dust only (no navy base), so it can sit over the hero photo: a faint pale mist with fine specks drifting upward.
// Same settings as the old homepage haze (HeroShaderCanvas). Rendered at half size and scaled 2x, telemetry off.
// `strong` (phones) makes the specks bigger, more numerous and brighter, since the dust is harder to see on a small screen.
export default function ChalkDustCanvas({ onReady, strong = false }: { onReady?: () => void; strong?: boolean }) {
  return (
    <div className="absolute left-0 top-0 h-1/2 w-1/2 origin-top-left scale-200">
      <Shader className="h-full w-full" disableTelemetry onReady={onReady}>
        <FractalNoise colorA="#000000" colorB="#c3cddb" octaves={3} contrast={0.6} speed={0.06} opacity={strong ? 0.12 : 0.1} blendMode="screen" />
        <FloatingParticles
          count={strong ? 170 : 140}
          speed={0.04}
          angle={90}
          angleVariance={40}
          particleSize={strong ? 0.85 : 0.7}
          softness={0.5}
          twinkle={0.3}
          particleColor="#dfe4ec"
          opacity={strong ? 0.55 : 0.45}
          blendMode="screen"
        />
      </Shader>
    </div>
  );
}
