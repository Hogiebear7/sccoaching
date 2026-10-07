// The test-only network guard (__tests__/setup/network-guard.ts) must block real hosts and leave loopback alone.
// Nothing here ever reaches a network: blocked calls throw before any socket is opened, and the loopback checks only
// exercise the host classifier.
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { describe, expect, it } from "vitest";

import { isLoopbackHost, NetworkBlockedError } from "../setup/network-guard";

describe("network guard", () => {
  it("is active for every test file: fetch to a real host rejects with a named error", async () => {
    await expect(fetch("https://api.stripe.com/v1/charges")).rejects.toThrow(/Network access is blocked in tests \(fetch api\.stripe\.com\)/);
    await expect(fetch(new URL("https://example.com/x"))).rejects.toBeInstanceOf(NetworkBlockedError);
    await expect(fetch(new Request("https://androidpublisher.googleapis.com/x"))).rejects.toBeInstanceOf(NetworkBlockedError);
  });

  it("blocks http and https requests to a real host", () => {
    expect(() => https.request("https://example.com/")).toThrow(NetworkBlockedError);
    expect(() => http.get({ hostname: "example.org", path: "/" })).toThrow(NetworkBlockedError);
    expect(() => http.request("http://example.net/")).toThrow(/http example\.net/);
  });

  it("blocks a raw socket connect to a real host", () => {
    const socket = new net.Socket();
    expect(() => socket.connect({ host: "example.com", port: 443 })).toThrow(NetworkBlockedError);
    expect(() => socket.connect(443, "example.com")).toThrow(NetworkBlockedError);
    socket.destroy();
  });

  it("recognises loopback hosts only", () => {
    for (const h of ["localhost", "LOCALHOST", "127.0.0.1", "::1", "[::1]", "127.0.0.1:3000", "app.localhost"]) expect(isLoopbackHost(h)).toBe(true);
    for (const h of ["example.com", "127.0.0.1.example.com", "localhost.example.com", "", null, undefined]) expect(isLoopbackHost(h)).toBe(false);
  });

  it("does not block a test that installs its own fetch stub", async () => {
    const guard = globalThis.fetch;
    globalThis.fetch = (async () => new Response("stubbed")) as typeof fetch;
    try {
      expect(await (await fetch("https://api.stripe.com/x")).text()).toBe("stubbed");
    } finally {
      globalThis.fetch = guard;
    }
  });
});
