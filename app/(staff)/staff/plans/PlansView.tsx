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
  billingStatus,
}: {
  plans: MembershipPlanRecord[];
  categories: ClassCategoryRecord[];
  deletedLabels: Record<string, string>;
  billingStatus: { checkoutConfigured: boolean; webhookConfigured: boolean };
}) {
  const { checkoutConfigured, webhookConfigured } = billingStatus;
  const isHalfConfigured = checkoutConfigured && !webhookConfigured;
  const router = useRouter();

  // Plan form state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [values, setValues] = useState<PlanFormValues>(() => emptyFormValues());
  const [errors, setErrors] = useState<FormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Category management state
  const [catEditingId, setCatEditingId] = useState<string | null>(null);
  const [catName, setCatName] = useState("");
  const [catFormError, setCatFormError] = useState<string | null>(null);
  const [catFormSuccess, setCatFormSuccess] = useState<string | null>(null);
  const [isSavingCat, setIsSavingCat] = useState(false);
  const [deletingCatId, setDeletingCatId] = useState<string | null>(null);
  const [catDeleteError, setCatDeleteError] = useState<string | null>(null);

  const isEditing = editingId !== null;

  // Plan form handlers
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
    // Drop slugs for deleted categories — no checkbox is rendered for them
    // and the server validates against current category slugs only.
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

  // Category management handlers
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
      <div className="rounded-3xl border border-zinc-800 bg-zinc-900 p-6 shadow-2xl">
        <p className="text-sm uppercase tracking-[0.24em] text-teal-400">Plans</p>
        <h2 className="mt-2 text-3xl font-semibold text-zinc-50">
          {isEditing ? "Edit plan" : "Create a plan"}
        </h2>
        <p className="mt-3 max-w-2xl text-sm text-zinc-400">
          Plans you create here appear to members on the membership page.{" "}
          {checkoutConfigured
            ? "Revolut checkout is configured — members are sent to Revolut to pay when they select a plan."
            : "Revolut isn't configured yet, so members selecting a plan only records intent — no charge occurs. See docs/billing-revolut.md for setup."}
        </p>
      </div>

      {isHalfConfigured ? (
        <div className="rounded-3xl border border-amber-500/40 bg-amber-500/10 p-5">
          <p className="text-sm font-semibold text-amber-300">Billing is half-configured</p>
          <p className="mt-2 text-sm text-amber-200/80">
            Checkout is set up, but the webhook signing secret isn&apos;t — payments
            won&apos;t be confirmed automatically, so members will get stuck on
            &quot;Awaiting payment&quot; after paying. Set{" "}
            <code>REVOLUT_WEBHOOK_SIGNING_SECRET</code> (see{" "}
            <code>docs/billing-revolut.md</code>) to fix this.
          </p>
        </div>
      ) : null}

      <form
        onSubmit={handleSubmit}
        className="rounded-3xl border border-zinc-800 bg-zinc-900 p-6 shadow-2xl"
      >
        {formError ? (
          <p className="mb-4 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            {formError}
          </p>
        ) : null}

        {successMessage ? (
          <p className="mb-4 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
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
                <label className="flex items-center gap-2 text-sm text-zinc-300">
                  <input
                    type="checkbox"
                    checked={values.isUnlimited}
                    onChange={(e) =>
                      setValues((prev) => ({ ...prev, isUnlimited: e.target.checked }))
                    }
                    className="h-4 w-4 accent-teal-500"
                  />
                  Unlimited sessions
                </label>
              </div>
            </FormField>
          </div>

          <div className="md:col-span-2">
            <FormField label="Class categories this plan can book" error={errors.allowedCategories}>
              {categories.length === 0 ? (
                <p className="text-sm text-zinc-400">
                  No categories yet — add some in the{" "}
                  <span className="text-teal-400">Manage categories</span> section below.
                </p>
              ) : (
                <div className="flex flex-wrap gap-3">
                  {categories.map((cat) => (
                    <label
                      key={cat.slug}
                      className="flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-300"
                    >
                      <input
                        type="checkbox"
                        checked={values.allowedCategories.includes(cat.slug)}
                        onChange={() => toggleCategory(cat.slug)}
                        className="h-4 w-4 accent-teal-500"
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
                  <span className="text-xs font-normal text-zinc-500">optional</span>
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

          <label className="flex items-center gap-2 text-sm text-zinc-300 md:col-span-2">
            <input
              type="checkbox"
              checked={values.isActive}
              onChange={(e) =>
                setValues((prev) => ({ ...prev, isActive: e.target.checked }))
              }
              className="h-4 w-4 accent-teal-500"
            />
            Visible to members
          </label>
        </div>

        <div className="mt-6 flex flex-col-reverse gap-3 border-t border-zinc-800 pt-4 sm:flex-row sm:items-center sm:justify-end">
          {isEditing ? (
            <button
              type="button"
              onClick={cancelEdit}
              className="rounded-xl border border-zinc-700 px-5 py-2 text-sm font-medium text-zinc-200 transition hover:border-zinc-500"
            >
              Cancel
            </button>
          ) : null}

          <button
            type="submit"
            disabled={isSubmitting}
            className="rounded-xl bg-teal-500 px-5 py-2 text-sm font-semibold text-black transition hover:bg-teal-400 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? "Saving…" : isEditing ? "Update plan" : "Create plan"}
          </button>
        </div>
      </form>

      <div className="rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
        <h3 className="text-lg font-semibold text-zinc-50">All plans</h3>

        {plans.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-400">
            No plans yet. Create the first one above.
          </p>
        ) : (
          <div className="mt-5 space-y-3">
            {plans.map((plan) => (
              <div
                key={plan.id}
                className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h4 className="text-base font-semibold text-zinc-100">
                      {plan.name}
                    </h4>
                    {plan.description ? (
                      <p className="mt-2 text-sm text-zinc-400">{plan.description}</p>
                    ) : null}
                    <div className="mt-3 flex flex-wrap gap-2">
                      {plan.allowedCategories.length === 0 ? (
                        <span className="rounded-full bg-zinc-950 px-3 py-1 text-xs font-medium text-zinc-400">
                          All categories
                        </span>
                      ) : (
                        plan.allowedCategories.map((category) => (
                          <span
                            key={category}
                            className="rounded-full bg-zinc-950 px-3 py-1 text-xs font-medium text-zinc-400"
                          >
                            {classCategoryLabel(categories, category, deletedLabels)}
                          </span>
                        ))
                      )}
                    </div>
                  </div>

                  <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
                    <span className="rounded-full bg-zinc-950 px-3 py-1 text-xs font-medium text-zinc-300">
                      {formatPriceCents(plan.priceCents)} / {plan.billingInterval}
                    </span>
                    <span className="rounded-full bg-zinc-950 px-3 py-1 text-xs font-medium text-zinc-300">
                      {formatSessionAllowance(plan.monthlySessionAllowance)}
                    </span>
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-semibold ${
                        plan.isActive
                          ? "bg-emerald-500/15 text-emerald-300"
                          : "bg-zinc-800 text-zinc-400"
                      }`}
                    >
                      {plan.isActive ? "Visible" : "Hidden"}
                    </span>
                    <button
                      type="button"
                      onClick={() => startEdit(plan)}
                      className="rounded-xl border border-zinc-700 px-3 py-1 text-xs font-medium text-zinc-200 transition hover:border-zinc-500"
                    >
                      Edit
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Category management */}
      <div className="rounded-3xl border border-zinc-800 bg-zinc-900 p-6 shadow-2xl">
        <h3 className="text-lg font-semibold text-zinc-50">Manage categories</h3>
        <p className="mt-1 text-sm text-zinc-400">
          Categories appear on the class and plan forms. Deleting a category removes it from future
          selections — existing classes and plans are not affected and will continue to display their
          category label.
        </p>

        <form onSubmit={handleSaveCat} className="mt-5 rounded-2xl border border-zinc-800 bg-zinc-950 p-4">
          {catFormError ? (
            <p className="mb-3 rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-400">
              {catFormError}
            </p>
          ) : null}
          {catFormSuccess ? (
            <p className="mb-3 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
              {catFormSuccess}
            </p>
          ) : null}

          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <label className="mb-2 block text-sm font-medium text-zinc-200">
                {catEditingId ? "Category name" : "New category"}
              </label>
              <input
                type="text"
                value={catName}
                onChange={(e) => { setCatName(e.target.value); setCatFormError(null); setCatFormSuccess(null); }}
                className={inputClass(catFormError && !catName.trim() ? "error" : undefined)}
                placeholder="e.g. Yoga"
              />
            </div>
            <div className="flex gap-2">
              {catEditingId ? (
                <button
                  type="button"
                  onClick={cancelEditCat}
                  className="rounded-xl border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-200 transition hover:border-zinc-500"
                >
                  Cancel
                </button>
              ) : null}
              <button
                type="submit"
                disabled={isSavingCat}
                className="rounded-xl bg-teal-500 px-4 py-2 text-sm font-semibold text-black transition hover:bg-teal-400 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSavingCat ? "Saving…" : catEditingId ? "Update" : "Add category"}
              </button>
            </div>
          </div>
        </form>

        {catDeleteError ? (
          <p className="mt-3 rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-400">
            {catDeleteError}
          </p>
        ) : null}

        <div className="mt-4 space-y-2">
          {categories.length === 0 ? (
            <p className="text-sm text-zinc-400">No categories yet. Add one above.</p>
          ) : (
            categories.map((cat) => (
              <div
                key={cat.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-zinc-800 bg-zinc-950 p-3"
              >
                <div>
                  <p className="text-sm font-medium text-zinc-200">{cat.name}</p>
                  <p className="text-xs text-zinc-500">{cat.slug}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => startEditCat(cat)}
                    className="rounded-xl border border-zinc-700 px-3 py-1 text-xs font-medium text-zinc-200 transition hover:border-zinc-500"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteCat(cat.id)}
                    disabled={deletingCatId === cat.id}
                    className="rounded-xl border border-red-500/30 px-3 py-1 text-xs font-medium text-red-400 transition hover:border-red-500/60 disabled:cursor-not-allowed disabled:opacity-60"
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
      <span className="mb-2 block text-sm font-medium text-zinc-200">{label}</span>
      {children}
      {error ? <p className="mt-1 text-xs text-red-400">{error}</p> : null}
    </label>
  );
}

function inputClass(hasError?: string) {
  return `w-full rounded-xl border bg-zinc-950 px-4 py-3 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-500 ${
    hasError
      ? "border-red-500 focus:border-red-400"
      : "border-zinc-800 focus:border-teal-500"
  }`;
}
