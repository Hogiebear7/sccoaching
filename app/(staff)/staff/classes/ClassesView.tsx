"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ChangeEvent, FormEvent, ReactNode } from "react";

import type { ClassCategory, ClassCategoryRecord, ClassRecord } from "@/lib/db";
import { classCategoryLabel, isFutureDateTime } from "@/lib/scheduling-status";

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
};

type FormErrors = Partial<Record<keyof ClassFormValues, string>>;

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
  };
}

export function ClassesView({ classes, categories, deletedLabels }: { classes: ClassWithRoster[]; categories: ClassCategoryRecord[]; deletedLabels: Record<string, string> }) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [values, setValues] = useState<ClassFormValues>(() => emptyFormValues(categories[0]?.slug ?? ""));
  const [errors, setErrors] = useState<FormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [attendanceUpdatingId, setAttendanceUpdatingId] = useState<string | null>(null);

  const isEditing = editingId !== null;

  async function handleToggleAttendance(bookingId: string, nextAttended: boolean) {
    setAttendanceUpdatingId(bookingId);

    try {
      const res = await fetch("/api/staff/bookings/attendance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookingId, attended: nextAttended }),
      });

      if (res.ok) {
        router.refresh();
      }
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

  function startEdit(classRecord: ClassRecord) {
    setEditingId(classRecord.id);
    setValues(toFormValues(classRecord));
    setErrors({});
    setFormError(null);
    setSuccessMessage(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setValues(emptyFormValues(categories[0]?.slug ?? ""));
    setErrors({});
    setFormError(null);
    setSuccessMessage(null);
  }

  function validate(): boolean {
    const nextErrors: FormErrors = {};

    if (!values.title.trim()) nextErrors.title = "Class name is required.";
    if (!values.date.trim()) nextErrors.date = "Date is required.";
    if (!values.startTime.trim()) nextErrors.startTime = "Start time is required.";

    if (values.date.trim() && values.startTime.trim() && !isFutureDateTime(values.date, values.startTime)) {
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
      router.refresh();
    } catch {
      setFormError("Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-zinc-800 bg-zinc-900 p-6 shadow-2xl">
        <p className="text-sm uppercase tracking-[0.24em] text-teal-400">Classes</p>
        <h2 className="mt-2 text-3xl font-semibold text-zinc-50">
          {isEditing ? "Edit class" : "Create a class"}
        </h2>
        <p className="mt-3 max-w-2xl text-sm text-zinc-400">
          Classes you create here will appear on the customer schedule.
        </p>
      </div>

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

          <FormField label="Category" error={errors.category}>
            <select
              value={values.category}
              onChange={(e) => handleTextChange("category", e)}
              className={inputClass(errors.category)}
            >
              {categories.length === 0 ? (
                <option value="">No categories — manage in Plans</option>
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
            {isSubmitting ? "Saving…" : isEditing ? "Update class" : "Create class"}
          </button>
        </div>
      </form>

      <div className="rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
        <h3 className="text-lg font-semibold text-zinc-50">All classes</h3>

        {classes.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-400">
            No classes yet. Create the first one above.
          </p>
        ) : (
          <div className="mt-5 space-y-3">
            {classes.map((classRecord) => (
              <div
                key={classRecord.id}
                className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-sm text-zinc-500">
                      {classRecord.date} · {classRecord.startTime}
                    </p>
                    <h4 className="mt-1 text-base font-semibold text-zinc-100">
                      {classRecord.title}
                    </h4>
                    <p className="mt-2 text-sm text-zinc-400">
                      Coach: {classRecord.coachEmail}
                    </p>
                  </div>

                  <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
                    <span className="rounded-full bg-zinc-950 px-3 py-1 text-xs font-medium text-zinc-400">
                      {classCategoryLabel(categories, classRecord.category, deletedLabels)}
                    </span>
                    <span className="rounded-full bg-zinc-950 px-3 py-1 text-xs font-medium text-zinc-300">
                      {classRecord.durationMins} min · {classRecord.bookedCount} of{" "}
                      {classRecord.capacity} booked
                      {classRecord.waitlist.length > 0
                        ? ` · ${classRecord.waitlist.length} waitlisted`
                        : ""}
                    </span>
                    <button
                      type="button"
                      onClick={() => startEdit(classRecord)}
                      className="rounded-xl border border-zinc-700 px-3 py-1 text-xs font-medium text-zinc-200 transition hover:border-zinc-500"
                    >
                      Edit
                    </button>
                  </div>
                </div>

                <div className="mt-4 border-t border-zinc-800 pt-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                    Booked members
                  </p>
                  {classRecord.roster.length === 0 ? (
                    <p className="mt-2 text-sm text-zinc-400">No members booked yet.</p>
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
                                className="text-teal-400 transition hover:text-teal-300"
                              >
                                {member.fullName ?? member.email}
                              </Link>
                              <span className="text-zinc-500"> · {member.email}</span>
                            </div>

                            <button
                              type="button"
                              onClick={() => handleToggleAttendance(member.bookingId, !attended)}
                              disabled={isUpdating}
                              className={`rounded-full px-3 py-1 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${
                                attended
                                  ? "bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25"
                                  : "border border-zinc-700 text-zinc-300 hover:border-zinc-500"
                              }`}
                            >
                              {isUpdating ? "Updating…" : attended ? "Attended" : "Mark attended"}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>

                {classRecord.waitlist.length > 0 ? (
                  <div className="mt-4 border-t border-zinc-800 pt-4">
                    <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                      Waitlist
                    </p>
                    <ul className="mt-2 space-y-1">
                      {classRecord.waitlist.map((member) => (
                        <li key={member.userId} className="text-sm text-zinc-300">
                          <span className="text-zinc-500">#{member.position}</span>{" "}
                          <Link
                            href={`/staff/members/${member.userId}`}
                            className="text-teal-400 transition hover:text-teal-300"
                          >
                            {member.fullName ?? member.email}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ))}
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
