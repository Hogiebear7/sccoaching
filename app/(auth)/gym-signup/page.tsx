"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { AuthShell } from "@/components/auth/AuthShell";
import { AuthField, fieldA11y, FormMessage, inputClass, SubmitButton } from "@/components/auth/fields";

// Public sign-up for a gym owner (the API is app/api/gyms/signup). It creates the gym in a waiting state and signs the owner in, then sends them to the setup checklist.
// The gym only appears in the member directory once the platform team approves it.
export default function GymSignupPage() {
  const router = useRouter();
  const [gymName, setGymName] = useState("");
  const [addressLine, setAddressLine] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/gyms/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gymName, addressLine, contactPhone, ownerEmail, password }),
      });
      const json = (await res.json()) as { success?: boolean; message?: string };
      if (!res.ok || !json.success) {
        setError(json.message ?? "Could not create your gym.");
        return;
      }
      router.push("/staff/gym-setup");
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      label="For gyms"
      title="Set up your gym"
      intro="Create your gym and owner account. You can start setting up straight away; your gym appears in the member directory once it has been approved."
      footer={
        <p className="text-sm text-zinc-400">
          Already have an account? <Link href="/login" className="underline underline-offset-2 hover:text-zinc-100">Sign in</Link>
        </p>
      }
    >
      <form onSubmit={onSubmit} className="space-y-5" noValidate>
        {error ? <FormMessage tone="error">{error}</FormMessage> : null}
        <AuthField id="gym-name" label="Gym name">
          <input id="gym-name" className={inputClass()} value={gymName} onChange={(e) => setGymName(e.target.value)} autoComplete="organization" required />
        </AuthField>
        <AuthField id="gym-address" label="Address" hint="Where members come to train. Used to find your gym on the map.">
          <input id="gym-address" className={inputClass()} value={addressLine} onChange={(e) => setAddressLine(e.target.value)} autoComplete="street-address" required {...fieldA11y("gym-address", undefined, true)} />
        </AuthField>
        <AuthField id="gym-phone" label="Phone" optional>
          <input id="gym-phone" className={inputClass()} value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} type="tel" autoComplete="tel" />
        </AuthField>
        <AuthField id="gym-email" label="Your email" hint="This becomes the owner login and the gym's contact address.">
          <input id="gym-email" className={inputClass()} value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} type="email" autoComplete="email" required {...fieldA11y("gym-email", undefined, true)} />
        </AuthField>
        <AuthField id="gym-password" label="Password" hint="At least 8 characters with an uppercase letter, a lowercase letter, a number and a special character.">
          <input id="gym-password" className={inputClass()} value={password} onChange={(e) => setPassword(e.target.value)} type="password" autoComplete="new-password" required {...fieldA11y("gym-password", undefined, true)} />
        </AuthField>
        <SubmitButton busy={busy} label="Create my gym" busyLabel="Creating…" />
      </form>
    </AuthShell>
  );
}
