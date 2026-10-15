// One housekeeping run at a time ACROSS PROCESSES. Jobs are started only by HTTP (the scheduler's request to /api/cron/run, or a platform operator's "Run now"), never by a
// timer, but with more than one server process, or two overlapping scheduler calls, two runs could execute the same jobs at once: double notifications, double
// lapsed-membership processing. Before a run starts it claims this lease; a second run that finds it taken does nothing and says so.
//
// The lease is a small side file beside db.json, written under the same cross-process lock protocol as the datastore. It expires by itself (a run that crashed cannot
// block housekeeping forever): the expiry is longer than the route's hard deadline, shorter than any sensible scheduler interval.
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";

import { replaceFileAtomically, withFileLock } from "@/lib/datastore/core";
import { dataDirectory } from "@/lib/db";

export const JOB_LEASE_TTL_MS = 200_000;

export class JobRunInProgressError extends Error {
  constructor() {
    super("A housekeeping run is already in progress.");
    this.name = "JobRunInProgressError";
  }
}

const leaseFile = () => path.join(dataDirectory(), "job-run-lease");

function readLease(file: string): { id: string; expiresAt: number } | null {
  try {
    const v = JSON.parse(fs.readFileSync(file, "utf8"));
    return typeof v?.id === "string" && typeof v?.expiresAt === "number" ? v : null;
  } catch {
    return null;
  }
}

/** Returns a lease id if this process now holds the lease, or null if another live run holds it. */
export function claimJobRunLease(now: number = Date.now(), ttlMs: number = JOB_LEASE_TTL_MS): string | null {
  const file = leaseFile();
  return withFileLock(file, () => {
    const current = readLease(file);
    if (current && current.expiresAt > now) return null;
    const id = randomUUID();
    replaceFileAtomically(file, JSON.stringify({ id, expiresAt: now + ttlMs, pid: process.pid }));
    return id;
  });
}

/** Releases the lease if (and only if) it is still ours. Never throws: the run's result matters more than tidying up. */
export function releaseJobRunLease(id: string): void {
  const file = leaseFile();
  try {
    withFileLock(file, () => {
      const current = readLease(file);
      if (current && current.id === id) fs.rmSync(file, { force: true });
    });
  } catch (e) {
    console.error("[jobs] could not release the run lease; it will expire on its own", e);
  }
}
