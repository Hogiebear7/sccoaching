"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ChangeEvent, FormEvent, ReactNode } from "react";

import type { ClassCategory, ClassCategoryRecord, ClassRecord, ClassSeriesRecord } from "@/lib/db";
import { WEEKDAY_LABELS, describeSeriesDays } from "@/lib/class-series-shared";
import { classCategoryLabel, isFutureDateTime } from "@/lib/scheduling-status";
import { CoverImageField } from "@/components/ui/CoverImageField";
import { ClassImageSlot } from "@/components/ui/ClassImageSlot";
import { suggestAltForCover, suggestCoverForCategory } from "@/lib/class-covers";
import { ClassesCalendar } from "./ClassesCalendar";

type RosterMember = {
  bookingId: string;
  userId: string;
  email: string;
  fullName: string | null;
  attendedAt: string | null;
};

type WaitlistMember = {
  userId: string;
  email: string;
  fullName: string | null;
  position: number;
};

type ClassWithRoster = ClassRecord & {
  coachEmail: string;
  bookedCount: number;
  roster: RosterMember[];
  waitlist: WaitlistMember[];
};

type ClassFormValues = {
  title: string;
  category: ClassCategory;
  date: string;
  startTime: string;
  durationMins: string;
  capacity: string;
  repeat: "none" | "weekly";
  weekdays: number[];
  repeatEndDate: string;
  imageUrl: string | null;
  imageAlt: string;
};

type FormErrors = Partial<Record<keyof ClassFormValues, string>>;

function weekdayOfIso(isoDate: string): number {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(y, m - 1, d).getDay();
}

function todayDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

function emptyFormValues(defaultCategory = "general"): ClassFormValues {
  return {
    title: "",
    category: defaultCategory,
    date: "",
    startTime: "",
    durationMins: "",
    capacity: "",
    repeat: "none",
    weekdays: [],
    repeatEndDate: "",
    imageUrl: null,
    imageAlt: "",
  };
}

function toFormValues(classRecord: ClassRecord): ClassFormValues {
  return {
    title: classRecord.title,
    category: classRecord.category,
    date: classRecord.date,
    startTime: classRecord.startTime,
    durationMins: String(classRecord.durationMins),
    capacity: String(classRecord.capacity),
    // Editing always targets this single occurrence.
    repeat: "none",
    weekdays: [],
    repeatEndDate: "",
    imageUrl: classRecord.imageUrl ?? null,
    imageAlt: classRecord.imageAlt ?? "",
  };
}

export function ClassesView({
  classes,
  categories,
  deletedLabels,
  series,
  coaches,
}: {
  classes: ClassWithRoster[];
  categories: ClassCategoryRecord[];
  deletedLabels: Record<string, string>;
  series: ClassSeriesRecord[];
  coaches: { userId: string; label: string }[];
}) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [values, setValues] = useState<ClassFormValues>(() =>
    emptyFormValues(categories[0]?.slug ?? "")
  );
  // True when the current cover was accepted from a category suggestion (so a
  // later category change's hint may offer to replace it). Any manual cover
  // action clears this.
  const [coverSuggested, setCoverSuggested] = useState(false);
  // Staff dismissed the category suggestion hint for the current category.
  const [hintDismissed, setHintDismissed] = useState(false);
  // Single polite live-region message shared by the cover picker AND the
  // "Use this" banner, so the whole cover workflow has one region (no duplicates).
  const [coverAnnouncement, setCoverAnnouncement] = useState("");
  const [errors, setErrors] = useState<FormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [attendanceUpdatingId, setAttendanceUpdatingId] = useState<string | null>(null);
  const [showUpcoming, setShowUpcoming] = useState(true);
  const [showPast, setShowPast] = useState(false);
  const [viewMode, setViewMode] = useState<"list" | "calendar">("list");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteMessage, setDeleteMessage] = useState<string | null>(null);
  const [stoppingSeriesId, setStoppingSeriesId] = useState<string | null>(null);
  const [confirmStopId, setConfirmStopId] = useState<string | null>(null);
  const [seriesMessage, setSeriesMessage] = useState<string | null>(null);
  const [seriesError, setSeriesError] = useState<string | null>(null);

  const activeSeries = series.filter((sr) => sr.isActive);

  const isEditing = editingId !== null;

  // findClasses() sorts ascending, which is right for upcoming; past reads
  // best most-recent-first.
  const upcomingClasses = classes.filter((c) => isFutureDateTime(c.date, c.startTime));
  const pastClasses = classes.filter((c) => !isFutureDateTime(c.date, c.startTime)).reverse();

  async function handleDelete(classId: string) {
    setDeletingId(classId);
    setDeleteError(null);
    setDeleteMessage(null);

    try {
      const res = await fetch("/api/staff/classes/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: classId }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        setDeleteError(data?.message ?? "Could not delete class. Please try again.");
        return;
      }

      setDeleteMessage(data?.message ?? "Class deleted.");
      setConfirmDeleteId(null);
      router.refresh();
    } catch {
      setDeleteError("Something went wrong. Please try again.");
    } finally {
      setDeletingId(null);
    }
  }

  async function handleStopSeries(seriesId: string) {
    setStoppingSeriesId(seriesId);
    setSeriesError(null);
    setSeriesMessage(null);
    try {
      const res = await fetch("/api/staff/classes/series/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: seriesId }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setSeriesError(data?.message ?? "Could not stop this repeating class.");
        return;
      }
      setSeriesMessage(data?.message ?? "Repeating class stopped.");
      setConfirmStopId(null);
      router.refresh();
    } catch {
      setSeriesError("Something went wrong. Please try again.");
    } finally {
      setStoppingSeriesId(null);
    }
  }

  function toggleWeekday(day: number) {
    setValues((prev) => ({
      ...prev,
      weekdays: prev.weekdays.includes(day)
        ? prev.weekdays.filter((d) => d !== day)
        : [...prev.weekdays, day],
    }));
    setErrors((prev) => ({ ...prev, weekdays: undefined }));
    setSuccessMessage(null);
  }
  async function handleToggleAttendance(bookingId: string, nextAttended: boolean) {
    setAttendanceUpdatingId(bookingId);
    try {
      const res = await fetch("/api/staff/bookings/attendance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookingId, attended: nextAttended }),
      });
      if (res.ok) router.refresh();
    } finally {
      setAttendanceUpdatingId(null);
    }
  }

  function handleTextChange(
    key: keyof ClassFormValues,
    e: ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) {
    setValues((prev) => ({ ...prev, [key]: e.target.value }));
    setErrors((prev) => ({ ...prev, [key]: undefined }));
    setSuccessMessage(null);
  }

  function categoryNameFor(slug: string): string {
    return categories.find((c) => c.slug === slug)?.name ?? "";
  }

  // Changing category never mutates the cover/alt on its own — it just re-arms
  // the suggestion hint so staff can explicitly accept the new best-fit cover.
  function handleCategoryChange(e: ChangeEvent<HTMLSelectElement>) {
    setValues((prev) => ({ ...prev, category: e.target.value as ClassCategory }));
    setHintDismissed(false);
    setErrors((prev) => ({ ...prev, category: undefined }));
    setSuccessMessage(null);
  }

  // Explicit accept: apply the suggested cover + its default alt (custom alt is
  // preserved by suggestAltForCover), and mark the cover as a suggestion.
  function acceptCoverSuggestion() {
    const cover = suggestCoverForCategory(values.category, categoryNameFor(values.category));
    setValues((prev) => ({
      ...prev,
      imageUrl: cover.src,
      imageAlt: suggestAltForCover(prev.imageAlt, cover),
    }));
    setCoverSuggested(true);
    setCoverAnnouncement(`${cover.label} cover applied`);
    setSuccessMessage(null);
  }

  function dismissCoverSuggestion() {
    setHintDismissed(true);
  }

  function startEdit(classRecord: ClassRecord) {
    setEditingId(classRecord.id);
    setValues(toFormValues(classRecord));
    // The loaded cover is the class's own — treat as manual, not a suggestion.
    setCoverSuggested(false);
    setHintDismissed(false);
    setErrors({});
    setFormError(null);
    setSuccessMessage(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setValues(emptyFormValues(categories[0]?.slug ?? ""));
    setCoverSuggested(false);
    setHintDismissed(false);
    setErrors({});
    setFormError(null);
    setSuccessMessage(null);
  }

  function validate(): boolean {
    const nextErrors: FormErrors = {};

    if (!values.title.trim()) nextErrors.title = "Class name is required.";
    if (!values.date.trim()) nextErrors.date = "Date is required.";
    if (!values.startTime.trim()) nextErrors.startTime = "Start time is required.";

    if (
      values.date.trim() &&
      values.startTime.trim() &&
      !isFutureDateTime(values.date, values.startTime)
    ) {
      nextErrors.startTime = "Class date and time must be in the future.";
    }

    if (!values.durationMins.trim()) {
      nextErrors.durationMins = "Duration is required.";
    } else if (
      !Number.isInteger(Number(values.durationMins)) ||
      Number(values.durationMins) <= 0
    ) {
      nextErrors.durationMins = "Duration must be a whole number greater than zero.";
    }

    if (!values.capacity.trim()) {
      nextErrors.capacity = "Capacity is required.";
    } else if (!Number.isInteger(Number(values.capacity)) || Number(values.capacity) <= 0) {
      nextErrors.capacity = "Capacity must be a whole number greater than zero.";
    }

    if (!isEditing && values.repeat === "weekly") {
      if (values.weekdays.length === 0) {
        nextErrors.weekdays = "Pick at least one weekday.";
      }
      if (values.repeatEndDate && values.date && values.repeatEndDate < values.date) {
        nextErrors.repeatEndDate = "End date can't be before the start date.";
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
      const res = await fetch("/api/staff/classes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editingId ? { id: editingId, ...values } : values),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        setFormError(data?.message ?? "Could not save class. Please try again.");
        return;
      }

      setSuccessMessage(data?.message ?? "Class saved.");
      setEditingId(null);
      setValues(emptyFormValues());
      setCoverSuggested(false);
      setHintDismissed(false);
      router.refresh();
    } catch {
      setFormError("Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  // Category-aware cover suggestion (shown as a dismissible hint, never applied
  // silently). Eligible only when the cover is empty or still an accepted
  // suggestion — a manual cover is left alone — and only when it would actually
  // change something.
  const hintCategoryName = categoryNameFor(values.category);
  const suggestedCover = suggestCoverForCategory(values.category, hintCategoryName);
  const coverEligibleForHint = values.imageUrl === null || coverSuggested;
  const showCoverHint =
    categories.length > 0 &&
    !hintDismissed &&
    coverEligibleForHint &&
    suggestedCover.src !== values.imageUrl;

  return (
    <div className="space-y-6">
      {/* Single polite live region for the whole cover workflow (picker + banner). */}
      <p aria-live="polite" role="status" className="sr-only">
        {coverAnnouncement}
      </p>

      {/* Header card */}
      <div>
        <p className="label-caps">Staff</p>
        <h2 className="text-display mt-1 text-[28px] leading-tight">
          {isEditing ? "Edit class" : "Create a class"}
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Classes you create here will appear on the member schedule.
        </p>
      </div>

      {/* Create / edit form */}
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
            <FormField label="Class name" error={errors.title}>
              <input
                type="text"
                value={values.title}
                onChange={(e) => handleTextChange("title", e)}
                className={inputClass(errors.title)}
                placeholder="e.g. Evening Strength"
              />
            </FormField>
          </div>

          <div className="md:col-span-2">
            <CoverImageField
              seed={editingId ?? values.category ?? "class"}
              label={values.title || undefined}
              value={values.imageUrl}
              onChange={(dataUrl) => {
                // Any explicit cover action (upload / built-in pick / remove) is
                // a manual choice — later category changes must not overwrite it.
                setValues((prev) => ({ ...prev, imageUrl: dataUrl }));
                setCoverSuggested(false);
              }}
              alt={values.imageAlt}
              onAltChange={(next) => setValues((prev) => ({ ...prev, imageAlt: next }))}
              recommendedSrc={suggestedCover.src}
              onAnnounce={setCoverAnnouncement}
            />

            {/* Category-aware suggestion — explicit, dismissible, one-tap accept. */}
            {showCoverHint ? (
              <div className="mt-2 flex items-center gap-3 rounded-xl border border-primary/25 bg-primary/[0.06] px-3 py-2">
                <ClassImageSlot
                  seed={suggestedCover.id}
                  imageUrl={suggestedCover.src}
                  className="h-9 w-16 shrink-0 rounded-md ring-1 ring-white/10"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-foreground">
                    Suggested for {hintCategoryName || "this category"}
                  </p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {suggestedCover.label} cover · &ldquo;{suggestedCover.defaultAlt}&rdquo;
                  </p>
                </div>
                <button
                  type="button"
                  onClick={acceptCoverSuggestion}
                  className="shrink-0 rounded-lg bg-primary/15 px-2.5 py-1 text-xs font-semibold text-primary transition hover:bg-primary/25"
                >
                  Use this
                </button>
                <button
                  type="button"
                  onClick={dismissCoverSuggestion}
                  aria-label="Dismiss suggestion"
                  className="shrink-0 rounded-lg p-1 text-muted-foreground transition hover:bg-accent hover:text-foreground"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden className="h-4 w-4">
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              </div>
            ) : null}
          </div>

          <FormField label="Category" error={errors.category}>
            <select
              value={values.category}
              onChange={handleCategoryChange}
              className={inputClass(errors.category)}
            >
              {categories.length === 0 ? (
                <option value="">No class types — add one in Operations</option>
              ) : (
                categories.map((cat) => (
                  <option key={cat.slug} value={cat.slug}>
                    {cat.name}
                  </option>
                ))
              )}
            </select>
          </FormField>

          <FormField label="Date" error={errors.date}>
            <input
              type="date"
              value={values.date}
              min={todayDateString()}
              onChange={(e) => handleTextChange("date", e)}
              className={inputClass(errors.date)}
            />
          </FormField>

          <FormField label="Start time" error={errors.startTime}>
            <input
              type="time"
              value={values.startTime}
              onChange={(e) => handleTextChange("startTime", e)}
              className={inputClass(errors.startTime)}
            />
          </FormField>

          <FormField label="Duration (minutes)" error={errors.durationMins}>
            <input
              type="number"
              min={1}
              value={values.durationMins}
              onChange={(e) => handleTextChange("durationMins", e)}
              className={inputClass(errors.durationMins)}
              placeholder="e.g. 60"
            />
          </FormField>

          <FormField label="Capacity" error={errors.capacity}>
            <input
              type="number"
              min={1}
              value={values.capacity}
              onChange={(e) => handleTextChange("capacity", e)}
              className={inputClass(errors.capacity)}
              placeholder="e.g. 12"
            />
          </FormField>

          {!isEditing ? (
            <FormField label="Repeat" error={undefined}>
              <select
                value={values.repeat}
                onChange={(e) =>
                  setValues((prev) => ({
                    ...prev,
                    repeat: e.target.value === "weekly" ? "weekly" : "none",
                    // Convenience: pre-select the start date's weekday.
                    weekdays:
                      e.target.value === "weekly" && prev.weekdays.length === 0 && prev.date
                        ? [weekdayOfIso(prev.date)]
                        : prev.weekdays,
                  }))
                }
                className={inputClass(undefined)}
              >
                <option value="none">One-off (no repeat)</option>
                <option value="weekly">Repeats weekly</option>
              </select>
            </FormField>
          ) : null}
        </div>

        {!isEditing && values.repeat === "weekly" ? (
          <div className="mt-4 space-y-4 rounded-2xl border border-border/60 bg-white/[0.02] p-4">
            <fieldset>
              <legend className="mb-2 block text-sm font-medium text-foreground">
                Repeats on
              </legend>
              <div className="flex flex-wrap gap-1.5">
                {WEEKDAY_LABELS.map((day) => {
                  const selected = values.weekdays.includes(day.value);
                  return (
                    <button
                      key={day.value}
                      type="button"
                      role="checkbox"
                      aria-checked={selected}
                      aria-label={day.long}
                      onClick={() => toggleWeekday(day.value)}
                      className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                        selected
                          ? "border-primary/50 bg-primary/15 text-primary"
                          : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
                      }`}
                    >
                      {day.short}
                    </button>
                  );
                })}
              </div>
              {errors.weekdays ? (
                <p className="mt-1.5 text-xs text-destructive">{errors.weekdays}</p>
              ) : null}
            </fieldset>

            <FormField
              label={
                <>
                  Ends on{" "}
                  <span className="text-xs font-normal text-muted-foreground">
                    optional — leave blank to repeat with no end date
                  </span>
                </>
              }
              error={errors.repeatEndDate}
            >
              <input
                type="date"
                value={values.repeatEndDate}
                min={values.date || todayDateString()}
                onChange={(e) => handleTextChange("repeatEndDate", e)}
                className={`${inputClass(errors.repeatEndDate)} sm:max-w-[220px]`}
              />
            </FormField>

            <p className="text-xs text-muted-foreground">
              Sessions are scheduled 4 weeks ahead on a rolling basis, starting from the date
              above, and new weeks are added automatically. Every session stays an ordinary
              class — edit or delete any one of them individually. Editing the whole series
              after creation isn&apos;t supported yet; stop it and create a new one instead.
            </p>
          </div>
        ) : null}

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
            {isSubmitting ? "Saving…" : isEditing ? "Update class" : "Create class"}
          </button>
        </div>
      </form>

      {/* Recurring series — the schedules that generate upcoming classes */}
      {activeSeries.length > 0 ? (
        <div className="panel p-6">
          <h3 className="text-lg font-semibold">Repeating classes</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            These schedules add sessions automatically, 4 weeks ahead. Stopping one keeps
            sessions people have booked; unbooked upcoming sessions are removed.
          </p>
          {seriesError ? (
            <p className="mt-3 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{seriesError}</p>
          ) : null}
          {seriesMessage ? (
            <p className="mt-3 rounded-xl border border-primary/30 bg-primary/10 px-3 py-2 text-sm text-primary">{seriesMessage}</p>
          ) : null}
          <div className="mt-4 space-y-2">
            {activeSeries.map((sr) => (
              <div key={sr.id} className="flex flex-wrap items-center justify-between gap-2 well p-3">
                <div>
                  <p className="text-sm font-medium">{sr.title}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {describeSeriesDays(sr.weekdays)} · {sr.startTime} ·{" "}
                    {sr.endDate ? `until ${sr.endDate}` : "no end date"}
                  </p>
                </div>
                {confirmStopId === sr.id ? (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => handleStopSeries(sr.id)}
                      disabled={stoppingSeriesId === sr.id}
                      className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-1 text-xs font-semibold text-destructive transition hover:bg-destructive/20 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {stoppingSeriesId === sr.id ? "Stopping…" : "Confirm stop"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmStopId(null)}
                      disabled={stoppingSeriesId === sr.id}
                      className="rounded-xl border border-border px-3 py-1 text-xs font-medium text-foreground transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Keep repeating
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setConfirmStopId(sr.id);
                      setSeriesError(null);
                      setSeriesMessage(null);
                    }}
                    className="rounded-xl border border-destructive/30 px-3 py-1 text-xs font-medium text-destructive transition hover:border-destructive/60"
                  >
                    Stop repeating
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {/* List / Calendar toggle */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setViewMode("list")}
          className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
            viewMode === "list"
              ? "bg-primary text-primary-foreground"
              : "border border-border text-muted-foreground hover:border-primary hover:text-foreground"
          }`}
        >
          List
        </button>
        <button
          type="button"
          onClick={() => setViewMode("calendar")}
          className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
            viewMode === "calendar"
              ? "bg-primary text-primary-foreground"
              : "border border-border text-muted-foreground hover:border-primary hover:text-foreground"
          }`}
        >
          Calendar
        </button>
      </div>

      {viewMode === "calendar" ? (
        <ClassesCalendar
          classes={classes.map((c) => ({
            id: c.id,
            title: c.title,
            category: c.category,
            date: c.date,
            startTime: c.startTime,
            coachUserId: c.coachUserId,
            coachLabel: coaches.find((coach) => coach.userId === c.coachUserId)?.label ?? c.coachEmail,
            capacity: c.capacity,
            bookedCount: c.bookedCount,
          }))}
          categories={categories}
          deletedLabels={deletedLabels}
          coaches={coaches}
        />
      ) : (
        <>
          {/* Class list — delete feedback lives above both groups so it stays
              visible whichever section the class was in. */}
          {deleteError ? (
            <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {deleteError}
            </p>
          ) : null}
          {deleteMessage ? (
            <p className="rounded-xl border border-primary/30 bg-primary/10 px-4 py-3 text-sm text-primary">
              {deleteMessage}
            </p>
          ) : null}

          {classes.length === 0 ? (
            <div className="panel p-6">
              <h3 className="text-lg font-semibold">All classes</h3>
              <p className="mt-3 text-sm text-muted-foreground">
                No classes yet. Create the first one above.
              </p>
            </div>
          ) : (
            <>
              <CollapsibleSection
                title="Upcoming classes"
                count={upcomingClasses.length}
                isOpen={showUpcoming}
                onToggle={() => setShowUpcoming((open) => !open)}
              >
                {upcomingClasses.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Nothing scheduled — create a class above.
                  </p>
                ) : (
                  upcomingClasses.map((classRecord) => renderClassCard(classRecord, true))
                )}
              </CollapsibleSection>

              <CollapsibleSection
                title="Past classes"
                count={pastClasses.length}
                isOpen={showPast}
                onToggle={() => setShowPast((open) => !open)}
              >
                {pastClasses.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No past classes yet.</p>
                ) : (
                  pastClasses.map((classRecord) => renderClassCard(classRecord, false))
                )}
              </CollapsibleSection>
            </>
          )}
        </>
      )}
    </div>
  );

  function renderClassCard(classRecord: ClassWithRoster, canDelete: boolean) {
    const isConfirmingDelete = confirmDeleteId === classRecord.id;
    const isDeleting = deletingId === classRecord.id;

    return (
      <div key={classRecord.id} className="well p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs text-muted-foreground">
              {classRecord.date} · {classRecord.startTime}
            </p>
            <h4 className="mt-1 text-base font-semibold">{classRecord.title}</h4>
            <p className="mt-1 text-sm text-muted-foreground">
              Coach: {classRecord.coachEmail}
            </p>
          </div>

          <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
            <span className="rounded-full bg-secondary px-3 py-1 text-xs font-medium text-secondary-foreground">
              {classCategoryLabel(categories, classRecord.category, deletedLabels)}
            </span>
            {classRecord.seriesId ? (
              <span className="rounded-full border border-primary/25 bg-primary/[0.08] px-3 py-1 text-xs font-medium text-primary">
                Repeats weekly
              </span>
            ) : null}
            <span className="rounded-full bg-secondary px-3 py-1 text-xs font-medium text-secondary-foreground">
              {classRecord.durationMins} min · {classRecord.bookedCount}/{classRecord.capacity} booked
              {classRecord.waitlist.length > 0
                ? ` · ${classRecord.waitlist.length} waitlisted`
                : ""}
            </span>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Link
                href={`/staff/classes/${classRecord.id}/workout`}
                className="rounded-xl border border-primary/30 px-3 py-1 text-xs font-medium text-primary transition hover:border-primary/60"
              >
                Workout
              </Link>
              <button
                type="button"
                onClick={() => startEdit(classRecord)}
                className="rounded-xl border border-border px-3 py-1 text-xs font-medium text-foreground transition hover:bg-accent"
              >
                Edit
              </button>
              {canDelete && !isConfirmingDelete ? (
                <button
                  type="button"
                  onClick={() => {
                    setConfirmDeleteId(classRecord.id);
                    setDeleteError(null);
                    setDeleteMessage(null);
                  }}
                  className="rounded-xl border border-destructive/30 px-3 py-1 text-xs font-medium text-destructive transition hover:border-destructive/60"
                >
                  Delete
                </button>
              ) : null}
            </div>
            {canDelete && isConfirmingDelete ? (
              <div className="flex flex-col items-start gap-1.5 sm:items-end">
                <p className="text-[11px] text-muted-foreground sm:text-right">
                  {classRecord.bookedCount > 0
                    ? `Cancels ${classRecord.bookedCount} booking${classRecord.bookedCount === 1 ? "" : "s"} and returns each member's class pass.`
                    : "This can't be undone."}
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => handleDelete(classRecord.id)}
                    disabled={isDeleting}
                    className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-1 text-xs font-semibold text-destructive transition hover:bg-destructive/20 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isDeleting ? "Deleting…" : "Confirm delete"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteId(null)}
                    disabled={isDeleting}
                    className="rounded-xl border border-border px-3 py-1 text-xs font-medium text-foreground transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Keep class
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>

                {/* Roster */}
                <div className="mt-4 border-t border-border pt-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                    Booked members
                  </p>
                  {classRecord.roster.length === 0 ? (
                    <p className="mt-2 text-sm text-muted-foreground">No members booked yet.</p>
                  ) : (
                    <ul className="mt-2 space-y-2">
                      {classRecord.roster.map((member) => {
                        const attended = member.attendedAt !== null;
                        const isUpdating = attendanceUpdatingId === member.bookingId;

                        return (
                          <li
                            key={member.userId}
                            className="flex flex-wrap items-center justify-between gap-2 text-sm"
                          >
                            <div>
                              <Link
                                href={`/staff/members/${member.userId}`}
                                className="text-gold transition hover:text-gold/80"
                              >
                                {member.fullName ?? member.email}
                              </Link>
                              <span className="text-muted-foreground"> · {member.email}</span>
                            </div>

                            <button
                              type="button"
                              onClick={() =>
                                handleToggleAttendance(member.bookingId, !attended)
                              }
                              disabled={isUpdating}
                              className={`rounded-full px-3 py-1 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${
                                attended
                                  ? "bg-primary/15 text-primary hover:bg-primary/25"
                                  : "border border-border text-foreground hover:bg-accent"
                              }`}
                            >
                              {isUpdating
                                ? "Updating…"
                                : attended
                                ? "Attended"
                                : "Mark attended"}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>

                {/* Waitlist */}
                {classRecord.waitlist.length > 0 ? (
                  <div className="mt-4 border-t border-border pt-4">
                    <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                      Waitlist
                    </p>
                    <ul className="mt-2 space-y-1">
                      {classRecord.waitlist.map((member) => (
                        <li key={member.userId} className="text-sm">
                          <span className="text-muted-foreground">#{member.position}</span>{" "}
                          <Link
                            href={`/staff/members/${member.userId}`}
                            className="text-gold transition hover:text-gold/80"
                          >
                            {member.fullName ?? member.email}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
      </div>
    );
  }
}

function CollapsibleSection({
  title,
  count,
  isOpen,
  onToggle,
  children,
}: {
  title: string;
  count: number;
  isOpen: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className="panel p-6">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <span className="flex items-baseline gap-2">
          <span className="text-lg font-semibold">{title}</span>
          <span className="text-xs text-muted-foreground tabular-nums">{count}</span>
        </span>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-150 ${
            isOpen ? "rotate-180" : ""
          }`}
        >
          <path d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {isOpen ? <div className="mt-5 space-y-3">{children}</div> : null}
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
