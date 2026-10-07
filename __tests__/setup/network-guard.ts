// Test-only network guard, registered as a vitest setup file (vitest.config.ts).
//
// The suite must never reach a real provider (Stripe, Revolut, Google Play, Supabase, anything). Provider calls are made through
// fakes and adapters, but a mistake (a missing mock, a new code path that calls fetch) would otherwise go out over the network
// silently, or fail only on a machine without internet. This makes it fail loudly, everywhere, with the host named.
//
// What is blocked: fetch, http(s).request/get and raw socket connects to any host that is not loopback. Loopback (localhost,
// 127.0.0.1, ::1) stays open for tests that start a local server. A test that installs its own fetch stub (vi.stubGlobal,
// vi.spyOn, direct assignment) replaces this guard for that test only and is unaffected.
import http from "node:http";
import https from "node:https";
import net from "node:net";

export class NetworkBlockedError extends Error {
  constructor(target: string) {
    super(`Network access is blocked in tests (${target}). Use a fake adapter or stub the call.`);
    this.name = "NetworkBlockedError";
  }
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"]);

export function isLoopbackHost(host: string | null | undefined): boolean {
  if (!host) return false;
  let h = host.toLowerCase();
  const bracketed = h.match(/^\[(.*)\](?::\d+)?$/);
  if (bracketed) h = bracketed[1];
  // A single colon is host:port; more than one is a bare IPv6 address.
  else if (h.split(":").length === 2) h = h.replace(/:\d+$/, "");
  return LOOPBACK.has(h) || LOOPBACK.has(`[${h}]`) || h.endsWith(".localhost");
}

function hostOfUrl(input: unknown): string | null {
  try {
    if (typeof input === "string") return new URL(input).hostname;
    if (input instanceof URL) return input.hostname;
    if (input && typeof input === "object" && "url" in input) return new URL(String((input as { url: unknown }).url)).hostname;
  } catch {
    // A relative or malformed URL has no host to reach; let the real fetch reject it.
  }
  return null;
}

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
  const host = hostOfUrl(input);
  if (host && !isLoopbackHost(host)) throw new NetworkBlockedError(`fetch ${host}`);
  return realFetch(input, init);
}) as typeof fetch;

type RequestFn = (...args: unknown[]) => unknown;
function guardRequest(mod: typeof http | typeof https, name: "request" | "get") {
  const original = mod[name] as unknown as RequestFn;
  (mod as unknown as Record<string, RequestFn>)[name] = (...args: unknown[]) => {
    const first = args[0];
    let host: string | null = null;
    if (typeof first === "string" || first instanceof URL) host = hostOfUrl(first);
    else if (first && typeof first === "object") {
      const o = first as { hostname?: string; host?: string };
      host = o.hostname ?? o.host ?? null;
    }
    if (host && !isLoopbackHost(host)) throw new NetworkBlockedError(`${mod === https ? "https" : "http"} ${host}`);
    return original.apply(mod, args);
  };
}
for (const mod of [http, https]) for (const name of ["request", "get"] as const) guardRequest(mod, name);

const realConnect = net.Socket.prototype.connect as unknown as (...args: unknown[]) => unknown;
net.Socket.prototype.connect = function (this: net.Socket, ...args: unknown[]) {
  const first = args[0];
  if (typeof first === "number" && typeof args[1] === "string" && !isLoopbackHost(args[1])) throw new NetworkBlockedError(`socket ${args[1]}`);
  if (first && typeof first === "object" && !Array.isArray(first)) {
    const o = first as { host?: string; path?: string };
    // A unix-socket path is local; anything with a non-loopback host is not.
    if (!o.path && o.host && !isLoopbackHost(o.host)) throw new NetworkBlockedError(`socket ${o.host}`);
  }
  return realConnect.apply(this, args);
} as typeof net.Socket.prototype.connect;
