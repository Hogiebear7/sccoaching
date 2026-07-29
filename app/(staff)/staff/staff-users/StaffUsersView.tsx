"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { ASSIGNABLE_STAFF_ROLES, STAFF_ROLE_LABEL, type StaffRole } from "@/lib/permissions";

type Row = {
  id: string;
  email: string;
  fullName: string | null;
  role: StaffRole;
  archivedAt: string | null;
};

const input =
  "w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-teal-600/60 focus:ring-2 focus:ring-teal-600/15";

async function post(url: string, body: unknown): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    return { ok: res.ok, message: data?.message ?? (res.ok ? "Saved." : "Something went wrong.") };
  } catch {
    return { ok: false, message: "Something went wrong. Please try again." };
  }
}

export function StaffUsersView({ rows, currentUserId }: { rows: Row[]; currentUserId: string }) {
  const router = useRouter();
  const [banner, setBanner] = useState<{ ok: boolean; message: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const activeAdminManagers = rows.filter((r) => r.role === "admin_manager" && !r.archivedAt).length;

  async function run(id: string | null, fn: () => Promise<{ ok: boolean; message: string }>) {
    setBusyId(id ?? "new");
    const r = await fn();
    setBanner(r);
    setBusyId(null);
    if (r.ok) router.refresh();
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="label-caps">Staff</p>
        <h2 className="text-display mt-1 text-[28px] leading-tight">Staff users</h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Create and manage elevated accounts. <span className="font-medium text-foreground">Coach</span> can
          access Classes, Members and Exercises. <span className="font-medium text-foreground">Admin</span> can
          also manage the Catalog, Operations and member billing.{" "}
          <span className="font-medium text-foreground">Admin manager</span> can additionally manage staff users.
          The last active admin manager can&apos;t be deactivated or demoted.
        </p>
      </div>

      {banner ? (
        <p
          className={`rounded-xl border px-4 py-3 text-sm ${
            banner.ok
              ? "border-primary/30 bg-primary/10 text-primary"
              : "border-destructive/30 bg-destructive/10 text-destructive"
          }`}
        >
          {banner.message}
        </p>
      ) : null}

      <CreateForm
        busy={busyId === "new"}
        onCreate={(payload) => run(null, () => post("/api/staff/staff-users", payload))}
      />

      <div className="space-y-3">
        {rows.map((row) => {
          const isSelf = row.id === currentUserId;
          const isLastAdminManager =
            row.role === "admin_manager" && !row.archivedAt && activeAdminManagers <= 1;
          return (
            <div key={row.id} className="panel flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                  {row.fullName ?? row.email}
                  {isSelf ? (
                    <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                      You
                    </span>
                  ) : null}
                  {row.archivedAt ? (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                      Deactivated
                    </span>
                  ) : null}
                </p>
                {row.fullName ? <p className="truncate text-xs text-muted-foreground">{row.email}</p> : null}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <select
                  aria-label={`Role for ${row.email}`}
                  value={row.role}
                  disabled={busyId === row.id || (isLastAdminManager)}
                  title={isLastAdminManager ? "The last active admin manager can't be demoted." : undefined}
                  onChange={(e) =>
                    run(row.id, () => post("/api/staff/staff-users", { id: row.id, role: e.target.value }))
                  }
                  className={`${input} w-auto py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-60`}
                >
                  {ASSIGNABLE_STAFF_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {STAFF_ROLE_LABEL[r]}
                    </option>
                  ))}
                </select>

                <button
                  type="button"
                  disabled={busyId === row.id || (isLastAdminManager && !row.archivedAt)}
                  title={
                    isLastAdminManager && !row.archivedAt
                      ? "The last active admin manager can't be deactivated."
                      : undefined
                  }
                  onClick={() =>
                    run(row.id, () =>
                      post("/api/staff/staff-users/archive", { id: row.id, archived: !row.archivedAt })
                    )
                  }
                  className="rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-foreground transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {row.archivedAt ? "Reactivate" : "Deactivate"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CreateForm({
  busy,
  onCreate,
}: {
  busy: boolean;
  onCreate: (payload: Record<string, unknown>) => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<StaffRole>("coach");

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onCreate({ email, password, role });
        setEmail("");
        setPassword("");
      }}
      className="panel space-y-3 p-4"
    >
      <h3 className="text-sm font-semibold">Create a staff user</h3>
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-muted-foreground">Email</span>
          <input type="email" className={input} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@club.com" />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-muted-foreground">Password</span>
          <input type="password" className={input} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="min 8 characters" autoComplete="new-password" />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-muted-foreground">Role</span>
          <select className={input} value={role} onChange={(e) => setRole(e.target.value as StaffRole)}>
            {ASSIGNABLE_STAFF_ROLES.map((r) => (
              <option key={r} value={r}>
                {STAFF_ROLE_LABEL[r]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <button type="submit" disabled={busy} className="btn-primary px-4 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-60">
        {busy ? "Creating…" : "Create user"}
      </button>
    </form>
  );
}
