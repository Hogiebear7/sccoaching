"use client";

import Link from "next/link";
import { useState } from "react";
import type { FormEvent } from "react";

export function ContactForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");
  const [company, setCompany] = useState(""); // honeypot — real visitors never see/fill this
  const [status, setStatus] = useState<"idle" | "submitting" | "sent" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("submitting");
    setErrorMessage(null);

    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, phone: phone || null, message, company }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        setErrorMessage(data?.message ?? "Something went wrong. Please try again.");
        setStatus("error");
        return;
      }

      setStatus("sent");
    } catch {
      setErrorMessage("Something went wrong. Please try again.");
      setStatus("error");
    }
  }

  if (status === "sent") {
    return (
      <div className="border border-white/[0.08] bg-[var(--surface-1)] p-6 text-center">
        <p className="text-editorial text-[20px] italic text-zinc-50">Message sent.</p>
        <p className="text-mono mt-2 text-[13px] text-zinc-400">
          We'll get back to you shortly.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="border border-white/[0.08] bg-[var(--surface-1)] p-6">
      {/* Honeypot — hidden from sighted users, present for bots that fill every field */}
      <div className="hidden" aria-hidden="true">
        <label>
          Company
          <input
            type="text"
            tabIndex={-1}
            autoComplete="off"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
          />
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="text-mono mb-2 block text-[11px] uppercase tracking-[0.08em] text-zinc-400">Name</span>
          <input
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full border border-white/[0.12] bg-transparent px-3 py-2.5 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-primary/60"
            placeholder="Your name"
          />
        </label>

        <label className="block">
          <span className="text-mono mb-2 block text-[11px] uppercase tracking-[0.08em] text-zinc-400">Phone (optional)</span>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="w-full border border-white/[0.12] bg-transparent px-3 py-2.5 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-primary/60"
            placeholder="087 123 4567"
          />
        </label>
      </div>

      <label className="mt-4 block">
        <span className="text-mono mb-2 block text-[11px] uppercase tracking-[0.08em] text-zinc-400">Email</span>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full border border-white/[0.12] bg-transparent px-3 py-2.5 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-primary/60"
          placeholder="you@example.com"
        />
      </label>

      <label className="mt-4 block">
        <span className="text-mono mb-2 block text-[11px] uppercase tracking-[0.08em] text-zinc-400">Message</span>
        <textarea
          required
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          className="min-h-[110px] w-full resize-y border border-white/[0.12] bg-transparent px-3 py-2.5 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-primary/60"
          placeholder="Tell us what you're training for."
        />
      </label>

      {status === "error" && errorMessage ? (
        <p className="mt-4 border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {errorMessage}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={status === "submitting"}
        className="mt-5 w-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground transition-[background-color] duration-150 hover:bg-[var(--primary-hover)] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {status === "submitting" ? "Sending…" : "Send message"}
      </button>

      <p className="mt-3 text-center text-[11px] text-zinc-600">
        We only use these details to reply to you. See our{" "}
        <Link href="/privacy" className="text-zinc-400 underline hover:text-gold">Privacy Policy</Link>.
      </p>
    </form>
  );
}
