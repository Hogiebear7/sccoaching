"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ChangeEvent, FormEvent, ReactNode } from "react";

import { formatPriceCents } from "@/lib/billing";
import type { ClassPassProductRecord } from "@/lib/db";

type PassFormValues = {
  name: string;
  description: string;
  passCount: string;
  priceEur: string;
  validityDays: string;
  isActive: boolean;
};

type FormErrors = Partial<Record<keyof PassFormValues, string>>;

function emptyFormValues(): PassFormValues {
  return {
    name: "",
    description: "",
    passCount: "",
    priceEur: "",
    validityDays: "",
    isActive: true,
  };
}

function toFormValues(product: ClassPassProductRecord): PassFormValues {
  return {
    name: product.name,
    description: product.description ?? "",
    passCount: String(product.passCount),
    priceEur: (product.priceCents / 100).toFixed(2),
    validityDays: product.validityDays == null ? "" : String(product.validityDays),
    isActive: product.isActive,
  };
}

function formatValidity(validityDays: number | null | undefined): string {
  if (validityDays == null) return "Never expires";
  if (validityDays % 30 === 0) {
    const months = validityDays / 30;
    return `Use within ${months} month${months === 1 ? "" : "s"}`;
  }
  return `Use within ${validityDays} days`;
}

export function PassesView({
  products,
  purchaseCounts,
}: {
  products: ClassPassProductRecord[];
  /** Purchases (any status) referencing each product — nonzero blocks delete. */
  purchaseCounts: Record<string, number>;
}) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [values, setValues] = useState<PassFormValues>(() => emptyFormValues());
  const [errors, setErrors] = useState<FormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [actionId, setActionId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const isEditing = editingId !== null;

  function handleTextChange(
    key: keyof PassFormValues,
    e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) {
    setValues((prev) => ({ ...prev, [key]: e.target.value }));
    setErrors((prev) => ({ ...prev, [key]: undefined }));
    setSuccessMessage(null);
  }

  function startEdit(product: ClassPassProductRecord) {
    setEditingId(product.id);
    setValues(toFormValues(product));
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

    if (!values.name.trim()) nextErrors.name = "Pack name is required.";

    const count = Number(values.passCount);
    if (!values.passCount.trim() || !Number.isInteger(count) || count <= 0 || count > 100) {
      nextErrors.passCount = "Enter a whole number of passes between 1 and 100.";
    }

    if (!values.priceEur.trim() || Number.isNaN(Number(values.priceEur)) || Number(values.priceEur) <= 0) {
      nextErrors.priceEur = "Price must be a number greater than zero.";
    }

    if (values.validityDays.trim()) {
      const days = Number(values.validityDays);
      if (!Number.isInteger(days) || days <= 0 || days > 1825) {
        nextErrors.validityDays = "Use-by must be 1–1825 days, or blank for no expiry.";
      }
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
        passCount: values.passCount,
        priceEur: values.priceEur,
        validityDays: values.validityDays.trim() ? values.validityDays.trim() : null,
        isActive: values.isActive,
      };
      const res = await fetch("/api/staff/passes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editingId ? { id: editingId, ...payload } : payload),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setFormError(data?.message ?? "Could not save pass pack. Please try again.");
        return;
      }
      setSuccessMessage(data?.message ?? "Pass pack saved.");
      setEditingId(null);
      setValues(emptyFormValues());
      router.refresh();
    } catch {
      setFormError("Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleToggleArchive(product: ClassPassProductRecord) {
    setActionId(product.id);
    setActionError(null);
    setActionMessage(null);
    try {
      const res = await fetch("/api/staff/passes/archive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: product.id, isActive: !product.isActive }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setActionError(data?.message ?? "Could not update pass pack. Please try again.");
        return;
      }
      setActionMessage(data?.message ?? "Pass pack updated.");
      router.refresh();
    } catch {
      setActionError("Something went wrong. Please try again.");
    } finally {
      setActionId(null);
    }
  }

  async function handleDelete(productId: string) {
    setActionId(productId);
    setActionError(null);
    setActionMessage(null);
    try {
      const res = await fetch("/api/staff/passes/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: productId }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setActionError(data?.message ?? "Could not delete pass pack. Please try again.");
        return;
      }
      setActionMessage(data?.message ?? "Pass pack deleted.");
      setConfirmDeleteId(null);
      router.refresh();
    } catch {
      setActionError("Something went wrong. Please try again.");
    } finally {
      setActionId(null);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <p className="label-caps">Staff</p>
        <h2 className="text-display mt-1 text-[28px] leading-tight">
          {isEditing ? "Edit pass pack" : "Create a pass pack"}
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Pass packs are one-off purchases that top up a member&apos;s class passes beyond
          their plan allowance. Changes here affect future purchases only — passes already
          bought keep the count and use-by date they were sold with.
        </p>
      </div>

      {/* Create / edit form */}
      <form onSubmit={handleSubmit} className="panel rounded-3xl p-6">
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
            <FormField label="Pack name" error={errors.name}>
              <input
                type="text"
                value={values.name}
                onChange={(e) => handleTextChange("name", e)}
                className={inputClass(errors.name)}
                placeholder="e.g. 10 Pass Pack"
              />
            </FormField>
          </div>

          <FormField label="Passes per pack" error={errors.passCount}>
            <input
              type="number"
              min={1}
              max={100}
              value={values.passCount}
              onChange={(e) => handleTextChange("passCount", e)}
              className={inputClass(errors.passCount)}
              placeholder="e.g. 10"
            />
          </FormField>

          <FormField label="Price (EUR)" error={errors.priceEur}>
            <input
              type="number"
              min={0}
              step="0.01"
              value={values.priceEur}
              onChange={(e) => handleTextChange("priceEur", e)}
              className={inputClass(errors.priceEur)}
              placeholder="e.g. 120.00"
            />
          </FormField>

          <div className="md:col-span-2">
            <FormField
              label={
                <>
                  Use within (days){" "}
                  <span className="text-xs font-normal text-muted-foreground">
                    optional — blank means passes never expire
                  </span>
                </>
              }
              error={errors.validityDays}
            >
              <input
                type="number"
                min={1}
                max={1825}
                value={values.validityDays}
                onChange={(e) => handleTextChange("validityDays", e)}
                className={`${inputClass(errors.validityDays)} sm:max-w-[200px]`}
                placeholder="e.g. 90"
              />
            </FormField>
            <p className="mt-1.5 text-xs text-muted-foreground">
              The rule is simple: passes must be used within this many days of purchase.
              It is stamped at purchase time, so editing it later never changes passes a
              member already owns.
            </p>
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
                className={`${inputClass(errors.description)} min-h-[70px] resize-y`}
                placeholder="What members see under the pack name"
              />
            </FormField>
          </div>

          <label className="flex items-center gap-2 text-sm text-foreground md:col-span-2">
            <input
              type="checkbox"
              checked={values.isActive}
              onChange={(e) => setValues((prev) => ({ ...prev, isActive: e.target.checked }))}
              className="h-4 w-4 accent-primary"
            />
            Available to members
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
            {isSubmitting ? "Saving…" : isEditing ? "Update pass pack" : "Create pass pack"}
          </button>
        </div>
      </form>

      {/* Product list */}
      <div className="panel p-6">
        <h3 className="text-lg font-semibold">All pass packs</h3>

        {actionError ? (
          <p className="mt-3 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {actionError}
          </p>
        ) : null}
        {actionMessage ? (
          <p className="mt-3 rounded-xl border border-primary/30 bg-primary/10 px-3 py-2 text-sm text-primary">
            {actionMessage}
          </p>
        ) : null}

        {products.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            No pass packs yet. Create the first one above.
          </p>
        ) : (
          <div className="mt-5 space-y-3">
            {products.map((product) => {
              const purchases = purchaseCounts[product.id] ?? 0;
              const canDelete = purchases === 0;
              const isConfirmingDelete = confirmDeleteId === product.id;
              const isBusy = actionId === product.id;

              return (
                <div key={product.id} className="well p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <h4 className="text-base font-semibold">{product.name}</h4>
                      {product.description ? (
                        <p className="mt-1 text-sm text-muted-foreground">{product.description}</p>
                      ) : null}
                      <div className="mt-3 flex flex-wrap gap-2">
                        <span className="rounded-full bg-secondary px-3 py-1 text-xs font-medium text-secondary-foreground">
                          {product.passCount} passes
                        </span>
                        <span className="rounded-full bg-secondary px-3 py-1 text-xs font-medium text-secondary-foreground">
                          {formatValidity(product.validityDays)}
                        </span>
                      </div>
                    </div>

                    <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
                      <span className="rounded-full bg-secondary px-3 py-1 text-xs font-medium text-secondary-foreground">
                        {formatPriceCents(product.priceCents)}
                      </span>
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-semibold ${
                          product.isActive
                            ? "bg-primary/15 text-primary"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {product.isActive ? "Visible" : "Archived"}
                      </span>
                      {purchases > 0 ? (
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {purchases} purchase{purchases === 1 ? "" : "s"}
                        </span>
                      ) : null}
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => startEdit(product)}
                          className="rounded-xl border border-border px-3 py-1 text-xs font-medium text-foreground transition hover:bg-accent"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => handleToggleArchive(product)}
                          disabled={isBusy}
                          className="rounded-xl border border-border px-3 py-1 text-xs font-medium text-foreground transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {isBusy ? "Saving…" : product.isActive ? "Archive" : "Unarchive"}
                        </button>
                        {canDelete && !isConfirmingDelete ? (
                          <button
                            type="button"
                            onClick={() => {
                              setConfirmDeleteId(product.id);
                              setActionError(null);
                              setActionMessage(null);
                            }}
                            className="rounded-xl border border-destructive/30 px-3 py-1 text-xs font-medium text-destructive transition hover:border-destructive/60"
                          >
                            Delete
                          </button>
                        ) : null}
                      </div>
                      {!canDelete ? (
                        <p className="max-w-[230px] text-[11px] text-muted-foreground sm:text-right">
                          Has purchase history — can&apos;t be deleted. Archive it to stop
                          new sales; passes already bought keep working.
                        </p>
                      ) : null}
                      {canDelete && isConfirmingDelete ? (
                        <div className="flex flex-col items-start gap-1.5 sm:items-end">
                          <p className="text-[11px] text-muted-foreground sm:text-right">
                            Never purchased. This can&apos;t be undone.
                          </p>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => handleDelete(product.id)}
                              disabled={isBusy}
                              className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-1 text-xs font-semibold text-destructive transition hover:bg-destructive/20 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {isBusy ? "Deleting…" : "Confirm delete"}
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(null)}
                              disabled={isBusy}
                              className="rounded-xl border border-border px-3 py-1 text-xs font-medium text-foreground transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              Keep pack
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
