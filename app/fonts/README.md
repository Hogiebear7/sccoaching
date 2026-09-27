# Self-hosted fonts

These font files replace the previous `next/font/google` build-time fetch
(see `app/layout.tsx`). They are consumed via `next/font/local`, so the build
no longer makes any network request to Google's servers — this was the one
network-dependent build step in the pipeline, and it failed once on the
Hostinger build host before a redeploy succeeded.

## Provenance

Each `.woff2` file was fetched once, by a developer, from
`https://fonts.googleapis.com/css2` — the same font-serving API
`next/font/google` itself uses internally — requesting the exact family,
weight(s), style(s) and `latin` subset that `app/layout.tsx` already used, with
a modern browser `User-Agent` so the API returns `woff2` URLs. The returned
`https://fonts.gstatic.com/...` file URLs were then downloaded directly. This
is Google's own sanctioned self-hosting pattern for its open-source font
catalog (the standard technique used to avoid a third-party font request at
runtime); nothing was pulled from an unverified or arbitrary source.

Each family's `OFL.txt` license file was fetched from Google's official Fonts
repository (`github.com/google/fonts`, the canonical distribution source for
these files' license text) at the matching path under `ofl/<family>/OFL.txt`.
All five families are licensed under the SIL Open Font License, Version 1.1.

## Why some directories hold one file for several weights

For `space-grotesk`, `oswald` and `fraunces`, Google's API returns the
*identical* file (confirmed by identical URL and SHA-256) for more than one
requested weight — those families ship one variable-range binary on Google
Fonts rather than separate static instances per weight. `app/layout.tsx`
declares one `next/font/local` `src` entry per weight/style exactly as before
(so the CSS output and weight/style coverage are unchanged), but the entries
point at the same physical file rather than storing duplicate bytes. IBM Plex
Mono ships genuinely distinct static files per weight, so it keeps one file
per weight.

## Files

| Family | Files | Weights (style) | Covers |
|---|---|---|---|
| Inter | `Inter-Variable.woff2` | 100–900 variable (normal) | `--font-inter` |
| Space Grotesk | `SpaceGrotesk-Variable.woff2` | 500, 600, 700 (normal) | `--font-space-grotesk` |
| Oswald | `Oswald-Variable.woff2` | 500, 600, 700 (normal) | `--font-oswald` |
| Fraunces | `Fraunces-Variable-Normal.woff2`, `Fraunces-Variable-Italic.woff2` | 600, 900 (normal + italic) | `--font-fraunces` |
| IBM Plex Mono | `IBMPlexMono-Regular.woff2`, `-Medium.woff2`, `-SemiBold.woff2` | 400, 500, 600 (normal) | `--font-plex-mono` |

Every file above is referenced from `app/layout.tsx`. Nothing in this
directory is unused.
