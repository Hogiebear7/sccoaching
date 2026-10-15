// Verification of Apple-signed JWS payloads (App Store Server Notifications V2, signed transactions and renewal info, and the
// App Store Server API's responses). No SDK dependency, by the same convention as lib/providers/google-play.ts: Node's
// crypto does everything required.
//
// What is checked, in this order, and what each protects against:
//
//   1. The JWS is three base64url parts, its header names alg ES256 and carries an x5c chain of exactly three certificates
//      (leaf, intermediate, root). Anything else is rejected: an unsigned or differently-signed token ("alg": "none", HS256)
//      can never pass.
//   2. Each certificate is currently valid, and each is signed by the next one up the chain. A chain that does not link is a
//      forgery attempt or a corrupt token.
//   3. The ROOT is one of the pinned Apple roots (compared as whole certificates, not by name). This is what makes the whole
//      chain Apple's: anyone can build a self-consistent chain, nobody but Apple can chain to Apple's root. The pinned roots
//      come from configuration (APP_STORE_ROOT_CERTIFICATES_BASE64); none is compiled in, so a deployment with no roots
//      configured fails closed ("not_configured") rather than trusting something unverified.
//   4. The leaf and intermediate carry Apple's marker extensions (the OIDs below), so a certificate Apple issued for some
//      other purpose cannot be used to sign a payload.
//   5. The JWS signature verifies against the LEAF's public key (ES256, IEEE P1363 encoding as JOSE defines).
//
// Nothing here makes a network call. A caller that wants the payload never reads it before verification returns ok.

import { createPublicKey, verify, X509Certificate } from "crypto";

export type JwsFailureCode =
  | "not_configured"
  | "malformed"
  | "unsupported_algorithm"
  | "bad_chain"
  | "untrusted_root"
  | "certificate_expired"
  | "missing_apple_marker"
  | "bad_signature";

export type JwsResult<T> = { ok: true; payload: T } | { ok: false; code: JwsFailureCode };

// DER encodings of OID 1.2.840.113635.100.6.11.1 (Apple's leaf marker for signing certificates used by StoreKit) and
// 1.2.840.113635.100.6.2.1 (Apple Worldwide Developer Relations intermediate marker). Matched as byte sequences inside
// the certificate's DER, which is how Apple's own server libraries check them.
const OID_LEAF_MARKER = Buffer.from("060a2a864886f76364060b01", "hex");
const OID_INTERMEDIATE_MARKER = Buffer.from("060a2a864886f76364060201", "hex");

const b64url = (input: string): Buffer => Buffer.from(input.replace(/-/g, "+").replace(/_/g, "/"), "base64");

export interface VerifyJwsOptions {
  /** Pinned Apple root certificates (PEM or DER). The chain's root must equal one of them. */
  roots: readonly (string | Buffer)[];
  /** The time certificate validity is judged at. Defaults to now. */
  atMs?: number;
  /** Require Apple's marker extensions on the leaf and intermediate. Defaults to true. Tests with generated chains include them. */
  requireAppleMarkers?: boolean;
}

function contains(haystack: Buffer, needle: Buffer): boolean {
  return haystack.indexOf(needle) !== -1;
}

export function parsePemBundle(pem: string): X509Certificate[] {
  const blocks = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) ?? [];
  const certs: X509Certificate[] = [];
  for (const block of blocks) {
    try {
      certs.push(new X509Certificate(block));
    } catch {
      // A block that does not parse is skipped; an empty result fails closed in verifyAppleJws.
    }
  }
  return certs;
}

export function verifyAppleJws<T = Record<string, unknown>>(jws: unknown, options: VerifyJwsOptions): JwsResult<T> {
  if (typeof jws !== "string" || jws.length === 0 || jws.length > 100_000) return { ok: false, code: "malformed" };

  const parts = jws.split(".");
  if (parts.length !== 3 || parts.some((p) => p.length === 0)) return { ok: false, code: "malformed" };
  const [headerPart, payloadPart, signaturePart] = parts;

  let header: { alg?: unknown; x5c?: unknown };
  let payload: T;
  try {
    header = JSON.parse(b64url(headerPart).toString("utf8")) as typeof header;
    payload = JSON.parse(b64url(payloadPart).toString("utf8")) as T;
  } catch {
    return { ok: false, code: "malformed" };
  }
  if (header.alg !== "ES256") return { ok: false, code: "unsupported_algorithm" };
  if (!Array.isArray(header.x5c) || header.x5c.length !== 3 || !header.x5c.every((c) => typeof c === "string")) {
    return { ok: false, code: "bad_chain" };
  }

  // Fail closed when no root is configured: nothing can be trusted.
  const pinned: X509Certificate[] = [];
  for (const root of options.roots) {
    try {
      if (typeof root === "string" && root.includes("BEGIN CERTIFICATE")) pinned.push(...parsePemBundle(root));
      else pinned.push(new X509Certificate(root));
    } catch {
      // ignored: see above
    }
  }
  if (pinned.length === 0) return { ok: false, code: "not_configured" };

  let leaf: X509Certificate;
  let intermediate: X509Certificate;
  let root: X509Certificate;
  try {
    [leaf, intermediate, root] = (header.x5c as string[]).map((c) => new X509Certificate(Buffer.from(c, "base64")));
  } catch {
    return { ok: false, code: "bad_chain" };
  }

  const atMs = options.atMs ?? Date.now();
  for (const cert of [leaf, intermediate, root]) {
    if (new Date(cert.validFrom).getTime() > atMs || new Date(cert.validTo).getTime() < atMs) return { ok: false, code: "certificate_expired" };
  }

  // Each certificate is signed by the next, and the last one is exactly a pinned root (whole-certificate comparison).
  try {
    if (!leaf.verify(intermediate.publicKey) || !intermediate.verify(root.publicKey) || !root.verify(root.publicKey)) {
      return { ok: false, code: "bad_chain" };
    }
  } catch {
    return { ok: false, code: "bad_chain" };
  }
  if (!pinned.some((p) => p.raw.equals(root.raw))) return { ok: false, code: "untrusted_root" };

  if (options.requireAppleMarkers !== false) {
    if (!contains(leaf.raw, OID_LEAF_MARKER) || !contains(intermediate.raw, OID_INTERMEDIATE_MARKER)) {
      return { ok: false, code: "missing_apple_marker" };
    }
  }

  let signatureOk = false;
  try {
    signatureOk = verify(
      "sha256",
      Buffer.from(`${headerPart}.${payloadPart}`, "utf8"),
      { key: createPublicKey(leaf.publicKey.export({ type: "spki", format: "pem" })), dsaEncoding: "ieee-p1363" },
      b64url(signaturePart)
    );
  } catch {
    signatureOk = false;
  }
  if (!signatureOk) return { ok: false, code: "bad_signature" };

  return { ok: true, payload };
}
