"use client";

import Link from "next/link";
import { useState } from "react";
import type { FormEvent } from "react";

import { trackEvent } from "@/components/analytics/SiteAnalytics";
import { AuthField, fieldA11y, FormMessage, inputClass, SubmitButton } from "@/components/auth/fields";
import { MARKETING_CLASSES } from "@/lib/marketing-classes";
import { ENQUIRY_SENT, RESPONSE_TIME } from "@/lib/site-content";

const NOT_SURE = "Not sure yet";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Errors = { name?: string; email?: string; message?: string };

// Enquiry form used on the homepage and /contact, built from the same field
// pieces as the member sign-in screens. "Interested in" is optional and can be
// preselected (/contact?class=<slug> from the class pages); the API takes no
// extra field, so the choice is prefixed to the message.
export function ContactForm({ initialInterest = "" }: { initialInterest?: string }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");
  const [interest, setInterest] = useState(initialInterest);
  const [company, setCompany] = useState(""); // honeypot — real visitors never see/fill this
  const [errors, setErrors] = useState<Errors>({});
  const [status, setStatus] = useState<"idle" | "submitting" | "sent" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  function validate() {
    const next: Errors = {};
    if (!name.trim()) next.name = "Enter your name.";
    if (!email.trim()) next.email = "Enter your email address.";
    else if (!EMAIL_RE.test(email.trim())) next.email = "Enter a valid email address.";
    if (!message.trim()) next.message = "Tell us a little about what you're training for.";
    setErrors(next);
    if (Object.keys(next).length > 0) {
      requestAnimationFrame(() => document.querySelector<HTMLElement>('form[data-contact] [aria-invalid="true"]')?.focus());
      return false;
    }
    return true;
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!validate()) return;
    setStatus("submitting");
    setErrorMessage(null);

    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          email,
          phone: phone || null,
          message: interest ? `Interested in: ${interest}\n\n${message}` : message,
          company,
        }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        setErrorMessage(data?.message ?? "Something went wrong. Please try again.");
        setStatus("error");
        return;
      }

      setStatus("sent");
      trackEvent("generate_lead", { interest: interest || "Not specified" });
    } catch {
      setErrorMessage("Something went wrong. Please try again.");
      setStatus("error");
    }
  }

  if (status === "sent") {
    return (
      <div role="status" className="anim-fade rounded-[4px] border border-white/[0.08] bg-[var(--surface-1)] p-8">
        <div aria-hidden className="mb-5 h-[2px] w-10 bg-primary" />
        <p className="text-headline text-[36px] text-zinc-50">Enquiry sent.</p>
        <p className="mt-3 text-base leading-relaxed text-zinc-300">
          Thanks{name.trim() ? `, ${name.trim().split(/\s+/)[0]}` : ""}. {ENQUIRY_SENT}
        </p>
      </div>
    );
  }

  return (
    <form data-contact onSubmit={handleSubmit} noValidate className="grid gap-5 rounded-[4px] border border-white/[0.08] bg-[var(--surface-1)] p-6 sm:p-8">
      {/* Honeypot — hidden from sighted users, present for bots that fill every field */}
      <div className="hidden" aria-hidden="true">
        <label>
          Company
          <input type="text" tabIndex={-1} autoComplete="off" value={company} onChange={(e) => setCompany(e.target.value)} />
        </label>
      </div>

      {status === "error" && errorMessage ? <FormMessage tone="error">{errorMessage}</FormMessage> : null}

      <div className="grid gap-5 sm:grid-cols-2">
        <AuthField label="Name" id="contact-name" error={errors.name}>
          <input
            id="contact-name"
            name="name"
            type="text"
            autoComplete="name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setErrors((prev) => ({ ...prev, name: undefined }));
            }}
            {...fieldA11y("contact-name", errors.name)}
            className={inputClass(Boolean(errors.name))}
          />
        </AuthField>

        <AuthField label="Phone" id="contact-phone" optional>
          <input
            id="contact-phone"
            name="tel"
            type="tel"
            autoComplete="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className={inputClass()}
            placeholder="087 123 4567"
          />
        </AuthField>
      </div>

      <AuthField label="Email" id="contact-email" error={errors.email}>
        <input
          id="contact-email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setErrors((prev) => ({ ...prev, email: undefined }));
          }}
          {...fieldA11y("contact-email", errors.email)}
          className={inputClass(Boolean(errors.email))}
          placeholder="you@example.com"
        />
      </AuthField>

      <AuthField label="Interested in" id="contact-interest" optional>
        <select id="contact-interest" value={interest} onChange={(e) => setInterest(e.target.value)} className={inputClass()}>
          <option value="">Choose a class</option>
          {MARKETING_CLASSES.map((c) => (
            <option key={c.slug} value={c.name}>
              {c.name}
            </option>
          ))}
          <option value={NOT_SURE}>{NOT_SURE}</option>
        </select>
      </AuthField>

      <AuthField label="Message" id="contact-message" error={errors.message}>
        <textarea
          id="contact-message"
          name="message"
          value={message}
          onChange={(e) => {
            setMessage(e.target.value);
            setErrors((prev) => ({ ...prev, message: undefined }));
          }}
          {...fieldA11y("contact-message", errors.message)}
          className={inputClass(Boolean(errors.message), true)}
          placeholder="What are you training for, and when can you usually train?"
        />
      </AuthField>

      <div className="grid gap-3 pt-1">
        <SubmitButton busy={status === "submitting"} label="Send enquiry" busyLabel="Sending…" />
        <p className="text-center text-sm text-zinc-400">{RESPONSE_TIME}</p>
        <p className="text-center text-xs text-zinc-500">
          We only use these details to reply to you. See our{" "}
          <Link href="/privacy" className="text-zinc-400 underline underline-offset-2 hover:text-gold">
            Privacy Policy
          </Link>
          .
        </p>
      </div>
    </form>
  );
}
