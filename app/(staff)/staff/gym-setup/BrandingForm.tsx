"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { contrastRatio, DEFAULT_ACCENT, MIN_ACCENT_CONTRAST, readableOn } from "@/lib/gym-branding";

// Logo link and accent colour, with a live preview and the same contrast check the server enforces (the server is the authority; this only saves a round trip).
export function BrandingForm({ initialAccent, initialLogo, gymName }: { initialAccent: string; initialLogo: string; gymName: string }) {
  const router = useRouter();
  const [accent, setAccent] = useState(initialAccent);
  const [logo, setLogo] = useState(initialLogo);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  const validAccent = /^#[0-9a-fA-F]{6}$/.test(accent);
  const shown = validAccent ? accent.toUpperCase() : DEFAULT_ACCENT;
  const ratio = validAccent ? contrastRatio(shown, "#0A1526") : null;
  const tooDark = ratio !== null && ratio < MIN_ACCENT_CONTRAST;

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/staff/gym/branding", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accentColor: accent.trim() === "" ? null : accent.trim(), logoUrl: logo.trim() === "" ? null : logo.trim() }),
      });
      const json = (await res.json()) as { message?: string };
      setMessage(res.ok ? "Saved. Members see the change the next time they open the app or website." : json.message ?? "Could not save.");
      if (res.ok) router.refresh();
    } catch {
      setMessage("Could not reach the server.");
    } finally {
      setSaving(false);
    }
  }

  async function upload(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    setMessage(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/staff/gym/branding", { method: "POST", body });
      const json = (await res.json()) as { message?: string; data?: { branding?: { logoUrl?: string | null } } };
      if (res.ok) setLogo(json.data?.branding?.logoUrl ?? "");
      setMessage(res.ok ? "Logo uploaded. Members see it the next time they open the app or website." : json.message ?? "Could not upload.");
      if (res.ok) router.refresh();
    } catch {
      setMessage("Could not reach the server.");
    } finally {
      setUploading(false);
    }
  }

  async function removeLogo() {
    setUploading(true);
    setMessage(null);
    try {
      const res = await fetch("/api/staff/gym/branding", { method: "DELETE" });
      if (res.ok) setLogo("");
      setMessage(res.ok ? "Logo removed." : "Could not remove the logo.");
      if (res.ok) router.refresh();
    } catch {
      setMessage("Could not reach the server.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-4 rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <label className="block text-xs text-zinc-400">
        Accent colour (leave empty for the S&C gold)
        <span className="mt-1 flex items-center gap-2">
          <input
            type="color"
            aria-label="Pick accent colour"
            value={validAccent ? accent : DEFAULT_ACCENT}
            onChange={(e) => setAccent(e.target.value)}
            className="h-9 w-12 cursor-pointer rounded border border-white/10 bg-transparent"
          />
          <input
            type="text"
            value={accent}
            placeholder="#C9A24B"
            onChange={(e) => setAccent(e.target.value)}
            className="block w-40 rounded-md border border-white/10 bg-transparent px-2 py-1.5 text-sm text-zinc-100"
          />
        </span>
      </label>
      {tooDark ? <p role="alert" className="text-xs text-amber-300">Too dark to read on the app&apos;s dark background (contrast {ratio?.toFixed(1)}:1, needs {MIN_ACCENT_CONTRAST}:1). Pick a lighter shade.</p> : null}

      <div className="block text-xs text-zinc-400">
        Logo
        <span className="mt-1 flex flex-wrap items-center gap-3">
          <label className="inline-flex min-h-10 cursor-pointer items-center rounded-md border border-white/15 px-3 text-sm font-medium text-zinc-100 hover:bg-white/5">
            {uploading ? "Working…" : logo ? "Replace logo" : "Upload logo"}
            <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" disabled={uploading} onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ""; }} />
          </label>
          {logo ? (
            <button type="button" disabled={uploading} onClick={() => void removeLogo()} className="min-h-10 rounded-md px-3 text-sm text-zinc-300 underline underline-offset-4 disabled:opacity-50">
              Remove logo
            </button>
          ) : null}
          <span>PNG, JPG or WebP, under 1 MB. A square or wide logo on a transparent background works best.</span>
        </span>
      </div>

      <label className="block text-xs text-zinc-400">
        Or use a link to a logo already online (https, .png .jpg .webp or .svg)
        <input
          type="url"
          value={logo}
          placeholder="https://example.com/logo.png"
          onChange={(e) => setLogo(e.target.value)}
          className="mt-1 block w-full rounded-md border border-white/10 bg-transparent px-2 py-1.5 text-sm text-zinc-100"
        />
      </label>

      <div aria-label="Preview" className="rounded-lg border border-white/10 bg-[#0A1526] p-4">
        <p className="text-[11px] uppercase tracking-wider text-zinc-500">Preview</p>
        <div className="mt-2 flex items-center gap-3">
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logo} alt="" className="h-9 w-auto max-w-[140px] object-contain" />
          ) : (
            <span className="text-base font-semibold text-zinc-100">{gymName}</span>
          )}
          <span className="rounded-full px-4 py-1.5 text-sm font-semibold" style={{ backgroundColor: shown, color: readableOn(shown) }}>Book a class</span>
          <span className="text-sm font-medium" style={{ color: shown }}>Your plan</span>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button type="button" disabled={saving || tooDark} onClick={() => void save()} className="min-h-10 rounded-md bg-white px-4 text-sm font-semibold text-black disabled:opacity-50">
          {saving ? "Saving…" : "Save branding"}
        </button>
        {message ? <p role="status" className="text-xs text-zinc-300">{message}</p> : null}
      </div>
    </div>
  );
}
