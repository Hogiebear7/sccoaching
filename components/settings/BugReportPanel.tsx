"use client";

// TRIAL-ONLY — see docs/bug-reports.md for the full removal checklist.

import { useRef, useState } from "react";
import type { FormEvent } from "react";

const MAX_SCREENSHOTS = 3;
// Matches lib/image-upload.ts's MAX_COVER_DATA_URL_LENGTH — the server
// validates with the same limit, so a client-side check just avoids a
// round trip for an image that would be rejected anyway.
const MAX_DATA_URL_LENGTH = 500_000;

export function BugReportPanel() {
  const [description, setDescription] = useState("");
  const [screenshots, setScreenshots] = useState<string[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    setFileError(null);
    setSuccess(null);

    const files = Array.from(fileList);
    if (screenshots.length + files.length > MAX_SCREENSHOTS) {
      setFileError(`Up to ${MAX_SCREENSHOTS} screenshots.`);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    for (const file of files) {
      if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
        setFileError("Only JPEG, PNG, or WebP images.");
        continue;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        if (dataUrl.length > MAX_DATA_URL_LENGTH) {
          setFileError("That image is too large — try a smaller screenshot.");
          return;
        }
        setScreenshots((prev) => (prev.length < MAX_SCREENSHOTS ? [...prev, dataUrl] : prev));
      };
      reader.readAsDataURL(file);
    }

    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function removeScreenshot(index: number) {
    setScreenshots((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!description.trim()) {
      setError("Describe the bug before submitting.");
      return;
    }
    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch("/api/bug-reports/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description, screenshots }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.message ?? "Could not submit your report.");
        return;
      }
      setSuccess(data?.message ?? "Thanks — your report's been logged.");
      setDescription("");
      setScreenshots([]);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="surface-card p-5">
      <p className="mb-1 text-sm font-medium text-zinc-100">Report a bug</p>
      <p className="mb-4 text-xs text-zinc-500">
        Trial period only — tell us what went wrong and attach a screenshot if you can. This goes
        straight to the team.
      </p>

      {error ? (
        <p className="mb-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      ) : null}
      {success ? (
        <p className="mb-3 rounded-lg border border-[var(--success)]/30 bg-[var(--success-weak)] px-3 py-2 text-xs text-[var(--success)]">
          {success}
        </p>
      ) : null}

      <form onSubmit={handleSubmit} className="space-y-3">
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What happened? What did you expect instead?"
          rows={4}
          maxLength={2000}
          className="input-field w-full resize-none"
        />

        {fileError ? <p className="text-xs text-destructive">{fileError}</p> : null}

        {screenshots.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {screenshots.map((src, i) => (
              <div key={i} className="relative h-16 w-16 overflow-hidden rounded-lg border border-white/[0.09]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt={`Screenshot ${i + 1}`} className="h-full w-full object-cover" />
                <button
                  type="button"
                  onClick={() => removeScreenshot(i)}
                  aria-label={`Remove screenshot ${i + 1}`}
                  className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-black/70 text-white"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} className="h-2.5 w-2.5">
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        ) : null}

        <div className="flex items-center justify-between gap-3">
          <label className="cursor-pointer rounded-lg border border-white/[0.09] bg-white/[0.03] px-3.5 py-2 text-[13px] font-medium text-zinc-300 transition hover:bg-white/[0.06]">
            {screenshots.length > 0 ? "Add another screenshot" : "Attach screenshot"}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              onChange={(e) => handleFiles(e.target.files)}
              disabled={screenshots.length >= MAX_SCREENSHOTS}
              className="hidden"
            />
          </label>
          <button
            type="submit"
            disabled={submitting}
            className="btn-primary px-5 py-2 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "Sending…" : "Submit report"}
          </button>
        </div>
      </form>
    </div>
  );
}
