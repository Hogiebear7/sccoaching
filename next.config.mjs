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
        // Everything except the public legal pages (see the /privacy,/terms
        // rule below) — X-Frame-Options has no "allow" value, so keeping
        // these two out of a real clickjacking risk (auth, dashboard,
        // staff/admin, payment) means excluding them from the matcher here
        // rather than trying to override the header's value afterwards.
        source: "/:path((?!privacy|terms).*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
      {
        // Privacy Policy and Terms are static text with no forms, auth, or
        // payment actions, so framing them carries none of the clickjacking
        // risk DENY protects against elsewhere. They need to stay
        // embeddable because external automated checks load them in a
        // frame to confirm they're real — e.g. Google Play Console's Data
        // Safety form flags "we couldn't find the URL" against an
        // X-Frame-Options: DENY page even though the URL works fine in a
        // normal browser tab.
        source: "/(privacy|terms)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
