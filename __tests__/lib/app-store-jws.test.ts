// lib/providers/app-store-jws.ts against GENERATED test chains (see __tests__/fixtures/app-store/gen.sh). Nothing here is Apple's:
// the "root" is a throwaway certificate, so what is proven is that the verifier accepts exactly what chains to the pinned root
// with Apple's marker extensions and a valid ES256 signature, and rejects everything else. No network.
import { describe, expect, it } from "vitest";

import { verifyAppleJws } from "@/lib/providers/app-store-jws";

import { GOOD_ROOT_PEM, NOMARKER_ROOT_PEM, signJws } from "../helpers/app-store-fixture";

const PAYLOAD = { transactionId: "t1", originalTransactionId: "o1", bundleId: "com.example.fake.app" };
const roots = [GOOD_ROOT_PEM];
const split = (jws: string) => jws.split(".") as [string, string, string];
const b64url = (s: string) => Buffer.from(s).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");

describe("verifyAppleJws", () => {
  it("accepts a payload signed through a chain that ends at the pinned root, and returns it", () => {
    const result = verifyAppleJws<typeof PAYLOAD>(signJws(PAYLOAD), { roots });
    expect(result).toEqual({ ok: true, payload: PAYLOAD });
  });

  it("accepts the root given as a DER buffer as well as PEM", () => {
    const der = Buffer.from(GOOD_ROOT_PEM.replace(/-----[A-Z ]+-----|\s/g, ""), "base64");
    expect(verifyAppleJws(signJws(PAYLOAD), { roots: [der] }).ok).toBe(true);
  });

  it("fails closed when no root is configured: nothing can be trusted", () => {
    expect(verifyAppleJws(signJws(PAYLOAD), { roots: [] })).toEqual({ ok: false, code: "not_configured" });
    expect(verifyAppleJws(signJws(PAYLOAD), { roots: ["not a certificate"] })).toEqual({ ok: false, code: "not_configured" });
  });

  it("rejects a complete, self-consistent chain that does NOT lead to the pinned root", () => {
    expect(verifyAppleJws(signJws(PAYLOAD, "rogue"), { roots })).toEqual({ ok: false, code: "untrusted_root" });
  });

  it("rejects a payload altered after signing", () => {
    const [h, , s] = split(signJws(PAYLOAD));
    const forged = `${h}.${b64url(JSON.stringify({ ...PAYLOAD, originalTransactionId: "someone-elses" }))}.${s}`;
    expect(verifyAppleJws(forged, { roots })).toEqual({ ok: false, code: "bad_signature" });
  });

  it("rejects a signature made by a different key under a genuine-looking header", () => {
    const [goodH, goodP] = split(signJws(PAYLOAD, "good"));
    const [, , rogueSig] = split(signJws(PAYLOAD, "rogue"));
    expect(verifyAppleJws(`${goodH}.${goodP}.${rogueSig}`, { roots })).toEqual({ ok: false, code: "bad_signature" });
  });

  it.each(["none", "HS256", "RS256", "ES384"])("rejects algorithm %s", (alg) => {
    expect(verifyAppleJws(signJws(PAYLOAD, "good", { alg }), { roots })).toEqual({ ok: false, code: "unsupported_algorithm" });
  });

  it("rejects a header with the wrong number of certificates, or none", () => {
    const [h, p, s] = split(signJws(PAYLOAD));
    const header = JSON.parse(Buffer.from(h.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString());
    for (const x5c of [[], header.x5c.slice(0, 2), [...header.x5c, header.x5c[2]], undefined, "x"]) {
      const mutated = `${b64url(JSON.stringify({ ...header, x5c }))}.${p}.${s}`;
      expect(verifyAppleJws(mutated, { roots }).ok).toBe(false);
    }
  });

  it("rejects a chain whose certificates are out of order", () => {
    const [h, p, s] = split(signJws(PAYLOAD));
    const header = JSON.parse(Buffer.from(h.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString());
    const reordered = `${b64url(JSON.stringify({ ...header, x5c: [header.x5c[1], header.x5c[0], header.x5c[2]] }))}.${p}.${s}`;
    expect(verifyAppleJws(reordered, { roots })).toEqual({ ok: false, code: "bad_chain" });
  });

  it("rejects certificates outside their validity window", () => {
    expect(verifyAppleJws(signJws(PAYLOAD), { roots, atMs: Date.parse("2200-01-01") })).toEqual({ ok: false, code: "certificate_expired" });
    expect(verifyAppleJws(signJws(PAYLOAD), { roots, atMs: Date.parse("2000-01-01") })).toEqual({ ok: false, code: "certificate_expired" });
  });

  it("requires Apple's marker extension on the leaf, so a certificate issued for another purpose cannot sign", () => {
    const jws = signJws(PAYLOAD, "nomarker");
    expect(verifyAppleJws(jws, { roots: [NOMARKER_ROOT_PEM] })).toEqual({ ok: false, code: "missing_apple_marker" });
    // The switch exists for chains that deliberately do not carry the markers; it is on by default.
    expect(verifyAppleJws(jws, { roots: [NOMARKER_ROOT_PEM], requireAppleMarkers: false }).ok).toBe(true);
  });

  it.each([undefined, null, 42, {}, "", "a.b", "a.b.c.d", "..", "a..c", `${"x".repeat(100_001)}`])("rejects malformed input %#", (input) => {
    expect(verifyAppleJws(input, { roots }).ok).toBe(false);
  });

  it("rejects a token whose parts are not valid JSON", () => {
    expect(verifyAppleJws(`${b64url("not json")}.${b64url("{}")}.${b64url("sig")}`, { roots })).toEqual({ ok: false, code: "malformed" });
  });
});
