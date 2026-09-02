"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ReactNode } from "react";

import { formatPriceCents } from "@/lib/billing";
import {
  ACCESS_TYPE_LABEL,
  ACCESS_TYPE_OPTIONS,
  BILLING_CHANNEL_LABEL,
  BILLING_CHANNEL_OPTIONS,
  DELIVERY_CHANNEL_LABEL,
  DELIVERY_CHANNEL_OPTIONS,
  describePackageAllowance,
  formatBillingOptionCadence,
} from "@/lib/catalog";
import type {
  AccessType,
  BillingChannel,
  ClassCategoryRecord,
  DeliveryChannel,
  MembershipBillingOptionRecord,
  MembershipCategoryRecord,
  MembershipPackageRecord,
} from "@/lib/db";
import { CoverImageField } from "@/components/ui/CoverImageField";

const input =
  "w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-teal-600/60 focus:ring-2 focus:ring-teal-600/15";
const label = "mb-1 block text-xs font-medium text-muted-foreground";

async function post(url: string, body: unknown): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    return { ok: res.ok, message: data?.message ?? (res.ok ? "Saved." : "Something went wrong.") };
  } catch {
    return { ok: false, message: "Something went wrong. Please try again." };
  }
}

export function CatalogView({
  categories,
  packages,
  billingOptions,
  classCategories,
}: {
  categories: MembershipCategoryRecord[];
  packages: MembershipPackageRecord[];
  billingOptions: MembershipBillingOptionRecord[];
  classCategories: ClassCategoryRecord[];
}) {
  const router = useRouter();
  const [openCat, setOpenCat] = useState<string | null>(categories[0]?.id ?? null);
  const [openPkg, setOpenPkg] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ ok: boolean; message: string } | null>(null);

  async function run(fn: () => Promise<{ ok: boolean; message: string }>) {
    const r = await fn();
    setBanner(r);
    if (r.ok) router.refresh();
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="label-caps">Staff</p>
        <h2 className="text-display mt-1 text-[28px] leading-tight">Membership catalog</h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          This is what members see when they join. It has three levels:
        </p>
        <ul className="mt-2 max-w-2xl space-y-1 text-sm text-muted-foreground">
          <li>
            <span className="font-medium text-foreground">Category</span> — a top-level heading
            members browse first (e.g. Semi-Private PT).
          </li>
          <li>
            <span className="font-medium text-foreground">Package</span> — the actual membership or
            pass, and what it includes (its session allowance and class access).
          </li>
          <li>
            <span className="font-medium text-foreground">Billing option</span> — how a member pays
            for that package (monthly/quarterly/annual, or a one-off). One package can have several.
          </li>
        </ul>
        <p className="mt-2 max-w-2xl text-xs leading-relaxed text-muted-foreground">
          Only <span className="font-medium">visible</span> items appear to members. Deletes are
          blocked while something is still in use — hide it instead.
        </p>
      </div>

      {banner ? (
        <p
          className={`rounded-xl border px-4 py-3 text-sm ${
            banner.ok
              ? "border-primary/30 bg-primary/10 text-primary"
              : "border-destructive/30 bg-destructive/10 text-destructive"
          }`}
        >
          {banner.message}
        </p>
      ) : null}

      {/* New category */}
      <CategoryForm onSave={(payload) => run(() => post("/api/staff/catalog/categories", payload))} />

      {categories.length === 0 ? (
        <p className="text-sm text-muted-foreground">No categories yet — create the first one above.</p>
      ) : (
        categories.map((cat) => {
          const catPackages = packages.filter((p) => p.categoryId === cat.id);
          const open = openCat === cat.id;
          return (
            <div key={cat.id} className="panel p-5">
              <div className="flex items-start justify-between gap-3">
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => setOpenCat(open ? null : cat.id)}
                  className="flex flex-1 items-center gap-2 text-left"
                >
                  <span className="text-lg font-semibold">{cat.name}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">{catPackages.length}</span>
                  {!cat.visible ? (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">Hidden</span>
                  ) : null}
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}><path d="M19 9l-7 7-7-7" /></svg>
                </button>
                <RowActions
                  visible={cat.visible}
                  onToggleVisible={() => run(() => post("/api/staff/catalog/categories", { id: cat.id, name: cat.name, description: cat.description, sortOrder: cat.sortOrder, visible: !cat.visible }))}
                  onDelete={() => run(() => post("/api/staff/catalog/categories/delete", { id: cat.id }))}
                  editForm={
                    <CategoryForm
                      category={cat}
                      onSave={(payload) => run(() => post("/api/staff/catalog/categories", { id: cat.id, ...payload }))}
                    />
                  }
                />
              </div>

              {open ? (
                <div className="mt-4 space-y-3 border-t border-border/60 pt-4">
                  {catPackages.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No packages in this category yet.</p>
                  ) : (
                    catPackages.map((pkg) => {
                      const pkgOptions = billingOptions.filter((o) => o.packageId === pkg.id);
                      const priceCue = packagePriceCue(pkgOptions);
                      const pOpen = openPkg === pkg.id;
                      return (
                        <div key={pkg.id} className="well p-4">
                          <div className="flex items-start justify-between gap-3">
                            <button type="button" aria-expanded={pOpen} onClick={() => setOpenPkg(pOpen ? null : pkg.id)} className="flex flex-1 flex-col text-left">
                              <span className="flex flex-wrap items-center gap-2">
                                <span className="text-sm font-semibold">{pkg.name}</span>
                                {/* Visual cue: how many billing options + cheapest visible price. */}
                                <span className="rounded-full border border-primary/25 bg-primary/[0.06] px-2 py-0.5 text-[10px] font-semibold text-primary tabular-nums">
                                  {pkgOptions.length} option{pkgOptions.length === 1 ? "" : "s"}
                                </span>
                                {priceCue ? (
                                  <span className="rounded-full bg-white/[0.04] px-2 py-0.5 text-[10px] font-medium text-muted-foreground tabular-nums">
                                    {priceCue}
                                  </span>
                                ) : (
                                  <span className="rounded-full bg-gold/[0.1] px-2 py-0.5 text-[10px] font-medium text-gold">
                                    no pricing yet
                                  </span>
                                )}
                                {!pkg.visible ? <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">Hidden</span> : null}
                                {pkg.deliveryChannel !== "in_person" ? (
                                  <span className="rounded-full border border-gold/30 bg-gold/[0.08] px-2 py-0.5 text-[10px] font-semibold text-gold">
                                    {DELIVERY_CHANNEL_LABEL[pkg.deliveryChannel]} · {BILLING_CHANNEL_LABEL[pkg.billingChannel]}
                                  </span>
                                ) : null}
                              </span>
                              <span className="mt-0.5 text-xs text-muted-foreground">
                                {describePackageAllowance(pkg)} · {pkg.packageType} · {ACCESS_TYPE_LABEL[pkg.accessType]}
                              </span>
                            </button>
                            <RowActions
                              visible={pkg.visible}
                              onToggleVisible={() => run(() => post("/api/staff/catalog/packages", packagePayload(pkg, { visible: !pkg.visible })))}
                              onDelete={() => run(() => post("/api/staff/catalog/packages/delete", { id: pkg.id }))}
                              editForm={<PackageForm categoryId={cat.id} pkg={pkg} classCategories={classCategories} onSave={(payload) => run(() => post("/api/staff/catalog/packages", { id: pkg.id, ...payload }))} />}
                            />
                          </div>

                          {pOpen ? (
                            <div className="mt-3 space-y-2 border-t border-border/60 pt-3">
                              <div className="flex items-baseline justify-between gap-2">
                                <h5 className="text-xs font-semibold text-foreground">Billing options / Pricing</h5>
                                <span className="text-[10px] text-muted-foreground">{cat.name} ▸ {pkg.name}</span>
                              </div>
                              <p className="text-[11px] leading-snug text-muted-foreground">
                                How members pay for this package — add each way to pay (Monthly, Quarterly, Annual, or a one-off).
                              </p>
                              {pkgOptions.length === 0 ? (
                                <p className="rounded-lg border border-dashed border-border/60 px-3 py-2 text-[11px] text-muted-foreground">
                                  No billing options yet — add the first price below so members can join.
                                </p>
                              ) : null}
                              {pkgOptions.map((opt) => (
                                <div key={opt.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/60 bg-white/[0.02] px-3 py-2">
                                  <div className="min-w-0">
                                    <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                                      <span className="text-sm font-semibold tabular-nums">
                                        {formatPriceCents(opt.amountCents)}{opt.currency && opt.currency !== "eur" ? ` ${opt.currency.toUpperCase()}` : ""}
                                      </span>
                                      <span className="text-xs text-muted-foreground">{formatBillingOptionCadence(opt)}</span>
                                      <span className="text-xs font-medium text-foreground">· {opt.name}</span>
                                    </p>
                                    <p className="text-[11px] text-muted-foreground">
                                      {opt.billingType === "recurring" ? "Recurring" : "One-off"}
                                      {opt.stripePriceId ? " · Stripe price ID set" : " · inline price (no Stripe ID)"}
                                      {!opt.visible ? " · hidden" : ""}
                                    </p>
                                  </div>
                                  <RowActions
                                    visible={opt.visible}
                                    onToggleVisible={() => run(() => post("/api/staff/catalog/billing-options", optionPayload(opt, { visible: !opt.visible })))}
                                    onDelete={() => run(() => post("/api/staff/catalog/billing-options/delete", { id: opt.id }))}
                                    editForm={<BillingOptionForm packageId={pkg.id} option={opt} onSave={(payload) => run(() => post("/api/staff/catalog/billing-options", { id: opt.id, ...payload }))} />}
                                  />
                                </div>
                              ))}
                              <BillingOptionForm packageId={pkg.id} onSave={(payload) => run(() => post("/api/staff/catalog/billing-options", payload))} />
                            </div>
                          ) : null}
                        </div>
                      );
                    })
                  )}
                  <PackageForm categoryId={cat.id} classCategories={classCategories} onSave={(payload) => run(() => post("/api/staff/catalog/packages", payload))} />
                </div>
              ) : null}
            </div>
          );
        })
      )}
    </div>
  );
}

function packagePayload(pkg: MembershipPackageRecord, overrides: Record<string, unknown>) {
  return {
    id: pkg.id,
    categoryId: pkg.categoryId,
    name: pkg.name,
    shortDescription: pkg.shortDescription,
    fullDescription: pkg.fullDescription,
    packageType: pkg.packageType,
    sessionAllowanceType: pkg.sessionAllowanceType,
    sessionAllowanceCount: pkg.sessionAllowanceCount,
    eligibleClassTypes: pkg.eligibleClassTypes,
    visible: pkg.visible,
    sortOrder: pkg.sortOrder,
    stripeProductId: pkg.stripeProductId,
    deliveryChannel: pkg.deliveryChannel,
    billingChannel: pkg.billingChannel,
    accessType: pkg.accessType,
    ...overrides,
  };
}

function optionPayload(opt: MembershipBillingOptionRecord, overrides: Record<string, unknown>) {
  return {
    id: opt.id,
    packageId: opt.packageId,
    name: opt.name,
    billingType: opt.billingType,
    intervalUnit: opt.intervalUnit,
    intervalCount: opt.intervalCount,
    priceEur: (opt.amountCents / 100).toFixed(2),
    currency: opt.currency,
    visible: opt.visible,
    sortOrder: opt.sortOrder,
    stripePriceId: opt.stripePriceId,
    ...overrides,
  };
}

// Compact pricing cue for a package row: the cheapest VISIBLE price, preferring
// recurring (mirrors the member "from €X" rule) and falling back to a one-off
// when the package has no recurring options. Returns null if nothing visible.
function packagePriceCue(options: MembershipBillingOptionRecord[]): string | null {
  const visible = options.filter((o) => o.visible);
  if (visible.length === 0) return null;
  const recurring = visible.filter((o) => o.billingType === "recurring");
  const pool = recurring.length > 0 ? recurring : visible;
  const cheapest = pool.reduce((min, o) => (o.amountCents < min.amountCents ? o : min), pool[0]);
  const cadence = shortCadence(cheapest);
  return `from ${formatPriceCents(cheapest.amountCents)}${cadence}`;
}

function shortCadence(option: MembershipBillingOptionRecord): string {
  if (option.billingType === "one_time") return " one-off";
  if (option.intervalUnit === "year") return "/yr";
  if (option.intervalUnit === "month" && option.intervalCount === 3) return "/qtr";
  return "/mo";
}

// ── Expandable action cluster: Edit form + hide + delete ──
function RowActions({
  visible,
  onToggleVisible,
  onDelete,
  editForm,
}: {
  visible: boolean;
  onToggleVisible: () => void;
  onDelete: () => void;
  editForm: ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="flex shrink-0 flex-col items-end gap-2">
      <div className="flex flex-wrap justify-end gap-1.5">
        <button type="button" onClick={() => setEditing((e) => !e)} className="rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-foreground transition hover:bg-accent">
          {editing ? "Close" : "Edit"}
        </button>
        <button type="button" onClick={onToggleVisible} className="rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-foreground transition hover:bg-accent">
          {visible ? "Hide" : "Show"}
        </button>
        {confirming ? (
          <>
            <button type="button" onClick={onDelete} className="rounded-lg border border-destructive/40 bg-destructive/10 px-2.5 py-1 text-xs font-semibold text-destructive transition hover:bg-destructive/20">Confirm</button>
            <button type="button" onClick={() => setConfirming(false)} className="rounded-lg border border-border px-2.5 py-1 text-xs text-foreground transition hover:bg-accent">Cancel</button>
          </>
        ) : (
          <button type="button" onClick={() => setConfirming(true)} className="rounded-lg border border-destructive/30 px-2.5 py-1 text-xs font-medium text-destructive transition hover:border-destructive/60">Delete</button>
        )}
      </div>
      {editing ? <div className="w-full min-w-[280px]">{editForm}</div> : null}
    </div>
  );
}

// ── Forms ──
function Field({ label: l, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className={label}>{l}</span>
      {children}
      {hint ? <span className="mt-1 block text-[11px] leading-snug text-muted-foreground/80">{hint}</span> : null}
    </label>
  );
}

function CategoryForm({
  category,
  onSave,
}: {
  category?: MembershipCategoryRecord;
  onSave: (payload: Record<string, unknown>) => void;
}) {
  const [name, setName] = useState(category?.name ?? "");
  const [description, setDescription] = useState(category?.description ?? "");
  const [sortOrder, setSortOrder] = useState(String(category?.sortOrder ?? 0));
  const [imageUrl, setImageUrl] = useState<string | null>(category?.imageUrl ?? null);
  const [imageAlt, setImageAlt] = useState(category?.imageAlt ?? "");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave({ name, description, sortOrder: Number(sortOrder), visible: category?.visible ?? true, imageUrl, imageAlt });
        if (!category) { setName(""); setImageUrl(null); setImageAlt(""); }
      }}
      className={category ? "space-y-2" : "panel space-y-2 p-4"}
    >
      {!category ? <h3 className="text-sm font-semibold">New category</h3> : null}
      <Field label="Name"><input className={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Semi-Private PT" /></Field>
      <Field label="Description (optional)"><input className={input} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
      <CoverImageField
        seed={category?.id ?? name}
        label={name || undefined}
        value={imageUrl}
        onChange={setImageUrl}
        alt={imageAlt}
        onAltChange={setImageAlt}
        hint="Optional — shown as the card's photo banner on the member catalog page. A placeholder is used if none is set."
      />
      <div className="flex items-end gap-2">
        <div className="w-24"><Field label="Sort"><input type="number" className={input} value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} /></Field></div>
        <button type="submit" className="btn-primary px-4 py-2 text-xs">{category ? "Save category" : "Add category"}</button>
      </div>
    </form>
  );
}

function PackageForm({
  categoryId,
  pkg,
  classCategories,
  onSave,
}: {
  categoryId: string;
  pkg?: MembershipPackageRecord;
  classCategories: ClassCategoryRecord[];
  onSave: (payload: Record<string, unknown>) => void;
}) {
  const [name, setName] = useState(pkg?.name ?? "");
  const [shortDescription, setShort] = useState(pkg?.shortDescription ?? "");
  const [packageType, setType] = useState(pkg?.packageType ?? "membership");
  const [allowanceType, setAllowanceType] = useState(pkg?.sessionAllowanceType ?? "fixed_count");
  const [count, setCount] = useState(pkg?.sessionAllowanceCount != null ? String(pkg.sessionAllowanceCount) : "");
  const [eligible, setEligible] = useState<string[]>(pkg?.eligibleClassTypes ?? []);
  const [sortOrder, setSortOrder] = useState(String(pkg?.sortOrder ?? 0));
  const [stripeProductId, setStripeProductId] = useState(pkg?.stripeProductId ?? "");
  const [imageUrl, setImageUrl] = useState<string | null>(pkg?.imageUrl ?? null);
  const [imageAlt, setImageAlt] = useState(pkg?.imageAlt ?? "");
  const [deliveryChannel, setDeliveryChannel] = useState<DeliveryChannel>(pkg?.deliveryChannel ?? "in_person");
  const [billingChannel, setBillingChannel] = useState<BillingChannel>(pkg?.billingChannel ?? "stripe_web");
  const [accessType, setAccessType] = useState<AccessType>(pkg?.accessType ?? "membership");

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave({
          categoryId, name, shortDescription, fullDescription: null, packageType,
          sessionAllowanceType: allowanceType,
          sessionAllowanceCount: allowanceType === "fixed_count" ? Number(count) : null,
          eligibleClassTypes: eligible, visible: pkg?.visible ?? true, sortOrder: Number(sortOrder), stripeProductId, imageUrl, imageAlt,
          deliveryChannel, billingChannel, accessType,
        });
        if (!pkg) { setName(""); setCount(""); setImageUrl(null); setImageAlt(""); }
      }}
      className={pkg ? "space-y-2" : "rounded-2xl border border-border/60 bg-white/[0.02] p-4 space-y-2"}
    >
      <h4 className="text-xs font-semibold text-muted-foreground">{pkg ? "Edit package" : "New package"}</h4>
      <Field label="Name"><input className={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Unlimited Sessions" /></Field>
      <Field label="Short description (optional)"><input className={input} value={shortDescription} onChange={(e) => setShort(e.target.value)} /></Field>
      <CoverImageField
        seed={pkg?.id ?? categoryId}
        label={name || undefined}
        value={imageUrl}
        onChange={setImageUrl}
        alt={imageAlt}
        onAltChange={setImageAlt}
        hint="Optional — shown on the public landing page card. A placeholder is used if none is set."
      />
      <div className="grid grid-cols-2 gap-2">
        <Field label="Type" hint="Membership = recurring; Pass/Top-up = one-off.">
          <select className={input} value={packageType} onChange={(e) => setType(e.target.value as typeof packageType)}><option value="membership">Membership</option><option value="pass">Pass</option><option value="top_up">Top-up</option></select>
        </Field>
        <Field label="Session allowance" hint="Unlimited = no cap · Fixed count = a set number each period · Single use = one class.">
          <select className={input} value={allowanceType} onChange={(e) => setAllowanceType(e.target.value as typeof allowanceType)}><option value="unlimited">Unlimited</option><option value="fixed_count">Fixed count</option><option value="single_use">Single use</option></select>
        </Field>
      </div>
      {allowanceType === "fixed_count" ? (
        <Field label="Number of sessions" hint="How many classes this package includes.">
          <input type="number" min={1} className={input} value={count} onChange={(e) => setCount(e.target.value)} placeholder="e.g. 12" />
        </Field>
      ) : null}
      <fieldset>
        <span className={label}>Class types this package can book</span>
        <div className="flex flex-wrap gap-1.5">
          {classCategories.map((c) => {
            const on = eligible.includes(c.slug);
            return (
              <button key={c.slug} type="button" aria-pressed={on} onClick={() => setEligible((prev) => on ? prev.filter((s) => s !== c.slug) : [...prev, c.slug])} className={`rounded-full border px-2.5 py-1 text-xs transition ${on ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-primary"}`}>{c.name}</button>
            );
          })}
        </div>
        <span className="mt-1 block text-[11px] leading-snug text-muted-foreground/80">Leave none selected to allow all class types.</span>
      </fieldset>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Sort"><input type="number" className={input} value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} /></Field>
        <Field label="Stripe product ID" hint="Optional. Paste from your Stripe dashboard to link this package to a Stripe Product.">
          <input className={input} value={stripeProductId} onChange={(e) => setStripeProductId(e.target.value)} placeholder="prod_…" />
        </Field>
      </div>
      <fieldset className="rounded-xl border border-border/60 bg-white/[0.02] p-3">
        <span className="mb-2 block text-xs font-semibold text-foreground">Channel & tier</span>
        <p className="mb-2 text-[11px] leading-snug text-muted-foreground">
          Purely descriptive — how members reach and pay for this package, for Finances reporting. Doesn&apos;t
          change checkout behaviour. Leave as In-person / Stripe (website) for normal Tier 1 gym memberships and
          class passes; use App-only for a Tier 2 subscription sold through Apple/Google.
        </p>
        <div className="grid grid-cols-3 gap-2">
          <Field label="Delivery">
            <select className={input} value={deliveryChannel} onChange={(e) => setDeliveryChannel(e.target.value as DeliveryChannel)}>
              {DELIVERY_CHANNEL_OPTIONS.map((c) => <option key={c} value={c}>{DELIVERY_CHANNEL_LABEL[c]}</option>)}
            </select>
          </Field>
          <Field label="Billed via">
            <select className={input} value={billingChannel} onChange={(e) => setBillingChannel(e.target.value as BillingChannel)}>
              {BILLING_CHANNEL_OPTIONS.map((c) => <option key={c} value={c}>{BILLING_CHANNEL_LABEL[c]}</option>)}
            </select>
          </Field>
          <Field label="Access type">
            <select className={input} value={accessType} onChange={(e) => setAccessType(e.target.value as AccessType)}>
              {ACCESS_TYPE_OPTIONS.map((c) => <option key={c} value={c}>{ACCESS_TYPE_LABEL[c]}</option>)}
            </select>
          </Field>
        </div>
      </fieldset>
      <button type="submit" className="btn-primary px-4 py-2 text-xs">{pkg ? "Save package" : "Add package"}</button>
    </form>
  );
}

function BillingOptionForm({
  packageId,
  option,
  onSave,
}: {
  packageId: string;
  option?: MembershipBillingOptionRecord;
  onSave: (payload: Record<string, unknown>) => void;
}) {
  const [name, setName] = useState(option?.name ?? "");
  const [billingType, setBillingType] = useState(option?.billingType ?? "recurring");
  const [interval, setInterval] = useState<string>(
    option?.intervalUnit === "year" ? "annual" : option?.intervalUnit === "month" && option?.intervalCount === 3 ? "quarterly" : "monthly"
  );
  const [priceEur, setPriceEur] = useState(option ? (option.amountCents / 100).toFixed(2) : "");
  const [currency, setCurrency] = useState((option?.currency ?? "eur").toUpperCase());
  const [sortOrder, setSortOrder] = useState(String(option?.sortOrder ?? 0));
  const [stripePriceId, setStripePriceId] = useState(option?.stripePriceId ?? "");

  function cadence() {
    if (interval === "annual") return { intervalUnit: "year", intervalCount: 1 };
    if (interval === "quarterly") return { intervalUnit: "month", intervalCount: 3 };
    return { intervalUnit: "month", intervalCount: 1 };
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const c = billingType === "recurring" ? cadence() : { intervalUnit: null, intervalCount: null };
        onSave({ packageId, name, billingType, ...c, priceEur, currency: currency.trim().toLowerCase() || "eur", visible: option?.visible ?? true, sortOrder: Number(sortOrder), stripePriceId });
        if (!option) { setName(""); setPriceEur(""); }
      }}
      className={option ? "space-y-2" : "rounded-2xl border border-border/60 bg-white/[0.02] p-3 space-y-2"}
    >
      <h4 className="text-xs font-semibold text-muted-foreground">{option ? "Edit billing option" : "New billing option — a way to pay for this package"}</h4>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Label" hint="What members see, e.g. Monthly.">
          <input className={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Monthly" />
        </Field>
        <Field label="Billing" hint="Recurring auto-renews; one-off is a single payment.">
          <select className={input} value={billingType} onChange={(e) => setBillingType(e.target.value as typeof billingType)}><option value="recurring">Recurring</option><option value="one_time">One-time</option></select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {billingType === "recurring" ? (
          <Field label="Renews every"><select className={input} value={interval} onChange={(e) => setInterval(e.target.value)}><option value="monthly">Month</option><option value="quarterly">3 months</option><option value="annual">Year</option></select></Field>
        ) : <div />}
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <Field label="Amount"><input type="number" min={0} step="0.01" className={input} value={priceEur} onChange={(e) => setPriceEur(e.target.value)} placeholder="e.g. 250.00" /></Field>
          <div className="w-20"><Field label="Currency" hint="ISO code."><input className={input} value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} maxLength={3} placeholder="EUR" /></Field></div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Sort"><input type="number" className={input} value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} /></Field>
        <Field label="Stripe price ID" hint="Optional. Paste a Stripe Price ID to charge that exact price; leave blank to charge the amount above.">
          <input className={input} value={stripePriceId} onChange={(e) => setStripePriceId(e.target.value)} placeholder="price_…" />
        </Field>
      </div>
      <button type="submit" className="btn-primary px-4 py-2 text-xs">{option ? "Save option" : "Add option"}</button>
    </form>
  );
}
