/** @type {import('next').NextConfig} */
const nextConfig = {
  // Dev-only floating indicator disabled: it drifts into Playwright visual
  // baselines (and its issue counter changes), destabilising screenshots.
  devIndicators: false,

  // Low-risk, broadly-safe security headers. Deliberately NOT including a
  // Content-Security-Policy here — getting one right for this app's actual
  // script/style sources needs real testing, not a blind default that could
  // break the app; leave that for a dedicated follow-up.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
