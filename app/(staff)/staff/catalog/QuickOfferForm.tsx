"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  OFFER_KIND_HELP,
  OFFER_KIND_LABEL,
  describeOffer,
  emptyOffer,
  offerOptionPayload,
  offerPackagePayload,
  validateOffer,
  type OfferInput,
  type OfferKind,
  type OfferRenews,
} from "@/lib/catalog-offer";
import type { ClassCategoryRecord, MembershipCategoryRecord } from "@/lib/db";

const input =
  "w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-teal-600/60 focus:ring-2 focus:ring-teal-600/15";
const labelCls = "mb-1 block text-xs font-medium text-muted-foreground";
const KINDS: OfferKind[] = ["membership", "class_pack", "trial_pass", "single_class"];
const NEW_SECTION = "__new__";

async function send(url: string, body: unknown): Promise<{ ok: boolean; message: string; id: string | null }> {
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = (await res.json().catch(() => null)) as { message?: string; data?: { id?: string } } | null;
    return { ok: res.ok, message: json?.message ?? (res.ok ? "Saved." : "Something went wrong."), id: json?.data?.id ?? null };
  } catch {
    return { ok: false, message: "Could not reach the server.", id: null };
  }
}

// Add a membership, class pack, trial pass or single class in one go: pick what it is, say what it includes and costs, and see in one sentence what members will get before you create it.
// It sends the same three requests the detailed forms below send (section, package, price), so everything it makes can still be edited there.
export function QuickOfferForm({ categories, classCategories }: { categories: MembershipCategoryRecord[]; classCategories: ClassCategoryRecord[] }) {
  const router = useRouter();
  const [offer, setOffer] = useState<OfferInput>(emptyOffer("membership"));
  const [section, setSection] = useState<string>(categories[0]?.id ?? NEW_SECTION);
  const [newSection, setNewSection] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [open, setOpen] = useState(false);

  const set = (patch: Partial<OfferInput>) => setOffer((o) => ({ ...o, ...patch }));
  const pickKind = (kind: OfferKind) => setOffer((o) => ({ ...emptyOffer(kind), name: o.name, description: o.description, priceEur: o.priceEur, eligibleSlugs: o.eligibleSlugs, visible: o.visible }));
  const typeNames = classCategories.filter((c) => offer.eligibleSlugs.includes(c.slug)).map((c) => c.name);
  const problem = validateOffer(offer) ?? (section === NEW_SECTION && !newSection.trim() ? "Give the section a name, for example “Classes”." : null);

  async function create() {
    if (problem) {
      setMessage({ ok: false, text: problem });
      return;
    }
    setBusy(true);
    setMessage(null);
    let categoryId = section;
    if (section === NEW_SECTION) {
      const c = await send("/api/staff/catalog/categories", { name: newSection.trim(), description: "", sortOrder: categories.length, visible: true });
      if (!c.ok || !c.id) {
        setMessage({ ok: false, text: c.message });
        setBusy(false);
        return;
      }
      categoryId = c.id;
    }
    const p = await send("/api/staff/catalog/packages", offerPackagePayload(offer, categoryId));
    if (!p.ok || !p.id) {
      setMessage({ ok: false, text: p.message });
      setBusy(false);
      return;
    }
    const price = await send("/api/staff/catalog/billing-options", offerOptionPayload(offer, p.id));
    if (!price.ok) {
      setMessage({ ok: false, text: `The ${OFFER_KIND_LABEL[offer.kind].toLowerCase()} was created but its price was not saved: ${price.message} Open it below and add the price.` });
      setBusy(false);
      router.refresh();
      return;
    }
    setMessage({ ok: true, text: `${offer.name.trim()} created. ${offer.visible ? "Members can see it now." : "It is hidden until you show it."}` });
    setOffer(emptyOffer(offer.kind));
    setNewSection("");
    setBusy(false);
    router.refresh();
  }

  return (
    <section aria-labelledby="quick-offer-h" className="panel p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 id="quick-offer-h" className="text-lg font-semibold">Add an offer</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">A membership, class pack, trial pass or single class: what it is, what it includes and what it costs, all in one place.</p>
        </div>
        <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="btn-primary px-4 py-2 text-xs">
          {open ? "Close" : "Add an offer"}
        </button>
      </div>

      {open ? (
        <div className="mt-4 space-y-4">
          <div role="group" aria-label="What are you adding?" className="grid gap-2 sm:grid-cols-4">
            {KINDS.map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={offer.kind === k}
                onClick={() => pickKind(k)}
                className={`rounded-xl border px-3 py-2 text-left text-sm transition ${offer.kind === k ? "border-primary bg-primary/10 font-semibold text-primary" : "border-border text-muted-foreground hover:border-primary"}`}
              >
                {OFFER_KIND_LABEL[k]}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">{OFFER_KIND_HELP[offer.kind]}</p>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={labelCls} htmlFor="offer-name">Name members see</label>
              <input id="offer-name" className={input} value={offer.name} onChange={(e) => set({ name: e.target.value })} placeholder={offer.kind === "membership" ? "e.g. Unlimited membership" : offer.kind === "trial_pass" ? "e.g. 3 class trial pass" : "e.g. 10 class pack"} />
            </div>
            <div>
              <label className={labelCls} htmlFor="offer-desc">One-line description (optional)</label>
              <input id="offer-desc" className={input} value={offer.description} onChange={(e) => set({ description: e.target.value })} placeholder="e.g. Try our semi-private sessions before you commit." />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            {offer.kind === "membership" ? (
              <div>
                <span className={labelCls}>Classes</span>
                <span role="group" aria-label="Classes included" className="inline-flex overflow-hidden rounded-lg border border-border text-sm">
                  {[true, false].map((u) => (
                    <button key={String(u)} type="button" aria-pressed={offer.unlimited === u} onClick={() => set({ unlimited: u, classCount: u ? "" : offer.classCount || "8" })} className={`min-h-10 px-3 ${offer.unlimited === u ? "bg-primary/15 font-semibold text-primary" : "text-muted-foreground"}`}>
                      {u ? "Unlimited" : "A set number"}
                    </button>
                  ))}
                </span>
              </div>
            ) : null}
            {(offer.kind === "class_pack" || offer.kind === "trial_pass" || (offer.kind === "membership" && !offer.unlimited)) ? (
              <div>
                <label className={labelCls} htmlFor="offer-count">{offer.kind === "membership" ? "Classes each period" : "Classes included"}</label>
                <input id="offer-count" type="number" min={1} max={1000} className={input} value={offer.classCount} onChange={(e) => set({ classCount: e.target.value })} />
              </div>
            ) : null}
            <div>
              <label className={labelCls} htmlFor="offer-price">Price (€)</label>
              <input id="offer-price" type="number" min={0} step="0.01" className={input} value={offer.priceEur} onChange={(e) => set({ priceEur: e.target.value })} placeholder="e.g. 49.00" />
            </div>
            {offer.kind === "membership" ? (
              <div>
                <label className={labelCls} htmlFor="offer-renews">Renews</label>
                <select id="offer-renews" className={input} value={offer.renews} onChange={(e) => set({ renews: e.target.value as OfferRenews })}>
                  <option value="monthly">Every month</option>
                  <option value="quarterly">Every 3 months</option>
                  <option value="annual">Every year</option>
                </select>
              </div>
            ) : null}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={labelCls} htmlFor="offer-section">Where it shows for members</label>
              <select id="offer-section" className={input} value={section} onChange={(e) => setSection(e.target.value)}>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
                <option value={NEW_SECTION}>A new section…</option>
              </select>
              {section === NEW_SECTION ? <input className={`${input} mt-2`} aria-label="New section name" value={newSection} onChange={(e) => setNewSection(e.target.value)} placeholder="Section name, e.g. Classes" /> : null}
            </div>
            <fieldset>
              <span className={labelCls}>Class types it can book (none selected = all)</span>
              <div className="flex flex-wrap gap-1.5">
                {classCategories.map((c) => {
                  const on = offer.eligibleSlugs.includes(c.slug);
                  return (
                    <button key={c.slug} type="button" aria-pressed={on} onClick={() => set({ eligibleSlugs: on ? offer.eligibleSlugs.filter((s) => s !== c.slug) : [...offer.eligibleSlugs, c.slug] })} className={`rounded-full border px-2.5 py-1 text-xs transition ${on ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-primary"}`}>
                      {c.name}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={offer.visible} onChange={(e) => set({ visible: e.target.checked })} />
            Show it to members straight away
          </label>

          <p role="status" className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm">{describeOffer(offer, typeNames)}</p>

          {message ? <p role="alert" className={`rounded-xl border px-4 py-3 text-sm ${message.ok ? "border-primary/30 bg-primary/10 text-primary" : "border-destructive/30 bg-destructive/10 text-destructive"}`}>{message.text}</p> : null}

          <div className="flex items-center gap-3">
            <button type="button" onClick={() => void create()} disabled={busy} className="btn-primary px-5 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60">
              {busy ? "Creating…" : `Create ${OFFER_KIND_LABEL[offer.kind].toLowerCase()}`}
            </button>
            <span className="text-xs text-muted-foreground">You can change anything later in the list below.</span>
          </div>
        </div>
      ) : message?.ok ? (
        <p role="status" className="mt-3 rounded-xl border border-primary/30 bg-primary/10 px-4 py-3 text-sm text-primary">{message.text}</p>
      ) : null}
    </section>
  );
}
