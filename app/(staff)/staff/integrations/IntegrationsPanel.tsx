"use client";

import { useState } from "react";

type Hook = {
  id: string;
  url: string;
  events: string[];
  enabled: boolean;
  createdAt: string;
  lastDeliveryAt: string | null;
  lastStatus: "ok" | "failed" | null;
  lastError: string | null;
  secretHint: string;
};
type EventOption = { type: string; label: string; detail: string };

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-IE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "never");

// Connect the gym to Zapier, Make, n8n or any tool that gives you a "webhook" address: paste the address, choose what to send, and press Send a test.
export function IntegrationsPanel({ initial, events, max }: { initial: Hook[]; events: EventOption[]; max: number }) {
  const [hooks, setHooks] = useState<Hook[]>(initial);
  const [url, setUrl] = useState("");
  const [chosen, setChosen] = useState<string[]>(events.map((e) => e.type));
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [secret, setSecret] = useState<{ url: string; value: string } | null>(null);

  async function call(key: string, input: string, init: RequestInit): Promise<{ ok: boolean; json: { message?: string; data?: { webhook?: Hook; secret?: string } } | null }> {
    setBusy(key);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(input, { ...init, headers: { "Content-Type": "application/json", ...(init.headers ?? {}) } });
      const json = (await res.json().catch(() => null)) as { message?: string; data?: { webhook?: Hook; secret?: string } } | null;
      return { ok: res.ok, json };
    } catch {
      setError("Something went wrong. Please try again.");
      return { ok: false, json: null };
    } finally {
      setBusy(null);
    }
  }

  async function add() {
    const r = await call("add", "/api/staff/integrations/webhooks", { method: "POST", body: JSON.stringify({ url, events: chosen }) });
    if (!r.ok) {
      setError(r.json?.message ?? "Could not connect that address.");
      return;
    }
    const hook = r.json?.data?.webhook;
    if (hook) setHooks((h) => [...h, hook]);
    if (r.json?.data?.secret && hook) setSecret({ url: hook.url, value: r.json.data.secret });
    setUrl("");
    setMessage("Connected. Press Send a test to check it works.");
  }

  async function test(id: string) {
    const r = await call(`test-${id}`, `/api/staff/integrations/webhooks/${id}/test`, { method: "POST" });
    const hook = r.json?.data?.webhook;
    if (hook) setHooks((h) => h.map((x) => (x.id === id ? hook : x)));
    if (r.ok) setMessage(r.json?.message ?? "The test arrived.");
    else setError(r.json?.message ?? "The test did not arrive.");
  }

  async function toggle(h: Hook) {
    const r = await call(`toggle-${h.id}`, `/api/staff/integrations/webhooks/${h.id}`, { method: "PATCH", body: JSON.stringify({ enabled: !h.enabled }) });
    const hook = r.json?.data?.webhook;
    if (r.ok && hook) setHooks((all) => all.map((x) => (x.id === h.id ? hook : x)));
    else if (!r.ok) setError(r.json?.message ?? "Could not change that.");
  }

  async function remove(id: string) {
    if (!window.confirm("Remove this connection? Nothing more will be sent to it.")) return;
    const r = await call(`del-${id}`, `/api/staff/integrations/webhooks/${id}`, { method: "DELETE" });
    if (r.ok) setHooks((all) => all.filter((x) => x.id !== id));
    else setError(r.json?.message ?? "Could not remove that.");
  }

  const box = "rounded-xl border border-white/10 bg-white/[0.03] p-4";
  const label = (type: string) => events.find((e) => e.type === type)?.label ?? type;

  return (
    <div className="space-y-6">
      <div className={`${box} space-y-3`}>
        <h3 className="text-sm font-semibold text-zinc-100">Add a connection</h3>
        <p className="text-xs leading-relaxed text-zinc-400">
          In Zapier, make a Zap that starts with <strong>Webhooks by Zapier</strong> and choose <strong>Catch Hook</strong>. Zapier gives you an address. Paste it here, choose what to send, then press Add. The same works with Make, n8n and
          other tools. The messages include the member&apos;s name and email, so only connect services you trust.
        </p>
        <label className="block text-xs font-medium text-zinc-300">
          The address your tool gave you
          <input className="input-field mt-1 w-full px-3 py-2 text-sm" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://hooks.zapier.com/hooks/catch/…" autoCapitalize="none" autoCorrect="off" />
        </label>
        <fieldset className="space-y-2">
          <legend className="text-xs font-medium text-zinc-300">Send a message when…</legend>
          {events.map((e) => (
            <label key={e.type} className="flex items-start gap-2 text-sm text-zinc-200">
              <input type="checkbox" className="mt-1" checked={chosen.includes(e.type)} onChange={(ev) => setChosen((c) => (ev.target.checked ? [...c, e.type] : c.filter((x) => x !== e.type)))} />
              <span>
                {e.label}
                <span className="block text-xs text-zinc-500">{e.detail}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <button type="button" disabled={busy !== null || !url.trim() || chosen.length === 0 || hooks.length >= max} onClick={() => void add()} className="btn-primary px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60">
          {busy === "add" ? "Adding…" : "Add connection"}
        </button>
        {hooks.length >= max ? <p className="text-xs text-amber-300">You have {max} connections, the most you can have. Remove one to add another.</p> : null}
      </div>

      {secret ? (
        <div className="space-y-2 rounded-xl border border-amber-400/30 bg-amber-400/10 p-4" role="status">
          <p className="text-sm font-semibold text-amber-50">Your signing secret (shown once)</p>
          <p className="text-xs text-amber-100">Most tools do not need this. If your receiver checks that messages really came from us, keep this secret; we cannot show it again.</p>
          <code className="block break-all rounded bg-black/30 p-2 text-xs text-amber-50">{secret.value}</code>
          <button type="button" onClick={() => setSecret(null)} className="text-xs text-amber-100 underline underline-offset-4">I have saved it</button>
        </div>
      ) : null}

      {error ? <p role="alert" className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p> : null}
      {message ? <p className="rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-sm text-emerald-200">{message}</p> : null}

      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-zinc-100">Your connections</h3>
        {hooks.length === 0 ? <p className="text-sm text-zinc-400">Nothing connected yet.</p> : null}
        {hooks.map((h) => (
          <div key={h.id} className={`${box} space-y-2`}>
            <p className="break-all text-sm font-medium text-zinc-100">{h.url}</p>
            <p className="text-xs text-zinc-400">Sends: {h.events.map(label).join(", ")}</p>
            <p className={`text-xs ${h.lastStatus === "failed" ? "text-red-300" : h.lastStatus === "ok" ? "text-emerald-300" : "text-zinc-500"}`}>
              {!h.enabled ? "Switched off. " : ""}
              {h.lastStatus === "ok" ? `Last message arrived ${when(h.lastDeliveryAt)}.` : h.lastStatus === "failed" ? `Last attempt failed ${when(h.lastDeliveryAt)}: ${h.lastError ?? "unknown problem"}` : "Nothing sent yet."}
            </p>
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={busy !== null} onClick={() => void test(h.id)} className="btn-secondary px-3 py-1.5 text-xs disabled:opacity-60">
                {busy === `test-${h.id}` ? "Sending…" : "Send a test"}
              </button>
              <button type="button" disabled={busy !== null} onClick={() => void toggle(h)} className="rounded-md border border-white/15 px-3 py-1.5 text-xs text-zinc-200 hover:bg-white/5 disabled:opacity-60">
                {h.enabled ? "Switch off" : "Switch on"}
              </button>
              <button type="button" disabled={busy !== null} onClick={() => void remove(h.id)} className="px-3 py-1.5 text-xs text-zinc-400 underline underline-offset-4 hover:text-zinc-200 disabled:opacity-60">
                Remove
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
