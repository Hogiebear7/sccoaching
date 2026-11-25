"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export interface TenantRow {
  id: string;
  name: string;
  slug: string;
  contactEmail: string;
  state: "active" | "grace" | "locked";
  paidThrough: string;
  graceEndsOn: string | null;
  graceDays: number | null;
  payUrl: string;
  stripeCustomerId: string;
  billed: boolean;
}

const STATE_LABEL: Record<TenantRow["state"], string> = { active: "Active", grace: "In grace", locked: "Locked" };

function Row({ row }: { row: TenantRow }) {
  const router = useRouter();
  const [paidThrough, setPaidThrough] = useState(row.paidThrough);
  const [graceDays, setGraceDays] = useState(row.graceDays === null ? "" : String(row.graceDays));
  const [payUrl, setPayUrl] = useState(row.payUrl);
  const [customer, setCustomer] = useState(row.stripeCustomerId);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(takeOffBilling: boolean) {
    setSaving(true);
    setMessage(null);
    const body = takeOffBilling
      ? { paidThrough: null }
      : {
          paidThrough: paidThrough || null,
          ...(graceDays !== "" ? { graceDays: Number(graceDays) } : {}),
          payUrl: payUrl || null,
          stripeCustomerId: customer || null,
        };
    try {
      const res = await fetch(`/api/staff/gyms/${encodeURIComponent(row.id)}/billing`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = (await res.json()) as { success?: boolean; message?: string };
      setMessage(res.ok ? "Saved." : json.message ?? "Could not save.");
      if (res.ok) router.refresh();
    } catch {
      setMessage("Could not reach the server.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <li className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="text-base font-semibold text-zinc-50">{row.name}</p>
          <p className="text-xs text-zinc-500">{row.slug} · {row.contactEmail}</p>
        </div>
        <p className="text-sm text-zinc-300">
          {row.billed ? STATE_LABEL[row.state] : "Not billed"}
          {row.state === "grace" && row.graceEndsOn ? `, until ${row.graceEndsOn}` : ""}
        </p>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-xs text-zinc-400">
          Paid through (last paid day)
          <input type="date" value={paidThrough} onChange={(e) => setPaidThrough(e.target.value)} className="mt-1 block w-full rounded-md border border-white/10 bg-transparent px-2 py-1.5 text-sm text-zinc-100" />
        </label>
        <label className="text-xs text-zinc-400">
          Grace days (0 to 60, blank = platform default)
          <input type="number" min={0} max={60} value={graceDays} onChange={(e) => setGraceDays(e.target.value)} className="mt-1 block w-full rounded-md border border-white/10 bg-transparent px-2 py-1.5 text-sm text-zinc-100" />
        </label>
        <label className="text-xs text-zinc-400">
          Payment link (https, shown to this gym's staff)
          <input type="url" value={payUrl} onChange={(e) => setPayUrl(e.target.value)} className="mt-1 block w-full rounded-md border border-white/10 bg-transparent px-2 py-1.5 text-sm text-zinc-100" />
        </label>
        <label className="text-xs text-zinc-400">
          Stripe customer id (cus_...)
          <input type="text" value={customer} onChange={(e) => setCustomer(e.target.value)} className="mt-1 block w-full rounded-md border border-white/10 bg-transparent px-2 py-1.5 text-sm text-zinc-100" />
        </label>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="button" disabled={saving || !paidThrough} onClick={() => void save(false)} className="btn-primary px-4 py-2 text-sm">
          Save billing
        </button>
        {row.billed ? (
          <button type="button" disabled={saving} onClick={() => void save(true)} className="text-sm text-zinc-400 underline underline-offset-4">
            Take off billing
          </button>
        ) : null}
        {message ? <p className="text-sm text-zinc-300">{message}</p> : null}
      </div>
    </li>
  );
}

export function TenantsTable({ rows, lockoutEnabled }: { rows: TenantRow[]; lockoutEnabled: boolean }) {
  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="text-2xl font-semibold text-zinc-50">Tenants</h1>
      <p className="mt-2 text-sm text-zinc-400">
        What each gym has paid S&amp;C for the platform. A gym past its paid-through date and its grace period is paused (nothing is deleted, and paying again restores it at once). A gym with no
        billing is never paused. Lockout is currently <strong className="text-zinc-200">{lockoutEnabled ? "ON" : "OFF"}</strong>: {lockoutEnabled ? "gyms past their grace are paused." : "nothing is paused, whatever the dates say."}
      </p>
      {rows.length === 0 ? <p className="mt-6 text-sm text-zinc-500">No gyms yet.</p> : <ul className="mt-6 space-y-4">{rows.map((r) => <Row key={r.id} row={r} />)}</ul>}
    </div>
  );
}
