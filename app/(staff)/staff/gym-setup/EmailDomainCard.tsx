"use client";

import { useState } from "react";

type DnsRecord = { record: string; name: string; type: string; value: string; ttl?: string; priority?: number; status?: string };
type DomainView = {
  allowed: boolean;
  domain: { name: string; status: string; fromLocal: string; records: DnsRecord[] } | null;
  state: "none" | "waiting" | "verified" | "problem";
  text: string;
};

// Where a gym's emails come from. Everyone gets their gym's name as the sender and replies to their contact email. Larger plans can also send from their own domain:
// they type it, add the shown records where they bought the domain, and we switch over by ourselves once the records are found.
export function EmailDomainCard({ initial, gymName, contactEmail }: { initial: DomainView; gymName: string; contactEmail: string }) {
  const [view, setView] = useState<DomainView>(initial);
  const [domain, setDomain] = useState("");
  const [fromName, setFromName] = useState("hello");
  const [busy, setBusy] = useState<"add" | "check" | "remove" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function call(kind: "add" | "check" | "remove") {
    setBusy(kind);
    setError(null);
    setMessage(null);
    try {
      const res =
        kind === "add"
          ? await fetch("/api/staff/email-domain", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ domain, fromName }) })
          : kind === "check"
            ? await fetch("/api/staff/email-domain/verify", { method: "POST" })
            : await fetch("/api/staff/email-domain", { method: "DELETE" });
      const json = (await res.json().catch(() => null)) as { message?: string; data?: DomainView } | null;
      if (!res.ok || !json?.data) {
        setError(json?.message ?? "Something went wrong. Please try again.");
        return;
      }
      setView(json.data);
      if (json.message) setMessage(json.message);
      if (kind === "remove") setDomain("");
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  const box = "space-y-3 rounded-xl border border-white/10 bg-white/[0.03] p-4";

  return (
    <div className={box}>
      <p className="text-sm text-zinc-300">
        Your emails (bookings, reminders, invites) are sent in your gym&apos;s name, <strong>{gymName}</strong>. When a member replies, it goes to <strong>{contactEmail || "your contact email"}</strong>.
      </p>


      {view.allowed || view.domain ? (
        <>
          {!view.domain ? (
            <div className="space-y-3">
              <p className="text-xs leading-relaxed text-zinc-400">
                Want emails to come from your own address? Type the domain you own (for example yourgym.ie). You need to be able to add a few records where you bought it. A free address such as Gmail cannot be used.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-xs font-medium text-zinc-300">
                  Your domain
                  <input className="input-field mt-1 w-full px-3 py-2 text-sm" value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="yourgym.ie" autoCapitalize="none" autoCorrect="off" />
                </label>
                <label className="text-xs font-medium text-zinc-300">
                  Send from (before the @)
                  <input className="input-field mt-1 w-full px-3 py-2 text-sm" value={fromName} onChange={(e) => setFromName(e.target.value)} placeholder="hello" autoCapitalize="none" autoCorrect="off" />
                </label>
              </div>
              <button type="button" disabled={busy !== null || !domain.trim()} onClick={() => void call("add")} className="btn-primary px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60">
                {busy === "add" ? "Adding…" : "Use my own domain"}
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className={`rounded-lg px-3 py-2 text-sm ${view.state === "verified" ? "bg-emerald-400/10 text-emerald-200" : view.state === "problem" ? "bg-amber-400/10 text-amber-100" : "bg-white/5 text-zinc-200"}`}>
                <strong>{view.domain.name}</strong>: {view.text}
              </p>
              {view.state !== "verified" ? (
                <>
                  <p className="text-xs leading-relaxed text-zinc-400">
                    Go to the website where you bought {view.domain.name} (its DNS settings) and add each of these records exactly as shown. Copy and paste each value. If you are not sure how, send this page to whoever manages your website.
                  </p>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[520px] text-left text-xs">
                      <thead className="text-zinc-400">
                        <tr>
                          <th className="py-1 pr-3 font-medium">Type</th>
                          <th className="py-1 pr-3 font-medium">Name</th>
                          <th className="py-1 pr-3 font-medium">Value</th>
                          <th className="py-1 font-medium">Found?</th>
                        </tr>
                      </thead>
                      <tbody className="align-top text-zinc-200">
                        {view.domain.records.map((r) => (
                          <tr key={`${r.record}-${r.type}-${r.name}`} className="border-t border-white/10">
                            <td className="py-2 pr-3">{r.type}{r.priority !== undefined ? ` (priority ${r.priority})` : ""}</td>
                            <td className="py-2 pr-3 break-all">{r.name}</td>
                            <td className="py-2 pr-3 break-all">{r.value}</td>
                            <td className="py-2">{r.status === "verified" ? "Yes" : "Not yet"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <button type="button" disabled={busy !== null} onClick={() => void call("check")} className="btn-secondary px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60">
                    {busy === "check" ? "Checking…" : "Check again"}
                  </button>
                </>
              ) : null}
              <button type="button" disabled={busy !== null} onClick={() => void call("remove")} className="ml-2 text-xs text-zinc-400 underline underline-offset-4 hover:text-zinc-200 disabled:opacity-60">
                {busy === "remove" ? "Removing…" : "Stop using my own domain"}
              </button>
            </div>
          )}
        </>
      ) : null}

      {error ? <p role="alert" className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p> : null}
      {message ? <p className="rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-sm text-emerald-200">{message}</p> : null}
    </div>
  );
}
