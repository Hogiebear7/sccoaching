"use client";

import { useState } from "react";

type Key = { id: string; name: string; prefix: string; createdAt: string; lastUsedAt: string | null; revoked: boolean };

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-IE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "never");

// Keys that let another tool ask the platform to do things for this gym (list classes, look up a member, send an invite). The key is shown once, when it is made.
export function ApiKeysPanel({ initial, max, siteUrl }: { initial: Key[]; max: number; siteUrl: string }) {
  const [keys, setKeys] = useState<Key[]>(initial);
  const [name, setName] = useState("Zapier");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);

  async function make() {
    setBusy("make");
    setError(null);
    try {
      const res = await fetch("/api/staff/integrations/api-keys", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
      const json = (await res.json().catch(() => null)) as { message?: string; data?: { key?: string; apiKey?: Key } } | null;
      if (!res.ok || !json?.data?.key || !json.data.apiKey) {
        setError(json?.message ?? "Could not make a key.");
        return;
      }
      setKeys((k) => [...k, json.data!.apiKey!]);
      setFresh(json.data.key);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  async function revoke(id: string) {
    if (!window.confirm("Revoke this key? Anything using it stops working straight away.")) return;
    setBusy(`rev-${id}`);
    setError(null);
    try {
      const res = await fetch(`/api/staff/integrations/api-keys/${id}`, { method: "DELETE" });
      const json = (await res.json().catch(() => null)) as { message?: string } | null;
      if (!res.ok) setError(json?.message ?? "Could not revoke that key.");
      else setKeys((k) => k.filter((x) => x.id !== id));
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  const box = "rounded-xl border border-white/10 bg-white/[0.03] p-4";
  return (
    <div className="space-y-4">
      <div className={`${box} space-y-3`}>
        <h3 className="text-sm font-semibold text-zinc-100">Let other tools do things for your gym</h3>
        <p className="text-xs leading-relaxed text-zinc-400">
          A key lets a tool like Zapier (the &quot;Webhooks by Zapier&quot; action called <strong>Custom Request</strong>), Make or n8n ask us to list your upcoming classes, check whether someone is a member, or send a membership invite. Keep keys
          private, like a password. If one leaks, revoke it here and make a new one.
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs font-medium text-zinc-300">
            Key name
            <input className="input-field mt-1 block w-48 px-3 py-2 text-sm" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
          </label>
          <button type="button" disabled={busy !== null || !name.trim() || keys.length >= max} onClick={() => void make()} className="btn-primary px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60">
            {busy === "make" ? "Making…" : "Make a key"}
          </button>
        </div>
        {keys.length >= max ? <p className="text-xs text-amber-300">You have {max} keys, the most you can have. Revoke one to make another.</p> : null}
      </div>

      {fresh ? (
        <div className="space-y-2 rounded-xl border border-amber-400/30 bg-amber-400/10 p-4" role="status">
          <p className="text-sm font-semibold text-amber-50">Your new key (shown once)</p>
          <code className="block break-all rounded bg-black/30 p-2 text-xs text-amber-50">{fresh}</code>
          <p className="text-xs text-amber-100">Copy it now into your tool. We keep only a scrambled copy, so we cannot show it again.</p>
          <button type="button" onClick={() => setFresh(null)} className="text-xs text-amber-100 underline underline-offset-4">I have copied it</button>
        </div>
      ) : null}

      {error ? <p role="alert" className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p> : null}

      {keys.map((k) => (
        <div key={k.id} className={`${box} flex flex-wrap items-center justify-between gap-2`}>
          <div>
            <p className="text-sm font-medium text-zinc-100">{k.name}</p>
            <p className="text-xs text-zinc-400">
              {k.prefix}… · made {when(k.createdAt)} · last used {when(k.lastUsedAt)}
            </p>
          </div>
          <button type="button" disabled={busy !== null} onClick={() => void revoke(k.id)} className="text-xs text-zinc-400 underline underline-offset-4 hover:text-zinc-200 disabled:opacity-60">
            Revoke
          </button>
        </div>
      ))}

      <details className={`${box} text-xs text-zinc-300`}>
        <summary className="cursor-pointer text-sm font-semibold text-zinc-100">What can a tool ask for? (for whoever sets it up)</summary>
        <div className="mt-2 space-y-2 leading-relaxed">
          <p>Send the key as a header: <code>Authorization: Bearer scp_…</code>. Up to 60 requests a minute per key.</p>
          <p><code>GET {siteUrl}/api/v1/classes</code>: your classes in the next 14 days, with how many are booked.</p>
          <p><code>GET {siteUrl}/api/v1/members?email=someone@example.com</code>: whether that person is a member of your gym (name and join date). It never lists your members.</p>
          <p><code>POST {siteUrl}/api/v1/invites</code> with JSON <code>{`{"email":"someone@example.com","tier":"membership"}`}</code>: sends a membership invite, like the Invite button in your staff area.</p>
        </div>
      </details>
    </div>
  );
}
