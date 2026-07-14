"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ChangeEvent, FormEvent, ReactNode } from "react";

import { formatPriceCents } from "@/lib/billing";
import type { BillingInterval, ClassCategory, ClassCategoryRecord, MembershipPlanRecord } from "@/lib/db";
import {
  classCategoryLabel,
  formatSessionAllowance,
} from "@/lib/scheduling-status";

type PlanFormValues = {
  name: string;
  description: string;
  priceEur: string;
  billingInterval: BillingInterval;
  isUnlimited: boolean;
  monthlySessionAllowance: string;
  allowedCategories: ClassCategory[];
  isActive: boolean;
};

type FormErrors = Partial<Record<keyof PlanFormValues, string>>;

function emptyFormValues(): PlanFormValues {
  return {
    name: "",
    description: "",
    priceEur: "",
    billingInterval: "monthly",
    isUnlimited: false,
    monthlySessionAllowance: "",
    allowedCategories: [],
    isActive: true,
  };
}

function toFormValues(plan: MembershipPlanRecord): PlanFormValues {
  return {
    name: plan.name,
    description: plan.description ?? "",
    priceEur: (plan.priceCents / 100).toFixed(2),
    billingInterval: plan.billingInterval,
    isUnlimited: plan.monthlySessionAllowance === null,
    monthlySessionAllowance:
      plan.monthlySessionAllowance === null ? "" : String(plan.monthlySessionAllowance),
    allowedCategories: plan.allowedCategories,
    isActive: plan.isActive,
  };
}

export function PlansView({
  plans,
  categories,
  deletedLabels,
  memberCounts,
  billingStatus,
}: {
  plans: MembershipPlanRecord[];
  categories: ClassCategoryRecord[];
  deletedLabels: Record<string, string>;
  /** Subscriptions (any status) referencing each plan — nonzero blocks delete. */
  memberCounts: Record<string, number>;
  billingStatus: { checkoutConfigured: boolean; webhookConfigured: boolean };
}) {
  const { checkoutConfigured, webhookConfigured } = billingStatus;
  const isHalfConfigured = checkoutConfigured && !webhookConfigured;
  const router = useRouter();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [values, setValues] = useState<PlanFormValues>(() => emptyFormValues());
  const [errors, setErrors] = useState<FormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [planActionId, setPlanActionId] = useState<string | null>(null);
  const [confirmPlanDeleteId, setConfirmPlanDeleteId] = useState<string | null>(null);
  const [planActionError, setPlanActionError] = useState<string | null>(null);
  const [planActionMessage, setPlanActionMessage] = useState<string | null>(null);

  const [catEditingId, setCatEditingId] = useState<string | null>(null);
  const [catName, setCatName] = useState("");
  const [catFormError, setCatFormError] = useState<string | null>(null);
  const [catFormSuccess, setCatFormSuccess] = useState<string | null>(null);
  const [isSavingCat, setIsSavingCat] = useState(false);
  const [deletingCatId, setDeletingCatId] = useState<string | null>(null);
  const [catDeleteError, setCatDeleteError] = useState<string | null>(null);

  const isEditing = editingId !== null;

  function handleTextChange(
    key: keyof PlanFormValues,
    e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) {
    setValues((prev) => ({ ...prev, [key]: e.target.value }));
    setErrors((prev) => ({ ...prev, [key]: undefined }));
    setSuccessMessage(null);
  }

  function toggleCategory(slug: string) {
    setValues((prev) => ({
      ...prev,
      allowedCategories: prev.allowedCategories.includes(slug)
        ? prev.allowedCategories.filter((c) => c !== slug)
        : [...prev.allowedCategories, slug],
    }));
    setErrors((prev) => ({ ...prev, allowedCategories: undefined }));
    setSuccessMessage(null);
  }

  function startEdit(plan: MembershipPlanRecord) {
    setEditingId(plan.id);
    const knownSlugs = new Set(categories.map((c) => c.slug));
    const base = toFormValues(plan);
    setValues({ ...base, allowedCategories: base.allowedCategories.filter((s) => knownSlugs.has(s)) });
    setErrors({});
    setFormError(null);
    setSuccessMessage(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setValues(emptyFormValues());
    setErrors({});
    setFormError(null);
    setSuccessMessage(null);
  }

  function validate(): boolean {
    const nextErrors: FormErrors = {};

    if (!values.name.trim()) nextErrors.name = "Plan name is required.";
    if (!values.priceEur.trim()) {
      nextErrors.priceEur = "Price is required.";
    } else if (Number.isNaN(Number(values.priceEur)) || Number(values.priceEur) < 0) {
      nextErrors.priceEur = "Price must be a valid, non-negative number.";
    }

    if (!values.isUnlimited) {
      if (!values.monthlySessionAllowance.trim()) {
        nextErrors.monthlySessionAllowance = "Enter a session allowance, or mark this plan unlimited.";
      } else if (
        !Number.isInteger(Number(values.monthlySessionAllowance)) ||
        Number(values.monthlySessionAllowance) <= 0
      ) {
        nextErrors.monthlySessionAllowance = "Session allowance must be a whole number greater than zero.";
      }
    }

    if (values.allowedCategories.length === 0) {
      nextErrors.allowedCategories = "Select at least one class category this plan can book.";
    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!validate()) return;
    setFormError(null);
    setSuccessMessage(null);
    setIsSubmitting(true);
    try {
      const payload = {
        name: values.name,
        description: values.description,
        priceEur: values.priceEur,
        billingInterval: values.billingInterval,
        monthlySessionAllowance: values.isUnlimited ? "unlimited" : values.monthlySessionAllowance,
        allowedCategories: values.allowedCategories,
        isActive: values.isActive,
      };
      const res = await fetch("/api/staff/plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editingId ? { id: editingId, ...payload } : payload),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setFormError(data?.message ?? "Could not save plan. Please try again.");
        return;
      }
      setSuccessMessage(data?.message ?? "Plan saved.");
      setEditingId(null);
      setValues(emptyFormValues());
      router.refresh();
    } catch {
      setFormError("Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleToggleArchive(plan: MembershipPlanRecord) {
    setPlanActionId(plan.id);
    setPlanActionError(null);
    setPlanActionMessage(null);

    try {
      const res = await fetch("/api/staff/plans/archive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: plan.id, isActive: !plan.isActive }),
      });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        setPlanActionError(data?.message ?? "Could not update plan. Please try again.");
        return;
      }

      setPlanActionMessage(data?.message ?? "Plan updated.");
      router.refresh();
    } catch {
      setPlanActionError("Something went wrong. Please try again.");
    } finally {
      setPlanActionId(null);
    }
  }

  async function handleDeletePlan(planId: string) {
    setPlanActionId(planId);
    setPlanActionError(null);
    setPlanActionMessage(null);

    try {
      const res = await fetch("/api/staff/plans/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: planId }),
      });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        setPlanActionError(data?.message ?? "Could not delete plan. Please try again.");
        return;
      }

      setPlanActionMessage(data?.message ?? "Plan deleted.");
      setConfirmPlanDeleteId(null);
      router.refresh();
    } catch {
      setPlanActionError("Something went wrong. Please try again.");
    } finally {
      setPlanActionId(null);
    }
  }

  function startEditCat(cat: ClassCategoryRecord) {
    setCatEditingId(cat.id);
    setCatName(cat.name);
    setCatFormError(null);
    setCatFormSuccess(null);
  }

  function cancelEditCat() {
    setCatEditingId(null);
    setCatName("");
    setCatFormError(null);
    setCatFormSuccess(null);
  }

  async function handleSaveCat(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!catName.trim()) {
      setCatFormError("Category name is required.");
      return;
    }
    setCatFormError(null);
    setCatFormSuccess(null);
    setIsSavingCat(true);
    try {
      const payload = catEditingId
        ? { id: catEditingId, name: catName.trim() }
        : { name: catName.trim() };
      const res = await fetch("/api/staff/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setCatFormError(data?.message ?? "Could not save category.");
        return;
      }
      setCatFormSuccess(data?.message ?? "Category saved.");
      setCatEditingId(null);
      setCatName("");
      router.refresh();
    } catch {
      setCatFormError("Something went wrong. Please try again.");
    } finally {
      setIsSavingCat(false);
    }
  }

  async function handleDeleteCat(id: string) {
    setDeletingCatId(id);
    setCatDeleteError(null);
    try {
      const res = await fetch("/api/staff/categories/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setCatDeleteError(data?.message ?? "Could not delete category.");
        return;
      }
      router.refresh();
    } catch {
      setCatDeleteError("Something went wrong.");
    } finally {
      setDeletingCatId(null);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header card */}
      <div>
        <p className="label-caps">Staff</p>
        <h2 className="text-display mt-1 text-[28px] leading-tight">
          {isEditing ? "Edit plan" : "Create a plan"}
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Plans you create here appear to members on the membership page.{" "}
          {checkoutConfigured
            ? "Online checkout is configured — members are sent to a secure Stripe checkout to pay when they select a plan."
            : "Online payment isn't configured yet, so members selecting a plan only records intent — no charge occurs. See docs/payments-architecture.md for setup."}
        </p>
      </div>

      {isHalfConfigured ? (
        <div className="rounded-3xl border border-amber-500/40 bg-amber-500/10 p-5">
          <p className="text-sm font-semibold text-amber-300">Billing is half-configured</p>
          <p className="mt-2 text-sm text-amber-200/80">
            Checkout is set up, but the webhook signing secret isn&apos;t — payments
            won&apos;t be confirmed automatically, so members will get stuck on
            &quot;Awaiting payment&quot; after paying. Set{" "}
            <code>STRIPE_WEBHOOK_SECRET</code> (see{" "}
            <code>docs/payments-architecture.md</code>) to fix this.
          </p>
        </div>
      ) : null}

      {/* Plan form */}
      <form
        onSubmit={handleSubmit}
        className="panel rounded-3xl p-6"
      >
        {formError ? (
          <p className="mb-4 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {formError}
          </p>
        ) : null}

        {successMessage ? (
          <p className="mb-4 rounded-xl border border-primary/30 bg-primary/10 px-4 py-3 text-sm text-primary">
            {successMessage}
          </p>
        ) : null}

        <div className="grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <FormField label="Plan name" error={errors.name}>
              <input
                type="text"
                value={values.name}
                onChange={(e) => handleTextChange("name", e)}
                className={inputClass(errors.name)}
                placeholder="e.g. Premium"
              />
            </FormField>
          </div>

          <FormField label="Price (EUR)" error={errors.priceEur}>
            <input
              type="number"
              min={0}
              step="0.01"
              value={values.priceEur}
              onChange={(e) => handleTextChange("priceEur", e)}
              className={inputClass(errors.priceEur)}
              placeholder="e.g. 49.99"
            />
          </FormField>

          <FormField label="Billing interval" error={errors.billingInterval}>
            <select
              value={values.billingInterval}
              onChange={(e) => handleTextChange("billingInterval", e)}
              className={inputClass(errors.billingInterval)}
            >
              <option value="monthly">Monthly</option>
              <option value="annual">Annual</option>
            </select>
          </FormField>

          <div className="md:col-span-2">
            <FormField label="Monthly session allowance" error={errors.monthlySessionAllowance}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={values.monthlySessionAllowance}
                  disabled={values.isUnlimited}
                  onChange={(e) => handleTextChange("monthlySessionAllowance", e)}
                  className={`${inputClass(errors.monthlySessionAllowance)} sm:max-w-[160px] ${
                    values.isUnlimited ? "cursor-not-allowed opacity-50" : ""
                  }`}
                  placeholder="e.g. 8"
                />
                <label className="flex items-center gap-2 text-sm text-foreground">
                  <input
                    type="checkbox"
                    checked={values.isUnlimited}
                    onChange={(e) =>
                      setValues((prev) => ({ ...prev, isUnlimited: e.target.checked }))
                    }
                    className="h-4 w-4 accent-primary"
                  />
                  Unlimited sessions
                </label>
              </div>
            </FormField>
          </div>

          <div className="md:col-span-2">
            <FormField label="Class categories this plan can book" error={errors.allowedCategories}>
              {categories.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No categories yet — add some in the{" "}
                  <span className="text-gold">Manage categories</span> section below.
                </p>
              ) : (
                <div className="flex flex-wrap gap-3">
                  {categories.map((cat) => (
                    <label
                      key={cat.slug}
                      className="flex items-center gap-2 well rounded-xl px-3 py-2 text-sm text-foreground"
                    >
                      <input
                        type="checkbox"
                        checked={values.allowedCategories.includes(cat.slug)}
                        onChange={() => toggleCategory(cat.slug)}
                        className="h-4 w-4 accent-primary"
                      />
                      {cat.name}
                    </label>
                  ))}
                </div>
              )}
            </FormField>
          </div>

          <div className="md:col-span-2">
            <FormField
              label={
                <>
                  Description{" "}
                  <span className="text-xs font-normal text-muted-foreground">optional</span>
                </>
              }
              error={errors.description}
            >
              <textarea
                value={values.description}
                onChange={(e) => handleTextChange("description", e)}
                className={`${inputClass(errors.description)} min-h-[80px] resize-y`}
                placeholder="What's included with this plan"
              />
            </FormField>
          </div>

          <label className="flex items-center gap-2 text-sm text-foreground md:col-span-2">
            <input
              type="checkbox"
              checked={values.isActive}
              onChange={(e) =>
                setValues((prev) => ({ ...prev, isActive: e.target.checked }))
              }
              className="h-4 w-4 accent-primary"
            />
            Visible to members
          </label>
        </div>

        <div className="mt-6 flex flex-col-reverse gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-end">
          {isEditing ? (
            <button
              type="button"
              onClick={cancelEdit}
              className="rounded-xl border border-border px-5 py-2 text-sm font-medium text-foreground transition hover:bg-accent"
            >
              Cancel
            </button>
          ) : null}

          <button
            type="submit"
            disabled={isSubmitting}
            className="btn-primary px-5 py-2 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? "Saving…" : isEditing ? "Update plan" : "Create plan"}
          </button>
        </div>
      </form>

      {/* Plan list */}
      <div className="panel p-6">
        <h3 className="text-lg font-semibold">All plans</h3>

        {planActionError ? (
          <p className="mt-3 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {planActionError}
          </p>
        ) : null}
        {planActionMessage ? (
          <p className="mt-3 rounded-xl border border-primary/30 bg-primary/10 px-3 py-2 text-sm text-primary">
            {planActionMessage}
          </p>
        ) : null}

        {plans.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            No plans yet. Create the first one above.
          </p>
        ) : (
          <div className="mt-5 space-y-3">
            {plans.map((plan) => {
              const memberCount = memberCounts[plan.id] ?? 0;
              const canDelete = memberCount === 0;
              const isConfirmingDelete = confirmPlanDeleteId === plan.id;
              const isBusy = planActionId === plan.id;

              return (
              <div
                key={plan.id}
                className="well p-4"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h4 className="text-base font-semibold">{plan.name}</h4>
                    {plan.description ? (
                      <p className="mt-1 text-sm text-muted-foreground">{plan.description}</p>
                    ) : null}
                    <div className="mt-3 flex flex-wrap gap-2">
                      {plan.allowedCategories.length === 0 ? (
                        <span className="rounded-full bg-secondary px-3 py-1 text-xs font-medium text-secondary-foreground">
                          All categories
                        </span>
                      ) : (
                        plan.allowedCategories.map((category) => (
                          <span
                            key={category}
                            className="rounded-full bg-secondary px-3 py-1 text-xs font-medium text-secondary-foreground"
                          >
                            {classCategoryLabel(categories, category, deletedLabels)}
                          </span>
                        ))
                      )}
                    </div>
                  </div>

                  <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
                    <span className="rounded-full bg-secondary px-3 py-1 text-xs font-medium text-secondary-foreground">
                      {formatPriceCents(plan.priceCents)} / {plan.billingInterval}
                    </span>
                    <span className="rounded-full bg-secondary px-3 py-1 text-xs font-medium text-secondary-foreground">
                      {formatSessionAllowance(plan.monthlySessionAllowance)}
                    </span>
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-semibold ${
                        plan.isActive
                          ? "bg-primary/15 text-primary"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {plan.isActive ? "Visible" : "Archived"}
                    </span>
                    {memberCount > 0 ? (
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {memberCount} member{memberCount === 1 ? "" : "s"}
                      </span>
                    ) : null}
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => startEdit(plan)}
                        className="rounded-xl border border-border px-3 py-1 text-xs font-medium text-foreground transition hover:bg-accent"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => handleToggleArchive(plan)}
                        disabled={isBusy}
                        className="rounded-xl border border-border px-3 py-1 text-xs font-medium text-foreground transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {isBusy ? "Saving…" : plan.isActive ? "Archive" : "Unarchive"}
                      </button>
                      {canDelete && !isConfirmingDelete ? (
                        <button
                          type="button"
                          onClick={() => {
                            setConfirmPlanDeleteId(plan.id);
                            setPlanActionError(null);
                            setPlanActionMessage(null);
                          }}
                          className="rounded-xl border border-destructive/30 px-3 py-1 text-xs font-medium text-destructive transition hover:border-destructive/60"
                        >
                          Delete
                        </button>
                      ) : null}
                    </div>
                    {!canDelete ? (
                      <p className="max-w-[220px] text-[11px] text-muted-foreground sm:text-right">
                        In use by {memberCount} member{memberCount === 1 ? "" : "s"} — can&apos;t
                        be deleted. Archive it to hide it from new customers.
                      </p>
                    ) : null}
                    {canDelete && isConfirmingDelete ? (
                      <div className="flex flex-col items-start gap-1.5 sm:items-end">
                        <p className="text-[11px] text-muted-foreground sm:text-right">
                          No members reference this plan. This can&apos;t be undone.
                        </p>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => handleDeletePlan(plan.id)}
                            disabled={isBusy}
                            className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-1 text-xs font-semibold text-destructive transition hover:bg-destructive/20 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {isBusy ? "Deleting…" : "Confirm delete"}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmPlanDeleteId(null)}
                            disabled={isBusy}
                            className="rounded-xl border border-border px-3 py-1 text-xs font-medium text-foreground transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            Keep plan
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Category management */}
      <div>
        <h3 className="text-lg font-semibold">Manage categories</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Categories appear on the class and plan forms. Deleting a category removes it from future
          selections — existing classes and plans are not affected and will continue to display their
          category label.
        </p>

        <form
          onSubmit={handleSaveCat}
          className="mt-5 well p-4"
        >
          {catFormError ? (
            <p className="mb-3 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {catFormError}
            </p>
          ) : null}
          {catFormSuccess ? (
            <p className="mb-3 rounded-xl border border-primary/30 bg-primary/10 px-3 py-2 text-sm text-primary">
              {catFormSuccess}
            </p>
          ) : null}

          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <label className="mb-2 block text-sm font-medium text-foreground">
                {catEditingId ? "Category name" : "New category"}
              </label>
              <input
                type="text"
                value={catName}
                onChange={(e) => {
                  setCatName(e.target.value);
                  setCatFormError(null);
                  setCatFormSuccess(null);
                }}
                className={inputClass(catFormError && !catName.trim() ? "error" : undefined)}
                placeholder="e.g. Yoga"
              />
            </div>
            <div className="flex gap-2">
              {catEditingId ? (
                <button
                  type="button"
                  onClick={cancelEditCat}
                  className="rounded-xl border border-border px-4 py-2 text-sm font-medium text-foreground transition hover:bg-accent"
                >
                  Cancel
                </button>
              ) : null}
              <button
                type="submit"
                disabled={isSavingCat}
                className="btn-primary px-4 py-2 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSavingCat ? "Saving…" : catEditingId ? "Update" : "Add category"}
              </button>
            </div>
          </div>
        </form>

        {catDeleteError ? (
          <p className="mt-3 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {catDeleteError}
          </p>
        ) : null}

        <div className="mt-4 space-y-2">
          {categories.length === 0 ? (
            <p className="text-sm text-muted-foreground">No categories yet. Add one above.</p>
          ) : (
            categories.map((cat) => (
              <div
                key={cat.id}
                className="flex flex-wrap items-center justify-between gap-2 well p-3"
              >
                <div>
                  <p className="text-sm font-medium">{cat.name}</p>
                  <p className="text-xs text-muted-foreground">{cat.slug}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => startEditCat(cat)}
                    className="rounded-xl border border-border px-3 py-1 text-xs font-medium text-foreground transition hover:bg-accent"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteCat(cat.id)}
                    disabled={deletingCatId === cat.id}
                    className="rounded-xl border border-destructive/30 px-3 py-1 text-xs font-medium text-destructive transition hover:border-destructive/60 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {deletingCatId === cat.id ? "Deleting…" : "Delete"}
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function FormField({
  label,
  error,
  children,
}: {
  label: ReactNode;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-medium text-foreground">{label}</span>
      {children}
      {error ? <p className="mt-1 text-xs text-destructive">{error}</p> : null}
    </label>
  );
}

function inputClass(hasError?: string) {
  return `w-full rounded-xl border bg-input px-4 py-3 text-sm text-foreground outline-none transition placeholder:text-muted-foreground ${
    hasError
      ? "border-destructive focus:border-destructive"
      : "border-border focus:border-teal-600/60 focus:ring-2 focus:ring-teal-600/15"
  }`;
}
