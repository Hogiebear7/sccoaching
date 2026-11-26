"use client";

import { useRef, useState } from "react";

import { BULK_INVITE_MAX, BULK_INVITE_STATUS_LABEL, parseInviteList, type BulkInviteStatus } from "@/lib/bulk-invite-parse";

type Tier = "app_subscription" | "membership";
const TIER_LABEL: Record<Tier, string> = { app_subscription: "App Subscription", membership: "Membership" };

interface Row {
  email: string;
  name: string | null;
  line: number;
  status: BulkInviteStatus;
  message?: string;
}
interface Outcome {
  rows: Row[];
  counts: Record<BulkInviteStatus, number>;
  invalid: { line: number; text: string }[];
  duplicates: { line: number; email: string }[];
  overLimit: number;
}

const CHIP: Record<BulkInviteStatus, string> = {
  ready: "bg-emerald-400/15 text-emerald-200",
  sent: "bg-emerald-400/15 text-emerald-200",
  already_member: "bg-white/10 text-zinc-300",
  already_invited: "bg-amber-400/15 text-amber-200",
  failed: "bg-red-400/15 text-red-200",
};

// Invite many people at once: paste a list or choose a file (a text file, or a spreadsheet saved as CSV with the email in one column and, if you like, the name in another). You always
// see what will happen to each address first, and nothing is sent until you press the send button. The server reads the list again when it sends.
export function BulkInviteForm() {
  const [text, setText] = useState("");
  const [tier, setTier] = useState<Tier>("membership");
  const [busy, setBusy] = useState<"preview" | "send" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ forText: string; forTier: Tier; outcome: Outcome } | null>(null);
  const [sent, setSent] = useState<{ message: string; outcome: Outcome } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const local = parseInviteList(text); // an instant count while typing; the server's reading is the one that counts
  const stale = preview !== null && (preview.forText !== text || preview.forTier !== tier);

  async function call(mode: "preview" | "send") {
    setBusy(mode);
    setError(null);
    try {
      const res = await fetch("/api/staff/invites/bulk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode, tier, text }) });
      const json = (await res.json().catch(() => null)) as { message?: string; data?: Outcome } | null;
      if (!res.ok || !json?.data) {
        setError(json?.message ?? "Something went wrong. Please try again.");
        if (json?.data) setPreview({ forText: text, forTier: tier, outcome: json.data });
        return;
      }
      if (mode === "preview") {
        setSent(null);
        setPreview({ forText: text, forTier: tier, outcome: json.data });
      } else {
        setSent({ message: json.message ?? "Done.", outcome: json.data });
        setPreview(null);
      }
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(null);
    }
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    if (file.size > 500_000) {
      setError("That file is too big. Send up to 100 people at a time.");
      return;
    }
    setError(null);
    setText(await file.text());
    setPreview(null);
    setSent(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  function downloadResults(outcome: Outcome) {
    const lines = ["email,name,result", ...outcome.rows.map((r) => [r.email, (r.name ?? "").replace(/"/g, '""'), BULK_INVITE_STATUS_LABEL[r.status]].map((v) => `"${v}"`).join(","))];
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "invite-results.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  const outcome = sent?.outcome ?? preview?.outcome ?? null;
  const readyCount = preview?.outcome.counts.ready ?? 0;

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Paste a list of emails (one per line, or a spreadsheet column) or choose a file. Up to {BULK_INVITE_MAX} people at a time. You see what will happen to each one before anything is sent.
      </p>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={6}
        aria-label="Emails to invite"
        placeholder={"ann@example.com\nbob@example.com, Bob Murphy\n..."}
        className="input-field w-full px-3 py-2 font-mono text-xs"
      />

      <div className="flex flex-wrap items-center gap-2">
        <label className="btn-secondary cursor-pointer px-3 py-2 text-sm">
          Choose a file
          <input ref={fileRef} type="file" accept=".csv,.txt,text/csv,text/plain" className="sr-only" onChange={(e) => void onFile(e.target.files?.[0])} />
        </label>
        <select value={tier} onChange={(e) => setTier(e.target.value as Tier)} aria-label="Invite tier" className="input-field px-3 py-2 text-sm sm:w-44">
          {(Object.keys(TIER_LABEL) as Tier[]).map((t) => (
            <option key={t} value={t}>
              {TIER_LABEL[t]}
            </option>
          ))}
        </select>
        <button type="button" onClick={() => void call("preview")} disabled={busy !== null || local.rows.length === 0} className="btn-secondary px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60">
          {busy === "preview" ? "Checking…" : "Check the list"}
        </button>
        <span className="text-xs text-muted-foreground">
          {local.rows.length} address{local.rows.length === 1 ? "" : "es"} found
        </span>
      </div>

      {error ? <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p> : null}

      {outcome ? (
        <div className="space-y-2">
          <p role="status" className="text-sm font-medium">
            {sent
              ? sent.message
              : `${outcome.counts.ready} ready to invite${outcome.counts.already_member ? `, ${outcome.counts.already_member} already in your gym` : ""}${outcome.counts.already_invited ? `, ${outcome.counts.already_invited} already invited` : ""}.`}
          </p>
          {outcome.invalid.length > 0 ? (
            <p className="text-xs text-amber-200">
              {outcome.invalid.length} line{outcome.invalid.length === 1 ? "" : "s"} had no valid email and {outcome.invalid.length === 1 ? "was" : "were"} left out (e.g. line {outcome.invalid[0].line}: &ldquo;{outcome.invalid[0].text}&rdquo;).
            </p>
          ) : null}
          {outcome.duplicates.length > 0 ? <p className="text-xs text-zinc-400">{outcome.duplicates.length} repeated address{outcome.duplicates.length === 1 ? " was" : "es were"} only counted once.</p> : null}
          {outcome.overLimit > 0 ? <p className="text-xs text-amber-200">{outcome.overLimit} more than the {BULK_INVITE_MAX} limit {outcome.overLimit === 1 ? "was" : "were"} left out. Send them in a second batch.</p> : null}
          <div className="max-h-64 overflow-auto rounded-xl border border-white/10">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-[var(--surface-1,#0b1424)] text-zinc-400">
                <tr>
                  <th className="px-3 py-2 font-medium">Email</th>
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">Result</th>
                </tr>
              </thead>
              <tbody>
                {outcome.rows.map((r) => (
                  <tr key={r.email} className="border-t border-white/5">
                    <td className="px-3 py-1.5">{r.email}</td>
                    <td className="px-3 py-1.5 text-zinc-400">{r.name ?? ""}</td>
                    <td className="px-3 py-1.5">
                      <span className={`rounded-full px-2 py-0.5 ${CHIP[r.status]}`}>{BULK_INVITE_STATUS_LABEL[r.status]}</span>
                      {r.message && r.status === "failed" ? <span className="ml-2 text-red-200">{r.message}</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {preview && !sent ? (
              <button type="button" onClick={() => void call("send")} disabled={busy !== null || stale || readyCount === 0} className="btn-primary px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60">
                {busy === "send" ? "Sending…" : `Send ${readyCount} invite${readyCount === 1 ? "" : "s"}`}
              </button>
            ) : null}
            {stale ? <span className="text-xs text-amber-200">The list or tier changed. Check the list again before sending.</span> : null}
            {sent ? (
              <button type="button" onClick={() => downloadResults(sent.outcome)} className="btn-secondary px-3 py-2 text-sm">
                Download the results
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
