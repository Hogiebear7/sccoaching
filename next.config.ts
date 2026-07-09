import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Dev-only floating indicator disabled: it drifts into Playwright visual
  // baselines (and its issue counter changes), destabilising screenshots.
  devIndicators: false,
};

export default nextConfig;
